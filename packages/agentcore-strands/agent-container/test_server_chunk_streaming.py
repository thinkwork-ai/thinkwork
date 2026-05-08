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
