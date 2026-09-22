import io
import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock, MagicMock, patch
from urllib.error import HTTPError

from agent_ops.client.config import Profile
from agent_ops.desktop import deployment, setup_runtime as setup


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.profile = Profile(name="desktop-test", runner="runner-test", team_id="team-test",
            mcp_url="https://mcp.invalid/mcp", mcp_url_configured=True, token_configured=True,
            workspace=self.root / "workspaces/desktop-test", config_path=self.root / "config.toml",
            central_url="https://central.invalid/api/harness", central_profile_id="profile-test")
        self.rows = []
        self.response = {"deploy_id": "deploy-test", "runner_id": "runner-test", "hostname": "test10"}
        self.addCleanup(patch.stopall)
        patch.object(deployment, "read_profile_engine_env", return_value={"BTK_BACKEND_TOKEN": "fixture-private"}).start()
        patch.object(deployment.platform, "node", return_value="test10").start()
        self.open = patch.object(deployment, "build_opener").start().return_value.open
        self.open.side_effect = self.respond

    def respond(self, request, **kwargs):
        self.rows.append(request)
        return io.BytesIO(json.dumps(self.response).encode())

    def test_enrollment_uses_existing_contract_https_and_scoped_backend_auth(self):
        self.open.side_effect = None
        response = MagicMock(status=200)
        response.__enter__.return_value = response
        response.read.return_value = json.dumps(self.response).encode()
        self.open.return_value = response
        reporter = deployment.DeploymentReporter(self.profile, "claude")
        result = reporter.enroll()
        request = self.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://central.invalid/api/hosts/test10/enroll")
        self.assertEqual(json.loads(request.data)["runner_id"], "runner-test")
        self.assertEqual(request.get_header("Authorization"), "Bearer fixture-private")
        self.assertNotIn("fixture-private", json.dumps(result))
        self.assertEqual(result["authority"], "/api/deploy/deploy-test")

    def test_no_credential_does_not_fall_back_to_actor_only(self):
        with patch.object(deployment, "read_profile_engine_env", return_value={}), self.assertRaises(ValueError):
            deployment.DeploymentReporter(self.profile, "claude")
        self.open.assert_not_called()

    def test_rejects_insecure_or_unrelated_endpoint(self):
        for url in ("http://central.invalid", "https://central.invalid/unrelated", "https://user:secret@central.invalid"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                deployment.DeploymentReporter(replace(self.profile, central_url=url), "claude")

    def test_backend_denial_is_redacted_and_never_retried_as_another_actor(self):
        self.open.side_effect = HTTPError("https://central.invalid", 403, "forbidden", {}, io.BytesIO(b"fixture-private"))
        reporter = deployment.DeploymentReporter(self.profile, "claude")
        with self.assertRaisesRegex(deployment.ProfileRegistryError, "HTTP 403") as error:
            reporter.enroll()
        self.assertNotIn("fixture-private", str(error.exception))
        self.assertEqual(self.open.call_count, 1)

    def test_binding_and_path_injection_rejected(self):
        for key, value in (("hostname", "other-host"), ("runner_id", "other-runner"), ("deploy_id", "../outside")):
            reporter = deployment.DeploymentReporter(self.profile, "claude")
            with patch.object(reporter.client, "enroll", return_value={**self.response, key: value}), self.assertRaises(ValueError):
                reporter.enroll()
            self.assertEqual(reporter.deploy_id, "")

    def test_progress_requires_matching_acknowledgement(self):
        reporter = deployment.DeploymentReporter(self.profile, "claude")
        reporter.deploy_id = "deploy-test"
        ack = {"id": 1, "deploy_id": "deploy-test", "stage": "runtime", "state": "done"}
        with patch.object(reporter.client, "post_progress", return_value=ack):
            self.assertEqual(reporter.progress("runtime", "done")["event_id"], 1)
        for bad in ({}, {**ack, "deploy_id": "other"}, {**ack, "id": True}, {**ack, "state": "running"}):
            with patch.object(reporter.client, "post_progress", return_value=bad), self.assertRaises(ValueError):
                reporter.progress("runtime", "done")

    def test_reporting_failure_stops_next_installation_action(self):
        manager = setup.SetupManager(Mock())
        manager.state = {"status": "running", "steps": [{"id": "runtime", "status": "pending"}]}
        manager.reporter = Mock()
        manager.reporter.progress.side_effect = RuntimeError("HTTP 403")
        install = Mock()
        with self.assertRaises(RuntimeError):
            manager._step("runtime", install)
        install.assert_not_called()

    def test_unrequested_start_is_reported_as_unrequested(self):
        manager = setup.SetupManager(Mock())
        manager.state = {"status": "running", "steps": [{"id": "start", "status": "pending"}]}
        manager.reporter = Mock()
        start = Mock()
        manager._step("start", start, requested=False)
        start.assert_not_called()
        manager.reporter.progress.assert_called_once_with("start", "done", {"status": "not_requested"})
        self.assertEqual(manager.status()["steps"][0]["status"], "skipped")
