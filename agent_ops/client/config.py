"""Configuration discovery and local profile storage for the Aegis BTK CLI."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .paths import ROOT


def _default_config_home() -> Path:
    override = os.environ.get("BTK_CONFIG_HOME")
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            return Path(appdata) / "aegis-btk"
    return Path.home() / ".aegis-btk"


CONFIG_HOME = _default_config_home()
CONFIG_PATH = CONFIG_HOME / "config.toml"
AUTH_PROFILE_DIR = CONFIG_HOME / "profiles"
PROFILE_NAME_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
ENGINE_NAME_CHARS = PROFILE_NAME_CHARS
ENGINE_AUTH_ENV_ALLOWLIST = frozenset(
    {
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "BTK_BACKEND_TOKEN",
        "OPENAI_API_KEY",
    }
)


@dataclass(frozen=True)
class Profile:
    name: str
    mcp_url_configured: bool
    token_configured: bool
    runner: str
    workspace: Path
    config_path: Path
    mcp_url: str = ""
    workspace_id: str = ""
    team_id: str = ""
    team_type: str = ""
    auth_profile: str = ""
    token_path: Path | None = None
    central_url: str = ""
    central_profile_id: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "mcp_url": self.mcp_url,
            "mcp_url_configured": self.mcp_url_configured,
            "token_configured": self.token_configured,
            "runner": self.runner,
            "workspace_id": self.workspace_id,
            "team_id": self.team_id,
            "team_type": self.team_type,
            "workspace": str(self.workspace),
            "config_path": str(self.config_path),
            "auth_profile": self.auth_profile or self.name,
            "token_path": str(self.token_path) if self.token_path else "",
            "central_url": self.central_url,
            "central_profile_id": self.central_profile_id,
        }


def env_value(name: str) -> str:
    return os.environ.get(name, "").strip()


def validate_profile_name(name: str) -> str:
    profile_name = name.strip()
    if not profile_name:
        raise ValueError("profile name must not be empty")
    if any(character not in PROFILE_NAME_CHARS for character in profile_name):
        raise ValueError("profile name may contain only letters, numbers, dot, underscore, and hyphen")
    if profile_name in {".", ".."}:
        raise ValueError("profile name must not be a path segment")
    return profile_name


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    return tomllib.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def profile_token_path(name: str) -> Path:
    return AUTH_PROFILE_DIR / f"{validate_profile_name(name)}.token"


def validate_engine_name(name: str) -> str:
    engine_name = str(name or "").strip()
    if engine_name == "claude_code":
        engine_name = "claude"
    if engine_name not in {"codex", "claude"}:
        raise ValueError("engine must be codex or claude")
    if any(character not in ENGINE_NAME_CHARS for character in engine_name):
        raise ValueError("engine name contains unsupported characters")
    return engine_name


def profile_engine_auth_path(profile_name: str, engine: str) -> Path:
    return AUTH_PROFILE_DIR / f"{validate_profile_name(profile_name)}.{validate_engine_name(engine)}.engine-auth.json"


def configured_profile_exists(name: str) -> bool:
    profile_name = validate_profile_name(name)
    data = load_config()
    profiles = data.get("profiles", {})
    auth_profiles = data.get("auth_profiles", {})
    token_path = profile_token_path(profile_name)
    return profile_name in profiles or profile_name in auth_profiles or token_path.exists()


def _toml_quote(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _toml_key(name: str) -> str:
    if name and all(character.isalnum() or character in {"_", "-"} for character in name):
        return name
    return _toml_quote(name)


def _toml_table(path: tuple[str, ...], values: dict[str, str]) -> list[str]:
    lines = [f"[{'.'.join(_toml_key(part) for part in path)}]"]
    for key in sorted(values):
        lines.append(f"{key} = {_toml_quote(str(values[key]))}")
    return lines


def dump_config(data: dict[str, Any]) -> str:
    lines: list[str] = ["# Aegis BTK CLI non-secret configuration.", ""]
    default_profile = data.get("default_profile")
    if default_profile:
        lines.append(f"default_profile = {_toml_quote(str(default_profile))}")
        lines.append("")
    for profile_name, profile_data in sorted(data.get("profiles", {}).items()):
        lines.extend(_toml_table(("profiles", profile_name), profile_data))
        lines.append("")
    for profile_name, profile_data in sorted(data.get("auth_profiles", {}).items()):
        lines.extend(_toml_table(("auth_profiles", profile_name), profile_data))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _restrict_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.chmod(stat.S_IRWXU)


def _restrict_windows_acl(path: Path) -> None:
    if os.name != "nt":
        return
    username = os.environ.get("USERNAME")
    if not username:
        return
    domain = os.environ.get("USERDOMAIN", "").strip()
    identity = f"{domain}\\{username}" if domain else username
    subprocess.run(["icacls", str(path), "/inheritance:r"], capture_output=True, text=True, check=False, encoding="utf-8", errors="replace")
    subprocess.run(["icacls", str(path), "/grant:r", f"{identity}:F"], capture_output=True, text=True, check=False, encoding="utf-8", errors="replace")


def restrict_secret_file(path: Path) -> None:
    if os.name == "nt":
        os.chmod(path, stat.S_IREAD | stat.S_IWRITE)
        _restrict_windows_acl(path)
        return
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


def secret_file_is_restrictive(path: Path) -> bool:
    if not path.exists():
        return False
    if os.name == "nt":
        return True
    return stat.S_IMODE(path.stat().st_mode) & (stat.S_IRWXG | stat.S_IRWXO) == 0


def write_secret_file(path: Path, token: str) -> None:
    _restrict_directory(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if os.name == "nt":
        path.write_text(token + "\n", encoding="utf-8")
    else:
        fd = os.open(path, flags, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(token)
            handle.write("\n")
    restrict_secret_file(path)


def write_config(data: dict[str, Any]) -> None:
    _restrict_directory(CONFIG_HOME)
    text = dump_config(data)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=CONFIG_HOME, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(text)
    temp_path.replace(CONFIG_PATH)


CHAT_SETTINGS_PATH = CONFIG_HOME / "chat-settings.json"
# Keys a user may persist as chat defaults. Not secrets -- engine/model/effort selection only.
CHAT_SETTING_KEYS = ("engine", "model", "effort")
CHAT_EFFORT_CHOICES = ("low", "medium", "high", "xhigh", "max")


def validate_chat_setting(key: str, value: str) -> str:
    """Validate one chat-default key/value. Returns the normalised value or raises ValueError."""
    key = str(key or "").strip()
    value = str(value or "").strip()
    if key == "engine":
        return validate_engine_name(value)
    if key == "model":
        # A model alias (opus/sonnet) or a full id; keep it to the same safe charset as profiles.
        if not value:
            raise ValueError("model must not be empty")
        if any(character not in ENGINE_NAME_CHARS for character in value):
            raise ValueError("model alias contains unsupported characters")
        return value
    if key == "effort":
        if value not in CHAT_EFFORT_CHOICES:
            raise ValueError("effort must be one of " + ", ".join(CHAT_EFFORT_CHOICES))
        return value
    raise ValueError("unknown setting; expected one of " + ", ".join(CHAT_SETTING_KEYS))


def read_chat_settings() -> dict[str, str]:
    """Read persisted chat defaults. Missing or corrupt file -> {} (never raises)."""
    if not CHAT_SETTINGS_PATH.exists():
        return {}
    try:
        raw = json.loads(CHAT_SETTINGS_PATH.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key in CHAT_SETTING_KEYS:
        value = raw.get(key)
        if isinstance(value, str) and value.strip():
            try:
                out[key] = validate_chat_setting(key, value)
            except ValueError:
                continue
    return out


def write_chat_settings(data: dict[str, str]) -> None:
    _restrict_directory(CONFIG_HOME)
    clean = {key: data[key] for key in CHAT_SETTING_KEYS if data.get(key)}
    text = json.dumps(clean, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=CONFIG_HOME, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(text)
    temp_path.replace(CHAT_SETTINGS_PATH)


def initialize_profile(
    *,
    name: str,
    mcp_url: str,
    workspace_id: str,
    team_id: str,
    team_type: str,
    runner_id: str,
    repo_path: Path,
    runs_dir: Path,
    tasks_dir: Path,
    token: str,
    force: bool = False,
) -> dict[str, Any]:
    profile_name = validate_profile_name(name)
    if not force and configured_profile_exists(profile_name):
        return {
            "ok": False,
            "error": "profile already exists; use --force to overwrite",
            "profile": profile_name,
            "config_path": str(CONFIG_PATH),
            "token_path": str(profile_token_path(profile_name)),
        }
    clean_token = token.rstrip("\r\n")
    if not clean_token:
        return {
            "ok": False,
            "error": "auth token was empty",
            "profile": profile_name,
            "config_path": str(CONFIG_PATH),
        }

    data = load_config()
    profiles = dict(data.get("profiles", {}))
    auth_profiles = dict(data.get("auth_profiles", {}))
    token_path = profile_token_path(profile_name)
    profiles[profile_name] = {
        "mcp_url": mcp_url,
        "workspace_id": workspace_id,
        "team_id": team_id,
        "team_type": team_type,
        "runner_id": runner_id,
        "repo_path": str(repo_path),
        "runs_dir": str(runs_dir),
        "tasks_dir": str(tasks_dir),
        "auth_profile": profile_name,
    }
    auth_profiles[profile_name] = {
        "token_file": str(token_path),
    }
    data["default_profile"] = data.get("default_profile") or profile_name
    data["profiles"] = profiles
    data["auth_profiles"] = auth_profiles

    write_secret_file(token_path, clean_token)
    write_config(data)
    return {
        "ok": True,
        "profile": profile_name,
        "config_path": str(CONFIG_PATH),
        "token_path": str(token_path),
        "token_permissions_restrictive": secret_file_is_restrictive(token_path),
    }


def current_profile(name: str | None = None) -> Profile:
    data = load_config()
    configured_default = str(data.get("default_profile") or "").strip()
    profile_name = validate_profile_name(name or env_value("BTK_PROFILE") or configured_default or "default")
    profile_data = data.get("profiles", {}).get(profile_name, {})
    auth_profile = str(profile_data.get("auth_profile") or profile_name)
    auth_data = data.get("auth_profiles", {}).get(auth_profile, {})
    token_path_raw = str(auth_data.get("token_file") or "")
    token_path = Path(token_path_raw).expanduser() if token_path_raw else profile_token_path(auth_profile)
    mcp_url = env_value("BTK_MCP_URL") or env_value("NUXT_PUBLIC_BTK_MCP_RUNTIME_URL") or str(profile_data.get("mcp_url") or "")
    runner_id = env_value("BTK_RUNNER_ID") or str(profile_data.get("runner_id") or "")
    repo_path = Path(str(profile_data.get("repo_path") or ROOT)).expanduser()
    return Profile(
        name=profile_name,
        mcp_url=mcp_url,
        mcp_url_configured=bool(mcp_url),
        token_configured=bool(env_value("BTK_MCP_TOKEN") or env_value("MCP_TOKEN") or token_path.exists()),
        runner=runner_id,
        workspace=repo_path,
        config_path=CONFIG_PATH,
        workspace_id=str(profile_data.get("workspace_id") or ""),
        team_id=env_value("BTK_TEAM_ID") or str(profile_data.get("team_id") or ""),
        team_type=env_value("BTK_TEAM_TYPE") or str(profile_data.get("team_type") or ""),
        auth_profile=auth_profile,
        token_path=token_path,
        central_url=env_value("BTK_CENTRAL_URL") or str(profile_data.get("central_url") or ""),
        central_profile_id=env_value("BTK_CENTRAL_PROFILE_ID") or str(profile_data.get("central_profile_id") or ""),
    )


def clean_token(value: str) -> str:
    """First real line, nothing else: a bearer token cannot contain a newline.

    .strip() removes trailing whitespace and leaves an embedded newline in place, so a token file
    with a stray line break produced `Invalid header value b'Bearer <token>\\nn'` and killed every
    command on that box -- an error that names header bytes rather than the token file at fault.
    """
    for line in str(value or "").splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return ""


def profile_token(profile: Profile) -> str:
    token = env_value("BTK_MCP_TOKEN") or env_value("MCP_TOKEN")
    if token:
        return clean_token(token)
    if not profile.token_path:
        return ""
    try:
        return clean_token(profile.token_path.read_text(encoding="utf-8"))
    except OSError:
        return ""


def store_profile_token(profile: Profile, token: str) -> Path:
    token_path = profile.token_path or profile_token_path(profile.auth_profile or profile.name)
    write_secret_file(token_path, token.rstrip("\r\n"))

    data = load_config()
    auth_profiles = dict(data.get("auth_profiles", {}))
    auth_profile = profile.auth_profile or profile.name
    auth_profiles[auth_profile] = {"token_file": str(token_path)}
    data["auth_profiles"] = auth_profiles
    if not data.get("default_profile"):
        data["default_profile"] = profile.name
    write_config(data)
    return token_path


def update_profile_central_auth(
    profile: Profile,
    *,
    central_url: str = "",
    central_profile_id: str = "",
) -> None:
    data = load_config()
    profiles = dict(data.get("profiles", {}))
    profile_data = dict(profiles.get(profile.name, {}))
    if central_url:
        profile_data["central_url"] = central_url
    if central_profile_id:
        profile_data["central_profile_id"] = central_profile_id
    profiles[profile.name] = profile_data
    data["profiles"] = profiles
    if not data.get("default_profile"):
        data["default_profile"] = profile.name
    write_config(data)


def write_profile_engine_auth(profile: Profile, engine: str, payload: dict[str, Any]) -> Path:
    engine_name = validate_engine_name(engine)
    env_payload = payload.get("env") if isinstance(payload.get("env"), dict) else {}
    env: dict[str, str] = {}
    for key, value in env_payload.items():
        key_text = str(key or "").strip()
        if key_text not in ENGINE_AUTH_ENV_ALLOWLIST:
            continue
        value_text = str(value or "")
        if value_text:
            env[key_text] = value_text
    path = profile_engine_auth_path(profile.auth_profile or profile.name, engine_name)
    write_secret_file(
        path,
        json.dumps(
            {
                "schema_version": "btk.engine_auth_profile.v1",
                "engine": engine_name,
                "credential_format": "env",
                "env": env,
                "credential_fingerprint": str(payload.get("credential_fingerprint") or ""),
                "expires_at": str(payload.get("expires_at") or ""),
                "account_label": str(payload.get("account_label") or ""),
                "secret_values_redacted_in_cli_output": True,
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
    )
    return path


def read_profile_engine_env(profile: Profile | None, engine: str) -> dict[str, str]:
    if profile is None:
        return {}
    try:
        path = profile_engine_auth_path(profile.auth_profile or profile.name, engine)
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return {}
    env_payload = data.get("env") if isinstance(data, dict) else {}
    if not isinstance(env_payload, dict):
        return {}
    env: dict[str, str] = {}
    for key, value in env_payload.items():
        key_text = str(key or "").strip()
        value_text = str(value or "")
        if key_text in ENGINE_AUTH_ENV_ALLOWLIST and value_text:
            env[key_text] = value_text
    return env


def read_profile_engine_auth_metadata(profile: Profile | None, engine: str) -> dict[str, str]:
    """Read non-secret expiry/fingerprint metadata from the restricted auth file."""
    if profile is None:
        return {}
    try:
        path = profile_engine_auth_path(profile.auth_profile or profile.name, engine)
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {key: str(data.get(key) or "") for key in ("expires_at", "credential_fingerprint", "account_label")}
