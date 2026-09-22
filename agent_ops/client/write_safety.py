"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import os


import shlex


import subprocess


from .capabilities import redact_sensitive


def clean_text(text: str, limit: int = 4000) -> str:
    cleaned = redact_sensitive(text)
    return str(cleaned)[:limit]


def command_display(command: list[str]) -> str:
    if os.name == "nt":
        return subprocess.list2cmdline(command)
    return shlex.join(command)
