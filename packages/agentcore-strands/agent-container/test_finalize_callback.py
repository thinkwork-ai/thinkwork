"""
test_finalize_callback — opt-in finalize-callback POST at end of turn
(plan 2026-05-22-006 U2).

Covers:
- _build_finalize_payload: shape parity with the FinalizePayload TS interface
- _post_finalize_callback: 200 happy path, 503-then-200 retry success,
  503-then-503 retry exhausted, 4xx no-retry
- The do_POST dispatch branch is exercised by tweaking the result-shape
  builder; the urllib POST is mocked.
"""

from __future__ import annotations

import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

import pytest

sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "container-sources"),
)

import _boot_assert  # noqa: E402

_original_boto3 = sys.modules.get("boto3")
_original_botocore = sys.modules.get("botocore")
_original_botocore_exceptions = sys.modules.get("botocore.exceptions")
sys.modules["boto3"] = SimpleNamespace(client=lambda *_a, **_kw: None)
sys.modules["botocore"] = SimpleNamespace()
sys.modules["botocore.exceptions"] = SimpleNamespace(ClientError=Exception)

_original_check = _boot_assert.check
_boot_assert.check = lambda *a, **kw: None
try:
    from server import (  # noqa: E402
        _build_completion_result,
        _build_finalize_payload,
        _post_finalize_callback,
    )
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


@pytest.fixture
def base_payload():
    return {
        "thread_turn_id": "11111111-1111-1111-1111-111111111111",
        "tenant_id": "22222222-2222-2222-2222-222222222222",
        "assistant_id": "33333333-3333-3333-3333-333333333333",
        "thread_id": "44444444-4444-4444-4444-444444444444",
        "trace_id": "trace-abc",
        "message": "hello",
        "model": "us.anthropic.claude-sonnet-4-6",
        "instance_id": "agent-slug",
        "agent_name": "Tester",
        "computer_id": "55555555-5555-5555-5555-555555555555",
        "computer_task_id": "66666666-6666-6666-6666-666666666666",
        "guardrail_config": {"guardrailIdentifier": "gr-1"},
    }


@pytest.fixture
def base_result():
    return {
        "model": "us.anthropic.claude-sonnet-4-6",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": "hi"},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 5,
            "total_tokens": 17,
            "cached_read_tokens": 0,
        },
        "tool_invocations": [{"name": "search", "args": {}}],
        "tools_called": ["search"],
        "tool_costs": [],
        "bedrock_request_ids": ["req-1"],
        "hindsight_usage": [],
    }


def test_build_finalize_payload_populates_identity(base_payload, base_result):
    body = _build_finalize_payload(
        payload=base_payload,
        result=base_result,
        status="completed",
        duration_ms=4321,
    )
    assert body["thread_turn_id"] == base_payload["thread_turn_id"]
    assert body["tenant_id"] == base_payload["tenant_id"]
    assert body["agent_id"] == base_payload["assistant_id"]
    assert body["thread_id"] == base_payload["thread_id"]
    assert body["trace_id"] == "trace-abc"
    assert body["duration_ms"] == 4321
    assert body["status"] == "completed"


def test_build_finalize_payload_populates_response(base_payload, base_result):
    body = _build_finalize_payload(
        payload=base_payload,
        result=base_result,
        status="completed",
        duration_ms=100,
    )
    response = body["response"]
    assert response["choices"] == base_result["choices"]
    assert response["tool_invocations"] == base_result["tool_invocations"]
    assert response["tools_called"] == ["search"]
    assert response["bedrock_request_ids"] == ["req-1"]


def test_build_completion_result_carries_composed_system_prompt():
    result = _build_completion_result(
        response_text="hi",
        request_model="model-a",
        strands_usage={
            "input_tokens": 3,
            "output_tokens": 2,
            "tools_called": ["recall"],
            "tool_invocations": [{"name": "recall"}],
            "bedrock_request_ids": ["req-1"],
        },
        invocation_tool_costs=[],
        turn_result={"composed_system_prompt": "Current date\n\nUSER.md"},
    )

    assert result["composed_system_prompt"] == "Current date\n\nUSER.md"
    assert result["usage"]["total_tokens"] == 5


