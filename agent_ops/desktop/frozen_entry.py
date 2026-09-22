"""PyInstaller entry point; the packaged bridge is not a general Python runner."""

import sys
from pathlib import Path
from agent_ops.desktop.windows_process import install_window_policy

install_window_policy()

if __name__ == "__main__":
    if Path(sys.executable).name.lower() == "btk-agent-runtime.exe":
        if sys.argv[1:] != ["--run-agent"]:
            raise SystemExit(2)
        from agent_ops.desktop.runtime_host import run_host
        try:
            run_host()
        except (Exception, SystemExit):
            # A GUI-subsystem service must report through its status file, not a
            # bootloader error popup or an accidentally allocated console.
            raise SystemExit(1)
    elif sys.argv[1:] == ["--start-services"]:
        from agent_ops.desktop.setup_runtime import autostart
        autostart()
    elif sys.argv[1:] == ["--remove-startup"]:
        from agent_ops.desktop.setup_runtime import remove_startup
        remove_startup()
    elif sys.argv[1:]:
        raise SystemExit("Unsupported desktop core arguments")
    else:
        from agent_ops.desktop.bridge import main
        main()
