"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import json


import os


import queue


import shutil


import subprocess


import tempfile


import threading


import time


from dataclasses import asdict, dataclass


from pathlib import Path


from typing import Any, Iterator


from .capabilities import redact_sensitive


from .write_safety import clean_text, command_display


DEFAULT_DIRECT_CHAT_RUNNER = ""


DEFAULT_DIRECT_CHAT_AGENT = "agent"


DEFAULT_DIRECT_CHAT_ENGINE = "claude_code"


DEFAULT_CLAUDE_CODE_MODEL_ALIAS = "opus"


DEFAULT_CLAUDE_CODE_MODEL_LABEL = "Claude Opus"


DEFAULT_CLAUDE_CODE_EFFORT = "high"


CLAUDE_CODE_CHAT_SAFE_FLAGS = (
    "--disable-slash-commands",
    "--tools",
    "",
    "--disallowedTools",
    "mcp__*",
)


CHAT_HISTORY_LIMIT = 12


CHAT_QUERY = (
    "Answer as a read-only BTK harness assistant using the fleet context and "
    "conversation history supplied in the prompt. Do not perform writes or use tools."
)


CHAT_THINKING_INTERVAL_SECONDS = 1.0


DEFAULT_CHAT_TIMEOUT_SECONDS = 60.0


DEFAULT_CHAT_IDLE_TIMEOUT_SECONDS = 45.0


@dataclass(frozen=True)
class ChatTarget:
    """Resolved direct-chat target runner and engine metadata."""

    runner: str
    runner_id: str
    agent: str
    engine: str
    command: str
    model_alias: str = ""
    model_label: str = ""
    effort: str = ""
    team_id: str = ""
    team_type: str = ""

    def as_dict(self) -> dict[str, Any]:
        return redact_sensitive(asdict(self))


