"""Validation and compatibility defaults for optional runner profile fields.

These fields describe a runner's requested engine/model, credential reference,
API/limit policy, and capability tokens.  They are deliberately separate from
the existing ``executor_*`` fields: this schema is a shadow/configuration layer
and must not switch a live runner by itself.
"""
from __future__ import annotations

import math
from typing import Any


PROFILE_SCALAR_FIELDS = (
    "engine", "model", "thinking", "credential_ref", "executor_cli", "executor_cli_dialect",
    "memory_api_url",
)
PROFILE_LIST_FIELDS = ("allowed_apis",)
DEFAULT_MEMORY_EXPIRY_DAYS = 30
LIMIT_FIELDS = frozenset({"cost_usd_per_call", "rate_per_min"})
ALLOWED_ENGINES = frozenset({"codex", "claude"})
# Two pre-extension daemon/responder records already use a top-level ``engine`` key with
# a different operational meaning. They must keep round-tripping unchanged, but they are
# not projected as the new generic profile engine.
LEGACY_ENGINE_VALUES = frozenset({"claude_code", "anthropic-api"})


def empty_runner_profile() -> dict[str, Any]:
    """Return fresh backward-compatible defaults for a legacy runner record."""
    return {
        "engine": None,
        "model": None,
        "thinking": None,
        "credential_ref": None,
        "executor_cli": None,
        "executor_cli_dialect": None,
        "memory_api_url": None,
        "memory_expiry_days": DEFAULT_MEMORY_EXPIRY_DAYS,
        "allowed_apis": [],
        "limits": {},
        "capabilities": [],
    }


def _optional_string(value: Any, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string or null")
    if value != value.strip():
        raise ValueError(f"{field} must not have surrounding whitespace")
    return value


def _string_list(value: Any, field: str) -> list[str]:
    # ``[]`` is retained for compatibility with old fallback-parser output.
    if value is None or value == "[]":
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list of strings")

    normalized: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            raise ValueError(f"{field}[{index}] must be a non-empty string")
        if item != item.strip():
            raise ValueError(f"{field}[{index}] must not have surrounding whitespace")
        if item in seen:
            raise ValueError(f"{field} contains duplicate value: {item}")
        seen.add(item)
        normalized.append(item)
    return normalized


def _memory_expiry_days(value: Any) -> int:
    if value is None:
        return DEFAULT_MEMORY_EXPIRY_DAYS
    # bool is an int subclass, but is not a meaningful expiry duration.
    if type(value) is not int or value < 0:
        raise ValueError("memory_expiry_days must be a non-negative integer")
    return value


def _limits(value: Any) -> dict[str, int | float]:
    # ``{}`` is retained for compatibility with old fallback-parser output.
    if value is None or value == "{}":
        return {}
    if not isinstance(value, dict):
        raise ValueError("limits must be an object")

    unknown = sorted(str(key) for key in value if key not in LIMIT_FIELDS)
    if unknown:
        raise ValueError(f"limits contains unsupported fields: {', '.join(unknown)}")

    normalized: dict[str, int | float] = {}
    for key in ("cost_usd_per_call", "rate_per_min"):
        if key not in value or value[key] is None:
            continue
        number = value[key]
        # bool is an int subclass but is not a meaningful numeric limit.
        if type(number) not in (int, float) or not math.isfinite(number) or number < 0:
            raise ValueError(f"limits.{key} must be a non-negative number")
        normalized[key] = number
    return normalized


def normalize_runner_profile(record: dict[str, Any]) -> dict[str, Any]:
    """Validate one record and return its complete optional profile projection.

    The source ``record`` is never mutated.  Callers keep the original record in
    ProfileDB's ``data`` column so missing fields remain missing on YAML export.
    """
    if not isinstance(record, dict):
        raise ValueError("runner profile must be an object")

    profile = empty_runner_profile()
    for field in PROFILE_SCALAR_FIELDS:
        profile[field] = _optional_string(record.get(field), field)

    if profile["engine"] in LEGACY_ENGINE_VALUES:
        profile["engine"] = None
    elif profile["engine"] is not None and profile["engine"] not in ALLOWED_ENGINES:
        raise ValueError("engine must be one of: codex, claude")
    if profile["credential_ref"] is not None:
        ref = profile["credential_ref"]
        if not ref.startswith("vault://") or len(ref) <= len("vault://"):
            raise ValueError("credential_ref must be a vault:// reference, never a credential value")

    profile["memory_expiry_days"] = _memory_expiry_days(record.get("memory_expiry_days"))

    profile["allowed_apis"] = _string_list(record.get("allowed_apis"), "allowed_apis")
    profile["limits"] = _limits(record.get("limits"))
    raw_capabilities = record.get("capabilities")
    if isinstance(raw_capabilities, dict):
        if not all(isinstance(key, str) and isinstance(value, bool)
                   for key, value in raw_capabilities.items()):
            raise ValueError("capabilities mapping keys must be strings and values must be boolean")
        profile["capabilities"] = dict(raw_capabilities)
    else:
        profile["capabilities"] = _string_list(raw_capabilities, "capabilities")
    return profile


def safe_runner_profile(record: Any) -> dict[str, Any]:
    """Sanitize an untrusted/legacy record for identity reporting without raising.

    Each field fails closed independently so a malformed credential reference is
    never returned and does not hide otherwise valid capability declarations.
    """
    out = empty_runner_profile()
    if not isinstance(record, dict):
        return out

    for field in PROFILE_SCALAR_FIELDS:
        try:
            out[field] = _optional_string(record.get(field), field)
            if field == "engine" and out[field] is not None:
                if out[field] in LEGACY_ENGINE_VALUES or out[field] not in ALLOWED_ENGINES:
                    out[field] = None
            if field == "credential_ref" and out[field] is not None:
                ref = out[field]
                if not ref.startswith("vault://") or len(ref) <= len("vault://"):
                    out[field] = None
        except ValueError:
            out[field] = None
    for field in PROFILE_LIST_FIELDS:
        try:
            out[field] = _string_list(record.get(field), field)
        except ValueError:
            out[field] = []
    try:
        out["memory_expiry_days"] = _memory_expiry_days(record.get("memory_expiry_days"))
    except ValueError:
        out["memory_expiry_days"] = DEFAULT_MEMORY_EXPIRY_DAYS
    try:
        raw_capabilities = record.get("capabilities")
        if isinstance(raw_capabilities, dict):
            if not all(isinstance(key, str) and isinstance(value, bool)
                       for key, value in raw_capabilities.items()):
                raise ValueError("invalid capability mapping")
            out["capabilities"] = dict(raw_capabilities)
        else:
            out["capabilities"] = _string_list(raw_capabilities, "capabilities")
    except ValueError:
        out["capabilities"] = []
    try:
        out["limits"] = _limits(record.get("limits"))
    except ValueError:
        out["limits"] = {}
    return out


def ready_capabilities_seed(value: Any) -> list[str]:
    """Convert a declared capability list into a safe readiness seed."""
    try:
        if isinstance(value, dict):
            return [key for key, enabled in value.items() if enabled]
        return _string_list(value, "capabilities")
    except ValueError:
        return []
