"""Read the existing published bundle contract; no publishing or task creation."""
from .config import profile_token
from . import mcp_runtime_client as runtime

DEFAULT_UPDATE_TASK_ID = 'btk-cli-latest'


def download_artifact(*, profile, runner, team_id, team_type, mcp_url,
                      task_id, artifact_path, timeout_seconds):
    identity = {'runner_id': runner, 'team_id': team_id, 'team_type': team_type}
    result = runtime.call_runtime(mcp_url=mcp_url, token=profile_token(profile),
        operation='artifact.download', identity=identity,
        payload={'path': artifact_path, 'task_id': task_id}, task_id=task_id,
        question_id='', timeout_seconds=max(float(timeout_seconds), 1), dry_run=False)
    if runtime.response_failed(result):
        raise RuntimeError(f'Artifact download failed: HTTP {runtime.http_status(result)}')
    content = str(runtime.response_body(result).get('content') or result.get('content') or '')
    if not content:
        raise RuntimeError('Artifact download returned no content')
    return content
