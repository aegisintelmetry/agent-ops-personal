import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from agent_ops.desktop.build_windows import third_party_notices


class NoticesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in ('react', 'react-dom', 'scheduler', 'lucide-react'):
            folder = self.root / 'node_modules' / name
            folder.mkdir(parents=True)
            (folder / 'package.json').write_text(json.dumps({'version': '1.0.0'}))
            (folder / 'LICENSE').write_text('fixture copyright and license')
        folder = self.root / 'node_modules/electron/dist'
        folder.mkdir(parents=True)
        for name in ('LICENSE', 'LICENSES.chromium.html'):
            (folder / name).write_text('fixture electron notice')
        (self.root / 'LICENSE.txt').write_text('fixture python notice')
        (self.root / 'LICENSE').write_text('fixture distribution notice')

    def test_preserves_license_text_for_all_runtime_components(self):
        distribution = SimpleNamespace(version='1.0.0', files=[Path('LICENSE')],
                                       locate_file=lambda file: self.root / file)
        with patch('agent_ops.desktop.build_windows.importlib.metadata.distribution', return_value=distribution):
            text = third_party_notices(self.root, self.root)
        for name in ('react', 'react-dom', 'scheduler', 'lucide-react', 'Python runtime', 'PyYAML', 'pyinstaller'):
            self.assertIn(name, text)
        self.assertIn('fixture copyright and license', text)
        self.assertIn('fixture distribution notice', text)

    def test_missing_distribution_license_stops_packaging(self):
        with patch('agent_ops.desktop.build_windows.importlib.metadata.distribution',
                   return_value=SimpleNamespace(version='1.0.0', files=[])):
            with self.assertRaisesRegex(ValueError, 'Missing third-party license'):
                third_party_notices(self.root, self.root)
