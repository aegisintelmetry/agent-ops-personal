import copy
import ctypes
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from ctypes import wintypes as w
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, patch

from agent_ops.client.config import Profile
from agent_ops.desktop import runtime_host as host
from agent_ops.desktop.windows_runtime import Mutex, mutex_exists, process_identity


class RuntimeHostTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.profile = Profile(name="fixture", mcp_url_configured=True, token_configured=True, runner="fixture.runner", team_id="team-fixture", team_type="dev",
            config_path=self.root / "config.toml", workspace=self.root / "workspaces/fixture", central_profile_id="fixture-id")
        self.owner = {"pid": 12345, "created": 123, "image": "fixture.exe"}

    def record(self):
        data = {"status": "running", "owner": self.owner, "binding": host.binding(self.profile), "instance": "fixture"}
        path = self.root / "state.json"
        path.write_text(json.dumps(data), encoding="utf-8")
        return path

    def test_stale_file_never_proves_liveness(self):
        with patch.object(host, "mutex_exists", return_value=False), patch.object(host, "state_path", return_value=self.record()):
            self.assertEqual(host.status(self.profile)["status"], "stopped")

    def test_pid_reuse_and_profile_mismatch_are_not_running(self):
        with patch.object(host, "mutex_exists", return_value=True), patch.object(host, "state_path", return_value=self.record()):
            with patch.object(host, "process_identity", return_value={**self.owner, "created": 124}):
                self.assertEqual(host.status(self.profile)["status"], "unknown")
            with patch.object(host, "process_identity", return_value=self.owner):
                state = host.status(replace(self.profile, runner="foreign"))
                self.assertEqual(state["status"], "other_profile")

    def test_liveness_does_not_claim_central_heartbeat(self):
        with patch.object(host, "mutex_exists", return_value=True), patch.object(host, "state_path", return_value=self.record()), \
             patch.object(host, "process_identity", return_value=self.owner):
            result = host.status(self.profile)
        self.assertEqual(result["status"], "running")
        self.assertEqual(result["heartbeat_status"], "unknown")

    def test_live_runtime_is_reused_without_spawning(self):
        with patch.object(host, "status", return_value={"status": "running"}), patch.object(host.subprocess, "Popen") as spawn:
            self.assertEqual(host.start(self.profile)["status"], "already_running")
        spawn.assert_not_called()

    def test_uncertain_or_foreign_owner_blocks_start(self):
        for value in ("unknown", "other_profile", "starting"):
            with patch.object(host, "status", return_value={"status": value}), patch.object(host.subprocess, "Popen") as spawn:
                with self.assertRaises(ValueError):
                    host.start(self.profile)
                spawn.assert_not_called()

    def test_runtime_is_packaged_only(self):
        with patch.object(sys, "frozen", False, create=True), self.assertRaises(ValueError):
            host.executable()

    def test_start_honors_same_policy_preflight_and_uses_no_shell(self):
        from agent_ops.desktop import setup_runtime as setup
        child = Mock()
        with patch.object(host, "status", side_effect=[{"status": "stopped"}, {"status": "running"}]), \
             patch.object(setup, "prepare_supervisor") as prepare, patch.object(setup, "runtime_env", return_value={}), \
             patch.object(host, "executable", return_value=self.root / host.HOST_ENTRY), patch.object(host.subprocess, "Popen", return_value=child) as spawn:
            host.start(self.profile)
        prepare.assert_called_once_with(self.profile)
        self.assertEqual(spawn.call_args.args[0][1:], ["--run-agent"])
        self.assertFalse(spawn.call_args.kwargs.get("shell", False))
        self.assertTrue(spawn.call_args.kwargs["creationflags"] & subprocess.CREATE_NO_WINDOW)


