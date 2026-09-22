import ast
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from agent_ops.client import mcp_runtime_client as transport
from agent_ops.client.registry import runner_rows
from agent_ops.client.halt import HaltStateStore
from agent_ops.client.profile_registry_client import ProfileRegistryClient

ROOT = Path(__file__).resolve().parents[2]


class ProductBoundaryTest(unittest.TestCase):
    def test_product_never_imports_operational_harness(self):
        for path in (ROOT / 'agent_ops').rglob('*.py'):
            for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
                if isinstance(node, ast.Import):
                    self.assertFalse(any(name.name.startswith('harness') for name in node.names), str(path))
                elif isinstance(node, ast.ImportFrom):
                    self.assertFalse((node.module or '').startswith('harness'), str(path))

    def test_transport_rejects_fleet_mutations_before_network(self):
        with patch.object(transport, 'urlopen') as opened:
            for operation in ('task.create', 'task.claim', 'task.update_status', 'task.complete',
                              'artifact.upload', 'runner.heartbeat', 'runner.heartbeat.delete', 'question.answer'):
                with self.subTest(operation=operation), self.assertRaises(transport.McpRuntimeError):
                    transport.call_runtime(mcp_url='https://service.invalid/mcp', token='fixture',
                        operation=operation, identity={'runner_id': 'example'}, payload={}, task_id='task')
            opened.assert_not_called()

    def test_read_endpoints_keep_existing_contract(self):
        self.assertEqual(transport.operation_path('runner.heartbeat.list'), ('GET', '/runtime/runner/heartbeat'))
        self.assertEqual(transport.operation_path('artifact.download', task_id='task'),
                         ('GET', '/runtime/task/task/artifact'))
        self.assertEqual(transport.operation_path('artifact.list', task_id='task'),
                         ('GET', '/runtime/task/task/artifact-manifest'))
        with self.assertRaises(transport.McpRuntimeError):
            transport.operation_path('artifact.download', task_id='../task')

    def test_missing_identity_never_calls_server(self):
        with patch.object(transport, 'urlopen') as opened, self.assertRaises(transport.McpRuntimeError):
            transport.call_runtime(mcp_url='https://service.invalid/mcp', token='',
                operation='runner.heartbeat.list', identity={}, payload={})
        opened.assert_not_called()

    def test_read_response_and_headers(self):
        response = io.BytesIO(json.dumps({'heartbeats': []}).encode())
        response.status = 200
        with patch.object(transport, 'urlopen', return_value=response) as opened:
            result = transport.call_runtime(mcp_url='https://service.invalid/mcp', token='fixture',
                operation='runner.heartbeat.list', identity={'runner_id': 'example'}, payload={'limit': 200})
        request = opened.call_args.args[0]
        self.assertEqual(request.full_url, 'https://service.invalid/mcp/runtime/runner/heartbeat?limit=200')
        self.assertEqual(request.get_header('Authorization'), 'Bearer fixture')
        self.assertEqual(result['response'], {'heartbeats': []})

    def test_http_error_does_not_echo_credentials(self):
        error = HTTPError('https://service.invalid', 403, 'forbidden', {}, io.BytesIO(b'fixture-secret'))
        with patch.object(transport, 'urlopen', side_effect=error):
            result = transport.call_runtime(mcp_url='https://service.invalid/mcp', token='fixture-secret',
                operation='runner.heartbeat.list', identity={'runner_id': 'example'}, payload={})
        self.assertNotIn('fixture-secret', json.dumps(result))
        self.assertTrue(transport.response_failed(result))

    def test_artifact_download_preserves_bundle_read_contract(self):
        response = io.BytesIO(json.dumps({'content': 'fixture bundle'}).encode())
        response.status = 200
        with patch.object(transport, 'urlopen', return_value=response) as opened:
            result = transport.call_runtime(mcp_url='https://service.invalid/mcp', token='fixture',
                operation='artifact.download', identity={'runner_id': 'example'},
                payload={'path': 'runs/example/upload/latest.json'}, task_id='example')
        self.assertEqual(result['response']['content'], 'fixture bundle')
        self.assertTrue(result['artifact_download_retry']['verified'])
        self.assertEqual(opened.call_count, 1)

    def test_redirect_is_rejected(self):
        with self.assertRaises(transport.McpRuntimeError):
            transport._NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid')

    def test_registry_requires_explicit_origin_and_has_no_provisioning(self):
        with self.assertRaises(ValueError):
            ProfileRegistryClient(actor='example')
        self.assertFalse(hasattr(ProfileRegistryClient, 'provision'))
        self.assertFalse(hasattr(HaltStateStore, 'append'))

    def test_local_runner_reader_has_no_default_identity_or_token_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = SimpleNamespace(workspace=root)
            self.assertEqual(runner_rows(profile), [])
            directory = root / 'harness/runners'
            directory.mkdir(parents=True)
            (directory / 'example.yaml').write_text('runner_id: example\nexecutor_engine: claude_code\nmcp_headers:\n  Authorization: fixture-secret\n')
            rows = runner_rows(profile)
            self.assertEqual(rows[0]['runner_id'], 'example')
            self.assertEqual(rows[0]['executor_engine'], 'claude_code')
            self.assertNotIn('fixture-secret', json.dumps(rows))
