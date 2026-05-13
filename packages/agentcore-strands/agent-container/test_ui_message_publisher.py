"""Tests for the typed UIMessage publisher (plan-012 U5).

Pure-Python tests: no AppSync, no Bedrock, no Strands runtime. We pin:

- The body-swap forcing function: U5 ships with `_inert_emit` as the
  default seam; U6's flip is the inversion of `get_ui_message_publisher_for_test`.
- Per-Computer-thread capability gating: `ui_message_emit=False` keeps
  `publish_part` a no-op, so non-Computer agents (Flue, sub-agents)
  inherit the legacy `{text}` shape unchanged.
- Wire-protocol conformance: every chunk we emit conforms to the
  contract spec at docs/specs/computer-ai-elements-contract-v1.md.
- Retry + dispatch shape: `_live_emit` retries once on 5xx/429 and
  surfaces `{ok, persisted, validated}` per
  feedback_smoke_pin_dispatch_status_in_response.
"""

from __future__ import annotations

import json

from ui_message_publisher import (
    UIMessagePublisher,
    _inert_emit,
    _live_emit,
    _validate_chunk,
    error,
    finish,
    get_ui_message_publisher_for_test,
    make_ui_message_publisher_fn,
    make_ui_message_publisher_from_env,
    reasoning_delta,
    reasoning_end,
    reasoning_start,
    text_delta,
    text_end,
    text_start,
    tool_input_available,
    tool_output_available,
)

# ---------------------------------------------------------------------------
# Body-swap forcing function — U6 inverts this assertion to `_live_emit`
# ---------------------------------------------------------------------------


def test_inert_seam_is_the_default():
    """U5 ships inert. U6's body-swap PR flips this to `_live_emit` for the
    Computer thread handler entrypoint while non-Computer entrypoints stay
    pinned to `_inert_emit` (capability isolation regression)."""
    assert get_ui_message_publisher_for_test() is _inert_emit


# ---------------------------------------------------------------------------
# Capability gating — per-Computer-thread, never a global env flag
# ---------------------------------------------------------------------------


def test_ui_message_emit_false_short_circuits_to_inert():
    publisher = make_ui_message_publisher_fn(
        thread_id="thread-1",
        endpoint="https://x.example.com/graphql",
        api_key="key",
        ui_message_emit=False,  # default; the value Flue + sub-agents pass
    )
    dispatch = publisher.publish_part(text_start("p1"))
    assert dispatch == {
        "ok": False,
        "persisted": False,
        "validated": False,
        "reason": "INERT_NOT_WIRED",
    }
    publisher.drain()


def test_ui_message_emit_true_uses_live_path_when_seam_overridden():
    """When the Computer thread handler passes `ui_message_emit=True` AND a
    seam override (test fake or the U6 flip), publish_part returns the
    live dispatch shape."""
    seen: list[dict] = []

    def fake_seam(chunk, *, thread_id, seq, **_kwargs):
        seen.append({"chunk": chunk, "thread_id": thread_id, "seq": seq})
        return {
            "ok": True,
            "persisted": True,
            "validated": True,
            "seq": seq,
            "type": chunk.get("type"),
        }

    publisher = make_ui_message_publisher_fn(
        thread_id="thread-1",
        endpoint="https://x.example.com/graphql",
        api_key="key",
        ui_message_emit=True,
        seam_fn=fake_seam,
    )
    dispatch = publisher.publish_part(text_start("p1"))
    assert dispatch["ok"] is True
    assert dispatch["persisted"] is True
    assert dispatch["validated"] is True
    assert seen[0]["chunk"] == {"type": "text-start", "id": "p1"}
    publisher.drain()


def test_factory_from_env_returns_none_when_required_env_missing():
    publisher = make_ui_message_publisher_from_env(
        thread_id="thread-1", env={}, ui_message_emit=True
    )
    assert publisher is None


def test_factory_from_env_snapshots_endpoint_and_key():
    publisher = make_ui_message_publisher_from_env(
        thread_id="thread-1",
        env={
            "APPSYNC_ENDPOINT": "https://x.example.com/graphql",
            "APPSYNC_API_KEY": "key-from-env",
        },
        ui_message_emit=True,
    )
    assert publisher is not None
    assert publisher.endpoint == "https://x.example.com/graphql"
    assert publisher.api_key == "key-from-env"
    assert publisher.ui_message_emit is True


# ---------------------------------------------------------------------------
# Wire-vocabulary conformance — every chunk shape we emit
# ---------------------------------------------------------------------------


def test_text_chunk_helpers_emit_canonical_shapes():
    assert text_start("p1") == {"type": "text-start", "id": "p1"}
    assert text_delta("p1", "Hello") == {
        "type": "text-delta",
        "id": "p1",
        "delta": "Hello",
    }
    assert text_end("p1") == {"type": "text-end", "id": "p1"}


