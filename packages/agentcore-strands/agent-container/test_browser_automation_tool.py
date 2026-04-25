from __future__ import annotations

import browser_automation_tool as bat  # type: ignore


def _tool(fn):
    return fn


class FakeBrowserClient:
    def generate_ws_headers(self):
        return "wss://browser.test/devtools", {"Authorization": "Bearer test"}


class FakeBrowserSession:
    def __init__(self, region: str):
        self.region = region

    def __enter__(self):
        return FakeBrowserClient()

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeActResult:
    response = "found the thing"


class FakeNovaAct:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def act_get(self, task, schema):
        assert task == "Find the thing"
        assert schema == {"type": "string"}
        return FakeActResult()


def test_browser_automation_returns_unavailable_when_key_missing():
    costs: list[dict] = []
    tool = bat.build_browser_automation_tool(
        strands_tool_decorator=_tool,
        nova_act_api_key="",
        cost_sink=costs,
        region="us-east-1",
        browser_session_factory=FakeBrowserSession,
        nova_act_cls=FakeNovaAct,
    )

    result = tool("https://example.test", "Find the thing")

    assert "Nova Act API key is not configured" in result
    assert costs == []


def test_browser_automation_records_split_nova_and_browser_costs(monkeypatch):
    costs: list[dict] = []
    ticks = iter([100.0, 110.0])
    monkeypatch.setattr(bat.time, "time", lambda: next(ticks))

    tool = bat.build_browser_automation_tool(
        strands_tool_decorator=_tool,
        nova_act_api_key="secret",
        cost_sink=costs,
        region="us-east-1",
        browser_session_factory=FakeBrowserSession,
        nova_act_cls=FakeNovaAct,
    )

    result = tool("https://example.test", "Find the thing")

    assert result == "found the thing"
    assert [c["provider"] for c in costs] == ["nova_act", "agentcore_browser"]
    assert [c["event_type"] for c in costs] == [
        "nova_act_browser_automation",
        "agentcore_browser_session",
    ]
    assert costs[0]["amount_usd"] == round((10 / 3600) * 4.75, 6)
    assert costs[1]["metadata"]["estimated"] is True
    assert costs[0]["metadata"]["response_len"] == len("found the thing")
