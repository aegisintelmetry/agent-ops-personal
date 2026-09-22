"""Resolve an explicitly configured endpoint without deployment defaults."""
import os
import socket
from pathlib import Path
from urllib.parse import urlsplit
from .registry import load_yaml

ROOT = Path(__file__).resolve().parents[2]
ENDPOINT_FILE = ROOT / 'harness/runtime/mcp-endpoint.yaml'


def resolve_mcp_url(cli_value='', env=None):
    values = os.environ if env is None else env
    candidate = (cli_value or values.get('BTK_MCP_URL') or values.get('BTK_MCP_RUNTIME_URL') or '').strip()
    if not candidate and ENDPOINT_FILE.is_file():
        candidate = str(load_yaml(ENDPOINT_FILE).get('mcp_url') or '').strip()
    if not candidate:
        raise SystemExit('MCP endpoint unset: configure the service connection first')
    parsed = urlsplit(candidate)
    if (parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment):
        raise SystemExit('MCP endpoint invalid: expected an HTTP(S) URL without credentials or query')
    try:
        socket.inet_aton(parsed.hostname)
    except OSError:
        pass
    else:
        raise SystemExit('MCP endpoint invalid: inline IPv4 literals are forbidden')
    return candidate.rstrip('/')
