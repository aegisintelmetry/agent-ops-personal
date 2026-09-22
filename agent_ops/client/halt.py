"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations




import json


from dataclasses import dataclass


from pathlib import Path


from typing import Any


from . import config as config_module


from .capabilities import redact_sensitive


HALT_SCHEMA_VERSION = "btk.halt_state.v1"


ACTIVE_STATE = "active"


@dataclass(frozen=True)
class HaltState:
    halt_id: str
    scope_type: str
    scope_id: str
    state: str
    reason: str
    created_by: str
    created_at: str
    released_by: str = ''
    released_at: str = ''
    approval_refs: tuple[str, ...] = ()
    audit_event_refs: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return redact_sensitive({'schema_version': HALT_SCHEMA_VERSION, 'halt_id': self.halt_id, 'scope_type': self.scope_type, 'scope_id': self.scope_id, 'state': self.state, 'reason': self.reason, 'created_by': self.created_by, 'created_at': self.created_at, 'released_by': self.released_by, 'released_at': self.released_at, 'approval_refs': list(self.approval_refs), 'audit_event_refs': list(self.audit_event_refs)})

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> 'HaltState':
        return cls(halt_id=str(payload.get('halt_id') or ''), scope_type=str(payload.get('scope_type') or ''), scope_id=str(payload.get('scope_id') or ''), state=str(payload.get('state') or ''), reason=str(payload.get('reason') or ''), created_by=str(payload.get('created_by') or ''), created_at=str(payload.get('created_at') or ''), released_by=str(payload.get('released_by') or ''), released_at=str(payload.get('released_at') or ''), approval_refs=tuple((str(item) for item in payload.get('approval_refs') or [])), audit_event_refs=tuple((str(item) for item in payload.get('audit_event_refs') or [])))


def halt_store_path_for_profile(profile: config_module.Profile | None) -> Path:
    if profile is not None and profile.config_path:
        return profile.config_path.expanduser().parent / "governance" / "halt_state.jsonl"
    return config_module._default_config_home() / "governance" / "halt_state.jsonl"


class HaltStateStore:
    """Append-only owner-only local halt state ledger."""

    def __init__(self, path: Path | None=None) -> None:
        self.path = Path(path).expanduser() if path is not None else halt_store_path_for_profile(None)

    def read_records(self) -> list[HaltState]:
        if not self.path.exists():
            return []
        records: list[HaltState] = []
        for line in self.path.read_text(encoding='utf-8-sig', errors='replace').splitlines():
            if not line.strip():
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                try:
                    records.append(HaltState.from_dict(payload))
                except (TypeError, ValueError):
                    continue
        return records

    def active_halts(self) -> list[HaltState]:
        latest_by_id: dict[str, HaltState] = {}
        for record in self.read_records():
            if record.halt_id:
                latest_by_id[record.halt_id] = record
        return [record for record in latest_by_id.values() if record.state == ACTIVE_STATE]


def _compact_id(value: str) -> str:
    return "".join(character for character in str(value or "").lower() if character.isalnum())


def _id_equal(left: str, right: str) -> bool:
    return str(left or "").strip().lower() == str(right or "").strip().lower()


def _runner_scope_matches(scope_id: str, runner: str) -> bool:
    left = str(scope_id or "").strip().lower()
    right = str(runner or "").strip().lower()
    if not left or not right:
        return False
    if left == right:
        return True
    compact_left = _compact_id(left)
    compact_right = _compact_id(right)
    return bool(
        compact_left
        and compact_right
        and (
            compact_left == compact_right
            or compact_left.endswith(compact_right)
            or compact_right.endswith(compact_left)
            or compact_left in compact_right
            or compact_right in compact_left
        )
    )


def _state_matches_context(
    state: HaltState,
    *,
    runner: str = "",
    task_id: str = "",
    mission_id: str = "",
) -> bool:
    if state.scope_type == "all":
        return True
    if state.scope_type == "runner":
        return _runner_scope_matches(state.scope_id, runner)
    if state.scope_type == "task":
        return _id_equal(state.scope_id, task_id)
    if state.scope_type == "mission":
        return _id_equal(state.scope_id, mission_id)
    return False


def active_halts_for_context(
    profile: config_module.Profile | None,
    *,
    runner: str = "",
    task_id: str = "",
    mission_id: str = "",
) -> list[HaltState]:
    store = HaltStateStore(halt_store_path_for_profile(profile))
    effective_runner = str(runner or getattr(profile, "runner", "") or "")
    return [
        state
        for state in store.active_halts()
        if _state_matches_context(state, runner=effective_runner, task_id=task_id, mission_id=mission_id)
    ]
