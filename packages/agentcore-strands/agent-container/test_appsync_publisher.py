from __future__ import annotations

import json

from appsync_publisher import AppSyncChunkPublisher, build_appsync_chunk_callback


def test_build_callback_returns_noop_when_not_configured():
    callback, publisher = build_appsync_chunk_callback(
        "thread-1",
        env={},
        post_fn=lambda *_args: (200, "{}"),
    )

    assert callback is None
    assert publisher is None


def test_callback_publishes_strands_data_events_as_ordered_chunks():
    calls = []

    def post(endpoint, headers, body, timeout):
        calls.append((endpoint, headers, json.loads(body.decode("utf-8")), timeout))
        return 200, json.dumps({"data": {"publishComputerThreadChunk": {"seq": len(calls)}}})

    callback, publisher = build_appsync_chunk_callback(
        "thread-1",
        env={
            "APPSYNC_ENDPOINT": "https://example.appsync-api.us-east-1.amazonaws.com/graphql",
            "APPSYNC_API_KEY": "test-key",
        },
        post_fn=post,
    )

    assert callback is not None
    assert publisher is not None
    callback(data="Hello")
    callback(current_tool_use={"name": "search"})
    callback(data=" world")
    publisher.drain()

    assert len(calls) == 2
    first_endpoint, first_headers, first_body, _timeout = calls[0]
    assert first_endpoint == "https://example.appsync-api.us-east-1.amazonaws.com/graphql"
    assert first_headers["x-api-key"] == "test-key"
    assert "publishComputerThreadChunk" in first_body["query"]
    assert first_body["variables"] == {
        "threadId": "thread-1",
        "chunk": json.dumps({"text": "Hello"}),
        "seq": 1,
    }
    assert calls[1][2]["variables"] == {
        "threadId": "thread-1",
        "chunk": json.dumps({"text": " world"}),
        "seq": 2,
    }


def test_publisher_retries_retryable_failures_once():
    statuses = [500, 200]
    calls = []

    def post(_endpoint, _headers, body, _timeout):
        calls.append(json.loads(body.decode("utf-8")))
        return statuses.pop(0), "{}"

    publisher = AppSyncChunkPublisher(
        thread_id="thread-1",
        endpoint="https://example.test/graphql",
        api_key="test-key",
        post_fn=post,
    )

    publisher.publish("hello")
    publisher.drain()

    assert len(calls) == 2


def test_publisher_does_not_retry_non_retryable_auth_failures():
    calls = []

    def post(_endpoint, _headers, body, _timeout):
        calls.append(json.loads(body.decode("utf-8")))
        return 403, "forbidden"

    publisher = AppSyncChunkPublisher(
        thread_id="thread-1",
        endpoint="https://example.test/graphql",
        api_key="bad-key",
        post_fn=post,
    )

    publisher.publish("hello")
    publisher.drain()

    assert len(calls) == 1
