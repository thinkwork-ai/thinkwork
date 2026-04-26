"""Tests for runtime MCP client registration.

These keep the user-memory MCP path honest at the Strands boundary: the API
passes user-scoped ``mcp_configs`` into the container, and the runtime must
turn those configs into streamable-HTTP MCP clients with the configured user
credential in the outbound headers.
"""

from __future__ import annotations

import logging
import sys
from types import ModuleType, SimpleNamespace

import pytest

import _boot_assert

_original_boto3 = sys.modules.get("boto3")
sys.modules["boto3"] = SimpleNamespace(client=lambda *_a, **_kw: None)

_original_check = _boot_assert.check
_boot_assert.check = lambda *a, **kw: None
try:
    import server
finally:
    _boot_assert.check = _original_check
    if _original_boto3 is None:
        sys.modules.pop("boto3", None)
    else:
        sys.modules["boto3"] = _original_boto3


@pytest.fixture
def mcp_import_stubs(monkeypatch):
    created_clients = []
    transport_calls = []

    class FakeMCPClient:
        def __init__(self, factory):
            self.transport = factory()
            created_clients.append(self)

    def fake_streamablehttp_client(*, url, headers):
        transport_calls.append({"url": url, "headers": dict(headers)})
        return {"url": url, "headers": dict(headers)}

    strands_pkg = ModuleType("strands")
    strands_tools_pkg = ModuleType("strands.tools")
    strands_tools_mcp = ModuleType("strands.tools.mcp")
    strands_tools_mcp.MCPClient = FakeMCPClient

    mcp_pkg = ModuleType("mcp")
    mcp_client_pkg = ModuleType("mcp.client")
    streamable_http = ModuleType("mcp.client.streamable_http")
    streamable_http.streamablehttp_client = fake_streamablehttp_client

    monkeypatch.setitem(sys.modules, "strands", strands_pkg)
    monkeypatch.setitem(sys.modules, "strands.tools", strands_tools_pkg)
    monkeypatch.setitem(sys.modules, "strands.tools.mcp", strands_tools_mcp)
    monkeypatch.setitem(sys.modules, "mcp", mcp_pkg)
    monkeypatch.setitem(sys.modules, "mcp.client", mcp_client_pkg)
    monkeypatch.setitem(sys.modules, "mcp.client.streamable_http", streamable_http)

    return created_clients, transport_calls


def test_build_mcp_clients_uses_user_bearer_token(mcp_import_stubs, caplog):
    created_clients, transport_calls = mcp_import_stubs
    caplog.set_level(logging.INFO, logger=server.logger.name)

    clients = server._build_mcp_clients([
        {
            "name": "user-memory",
            "url": "https://mcp.example.test/user-memory",
            "auth": {"type": "bearer", "token": "user-scoped-token"},
        }
    ])

    assert clients == created_clients
    assert transport_calls == [
        {
            "url": "https://mcp.example.test/user-memory",
            "headers": {"Authorization": "Bearer user-scoped-token"},
        }
    ]
    assert "user-scoped-token" not in caplog.text


def test_build_mcp_clients_preserves_api_key_auth(mcp_import_stubs):
    _, transport_calls = mcp_import_stubs

    server._build_mcp_clients([
        {
            "name": "keyed-server",
            "url": "https://mcp.example.test/keyed",
            "auth": {"type": "api-key", "token": "user-api-key"},
        }
    ])

    assert transport_calls == [
        {
            "url": "https://mcp.example.test/keyed",
            "headers": {"x-api-key": "user-api-key"},
        }
    ]


def test_build_mcp_clients_skips_missing_url(mcp_import_stubs, caplog):
    created_clients, transport_calls = mcp_import_stubs
    caplog.set_level(logging.WARNING, logger=server.logger.name)

    clients = server._build_mcp_clients([
        {"name": "broken-user-memory", "auth": {"type": "bearer", "token": "unused"}}
    ])

    assert clients == []
    assert created_clients == []
    assert transport_calls == []
    assert "MCP config has no url" in caplog.text
