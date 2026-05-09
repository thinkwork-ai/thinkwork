"""Best-effort AppSync chunk publisher for live Computer thread streaming."""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor, wait

logger = logging.getLogger(__name__)

PostFn = Callable[[str, dict[str, str], bytes, float], tuple[int, str]]


class AppSyncChunkPublisher:
    """Publishes Strands text deltas to the AppSync Computer chunk mutation."""

    def __init__(
        self,
        *,
        thread_id: str,
        endpoint: str,
        api_key: str,
        post_fn: PostFn | None = None,
        timeout_seconds: float = 2.0,
    ) -> None:
        self.thread_id = thread_id
        self.endpoint = endpoint
        self.api_key = api_key
        self.post_fn = post_fn or _post
        self.timeout_seconds = timeout_seconds
        self._seq = 0
        self._emitted_text = ""
        self._last_raw_text: str | None = None
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="appsync-chunks",
        )
        self._futures = []

    def publish(self, text: str) -> None:
        if not text:
            return
        with self._lock:
            text = self._normalize_chunk_locked(text)
            if not text:
                return
            self._seq += 1
            seq = self._seq
        self._futures.append(self._executor.submit(self._publish_sync, text, seq))

    def _normalize_chunk_locked(self, text: str) -> str | None:
        """Convert Strands full-buffer repeats into append-only deltas."""
        if text == self._last_raw_text:
            return None
        self._last_raw_text = text

        if self._emitted_text and text.startswith(self._emitted_text):
            suffix = text[len(self._emitted_text) :]
            if not suffix:
                return None
            self._emitted_text = text
            return suffix

        self._emitted_text += text
        return text

    def drain(self, timeout_seconds: float = 2.0) -> None:
        if self._futures:
            wait(self._futures, timeout=timeout_seconds)
        self._executor.shutdown(wait=False, cancel_futures=False)

    def _publish_sync(self, text: str, seq: int) -> None:
        body = json.dumps(
            {
                "query": """
                    mutation PublishComputerThreadChunk(
                      $threadId: ID!
                      $chunk: AWSJSON!
                      $seq: Int!
                    ) {
                      publishComputerThreadChunk(
                        threadId: $threadId
                        chunk: $chunk
                        seq: $seq
                      ) {
                        threadId
                        chunk
                        seq
                        publishedAt
                      }
                    }
                """,
                "variables": {
                    "threadId": self.thread_id,
                    "chunk": json.dumps({"text": text}),
                    "seq": seq,
                },
            }
        ).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
        }

        status, response_text = self._attempt(body, headers)
        if _retryable(status):
            status, response_text = self._attempt(body, headers)
        if status >= 400:
            logger.warning(
                "AppSync chunk publish failed: status=%s body=%s",
                status,
                response_text[:500],
            )

    def _attempt(self, body: bytes, headers: dict[str, str]) -> tuple[int, str]:
        try:
            return self.post_fn(self.endpoint, headers, body, self.timeout_seconds)
        except Exception as exc:  # noqa: BLE001 - callback must never fail the turn
            logger.warning("AppSync chunk publish error: %s", exc)
            return 599, str(exc)


def build_appsync_chunk_callback(
    thread_id: str,
    *,
    env: dict[str, str] | os._Environ[str] = os.environ,
    post_fn: PostFn | None = None,
    tool_event_sink: Callable[[str, str, dict], None] | None = None,
) -> tuple[Callable[..., None] | None, AppSyncChunkPublisher | None]:
    endpoint = env.get("APPSYNC_ENDPOINT") or env.get("APPSYNC_ENDPOINT_URL") or ""
    api_key = env.get("APPSYNC_API_KEY") or env.get("GRAPHQL_API_KEY") or ""
    if not thread_id or not endpoint or not api_key:
        return None, None

    publisher = AppSyncChunkPublisher(
        thread_id=thread_id,
        endpoint=endpoint,
        api_key=api_key,
        post_fn=post_fn,
    )

    # Live tool-call telemetry. Strands fires the streaming callback for every
    # event Bedrock emits during a turn, including `contentBlockStart` blocks
    # whose `start.toolUse` carries the tool name + invocation id. We emit a
    # `tool_invocation_started` computer event the first time we see each
    # toolUseId so the UI can render the row immediately, instead of waiting
    # for end-of-turn reconstruction in server.py:1659-1710 (which only fires
    # after agent.messages is fully populated, hence the user-visible "all
    # tools appear at once when the turn ends" behavior).
    seen_tool_uses: set[str] = set()

    def callback_handler(*args, **kwargs) -> None:
        for text in extract_stream_text_deltas(*args, **kwargs):
            publisher.publish(text)
        if tool_event_sink is not None:
            for tool_use in extract_tool_use_starts(
                *args, seen=seen_tool_uses, **kwargs
            ):
                try:
                    tool_event_sink(
                        "tool_invocation_started",
                        "info",
                        tool_use,
                    )
                except Exception as exc:  # noqa: BLE001 - never fail the turn
                    logger.warning(
                        "tool_invocation_started emit failed: %s", exc
                    )

    return callback_handler, publisher


