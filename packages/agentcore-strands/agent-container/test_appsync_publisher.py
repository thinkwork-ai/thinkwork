from __future__ import annotations

import json

from appsync_publisher import (
    AppSyncChunkPublisher,
    build_appsync_chunk_callback,
    extract_stream_text_deltas,
)


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


def test_callback_publishes_bedrock_content_block_delta_events():
    calls = []

    def post(_endpoint, _headers, body, _timeout):
        calls.append(json.loads(body.decode("utf-8")))
        return 200, "{}"

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
    callback(event={"contentBlockDelta": {"delta": {"text": "streamed"}}})
    callback({"contentBlockDelta": {"delta": {"text": " text"}}})
    publisher.drain()

    assert [json.loads(call["variables"]["chunk"]) for call in calls] == [
        {"text": "streamed"},
        {"text": " text"},
    ]
    assert [call["variables"]["seq"] for call in calls] == [1, 2]


def test_callback_dedupes_same_delta_when_strands_passes_aliases():
    calls = []

    def post(_endpoint, _headers, body, _timeout):
        calls.append(json.loads(body.decode("utf-8")))
        return 200, "{}"

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
    callback(
        "Full",
        data="Full",
        delta={"text": "Full"},
        event={"contentBlockDelta": {"delta": {"text": "Full"}}},
    )
    publisher.drain()

    assert [json.loads(call["variables"]["chunk"]) for call in calls] == [
        {"text": "Full"},
    ]
    assert [call["variables"]["seq"] for call in calls] == [1]


def test_extract_stream_text_deltas_ignores_non_text_events():
    assert extract_stream_text_deltas(current_tool_use={"name": "search"}) == []
    assert extract_stream_text_deltas(event={"messageStop": {"stopReason": "end_turn"}}) == []


def test_extract_stream_text_deltas_accepts_common_delta_shapes():
    assert extract_stream_text_deltas(delta={"text": "hello"}) == ["hello"]
    assert extract_stream_text_deltas(
        event={
            "type": "content_block_delta",
            "delta": {"text": "world"},
        }
    ) == ["world"]
    assert extract_stream_text_deltas(
        event={
            "contentBlockDelta": {
                "delta": {
                    "reasoningContent": {
                        "text": "thinking",
                    }
                }
            }
        }
    ) == ["thinking"]


def test_extract_stream_text_deltas_dedupes_aliases_within_one_callback():
    assert extract_stream_text_deltas(
        "hello",
        data="hello",
        delta={"text": "hello"},
        event={"contentBlockDelta": {"delta": {"text": "hello"}}},
    ) == ["hello"]


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