@unittest.skipUnless(os.name == "nt", "Windows ownership and window checks")
class WindowsRuntimeTests(unittest.TestCase):
    def test_window_policy_hides_nested_helpers_and_removes_new_console_flag(self):
        from agent_ops.desktop.windows_process import install_window_policy
        class FixturePopen:
            def __init__(self, *args, **kwargs):
                self.options = kwargs
        with patch.object(subprocess, "Popen", FixturePopen):
            install_window_policy()
            wrapped = subprocess.Popen
            install_window_policy()
            self.assertIs(subprocess.Popen, wrapped)
            process = subprocess.Popen(["fixture"], creationflags=subprocess.CREATE_NEW_CONSOLE)
            self.assertTrue(process.options["creationflags"] & subprocess.CREATE_NO_WINDOW)
            self.assertFalse(process.options["creationflags"] & subprocess.CREATE_NEW_CONSOLE)
            self.assertEqual(process.options["startupinfo"].wShowWindow, subprocess.SW_HIDE)

    def test_mutex_excludes_second_owner(self):
        name = f"Local\\BTK.UnitTest.{os.getpid()}.{time.monotonic_ns()}"
        first, second = Mutex(name), Mutex(name)
        try:
            self.assertTrue(first.created)
            self.assertFalse(second.created)
            self.assertTrue(mutex_exists(name))
        finally:
            second.close()
            first.close()
        self.assertFalse(mutex_exists(name))

    def test_process_identity_includes_creation_time(self):
        identity = process_identity(os.getpid())
        self.assertEqual(identity["pid"], os.getpid())
        self.assertGreater(identity["created"], 0)
        self.assertIn(Path(identity["image"]).resolve(), {Path(sys.executable).resolve(), Path(sys._base_executable).resolve()})

    def test_job_query_keeps_descendants_after_intermediate_launcher_exits(self):
        from agent_ops.desktop.windows_runtime import job_process_ids
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "pids.json"
            name = f"Local\\BTK.JobTest.{os.getpid()}.{time.monotonic_ns()}"
            proc = subprocess.Popen([sys.executable, str(Path(__file__).with_name("runtime_fixture.py")),
                                     str(output), name, "exit-parent"], creationflags=subprocess.CREATE_NO_WINDOW,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            pids = []
            try:
                deadline = time.monotonic() + 10
                while not output.exists() and proc.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(output.exists(), "isolated named job fixture did not start")
                pids = json.loads(output.read_text())
                self.assertTrue(set(pids).issubset(job_process_ids(name)))
                self.assertNotIn(os.getpid(), job_process_ids(name))
            finally:
                proc.terminate()
                proc.communicate(timeout=10)
            deadline = time.monotonic() + 5
            while any(process_identity(pid) for pid in pids) and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(all(process_identity(pid) is None for pid in pids))

    def test_owned_tree_has_no_visible_windows_and_dies_with_host(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "pids.json"
            fixture = Path(__file__).with_name("runtime_fixture.py")
            proc = subprocess.Popen([sys.executable, str(fixture), str(output)], creationflags=subprocess.CREATE_NO_WINDOW,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            pids = []
            try:
                deadline = time.monotonic() + 10
                while not output.exists() and proc.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(output.exists(), "isolated job fixture did not start")
                pids = json.loads(output.read_text())
                user32 = ctypes.WinDLL("user32", use_last_error=True)
                callback_type = ctypes.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
                user32.EnumWindows.argtypes = [callback_type, w.LPARAM]
                user32.IsWindowVisible.argtypes = [w.HWND]
                user32.GetWindowThreadProcessId.argtypes = [w.HWND, ctypes.POINTER(w.DWORD)]
                visible = []
                def inspect(hwnd, _):
                    pid = w.DWORD()
                    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    if pid.value in pids and user32.IsWindowVisible(hwnd):
                        visible.append(pid.value)
                    return True
                for _ in range(10):
                    user32.EnumWindows(callback_type(inspect), 0)
                    time.sleep(0.05)
                self.assertEqual(visible, [])
                self.assertTrue(all(process_identity(pid) for pid in pids))
            finally:
                proc.terminate()
                proc.communicate(timeout=10)
            deadline = time.monotonic() + 5
            while any(process_identity(pid) for pid in pids) and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertTrue(all(process_identity(pid) is None for pid in pids), "owned descendants survived host exit")
