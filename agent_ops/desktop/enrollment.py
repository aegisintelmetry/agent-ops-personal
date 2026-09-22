"""Enroll only an existing console-issued profile; never create fleet identities."""

import hashlib
import json
import os
import platform
import re
from dataclasses import replace
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

from agent_ops.client import config
from agent_ops.client.central_auth import CONSOLE_AUTH_PATH, post_json, store_auth_response, validate_pull_session
from agent_ops.client.mcp_endpoint import resolve_mcp_url


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("인증 요청의 리디렉션은 허용하지 않습니다.")


def https_url(value, *, label="중앙 서버 주소"):
    parsed = urlsplit(str(value).strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f"{label}는 사용자 정보·쿼리가 없는 HTTPS 주소여야 합니다.")
    return str(value).strip().rstrip("/")


def managed_root():
    base = os.environ.get("LOCALAPPDATA")
    if not base:
        raise ValueError("Windows LOCALAPPDATA 경로가 필요합니다.")
    return Path(base) / "BTK" / "agent"


def host_matches(value):
    return bool(value) and str(value).strip().casefold().split(".")[0] == platform.node().casefold().split(".")[0]


def authenticate(profile, central_url, profile_id, bootstrap_token=""):
    central_url = https_url(central_url)
    if not isinstance(profile_id, str) or not profile_id.strip() or len(profile_id) > 160:
        raise ValueError("웹 콘솔에서 발급한 프로파일 ID가 필요합니다.")
    if not isinstance(bootstrap_token, str) or len(bootstrap_token) > 512:
        raise ValueError("등록 코드 형식이 올바르지 않습니다.")
    opener = build_opener(NoRedirect()).open
    # post_json normally includes backend error bodies. Never forward an enrollment body,
    # which could echo the one-time bootstrap credential, to logs or the renderer.
    def guarded_open(request, **kwargs):
        try:
            return opener(request, **kwargs)
        except HTTPError as exc:
            raise ValueError(f"중앙 프로파일 인증 HTTP {exc.code}") from None
    response = post_json(central_url, CONSOLE_AUTH_PATH,
        {"profile_id": profile_id.strip(), "target_host": platform.node(), "bootstrap_token": bootstrap_token},
        profile=profile, timeout_seconds=8, opener=guarded_open)
    data = response.get("profile") or {}
    if response.get("status") != "authenticated" or data.get("profile_id") != profile_id.strip():
        raise ValueError("중앙 인증 결과의 프로파일 ID가 일치하지 않습니다.")
    if data.get("is_active") is not True or not host_matches(data.get("target_host")):
        raise ValueError("비활성 프로파일이거나 이 PC에 배정된 프로파일이 아닙니다.")
    runner = config.validate_profile_name(data.get("runner_id", ""))
    team = config.validate_profile_name(data.get("team_id", ""))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}", runner):
        raise ValueError("중앙 러너 ID 형식이 올바르지 않습니다.")
    engine = data.get("engine")
    if engine not in ("claude", "codex"):
        raise ValueError("등록 프로파일의 엔진은 claude 또는 codex여야 합니다.")
    team_type = data.get("team_type")
    if not isinstance(team_type, str) or not team_type.strip():
        raise ValueError("중앙 프로파일에 team_type이 없습니다. 웹 콘솔에서 보완해 주세요.")
    mcp = response.get("mcp_runtime") or {}
    try:
        endpoint = resolve_mcp_url(str(mcp.get("url") or data.get("mcp_url") or ""))
    except SystemExit as exc:
        raise ValueError(f"중앙에서 받은 MCP 주소가 정책에 맞지 않습니다: {exc}") from None
    if not mcp.get("token"):
        raise ValueError("중앙 인증 결과에 MCP 자격 증명이 없습니다.")
    bound = replace(profile, runner=runner, team_id=team, team_type=team_type,
                    mcp_url=endpoint, central_url=central_url, central_profile_id=profile_id)
    validate_pull_session(response, bound, profile_id)
    for key, expected in (("BTK_RUNNER_ID", runner), ("BTK_TEAM_ID", team), ("BTK_TEAM_TYPE", team_type),
                          ("BTK_MCP_URL", endpoint), ("BTK_MCP_RUNTIME_URL", endpoint)):
        if os.environ.get(key) and os.environ[key].strip() != expected:
            raise ValueError(f"{key} 환경변수와 중앙 프로파일이 다릅니다. 기존 설정을 먼저 확인해 주세요.")
    for key in ("BTK_MCP_TOKEN", "MCP_TOKEN"):
        if os.environ.get(key) and os.environ[key].strip() != mcp["token"]:
            raise ValueError(f"{key}가 기존 자격 증명을 고정하고 있습니다. 환경변수를 먼저 정리해 주세요.")
    if profile.runner and profile.runner != runner:
        raise ValueError("기존 PC 러너와 다른 신원으로 덮어쓸 수 없습니다.")
    return bound, response


def enroll(service, params):
    if set(params) - {"central_url", "profile_id", "bootstrap_token"}:
        raise ValueError("허용되지 않은 등록 항목입니다.")
    current = service.profile()
    bound, response = authenticate(current, params.get("central_url", ""), params.get("profile_id", ""), params.get("bootstrap_token", ""))
    if not current.runner:
        name = "desktop-" + hashlib.sha256(bound.central_profile_id.encode()).hexdigest()[:12]
        if os.environ.get("BTK_PROFILE") and os.environ["BTK_PROFILE"] != name:
            raise ValueError("BTK_PROFILE이 다른 프로파일을 고정하고 있습니다. 기존 설정을 먼저 확인해 주세요.")
        workspace = managed_root() / "workspaces" / name
        bound = replace(bound, name=name, workspace=workspace, auth_profile=name, token_path=config.profile_token_path(name))
        result = config.initialize_profile(name=name, mcp_url=bound.mcp_url, workspace_id="btk-agent-harness",
            team_id=bound.team_id, team_type=bound.team_type, runner_id=bound.runner, repo_path=workspace,
            runs_dir=workspace / "runs", tasks_dir=workspace / "harness/tasks", token=response["mcp_runtime"]["token"])
        if not result.get("ok"):
            raise ValueError("같은 로컬 프로파일이 이미 있습니다. 기존 프로파일을 선택해 주세요.")
        settings = config.load_config()
        settings["default_profile"] = name
        config.write_config(settings)
    store_auth_response(bound, response, central_url=bound.central_url, engine=response["profile"]["engine"])
    from agent_ops.client.auth_session import record_session
    credential = response.get("engine_auth") or {}
    if credential.get("status") == "available":
        record_session(response["profile"]["engine"], fingerprint=credential.get("credential_fingerprint", ""),
            expires_at=response.get("expires_at", ""), mode=credential.get("credential_format", ""))
    # These are centrally-derived registration fields in the existing CLI config, not a new store.
    settings = config.load_config()
    settings["profiles"][bound.name].update({"mcp_url": bound.mcp_url,
        "central_url": bound.central_url, "central_profile_id": bound.central_profile_id})
    config.write_config(settings)
    return {"status": "registered", "runner": bound.runner, "team_id": bound.team_id,
            "engine": response["profile"]["engine"], "profile_id": bound.central_profile_id,
            "engine_credential_available": response.get("engine_auth", {}).get("status") == "available"}
