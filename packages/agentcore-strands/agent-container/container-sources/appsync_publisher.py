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
            self._seq += 1
            seq = self._seq
        self._futures.append(self._executor.submit(self._publish_sync, text, seq))

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

    def callback_handler(*args, **kwargs) -> None:
        for text in extract_stream_text_deltas(*args, **kwargs):
            publisher.publish(text)

    return callback_handler, publisher


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
    return text_parts


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
