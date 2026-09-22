"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import re


import urllib.error


import urllib.parse


import urllib.request


from pathlib import Path


from typing import Any


SENSITIVE_KEY_RE = re.compile(r"(authorization|bearer|password|secret|api[_-]?key|apikey|token)", re.IGNORECASE)


SAFE_SENSITIVE_KEYS = {
    "cached_tokens",
    "environment_authorization",
    "input_tokens",
    "output_tokens",
    "over_token_limit",
    "planned_tokens",
    "projected_tokens",
    "secret_values_exposed",
    "secret_values_redacted",
    "token_configured",
    "token_limit",
    "token_path",
    "token_percent",
    "total_tokens",
}


def _redact_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if not (parsed.scheme and parsed.netloc):
        return value
    if not parsed.query:
        return value
    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    changed = False
    redacted_pairs: list[tuple[str, str]] = []
    for key, item in pairs:
        if SENSITIVE_KEY_RE.search(key):
            redacted_pairs.append((key, "REDACTED"))
            changed = True
        else:
            redacted_pairs.append((key, item))
    if not changed:
        return value
    query = urllib.parse.urlencode(redacted_pairs)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def _sanitize_string(value: str) -> str:
    text = _redact_url(value)
    text = re.sub(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer REDACTED", text)
    text = re.sub(
        r"(?i)(token|secret|password|api[_-]?key|apikey)=([^&\s]+)",
        lambda match: f"{match.group(1)}=REDACTED",
        text,
    )
    return text


def redact_sensitive(value: Any, *, key: str = "") -> Any:
    """Return a JSON-safe copy with likely secret values removed."""

    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for item_key, item_value in value.items():
            item_key_text = str(item_key)
            if SENSITIVE_KEY_RE.search(item_key_text) and item_key_text not in SAFE_SENSITIVE_KEYS:
                redacted[item_key_text] = "REDACTED"
            else:
                redacted[item_key_text] = redact_sensitive(item_value, key=item_key_text)
        return redacted
    if isinstance(value, list):
        return [redact_sensitive(item, key=key) for item in value]
    if isinstance(value, tuple):
        return [redact_sensitive(item, key=key) for item in value]
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, str):
        if SENSITIVE_KEY_RE.search(key) and key not in SAFE_SENSITIVE_KEYS:
            return "REDACTED"
        return _sanitize_string(value)
    return value
