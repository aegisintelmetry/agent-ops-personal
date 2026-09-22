"""Read explicit installed-runner metadata, never dispatch or infer fleet roles."""
from pathlib import Path
import yaml


def load_yaml(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 1024 * 1024:
        raise ValueError('Registry file is unsafe or too large')
    data = yaml.safe_load(path.read_text(encoding='utf-8-sig')) or {}
    if not isinstance(data, dict):
        raise ValueError('Registry record must be a mapping')
    return data


def runner_rows(profile, *, limit=50):
    root = profile.workspace.resolve()
    directory = root / 'harness/runners'
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise ValueError('Runner registry is outside the configured workspace')
    rows = []
    fields = ('team_id', 'team_type', 'executor_engine', 'executor_command',
              'executor_model_alias', 'executor_model_label', 'executor_effort',
              'executor_cli', 'executor_cli_dialect', 'runner_mode', 'server_role')
    for path in sorted(directory.glob('*.yaml'))[:max(0, min(limit, 500))]:
        if path.is_symlink() or path.resolve().parent != directory.resolve():
            raise ValueError('Runner registry links are not allowed')
        data = load_yaml(path)
        row = {field: str(data.get(field) or '') for field in fields}
        row.update(runner=path.stem, runner_key=path.stem,
                   runner_id=str(data.get('runner_id') or data.get('openh_runner_id') or path.stem),
                   runner_file=path.relative_to(root).as_posix(),
                   default_target_agent=str(data.get('default_target_agent') or 'agent'))
        rows.append(row)
    return rows
