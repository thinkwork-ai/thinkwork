from __future__ import annotations

import sys
import types

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

    def act(self, task, schema):
        assert task == "Find the thing"
        assert schema == {"type": "string"}
        return FakeActResult()


class FailingNovaAct(FakeNovaAct):
    def act(self, task, schema):
        raise RuntimeError("browser exploded")


class FakeSsm:
    def __init__(self, values):
        self.values = values
        self.names: list[str] = []

    def get_parameter(self, *, Name, WithDecryption):
        assert WithDecryption is True
        self.names.append(Name)
        if Name not in self.values:
            raise RuntimeError("missing")
        return {"Parameter": {"Value": self.values[Name]}}


def test_load_nova_act_key_prefers_agentcore_ssm_path(monkeypatch):
    fake_ssm = FakeSsm(
        {
            "/thinkwork/dev/agentcore/nova-act-api-key": "secret",
            "/thinkwork/dev/nova-act-api-key": "legacy-secret",
        },
    )
    fake_boto3 = types.SimpleNamespace(client=lambda service, region_name: fake_ssm)
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.delenv("NOVA_ACT_API_KEY", raising=False)
    monkeypatch.delenv("NOVA_ACT_SSM_PARAM_NAME", raising=False)
    monkeypatch.setenv("STACK_NAME", "dev")

    assert bat.load_nova_act_key(region="us-east-1") == "secret"
    assert fake_ssm.names[0] == "/thinkwork/dev/agentcore/nova-act-api-key"


def test_load_nova_act_key_ignores_placeholder_then_uses_legacy(monkeypatch):
    fake_ssm = FakeSsm(
        {
            "/thinkwork/dev/agentcore/nova-act-api-key": "PLACEHOLDER_SET_VIA_CLI",
            "/thinkwork/dev/nova-act-api-key": "legacy-secret",
        },
    )
    fake_boto3 = types.SimpleNamespace(client=lambda service, region_name: fake_ssm)
    monkeypatch.setitem(sys.modules, "boto3", fake_boto3)
    monkeypatch.delenv("NOVA_ACT_API_KEY", raising=False)
    monkeypatch.delenv("NOVA_ACT_SSM_PARAM_NAME", raising=False)
    monkeypatch.setenv("STACK_NAME", "dev")

    assert bat.load_nova_act_key(region="us-east-1") == "legacy-secret"


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
    events: list[tuple[str, str, dict]] = []
    ticks = iter([100.0, 110.0])
    monkeypatch.setattr(bat.time, "time", lambda: next(ticks))

    tool = bat.build_browser_automation_tool(
        strands_tool_decorator=_tool,
        nova_act_api_key="secret",
        cost_sink=costs,
        region="us-east-1",
        browser_session_factory=FakeBrowserSession,
        nova_act_cls=FakeNovaAct,
        event_sink=lambda event_type, level, payload: events.append(
            (event_type, level, payload)
        ),
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
    assert [event[0] for event in events] == [
        "browser_automation_started",
        "browser_automation_completed",
    ]
    assert events[1][2]["responseLen"] == len("found the thing")
    assert events[1][2]["durationMs"] == 10000


def test_browser_automation_records_failure_event(monkeypatch):
    costs: list[dict] = []
    events: list[tuple[str, str, dict]] = []
    ticks = iter([100.0, 103.0, 103.0, 103.0])
    monkeypatch.setattr(bat.time, "time", lambda: next(ticks))

    tool = bat.build_browser_automation_tool(
        strands_tool_decorator=_tool,
        nova_act_api_key="secret",
        cost_sink=costs,
        region="us-east-1",
        browser_session_factory=FakeBrowserSession,
        nova_act_cls=FailingNovaAct,
        event_sink=lambda event_type, level, payload: events.append(
            (event_type, level, payload)
        ),
    )

    result = tool("https://example.test", "Find the thing")

    assert result == "Browser Automation error: browser exploded"
    assert [event[0] for event in events] == [
        "browser_automation_started",
        "browser_automation_failed",
    ]
    assert events[1][1] == "error"
    assert events[1][2]["error"] == "browser exploded"
