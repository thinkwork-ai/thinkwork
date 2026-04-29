import pytest

import context_engine_tool as cet
from context_engine_tool import make_context_engine_tool, make_context_engine_tools


def identity_tool(fn):
    return fn


@pytest.mark.asyncio
async def test_query_context_validates_empty_query():
    tool = make_context_engine_tool(identity_tool)

    result = await tool("  ")

    assert "non-empty query" in result


@pytest.mark.asyncio
async def test_query_context_reports_disabled_when_api_env_missing(monkeypatch):
    monkeypatch.delenv("THINKWORK_API_URL", raising=False)
    monkeypatch.delenv("THINKWORK_API_SECRET", raising=False)
    monkeypatch.delenv("API_AUTH_SECRET", raising=False)
    monkeypatch.setenv("TENANT_ID", "tenant-1")
    monkeypatch.setenv("USER_ID", "user-1")
    tool = make_context_engine_tool(identity_tool)

    result = await tool("Austin")

    assert "not enabled" in result


def test_context_engine_registers_split_tools():
    tools = make_context_engine_tools(identity_tool)

    assert [tool.__name__ for tool in tools] == [
        "query_context",
        "query_memory_context",
        "query_wiki_context",
    ]


@pytest.mark.asyncio
async def test_query_context_applies_template_provider_config(monkeypatch):
    calls = []

    async def fake_json_rpc(method, params):
        calls.append((method, params))
        return {"content": [{"text": "ok"}]}

    monkeypatch.setattr(cet, "_json_rpc", fake_json_rpc)
    tool = make_context_engine_tool(
        identity_tool,
        {
            "providers": {"ids": ["memory", "wiki"]},
            "providerOptions": {"memory": {"queryMode": "reflect"}},
        },
    )

    result = await tool("Paris")

    assert result == "ok"
    arguments = calls[0][1]["arguments"]
    assert arguments["providers"] == {"ids": ["memory", "wiki"]}
    assert arguments["providerOptions"] == {"memory": {"queryMode": "reflect"}}
