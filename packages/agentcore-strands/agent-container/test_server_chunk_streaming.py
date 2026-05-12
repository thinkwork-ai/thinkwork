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


def test_bedrock_boto_client_config_uses_long_read_timeout(monkeypatch):
    captured = {}

    class FakeConfig:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setenv("BEDROCK_READ_TIMEOUT_SECONDS", "720")

    config = server._bedrock_boto_client_config(config_cls=FakeConfig)

    assert isinstance(config, FakeConfig)
    assert captured == {
        "read_timeout": 720,
        "connect_timeout": 10,
        "retries": {"max_attempts": 3, "mode": "standard"},
    }


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


def test_execute_agent_turn_suppresses_thread_response_for_runbook_steps(monkeypatch):
    captured = {}

    monkeypatch.setitem(
        sys.modules,
        "eval_span_attrs",
        SimpleNamespace(
            attach_eval_context=lambda **_kwargs: object(),
            detach_eval_context=lambda _token: None,
        ),
    )

    def fail_record_thread_turn_response(**_kwargs):
        raise AssertionError("runbook steps must not record thread-turn responses")

    monkeypatch.setitem(
        sys.modules,
        "computer_thread_response",
        SimpleNamespace(
            record_thread_turn_response=fail_record_thread_turn_response,
        ),
    )
    monkeypatch.setattr(server, "_ensure_workspace_ready", lambda *args, **kwargs: None)
    monkeypatch.setattr(server, "_build_system_prompt", lambda *args, **kwargs: "system")
    monkeypatch.setattr(server, "_inject_skill_env", lambda *_args, **_kwargs: [])
    monkeypatch.setattr(server, "_cleanup_skill_env", lambda *_args, **_kwargs: None)

    def fake_call_strands_agent(system_prompt, _messages, **kwargs):
        captured["system_prompt"] = system_prompt
        captured.update(kwargs)
        return "Step output", {"input_tokens": 3}

    monkeypatch.setattr(server, "_call_strands_agent", fake_call_strands_agent)

    runbook_context = {
        "run": {
            "id": "run-1",
            "status": "running",
            "runbookSlug": "crm-dashboard",
            "runbookVersion": "0.1.0",
        },
        "definitionSnapshot": {
            "catalog": {"displayName": "CRM Dashboard"},
            "phases": [{"id": "discover", "title": "Discover CRM context"}],
            "outputs": [],
        },
        "tasks": [
            {
                "id": "runbook-task-1",
                "phaseId": "discover",
                "phaseTitle": "Discover CRM context",
                "taskKey": "discover:1",
                "title": "Identify CRM entities, fields, and data freshness.",
                "status": "running",
                "dependsOn": [],
                "capabilityRoles": ["research"],
                "sortOrder": 1,
            }
        ],
        "previousOutputs": {},
    }

    result = server._execute_agent_turn(
        {
            "workspace_tenant_id": "tenant-1",
            "assistant_id": "agent-1",
            "tenant_slug": "tenant",
            "instance_id": "agent-1",
            "agent_name": "Marco",
            "human_name": "Eric",
            "message": "Execute the first runbook task",
            "thread_id": "thread-1",
            "computer_id": "computer-1",
            "computer_task_id": "task-1",
            "computer_response_mode": "runbook_step",
            "thinkwork_api_url": "https://api.example.test",
            "thinkwork_api_secret": "service-secret",
            "messages_history": [],
            "runbook_context": runbook_context,
        }
    )

    assert result["response_text"] == "Step output"
    assert result["computer_thread_response"] is None
    assert captured["ui_message_emit"] is False
    assert captured["computer_event_context"] is None
    assert "## Computer Thread Contract" not in captured["system_prompt"]
    assert captured["runbook_context"] == runbook_context


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


def test_typed_stream_delta_normalizer_handles_full_buffer_replays():
    state = {}

    assert server._normalize_append_only_stream_delta(state, "Good") == "Good"
    assert server._normalize_append_only_stream_delta(state, "Good") is None
    assert server._normalize_append_only_stream_delta(state, "Good morning") == " morning"
    assert server._normalize_append_only_stream_delta(state, " — ") == " — "
    assert server._normalize_append_only_stream_delta(state, " — ") is None
    assert (
        server._normalize_append_only_stream_delta(state, "new unrelated chunk")
        == "new unrelated chunk"
    )


