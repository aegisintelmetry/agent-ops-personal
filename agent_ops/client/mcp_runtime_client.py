"""Product client helpers extracted from the original compatibility layer."""


from __future__ import annotations


from .registry import load_yaml
from ..models.profile_schema import safe_runner_profile, ready_capabilities_seed


import base64


import binascii


import hashlib


import json


import os


import time


from typing import Any


from urllib.error import HTTPError, URLError


from urllib.parse import urlencode


from urllib.request import Request, HTTPRedirectHandler, build_opener


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise McpRuntimeError('MCP redirects are not allowed')


def urlopen(request, *, timeout):
    return build_opener(_NoRedirect()).open(request, timeout=timeout)


ARTIFACT_DOWNLOAD_RETRY_ATTEMPTS = 8


ARTIFACT_DOWNLOAD_INITIAL_BACKOFF_SECONDS = 0.1


ARTIFACT_DOWNLOAD_MAX_BACKOFF_SECONDS = 1.0


class McpRuntimeError(RuntimeError):
    """Raised when the MCP runtime call fails."""


def operation_path(operation, *, task_id='', question_id=''):
    if operation == 'runner.heartbeat.list':
        return 'GET', '/runtime/runner/heartbeat'
    if operation not in ('artifact.list', 'artifact.download'):
        raise McpRuntimeError('Operation is not part of the product read client')
    import re
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,159}', task_id):
        raise McpRuntimeError('A valid task identifier is required')
    suffix = 'artifact-manifest' if operation == 'artifact.list' else 'artifact'
    return 'GET', f'/runtime/task/{task_id}/{suffix}'


def call_runtime(*, mcp_url, token, operation, identity, payload, task_id='',
                 question_id='', timeout_seconds=5, dry_run=False):
    method, path = operation_path(operation, task_id=task_id, question_id=question_id)
    from .mcp_endpoint import resolve_mcp_url
    mcp_url = resolve_mcp_url(mcp_url, env={})
    if not identity.get('runner_id'):
        raise McpRuntimeError('An explicitly registered runner is required')
    if dry_run:
        return {'dry_run': True, 'method': method, 'operation': operation}
    if operation == 'artifact.download':
        return call_artifact_download_with_retry(mcp_url=mcp_url, token=token, identity=identity,
            payload=payload, task_id=task_id, timeout_seconds=timeout_seconds)
    return send_runtime_request(mcp_url=mcp_url, token=token, operation=operation,
        identity=identity, method=method, path=path, payload=payload, timeout_seconds=timeout_seconds)


def windows_user_env_value(name: str) -> str:
    if os.name != "nt":
        return ""
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _ = winreg.QueryValueEx(key, name)
    except OSError:
        return ""
    return str(value).strip()


def env_value(name: str, default: str = "") -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        value = windows_user_env_value(name)
    return value or default


def runner_profile_fields(runner: dict[str, Any]) -> dict[str, Any]:
    """Return validated optional profile fields without exposing inline credentials."""
    return safe_runner_profile(runner)


