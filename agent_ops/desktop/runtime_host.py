"""App-owned background lifetime; existing verified supervisor owns fleet behavior."""

import hashlib
import json
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

from agent_ops.desktop.enrollment import managed_root
from agent_ops.desktop.windows_runtime import Mutex, OwnedJob, mutex_exists, process_identity

HOST_ENTRY = "btk-agent-runtime.exe"


def mutex_name():
    key = hashlib.sha256(str(Path.home().resolve()).casefold().encode()).hexdigest()[:20]
    return "Local\\BTK.Agent.Runtime." + key


def job_name(instance):
    return "Local\\BTK.Agent.Runtime.Job." + uuid.UUID(instance).hex


def state_path():
    from agent_ops.desktop.setup_runtime import reject_links
    path = managed_root() / "runtime/status.json"
    reject_links(path)
    return path


def binding(profile):
    return {"profile_name": profile.name, "profile_id": profile.central_profile_id, "runner_id": profile.runner,
        "workspace": str(profile.workspace.resolve())}


def status(profile):
    result = {"status": "stopped", "authority": "Win32 process identity and named mutex",
        "heartbeat_status": "unknown", "heartbeat_age_minutes": None}
    if os.name != "nt":
        return {**result, "status": "unavailable"}
    try:
        locked = mutex_exists(mutex_name())
        path = state_path()
        if not path.is_file() or path.stat().st_size > 16384:
            return {**result, "status": "unknown" if locked else "stopped"}
        record = json.loads(path.read_text(encoding="utf-8"))
        if not locked:
            if record.get("binding") == binding(profile):
                return {**result, "error": record.get("error", ""), "last_observed_at": record.get("observed_at")}
            return result
        owner = record.get("owner", {})
        if not isinstance(owner, dict) or not owner.get("pid") or process_identity(owner["pid"]) != owner:
            return {**result, "status": "unknown"}
        if record.get("binding") != binding(profile):
            return {**result, "status": "other_profile"}
        return {**result, "status": record["status"], "owner_pid": owner["pid"],
            "supervisor_pid": record.get("supervisor_pid"), "observed_at": record.get("observed_at"),
            "instance": record.get("instance"), "error": record.get("error", "")}
    except (OSError, ValueError, TypeError, KeyError):
        return {**result, "status": "unknown"}


def executable():
    if not getattr(sys, "frozen", False):
        raise ValueError("백그라운드 실행은 설치형 앱에서만 가능합니다.")
    core = Path(sys.executable).parent
    path = core / HOST_ENTRY
    manifest = json.loads((core.parent / "desktop-release.json").read_text(encoding="utf-8"))
    rows = [row for row in manifest["core"]["files"] if row["path"] == HOST_ENTRY]
    if len(rows) != 1 or path.is_symlink() or path.resolve().parent != core.resolve():
        raise ValueError("백그라운드 실행 파일이 릴리스에 없습니다.")
    data = path.read_bytes()
    if len(data) != rows[0]["bytes"] or hashlib.sha256(data).hexdigest() != rows[0]["sha256"]:
        raise ValueError("백그라운드 실행 파일 검증에 실패했습니다.")
    return path


def start(profile):
    from agent_ops.desktop.setup_runtime import prepare_supervisor, runtime_env
    current = status(profile)
    if current["status"] == "running":
        return {**current, "status": "already_running"}
    if current["status"] != "stopped":
        raise ValueError("백그라운드 실행 상태가 불확실하거나 다른 프로파일이 실행 중입니다.")
    prepare_supervisor(profile)
    host = executable()
    instance = uuid.uuid4().hex
    env = runtime_env(profile)
    env["BTK_AGENT_LAUNCH_ID"] = instance
    child = subprocess.Popen([str(host), "--run-agent"], cwd=host.parent, env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        current = status(profile)
        if current["status"] == "running":
            return {**current, "status": "started" if current.get("instance") == instance else "already_running"}
        if child.poll() is not None:
            raise RuntimeError(f"백그라운드 실행기가 종료됐습니다 (exit {child.returncode}).")
        time.sleep(0.25)
    # The owner may still be completing checks; never kill an uncertain process by PID.
    raise RuntimeError("백그라운드 시작 확인 시간이 초과되었습니다. 실행 상태를 다시 확인해 주세요.")


def run_host():
    from agent_ops.client.config import current_profile
    from agent_ops.desktop.setup_runtime import prepare_supervisor, runtime_env
    from agent_ops.desktop.service import safe_text
    mutex = Mutex(mutex_name())
    if not mutex.created:
        mutex.close()
        return
    job = None
    path = None
    record = {}
    try:
        profile = current_profile()
        path = state_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {"schema": "btk.desktop.runtime.observation.v1", "binding": binding(profile),
            "owner": process_identity(os.getpid()), "instance": os.environ.get("BTK_AGENT_LAUNCH_ID") or uuid.uuid4().hex,
            "derived_from": "Win32 process identity and named mutex", "heartbeat_status": "unknown"}
        if not record["owner"]:
            raise RuntimeError("백그라운드 실행기의 신원을 확인하지 못했습니다.")
        command = prepare_supervisor(profile)
        job = OwnedJob(job_name(record["instance"]))

        def report(state, **extra):
            record.update(status=state, observed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **extra)
            temporary = path.with_suffix(f".{os.getpid()}.tmp")
            temporary.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
            os.replace(temporary, path)

        report("starting")
        with (path.parent / "supervisor.stdout.log").open("ab") as out, (path.parent / "supervisor.stderr.log").open("ab") as err:
            child = subprocess.Popen(command, cwd=profile.workspace, env=runtime_env(profile), stdin=subprocess.DEVNULL,
                stdout=out, stderr=err, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            code = child.wait(timeout=2)
            raise RuntimeError(f"Supervisor가 시작 직후 종료됐습니다 (exit {code}).")
        except subprocess.TimeoutExpired:
            report("running", supervisor_pid=child.pid)
        # Block on the process handle instead of polling CIM, files, or the central server.
        code = child.wait()
        report("stopped" if code == 0 else "failed", error="" if code == 0 else f"Supervisor 종료 (exit {code})")
    except (Exception, SystemExit) as exc:
        if path and record:
            record.update(status="failed", error=safe_text(str(exc), 400), observed_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
        raise
    finally:
        mutex.close()
        if job:
            job.close()
