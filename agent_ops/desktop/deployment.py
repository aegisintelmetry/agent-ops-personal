"""Native setup progress through the existing, operator-authorized registry API."""

import platform
import re
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import build_opener

from agent_ops.client.config import read_profile_engine_env
from agent_ops.desktop.enrollment import NoRedirect, host_matches, https_url
from agent_ops.client.profile_registry_client import ProfileRegistryClient, ProfileRegistryError


class DeploymentReporter:
    def __init__(self, profile, engine):
        parsed = urlsplit(https_url(profile.central_url))
        if parsed.path.rstrip("/") not in ("", "/api/harness"):
            raise ValueError("중앙 배포 주소는 서버 주소 또는 /api/harness 경로여야 합니다.")
        base = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
        token = read_profile_engine_env(profile, engine).get("BTK_BACKEND_TOKEN", "")
        if not token:
            raise ValueError("중앙 배포 보고용 인증이 없습니다. 웹 콘솔에서 프로파일 인증을 확인해 주세요.")
        opener = build_opener(NoRedirect()).open

        def authenticated_open(request, **kwargs):
            request.add_header("Authorization", "Bearer " + token)
            try:
                return opener(request, **kwargs)
            except HTTPError as exc:
                # Backend error bodies can echo credentials. Never return them to the UI.
                raise ProfileRegistryError(f"중앙 배포 {request.method} {urlsplit(request.full_url).path}: HTTP {exc.code}") from None

        self.client = ProfileRegistryClient(base, actor="desktop:" + profile.runner,
            opener=authenticated_open, timeout=8)
        self.profile = profile
        self.deploy_id = ""

    def enroll(self):
        record = self.client.enroll(quote(platform.node(), safe=""), {
            "runner_id": self.profile.runner, "profile_id": self.profile.central_profile_id,
            "source": "btk_desktop", "platform": "windows"})
        deploy_id = record.get("deploy_id")
        if (not isinstance(deploy_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", deploy_id)
                or record.get("runner_id") != self.profile.runner or not host_matches(record.get("hostname"))):
            raise ValueError("중앙 배포 응답의 호스트·러너·배포 ID가 일치하지 않습니다.")
        self.deploy_id = deploy_id
        return {"deploy_id": deploy_id, "authority": f"/api/deploy/{deploy_id}",
                "runner_id": self.profile.runner, "hostname": record["hostname"]}

    def progress(self, stage, state, evidence=None):
        if not self.deploy_id:
            raise ValueError("중앙 배포 등록이 먼저 필요합니다.")
        event = {"stage": stage, "state": state, "evidence": evidence or {}}
        record = self.client.post_progress(self.deploy_id, event)
        if (record.get("deploy_id") != self.deploy_id or record.get("stage") != stage
                or record.get("state") != state or type(record.get("id")) is not int or record["id"] < 1):
            raise ValueError("중앙 배포 진행 보고의 저장 확인을 받지 못했습니다.")
        return {"event_id": record["id"], "stage": stage, "state": state}
