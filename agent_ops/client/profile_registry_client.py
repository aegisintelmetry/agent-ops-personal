"""Existing enrollment/progress contract only; no fleet provisioning authority."""
import json
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class ProfileRegistryError(RuntimeError):
    pass


class ProfileRegistryClient:
    def __init__(self, base_url=None, *, actor=None, opener=urlopen, timeout=8):
        parsed = urlsplit(base_url or '')
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or parsed.path.rstrip('/')):
            raise ValueError('An explicit HTTPS registry origin is required')
        if not actor:
            raise ValueError('An explicit enrollment actor is required')
        self.base, self.actor = base_url.rstrip('/'), actor
        self._opener, self.timeout = opener, timeout

    def _call(self, path, payload):
        request = Request(self.base + path, data=json.dumps(payload).encode('utf-8'),
                          headers={'Content-Type': 'application/json', 'X-Actor': self.actor}, method='POST')
        try:
            with self._opener(request, timeout=self.timeout) as response:
                status = response.status
                raw = response.read(2 * 1024 * 1024 + 1)
        except HTTPError as error:
            raise ProfileRegistryError(f'Enrollment request: HTTP {error.code}') from None
        except (URLError, OSError):
            raise ProfileRegistryError('Enrollment service unreachable') from None
        if not 200 <= status < 300 or len(raw) > 2 * 1024 * 1024:
            raise ProfileRegistryError('Invalid enrollment response')
        try:
            result = json.loads(raw)
        except (ValueError, UnicodeError):
            raise ProfileRegistryError('Enrollment response is not JSON') from None
        if not isinstance(result, dict):
            raise ProfileRegistryError('Enrollment response must be an object')
        return result

    def enroll(self, hostname, payload):
        if not re.fullmatch(r'[A-Za-z0-9_.%~-]{1,255}', hostname):
            raise ValueError('Invalid host identifier')
        return self._call(f'/api/hosts/{hostname}/enroll', payload)

    def post_progress(self, deploy_id, event):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', deploy_id):
            raise ValueError('Invalid deployment identifier')
        return self._call(f'/api/deploy/{deploy_id}/progress', event)