def extract_tool_use_starts(
    *args,
    seen: set[str] | None = None,
    **kwargs,
) -> list[dict]:
    """Yield tool-invocation start payloads from a Strands callback.

    Strands routes Bedrock event-stream frames through the same callback that
    delivers text deltas. We pick up two shapes:

    - Bedrock `contentBlockStart` frames with `start.toolUse: {toolUseId,
      name, input?}`. These have a stable id and are emitted exactly once per
      tool call.
    - Strands' `current_tool_use={"name": "..."}` convenience kwarg, which
      appears without an id. We synthesize a positional id (`tool::<index>`)
      to dedup repeats.

    The optional `seen` set lets the caller dedup across many callback fires
    over the lifetime of one turn — pass the same set in each call.
    """
    if seen is None:
        seen = set()
    payloads: list = list(args)
    for key in ("event", "data", "delta", "chunk"):
        if key in kwargs:
            payloads.append(kwargs[key])
    # `current_tool_use` is a Strands convenience kwarg whose value is the
    # tool_use dict itself (e.g. {"name": "search"}), not an envelope. Handle
    # it directly so a bare {"name": ...} dict is recognized as a tool_use
    # rather than an opaque payload (the generic walk only matches known
    # envelope shapes like contentBlockStart / toolUse / current_tool_use).
    direct_tool_uses: list[dict] = []
    if "current_tool_use" in kwargs and isinstance(
        kwargs["current_tool_use"], dict
    ):
        direct_tool_uses.append(_normalize_tool_use(kwargs["current_tool_use"]))
    if not payloads and not direct_tool_uses and kwargs:
        payloads.append(kwargs)

    starts: list[dict] = []
    for payload in payloads:
        direct_tool_uses.extend(_walk_for_tool_use_starts(payload))
    for tool_use in direct_tool_uses:
        tool_use_id = tool_use.get("tool_use_id") or ""
        tool_name = tool_use.get("tool_name") or ""
        if not tool_use_id and not tool_name:
            continue
        dedup_key = tool_use_id or f"name::{tool_name}::{len(seen)}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        starts.append(tool_use)
    return starts


def _walk_for_tool_use_starts(value) -> list[dict]:
    """Recursively scan a Strands/Bedrock callback payload for tool-use starts."""
    if isinstance(value, dict):
        # Bedrock `contentBlockStart`
        if "contentBlockStart" in value:
            inner = value["contentBlockStart"]
            if isinstance(inner, dict):
                start = inner.get("start")
                if isinstance(start, dict) and isinstance(
                    start.get("toolUse"), dict
                ):
                    return [_normalize_tool_use(start["toolUse"])]
        # Direct `toolUse` block (mid-stream Anthropic shape)
        if isinstance(value.get("toolUse"), dict):
            return [_normalize_tool_use(value["toolUse"])]
        # Strands convenience kwarg
        if isinstance(value.get("current_tool_use"), dict):
            return [_normalize_tool_use(value["current_tool_use"])]
        # Recurse into common envelope keys
        results: list[dict] = []
        for key in ("event", "data", "delta", "chunk", "message"):
            if key in value:
                results.extend(_walk_for_tool_use_starts(value[key]))
        return results
    if isinstance(value, list):
        results: list[dict] = []
        for item in value:
            results.extend(_walk_for_tool_use_starts(item))
        return results
    return []


