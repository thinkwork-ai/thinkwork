from __future__ import annotations

import json
import urllib.error
from io import BytesIO
from unittest.mock import patch

import pytest
from computer_thread_response import (
    ThreadResponsePersistenceError,
    record_thread_turn_response,
)


class FakeResponse:
    status = 200

    def __init__(self, body: dict):
        self._body = json.dumps(body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return self._body


def test_record_thread_turn_response_posts_to_runtime_endpoint():
    captured = {}

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        captured["headers"] = request.headers
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return FakeResponse(
            {
                "responded": True,
                "responseMessageId": "assistant-message-1",
            }
        )

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = record_thread_turn_response(
            tenant_id="tenant-1",
            computer_id="computer-1",
            task_id="task-1",
            content="Final answer",
            model="model-1",
            usage={"input_tokens": 3},
            api_url="https://api.example.test/",
            api_secret="service-secret",
        )

    assert result["responseMessageId"] == "assistant-message-1"
    assert captured["url"] == (
        "https://api.example.test/api/computers/runtime/tasks/"
        "task-1/thread-turn-response"
    )
    assert captured["headers"]["Authorization"] == "Bearer service-secret"
    assert captured["body"] == {
        "tenantId": "tenant-1",
        "computerId": "computer-1",
        "content": "Final answer",
        "model": "model-1",
        "usage": {"input_tokens": 3},
    }


def test_record_thread_turn_response_rejects_4xx_without_retry():
    err = urllib.error.HTTPError(
        url="https://api.example.test",
        code=400,
        msg="Bad Request",
        hdrs={},
        fp=BytesIO(b'{"error":"bad"}'),
    )

    with patch("urllib.request.urlopen", side_effect=err) as mock_open:
        with pytest.raises(ThreadResponsePersistenceError) as exc:
            record_thread_turn_response(
                tenant_id="tenant-1",
                computer_id="computer-1",
                task_id="task-1",
                content="",
                api_url="https://api.example.test",
                api_secret="service-secret",
            )

    assert "HTTP 400" in str(exc.value)
    assert mock_open.call_count == 1
