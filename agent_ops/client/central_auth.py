"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import json


import re


from datetime import datetime, timezone


from typing import Any, Callable


from urllib.error import HTTPError, URLError


from urllib.request import Request, urlopen


from .capabilities import redact_sensitive


from .config import Profile, store_profile_token, update_profile_central_auth, write_profile_engine_auth


DEFAULT_TIMEOUT_SECONDS = 8.0


CONSOLE_AUTH_PATH = "/orchestration/control/console-auth"


MAX_PULL_SESSION_LIFETIME_SECONDS = 300


class CentralAuthError(RuntimeError):
    pass


def normalize_central_url(value: str) -> str:
    url = str(value or "").strip().rstrip("/")
    if not url:
        return ""
    lowered = url.lower()
    if lowered.endswith("/api/harness"):
        return url
    if "/api/harness/" in lowered:
        return url[: lowered.index("/api/harness/") + len("/api/harness")]
    return f"{url}/api/harness"


def _headers(profile: Profile) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "btk-console-central-auth",
    }
    if profile.runner:
        headers["X-BTK-Runner-Id"] = profile.runner
        headers["X-Runner-Id"] = profile.runner
    if profile.team_id:
        headers["X-Team-Id"] = profile.team_id
    if profile.team_type:
        headers["X-Team-Type"] = profile.team_type
    return headers


def post_json(
    central_url: str,
    path: str,
    payload: dict[str, Any],
    *,
    profile: Profile,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    opener: Callable[..., Any] = urlopen,
    bearer_token: str = "",
) -> dict[str, Any]:
    base_url = normalize_central_url(central_url)
    if not base_url:
        raise CentralAuthError("central URL is not configured")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = _headers(profile)
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = Request(
        base_url + path,
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with opener(request, timeout=max(float(timeout_seconds), 1.0)) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except OSError:
            detail = str(exc)
        raise CentralAuthError(f"central auth HTTP {exc.code}: {redact_sensitive(detail)}") from exc
    except (URLError, OSError) as exc:
        raise CentralAuthError(f"central auth request failed: {exc.__class__.__name__}") from exc
    except json.JSONDecodeError as exc:
        raise CentralAuthError("central auth response was not valid JSON") from exc


def _parse_utc(value: Any) -> datetime | None:
    try:
        stamp = datetime.fromisoformat(str(value or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    return stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)


def validate_pull_session(auth_response: dict[str, Any], profile: Profile, profile_id: str) -> None:
    session_id = str(auth_response.get("session_id") or "")
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,}", session_id):
        raise CentralAuthError("engine-auth pull session id does not meet the entropy requirement")
    issued_at, expires_at = _parse_utc(auth_response.get("issued_at")), _parse_utc(auth_response.get("expires_at"))
    if issued_at is None or expires_at is None:
        raise CentralAuthError("engine-auth pull session is missing a valid lifetime")
    lifetime = (expires_at - issued_at).total_seconds()
    if lifetime <= 0 or lifetime > MAX_PULL_SESSION_LIFETIME_SECONDS:
        raise CentralAuthError("engine-auth pull session lifetime exceeds the client limit")
    binding = auth_response.get("binding") if isinstance(auth_response.get("binding"), dict) else {}
    if str(binding.get("runner_id") or "") != str(profile.runner or ""):
        raise CentralAuthError("engine-auth pull session runner binding does not match")
    if str(binding.get("profile_id") or "") != str(profile_id or ""):
        raise CentralAuthError("engine-auth pull session profile binding does not match")


def _redacted_credential_summary(credential: dict[str, Any]) -> dict[str, Any]:
    env_payload = credential.get("env") if isinstance(credential.get("env"), dict) else {}
    return {
        "engine": str(credential.get("engine") or ""),
        "status": str(credential.get("status") or ""),
        "credential_format": str(credential.get("credential_format") or ""),
        "env_keys": sorted(str(key) for key in env_payload),
        "credential_fingerprint": str(credential.get("credential_fingerprint") or ""),
        "secret_values_exposed": False,
    }


def store_auth_response(
    profile: Profile,
    auth_response: dict[str, Any],
    *,
    central_url: str,
    engine: str,
) -> dict[str, Any]:
    mcp_runtime = auth_response.get("mcp_runtime") if isinstance(auth_response.get("mcp_runtime"), dict) else {}
    token = str(mcp_runtime.get("token") or "")
    token_path = None
    if token:
        token_path = store_profile_token(profile, token)

    profile_payload = auth_response.get("profile") if isinstance(auth_response.get("profile"), dict) else {}
    central_profile_id = str(profile_payload.get("profile_id") or profile.central_profile_id or "")
    update_profile_central_auth(profile, central_url=normalize_central_url(central_url), central_profile_id=central_profile_id)

    engine_auth = auth_response.get("engine_auth") if isinstance(auth_response.get("engine_auth"), dict) else {}
    engine_auth_path = None
    if engine_auth.get("status") == "available":
        engine_auth_path = write_profile_engine_auth(profile, engine, engine_auth)

    return {
        "mcp_token_stored": bool(token_path),
        "mcp_token_path": str(token_path) if token_path else "",
        "central_profile_id": central_profile_id,
        "engine_auth_stored": bool(engine_auth_path),
        "engine_auth_path": str(engine_auth_path) if engine_auth_path else "",
        "engine_auth": _redacted_credential_summary(engine_auth),
        "secret_values_exposed": False,
    }