def _normalize_tool_use(tool_use: dict) -> dict:
    """Project a Bedrock/Strands toolUse dict into our event payload shape."""
    name = tool_use.get("name") or tool_use.get("toolName") or ""
    tool_use_id = (
        tool_use.get("toolUseId")
        or tool_use.get("tool_use_id")
        or tool_use.get("id")
        or ""
    )
    raw_input = tool_use.get("input") or tool_use.get("arguments") or {}
    input_preview = ""
    if isinstance(raw_input, str):
        input_preview = raw_input[:500]
    elif isinstance(raw_input, dict):
        if "query" in raw_input and isinstance(raw_input["query"], str):
            input_preview = raw_input["query"][:500]
        else:
            try:
                input_preview = json.dumps(raw_input, default=str)[:500]
            except Exception:  # noqa: BLE001
                input_preview = str(raw_input)[:500]
    return {
        "tool_name": name,
        "tool_use_id": tool_use_id,
        "input_preview": input_preview,
    }


def extract_stream_text_deltas(*args, **kwargs) -> list[str]:
    """Extract textual deltas from Strands and Bedrock stream callback payloads."""
    payloads = list(args)
    for key in ("data", "delta", "chunk", "event"):
        if key in kwargs:
            payloads.append(kwargs[key])
    if not payloads and kwargs:
        payloads.append(kwargs)

    text_parts: list[str] = []
    for payload in payloads:
        text_parts.extend(_extract_text_parts(payload))
    return _dedupe_text_parts(text_parts)


def _dedupe_text_parts(text_parts: list[str]) -> list[str]:
    """Collapse duplicate aliases from a single Strands callback invocation."""
    deduped: list[str] = []
    seen: set[str] = set()
    for text in text_parts:
        if text in seen:
            continue
        seen.add(text)
        deduped.append(text)
    return deduped


def _extract_text_parts(value) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, bytes):
        decoded = value.decode("utf-8", errors="replace")
        return [decoded] if decoded else []
    if isinstance(value, dict):
        return _extract_text_parts_from_dict(value)
    if isinstance(value, Iterable):
        text_parts: list[str] = []
        for item in value:
            text_parts.extend(_extract_text_parts(item))
        return text_parts
    return []


def _extract_text_parts_from_dict(value: dict) -> list[str]:
    if "contentBlockDelta" in value:
        return _extract_bedrock_delta(value["contentBlockDelta"])
    if value.get("type") == "content_block_delta":
        return _extract_bedrock_delta(value)
    if value.get("type") in {"text_delta", "output_text_delta"}:
        return _extract_known_text_delta(value)

    for key in ("data", "delta", "chunk", "event"):
        if key in value:
            parts = _extract_text_parts(value[key])
            if parts:
                return parts

    if value.get("type") == "text" and isinstance(value.get("text"), str):
        text = value["text"]
        return [text] if text else []
    if set(value.keys()) <= {"text"} and isinstance(value.get("text"), str):
        text = value["text"]
        return [text] if text else []

    return []


def _extract_bedrock_delta(value) -> list[str]:
    if not isinstance(value, dict):
        return _extract_text_parts(value)

    delta = value.get("delta", value)
    if not isinstance(delta, dict):
        return _extract_text_parts(delta)

    text = delta.get("text")
    if isinstance(text, str) and text:
        return [text]

    reasoning = delta.get("reasoningContent")
    if isinstance(reasoning, dict):
        reasoning_text = reasoning.get("text") or reasoning.get("reasoningText")
        if isinstance(reasoning_text, str) and reasoning_text:
            return [reasoning_text]

    return []


def _extract_known_text_delta(value: dict) -> list[str]:
    text = value.get("text") or value.get("delta")
    if isinstance(text, str) and text:
        return [text]
    return []


def _post(
    endpoint: str,
    headers: dict[str, str],
    body: bytes,
    timeout_seconds: float,
) -> tuple[int, str]:
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            return response.status, response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", errors="replace")


def _retryable(status: int) -> bool:
    return status == 429 or status >= 500
