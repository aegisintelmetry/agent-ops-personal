"""Isolated test tree. Never loads a runner profile or makes a network request."""

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from agent_ops.desktop.windows_process import install_window_policy
from agent_ops.desktop.windows_runtime import OwnedJob

install_window_policy()
job = OwnedJob(sys.argv[2] if len(sys.argv) > 2 else None)
code = "import subprocess,time,os,json; p=subprocess.Popen(['cmd.exe','/c','ping -n 60 127.0.0.1 >nul']); print(json.dumps([os.getpid(),p.pid]),flush=True); time.sleep(60)"
child = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
pids = json.loads(child.stdout.readline())
if len(sys.argv) > 3 and sys.argv[3] == "exit-parent":
    child.terminate()
    child.wait(timeout=5)
    pids = pids[1:]
Path(sys.argv[1]).write_text(json.dumps([os.getpid(), *pids]), encoding="utf-8")
time.sleep(60)
