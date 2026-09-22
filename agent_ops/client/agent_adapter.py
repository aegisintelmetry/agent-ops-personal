"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import re


from .write_safety import clean_text


LOG_REDACTION_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
            re.IGNORECASE | re.DOTALL,
        ),
        "<redacted:private-key>",
    ),
    (
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----", re.IGNORECASE),
        "<redacted:private-key>",
    ),
    (
        re.compile(r"\b(?:ghp|github_pat|glpat|sk|xox[baprs]?)-[A-Za-z0-9._~+/=-]{8,}\b", re.IGNORECASE),
        "<redacted:token>",
    ),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "<redacted:token>"),
    (
        re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
        "<redacted:token>",
    ),
    (
        re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}\b"),
        "Bearer <redacted>",
    ),
    (
        re.compile(
            r"(?i)([\"']?\b[A-Za-z0-9_-]*(?:authorization|token|secret|password|api[_-]?key|apikey)[A-Za-z0-9_-]*[\"']?\s*[:=]\s*)[\"']?[^\s,'\";}]{4,}"
        ),
        r"\1<redacted>",
    ),
)


def redact_log_text(text: str) -> tuple[str, int]:
    redacted = str(text or "")
    count = 0
    for pattern, replacement in LOG_REDACTION_PATTERNS:
        redacted, item_count = pattern.subn(replacement, redacted)
        count += item_count
    cleaned = clean_text(redacted, limit=max(len(redacted), 1))
    return cleaned, count
