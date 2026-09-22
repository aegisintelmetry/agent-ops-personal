"""Build only the desktop core, never copy workspaces, profiles, or run data."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import os
import importlib.metadata
import ast
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps/desktop"
STAGE = APP / "stage"


def verify_product_boundary(root=ROOT):
    for path in (root / 'agent_ops').rglob('*.py'):
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
            names = [item.name for item in node.names] if isinstance(node, ast.Import) else (
                [node.module or ''] if isinstance(node, ast.ImportFrom) else [])
            if any(name == 'harness' or name.startswith('harness.') for name in names):
                raise ValueError(f'Operational harness import in product: {path.relative_to(root)}')


def third_party_notices(app=APP, python_root=None):
    sections = ["AEGIS Agent Ops - third-party notices\nGenerated from installed build dependencies.\n"]
    lock = json.loads((app / 'package-lock.json').read_text(encoding='utf-8'))
    for relative, info in sorted(lock['packages'].items()):
        if not relative or info.get('dev'):
            continue
        directory = (app / relative).resolve()
        if not directory.is_relative_to((app / 'node_modules').resolve()):
            raise ValueError('Dependency license path escapes node_modules')
        package = json.loads((directory / "package.json").read_text(encoding="utf-8"))
        licenses = [file for file in directory.iterdir() if file.is_file()
                    and file.name.lower().startswith(('license', 'licence', 'copying', 'notice'))]
        # Some npm tarballs carry the complete MIT notice only in their README.
        if not licenses and package.get('license') == 'MIT':
            readme = directory / 'README.md'
            text = readme.read_text(encoding='utf-8') if readme.exists() else ''
            if all(marker in text for marker in ('Copyright', 'Permission is hereby granted',
                                                 'THE SOFTWARE IS PROVIDED', 'SOFTWARE OR THE USE')):
                licenses = [readme]
        if not licenses:
            raise ValueError(f'Missing third-party license: {relative}')
        for file in sorted(licenses):
            license_text = file.read_text(encoding='utf-8')
            sections.append(f"\n## {package.get('name', relative)} {package['version']} / {file.name}\n\n{license_text}")
    electron = app / "node_modules/electron"
    for name in ("LICENSE", "LICENSES.chromium.html"):
        sections.append(f"\n## Electron / {name}\n\n" + (electron / "dist" / name).read_text(encoding="utf-8"))
    root = Path(python_root or sys.base_prefix)
    sections.append("\n## Python runtime\n\n" + (root / "LICENSE.txt").read_text(encoding="utf-8"))
    for name in ("PyYAML", "pyinstaller"):
        distribution = importlib.metadata.distribution(name)
        licenses = [file for file in distribution.files or []
                    if file.name.lower().startswith(("license", "copying", "notice"))]
        if not licenses:
            raise ValueError(f"Missing third-party license: {name}")
        for file in licenses:
            text = distribution.locate_file(file).read_text(encoding="utf-8")
            sections.append(f"\n## {name} {distribution.version} / {file.name}\n\n{text}")
    return "\n".join(sections)


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def file_rows(directory):
    rows = []
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("Package symlinks are not allowed")
        if not path.is_file():
            continue
        if path.suffix.lower() in {".token", ".key", ".pfx", ".p12", ".env"} or path.name.startswith(".env"):
            raise ValueError("Credential-like file found in package")
        rows.append({"path": path.relative_to(directory).as_posix(), "sha256": digest(path), "bytes": path.stat().st_size})
    return rows


def main():
    verify_product_boundary()
    if sys.platform != "win32":
        raise SystemExit("Windows packages must be built on Windows.")
    package = json.loads((APP / "package.json").read_text(encoding="utf-8"))
    build_id = datetime.now(timezone.utc).strftime("desktop-%Y%m%dT%H%M%SZ")
    work = APP / ".build" / build_id
    work.mkdir(parents=True)
    STAGE.mkdir(exist_ok=True)
    built = STAGE / "btk-desktop-core"
    # PyInstaller replaces its own output on rebuild; never follow a redirected stage path.
    if STAGE.resolve() != APP.resolve() / "stage" or built.resolve().parent != STAGE.resolve() or built.is_symlink():
        raise ValueError("Unsafe PyInstaller output path")
    notices = STAGE / "THIRD-PARTY-NOTICES.txt"
    if notices.is_symlink():
        raise ValueError("Unsafe notices output path")
    notices.write_text(third_party_notices(), encoding="utf-8")
    metadata = {"schema": "btk.desktop.release.v1", "version": package["version"],
                "protocol_version": 1, "build_id": build_id, "channel": "local-preview",
                "signed": False, "fleet_bundle": "not_published",
                "created_at": datetime.now(timezone.utc).isoformat()}
    metadata_file = work / "desktop-release.json"
    metadata_file.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    command = [sys.executable, "-m", "PyInstaller", "--noconfirm",
               "--distpath", str(STAGE), "--workpath", str(work / "work"),
               str(APP / "core.spec")]
    subprocess.run(command, cwd=ROOT, check=True, env=dict(os.environ, BTK_DESKTOP_BUILD_METADATA=str(metadata_file)))
    rows = file_rows(built)
    metadata["core"] = {"entry": "btk-desktop-core.exe", "runtime_entry": "btk-agent-runtime.exe", "files": rows}
    (STAGE / "desktop-release.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps({"version": metadata["version"], "build_id": build_id, "core_files": len(rows)}))


if __name__ == "__main__":
    main()
