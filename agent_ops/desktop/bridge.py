"""Private stdio bridge owned by the desktop main process. No listening socket."""

from __future__ import annotations

import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from agent_ops.desktop.windows_process import install_window_policy
install_window_policy()

from agent_ops.desktop.service import DesktopService, safe_text
from agent_ops.desktop.package_info import package_info


def main():
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    service = DesktopService()
    output_lock = threading.Lock()

    def send(value):
        with output_lock:
            try:
                print(json.dumps(value, ensure_ascii=False), flush=True)
            except (BrokenPipeError, OSError):
                pass

    def handle(request):
        request_id = request.get("id")
        try:
            result = service.dispatch(request.get("method"), request.get("params", {}),
                                      lambda event: send({"event": "chat", "data": event}))
            send({"id": request_id, "result": result})
        except (Exception, SystemExit) as exc:
            # CLI policy checks use SystemExit; a worker future must still answer its request.
            message = safe_text(str(exc), 400) or "로컬 코어 작업이 중단됐습니다."
            send({"id": request_id, "error": message})

    send({"event": "ready", "data": package_info()})
    with ThreadPoolExecutor(max_workers=4) as pool:
        while True:
            line = sys.stdin.readline(262145)
            if not line:
                break
            if len(line) > 262144:
                break
            try:
                request = json.loads(line)
                if not isinstance(request, dict):
                    raise ValueError()
                pool.submit(handle, request)
            except ValueError:
                send({"id": None, "error": "잘못된 요청 형식입니다."})
    service.cancel()


if __name__ == "__main__":
    main()