def test_build_finalize_payload_populates_usage(base_payload, base_result):
    body = _build_finalize_payload(
        payload=base_payload,
        result=base_result,
        status="completed",
        duration_ms=100,
    )
    assert body["usage"]["input_tokens"] == 12
    assert body["usage"]["output_tokens"] == 5
    assert body["usage"]["cached_read_tokens"] == 0


def test_build_finalize_payload_guardrail_block(base_payload):
    block_result = {
        "model": "us.anthropic.claude-sonnet-4-6",
        "choices": [],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "guardrail_block": {
            "blocked": True,
            "type": "INPUT",
            "action": "BLOCKED",
        },
    }
    body = _build_finalize_payload(
        payload=base_payload,
        result=block_result,
        status="completed",
        duration_ms=100,
    )
    assert body["guardrail_block"]["blocked"] is True
    assert body["response"]["guardrail_block"]["blocked"] is True


def test_build_finalize_payload_failed_status(base_payload):
    body = _build_finalize_payload(
        payload=base_payload,
        result={},
        status="failed",
        duration_ms=42,
        error_message="container crashed",
    )
    assert body["status"] == "failed"
    assert body["error_message"] == "container crashed"


def _mock_response(status_code: int, body: str = "{}"):
    class MockResp:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def getcode(self):
            return status_code

        def read(self):
            return body.encode("utf-8")

    return MockResp()


def test_post_finalize_callback_success():
    with patch("urllib.request.urlopen") as mock_open:
        mock_open.return_value = _mock_response(200, '{"ok":true}')
        ok = _post_finalize_callback(
            finalize_callback_url="https://api.example.com/api/threads/x/finalize",
            finalize_callback_secret="secret",
            finalize_body={"thread_turn_id": "t1"},
        )
    assert ok is True
    assert mock_open.call_count == 1


def test_post_finalize_callback_retries_on_503_then_succeeds():
    with patch("urllib.request.urlopen") as mock_open, patch("time.sleep"):
        mock_open.side_effect = [
            HTTPError("u", 503, "boom", {}, None),
            _mock_response(200, '{"ok":true}'),
        ]
        ok = _post_finalize_callback(
            finalize_callback_url="https://api.example.com/api/threads/x/finalize",
            finalize_callback_secret="secret",
            finalize_body={"thread_turn_id": "t1"},
        )
    assert ok is True
    assert mock_open.call_count == 2


def test_post_finalize_callback_retries_exhausted():
    with patch("urllib.request.urlopen") as mock_open, patch("time.sleep"):
        mock_open.side_effect = [
            HTTPError("u", 503, "boom", {}, None),
            HTTPError("u", 503, "still boom", {}, None),
        ]
        ok = _post_finalize_callback(
            finalize_callback_url="https://api.example.com/api/threads/x/finalize",
            finalize_callback_secret="secret",
            finalize_body={"thread_turn_id": "t1"},
        )
    assert ok is False
    assert mock_open.call_count == 2


def test_post_finalize_callback_no_retry_on_4xx():
    with patch("urllib.request.urlopen") as mock_open, patch("time.sleep") as mock_sleep:
        mock_open.side_effect = [HTTPError("u", 401, "nope", {}, None)]
        ok = _post_finalize_callback(
            finalize_callback_url="https://api.example.com/api/threads/x/finalize",
            finalize_callback_secret="secret",
            finalize_body={"thread_turn_id": "t1"},
        )
    assert ok is False
    # 4xx is not retried — no sleep call, no second urlopen
    assert mock_open.call_count == 1
    assert mock_sleep.call_count == 0


def test_post_finalize_callback_includes_bearer_header():
    captured = {}

    def _record(req, timeout=None):
        captured["headers"] = dict(req.header_items())
        captured["url"] = req.full_url
        captured["body"] = req.data
        return _mock_response(200, '{"ok":true}')

    with patch("urllib.request.urlopen", side_effect=_record):
        _post_finalize_callback(
            finalize_callback_url="https://api.example.com/api/threads/x/finalize",
            finalize_callback_secret="secret-xyz",
            finalize_body={"thread_turn_id": "t1"},
        )

    # urllib title-cases header keys ("Authorization", "Content-type").
    auth_value = next(
        (v for k, v in captured["headers"].items() if k.lower() == "authorization"),
        None,
    )
    assert auth_value == "Bearer secret-xyz"
    assert json.loads(captured["body"]) == {"thread_turn_id": "t1"}
