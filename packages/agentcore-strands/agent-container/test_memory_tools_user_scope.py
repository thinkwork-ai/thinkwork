from __future__ import annotations

import importlib
import sys
from types import SimpleNamespace


def _load_memory_tools(monkeypatch):
    monkeypatch.setitem(sys.modules, "strands", SimpleNamespace(tool=lambda fn: fn))
    sys.modules.pop("memory_tools", None)
    return importlib.import_module("memory_tools")


class _FakeAgentCoreClient:
    def __init__(self):
        self.batch_create_calls = []
        self.create_event_calls = []

    def batch_create_memory_records(self, **kwargs):
        self.batch_create_calls.append(kwargs)
        return {"failedRecords": []}

    def create_event(self, **kwargs):
        self.create_event_calls.append(kwargs)
        return {}


def test_get_memory_config_uses_current_user_not_agent(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()

    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setenv("AWS_REGION", "us-west-2")
    monkeypatch.setenv("USER_ID", "user-1")
    monkeypatch.setenv("CURRENT_USER_ID", "user-current")
    monkeypatch.setenv("_ASSISTANT_ID", "agent-1")
    monkeypatch.setitem(
        sys.modules,
        "boto3",
        SimpleNamespace(client=lambda service, region_name: client),
    )

    resolved_client, memory_id, actor_id = memory_tools._get_memory_config()

    assert resolved_client is client
    assert memory_id == "memory-1"
    assert actor_id == "user-1"


def test_remember_writes_user_namespace_and_user_hindsight_bank(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    hindsight_calls = []

    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setenv("USER_ID", "user-1")
    monkeypatch.setenv("_ASSISTANT_ID", "agent-1")
    monkeypatch.setenv("_INSTANCE_ID", "agent-instance-1")
    monkeypatch.delenv("CURRENT_THREAD_ID", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "boto3",
        SimpleNamespace(client=lambda *_args, **_kwargs: client),
    )
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            retain=lambda **kwargs: hindsight_calls.append(kwargs),
        ),
    )

    assert memory_tools.remember("prefers concise plans", "preference").startswith(
        "Remembered:"
    )

    record = client.batch_create_calls[0]["records"][0]
    assert record["namespaces"] == ["user_user-1"]
    assert client.create_event_calls[0]["actorId"] == "user-1"
    assert client.create_event_calls[0]["sessionId"] == "memory_user_user-1"
    assert hindsight_calls == [
        {
            "bank_id": "user_user-1",
            "content": "[preference] prefers concise plans",
            "context": "explicit_memory",
        }
    ]


def test_recall_uses_current_user_for_managed_memory_and_hindsight(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    search_calls = []
    hindsight_calls = []

    monkeypatch.setenv("CURRENT_USER_ID", "user-current")
    monkeypatch.setenv("_ASSISTANT_ID", "agent-1")
    monkeypatch.setenv("_INSTANCE_ID", "agent-instance-1")
    monkeypatch.setenv("CURRENT_THREAD_ID", "thread-1")
    monkeypatch.setitem(
        sys.modules,
        "memory",
        SimpleNamespace(
            search_memories=lambda **kwargs: search_calls.append(kwargs)
            or [{"text": "managed fact", "strategy": "semantic"}],
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            recall=lambda **kwargs: hindsight_calls.append(kwargs)
            or {"results": [{"text": "hindsight fact"}]},
        ),
    )

    result = memory_tools.recall("what do I know?")

    assert "managed fact" in result
    assert "hindsight fact" in result
    assert search_calls[0]["actor_id"] == "user-current"
    assert search_calls[0]["session_id"] == "thread-1"
    assert hindsight_calls == [
        {
            "bank_id": "user_user-current",
            "query": "what do I know?",
            "max_tokens": 2000,
        }
    ]
