"""Read-only first-run checks. No service installation, registration, or restart."""

import json
import os
import platform
import shutil
import subprocess
import copy
import time
from pathlib import Path

from agent_ops.desktop.package_info import package_info

PROCESS_PROBE = r"""
$ErrorActionPreference = 'Stop'
$names = @('start_btk_supervisor.ps1', 'a2a_chat_responder.py', 'run_agent_executor_loop.py', 'poll_runner_queue.py', 'profile_materialize_daemon.py', 'mcp_stale_task_watchdog.py', 'blocked_task_router.py', 'log_error_monitor.py')
$rows = @(foreach ($p in Get-CimInstance Win32_Process) {
  if ($p.Name -notin @('powershell.exe', 'pwsh.exe', 'python.exe', 'pythonw.exe')) { continue }
  foreach ($name in $names) {
    if ($p.CommandLine -and $p.CommandLine -match ([regex]::Escape($name) + '(?:\s|"|$)')) {
      [pscustomobject]@{component=$name;pid=$p.ProcessId;parent_pid=$p.ParentProcessId}
    }
  }
})
ConvertTo-Json -InputObject $rows -Compress
"""


def process_observation():
    if platform.system() != "Windows":
        return {"status": "unavailable", "processes": [], "reason": "Windows 프로세스 점검 대상이 아닙니다."}
    try:
        powershell = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
        result = subprocess.run([str(powershell), "-NoProfile", "-NonInteractive", "-Command", PROCESS_PROBE],
            capture_output=True, timeout=6, encoding="utf-8", errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), check=True)
        rows = json.loads(result.stdout or "[]")
        allowed = {"start_btk_supervisor.ps1", "a2a_chat_responder.py", "run_agent_executor_loop.py",
                   "poll_runner_queue.py", "profile_materialize_daemon.py", "mcp_stale_task_watchdog.py",
                   "blocked_task_router.py", "log_error_monitor.py"}
        if not isinstance(rows, list) or any(not isinstance(row, dict) or row.get("component") not in allowed for row in rows):
            raise ValueError("unexpected process probe response")
        return {"status": "observed", "processes": [{"component": row["component"], "pid": int(row["pid"]),
                 "parent_pid": int(row["parent_pid"])} for row in rows], "reason": ""}
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        return {"status": "unknown", "processes": [], "reason": f"로컬 프로세스 조회 실패: {type(exc).__name__}"}


def readiness(service):
    from agent_ops.desktop.service import now, safe_text
    info = package_info()
    checks = [{"id": "core", "label": "데스크톱 코어", "state": "ready",
               "detail": f"{info['version']} / Python {info['python_version']}",
               "source": "동봉된 코어" if info["bundled"] else "개발 소스 연결"}]
    try:
        profile = service.profile()
        checks.append({"id": "profile", "label": "PC 프로파일", "state": "ready" if profile.runner else "action_required",
                       "detail": profile.runner or "중앙에서 발급된 프로파일이 없습니다.", "source": "CLI 프로파일"})
        workspace_ok = bool(profile.runner) and (profile.workspace / "harness/runners").is_dir()
        checks.append({"id": "workspace", "label": "운영 작업 경로", "state": "ready" if workspace_ok else "action_required",
                       "detail": str(profile.workspace) if workspace_ok else "등록된 러너 작업 경로가 필요합니다.",
                       "source": "프로파일의 repo_path"})
        target = service.target()
        available = bool(profile.runner) and target.engine == "claude_code" and bool(shutil.which("claude"))
        checks.append({"id": "engine", "label": "대화 엔진", "state": "ready" if available else "action_required",
                       "detail": f"{target.engine} / {target.model_alias or '기본 모델'}" if available else "지원 엔진의 설치와 인증이 필요합니다.",
                       "source": "현재 CLI 설정 / PATH"})
        if profile.runner:
            try:
                service.endpoint(profile)
                checks.append({"id": "endpoint", "label": "중앙 주소 정책", "state": "ready",
                               "detail": "주소 형식 검증 통과. 통신·인증은 연결 상태에서 별도로 확인합니다.",
                               "source": "공통 endpoint resolver"})
            except (Exception, SystemExit) as exc:
                checks.append({"id": "endpoint", "label": "중앙 주소 정책", "state": "action_required",
                               "detail": safe_text(str(exc), 350), "source": "공통 endpoint resolver"})
        else:
            checks.append({"id": "endpoint", "label": "중앙 주소 정책", "state": "unknown",
                           "detail": "프로파일 등록 대기", "source": "공통 endpoint resolver"})
    except Exception as exc:
        checks.append({"id": "profile", "label": "PC 프로파일", "state": "action_required",
                       "detail": safe_text(str(exc), 350), "source": "CLI 프로파일"})
    # UI reads may overlap on first load. A three-second, timestamped cache coalesces
    # expensive CIM probes; installation guards always call the uncached probe.
    with service.observation_lock:
        cached = service.observation_cache
        if cached and time.monotonic() - cached[0] < 3:
            observation = copy.deepcopy(cached[1])
            observation["cached"] = True
        else:
            observation = {**process_observation(), "observed_at": now(), "cached": False}
            if observation["status"] == "observed":
                service.observation_cache = (time.monotonic(), copy.deepcopy(observation))
    return {"observed_at": now(), "release": info, "checks": checks,
            "requires_attention": any(row["state"] != "ready" for row in checks),
            "process_observation": {**observation, "source": "Win32_Process", "control_owner": "existing_supervisor"},
            "service_actions_enabled": False}
