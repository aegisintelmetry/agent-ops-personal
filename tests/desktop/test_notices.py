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
        names = ('react', 'react-dom', 'scheduler', 'lucide-react', 'google-auth-library', 'gaxios')
        (self.root / 'package-lock.json').write_text(json.dumps({'packages': {
            **{f'node_modules/{name}': {} for name in names},
            'node_modules/dev-only': {'dev': True}, '': {}}}))
        for name in names:
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
        for name in ('react', 'react-dom', 'scheduler', 'lucide-react', 'google-auth-library', 'gaxios', 'Python runtime', 'PyYAML', 'pyinstaller'):
            self.assertIn(name, text)
        self.assertIn('fixture copyright and license', text)
        self.assertIn('fixture distribution notice', text)
        self.assertNotIn('dev-only', text)

    def test_missing_oauth_dependency_license_stops_packaging(self):
        (self.root / 'node_modules/google-auth-library/LICENSE').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing third-party license'):
            third_party_notices(self.root, self.root)

    def test_embedded_mit_notice_is_preserved(self):
        folder = self.root / 'node_modules/gaxios'
        (folder / 'LICENSE').unlink()
        (folder / 'package.json').write_text(json.dumps({'version': '1.0.0', 'license': 'MIT'}))
        (folder / 'README.md').write_text('Copyright fixture\nPermission is hereby granted\nTHE SOFTWARE IS PROVIDED\nSOFTWARE OR THE USE')
        distribution = SimpleNamespace(version='1.0.0', files=[Path('LICENSE')], locate_file=lambda file: self.root / file)
        with patch('agent_ops.desktop.build_windows.importlib.metadata.distribution', return_value=distribution):
            self.assertIn('Copyright fixture', third_party_notices(self.root, self.root))

    def test_missing_distribution_license_stops_packaging(self):
        with patch('agent_ops.desktop.build_windows.importlib.metadata.distribution',
                   return_value=SimpleNamespace(version='1.0.0', files=[])):
            with self.assertRaisesRegex(ValueError, 'Missing third-party license'):
                third_party_notices(self.root, self.root)

    def test_lazy_val_fallback_is_version_and_license_scoped(self):
        folder = self.root / 'node_modules/gaxios'
        (folder / 'LICENSE').unlink()
        metadata = {'name': 'lazy-val', 'version': '1.0.5', 'license': 'MIT', 'author': 'Vladimir Krivosheev'}
        (folder / 'package.json').write_text(json.dumps(metadata))
        (self.root / 'third-party').mkdir()
        (self.root / 'third-party/lazy-val-1.0.5.txt').write_text('fixture reviewed MIT declaration')
        distribution = SimpleNamespace(version='1.0.0', files=[Path('LICENSE')], locate_file=lambda file: self.root / file)
        with patch('agent_ops.desktop.build_windows.importlib.metadata.distribution', return_value=distribution):
            self.assertIn('fixture reviewed MIT declaration', third_party_notices(self.root, self.root))
        metadata['version'] = '1.0.6'
        (folder / 'package.json').write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, 'Missing third-party license'):
            third_party_notices(self.root, self.root)
