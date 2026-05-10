"""Typed UIMessage publisher for the AppSync Computer chunk subscription.

Plan-012 U5. Inert by default — the factory closure accepts a per-Computer-
thread `ui_message_emit` capability flag (NOT a runtime-wide env flag) and
produces typed `UIMessageChunk` payloads only when that flag is True. Every
non-Computer call site (Flue, sub-agent dispatch) leaves the flag at its
default `False`, so this module ships zero behavior change for them.

Wire format: each emitted chunk is a JSON object matching exactly one row
of the AI SDK Stream Protocol. Per the contract spec
(docs/specs/computer-ai-elements-contract-v1.md):

  - `text-{start,delta,end}` carry a stable `id` per content block — minting
    a new id per delta renders as N text bubbles in the client (failure
    mode).
  - `reasoning-{start,delta,end}` are analogous for `reasoningContent`.
  - `tool-input-available` is the terminal tool input shape (no
    intermediate `tool-input-delta` in v1; Strands materializes tool args
    atomically).
  - `tool-output-available` carries the tool result.
  - `finish` (and friends) close the assistant turn.

The publisher does NOT replace the legacy AppSyncChunkPublisher — it is a
sibling that the Computer thread handler uses when ui_message_emit=True.
The legacy `{text}` envelope path stays live for non-Computer agents and
for Computer threads when ui_message_emit=False (rollback posture).

Live HTTP follows the same urllib + ThreadPoolExecutor pattern as
appsync_publisher.py for consistency. The plan note about httpx.AsyncClient
is for ad-hoc tool HTTP (per feedback_hindsight_async_tools); inside the
Strands streaming callback we stay synchronous to match the existing
publisher's contract.

Smoke pin shape per feedback_smoke_pin_dispatch_status_in_response:
    {ok: bool, persisted: bool, validated: bool}
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Any

logger = logging.getLogger(__name__)

PostFn = Callable[[str, dict[str, str], bytes, float], tuple[int, str]]
# A `seam_fn` lets tests intercept the live HTTP path. Signature mirrors
# `_live_emit`: (chunk_dict, *, thread_id, seq) -> dispatch dict.
SeamFn = Callable[..., dict[str, Any]]


# Wire-protocol vocabulary — kept locally so this module is the single
# source of truth for what we emit. Mirror with the TS parser at
# apps/computer/src/lib/ui-message-chunk-parser.ts and the contract spec.
ID_REQUIRED_TYPES: frozenset[str] = frozenset(
    {
        "text-start",
        "text-delta",
        "text-end",
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
    }
)

ID_OPTIONAL_TYPES: frozenset[str] = frozenset(
    {
        "start",
        "start-step",
        "finish",
        "finish-step",
        "abort",
        "error",
        "tool-input-start",
        "tool-input-delta",
        "tool-input-available",
        "tool-input-error",
        "tool-output-available",
        "tool-output-error",
        "source-url",
        "source-document",
        "file",
        "message-metadata",
    }
)


def _inert_emit(
    chunk: dict[str, Any],
    *,
    thread_id: str,
    seq: int,
) -> dict[str, Any]:
    """No-op publisher used when the Computer thread handler does NOT pass
    ui_message_emit=True. Returns a dispatch dict so smoke pins can detect
    the inert state instead of silently no-opping (per
    feedback_ship_inert_pattern: stubs throw, never silently no-op — the
    return value here is the explicit signal)."""
    return {
        "ok": False,
        "persisted": False,
        "validated": False,
        "reason": "INERT_NOT_WIRED",
    }


def get_ui_message_publisher_for_test() -> SeamFn:
    """Default seam used when no explicit `seam_fn` is passed to the
    factory. Tests pin this to assert which side of the body-swap is live —
    U5 ships with `_inert_emit`; U6 flips to `_live_emit` for the
    Computer thread handler.
    """
    return _inert_emit


def make_ui_message_publisher_fn(
    *,
    thread_id: str,
    endpoint: str,
    api_key: str,
    ui_message_emit: bool = False,
    post_fn: PostFn | None = None,
    seam_fn: SeamFn | None = None,
    timeout_seconds: float = 2.0,
) -> "UIMessagePublisher":
    """Build a UIMessagePublisher with all environment-derived inputs
    snapshotted at construction time.

    Per `feedback_completion_callback_snapshot_pattern`, env values are
    captured at factory entry and never re-read mid-turn — accidentally
    re-reading `os.environ` after the agent loop has shadowed values has
    burned us before (PR #563).

    Args:
        thread_id: Computer thread UUID — the AppSync subscription target.
        endpoint: AppSync HTTP GraphQL endpoint URL (POST target).
        api_key: AppSync API key for the publish mutation.
        ui_message_emit: Per-Computer-thread capability flag. Default
            `False` keeps the publisher inert; `True` switches to typed
            UIMessage emission. Non-Computer callers (Flue, sub-agents)
            MUST leave this False.
        post_fn: Synchronous HTTP poster — defaults to urllib.request.
            Tests inject a fake.
        seam_fn: Override the live emit function entirely. Defaults to
            `get_ui_message_publisher_for_test()` so the inert/live flip
            is observable from outside the closure (body-swap forcing).
        timeout_seconds: HTTP request timeout per attempt.
    """
    seam = seam_fn if seam_fn is not None else get_ui_message_publisher_for_test()

    return UIMessagePublisher(
        thread_id=thread_id,
        endpoint=endpoint,
        api_key=api_key,
        ui_message_emit=ui_message_emit,
        post_fn=post_fn or _post,
        seam_fn=seam,
        timeout_seconds=timeout_seconds,
    )


def make_ui_message_publisher_from_env(
    *,
    thread_id: str,
    env: dict[str, str] | os._Environ[str] = os.environ,
    ui_message_emit: bool = False,
    post_fn: PostFn | None = None,
    seam_fn: SeamFn | None = None,
) -> "UIMessagePublisher | None":
    """Construct a publisher from environment variables, snapshotted once
    at the call site. Returns None when required env is missing — callers
    can fall back to the legacy `{text}` publisher.
    """
    endpoint = env.get("APPSYNC_ENDPOINT") or env.get("APPSYNC_ENDPOINT_URL") or ""
    api_key = env.get("APPSYNC_API_KEY") or env.get("GRAPHQL_API_KEY") or ""
    if not thread_id or not endpoint or not api_key:
        return None
    return make_ui_message_publisher_fn(
        thread_id=thread_id,
        endpoint=endpoint,
        api_key=api_key,
        ui_message_emit=ui_message_emit,
        post_fn=post_fn,
        seam_fn=seam_fn,
    )


class UIMessagePublisher:
    """Async-fire AppSync publisher emitting typed `UIMessageChunk` JSON.

    The publisher behaves like `AppSyncChunkPublisher` (lock + monotonic
    seq + ThreadPoolExecutor for fire-and-forget HTTP), but writes typed
    chunks instead of `{text}` envelopes when `ui_message_emit` is True.
    When False, every `publish_part` call short-circuits to a no-op so the
    legacy publisher can run alongside without double-publishing.
    """

    def __init__(
        self,
        *,
        thread_id: str,
        endpoint: str,
        api_key: str,
        ui_message_emit: bool,
        post_fn: PostFn,
        seam_fn: SeamFn,
        timeout_seconds: float = 2.0,
    ) -> None:
        self.thread_id = thread_id
        self.endpoint = endpoint
        self.api_key = api_key
        self.ui_message_emit = ui_message_emit
        self.post_fn = post_fn
        self.seam_fn = seam_fn
        self.timeout_seconds = timeout_seconds
        self._seq = 0
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="ui-message-chunks",
        )
        self._futures: list = []
        self._dispatches: list[dict[str, Any]] = []

    def publish_part(self, chunk: dict[str, Any]) -> dict[str, Any]:
        """Validate `chunk` against the wire vocabulary and dispatch.

        Returns a smoke-pin dispatch dict synchronously: `{ok, persisted,
        validated, ...}`. The actual HTTP POST runs on the background
        executor unless `seam_fn` short-circuits (e.g. inert mode or
        tests).
        """
        if not self.ui_message_emit:
            return _inert_emit(chunk, thread_id=self.thread_id, seq=0)

        validated, reason = _validate_chunk(chunk)
        if not validated:
            return {
                "ok": False,
                "persisted": False,
                "validated": False,
                "reason": reason,
            }

        with self._lock:
            self._seq += 1
            seq = self._seq

        # If a non-default seam_fn is in use (typically `_live_emit` from
        # U6's body-swap, or a test fake), call it synchronously. The
        # default `_inert_emit` returns instantly so this branch is cheap.
        if self.seam_fn is not _inert_emit:
            dispatch = self.seam_fn(
                chunk,
                thread_id=self.thread_id,
                seq=seq,
                endpoint=self.endpoint,
                api_key=self.api_key,
                post_fn=self.post_fn,
                timeout_seconds=self.timeout_seconds,
            )
            self._dispatches.append(dispatch)
            return dispatch

        # Default live path: fire the AppSync mutation in the background
        # so the Strands streaming callback returns immediately (matches
        # the legacy AppSyncChunkPublisher pattern).
        self._futures.append(
            self._executor.submit(self._publish_sync, chunk, seq)
        )
        dispatch = {
            "ok": True,
            "persisted": True,
            "validated": True,
            "seq": seq,
            "type": chunk.get("type"),
        }
        self._dispatches.append(dispatch)
        return dispatch

    def drain(self, timeout_seconds: float = 2.0) -> None:
        if self._futures:
            wait(self._futures, timeout=timeout_seconds)
        self._executor.shutdown(wait=False, cancel_futures=False)

    @property
    def last_dispatches(self) -> list[dict[str, Any]]:
        """Tests + smoke pins introspect the dispatch trail."""
        return list(self._dispatches)

    def _publish_sync(self, chunk: dict[str, Any], seq: int) -> dict[str, Any]:
        return _live_emit(
            chunk,
            thread_id=self.thread_id,
            seq=seq,
            endpoint=self.endpoint,
            api_key=self.api_key,
            post_fn=self.post_fn,
            timeout_seconds=self.timeout_seconds,
        )


def _live_emit(
    chunk: dict[str, Any],
    *,
    thread_id: str,
    seq: int,
    endpoint: str,
    api_key: str,
    post_fn: PostFn,
    timeout_seconds: float,
) -> dict[str, Any]:
    """POST the typed `chunk` to `publishComputerThreadChunk` and return
    a dispatch dict. Retries once on retryable status codes (per
    feedback_hindsight_async_tools: 2 attempts total)."""
    body = json.dumps(
        {
            "query": (
                "mutation PublishComputerThreadChunk("
                "$threadId: ID!, $chunk: AWSJSON!, $seq: Int!"
                ") {"
                "  publishComputerThreadChunk("
                "    threadId: $threadId, chunk: $chunk, seq: $seq"
                "  ) { threadId chunk seq publishedAt }"
                "}"
            ),
            "variables": {
                "threadId": thread_id,
                "chunk": json.dumps(chunk),
                "seq": seq,
            },
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
    }
    status, response_text = _attempt(post_fn, endpoint, headers, body, timeout_seconds)
    if _retryable(status):
        status, response_text = _attempt(
            post_fn, endpoint, headers, body, timeout_seconds
        )
    if status >= 400:
        logger.warning(
            "ui_message_publisher publish failed: status=%s body=%s",
            status,
            response_text[:500],
        )
        return {
            "ok": False,
            "persisted": False,
            "validated": True,
            "seq": seq,
            "reason": "HTTP_ERROR",
            "status": status,
        }
    return {
        "ok": True,
        "persisted": True,
        "validated": True,
        "seq": seq,
        "type": chunk.get("type"),
    }


def _validate_chunk(chunk: dict[str, Any]) -> tuple[bool, str]:
    """Cheap wire-vocabulary validation. Mirrors the TS chunk parser."""
    if not isinstance(chunk, dict):
        return False, "NOT_OBJECT"
    chunk_type = chunk.get("type")
    if not isinstance(chunk_type, str):
        return False, "MISSING_TYPE"
    if chunk_type not in ID_REQUIRED_TYPES and chunk_type not in ID_OPTIONAL_TYPES:
        if not chunk_type.startswith("data-"):
            return False, "UNKNOWN_TYPE"
    if chunk_type in ID_REQUIRED_TYPES and not isinstance(chunk.get("id"), str):
        return False, "MISSING_ID"
    if chunk_type in {"text-delta", "reasoning-delta"} and not isinstance(
        chunk.get("delta"), str
    ):
        return False, "MISSING_DELTA"
    if chunk_type in {
        "tool-input-start",
        "tool-input-delta",
        "tool-input-available",
        "tool-input-error",
        "tool-output-available",
        "tool-output-error",
    } and not isinstance(chunk.get("toolCallId"), str):
        return False, "MISSING_TOOL_CALL_ID"
    if chunk_type in {
        "tool-input-start",
        "tool-input-available",
        "tool-input-error",
    } and not isinstance(chunk.get("toolName"), str):
        return False, "MISSING_TOOL_NAME"
    if chunk_type == "error" and not isinstance(chunk.get("errorText"), str):
        return False, "MISSING_ERROR_TEXT"
    return True, ""


def _attempt(
    post_fn: PostFn,
    endpoint: str,
    headers: dict[str, str],
    body: bytes,
    timeout_seconds: float,
) -> tuple[int, str]:
    try:
        return post_fn(endpoint, headers, body, timeout_seconds)
    except Exception as exc:  # noqa: BLE001 - publishing must never crash the turn
        logger.warning("ui_message_publisher publish error: %s", exc)
        return 599, str(exc)


def _retryable(status: int) -> bool:
    return status == 429 or status >= 500


def _post(
    endpoint: str,
    headers: dict[str, str],
    body: bytes,
    timeout_seconds: float,
) -> tuple[int, str]:
    request = urllib.request.Request(
        endpoint, data=body, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Bedrock-shape -> UIMessage chunk mapping helpers (pure, side-effect-free)
# ---------------------------------------------------------------------------


def text_start(part_id: str) -> dict[str, Any]:
    return {"type": "text-start", "id": part_id}


def text_delta(part_id: str, delta: str) -> dict[str, Any]:
    return {"type": "text-delta", "id": part_id, "delta": delta}


def text_end(part_id: str) -> dict[str, Any]:
    return {"type": "text-end", "id": part_id}


def reasoning_start(part_id: str) -> dict[str, Any]:
    return {"type": "reasoning-start", "id": part_id}


def reasoning_delta(part_id: str, delta: str) -> dict[str, Any]:
    return {"type": "reasoning-delta", "id": part_id, "delta": delta}


def reasoning_end(part_id: str) -> dict[str, Any]:
    return {"type": "reasoning-end", "id": part_id}


def tool_input_available(
    *, tool_call_id: str, tool_name: str, input_payload: Any
) -> dict[str, Any]:
    return {
        "type": "tool-input-available",
        "toolCallId": tool_call_id,
        "toolName": tool_name,
        "input": input_payload,
    }


def tool_output_available(
    *, tool_call_id: str, output: Any
) -> dict[str, Any]:
    return {
        "type": "tool-output-available",
        "toolCallId": tool_call_id,
        "output": output,
    }


def finish() -> dict[str, Any]:
    return {"type": "finish"}


def error(error_text: str) -> dict[str, Any]:
    return {"type": "error", "errorText": error_text}
