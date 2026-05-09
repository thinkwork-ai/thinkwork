from __future__ import annotations

import sys
from types import SimpleNamespace

import _boot_assert

_original_boto3 = sys.modules.get("boto3")
_original_botocore = sys.modules.get("botocore")
_original_botocore_exceptions = sys.modules.get("botocore.exceptions")
sys.modules["boto3"] = SimpleNamespace(client=lambda *_a, **_kw: None)
sys.modules["botocore"] = SimpleNamespace()
sys.modules["botocore.exceptions"] = SimpleNamespace(ClientError=Exception)

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
    if _original_botocore is None:
        sys.modules.pop("botocore", None)
    else:
        sys.modules["botocore"] = _original_botocore
    if _original_botocore_exceptions is None:
        sys.modules.pop("botocore.exceptions", None)
    else:
        sys.modules["botocore.exceptions"] = _original_botocore_exceptions


def test_execute_agent_turn_passes_thread_id_to_strands_streaming(monkeypatch):
    captured = {}

    monkeypatch.setitem(
        sys.modules,
        "eval_span_attrs",
        SimpleNamespace(
            attach_eval_context=lambda **_kwargs: object(),
            detach_eval_context=lambda _token: None,
        ),
    )
    monkeypatch.setattr(server, "_ensure_workspace_ready", lambda *args, **kwargs: None)
    monkeypatch.setattr(server, "_build_system_prompt", lambda *args, **kwargs: "system")
    monkeypatch.setattr(server, "_inject_skill_env", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(server, "_cleanup_skill_env", lambda *_args, **_kwargs: None)

    def fake_call_strands_agent(*args, **kwargs):
        captured.update(kwargs)
        return "Hello", {}

    monkeypatch.setattr(server, "_call_strands_agent", fake_call_strands_agent)

    result = server._execute_agent_turn(
        {
            "workspace_tenant_id": "tenant-1",
            "assistant_id": "agent-1",
            "tenant_slug": "tenant",
            "instance_id": "agent-1",
            "agent_name": "Marco",
            "human_name": "Eric",
            "message": "Hello",
            "thread_id": "thread-1",
            "appsync_endpoint": "https://example.appsync-api.us-east-1.amazonaws.com/graphql",
            "appsync_api_key": "test-key",
            "messages_history": [],
        }
    )

    assert result["response_text"] == "Hello"
    assert captured["stream_thread_id"] == "thread-1"
    assert server.os.environ["APPSYNC_ENDPOINT"] == (
        "https://example.appsync-api.us-east-1.amazonaws.com/graphql"
    )
    assert server.os.environ["APPSYNC_API_KEY"] == "test-key"


def test_execute_agent_turn_records_computer_thread_response(monkeypatch):
    captured = {}

    monkeypatch.setitem(
        sys.modules,
        "eval_span_attrs",
        SimpleNamespace(
            attach_eval_context=lambda **_kwargs: object(),
            detach_eval_context=lambda _token: None,
        ),
    )

    def fake_record_thread_turn_response(**kwargs):
        captured["response"] = kwargs
        return {
            "responded": True,
            "responseMessageId": "assistant-message-1",
        }

    monkeypatch.setitem(
        sys.modules,
        "computer_thread_response",
        SimpleNamespace(
            record_thread_turn_response=fake_record_thread_turn_response,
        ),
    )
    monkeypatch.setattr(server, "_ensure_workspace_ready", lambda *args, **kwargs: None)
    monkeypatch.setattr(server, "_build_system_prompt", lambda *args, **kwargs: "system")
    monkeypatch.setattr(server, "_inject_skill_env", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(server, "_cleanup_skill_env", lambda *_args, **_kwargs: None)

    def fake_call_strands_agent(*args, **kwargs):
        captured.update(kwargs)
        return "Final answer", {"input_tokens": 3}

    monkeypatch.setattr(server, "_call_strands_agent", fake_call_strands_agent)

    result = server._execute_agent_turn(
        {
            "workspace_tenant_id": "tenant-1",
            "assistant_id": "agent-1",
            "tenant_slug": "tenant",
            "instance_id": "agent-1",
            "agent_name": "Marco",
            "human_name": "Eric",
            "message": "Hello",
            "thread_id": "thread-1",
            "computer_id": "computer-1",
            "computer_task_id": "task-1",
            "thinkwork_api_url": "https://api.example.test",
            "thinkwork_api_secret": "service-secret",
            "messages_history": [],
        }
    )

    assert result["computer_thread_response"]["responseMessageId"] == ("assistant-message-1")
    assert captured["response"] == {
        "tenant_id": "tenant-1",
        "computer_id": "computer-1",
        "task_id": "task-1",
        "content": "Final answer",
        "model": server.DEFAULT_MODEL,
        "usage": {"input_tokens": 3},
        "api_url": "https://api.example.test",
        "api_secret": "service-secret",
    }
    assert captured["computer_event_context"] == {
        "tenant_id": "tenant-1",
        "computer_id": "computer-1",
        "task_id": "task-1",
        "api_url": "https://api.example.test",
        "api_secret": "service-secret",
    }


def test_save_app_tool_summary_preserves_artifact_persistence_evidence():
    assert server._save_app_tool_summary(
        {
            "ok": True,
            "persisted": True,
            "appId": "applet-1",
            "validated": True,
            "files": {"ignored": "large payload"},
        }
    ) == {
        "ok": True,
        "persisted": True,
        "appId": "applet-1",
        "validated": True,
    }


def test_execute_agent_turn_adds_computer_applet_contract(monkeypatch):
    captured = {}

    monkeypatch.setitem(
        sys.modules,
        "eval_span_attrs",
        SimpleNamespace(
            attach_eval_context=lambda **_kwargs: object(),
            detach_eval_context=lambda _token: None,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "computer_thread_response",
        SimpleNamespace(
            record_thread_turn_response=lambda **_kwargs: {"responded": True},
        ),
    )
    monkeypatch.setattr(server, "_ensure_workspace_ready", lambda *args, **kwargs: None)
    monkeypatch.setattr(server, "_build_system_prompt", lambda *args, **kwargs: "system")
    monkeypatch.setattr(server, "_inject_skill_env", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(server, "_cleanup_skill_env", lambda *_args, **_kwargs: None)

    def fake_call_strands_agent(system_prompt, messages, **kwargs):
        captured["system_prompt"] = system_prompt
        captured["messages"] = messages
        captured.update(kwargs)
        assert server.os.environ["COMPUTER_THREAD_ID"] == "thread-1"
        assert server.os.environ["COMPUTER_TURN_PROMPT"].startswith("Build a CRM")
        return "Saved the applet.", {}

    monkeypatch.setattr(server, "_call_strands_agent", fake_call_strands_agent)

    server._execute_agent_turn(
        {
            "workspace_tenant_id": "tenant-1",
            "assistant_id": "agent-1",
            "tenant_slug": "tenant",
            "instance_id": "agent-1",
            "agent_name": "Marco",
            "human_name": "Eric",
            "message": (
                "Build a CRM pipeline risk dashboard for LastMile opportunities, "
                "including stale activity, stage exposure, and the top risks to review."
            ),
            "thread_id": "thread-1",
            "computer_id": "computer-1",
            "computer_task_id": "task-1",
            "thinkwork_api_url": "https://api.example.test",
            "thinkwork_api_secret": "service-secret",
            "messages_history": [],
        }
    )

    assert "## Computer Thread Contract" in captured["system_prompt"]
    assert "use the artifact-builder skill if it is available" in captured["system_prompt"]
    assert "expected result is a saved Computer applet" in captured["system_prompt"]
    assert "keep the applet implementation and save_app" in captured["system_prompt"]
    assert "Do not" in captured["system_prompt"]
    assert "delegate applet saving" in captured["system_prompt"]
    assert "unless your own successful save_app tool call" in captured["system_prompt"]
    assert "Current threadId: thread-1" in captured["system_prompt"]
    assert "COMPUTER_THREAD_ID" not in server.os.environ
    assert "COMPUTER_TURN_PROMPT" not in server.os.environ