def idempotency_key(operation: str, payload: dict[str, Any]) -> str:
    material = json.dumps(
        {"operation": operation, "payload": payload},
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return f"btk-{operation}-{digest[:24]}"


def clean_token(token: str) -> str:
    """A bearer token cannot contain a newline. Take the first real line and nothing else.

    The token is written to disk (or an env var) by a human, so it arrives with whatever the
    terminal put there. The server's token had a stray newline INSIDE it, and every caller only
    did .strip() -- which removes trailing whitespace and leaves an embedded newline untouched.
    urllib then refused to build the request at all:

        Invalid header value b'Bearer <token>\\nn'

    So `btk update` on the server failed with a message about header bytes, naming nothing an
    operator could act on, while the real fault was one character in a token file. Normalise here,
    at the single place the header is built, so no caller has to remember to.
    """
    for line in str(token or "").splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned
    return ""


def auth_header_value(token: str) -> tuple[str, str] | None:
    token = clean_token(token)
    if not token:
        return None

    header = env_value("BTK_MCP_AUTH_HEADER", "Authorization")
    scheme = env_value("BTK_MCP_AUTH_SCHEME", "Bearer")
    if scheme.lower() in {"", "none", "raw"}:
        return header, token
    return header, f"{scheme} {token}"


def request_url(base_url: str, path: str, method: str, payload: dict[str, Any]) -> tuple[str, bytes | None]:
    url = base_url.rstrip("/") + path
    body: bytes | None = None
    if method == "GET":
        query = urlencode({key: value for key, value in payload.items() if value not in (None, "")})
        if query:
            url = f"{url}?{query}"
    else:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    return url, body


def runtime_request_headers(
    *,
    token: str,
    operation: str,
    identity: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    request_headers = {
        "Content-Type": "application/json",
        "User-Agent": "aegis-agent-ops-client",
        "X-BTK-Runner-Id": identity["runner_id"],
        "X-BTK-Idempotency-Key": idempotency_key(operation, payload),
    }
    runner_headers = identity.get("mcp_headers", {})
    if isinstance(runner_headers, dict):
        for key, value in runner_headers.items():
            if isinstance(key, str) and isinstance(value, str):
                request_headers[key] = value
    request_headers.setdefault("X-Team-Id", str(identity.get("team_id", "")))
    request_headers.setdefault("X-Team-Type", str(identity.get("team_type", "")))
    request_headers.setdefault("X-Runner-Id", str(identity.get("runner_id", "")))
    auth_header = auth_header_value(token)
    if auth_header:
        request_headers[auth_header[0]] = auth_header[1]
    return request_headers


def send_runtime_request(
    *,
    mcp_url: str,
    token: str,
    operation: str,
    identity: dict[str, Any],
    method: str,
    path: str,
    payload: dict[str, Any],
    timeout_seconds: float,
) -> dict[str, Any]:
    url, body = request_url(mcp_url, path, method, payload)
    request_headers = runtime_request_headers(token=token, operation=operation, identity=identity, payload=payload)
    request = Request(url, data=body, headers=request_headers, method=method)
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(512 * 1024 * 1024 + 1)
            if len(raw) > 512 * 1024 * 1024:
                raise McpRuntimeError('MCP response exceeds the size limit')
            data = raw.decode("utf-8", errors="replace")
            return {
                "http_status": response.status,
                "response": json.loads(data) if data else {},
            }
    except HTTPError as exc:
        return {
            "http_status": exc.code,
            "error": "http_error",
            "detail": f"HTTP {exc.code}",
        }
    except TimeoutError as exc:
        raise McpRuntimeError("MCP runtime unreachable: timeout") from exc
    except URLError as exc:
        raise McpRuntimeError(f"MCP runtime unreachable: {exc.reason}") from exc
    except OSError as exc:
        raise McpRuntimeError(f"MCP runtime unreachable: {exc.__class__.__name__}") from exc


def http_status(result: dict[str, Any]) -> int:
    try:
        return int(result.get("http_status") or 0)
    except (TypeError, ValueError):
        return 0


def response_body(result: dict[str, Any]) -> dict[str, Any]:
    body = result.get("response") if isinstance(result, dict) else {}
    return body if isinstance(body, dict) else {}


def response_failed(result: dict[str, Any]) -> bool:
    return bool(result.get("error") or ("http_status" in result and not (200 <= http_status(result) < 300)))


def normalized_artifact_path(value: Any) -> str:
    text = str(value or "").strip().replace("\\", "/")
    while "//" in text:
        text = text.replace("//", "/")
    while text.startswith("./"):
        text = text[2:]
    return text.strip("/").lower()


def unique_artifact_paths(paths: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for path in paths:
        raw = str(path or "").strip()
        key = normalized_artifact_path(raw)
        if raw and key and key not in seen:
            seen.add(key)
            result.append(raw)
    return result


def iter_artifact_paths(value: Any) -> list[str]:
    paths: list[str] = []
    if isinstance(value, str):
        paths.append(value)
    elif isinstance(value, list):
        for item in value:
            paths.extend(iter_artifact_paths(item))
    elif isinstance(value, dict):
        for key in ("path", "artifact_path", "relative_path", "file", "name"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                paths.append(raw)
        for key in (
            "artifact",
            "artifact_manifest",
            "artifact_upload",
            "artifacts",
            "files",
            "items",
            "manifest",
            "manifests",
            "uploaded",
            "upload",
        ):
            nested = value.get(key)
            if isinstance(nested, (dict, list)):
                paths.extend(iter_artifact_paths(nested))
    return paths


def artifact_paths_from_response(result: dict[str, Any]) -> list[str]:
    return unique_artifact_paths(iter_artifact_paths(response_body(result)))


def resolve_manifest_artifact_path(requested_path: str, manifest_paths: list[str]) -> str:
    requested_norm = normalized_artifact_path(requested_path)
    if not requested_norm:
        return ""

    for path in manifest_paths:
        if normalized_artifact_path(path) == requested_norm:
            return path

    suffix_matches = [
        path
        for path in manifest_paths
        if normalized_artifact_path(path).endswith(f"/{requested_norm}")
        or requested_norm.endswith(f"/{normalized_artifact_path(path)}")
    ]
    if len(suffix_matches) == 1:
        return suffix_matches[0]

    requested_name = requested_norm.rsplit("/", 1)[-1]
    name_matches = [path for path in manifest_paths if normalized_artifact_path(path).rsplit("/", 1)[-1] == requested_name]
    return name_matches[0] if len(name_matches) == 1 else ""


def artifact_content_and_encoding(result: dict[str, Any]) -> tuple[str | None, str]:
    body = response_body(result)
    artifact = body.get("artifact") if isinstance(body.get("artifact"), dict) else {}
    content: str | None = None
    for source in (body, artifact):
        for key in ("content", "text"):
            value = source.get(key)
            if isinstance(value, str):
                content = value
                break
        if content is not None:
            break
    encoding = str(
        body.get("content_encoding")
        or body.get("encoding")
        or artifact.get("content_encoding")
        or artifact.get("encoding")
        or "utf-8"
    ).lower()
    return content, encoding


def artifact_response_bytes(result: dict[str, Any]) -> bytes | None:
    content, encoding = artifact_content_and_encoding(result)
    if content is None:
        return None
    if encoding == "base64":
        try:
            return base64.b64decode(content.encode("ascii"), validate=True)
        except (binascii.Error, UnicodeEncodeError):
            return None
    return content.encode("utf-8")


def retry_delay_seconds(attempt_index: int) -> float:
    delay = ARTIFACT_DOWNLOAD_INITIAL_BACKOFF_SECONDS * (2 ** max(attempt_index - 1, 0))
    return min(delay, ARTIFACT_DOWNLOAD_MAX_BACKOFF_SECONDS)


def artifact_download_succeeded(result: dict[str, Any], expected_bytes: bytes | None) -> bool:
    if http_status(result) != 200:
        return False
    actual = artifact_response_bytes(result)
    if actual is None:
        return False
    if expected_bytes is not None:
        return actual == expected_bytes
    return len(actual) > 0


def mark_download_attempt(
    result: dict[str, Any],
    *,
    attempts: int,
    resolved_path: str,
    manifest_path_count: int,
    verified: bool,
) -> dict[str, Any]:
    result["artifact_download_retry"] = {
        "attempts": attempts,
        "resolved_path": resolved_path,
        "manifest_path_count": manifest_path_count,
        "verified": verified,
    }
    return result


def mark_download_retry_failure(
    result: dict[str, Any],
    *,
    attempts: int,
    resolved_path: str,
    manifest_path_count: int,
    expected_bytes: bytes | None,
) -> dict[str, Any]:
    actual = artifact_response_bytes(result)
    if not result.get("error") and http_status(result) == 200:
        if actual in (None, b""):
            result["error"] = "artifact_empty_after_retry"
            result["detail"] = "artifact.download returned 2xx with empty content after read-after-write retries"
        elif expected_bytes is not None and actual != expected_bytes:
            result["error"] = "artifact_content_mismatch_after_retry"
            result["detail"] = "artifact.download returned bytes that did not match the uploaded payload"
        else:
            result["error"] = "artifact_download_retry_exhausted"
            result["detail"] = "artifact.download did not produce verified content before retries were exhausted"
    return mark_download_attempt(
        result,
        attempts=attempts,
        resolved_path=resolved_path,
        manifest_path_count=manifest_path_count,
        verified=False,
    )


def call_artifact_download_with_retry(
    *,
    mcp_url: str,
    token: str,
    identity: dict[str, Any],
    payload: dict[str, Any],
    task_id: str,
    timeout_seconds: float,
    expected_bytes: bytes | None = None,
    initial_paths: list[str] | None = None,
) -> dict[str, Any]:
    method, download_path = operation_path("artifact.download", task_id=task_id)
    _, manifest_path = operation_path("artifact.list", task_id=task_id)
    requested_path = str(payload.get("path") or "")
    candidates = unique_artifact_paths([requested_path, *(initial_paths or [])])
    if not candidates:
        candidates = [requested_path]

    manifest_checked = False
    manifest_paths: list[str] = []
    last_response: dict[str, Any] = {}
    last_resolved_path = candidates[0]
    attempts = max(int(ARTIFACT_DOWNLOAD_RETRY_ATTEMPTS), 1)

    for attempt in range(1, attempts + 1):
        all_candidates_404 = bool(candidates)
        for candidate in candidates:
            download_payload = dict(payload)
            download_payload["path"] = candidate
            last_response = send_runtime_request(
                mcp_url=mcp_url,
                token=token,
                operation="artifact.download",
                identity=identity,
                method=method,
                path=download_path,
                payload=download_payload,
                timeout_seconds=timeout_seconds,
            )
            last_resolved_path = candidate
            if artifact_download_succeeded(last_response, expected_bytes):
                return mark_download_attempt(
                    last_response,
                    attempts=attempt,
                    resolved_path=candidate,
                    manifest_path_count=len(manifest_paths),
                    verified=True,
                )
            all_candidates_404 = all_candidates_404 and http_status(last_response) == 404

        if not manifest_checked:
            manifest_payload = {key: value for key, value in payload.items() if key != "path"}
            manifest_response = send_runtime_request(
                mcp_url=mcp_url,
                token=token,
                operation="artifact.list",
                identity=identity,
                method="GET",
                path=manifest_path,
                payload=manifest_payload,
                timeout_seconds=timeout_seconds,
            )
            manifest_checked = True
            if not response_failed(manifest_response):
                manifest_paths = artifact_paths_from_response(manifest_response)

        resolved = resolve_manifest_artifact_path(requested_path, manifest_paths)
        if resolved:
            candidates = unique_artifact_paths([resolved, *candidates])
        elif all_candidates_404 and manifest_checked:
            return mark_download_attempt(
                last_response,
                attempts=attempt,
                resolved_path=last_resolved_path,
                manifest_path_count=len(manifest_paths),
                verified=False,
            )

        if attempt < attempts:
            time.sleep(retry_delay_seconds(attempt))

    return mark_download_retry_failure(
        last_response,
        attempts=attempts,
        resolved_path=last_resolved_path,
        manifest_path_count=len(manifest_paths),
        expected_bytes=expected_bytes,
    )
