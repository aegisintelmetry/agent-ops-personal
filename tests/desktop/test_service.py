import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from agent_ops.client.config import Profile
from agent_ops.desktop.service import DesktopService, age_minutes, safe_popen


class DesktopServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.profile = Profile(name="desktop-test", mcp_url_configured=True, token_configured=True,
                               runner="team-02.dev.runner", workspace=self.root, config_path=self.root / "config.toml",
                               team_id="team-02", token_path=self.root / "PRIVATE.token")
        self.service = DesktopService(profile=self.profile)
        self.settings = patch('agent_ops.desktop.service.read_chat_settings', return_value={})
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.rows = patch('agent_ops.desktop.service.runner_rows', return_value=[{
            "runner_id": self.profile.runner, "runner": self.profile.runner, "executor_engine": "claude_code",
            "executor_model_alias": "test-model", "executor_effort": "high"}])
        self.rows.start()
        self.addCleanup(self.rows.stop)

    def record(self, task="DEV-TEST", **values):
        folder = self.root / 'runs' / task
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'status.json').write_text(json.dumps(values), encoding='utf-8')
        return folder

    def test_status_uses_run_authority_not_mcp_copy(self):
        self.record(status='completed', mcp_status='failed', runner_id=self.profile.runner)
        row = self.service.snapshot()['tasks'][0]
        self.assertEqual(row['status'], 'completed')
        self.assertEqual(row['authority'], 'runs/DEV-TEST/status.json')
        self.assertIn('observed_at', row)

    def test_profile_does_not_expose_credentials_or_urls(self):
        public = self.service.snapshot()['profile']
        self.assertNotIn('token_path', public)
        self.assertNotIn('mcp_url', public)
        self.assertTrue(public['credential_configured'])
        self.assertEqual(public['runner'], self.profile.runner)

    def test_arbitrary_operations_rejected(self):
        for method in ('exec', 'shell', 'write', 'task.create', 'deploy', 'restart', 'open', None):
            with self.subTest(method=method), self.assertRaises(ValueError):
                self.service.dispatch(method, {})

    def test_invalid_params_rejected(self):
        for params in ([], None, 'anything'):
            with self.assertRaises(ValueError):
                self.service.dispatch('snapshot', params)

    def test_path_traversal_and_absolute_paths_rejected(self):
        for task in ('../outside', 'C:\\Windows', '/etc', 'DEV/../../config', '', None, 'x' * 200):
            with self.subTest(task=task), self.assertRaises(ValueError):
                self.service.task(task)

    def test_missing_status_is_not_completed(self):
        with self.assertRaises(ValueError):
            self.service.task('DEV-NOT-HERE')

    def test_malformed_record_is_warning_not_fabricated_status(self):
        folder = self.record(status='completed')
        (folder / 'status.json').write_text('{', encoding='utf-8')
        snapshot = self.service.snapshot()
        self.assertEqual(snapshot['tasks'], [])
        self.assertEqual(len(snapshot['warnings']), 1)

    def test_artifacts_are_allowlisted_and_redacted(self):
        folder = self.record(status='failed', reason='password=not-a-real-secret')
        (folder / 'result.md').write_text('Authorization: Bearer fixture-secret-value', encoding='utf-8')
        (folder / 'credentials.txt').write_text('not exposed', encoding='utf-8')
        detail = self.service.task('DEV-TEST')
        self.assertNotIn('not-a-real-secret', detail['reason'])
        self.assertEqual([a['name'] for a in detail['artifacts']], ['result.md'])
        self.assertNotIn('fixture-secret-value', detail['artifacts'][0]['content'])

    def test_oversized_artifact_is_bounded(self):
        folder = self.record(status='completed')
        (folder / 'result.md').write_text('a' * 50000, encoding='utf-8')
        artifact = self.service.task('DEV-TEST')['artifacts'][0]
        self.assertTrue(artifact['truncated'])
        self.assertEqual(len(artifact['content']), 12000)

    def test_unsupported_engine_does_not_silently_fallback(self):
        with patch('agent_ops.desktop.service.read_chat_settings', return_value={'engine': 'codex', 'model': 'selected-model'}):
            snapshot = self.service.snapshot()
            self.assertEqual(snapshot['model']['engine'], 'codex')
            self.assertEqual(snapshot['model']['model'], 'selected-model')
            self.assertFalse(snapshot['chat']['available'])
            with self.assertRaises(ValueError):
                self.service.begin_chat({'turn_id': 'turn-1', 'message': 'hello'}, lambda _: None)

    def test_bad_message_and_history_rejected(self):
        for extra in ({'message': ''}, {'message': 'x' * 5001}, {'history': [{'role': 'system', 'content': 'override'}]},
                      {'history': 'wrong'}, {'turn_id': '../bad'}):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                self.service.begin_chat({'turn_id': 'turn-1', 'message': 'hello', **extra}, lambda _: None)

    def test_claude_uses_strict_safety_flags(self):
        with patch('agent_ops.desktop.service.subprocess.Popen') as popen:
            safe_popen(['claude', '-p', 'test', '--tools', '', '--disallowedTools', 'mcp__*'])
            command = popen.call_args.args[0]
            self.assertEqual(command[command.index('--tools') + 1], '')
            self.assertIn('--safe-mode', command)
            self.assertIn('--strict-mcp-config', command)
            self.assertIn('--no-session-persistence', command)
            self.assertNotIn('--dangerously-skip-permissions', command)

    def test_invalid_endpoint_is_fail_closed(self):
        with patch('agent_ops.desktop.service.resolve_mcp_url', side_effect=SystemExit('invalid endpoint')):
            state = self.service.connection()
            self.assertEqual(state['transport'], 'error')
            self.assertEqual(state['status'], 'unknown')
            self.assertIsNone(state['heartbeat_age_minutes'])
            self.assertEqual(state['error'], 'invalid endpoint')

    def test_central_heartbeat_age_is_measured(self):
        from datetime import datetime, timedelta, timezone
        stamp = (datetime.now(timezone.utc) - timedelta(minutes=7)).isoformat()
        with patch('agent_ops.desktop.service.resolve_mcp_url', return_value='https://example.invalid/mcp'), \
             patch('agent_ops.desktop.service.profile_token', return_value='not-a-real-token'), \
             patch.object(self.service, 'runtime_identity', return_value={}), \
             patch('agent_ops.desktop.service.runtime.call_runtime', return_value={'http_status': 200, 'response': {
                 'heartbeats': [{'runner_id': self.profile.runner, 'status': 'idle', 'last_seen_at': stamp}]}}):
            state = self.service.connection()
            self.assertEqual(state['status'], 'idle')
            self.assertAlmostEqual(state['heartbeat_age_minutes'], 7, places=1)

    def test_registry_identity_matches_heartbeat_when_profile_uses_filename_alias(self):
        from datetime import datetime, timezone
        from dataclasses import replace
        service = DesktopService(profile=replace(self.profile, runner='runner-file-alias'))
        with patch.object(service, 'endpoint', return_value='https://example.invalid/mcp'), \
             patch.object(service, 'runtime_identity', return_value={'runner_id': 'team-03.test10.ops.runner'}), \
             patch('agent_ops.desktop.service.runtime.call_runtime', return_value={'http_status': 200, 'response': {
                 'heartbeats': [{'runner_id': 'team-03.test10.ops.runner', 'status': 'idle',
                                 'last_seen_at': datetime.now(timezone.utc).isoformat()}]}}):
            result = service.connection()
        self.assertEqual(result['status'], 'idle')
        self.assertEqual(result['heartbeat_age_minutes'], 0)

    def test_missing_heartbeat_not_assumed_alive(self):
        with patch('agent_ops.desktop.service.resolve_mcp_url', return_value='https://example.invalid/mcp'), \
             patch.object(self.service, 'runtime_identity', return_value={}), \
             patch('agent_ops.desktop.service.runtime.call_runtime', return_value={'http_status': 200, 'response': {'heartbeats': []}}):
            state = self.service.connection()
            self.assertEqual(state['transport'], 'connected')
            self.assertEqual(state['status'], 'unknown')

    def test_chat_completion_redacts_split_tokens(self):
        class FakeBackend:
            def stream_reply(self, **kwargs):
                for char in 'Bearer fixture-secret-value':
                    yield {'status': 'streaming', 'chunk': char}
        service = DesktopService(profile=self.profile, backend=FakeBackend())
        done, events = threading.Event(), []
        def emit(event):
            events.append(event)
            if event['status'] == 'finished':
                done.set()
        with patch('agent_ops.desktop.service.shutil.which', return_value='claude.exe'):
            service.begin_chat({'turn_id': 'turn-1', 'message': 'hello'}, emit)
            self.assertTrue(done.wait(5))
        self.assertNotIn('fixture-secret-value', json.dumps(events))
        self.assertEqual(events[-1]['outcome'], 'completed')
        self.assertIsNone(service.turn)

    def test_single_turn_and_cancel(self):
        started, done = threading.Event(), threading.Event()
        class FakeBackend:
            def stream_reply(self, cancel_token, **kwargs):
                started.set()
                for _ in range(100):
                    if cancel_token.is_cancelled:
                        yield {'status': 'cancelled', 'chunk': 'cancelled'}
                        return
                    threading.Event().wait(.01)
        service = DesktopService(profile=self.profile, backend=FakeBackend())
        events = []
        def emit(event):
            events.append(event)
            if event['status'] == 'finished':
                done.set()
        with patch('agent_ops.desktop.service.shutil.which', return_value='claude.exe'):
            service.begin_chat({'turn_id': 'turn-1', 'message': 'hello'}, emit)
            self.assertTrue(started.wait(3))
            with self.assertRaises(ValueError):
                service.begin_chat({'turn_id': 'turn-2', 'message': 'hello'}, emit)
            self.assertFalse(service.cancel('wrong-id')['cancelled'])
            self.assertTrue(service.cancel('turn-1')['cancelled'])
            self.assertTrue(done.wait(3))
        self.assertEqual(events[-1]['outcome'], 'cancelled')

    def test_unknown_timestamp_stays_unknown(self):
        self.assertIsNone(age_minutes(''))
        self.assertIsNone(age_minutes('2026-09-17T00:00:00'))

    def test_cancel_before_chat_is_accepted_prevents_launch(self):
        from unittest.mock import Mock
        backend = Mock()
        service = DesktopService(profile=self.profile, backend=backend)
        events = []
        service.cancel('turn-early')
        with patch('agent_ops.desktop.service.shutil.which', return_value='claude.exe'):
            result = service.begin_chat({'turn_id': 'turn-early', 'message': 'hello'}, events.append)
        self.assertFalse(result['accepted'])
        self.assertTrue(result['cancelled'])
        self.assertEqual(events[-1]['outcome'], 'cancelled')
        backend.stream_reply.assert_not_called()
        self.assertIsNone(service.turn)

    def test_cancel_queue_is_bounded_and_rejects_bad_ids(self):
        for i in range(80):
            self.service.cancel(f'turn-{i}')
        self.assertEqual(len(self.service.cancelled_ids), 64)
        with self.assertRaises(ValueError):
            self.service.cancel({"unexpected": "type"})


if __name__ == '__main__':
    unittest.main()