def test_reasoning_chunk_helpers_emit_canonical_shapes():
    assert reasoning_start("r1") == {"type": "reasoning-start", "id": "r1"}
    assert reasoning_delta("r1", "Hmm") == {
        "type": "reasoning-delta",
        "id": "r1",
        "delta": "Hmm",
    }
    assert reasoning_end("r1") == {"type": "reasoning-end", "id": "r1"}


def test_tool_chunk_helpers_emit_canonical_shapes():
    assert tool_input_available(
        tool_call_id="t1",
        tool_name="renderFragment",
        input_payload={"tsx": "<App />"},
    ) == {
        "type": "tool-input-available",
        "toolCallId": "t1",
        "toolName": "renderFragment",
        "input": {"tsx": "<App />"},
    }
    assert tool_output_available(tool_call_id="t1", output={"rendered": True}) == {
        "type": "tool-output-available",
        "toolCallId": "t1",
        "output": {"rendered": True},
    }


def test_finish_and_error_helpers():
    assert finish() == {"type": "finish"}
    assert error("rate limited") == {"type": "error", "errorText": "rate limited"}


def test_text_chunk_id_is_stable_across_deltas():
    """Failure mode: minting a new id per delta renders as N text bubbles
    in the client. This pins that we always reuse the same id from
    text-start through text-end."""
    captured: list[dict] = []

    def fake_seam(chunk, **_kwargs):
        captured.append(chunk)
        return {"ok": True, "persisted": True, "validated": True}

    publisher = make_ui_message_publisher_fn(
        thread_id="thread-1",
        endpoint="https://x",
        api_key="k",
        ui_message_emit=True,
        seam_fn=fake_seam,
    )
    publisher.publish_part(text_start("p1"))
    publisher.publish_part(text_delta("p1", "Hello"))
    publisher.publish_part(text_delta("p1", " world"))
    publisher.publish_part(text_end("p1"))
    publisher.drain()

    ids = [c.get("id") for c in captured]
    assert ids == ["p1", "p1", "p1", "p1"]


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


def test_validator_accepts_known_protocol_types():
    valid_chunks = [
        text_start("p1"),
        text_delta("p1", "x"),
        text_end("p1"),
        reasoning_start("r1"),
        reasoning_delta("r1", "x"),
        reasoning_end("r1"),
        tool_input_available(tool_call_id="t1", tool_name="x", input_payload={}),
        tool_output_available(tool_call_id="t1", output={}),
        tool_input_available(
            tool_call_id="draft-1",
            tool_name="preview_app",
            input_payload={"name": "CRM Draft"},
        ),
        tool_output_available(
            tool_call_id="draft-1",
            output={
                "type": "draft_app_preview",
                "draft": {
                    "draftId": "draft_123",
                    "unsaved": True,
                },
            },
        ),
        finish(),
        error("boom"),
        {"type": "start"},
        {"type": "abort"},
        {"type": "data-progress", "data": {"percent": 0.5}},
    ]
    for chunk in valid_chunks:
        ok, reason = _validate_chunk(chunk)
        assert ok, f"expected {chunk} to validate, got reason={reason}"


def test_validator_rejects_id_required_chunks_without_id():
    ok, reason = _validate_chunk({"type": "text-delta", "delta": "x"})
    assert not ok
    assert reason == "MISSING_ID"


def test_validator_rejects_unknown_type():
    ok, reason = _validate_chunk({"type": "future-shaped"})
    assert not ok
    assert reason == "UNKNOWN_TYPE"


def test_validator_rejects_text_delta_with_non_string_delta():
    ok, reason = _validate_chunk({"type": "text-delta", "id": "p1", "delta": 7})
    assert not ok
    assert reason == "MISSING_DELTA"


def test_validator_rejects_tool_input_available_without_tool_name():
    ok, reason = _validate_chunk(
        {
            "type": "tool-input-available",
            "toolCallId": "t1",
            "input": {},
        }
    )
    assert not ok
    assert reason == "MISSING_TOOL_NAME"


def test_validator_rejects_error_chunk_without_error_text():
    ok, reason = _validate_chunk({"type": "error"})
    assert not ok
    assert reason == "MISSING_ERROR_TEXT"


def test_publish_part_returns_validation_failure_dispatch():
    publisher = make_ui_message_publisher_fn(
        thread_id="thread-1",
        endpoint="https://x",
        api_key="k",
        ui_message_emit=True,
    )
    dispatch = publisher.publish_part({"type": "text-delta", "delta": "x"})
    assert dispatch == {
        "ok": False,
        "persisted": False,
        "validated": False,
        "reason": "MISSING_ID",
    }
    publisher.drain()


# ---------------------------------------------------------------------------
# _live_emit — retry + smoke-pin dispatch shape
# ---------------------------------------------------------------------------


