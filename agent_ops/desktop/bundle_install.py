"""Install the published fleet bundle into a new workspace, never a live checkout."""

import base64
import hashlib
import io
import json
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath

from agent_ops.client.artifacts import download_artifact as _download_artifact, DEFAULT_UPDATE_TASK_ID

REQUIRED = (
    "harness/deploy/pc-runners/start_btk_supervisor.ps1",
    "harness/orchestrator/poll_runner_queue.py",
    "harness/orchestrator/run_agent_executor_loop.py",
    "harness/orchestrator/a2a_chat_responder.py",
    "harness/profiledb/profile_materialize_daemon.py",
)
MAX_ZIP = 256 * 1024 * 1024
MAX_EXPANDED = 768 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_zip(pointer, wrapper):
    if pointer.get("schema_version") != "btk.cli_latest_pointer.v1":
        raise ValueError("공식 latest 배포 포인터 형식이 아닙니다.")
    # Published v1 pointers may bind only the ZIP. Its digest and size remain mandatory;
    # an additional wrapper digest, when supplied, must also match exactly.
    expected = pointer.get("wrapper_sha256")
    if expected is not None and (not isinstance(expected, str) or not re.fullmatch("[0-9a-f]{64}", expected)
                                 or sha(wrapper.encode("utf-8")) != expected):
        raise ValueError("배포 포인터와 패키지 wrapper 해시가 다릅니다.")
    if not isinstance(pointer.get("zip_sha256"), str) or not re.fullmatch("[0-9a-f]{64}", pointer["zip_sha256"]):
        raise ValueError("공식 배포 포인터에 ZIP SHA256이 없습니다.")
    if type(pointer.get("zip_size_bytes")) is not int or not 0 < pointer["zip_size_bytes"] <= MAX_ZIP:
        raise ValueError("공식 배포 포인터의 ZIP 크기가 올바르지 않습니다.")
    payload = json.loads(wrapper)
    raw = base64.b64decode(payload.get("content_base64", ""), validate=True)
    if not raw or len(raw) > MAX_ZIP:
        raise ValueError("설치 번들 크기 제한을 초과했습니다.")
    if sha(raw) != pointer.get("zip_sha256") or sha(raw) != payload.get("sha256"):
        raise ValueError("배포 포인터와 ZIP 해시가 다릅니다.")
    if len(raw) != pointer.get("zip_size_bytes") or len(raw) != payload.get("size_bytes"):
        raise ValueError("배포 번들 크기가 다릅니다.")
    return raw


def extract_checked(raw, destination):
    destination = Path(destination).resolve()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = set()
        total = 0
        for entry in archive.infolist():
            name = entry.orig_filename
            parts = PurePosixPath(name).parts
            if (not parts or name.startswith("/") or "\\" in name or ":" in name or
                any(p in ("", ".", "..") for p in name.rstrip("/").split("/")) or
                any(p.rstrip(". ") != p for p in parts) or
                any(p.split(".")[0].upper() in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(1, 10)], *[f"LPT{i}" for i in range(1, 10)]} for p in parts) or
                stat.S_ISLNK(entry.external_attr >> 16) or name.casefold().rstrip("/") in names):
                raise ValueError("설치 번들에 안전하지 않은 경로가 있습니다.")
            names.add(name.casefold().rstrip("/"))
            total += entry.file_size
            if total > MAX_EXPANDED or len(names) > 30000:
                raise ValueError("설치 번들 압축 해제 한도를 초과했습니다.")
            target = destination.joinpath(*parts)
            if not target.resolve().is_relative_to(destination):
                raise ValueError("설치 번들 경로가 외부를 가리킵니다.")
        for required in ("install.ps1", *["repo_overlay/" + p for p in REQUIRED]):
            if required.casefold() not in names:
                raise ValueError(f"배포 번들의 필수 구성 요소가 없습니다: {required}")
        archive.extractall(destination)
    return destination


def download(profile, endpoint, destination, download_artifact=_download_artifact):
    args = dict(profile=profile, runner=profile.runner, team_id=profile.team_id, team_type=profile.team_type,
                mcp_url=endpoint, timeout_seconds=45)
    pointer_text = download_artifact(**args, task_id=DEFAULT_UPDATE_TASK_ID,
        artifact_path=f"runs/{DEFAULT_UPDATE_TASK_ID}/upload/latest.json")
    pointer = json.loads(pointer_text)
    task_id, artifact = pointer.get("task_id", ""), pointer.get("artifact", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", task_id) or not artifact.startswith(f"runs/{task_id}/upload/") or ".." in artifact or "\\" in artifact:
        raise ValueError("latest 포인터의 artifact 경로가 올바르지 않습니다.")
    wrapper = download_artifact(**args, task_id=task_id, artifact_path=artifact)
    if len(wrapper) > MAX_ZIP * 2:
        raise ValueError("배포 wrapper 크기 제한을 초과했습니다.")
    extract_checked(checked_zip(pointer, wrapper), destination)
    return {"authority": f"runs/{DEFAULT_UPDATE_TASK_ID}/upload/latest.json", "task_id": task_id,
            "artifact": artifact, "package": pointer.get("package"), "zip_sha256": pointer["zip_sha256"]}
