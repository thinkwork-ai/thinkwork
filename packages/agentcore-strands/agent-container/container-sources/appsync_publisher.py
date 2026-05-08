"""Best-effort AppSync chunk publisher for live Computer thread streaming."""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
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

    def callback_handler(**kwargs) -> None:
        data = kwargs.get("data")
        if isinstance(data, str):
            publisher.publish(data)

    return callback_handler, publisher


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