def test_live_emit_returns_ok_on_200():
    calls: list[dict] = []

    def post(endpoint, headers, body, timeout):
        calls.append(
            {
                "endpoint": endpoint,
                "headers": dict(headers),
                "body": json.loads(body.decode("utf-8")),
                "timeout": timeout,
            }
        )
        return 200, json.dumps({"data": {"publishComputerThreadChunk": {"seq": 1}}})

    dispatch = _live_emit(
        text_delta("p1", "Hello"),
        thread_id="thread-1",
        seq=1,
        endpoint="https://x",
        api_key="k",
        post_fn=post,
        timeout_seconds=2.0,
    )

    assert dispatch == {
        "ok": True,
        "persisted": True,
        "validated": True,
        "seq": 1,
        "type": "text-delta",
    }
    assert len(calls) == 1
    assert calls[0]["headers"]["x-api-key"] == "k"
    assert "publishComputerThreadChunk" in calls[0]["body"]["query"]
    assert calls[0]["body"]["variables"]["threadId"] == "thread-1"
    assert calls[0]["body"]["variables"]["seq"] == 1
    chunk_payload = json.loads(calls[0]["body"]["variables"]["chunk"])
    assert chunk_payload == {"type": "text-delta", "id": "p1", "delta": "Hello"}


def test_live_emit_retries_once_on_500():
    statuses = iter([500, 200])

    def post(_endpoint, _headers, _body, _timeout):
        return next(statuses), "{}"

    dispatch = _live_emit(
        text_start("p1"),
        thread_id="thread-1",
        seq=2,
        endpoint="https://x",
        api_key="k",
        post_fn=post,
        timeout_seconds=2.0,
    )
    assert dispatch["ok"] is True


def test_live_emit_returns_http_error_after_two_failed_attempts():
    statuses = iter([500, 500])

    def post(_endpoint, _headers, _body, _timeout):
        return next(statuses), "boom"

    dispatch = _live_emit(
        text_start("p1"),
        thread_id="thread-1",
        seq=3,
        endpoint="https://x",
        api_key="k",
        post_fn=post,
        timeout_seconds=2.0,
    )
    assert dispatch["ok"] is False
    assert dispatch["reason"] == "HTTP_ERROR"
    assert dispatch["status"] == 500


def test_live_emit_429_is_retryable():
    statuses = iter([429, 200])

    def post(_endpoint, _headers, _body, _timeout):
        return next(statuses), "{}"

    dispatch = _live_emit(
        text_start("p1"),
        thread_id="thread-1",
        seq=4,
        endpoint="https://x",
        api_key="k",
        post_fn=post,
        timeout_seconds=2.0,
    )
    assert dispatch["ok"] is True


def test_live_emit_swallows_post_exception_to_dispatch_failure():
    def post(_endpoint, _headers, _body, _timeout):
        raise RuntimeError("network down")

    dispatch = _live_emit(
        text_start("p1"),
        thread_id="thread-1",
        seq=5,
        endpoint="https://x",
        api_key="k",
        post_fn=post,
        timeout_seconds=2.0,
    )
    assert dispatch["ok"] is False
    assert dispatch["reason"] == "HTTP_ERROR"


# ---------------------------------------------------------------------------
# UIMessagePublisher integration with default executor + drain
# ---------------------------------------------------------------------------


def test_publisher_with_default_seam_runs_executor_on_live_emit():
    posts: list[dict] = []

    def post(endpoint, headers, body, timeout):
        posts.append(
            {
                "endpoint": endpoint,
                "body": json.loads(body.decode("utf-8")),
            }
        )
        return 200, "{}"

    publisher = UIMessagePublisher(
        thread_id="thread-1",
        endpoint="https://x",
        api_key="k",
        ui_message_emit=True,
        post_fn=post,
        seam_fn=_inert_emit,  # default — triggers the executor path
        timeout_seconds=2.0,
    )

    publisher.publish_part(text_start("p1"))
    publisher.publish_part(text_delta("p1", "Hello"))
    publisher.publish_part(text_end("p1"))
    publisher.publish_part(finish())
    publisher.drain()

    types = [json.loads(p["body"]["variables"]["chunk"])["type"] for p in posts]
    assert types == ["text-start", "text-delta", "text-end", "finish"]


def test_publisher_seq_is_monotonic_and_appears_in_dispatches():
    publisher = make_ui_message_publisher_fn(
        thread_id="thread-1",
        endpoint="https://x",
        api_key="k",
        ui_message_emit=True,
        seam_fn=lambda chunk, **kw: {
            "ok": True,
            "persisted": True,
            "validated": True,
            "seq": kw["seq"],
        },
    )
    publisher.publish_part(text_start("p1"))
    publisher.publish_part(text_delta("p1", "x"))
    publisher.publish_part(text_end("p1"))
    publisher.drain()

    seqs = [d["seq"] for d in publisher.last_dispatches]
    assert seqs == [1, 2, 3]
