from __future__ import annotations

import inspect
import asyncio
from types import SimpleNamespace


def _tool(fn):
    return fn


def _vendor_factory(**kwargs):
    def retain() -> str:
        return "retained"

    retain.__name__ = "retain"
    retain._factory_kwargs = kwargs
    return (retain,)


class _FakeClient:
    def __init__(self, *, recall_results=None, reflect_text="reflected", failures=None):
        self.recall_results = recall_results if recall_results is not None else []
        self.reflect_text = reflect_text
        self.failures = failures if failures is not None else []
        self.closed = False
        self.recall_calls = []
        self.reflect_calls = []

    async def arecall(self, **kwargs):
        self.recall_calls.append(kwargs)
        if self.failures:
            raise self.failures.pop(0)
        return SimpleNamespace(results=self.recall_results)

    async def areflect(self, **kwargs):
        self.reflect_calls.append(kwargs)
        if self.failures:
            raise self.failures.pop(0)
        return SimpleNamespace(text=self.reflect_text)

    async def aclose(self):
        self.closed = True


def test_make_hindsight_tools_returns_vendor_and_custom_async_tools():
    from hindsight_tools import make_hindsight_tools

    clients: list[_FakeClient] = []

    def client_factory():
        client = _FakeClient()
        clients.append(client)
        return client

    tools = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        hs_tags=["tenant_id:T1"],
        client_factory=client_factory,
        vendor_factory=_vendor_factory,
    )

    assert [tool.__name__ for tool in tools] == [
        "retain",
        "hindsight_recall",
        "hindsight_reflect",
    ]
    assert inspect.iscoroutinefunction(tools[1])
    assert inspect.iscoroutinefunction(tools[2])
    assert clients[0].closed is False


def test_make_hindsight_tools_missing_endpoint_degrades_to_empty_tuple():
    from hindsight_tools import make_hindsight_tools

    assert make_hindsight_tools(
        _tool,
        hs_endpoint="",
        hs_bank="bank-1",
        vendor_factory=_vendor_factory,
    ) == ()


def test_recall_empty_results_closes_client_and_uses_snapshotted_bank():
    from hindsight_tools import make_hindsight_tools

    clients: list[_FakeClient] = []

    def client_factory():
        client = _FakeClient()
        clients.append(client)
        return client

    _retain, recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=client_factory,
        vendor_factory=_vendor_factory,
    )

    result = asyncio.run(recall("where does Cedric work?"))

    assert result == "No relevant memories found."
    assert clients[-1].closed is True
    assert clients[-1].recall_calls == [
        {
            "bank_id": "bank-1",
            "query": "where does Cedric work?",
            "budget": "low",
            "max_tokens": 1500,
        }
    ]


def test_reflect_retries_transient_failure_and_closes_each_client(monkeypatch):
    from hindsight_tools import make_hindsight_tools

    clients = [
        _FakeClient(failures=[RuntimeError("ServiceUnavailableError")]),
        _FakeClient(reflect_text="Le Jules Verne is the answer"),
    ]
    created = list(clients)

    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr("hindsight_tools.asyncio.sleep", no_sleep)

    def client_factory():
        return clients.pop(0)

    _retain, _recall, reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=client_factory,
        vendor_factory=_vendor_factory,
    )

    result = asyncio.run(reflect("tell me about the restaurant"))

    assert result == "Le Jules Verne is the answer"
    # The first client is retained by the vendor `retain` tool. The custom
    # reflect wrapper must close each per-call client it creates.
    assert created[0].closed is False
    assert all(client.closed for client in created[1:]) is True
