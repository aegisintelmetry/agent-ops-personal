"""Allowlisted desktop operations. Credentials and processes stay outside the UI."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import threading
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agent_ops.client.agent_adapter import redact_log_text
from agent_ops.client.agent_chat import ChatTurnController, ClaudeCodeChatBackend, chat_target_from_runner
from agent_ops.client.config import current_profile, profile_token, read_chat_settings, load_config
from agent_ops.client.registry import runner_rows
from agent_ops.client.mcp_endpoint import resolve_mcp_url
from agent_ops.client import mcp_runtime_client as runtime
from agent_ops.desktop.package_info import package_info


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_text(value: Any, limit: int = 6000) -> str:
    return redact_log_text(str(value or "")[:limit])[0]


def read_record(path: Path) -> dict:
    if not path.exists():
        return {}
    if path.stat().st_size > 1024 * 1024:
        raise ValueError("기록이 읽기 제한을 초과했습니다.")
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError("기록 형식이 올바르지 않습니다.")
    return value


def age_minutes(value: str) -> float | None:
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            return None
        return round(max(0, (datetime.now(timezone.utc) - stamp).total_seconds()) / 60, 1)
    except (ValueError, TypeError, AttributeError):
        return None


def safe_popen(command, **kwargs):
    # Keep the existing no-tools backend; also prevent user hooks/MCP/plugin startup.
    command = [*command, "--safe-mode", "--strict-mcp-config", "--mcp-config",
               '{"mcpServers":{}}', "--no-session-persistence", "--no-chrome"]
    kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.Popen(command, **kwargs)


class DesktopService:
    def __init__(self, profile=None, backend=None):
        self.profile_override = profile
        self.backend = backend or ClaudeCodeChatBackend(popen_factory=safe_popen)
        self.lock = threading.Lock()
        self.observation_lock = threading.Lock()
        self.observation_cache = None
        self.turn: tuple[str, ChatTurnController] | None = None
        self.cancelled_ids: dict[str, None] = {}
        from agent_ops.desktop.setup_runtime import SetupManager
        self.setup = SetupManager(self)

    def profile(self):
        if self.profile_override:
            return self.profile_override
        profile = current_profile()
        configured = load_config().get("profiles", {}).get(profile.name, {})
        # CLI's legacy default runner must never register a fresh desktop as PC2.
        if not (os.environ.get("BTK_RUNNER_ID", "").strip() or str(configured.get("runner_id") or "").strip()):
            profile = replace(profile, runner="")
        return profile

    def endpoint(self, profile):
        if not (os.environ.get("BTK_MCP_URL") or os.environ.get("BTK_MCP_RUNTIME_URL")):
            if profile.mcp_url:
                return resolve_mcp_url(profile.mcp_url)
            source = profile.workspace / "harness/runtime/mcp-endpoint.yaml"
            if source.is_file():
                return resolve_mcp_url(str(runtime.load_yaml(source).get("mcp_url") or ""))
        return resolve_mcp_url()

    def runtime_identity(self, profile):
        # Registration stays in the configured workspace, not a stale copy in the installer.
        row = next((r for r in runner_rows(profile, limit=500) if profile.runner in
                    (r.get("runner_id"), r.get("runner"))), None)
        if not row or not row.get("runner_file"):
            raise ValueError("현재 프로파일의 러너 레지스트리를 찾지 못했습니다.")
        path = (profile.workspace / row["runner_file"]).resolve()
        if path.parent != (profile.workspace / "harness/runners").resolve():
            raise ValueError("러너 레지스트리 경로가 올바르지 않습니다.")
        data = runtime.load_yaml(path)
        fields = runtime.runner_profile_fields(data)
        return {"runner_id": str(data.get("runner_id") or path.stem),
                "team_id": str(data.get("team_id") or ""), "team_type": str(data.get("team_type") or ""),
                "runner_file": row["runner_file"], **fields,
                "ready_capabilities": runtime.ready_capabilities_seed(fields["capabilities"]),
                "mcp_headers": data.get("mcp_headers", {}) if isinstance(data.get("mcp_headers"), dict) else {}}

    def target(self):
        profile = self.profile()
        row = next((item for item in runner_rows(profile, limit=500)
                    if item.get("runner_id") == profile.runner or item.get("runner") == profile.runner), None)
        settings = read_chat_settings()
        if not row:
            row = {"runner_id": profile.runner, "runner": profile.runner,
                   "team_id": profile.team_id, "engine": "unknown"}
        target = chat_target_from_runner(row)
        engine = settings.get("engine", target.engine)
        engine = "claude_code" if engine == "claude" else engine
        return replace(target, engine=engine, command="claude" if engine == "claude_code" else engine,
                       model_alias=settings.get("model", target.model_alias),
                       effort=settings.get("effort", target.effort))

    def task_path(self, task_id: str) -> Path:
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}", task_id):
            raise ValueError("올바른 task_id가 필요합니다.")
        root = (self.profile().workspace / "runs").resolve()
        folder = root / task_id
        if folder.resolve().parent != root or folder.is_symlink():
            raise ValueError("실행 기록 경로가 허용 범위를 벗어났습니다.")
        return folder

    def task(self, task_id: str) -> dict:
        folder = self.task_path(task_id)
        status_file = folder / "status.json"
        if status_file.resolve().parent != folder.resolve():
            raise ValueError("외부 기록 링크는 읽지 않습니다.")
        status = read_record(status_file)
        if not status:
            raise ValueError("이 PC에 status.json 기록이 없습니다.")
        artifacts = []
        for name in ("result.md", "test_result.json", "changed_files.json", "auto_consume_status.json"):
            path = folder / name
            if path.is_file() and path.resolve().parent == folder.resolve():
                with path.open("rb") as handle:
                    content = handle.read(12001)
                artifacts.append({"name": name, "content": safe_text(content[:12000].decode("utf-8-sig", errors="replace"), 12000),
                                  "truncated": len(content) > 12000})
        return {**self.task_row(folder, status), "artifacts": artifacts}

    def task_row(self, folder: Path, status: dict) -> dict:
        return {"task_id": folder.name, "status": safe_text(status.get("status") or "unknown", 80),
                "runner_id": safe_text(status.get("runner_id") or status.get("runner") or "", 160),
                "reason": safe_text(status.get("reason")), "next_action": safe_text(status.get("next_action")),
                "updated_at": safe_text(status.get("updated_at") or status.get("finished_at") or "", 80),
                "authority": f"runs/{folder.name}/status.json", "observed_at": now()}

    def snapshot(self) -> dict:
        profile = self.profile()
        tasks, warnings = [], []
        runs = profile.workspace / "runs"
        paths = sorted(runs.glob("*/status.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:60]
        for path in paths:
            try:
                folder = self.task_path(path.parent.name)
                if path.resolve().parent != folder.resolve():
                    raise ValueError("외부 기록 링크")
                tasks.append(self.task_row(folder, read_record(path)))
            except (ValueError, OSError) as exc:
                warnings.append({"task_id": path.parent.name, "error": safe_text(str(exc), 180)})
        target = self.target()
        installed = bool(shutil.which("claude")) if target.engine == "claude_code" else False
        supported = target.engine == "claude_code"
        registered = bool(profile.runner)
        return {"observed_at": now(), "host": platform.node(), "version": package_info()["version"],
                "registration_required": not registered,
                "profile": {"name": profile.name, "runner": profile.runner, "team_id": profile.team_id,
                            "central_url": profile.central_url, "central_profile_id": profile.central_profile_id,
                            "workspace": str(profile.workspace), "credential_configured": profile.token_configured},
                "model": {"engine": target.engine, "model": target.model_alias, "effort": target.effort,
                          "source": "CLI 프로파일 / chat-settings.json"},
                "chat": {"available": registered and supported and installed,
                         "reason": "중앙에서 발급된 프로파일 등록이 필요합니다." if not registered else "" if supported and installed else (
                             "선택된 엔진의 읽기 전용 데스크톱 어댑터가 아직 연결되지 않았습니다." if not supported
                             else "Claude CLI가 설치되어 있지 않습니다."), "mode": "tools_disabled"},
                "tasks": tasks, "warnings": warnings, "scope": "local_run_records"}

    def connection(self) -> dict:
        profile = self.profile()
        base = {"authority": "runner.heartbeat.list", "observed_at": now(), "runner": profile.runner,
                "heartbeat_age_minutes": None, "status": "unknown", "transport": "unknown"}
        if not profile.runner:
            return {**base, "transport": "unconfigured", "error": "프로파일 등록 전에는 중앙 조회를 보내지 않습니다."}
        try:
            endpoint = self.endpoint(profile)
            identity = self.runtime_identity(profile)
            result = runtime.call_runtime(mcp_url=endpoint, token=profile_token(profile),
                operation="runner.heartbeat.list", identity=identity,
                payload={"limit": 200}, task_id="", question_id="", timeout_seconds=4, dry_run=False)
            if runtime.response_failed(result):
                return {**base, "transport": "error", "error": f"runner.heartbeat.list: HTTP {runtime.http_status(result)}"}
            body = runtime.response_body(result)
            rows = body.get("heartbeats", body.get("runners", []))
            if not isinstance(rows, list):
                raise ValueError("runner.heartbeat.list 응답 목록 형식이 올바르지 않습니다.")
            names = {profile.runner, identity.get("runner_id") or profile.runner}
            row = next((r for r in rows if isinstance(r, dict) and
                        names.intersection((r.get("runner_id"), r.get("runner"), r.get("runner_key")))), None)
            if not row:
                return {**base, "transport": "connected", "error": "중앙 heartbeat 목록에서 현재 러너를 찾지 못했습니다."}
            stamp = row.get("last_seen_at") or row.get("updated_at") or row.get("timestamp") or ""
            return {**base, "transport": "connected", "status": safe_text(row.get("status") or "unknown", 80),
                    "heartbeat_age_minutes": age_minutes(stamp), "last_seen_at": stamp}
        except (Exception, SystemExit) as exc:
            return {**base, "transport": "error", "error": safe_text(str(exc), 350)}

    def begin_chat(self, params: dict, emit):
        turn_id, message, history = params.get("turn_id"), params.get("message"), params.get("history", [])
        if not isinstance(turn_id, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", turn_id):
            raise ValueError("대화 요청 ID가 올바르지 않습니다.")
        if not isinstance(message, str) or not message.strip() or len(message) > 5000:
            raise ValueError("메시지는 1~5000자여야 합니다.")
        if not isinstance(history, list) or len(history) > 12 or any(
            not isinstance(row, dict) or row.get("role") not in ("user", "assistant") or
            not isinstance(row.get("content"), str) or len(row["content"]) > 12000 for row in history):
            raise ValueError("대화 기록 형식이 올바르지 않습니다.")
        snapshot = self.snapshot()
        if not snapshot["chat"]["available"]:
            raise ValueError(snapshot["chat"]["reason"])
        target = self.target()
        with self.lock:
            # IPC workers may receive cancel before this request finishes collecting context.
            if turn_id in self.cancelled_ids:
                self.cancelled_ids.pop(turn_id)
                emit({"turn_id": turn_id, "status": "cancelled", "text": "답변 생성을 중단했습니다."})
                emit({"turn_id": turn_id, "status": "finished", "outcome": "cancelled"})
                return {"turn_id": turn_id, "accepted": False, "cancelled": True}
            if self.turn:
                raise ValueError("이미 답변을 생성하고 있습니다.")
            controller = ChatTurnController()
            self.turn = (turn_id, controller)

        def worker():
            text, terminal = "", "completed"
            try:
                context = {"profile": snapshot["profile"], "tasks": snapshot["tasks"][:10],
                           "scope": "이 PC의 실행 기록입니다. 중앙 실시간 상태는 확인하지 않았습니다."}
                for event in self.backend.stream_reply(target=target, message=message, history=history,
                        context=context, cancel_token=controller):
                    state = event.get("status")
                    if state == "streaming":
                        text += event.get("chunk", "")
                        # Keep partial tokens private until the complete response can be redacted.
                        if len(text) > 24000:
                            raise ValueError("답변 길이 제한을 초과했습니다.")
                    elif state == "thinking":
                        emit({"turn_id": turn_id, "status": "thinking", "elapsed_seconds": event.get("elapsed_seconds", 0)})
                    elif state in ("cancelled", "backend_unavailable"):
                        terminal = state
                        emit({"turn_id": turn_id, "status": state, "text": safe_text(event.get("chunk"))})
                if controller.is_cancelled:
                    terminal = "cancelled"
                elif not text.strip() and terminal == "completed":
                    terminal = "backend_unavailable"
                    emit({"turn_id": turn_id, "status": terminal, "text": "엔진에서 답변을 받지 못했습니다."})
                if terminal == "completed":
                    emit({"turn_id": turn_id, "status": "completed", "text": safe_text(text, 12000)})
            except Exception as exc:
                terminal = "backend_unavailable"
                controller.cancel()
                emit({"turn_id": turn_id, "status": terminal, "text": safe_text(str(exc), 400)})
            finally:
                with self.lock:
                    self.turn = None
                emit({"turn_id": turn_id, "status": "finished", "outcome": terminal})

        threading.Thread(target=worker, daemon=True).start()
        return {"turn_id": turn_id, "accepted": True}

    def cancel(self, turn_id=None):
        if turn_id is not None and (not isinstance(turn_id, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", turn_id)):
            raise ValueError("중단할 대화 요청 ID가 올바르지 않습니다.")
        with self.lock:
            turn = self.turn
            if turn_id and (not turn or turn[0] != turn_id):
                self.cancelled_ids[turn_id] = None
                if len(self.cancelled_ids) > 64:
                    self.cancelled_ids.pop(next(iter(self.cancelled_ids)))
        if turn and (turn_id is None or turn[0] == turn_id):
            turn[1].cancel()
            return {"cancelled": True}
        return {"cancelled": False}

    def dispatch(self, method: str, params: dict, emit=lambda _: None):
        if not isinstance(params, dict):
            raise ValueError("요청 형식이 올바르지 않습니다.")
        if method == "snapshot":
            return self.snapshot()
        if method == "readiness":
            from agent_ops.desktop.readiness import readiness
            return readiness(self)
        if method == "setup_status":
            return self.setup.status()
        if method == "setup_enroll":
            return self.setup.enroll(params)
        if method == "setup_install":
            return self.setup.start(params)
        if method in ("agent_status", "agent_start"):
            if params:
                raise ValueError("실행기에 추가 명령이나 경로를 전달할 수 없습니다.")
            from agent_ops.desktop.runtime_host import status, start
            if method == "agent_start" and self.setup.status()["status"] == "running":
                raise ValueError("설치 완료 후 시작할 수 있습니다.")
            return (status if method == "agent_status" else start)(self.profile())
        if method == "connection":
            return self.connection()
        if method == "task":
            return self.task(params.get("task_id"))
        if method == "chat":
            return self.begin_chat(params, emit)
        if method == "cancel":
            return self.cancel(params.get("turn_id"))
        raise ValueError("허용되지 않은 데스크톱 작업입니다.")
