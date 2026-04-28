"""Tests for ``hindsight_tools.make_hindsight_tools`` after U8/U9/U10.

After the cleanup:
- The factory builds three custom async wrappers (``retain``,
  ``hindsight_recall``, ``hindsight_reflect``) — no vendor tool branch.
- ``retain`` and ``hindsight_reflect`` push Bedrock token usage in-body via
  ``hindsight_usage_capture._push``. ``hindsight_recall`` does NOT push
  (no Bedrock cost on the recall path).
- The retain/reflect Bedrock model IDs are snapshotted from env at
  registration time and used as closure values; subsequent env mutation
  does not affect the captured value.
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace
from unittest.mock import patch


def _tool(fn):
    return fn


class _FakeClient:
    def __init__(
        self,
        *,
        recall_results=None,
        reflect_text="reflected",
        retain_response=None,
        failures=None,
    ):
        self.recall_results = recall_results if recall_results is not None else []
        self.reflect_text = reflect_text
        self.retain_response = retain_response or SimpleNamespace(usage=None)
        self.failures = failures if failures is not None else []
        self.closed = False
        self.recall_calls = []
        self.reflect_calls = []
        self.retain_calls = []

    async def arecall(self, **kwargs):
        self.recall_calls.append(kwargs)
        if self.failures:
            raise self.failures.pop(0)
        return SimpleNamespace(results=self.recall_results)

    async def areflect(self, **kwargs):
        self.reflect_calls.append(kwargs)
        if self.failures:
            raise self.failures.pop(0)
        return SimpleNamespace(
            text=self.reflect_text,
            usage=SimpleNamespace(input_tokens=80, output_tokens=120),
        )

    async def aretain_batch(self, **kwargs):
        self.retain_calls.append(kwargs)
        if self.failures:
            raise self.failures.pop(0)
        return self.retain_response

    async def aclose(self):
        self.closed = True


def test_make_hindsight_tools_returns_three_custom_async_tools():
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
    )

    assert [tool.__name__ for tool in tools] == [
        "retain",
        "hindsight_recall",
        "hindsight_reflect",
    ]
    for fn in tools:
        assert inspect.iscoroutinefunction(fn)


def test_make_hindsight_tools_missing_endpoint_degrades_to_empty_tuple():
    from hindsight_tools import make_hindsight_tools

    assert (
        make_hindsight_tools(
            _tool,
            hs_endpoint="",
            hs_bank="bank-1",
        )
        == ()
    )

    assert (
        make_hindsight_tools(
            _tool,
            hs_endpoint="https://hindsight.example.test",
            hs_bank="",
        )
        == ()
    )


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
    )

    result = asyncio.run(reflect("tell me about the restaurant"))

    assert result == "Le Jules Verne is the answer"
    assert all(client.closed for client in created) is True


# ---------------------------------------------------------------------------
# U8: retain @tool wrapper pushes usage in-body
# ---------------------------------------------------------------------------


def test_retain_pushes_usage_in_body(monkeypatch):
    """AE4: aretain_batch response.usage → _push("retain", retain_model, usage)."""
    from hindsight_tools import make_hindsight_tools
    import hindsight_usage_capture

    monkeypatch.setattr(
        hindsight_usage_capture, "_usage_log", [], raising=False
    )
    push_calls = []
    monkeypatch.setattr(
        hindsight_usage_capture,
        "_push",
        lambda phase, model, usage: push_calls.append((phase, model, usage)),
    )
    monkeypatch.setenv("HINDSIGHT_API_RETAIN_LLM_MODEL", "test-retain-model")

    client = _FakeClient(
        retain_response=SimpleNamespace(
            usage=SimpleNamespace(input_tokens=42, output_tokens=10)
        ),
    )
    retain, _recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: client,
    )

    result = asyncio.run(retain("Marco prefers Slack for code review"))

    assert result == "Memory stored."
    assert len(push_calls) == 1
    phase, model, usage = push_calls[0]
    assert phase == "retain"
    assert model == "test-retain-model"
    assert usage.input_tokens == 42
    assert usage.output_tokens == 10


def test_retain_creates_fresh_client_per_call():
    from hindsight_tools import make_hindsight_tools

    created: list[_FakeClient] = []

    def client_factory():
        c = _FakeClient(
            retain_response=SimpleNamespace(usage=None),
        )
        created.append(c)
        return c

    retain, _recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=client_factory,
    )

    asyncio.run(retain("first"))
    asyncio.run(retain("second"))
    assert len(created) == 2
    assert all(c.closed for c in created)


def test_retain_no_usage_attr_does_not_push(monkeypatch):
    """Edge case: response missing usage → _push not called; tool succeeds."""
    from hindsight_tools import make_hindsight_tools
    import hindsight_usage_capture

    push_calls = []
    monkeypatch.setattr(
        hindsight_usage_capture,
        "_push",
        lambda phase, model, usage: push_calls.append((phase, model, usage)),
    )

    client = _FakeClient(retain_response=SimpleNamespace())  # no usage attr
    retain, _recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: client,
    )

    result = asyncio.run(retain("a fact"))
    assert result == "Memory stored."
    # _push is called once with usage=None; the helper itself no-ops on None.
    assert len(push_calls) == 1
    assert push_calls[0][2] is None


def test_retain_transient_error_retries(monkeypatch):
    from hindsight_tools import make_hindsight_tools

    clients = [
        _FakeClient(failures=[RuntimeError("(503)")]),
        _FakeClient(retain_response=SimpleNamespace(usage=None)),
    ]
    async def no_sleep(_seconds):
        return None
    monkeypatch.setattr("hindsight_tools.asyncio.sleep", no_sleep)

    retain, _recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: clients.pop(0),
    )

    result = asyncio.run(retain("a fact"))
    assert result == "Memory stored."


def test_retain_non_transient_error_returns_error_string(monkeypatch):
    from hindsight_tools import make_hindsight_tools

    client = _FakeClient(failures=[ValueError("bad input")])
    retain, _recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: client,
    )

    result = asyncio.run(retain("a fact"))
    assert result.startswith("Memory storage failed")


def test_retain_model_closure_snapshotted_at_registration(monkeypatch):
    """Closure-snapshot regression: env mutated post-registration is ignored."""
    from hindsight_tools import make_hindsight_tools
    import hindsight_usage_capture

    push_calls = []
    monkeypatch.setattr(
        hindsight_usage_capture,
        "_push",
        lambda phase, model, usage: push_calls.append((phase, model, usage)),
    )

    monkeypatch.setenv("HINDSIGHT_API_RETAIN_LLM_MODEL", "snapshot-time-model")
    client = _FakeClient(
        retain_response=SimpleNamespace(
            usage=SimpleNamespace(input_tokens=10, output_tokens=5)
        )
    )
    retain, _recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: client,
    )

    # Mutate env after registration; the snapshot should not change.
    monkeypatch.setenv("HINDSIGHT_API_RETAIN_LLM_MODEL", "different-model")
    asyncio.run(retain("a fact"))

    assert push_calls[0][1] == "snapshot-time-model"


# ---------------------------------------------------------------------------
# U9: hindsight_reflect pushes usage in-body
# ---------------------------------------------------------------------------


def test_reflect_pushes_usage_in_body(monkeypatch):
    from hindsight_tools import make_hindsight_tools
    import hindsight_usage_capture

    push_calls = []
    monkeypatch.setattr(
        hindsight_usage_capture,
        "_push",
        lambda phase, model, usage: push_calls.append((phase, model, usage)),
    )
    monkeypatch.setenv("HINDSIGHT_API_REFLECT_LLM_MODEL", "test-reflect-model")

    client = _FakeClient(reflect_text="synthesized answer")
    _retain, _recall, reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: client,
    )

    result = asyncio.run(reflect("brief me on the project"))
    assert result == "synthesized answer"
    # Exactly one push, attributed to the reflect phase + snapshotted model.
    assert len(push_calls) == 1
    assert push_calls[0][0] == "reflect"
    assert push_calls[0][1] == "test-reflect-model"
    assert push_calls[0][2].input_tokens == 80
    assert push_calls[0][2].output_tokens == 120


def test_recall_does_not_push_usage(monkeypatch):
    """Non-regression: recall has no Bedrock cost — _push must not fire."""
    from hindsight_tools import make_hindsight_tools
    import hindsight_usage_capture

    push_calls = []
    monkeypatch.setattr(
        hindsight_usage_capture,
        "_push",
        lambda phase, model, usage: push_calls.append((phase, model, usage)),
    )

    client = _FakeClient(
        recall_results=[
            {"text": "a fact"},
        ]
    )
    _retain, recall, _reflect = make_hindsight_tools(
        _tool,
        hs_endpoint="https://hindsight.example.test",
        hs_bank="bank-1",
        client_factory=lambda: client,
    )

    asyncio.run(recall("query"))
    assert push_calls == []
