"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import json


import os


import tempfile


from datetime import datetime, timezone


from pathlib import Path


from typing import Any


from .config import CONFIG_HOME, _restrict_directory


SESSION_PATH = CONFIG_HOME / "auth-session.json"


MODE_OFF = "off"


MODE_OBSERVE = "observe"


MODE_ENFORCE = "enforce"


_OFF_WORDS = {"", "0", "off", "false", "no", "none"}


_OBSERVE_WORDS = {"observe", "warn", "shadow", "monitor"}


_ENFORCE_WORDS = {"1", "true", "on", "yes", "enforce", "block"}


def _normalize_engine(value: str) -> str:
    engine = str(value or "").strip().lower()
    return "claude" if engine == "claude_code" else engine


def _load() -> dict[str, Any]:
    try:
        if SESSION_PATH.is_file():
            raw = json.loads(SESSION_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                return raw
    except (OSError, ValueError):
        pass
    return {}


def _save(data: dict[str, Any]) -> None:
    _restrict_directory(CONFIG_HOME)
    text = json.dumps(data, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=CONFIG_HOME, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(text)
    temp_path.replace(SESSION_PATH)


def _coerce_mode(value: str) -> str | None:
    word = str(value or "").strip().lower()
    if word in _OFF_WORDS:
        return MODE_OFF
    if word in _OBSERVE_WORDS:
        return MODE_OBSERVE
    if word in _ENFORCE_WORDS:
        return MODE_ENFORCE
    return None


def enforcement_mode() -> str:
    """off | observe | enforce. Env BTK_AUTH_ENFORCE overrides the deployed file; default off.

    Legacy: a bare `"enforce": true` in the file maps to enforce, `false`/absent to off. Even so, the
    chat path treats enforce as observe in this build -- see the module docstring."""
    env_mode = _coerce_mode(os.environ.get("BTK_AUTH_ENFORCE", ""))
    if env_mode is not None and os.environ.get("BTK_AUTH_ENFORCE", "").strip():
        return env_mode
    data = _load()
    file_mode = _coerce_mode(str(data.get("mode") or ""))
    if file_mode is not None and str(data.get("mode") or "").strip():
        return file_mode
    return MODE_ENFORCE if data.get("enforce") else MODE_OFF


def _is_expired(expires_at: str) -> bool:
    """True only when we can parse the timestamp AND it is in the past. Unparseable -> not expired,
    so a malformed expiry never trips the check."""
    text = str(expires_at or "").strip()
    if not text:
        return False
    try:
        stamp = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp < datetime.now(timezone.utc)


def record_session(
    engine: str,
    *,
    fingerprint: str = "",
    expires_at: str = "",
    mode: str = "",
    account_label: str = "",
    session_id: str = "",
) -> None:
    """Remember the central-issued session for an engine. Non-secret fields only. Additive: called
    after a successful `btk auth login`, changes nothing about the login itself.

    `mode` here is the credential FORMAT (api_key / oauth), not the enforcement mode."""
    engine_key = _normalize_engine(engine)
    if not engine_key:
        return
    data = _load()
    engines = data.get("engines") if isinstance(data.get("engines"), dict) else {}
    engines[engine_key] = {
        "fingerprint": str(fingerprint or ""),
        "expires_at": str(expires_at or ""),
        "credential_format": str(mode or ""),
        "account_label": str(account_label or ""),
        "source": "central",
    }
    data["engines"] = engines
    _save(data)


def read_sessions() -> dict[str, Any]:
    """The full record for `btk auth session status`. Non-secret."""
    data = _load()
    engines = data.get("engines") if isinstance(data.get("engines"), dict) else {}
    return {
        "mode": enforcement_mode(),
        "engines": {
            key: {
                "fingerprint": str(value.get("fingerprint") or ""),
                "expires_at": str(value.get("expires_at") or ""),
                "expired": _is_expired(value.get("expires_at", "")),
                "credential_format": str(value.get("credential_format") or ""),
                "account_label": str(value.get("account_label") or ""),
                "source": str(value.get("source") or ""),
            }
            for key, value in engines.items()
            if isinstance(value, dict)
        },
    }
