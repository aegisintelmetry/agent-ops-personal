import io
import json
import unittest
from unittest.mock import Mock, patch

from agent_ops.desktop import bridge


class BridgeTests(unittest.TestCase):
    def roundtrip_error(self, error):
        requests = [
            {"id": 1, "method": "setup_enroll", "params": {}},
            {"id": 2, "method": "setup_status", "params": {}},
        ]
        stdin = io.TextIOWrapper(io.BytesIO(
            "".join(json.dumps(row) + "\n" for row in requests).encode("utf-8")), encoding="utf-8")
        output = io.BytesIO()
        stdout = io.TextIOWrapper(output, encoding="utf-8", write_through=True)
        service = Mock()

        def dispatch(method, params, emit):
            if method == "setup_enroll":
                raise error
            return {"status": "idle"}

        service.dispatch.side_effect = dispatch
        with patch.object(bridge.sys, "stdin", stdin), patch.object(bridge.sys, "stdout", stdout), \
                patch.object(bridge, "DesktopService", return_value=service), \
                patch.object(bridge, "package_info", return_value={"version": "fixture"}):
            bridge.main()
        rows = [json.loads(line) for line in output.getvalue().decode("utf-8").splitlines()]
        replies = {row["id"]: row for row in rows if "id" in row}
        self.assertIn(1, replies, "A stopped policy check must reply, not silently time out")
        self.assertTrue(replies[1]["error"], "An empty error would be treated as success by the app")
        self.assertEqual(replies[2]["result"], {"status": "idle"})
        service.cancel.assert_called_once()
        return replies[1]["error"]

    def test_endpoint_system_exit_returns_original_policy_error(self):
        error = "MCP endpoint invalid: inline IPv4 literals are forbidden"
        self.assertIn(error, self.roundtrip_error(SystemExit(error)))

    def test_empty_system_exit_is_not_reported_as_success(self):
        self.roundtrip_error(SystemExit())

    def test_regular_validation_error_still_replies(self):
        self.assertEqual(self.roundtrip_error(ValueError("fixture validation failed")), "fixture validation failed")

    def test_system_exit_keeps_secret_redaction(self):
        message = self.roundtrip_error(SystemExit("Authorization: Bearer fixture-secret-1234567890"))
        self.assertNotIn("fixture-secret-1234567890", message)


if __name__ == "__main__":
    unittest.main()
