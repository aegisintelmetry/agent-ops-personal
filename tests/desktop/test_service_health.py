import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from agent_ops.client.config import Profile
from agent_ops.desktop import service_health as health


class ServiceHealthTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.profile = Profile(name="fixture", runner="runner-test", workspace=root, config_path=root / "config.toml",
                               mcp_url_configured=True, token_configured=True)
        self.since = datetime.now(timezone.utc) - timedelta(seconds=10)
        self.activation = {"status": "started", "instance": "abcdef0123456789abcdef0123456789", "supervisor_pid": 321, "owner_pid": 320}
        self.report = {"repo": str(root), "pass_started_at": datetime.now(timezone.utc).isoformat(),
                       "results": [{"label": k, "status": "started"} for k in health.BASE_LABELS]}
        self.heartbeat = {"status": "idle", "transport": "connected", "heartbeat_age_minutes": 0.1,
                          "last_seen_at": datetime.now(timezone.utc).isoformat()}
        self.path = root / "runs/supervisor/custom.supervisor.json"
        self.path.parent.mkdir(parents=True)
        self.addCleanup(patch.stopall)
        self.owner = patch.object(health.runtime_host, "status", return_value={**self.activation, "status": "running"}).start()
        self.tree = patch.object(health, "process_tree", return_value=[{"component": health.COMPONENTS[k], "pid": i + 1}
                                                                     for i, k in enumerate(health.BASE_LABELS)]).start()
        self.connection = patch("agent_ops.desktop.service.DesktopService.connection", return_value=self.heartbeat).start()
        patch.object(health, "job_process_ids", return_value=[320, 321, *range(1, 20)]).start()

    def observe(self):
        self.path.write_text(json.dumps(self.report), encoding="utf-8")
        return health.observe(self.profile, self.activation, self.since)

    def test_only_all_processes_and_post_start_heartbeat_pass(self):
        result = self.observe()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["heartbeat_age_minutes"], 0.1)

    def test_live_supervisor_does_not_mask_missing_script(self):
        self.report["results"][0]["status"] = "missing_script"
        self.assertEqual(self.observe()["status"], "partial")

    def test_supervisor_report_does_not_replace_actual_process_liveness(self):
        self.tree.return_value = []
        result = self.observe()
        self.assertEqual(result["status"], "partial")
        self.assertTrue(result["missing"])

    def test_missing_report_row_is_not_success(self):
        self.report["results"].pop()
        self.assertEqual(self.observe()["status"], "partial")

    def test_foreign_or_previous_pass_does_not_pass(self):
        for key, value in (("repo", str(self.path.parent)), ("pass_started_at", (self.since - timedelta(seconds=1)).isoformat())):
            original = self.report[key]
            self.report[key] = value
            self.assertEqual(self.observe()["status"], "partial")
            self.report[key] = original

    def test_fresh_but_prelaunch_or_stale_heartbeat_does_not_pass(self):
        for change in ({"heartbeat_age_minutes": 2.1}, {"last_seen_at": self.since.replace(tzinfo=None).isoformat()},
                       {"last_seen_at": (self.since - timedelta(seconds=1)).isoformat()}, {"status": "stopped"}):
            self.connection.return_value = {**self.heartbeat, **change}
            self.assertEqual(self.observe()["status"], "partial")

    def test_owner_instance_change_or_process_probe_failure_does_not_pass(self):
        self.owner.return_value = {**self.activation, "status": "running", "instance": "other"}
        self.assertEqual(self.observe()["status"], "partial")
        self.tree.assert_not_called()
        self.owner.return_value = {**self.activation, "status": "running"}
        self.tree.side_effect = RuntimeError("probe unavailable")
        self.assertIn("probe unavailable", self.observe()["error"])

    def test_verification_stops_at_deadline_without_background_loop(self):
        with patch.object(health, "observe", return_value={"status": "partial"}) as observe:
            self.assertEqual(health.verify(self.profile, self.activation, self.since, timeout=0)["status"], "partial")
            self.assertEqual(observe.call_count, 1)
