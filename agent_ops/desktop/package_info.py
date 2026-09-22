"""One release identity shared by the UI and its bundled core."""

import json
import platform
import sys
from pathlib import Path

PROTOCOL_VERSION = 1


def package_info():
    frozen = bool(getattr(sys, "frozen", False))
    if frozen:
        metadata = json.loads((Path(sys._MEIPASS) / "desktop-release.json").read_text(encoding="utf-8"))
    else:
        root = Path(__file__).resolve().parents[2]
        package = json.loads((root / "apps/desktop/package.json").read_text(encoding="utf-8"))
        metadata = {"version": package["version"], "build_id": "source-checkout", "channel": "development"}
    return {"version": metadata["version"], "build_id": metadata["build_id"],
            "channel": metadata["channel"], "protocol_version": PROTOCOL_VERSION,
            "bundled": frozen, "python_version": platform.python_version()}