def _env_value(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def normalize_claude_code_effort(value: str) -> str:
    normalized = str(value or "").strip().lower().replace("_", "-").replace(" ", "-")
    aliases = {
        "": DEFAULT_CLAUDE_CODE_EFFORT,
        "none": DEFAULT_CLAUDE_CODE_EFFORT,
        "low": "low",
        "medium": "medium",
        "high": "high",
        "xhigh": "xhigh",
        "x-high": "xhigh",
        "extra": "xhigh",
        "extra-high": "xhigh",
        "extra-highest": "xhigh",
        "max": "max",
    }
    return aliases.get(normalized, normalized)


def _qa_like(row: dict[str, Any]) -> bool:
    return str(row.get("team_type") or "").strip().lower() == "qa"


def chat_target_from_runner(row: dict[str, Any] | None) -> ChatTarget:
    """Resolve visible runner metadata into a direct-chat target."""

    row = row or {}
    runner = str(row.get("runner_key") or row.get("runner") or row.get("runner_id") or DEFAULT_DIRECT_CHAT_RUNNER).strip()
    runner_id = str(row.get("runner_id") or runner).strip()
    team_id = str(row.get("team_id") or "").strip()
    team_type = str(row.get("team_type") or "").strip()
    agent = str(row.get("chat_agent") or row.get("default_target_agent") or "").strip()
    if not agent and _qa_like(row):
        agent = DEFAULT_DIRECT_CHAT_AGENT
    if not agent:
        agent = str(row.get("target_agent") or "agent").strip()

    engine = str(row.get("executor_engine") or row.get("engine") or "").strip()
    if not engine and _qa_like(row):
        engine = DEFAULT_DIRECT_CHAT_ENGINE
    if not engine:
        engine = "codex"

    command = str(row.get("executor_command") or "").strip()
    if engine == DEFAULT_DIRECT_CHAT_ENGINE:
        command = _env_value("BTK_CLAUDE_CODE_COMMAND", "CLAUDE_CODE_COMMAND") or command or "claude"
        model_alias = (
            _env_value("BTK_CLAUDE_CODE_MODEL", "BTK_CLAUDE_CODE_MODEL_ALIAS", "BTK_EXECUTOR_MODEL_ALIAS")
            or str(row.get("executor_model_alias") or "").strip()
            or DEFAULT_CLAUDE_CODE_MODEL_ALIAS
        )
        model_label = (
            _env_value("BTK_CLAUDE_CODE_MODEL_LABEL", "BTK_EXECUTOR_MODEL_LABEL")
            or str(row.get("executor_model_label") or "").strip()
            or DEFAULT_CLAUDE_CODE_MODEL_LABEL
        )
        effort = normalize_claude_code_effort(
            _env_value("BTK_CLAUDE_CODE_EFFORT", "BTK_EXECUTOR_REASONING_EFFORT")
            or str(row.get("executor_effort") or "").strip()
            or DEFAULT_CLAUDE_CODE_EFFORT
        )
    else:
        command = command or str(row.get("codex_command") or row.get("openh_command") or engine).split(" ", 1)[0]
        model_alias = str(row.get("executor_model_alias") or "").strip()
        model_label = str(row.get("executor_model_label") or "").strip()
        effort = str(row.get("executor_effort") or "").strip()

    return ChatTarget(
        runner=runner,
        runner_id=runner_id,
        agent=agent,
        engine=engine,
        command=command,
        model_alias=model_alias,
        model_label=model_label,
        effort=effort,
        team_id=team_id,
        team_type=team_type,
    )


class ChatTurnController:
    """Cancellation handle for one direct-chat subprocess turn."""

    def __init__(self) -> None:
        self._cancelled = threading.Event()
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None
        self.cancel_reason = ""

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled.is_set()

    def attach_process(self, process: subprocess.Popen[str]) -> None:
        with self._lock:
            self._process = process
            should_cancel = self._cancelled.is_set()
        if should_cancel:
            _terminate_process(process)

    def cancel(self, reason: str = "operator_cancelled") -> bool:
        self.cancel_reason = reason
        self._cancelled.set()
        with self._lock:
            process = self._process
        if process is not None:
            _terminate_process(process)
            return True
        return False


def direct_chat_cwd() -> Path:
    """Return a neutral cwd so chat does not load the harness repo context."""

    configured = _env_value("BTK_DIRECT_CHAT_CWD", "CLAUDE_DIRECT_CHAT_CWD")
    cwd = Path(configured) if configured else Path(tempfile.gettempdir()) / "btk-direct-agent-chat"
    cwd.mkdir(parents=True, exist_ok=True)
    return cwd


def build_claude_code_chat_command(target: ChatTarget, *, prompt: str | None = None) -> list[str]:
    """Build the Claude Code CLI command used for a direct chat turn."""

    command = [target.command or "claude", "-p", prompt if prompt is not None else CHAT_QUERY]
    if target.model_alias:
        command += ["--model", target.model_alias]
    if target.effort:
        command += ["--effort", target.effort]
    command += list(CLAUDE_CODE_CHAT_SAFE_FLAGS)
    return command


def chat_invocation_evidence(target: ChatTarget) -> dict[str, Any]:
    """Describe how direct chat reaches the selected agent engine."""

    if target.engine == DEFAULT_DIRECT_CHAT_ENGINE:
        command = build_claude_code_chat_command(target)
        return redact_sensitive(
            {
                "engine": target.engine,
                "runner": target.runner,
                "agent": target.agent,
                "executor_path_reused": "harness/orchestrator/run_agent_executor_loop.py::claude_code_command",
                "path_summary": (
                    "Direct chat uses the same subscription CLI family as the executor: "
                    "claude -p <query> --model <alias> --effort <effort> "
                    "--disable-slash-commands --tools \"\" --disallowedTools mcp__*, "
                    "with the redacted prompt supplied as the -p argument. Built-in tools are disabled, "
                    "MCP tools are denied, and no Anthropic API client or API key path is used."
                ),
                "command_display": command_display(command),
                "prompt_delivery": "redacted_composed_prompt_as_p_argument",
                "stdin_prompt": False,
                "neutral_cwd": True,
                "tools_enabled": False,
                "mcp_tools_enabled": False,
                "permission_bypass_enabled": False,
                "timeout_seconds": DEFAULT_CHAT_TIMEOUT_SECONDS,
                "anthropic_api_used": False,
                "secret_values_exposed": False,
            }
        )
    return redact_sensitive(
        {
            "engine": target.engine,
            "runner": target.runner,
            "agent": target.agent,
            "executor_path_reused": "harness/orchestrator/run_agent_executor_loop.py::executor_command",
            "path_summary": "Target is selectable, but direct subprocess chat is currently enabled for claude_code targets.",
            "anthropic_api_used": False,
            "secret_values_exposed": False,
        }
    )


def build_chat_prompt(
    target: ChatTarget,
    message: str,
    *,
    history: list[dict[str, str]],
    context: dict[str, Any],
) -> str:
    """Build the stdin prompt sent to the agent CLI."""

    safe_history = [
        {
            "role": str(item.get("role") or ""),
            "content": clean_text(str(item.get("content") or ""), limit=3000),
        }
        for item in history[-CHAT_HISTORY_LIMIT:]
    ]
    payload = {
        "instructions": [
            "You are the selected BTK harness agent in a direct console chat.",
            "Use the read-only fleet context to answer concretely.",
            "Do not create tasks, answer questions, apply policy, run commands, deploy, push git, or read secrets.",
            "If the operator needs a write/action, say it must go through the console approval flow.",
        ],
        "target": target.as_dict(),
        "read_only_context": context,
        "conversation_history": safe_history,
        "latest_user_message": clean_text(message, limit=5000),
    }
    return json.dumps(redact_sensitive(payload), ensure_ascii=False, indent=2, sort_keys=True)


def _stream_pipe(
    pipe: Any,
    name: str,
    output: "queue.Queue[tuple[str, str]]",
) -> None:
    try:
        while True:
            chunk = pipe.read(1)
            if not chunk:
                break
            output.put((name, chunk))
    except (OSError, ValueError):
        return


def _terminate_process(process: subprocess.Popen[str]) -> None:
    try:
        if process.poll() is not None:
            return
        process.terminate()
    except OSError:
        return
    try:
        process.wait(timeout=3)
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()
        except OSError:
            return


class ClaudeCodeChatBackend:
    """Mockable direct-chat backend that uses the Claude Code CLI path."""

    def __init__(
        self,
        *,
        timeout_seconds: float = DEFAULT_CHAT_TIMEOUT_SECONDS,
        idle_timeout_seconds: float = DEFAULT_CHAT_IDLE_TIMEOUT_SECONDS,
        thinking_interval_seconds: float = CHAT_THINKING_INTERVAL_SECONDS,
        cwd: Path | str | None = None,
        popen_factory: Any | None = None,
    ) -> None:
        self.timeout_seconds = max(float(timeout_seconds), 1.0)
        self.idle_timeout_seconds = max(float(idle_timeout_seconds), 1.0)
        self.thinking_interval_seconds = max(float(thinking_interval_seconds), 0.2)
        self.cwd = Path(cwd) if cwd is not None else None
        self.popen_factory = popen_factory or subprocess.Popen

    def stream_reply(
        self,
        *,
        target: ChatTarget,
        message: str,
        history: list[dict[str, str]],
        context: dict[str, Any],
        cancel_token: ChatTurnController | None = None,
    ) -> Iterator[dict[str, Any]]:
        evidence = chat_invocation_evidence(target)
        if target.engine != DEFAULT_DIRECT_CHAT_ENGINE:
            text = (
                f"Direct chat target {target.runner} uses engine {target.engine}. "
                "This adapter requires an explicitly configured claude_code target."
            )
            yield {
                "status": "backend_unavailable",
                "chunk": text,
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return

        prompt = build_chat_prompt(target, message, history=history, context=context)
        command = build_claude_code_chat_command(target, prompt=prompt)
        evidence["command_display"] = command_display(build_claude_code_chat_command(target))
        command_name = command[0]
        if shutil.which(command_name) is None:
            text = f"Direct chat backend unavailable: {command_name} command was not found on PATH."
            yield {
                "status": "backend_unavailable",
                "chunk": text,
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return

        if cancel_token is not None and cancel_token.is_cancelled:
            yield {
                "status": "cancelled",
                "chunk": "Direct chat turn cancelled before launch.",
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return

        cwd = self.cwd or direct_chat_cwd()
        started_at = time.monotonic()
        process: subprocess.Popen[str] | None = None
        try:
            process = self.popen_factory(
                command,
                cwd=str(cwd),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            if cancel_token is not None:
                cancel_token.attach_process(process)
        except OSError as exc:
            yield {
                "status": "backend_unavailable",
                "chunk": f"Direct chat backend failed to start: {exc.__class__.__name__}.",
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return

        if process is None:
            return

        output: "queue.Queue[tuple[str, str]]" = queue.Queue()
        stdout_thread = threading.Thread(target=_stream_pipe, args=(process.stdout, "stdout", output), daemon=True)
        stderr_thread = threading.Thread(target=_stream_pipe, args=(process.stderr, "stderr", output), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        yield {
            "status": "thinking",
            "chunk": "thinking... (0s elapsed)",
            "invocation": evidence,
            "elapsed_seconds": 0,
            "secret_values_exposed": False,
        }

        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        first_stdout = False
        last_thinking_at = started_at
        last_output_at = started_at
        timed_out = False
        idled_out = False

        while True:
            if cancel_token is not None and cancel_token.is_cancelled:
                _terminate_process(process)
                yield {
                    "status": "cancelled",
                    "chunk": "Direct chat turn cancelled.",
                    "invocation": evidence,
                    "fallback_used": True,
                    "secret_values_exposed": False,
                }
                return

            now = time.monotonic()
            if now - started_at > self.timeout_seconds:
                timed_out = True
                _terminate_process(process)
                break
            # No-output watchdog: the process is alive but has produced nothing for too long. This
            # is the "frozen screen" case -- stop it here with a clear reason instead of waiting out
            # the whole hard timeout in silence.
            if now - last_output_at > self.idle_timeout_seconds:
                idled_out = True
                _terminate_process(process)
                break

            try:
                stream_name, chunk = output.get(timeout=0.1)
            except queue.Empty:
                if process.poll() is not None and output.empty():
                    break
                # Keep the heartbeat alive during output GAPS too, not only before the first token.
                # Once the agent streamed a sentence and then paused to run a command, first_stdout
                # was True and this used to go silent -- the exact dead-looking freeze users saw.
                if now - last_thinking_at >= self.thinking_interval_seconds:
                    elapsed = int(now - started_at)
                    quiet = int(now - last_output_at)
                    last_thinking_at = now
                    label = (
                        f"working... ({elapsed}s, quiet {quiet}s)" if first_stdout
                        else f"thinking... ({elapsed}s elapsed)"
                    )
                    yield {
                        "status": "thinking",
                        "chunk": label,
                        "invocation": evidence,
                        "elapsed_seconds": elapsed,
                        "secret_values_exposed": False,
                    }
                continue

            # Any byte from the child -- stdout or stderr -- proves it is still alive and resets the
            # idle watchdog, so a chatty-on-stderr or steadily-streaming turn is never cut short.
            last_output_at = now
            if stream_name == "stdout":
                first_stdout = True
                safe_chunk = clean_text(chunk, limit=1000)
                if safe_chunk:
                    stdout_parts.append(safe_chunk)
                    yield {
                        "status": "streaming",
                        "chunk": safe_chunk,
                        "invocation": evidence,
                        "secret_values_exposed": False,
                    }
            elif stream_name == "stderr":
                stderr_parts.append(clean_text(chunk, limit=1000))

        stdout_thread.join(timeout=1)
        stderr_thread.join(timeout=1)
        while not output.empty():
            stream_name, chunk = output.get_nowait()
            if stream_name == "stdout":
                safe_chunk = clean_text(chunk, limit=1000)
                if safe_chunk:
                    stdout_parts.append(safe_chunk)
                    yield {
                        "status": "streaming",
                        "chunk": safe_chunk,
                        "invocation": evidence,
                        "secret_values_exposed": False,
                    }
            elif stream_name == "stderr":
                stderr_parts.append(clean_text(chunk, limit=1000))

        stderr = clean_text("".join(stderr_parts).strip(), limit=2000)
        stdout = clean_text("".join(stdout_parts).strip(), limit=12000)
        if idled_out:
            text = (
                f"Direct chat backend went quiet for {self.idle_timeout_seconds:.0f}s "
                "(a command likely hung) and was stopped. Try again or narrow the request."
            )
            if stdout:
                text = f"{text}\n\nPartial response before it stalled:\n{stdout}"
            elif stderr:
                text = f"{text} {stderr}"
            yield {
                "status": "backend_unavailable",
                "chunk": clean_text(text, limit=2400),
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return
        if timed_out:
            text = f"Direct chat backend timed out after {self.timeout_seconds:.0f}s."
            if stderr:
                text = f"{text} {stderr}"
            yield {
                "status": "backend_unavailable",
                "chunk": clean_text(text, limit=2400),
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return

        return_code = process.returncode
        if return_code is None:
            return_code = process.poll()
        if return_code not in (0, None):
            text = f"Direct chat backend exited {return_code}."
            if stderr:
                text = f"{text} {stderr}"
            yield {
                "status": "backend_unavailable",
                "chunk": clean_text(text, limit=2000),
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return
        if not stdout:
            yield {
                "status": "backend_unavailable",
                "chunk": "Direct chat backend returned no response.",
                "invocation": evidence,
                "fallback_used": True,
                "secret_values_exposed": False,
            }
            return
