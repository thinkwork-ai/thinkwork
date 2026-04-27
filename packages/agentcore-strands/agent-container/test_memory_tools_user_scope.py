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
        self.list_calls = []
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

    def list_memory_records(self, **kwargs):
        self.list_calls.append(kwargs)
        return {"memoryRecordSummaries": self.memory_records}


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

    assert memory_tools.remember("prefers concise plans", "preference").startswith("Remembered:")

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
    client = _FakeAgentCoreClient()
    client.memory_records = [
        {
            "content": {"text": "managed fact"},
            "memoryRecordId": "rec-managed",
            "score": 0.9,
        }
    ]
    hindsight_calls = []

    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setenv("CURRENT_USER_ID", "user-current")
    monkeypatch.setenv("_ASSISTANT_ID", "agent-1")
    monkeypatch.setenv("_INSTANCE_ID", "agent-instance-1")
    monkeypatch.setenv("CURRENT_THREAD_ID", "thread-1")
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
            recall=lambda **kwargs: (
                hindsight_calls.append(kwargs) or {"results": [{"text": "hindsight fact"}]}
            ),
        ),
    )

    result = memory_tools.recall("what do I know?")

    assert "Managed Memory" in result
    assert "managed fact" in result
    assert "Hindsight" in result
    assert "hindsight fact" in result
    assert client.retrieve_calls[0]["namespace"] == "user_user-current"
    assert client.retrieve_calls[0]["searchCriteria"] == {
        "searchQuery": "what do I know?",
        "topK": 10,
    }
    assert hindsight_calls == [
        {
            "bank_id": "user_user-current",
            "query": "what do I know?",
            "max_tokens": 2000,
        }
    ]


def test_recall_falls_back_to_list_for_immediate_managed_memory(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    client.memory_records = [
        {
            "content": {"text": "[general] Casablanca is the restaurant with fish and chips."},
            "memoryRecordId": "rec-casablanca",
        },
        {
            "content": {"text": "[general] unrelated note about coffee."},
            "memoryRecordId": "rec-coffee",
        },
    ]
    client.retrieve_memories = lambda **_kwargs: {"memoryRecordSummaries": []}

    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setenv("CURRENT_USER_ID", "user-current")
    monkeypatch.setitem(
        sys.modules,
        "boto3",
        SimpleNamespace(client=lambda *_args, **_kwargs: client),
    )
    monkeypatch.setitem(
        sys.modules,
        "hs_urllib_client",
        SimpleNamespace(is_available=lambda: False),
    )

    result = memory_tools.recall("Casablanca fish and chips")

    assert "Managed Memory" in result
    assert "Casablanca is the restaurant with fish and chips" in result
    assert "unrelated note" not in result
    assert client.list_calls[0]["namespace"] == "user_user-current"


def test_recall_fans_out_to_user_scoped_wiki(monkeypatch):
    memory_tools = _load_memory_tools(monkeypatch)
    client = _FakeAgentCoreClient()
    client.memory_records = [
        {
            "content": {"text": "managed favorite is Le Jules Verne"},
            "memoryRecordId": "rec-managed",
            "score": 0.93,
        }
    ]
    hindsight_calls = []
    wiki_calls = []

    async def search_wiki_for_user(**kwargs):
        wiki_calls.append(kwargs)
        return [
            {
                "score": 0.87,
                "matchedAlias": "Paris",
                "page": {
                    "id": "wiki-1",
                    "type": "ENTITY",
                    "slug": "le-jules-verne",
                    "title": "Le Jules Verne",
                    "summary": "User-liked restaurant in Paris.",
                    "lastCompiledAt": "2026-04-26T00:00:00Z",
                },
            }
        ]

    monkeypatch.setenv("AGENTCORE_MEMORY_ID", "memory-1")
    monkeypatch.setenv("CURRENT_USER_ID", "user-current")
    monkeypatch.setenv("TENANT_ID", "tenant-1")
    monkeypatch.setenv("_ASSISTANT_ID", "agent-1")
    monkeypatch.setenv("CURRENT_THREAD_ID", "thread-1")
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
            recall=lambda **kwargs: (
                hindsight_calls.append(kwargs)
                or {"results": [{"text": "hindsight favorite is Le Jules Verne"}]}
            ),
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "wiki_tools",
        SimpleNamespace(search_wiki_for_user=search_wiki_for_user),
    )

    result = memory_tools.recall("favorite restaurant in Paris")

    assert "Managed Memory" in result
    assert "managed favorite is Le Jules Verne" in result
    assert "Hindsight" in result
    assert "hindsight favorite is Le Jules Verne" in result
    assert "Wiki" in result
    assert "Le Jules Verne" in result
    assert "User-liked restaurant in Paris." in result
    assert client.retrieve_calls[0]["namespace"] == "user_user-current"
    assert hindsight_calls[0]["bank_id"] == "user_user-current"
    assert wiki_calls == [
        {
            "tenant_id": "tenant-1",
            "owner_id": "user-current",
            "query": "favorite restaurant in Paris",
            "limit": 5,
        }
    ]
