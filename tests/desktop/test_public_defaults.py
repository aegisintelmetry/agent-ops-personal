import os
import unittest
from unittest.mock import patch

from agent_ops.client.config import current_profile
from agent_ops.client import write_safety
from agent_ops.client.agent_chat import chat_target_from_runner


class PublicDefaultsTest(unittest.TestCase):
    def test_unconfigured_profile_has_no_runner_identity(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch('agent_ops.client.config.load_config', return_value={}):
            self.assertEqual(current_profile().runner, '')

    def test_explicit_runner_is_preserved(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch('agent_ops.client.config.load_config', return_value={
                    'profiles': {'default': {'runner_id': 'example.dev.runner'}}}):
            self.assertEqual(current_profile().runner, 'example.dev.runner')

    def test_unknown_team_never_routes_to_privileged_pc2(self):
        self.assertFalse(hasattr(write_safety, 'privileged_runner_hint'))
        self.assertEqual(chat_target_from_runner({}).runner_id, '')
