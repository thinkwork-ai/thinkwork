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
        self.retrieve_calls = []
        self.memory_records = []

    def batch_create_memory_records(self, **kwargs):
        self.batch_create_calls.append(kwargs)
        return {"failedRecords": []}

    def create_event(self, **kwargs):
        self.create_event_calls.append(kwargs)
        return {}

    def retrieve_memories(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return {"memoryRecordSummaries": self.memory_records}


def _install_boto3(monkeypatch, client):
    monkeypatch.setitem(
        sys.modules,
        "boto3",
        SimpleNamespace(client=lambda *_args, **_kwargs: client),
    )


def test_non_default_space_remember_defaults_to_user_hindsight_bank(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    hindsight_calls = []
    _install_boto3(monkeypatch, client)
    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            retain=lambda **kwargs: hindsight_calls.append(kwargs),
        ),
    )
    memory_tools.set_turn_memory_context(user_id="user-1")

    result = memory_tools.remember("snowflake creds rotated", "general")

    assert result.startswith("Remembered:")
    assert client.batch_create_calls[0]["records"][0]["namespaces"] == ["user_user-1"]
    assert client.create_event_calls[0]["actorId"] == "user-1"
    assert hindsight_calls == [
        {
            "bank_id": "user_user-1",
            "content": "[general] snowflake creds rotated",
            "context": "explicit_memory",
        }
    ]


def test_non_default_space_remember_scope_user_writes_user_bank(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    hindsight_calls = []
    _install_boto3(monkeypatch, client)
    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            retain=lambda **kwargs: hindsight_calls.append(kwargs),
        ),
    )
    memory_tools.set_turn_memory_context(user_id="user-1")

    result = memory_tools.remember(
        "prefers concise summaries", "preference", scope="user"
    )

    assert result.startswith("Remembered:")
    assert client.batch_create_calls[0]["records"][0]["namespaces"] == ["user_user-1"]
    assert client.create_event_calls[0]["actorId"] == "user-1"
    assert hindsight_calls[0]["bank_id"] == "user_user-1"


def test_default_space_remember_routes_to_user_bank_even_with_space_scope(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    hindsight_calls = []
    _install_boto3(monkeypatch, client)
    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            retain=lambda **kwargs: hindsight_calls.append(kwargs),
        ),
    )
    memory_tools.set_turn_memory_context(user_id="user-1")

    memory_tools.remember("default-space note", "general", scope="space")

    assert client.batch_create_calls[0]["records"][0]["namespaces"] == ["user_user-1"]
    assert hindsight_calls[0]["bank_id"] == "user_user-1"


def test_non_user_turn_is_noop_even_with_active_space_env(monkeypatch, caplog):
    memory_tools = _load_memory_tools(monkeypatch)
    _install_boto3(monkeypatch, _FakeAgentCoreClient())
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            retain=lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no retain")),
        ),
    )
    monkeypatch.setenv("ACTIVE_SPACE_ID", "space-finance")
    monkeypatch.setenv("ACTIVE_SPACE_SLUG", "finance")
    monkeypatch.setenv("ACTIVE_SPACE_IS_DEFAULT", "false")
    memory_tools.set_turn_memory_context(user_id="")

    result = memory_tools.remember("private user preference", scope="user")

    assert "Memory not stored" in result
    assert "no invoking user" in caplog.text


def test_recall_uses_user_hindsight_bank_only_for_non_default_space(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    client.memory_records = [{"content": {"text": "managed fact"}, "score": 0.9}]
    hindsight_calls = []
    _install_boto3(monkeypatch, client)
    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            recall=lambda **kwargs: (
                hindsight_calls.append(kwargs)
                or {"results": [{"text": f"fact from {kwargs['bank_id']}"}]}
            ),
        ),
    )
    monkeypatch.setenv("ACTIVE_SPACE_ID", "space-finance")
    monkeypatch.setenv("ACTIVE_SPACE_SLUG", "finance")
    monkeypatch.setenv("ACTIVE_SPACE_IS_DEFAULT", "false")
    memory_tools.set_turn_memory_context(user_id="user-1")

    result = memory_tools.recall("rotation")

    assert "fact from user_user-1" in result
    assert "fact from space_space-finance" not in result
    assert [call["bank_id"] for call in hindsight_calls] == ["user_user-1"]


def test_recall_omits_space_bank_for_default_space(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    hindsight_calls = []
    _install_boto3(monkeypatch, client)
    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            recall=lambda **kwargs: (
                hindsight_calls.append(kwargs) or {"results": []}
            ),
        ),
    )
    memory_tools.set_turn_memory_context(user_id="user-1")

    memory_tools.recall("anything")

    assert [call["bank_id"] for call in hindsight_calls] == ["user_user-1"]


def test_non_user_space_turn_does_not_recall_space_bank(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    hindsight_calls = []
    _install_boto3(monkeypatch, _FakeAgentCoreClient())
    monkeypatch.delenv("AGENTCORE_MEMORY_ID", raising=False)
    monkeypatch.setenv("USER_ID", "stale-user-from-prior-turn")
    monkeypatch.setenv("ACTIVE_SPACE_ID", "space-finance")
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(
            is_available=lambda: True,
            recall=lambda **kwargs: (
                hindsight_calls.append(kwargs) or {"results": [{"text": "space fact"}]}
            ),
        ),
    )
    memory_tools.set_turn_memory_context(user_id="")

    result = memory_tools.recall("nightly job")

    assert result == "Memory system not configured — unable to search."
    assert hindsight_calls == []
