from pathlib import Path
import os

root = Path(SPECPATH).parents[1]
analysis = Analysis(
    [str(root / 'agent_ops/desktop/frozen_entry.py')],
    pathex=[str(root)], binaries=[],
    datas=[(os.environ['BTK_DESKTOP_BUILD_METADATA'], '.')],
    hiddenimports=['yaml'], hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=['harness'], noarchive=False,
)
if any(name == 'harness' or name.startswith('harness.') for name, *_ in analysis.pure):
    raise ValueError('Operational harness modules must not enter the product package')
pyz = PYZ(analysis.pure)
core = EXE(pyz, analysis.scripts, [], exclude_binaries=True,
    name='btk-desktop-core', console=True, debug=False, strip=False, upx=False)
runtime = EXE(pyz, analysis.scripts, [], exclude_binaries=True,
    name='btk-agent-runtime', console=False, debug=False, strip=False, upx=False)
collect = COLLECT(core, runtime, analysis.binaries, analysis.datas,
    strip=False, upx=False, name='btk-desktop-core')
