"""Native-only, user-confirmed setup. No arbitrary executable or task execution API."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path

from agent_ops.client import config
from agent_ops.client.central_auth import store_auth_response
from agent_ops.client.halt import active_halts_for_context
from agent_ops.desktop import bundle_install
from agent_ops.desktop.enrollment import authenticate, enroll, managed_root, host_matches, https_url
from agent_ops.desktop.readiness import process_observation
from agent_ops.desktop.deployment import DeploymentReporter
from agent_ops.desktop.service_health import verify as verify_service_health

STEPS = [("profile", "중앙 프로파일 확인"), ("deployment", "중앙 배포 연결"), ("bundle", "공식 배포 번들 확인"),
         ("dependencies", "필수 도구 설치"), ("runtime", "공통 런타임 설치"),
         ("verify", "서비스 구성 검증"), ("start", "서비스 시작"), ("startup", "자동시작 등록"),
         ("health", "서비스 기동·중앙 heartbeat 검증")]
STARTUP_NAME = "BTK Agent Services.lnk"


def powershell():
    return str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe")


def run(command, *, cwd=None, env=None, timeout=300):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, encoding="utf-8", errors="replace",
                            timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        # Child output can contain credentials from external installers. Report operation and
        # exit code, never the command environment or untrusted raw output.
        raise RuntimeError(f"{Path(command[0]).name} 실행 실패 (exit {result.returncode})")
    return result.stdout.strip()


def runtime_env(profile):
    env = dict(os.environ)
    env.pop("PYTHONHOME", None)
    env.pop("PYTHONPATH", None)
    env.pop("BTK_ALLOW_PATH_PYTHON", None)
    env.update({"BTK_CONFIG_HOME": str(config.CONFIG_HOME), "BTK_PROFILE": profile.name,
        "BTK_RUNNER_ID": profile.runner, "BTK_TEAM_ID": profile.team_id, "BTK_TEAM_TYPE": profile.team_type,
        "BTK_HARNESS_REPO": str(profile.workspace), "BTK_WORKSPACE": str(profile.workspace),
        "BTK_MCP_URL": profile.mcp_url, "BTK_MCP_RUNTIME_URL": profile.mcp_url,
        "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "BTK_MCP_TOKEN": config.profile_token(profile)})
    extra = [str(Path.home() / ".local/bin"), str(Path(os.environ.get("APPDATA", "")) / "npm")]
    if os.name == "nt":
        import winreg
        for hive, key in ((winreg.HKEY_CURRENT_USER, "Environment"), (winreg.HKEY_LOCAL_MACHINE,
                r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
            try:
                with winreg.OpenKey(hive, key) as handle:
                    extra.append(os.path.expandvars(winreg.QueryValueEx(handle, "Path")[0]))
            except OSError:
                pass
    env["PATH"] = os.pathsep.join([*extra, env.get("PATH", "")])
    return env


def python_executable(env):
    candidates = [shutil.which("python", path=env["PATH"])]
    if not getattr(sys, "frozen", False):
        candidates.insert(0, getattr(sys, "_base_executable", sys.executable))
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Python"
    candidates.extend(str(p) for p in sorted(base.glob("Python3*/python.exe"), reverse=True))
    for candidate in candidates:
        if not candidate or "WindowsApps" in candidate:
            continue
        try:
            run([candidate, "-I", "-c", "import sys,venv,ensurepip; assert (3,11)<=sys.version_info<(3,15)"], env=env, timeout=10)
            return candidate
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            pass
    return None


def install_dependencies(profile, engine):
    env = runtime_env(profile)
    winget = shutil.which("winget", path=env["PATH"])
    def install(package):
        if not winget:
            raise RuntimeError("Windows 앱 설치 관리자(WinGet)가 필요합니다. 설치 후 다시 시도해 주세요.")
        # Fixed package IDs only; retain publisher/hash verification and normal Windows UAC.
        run([winget, "install", "--id", package, "--exact", "--source", "winget", "--scope", "user",
             "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"], env=env, timeout=600)
        env.update(runtime_env(profile))
    python = python_executable(env)
    if not python:
        install("Python.Python.3.12")
        python = python_executable(env)
    if not python:
        raise RuntimeError("Python 설치 후 venv·pip를 확인하지 못했습니다.")
    if not shutil.which("git", path=env["PATH"]):
        install("Git.Git")
    if engine == "claude" and not shutil.which("claude", path=env["PATH"]):
        install("Anthropic.ClaudeCode")
    if engine == "codex" and not shutil.which("codex", path=env["PATH"]):
        if not shutil.which("node", path=env["PATH"]):
            install("OpenJS.NodeJS.LTS")
        node = shutil.which("node", path=env["PATH"])
        npm = Path(node or "").resolve().parent / "node_modules/npm/bin/npm-cli.js"
        if not node or not npm.is_file():
            raise RuntimeError("Node.js·npm 설치를 확인하지 못했습니다.")
        prefix = str(Path(os.environ["APPDATA"]) / "npm")
        run([node, str(npm), "install", "--global", "--prefix", prefix, "@openai/codex", "--registry", "https://registry.npmjs.org"], env=env, timeout=600)
    for command in ("git", engine):
        if not shutil.which(command, path=env["PATH"]):
            raise RuntimeError(f"{command} 설치 후 실행 경로를 확인하지 못했습니다.")
    return python, env


def require_quiet():
    observation = process_observation()
    if observation["status"] != "observed":
        raise ValueError("기존 서비스 조회가 실패하여 설치·시작을 중단했습니다.")
    if observation["processes"]:
        raise ValueError("이 PC에 운영 서비스가 이미 실행 중입니다. 중복 설치·시작하지 않습니다.")


def require_managed(profile):
    root = (managed_root() / "workspaces").resolve()
    path = profile.workspace.resolve()
    reject_links(profile.workspace)
    if path.parent != root or path.name != profile.name:
        raise ValueError("기존 작업 경로는 통합 설치로 덮어쓰지 않습니다. 새로 등록된 전용 설치 경로가 필요합니다.")
    return path


def reject_links(path):
    for item in (path, *path.parents):
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            raise ValueError("설치 경로의 링크·정션은 허용하지 않습니다.")


def verify_runtime(profile):
    workspace = require_managed(profile)
    for name in bundle_install.REQUIRED:
        file = workspace / name
        if not file.is_file() or not file.resolve().is_relative_to(workspace):
            raise ValueError(f"필수 서비스 파일이 없습니다: {name}")
    import yaml
    candidates = []
    for file in (workspace / "harness/runners").glob("*.yaml"):
        if not file.resolve().is_relative_to(workspace):
            raise ValueError("러너 파일이 작업 경로 밖을 가리킵니다.")
        data = yaml.safe_load(file.read_text(encoding="utf-8")) or {}
        if profile.runner in (file.stem, data.get("runner_id")):
            candidates.append((file, data))
    if len(candidates) != 1:
        raise ValueError("설치 번들에서 현재 러너를 유일하게 찾지 못했습니다.")
    file, data = candidates[0]
    hosts = data.get("expected_hostnames") or []
    if not isinstance(hosts, list) or not any(host_matches(h) for h in hosts):
        raise ValueError("배포 러너의 호스트 바인딩이 이 PC와 일치하지 않습니다.")
    python = workspace / ".venv/Scripts/python.exe"
    run([str(python), "-c", "import yaml; from agent_ops.client import btk; from agent_ops.client import mcp_runtime_client"], cwd=workspace, env=runtime_env(profile), timeout=20)
    return file.stem


def receipt_path(profile):
    return require_managed(profile) / "runs/desktop-install/receipt.json"


def write_receipt(profile, bundle):
    path = receipt_path(profile)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {"schema": "btk.desktop.installed.v1", "runner_id": profile.runner, "profile_id": profile.central_profile_id,
        "derived_from": bundle, "observed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "code_hashes": {name: hashlib.sha256((profile.workspace / name).read_bytes()).hexdigest() for name in bundle_install.REQUIRED}}
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def prepare_supervisor(profile):
    require_quiet()
    runner = verify_runtime(profile)
    if active_halts_for_context(profile, runner=profile.runner):
        raise ValueError("현재 러너에 중지 정책이 적용되어 있습니다. 설치에서 해제하지 않습니다.")
    for key in (runner, profile.runner):
        if (profile.workspace / "runs/runner-control/stopped" / f"{key}.json").exists():
            raise ValueError("러너 중지 표식이 있습니다. 설치에서 해제하지 않습니다.")
    record = json.loads(receipt_path(profile).read_text(encoding="utf-8"))
    if record.get("runner_id") != profile.runner or record.get("profile_id") != profile.central_profile_id:
        raise ValueError("설치 기록과 현재 프로파일이 다릅니다.")
    for name in bundle_install.REQUIRED:
        if hashlib.sha256((profile.workspace / name).read_bytes()).hexdigest() != record.get("code_hashes", {}).get(name):
            raise ValueError("설치 이후 런타임 코드가 바뀌었습니다. 배포 버전을 다시 검증해야 합니다.")
    command = [powershell(), "-NoProfile", "-NonInteractive", "-File",
        str(profile.workspace / bundle_install.REQUIRED[0]), "-PcProfile", "custom", "-Runner", runner,
        "-ExactRunners", "-Repo", str(profile.workspace), "-McpRuntimeUrl", profile.mcp_url,
        "-NoDuplicateReap", "-NoExecutorStallRepair"]
    return command


def start_services(profile):
    from agent_ops.desktop.runtime_host import start
    return start(profile)


def register_startup(profile):
    if not getattr(sys, "frozen", False):
        raise ValueError("자동시작은 설치형 앱에서만 등록할 수 있습니다.")
    target = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup" / STARTUP_NAME
    from agent_ops.desktop.runtime_host import executable
    env = runtime_env(profile)
    env.update({"BTK_DESKTOP_SHORTCUT": str(target), "BTK_DESKTOP_CORE": str(executable())})
    # Fixed script, arguments from the environment. No user input is interpolated as PowerShell.
    run([powershell(), "-NoProfile", "-NonInteractive", "-Command", r'''
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $env:BTK_DESKTOP_SHORTCUT) {
  $existing = $shell.CreateShortcut($env:BTK_DESKTOP_SHORTCUT)
  if ($existing.TargetPath -ne $env:BTK_DESKTOP_CORE -or $existing.Arguments -ne '--run-agent') { throw 'foreign startup shortcut' }
}
$link = $shell.CreateShortcut($env:BTK_DESKTOP_SHORTCUT)
$link.TargetPath = $env:BTK_DESKTOP_CORE
$link.Arguments = '--run-agent'
$link.WorkingDirectory = Split-Path -Parent $env:BTK_DESKTOP_CORE
$link.WindowStyle = 7
$link.Description = 'BTK Agent Services'
$link.Save()
'''], env=env, timeout=15)
    return {"status": "registered", "path": str(target)}


def remove_startup():
    target = Path(os.environ["APPDATA"]) / "Microsoft/Windows/Start Menu/Programs/Startup" / STARTUP_NAME
    env = dict(os.environ, BTK_DESKTOP_SHORTCUT=str(target), BTK_DESKTOP_CORE=sys.executable)
    run([powershell(), "-NoProfile", "-NonInteractive", "-Command", r'''
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $env:BTK_DESKTOP_SHORTCUT) {
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:BTK_DESKTOP_SHORTCUT)
  $runtime = Join-Path (Split-Path -Parent $env:BTK_DESKTOP_CORE) 'btk-agent-runtime.exe'
  if (($link.TargetPath -eq $env:BTK_DESKTOP_CORE -and $link.Arguments -eq '--start-services') -or ($link.TargetPath -eq $runtime -and $link.Arguments -eq '--run-agent')) {
    Remove-Item -LiteralPath $env:BTK_DESKTOP_SHORTCUT
  }
}
'''], env=env, timeout=15)


class SetupManager:
    def __init__(self, service):
        self.service = service
        self.lock = threading.Lock()
        self.reporter = None
        self.state = {"status": "idle", "steps": [], "error": ""}

    def status(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def enroll(self, params):
        with self.lock:
            if self.state["status"] == "running":
                raise ValueError("설치 중에는 프로파일을 변경할 수 없습니다.")
            return enroll(self.service, params)

    def start(self, params):
        if set(params) - {"autostart", "start_services"} or any(type(v) is not bool for v in params.values()):
            raise ValueError("설치 옵션 형식이 올바르지 않습니다.")
        if platform.system() != "Windows":
            raise ValueError("Windows 설치만 지원합니다.")
        profile = self.service.profile()
        require_managed(profile)
        if not profile.central_profile_id or not profile.central_url:
            raise ValueError("중앙 프로파일 연결이 먼저 필요합니다.")
        require_quiet()
        with self.lock:
            if self.state["status"] == "running":
                raise ValueError("이미 설치 중입니다.")
            self.state = {"status": "running", "job_id": uuid.uuid4().hex, "error": "",
                          "steps": [{"id": key, "label": label, "status": "pending"} for key, label in STEPS]}
        threading.Thread(target=self._install, args=(profile, dict(params)), daemon=False).start()
        return self.status()

    def _step(self, key, callback, *, requested=True):
        with self.lock:
            row = next(row for row in self.state["steps"] if row["id"] == key)
            row["status"] = "running" if requested else "skipped"
        if not requested:
            if self.reporter:
                self.reporter.progress(key, "done", {"status": "not_requested"})
            return {"status": "not_requested"}
        if self.reporter:
            self.reporter.progress(key, "running")
        result = callback()
        if self.reporter:
            self.reporter.progress(key, "done")
        with self.lock:
            row["status"] = "completed"
        return result

    def _install(self, profile, options):
        from agent_ops.desktop.service import safe_text
        mutex = None
        try:
            if os.name == "nt":
                import ctypes
                kernel = ctypes.WinDLL("kernel32", use_last_error=True)
                kernel.CreateMutexW.restype = ctypes.c_void_p
                kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
                kernel.CloseHandle.argtypes = [ctypes.c_void_p]
                kernel.ReleaseMutex.argtypes = [ctypes.c_void_p]
                handle = kernel.CreateMutexW(None, True, "Local\\BTK.Desktop.Setup")
                if not handle:
                    raise RuntimeError("Windows 설치 잠금을 만들지 못했습니다.")
                if ctypes.get_last_error() == 183:
                    kernel.CloseHandle(handle)
                    raise ValueError("다른 BTK 앱에서 설치 중입니다.")
                mutex = (kernel, handle)
            bound, auth = self._step("profile", lambda: authenticate(profile, profile.central_url, profile.central_profile_id))
            if auth.get("engine_auth", {}).get("status") != "available":
                raise ValueError("중앙에 모델 자격 증명이 없습니다. 웹 콘솔에서 인증을 완료해 주세요.")
            store_auth_response(bound, auth, central_url=bound.central_url, engine=auth["profile"]["engine"])
            profile = bound
            https_url(profile.mcp_url, label="중앙에서 받은 MCP 주소")
            def connect_deployment():
                reporter = DeploymentReporter(profile, auth["profile"]["engine"])
                deployment = reporter.enroll()
                self.reporter = reporter
                with self.lock:
                    self.state["deployment"] = deployment
                    self.state["central_reporting"] = "connected"
            self._step("deployment", connect_deployment)
            workspace = require_managed(profile)
            receipt = receipt_path(profile)
            # A retry uses an already-verified installation. Never overwrite an existing checkout
            # or delete partial data to hide a failed install.
            installed = receipt.is_file()
            attempt = receipt.with_name("attempt.json")
            owned_partial = False
            if attempt.is_file():
                prior = json.loads(attempt.read_text(encoding="utf-8"))
                owned_partial = prior.get("runner_id") == profile.runner and prior.get("profile_id") == profile.central_profile_id
            if workspace.exists() and any(p.name != "runs" for p in workspace.iterdir()) and not installed:
                if not owned_partial:
                    raise ValueError("다른 설치 파일이 있는 경로는 덮어쓰지 않습니다.")
            staging = managed_root() / "downloads" / uuid.uuid4().hex
            reject_links(staging)
            if installed:
                bundle = self._step("bundle", lambda: json.loads(receipt.read_text(encoding="utf-8"))["derived_from"])
            else:
                bundle = self._step("bundle", lambda: bundle_install.download(profile, profile.mcp_url, staging))
            python, env = self._step("dependencies", lambda: install_dependencies(profile, auth["profile"]["engine"]))
            if not installed:
                def install_runtime():
                    require_quiet()
                    workspace.mkdir(parents=True, exist_ok=True)
                    attempt.parent.mkdir(parents=True, exist_ok=True)
                    attempt.write_text(json.dumps({"runner_id": profile.runner, "profile_id": profile.central_profile_id,
                        "derived_from": bundle}), encoding="utf-8")
                    env["BTK_PYTHON"] = python
                    run([powershell(), "-NoProfile", "-NonInteractive", "-File", str(staging / "install.ps1"),
                        "-InstallRoot", str(workspace), "-RepoPath", str(workspace), "-RunnerId", profile.runner,
                        "-TeamId", profile.team_id, "-TeamType", profile.team_type, "-McpUrl", profile.mcp_url,
                        "-Profile", profile.name, "-SkipConfig", "-SkipVerify", "-NoPathUpdate"], env=env, timeout=600)
                    run([str(workspace / ".venv/Scripts/python.exe"), "-m", "pip", "install", "--index-url",
                        "https://pypi.org/simple", "PyYAML==6.0.3"], env=env, timeout=120)
                self._step("runtime", install_runtime)
            else:
                self._step("runtime", lambda: None)
            self._step("verify", lambda: verify_runtime(profile))
            if not installed:
                write_receipt(profile, bundle)
            started_at = datetime.now(timezone.utc)
            activation = self._step("start", lambda: start_services(profile), requested=bool(options.get("start_services")))
            with self.lock:
                self.state["activation"] = activation
                if not options.get("start_services"):
                    next(row for row in self.state["steps"] if row["id"] == "start")["status"] = "skipped"
            startup = self._step("startup", lambda: register_startup(profile), requested=bool(options.get("autostart")))
            # A living supervisor is not evidence that its children or the central heartbeat work.
            with self.lock:
                health_step = next(row for row in self.state["steps"] if row["id"] == "health")
                health_step["status"] = "running" if options.get("start_services") else "skipped"
            health = {"status": "not_requested", "heartbeat_status": "unknown", "heartbeat_age_minutes": None}
            if options.get("start_services"):
                self.reporter.progress("health", "running")
                health = verify_service_health(profile, activation, started_at)
                self.reporter.progress("health", "done" if health["status"] == "completed" else "blocked", health)
            outcome = "completed" if health["status"] in ("completed", "not_requested") else "partial"
            self.reporter.progress("setup", "done" if outcome == "completed" else "blocked", {
                "installation_status": outcome, "start_requested": bool(options.get("start_services")),
                "autostart_requested": bool(options.get("autostart")), "health": health,
                "bundle": bundle})
            with self.lock:
                if options.get("start_services"):
                    health_step["status"] = health["status"]
                if not options.get("autostart"):
                    next(row for row in self.state["steps"] if row["id"] == "startup")["status"] = "skipped"
                self.state.update(status=outcome, activation=activation, startup=startup, bundle=bundle, health=health,
                    error=health.get("error", ""), heartbeat_status=health["heartbeat_status"],
                    heartbeat_age_minutes=health["heartbeat_age_minutes"])
        except (Exception, SystemExit) as exc:
            error = safe_text(str(exc), 500)
            if self.reporter:
                try:
                    self.reporter.progress("setup", "blocked", {"error": error, "installation_status": "failed"})
                except (Exception, SystemExit) as report_error:
                    with self.lock:
                        self.state["central_reporting"] = "failed"
                        self.state["report_error"] = safe_text(str(report_error), 400)
            with self.lock:
                for row in self.state["steps"]:
                    if row["status"] == "running":
                        row["status"] = "failed"
                self.state.update(status="failed", error=error)
        finally:
            self.reporter = None
            if mutex:
                kernel, handle = mutex
                kernel.ReleaseMutex(handle)
                kernel.CloseHandle(handle)


def autostart():
    from agent_ops.desktop.service import DesktopService
    service = DesktopService()
    profile = service.profile()
    # Autostart never downloads, registers profiles, clears stop markers, or changes credentials.
    profile = replace(profile, mcp_url=service.endpoint(profile))
    start_services(profile)
