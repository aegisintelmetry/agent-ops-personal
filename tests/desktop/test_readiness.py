import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_ops.client.config import Profile
from agent_ops.desktop.service import DesktopService
from agent_ops.desktop.readiness import readiness, process_observation


class ReadinessTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.profile = Profile(name='new-pc', mcp_url_configured=False, token_configured=False,
                               runner='pc2-harness-privileged-runner', workspace=self.root,
                               config_path=self.root / 'config.toml')

    def test_fresh_desktop_never_inherits_cli_default_pc2_identity(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch('agent_ops.desktop.service.current_profile', return_value=self.profile), \
             patch('agent_ops.desktop.service.load_config', return_value={}), \
             patch('agent_ops.desktop.service.read_chat_settings', return_value={}), \
             patch('agent_ops.desktop.service.runtime.call_runtime') as call:
            service = DesktopService()
            snapshot = service.snapshot()
            self.assertEqual(snapshot['profile']['runner'], '')
            self.assertTrue(snapshot['registration_required'])
            self.assertFalse(snapshot['chat']['available'])
            self.assertEqual(service.connection()['transport'], 'unconfigured')
            call.assert_not_called()

    def test_explicit_profile_identity_is_reused(self):
        with patch.dict(os.environ, {}, clear=True), \
             patch('agent_ops.desktop.service.current_profile', return_value=self.profile), \
             patch('agent_ops.desktop.service.load_config', return_value={'profiles': {'new-pc': {'runner_id': self.profile.runner}}}):
            self.assertEqual(DesktopService().profile().runner, self.profile.runner)

    def test_runtime_identity_comes_from_workspace_registry(self):
        path = self.root / 'harness/runners/runner.yaml'
        path.parent.mkdir(parents=True)
        path.write_text('runner_id: team-02.dev.runner\nteam_id: team-02\nteam_type: dev\n', encoding='utf-8')
        service = DesktopService(profile=self.profile)
        with patch('agent_ops.desktop.service.runner_rows', return_value=[{
            'runner': self.profile.runner, 'runner_file': 'harness/runners/runner.yaml'}]):
            identity = service.runtime_identity(self.profile)
        self.assertEqual(identity['runner_id'], 'team-02.dev.runner')
        self.assertEqual(identity['team_id'], 'team-02')

    def test_runtime_identity_rejects_external_registry_path(self):
        service = DesktopService(profile=self.profile)
        with patch('agent_ops.desktop.service.runner_rows', return_value=[{
            'runner': self.profile.runner, 'runner_file': '../outside.yaml'}]), self.assertRaises(ValueError):
            service.runtime_identity(self.profile)

    def test_workspace_endpoint_fallback_preserves_environment_precedence(self):
        endpoint = self.root / 'harness/runtime/mcp-endpoint.yaml'
        endpoint.parent.mkdir(parents=True)
        endpoint.write_text('mcp_url: https://workspace.invalid/mcp\n', encoding='utf-8')
        service = DesktopService(profile=self.profile)
        with patch.dict(os.environ, {}, clear=True), patch('agent_ops.desktop.service.resolve_mcp_url', return_value='ok') as resolve:
            service.endpoint(self.profile)
            resolve.assert_called_once_with('https://workspace.invalid/mcp')
        with patch.dict(os.environ, {'BTK_MCP_URL': 'https://env.invalid/mcp'}, clear=True), \
             patch('agent_ops.desktop.service.resolve_mcp_url', return_value='ok') as resolve:
            service.endpoint(self.profile)
            resolve.assert_called_once_with()

    def test_readiness_never_starts_or_stops_services(self):
        service = DesktopService(profile=self.profile)
        with patch('agent_ops.desktop.readiness.process_observation', return_value={'status': 'observed', 'processes': [], 'reason': ''}), \
             patch('agent_ops.desktop.service.read_chat_settings', return_value={}), \
             patch.object(service, 'endpoint', side_effect=ValueError('invalid endpoint')):
            result = readiness(service)
        self.assertFalse(result['service_actions_enabled'])
        self.assertTrue(result['requires_attention'])
        self.assertEqual(result['process_observation']['processes'], [])
        self.assertEqual(result['process_observation']['control_owner'], 'existing_supervisor')
        self.assertEqual(next(row for row in result['checks'] if row['id'] == 'endpoint')['detail'], 'invalid endpoint')

    def test_failed_process_observation_does_not_claim_zero_live_services(self):
        with patch('agent_ops.desktop.readiness.platform.system', return_value='Windows'), \
             patch('agent_ops.desktop.readiness.subprocess.run', side_effect=subprocess.TimeoutExpired('fixed-probe', 6)):
            result = process_observation()
        self.assertEqual(result['status'], 'unknown')
        self.assertIn('TimeoutExpired', result['reason'])

    def test_process_probe_returns_only_allowlisted_fields(self):
        completed = subprocess.CompletedProcess([], 0, json.dumps([{
            'component': 'a2a_chat_responder.py', 'pid': 123, 'parent_pid': 12,
            'commandline': 'must-not-reach-renderer'}]), '')
        with patch('agent_ops.desktop.readiness.platform.system', return_value='Windows'), \
             patch('agent_ops.desktop.readiness.subprocess.run', return_value=completed):
            result = process_observation()
        self.assertEqual(result['status'], 'observed')
        self.assertNotIn('must-not-reach-renderer', json.dumps(result))

    def test_ui_coalesces_process_reads_but_preserves_observation_time(self):
        service = DesktopService(profile=self.profile)
        with patch('agent_ops.desktop.readiness.process_observation', return_value={'status': 'observed', 'processes': [], 'reason': ''}) as probe, \
             patch('agent_ops.desktop.service.read_chat_settings', return_value={}), patch.object(service, 'endpoint', return_value='https://fixture.invalid'):
            first, second = readiness(service), readiness(service)
        self.assertEqual(probe.call_count, 1)
        self.assertFalse(first['process_observation']['cached'])
        self.assertTrue(second['process_observation']['cached'])
        self.assertEqual(first['process_observation']['observed_at'], second['process_observation']['observed_at'])

    def test_failed_ui_process_probe_is_not_cached(self):
        service = DesktopService(profile=self.profile)
        with patch('agent_ops.desktop.readiness.process_observation', return_value={'status': 'unknown', 'processes': [], 'reason': 'fixture'}) as probe, \
             patch('agent_ops.desktop.service.read_chat_settings', return_value={}), patch.object(service, 'endpoint', return_value='https://fixture.invalid'):
            readiness(service)
            readiness(service)
        self.assertEqual(probe.call_count, 2)


if __name__ == '__main__':
    unittest.main()