def test_computer_applet_build_request_classifier():
    assert server._is_computer_applet_build_request(
        "Build a CRM pipeline risk dashboard for LastMile opportunities"
    )
    assert server._is_computer_applet_build_request("Create an applet from these notes")
    assert not server._is_computer_applet_build_request("Summarize the CRM pipeline")
    assert not server._is_computer_applet_build_request("Build trust with the customer")


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
        assert server.os.environ["COMPUTER_ID"] == "computer-1"
        assert server.os.environ["COMPUTER_TASK_ID"] == "task-1"
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
    assert "treat Artifact Builder as the phase implementation detail" in captured["system_prompt"]
    assert "expected result is a saved Computer applet" in captured["system_prompt"]
    assert "keep the applet implementation and save_app" in captured["system_prompt"]
    assert "Do not" in captured["system_prompt"]
    assert "delegate applet saving" in captured["system_prompt"]
    assert "unless your own successful save_app tool call" in captured["system_prompt"]
    assert "Current threadId: thread-1" in captured["system_prompt"]
    assert captured["suppress_app_build_helper_tools"] is True
    assert "COMPUTER_ID" not in server.os.environ
    assert "COMPUTER_TASK_ID" not in server.os.environ
    assert "COMPUTER_THREAD_ID" not in server.os.environ
    assert "COMPUTER_TURN_PROMPT" not in server.os.environ


def test_execute_agent_turn_adds_runbook_context(monkeypatch):
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
        captured["runbook_context"] = kwargs.get("runbook_context")
        return "Runbook task complete", {}

    monkeypatch.setattr(server, "_call_strands_agent", fake_call_strands_agent)

    runbook_context = {
        "run": {
            "id": "run-1",
            "status": "running",
            "runbookSlug": "research-dashboard",
            "runbookVersion": "0.1.0",
        },
        "definitionSnapshot": {
            "catalog": {"displayName": "Research Dashboard"},
            "phases": [
                {
                    "id": "discover",
                    "title": "Discover evidence",
                    "guidanceMarkdown": "Capture source quality.",
                }
            ],
            "outputs": [],
        },
        "tasks": [
            {
                "id": "task-1",
                "phaseId": "discover",
                "phaseTitle": "Discover evidence",
                "taskKey": "discover:1",
                "title": "Identify sources",
                "status": "running",
                "dependsOn": [],
                "capabilityRoles": ["research"],
                "sortOrder": 1,
            }
        ],
        "previousOutputs": {},
    }

    server._execute_agent_turn(
        {
            "workspace_tenant_id": "tenant-1",
            "assistant_id": "agent-1",
            "tenant_slug": "tenant",
            "instance_id": "agent-1",
            "agent_name": "Marco",
            "human_name": "Eric",
            "message": "Run the next runbook task",
            "thread_id": "thread-1",
            "computer_id": "computer-1",
            "computer_task_id": "computer-task-1",
            "thinkwork_api_url": "https://api.example.test",
            "thinkwork_api_secret": "service-secret",
            "messages_history": [],
            "runbook_context": runbook_context,
        }
    )

    assert "## Runbook Execution Context" in captured["system_prompt"]
    assert "Research Dashboard" in captured["system_prompt"]
    assert "Capture source quality." in captured["system_prompt"]
    assert captured["runbook_context"] == runbook_context


def test_initial_runbook_queue_update_uses_typed_ui_message_shape():
    published = []

    class FakePublisher:
        def publish_part(self, part):
            published.append(part)
            return {"ok": True, "validated": True}

    dispatch = server._publish_initial_runbook_queue_update(
        FakePublisher(),
        {
            "run": {
                "id": "run-1",
                "status": "running",
                "runbookSlug": "research-dashboard",
                "runbookVersion": "0.1.0",
            },
            "definitionSnapshot": {
                "catalog": {"displayName": "Research Dashboard"},
                "phases": [{"id": "discover", "title": "Discover evidence"}],
            },
            "tasks": [
                {
                    "id": "task-1",
                    "phaseId": "discover",
                    "phaseTitle": "Discover evidence",
                    "taskKey": "discover:1",
                    "title": "Identify sources",
                    "status": "running",
                    "dependsOn": [],
                    "capabilityRoles": ["research"],
                    "sortOrder": 1,
                }
            ],
            "previousOutputs": {},
        },
    )

    assert dispatch == {"ok": True, "validated": True}
    assert published[0]["type"] == "data-task-queue"
    assert published[0]["data"]["groups"][0]["items"][0]["metadata"]["taskKey"] == "discover:1"
