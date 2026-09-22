"""Bounded setup verification, not another daemon or runner-liveness authority."""

import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from agent_ops.desktop import runtime_host
from agent_ops.desktop.windows_runtime import job_process_ids


TREE_PROBE = r'''
$ErrorActionPreference = 'Stop'
$all = @(Get-CimInstance Win32_Process)
$root = $all | Where-Object { $_.ProcessId -eq [int]$env:BTK_VERIFY_SUPERVISOR }
if (-not $root) { throw 'supervisor process missing' }
$ids = [System.Collections.Generic.HashSet[int]]::new()
foreach ($id in ($env:BTK_VERIFY_JOB_PIDS | ConvertFrom-Json)) { [void]$ids.Add([int]$id) }
$rows = @(foreach ($p in $all) {
  if (-not $ids.Contains([int]$p.ProcessId)) { continue }
  if ($p.Name -notin @('python.exe', 'pythonw.exe', 'powershell.exe', 'pwsh.exe')) { continue }
  $command = [string]$p.CommandLine
  $relative = '(?:harness[\\/](?:orchestrator|profiledb|deploy[\\/]pc-runners)[\\/])([A-Za-z0-9_]+\.(?:py|ps1))'
  $match = [regex]::Match($command, $relative)
  if ($match.Success) {
    [pscustomobject]@{component=$match.Groups[1].Value;pid=[int]$p.ProcessId}
  }
})
ConvertTo-Json -InputObject $rows -Compress
'''

COMPONENTS = {
    "poller": "poll_runner_queue.py", "executor": "run_agent_executor_loop.py",
    "card-reaper": "mcp_stale_task_watchdog.py", "log-error-monitor": "log_error_monitor.py",
    "a2a-responder": "a2a_chat_responder.py", "drift-reconciler": "drift_reconciler.py",
    "answer-ingest": "answer_ingest.py", "profile-materialize": "profile_materialize_daemon.py",
    "agent-memory-materialize": "materialize_agent_memory_daemon.py", "mission-runtime": "mission_runtime_daemon.py",
}
BASE_LABELS = {"poller", "executor", "card-reaper", "log-error-monitor", "a2a-responder",
               "drift-reconciler", "answer-ingest", "profile-materialize"}


def process_tree(supervisor_pid, member_pids):
    from agent_ops.desktop.setup_runtime import powershell
    env = dict(os.environ, BTK_VERIFY_SUPERVISOR=str(int(supervisor_pid)),
               BTK_VERIFY_JOB_PIDS=json.dumps(member_pids))
    result = subprocess.run([powershell(), "-NoProfile", "-NonInteractive", "-Command", TREE_PROBE],
        env=env, capture_output=True, timeout=8, encoding="utf-8", errors="replace", check=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    rows = json.loads(result.stdout)
    if not isinstance(rows, list) or any(not isinstance(r, dict) or type(r.get("pid")) is not int
                                       or not isinstance(r.get("component"), str) for r in rows):
        raise ValueError("서비스 프로세스 조회 형식이 올바르지 않습니다.")
    return [{"component": r["component"], "pid": r["pid"]} for r in rows]


def observe(profile, activation, since):
    from agent_ops.desktop.service import DesktopService, read_record, safe_text
    result = {"status": "partial", "observed_at": datetime.now(timezone.utc).isoformat(),
        "authority": "Win32 Job membership + runner.heartbeat.list",
        "components": [], "heartbeat_status": "unknown", "heartbeat_age_minutes": None}
    try:
        owner = runtime_host.status(profile)
        if (owner.get("status") != "running" or not activation.get("instance")
                or owner.get("instance") != activation["instance"]
                or owner.get("supervisor_pid") != activation.get("supervisor_pid")):
            raise ValueError("시작한 실행기와 현재 supervisor의 신원이 일치하지 않습니다.")
        path = profile.workspace / "runs/supervisor/custom.supervisor.json"
        report = read_record(path)
        checked = datetime.fromisoformat(str(report.get("pass_started_at", "")).replace("Z", "+00:00"))
        if checked.tzinfo is None or checked < since or Path(report.get("repo", "")).resolve() != profile.workspace.resolve():
            raise ValueError("현재 설치 경로의 새 supervisor 검증 기록을 기다리고 있습니다.")
        rows = report.get("results")
        if not isinstance(rows, list) or not rows:
            raise ValueError("Supervisor의 서비스별 실행 결과가 없습니다.")
        job = runtime_host.job_name(owner["instance"])
        members = job_process_ids(job)
        if owner["supervisor_pid"] not in members or owner.get("owner_pid") not in members:
            raise ValueError("실행기·supervisor가 같은 Windows Job에 없습니다.")
        processes = process_tree(owner["supervisor_pid"], members)
        remaining = set(job_process_ids(job))
        processes = [p for p in processes if p["pid"] in remaining]
        live = {p["component"] for p in processes}
        seen, failures = set(), []
        for row in rows:
            label = str(row.get("label", "")).split(":", 1)[0]
            seen.add(label)
            state = row.get("status")
            component = COMPONENTS.get(label)
            if ((label == "executor" and state == "retired") or
                    (label == "mission-runtime" and state in ("disabled", "not_configured")) or
                    (label == "a2a-responder" and state == "disabled_by_profile")):
                result["components"].append({"component": label, "status": state})
                continue
            if component:
                good = state in ("started", "already_running", "dispatched") and component in live
                result["components"].append({"component": component, "status": "observed" if good else "missing",
                                             "supervisor_status": state})
                if not good:
                    failures.append(component)
            elif state not in ("ok", "skipped", "retired"):
                failures.append(safe_text(label + ":" + str(state), 100))
        failures.extend(sorted(BASE_LABELS - seen))
        heartbeat = DesktopService(profile=profile).connection()
        result.update(heartbeat_status=heartbeat["status"], heartbeat_age_minutes=heartbeat["heartbeat_age_minutes"])
        stamp = heartbeat.get("last_seen_at")
        last_seen = datetime.fromisoformat(stamp.replace("Z", "+00:00")) if stamp else None
        if (heartbeat.get("transport") != "connected" or heartbeat["heartbeat_age_minutes"] is None
                or heartbeat["heartbeat_age_minutes"] > 2 or not last_seen or last_seen.tzinfo is None
                or last_seen < since or heartbeat["status"] not in ("idle", "running", "running_agent", "online", "ready", "busy")):
            failures.append("runner.heartbeat.list")
        result.update(status="completed" if not failures else "partial", missing=failures,
                      error="" if not failures else "서비스 기동 검증 미완료: " + ", ".join(failures))
    except (Exception, SystemExit) as exc:
        result["error"] = safe_text(str(exc), 400)
    return result


def verify(profile, activation, since, timeout=90):
    deadline = time.monotonic() + timeout
    while True:
        result = observe(profile, activation, since)
        if result["status"] == "completed" or time.monotonic() >= deadline:
            return result
        time.sleep(min(5, max(0, deadline - time.monotonic())))
