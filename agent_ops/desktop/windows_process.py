"""Window policy for the desktop's private Python processes, not the fleet."""

import os
import subprocess


def install_window_policy():
    if os.name != "nt" or getattr(subprocess.Popen, "_btk_windowless", False):
        return
    original = subprocess.Popen

    class WindowlessPopen(original):
        _btk_windowless = True

        def __init__(self, *args, **kwargs):
            flags = kwargs.get("creationflags", 0)
            flags &= ~(subprocess.CREATE_NEW_CONSOLE | subprocess.DETACHED_PROCESS)
            kwargs["creationflags"] = flags | subprocess.CREATE_NO_WINDOW
            startup = kwargs.get("startupinfo") or subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = subprocess.SW_HIDE
            kwargs["startupinfo"] = startup
            super().__init__(*args, **kwargs)

    subprocess.Popen = WindowlessPopen
