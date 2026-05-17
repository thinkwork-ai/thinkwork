"""Persist Computer-native thread turn responses through the API service endpoint.

This is the durable side of the Computer streaming path. Live chunks can be
best-effort, but the final assistant message must be written through the API's
``thread-turn-response`` endpoint so Aurora remains the source of truth for
thread history, refresh, audit, and memory ingestion.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

_RETRY_DELAYS_SECONDS = (0.0, 1.0)


class ThreadResponsePersistenceError(RuntimeError):
    """Raised when the durable response row could not be recorded."""


def record_thread_turn_response(
    *,
    tenant_id: str,
    computer_id: str,
    task_id: str,
    content: str,
    model: str | None = None,
    usage: dict[str, Any] | None = None,
    source: str | None = None,
    requester_user_id: str | None = None,
    api_url: str | None = None,
    api_secret: str | None = None,
    timeout_seconds: float = 10.0,
) -> dict[str, Any]:
    """POST the final Computer turn response to the TypeScript API.

    ``api_url`` and ``api_secret`` are snapshotted by the caller at turn entry
    and passed through here. Falling back to env only supports direct unit use;
    hot path callers should not re-read env mid-turn.
    """

    api_url = (api_url or os.environ.get("THINKWORK_API_URL") or "").rstrip("/")
    api_secret = (
        api_secret
        or os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not api_url or not api_secret:
        raise ThreadResponsePersistenceError(
            "missing THINKWORK_API_URL / API_AUTH_SECRET for thread response persistence"
        )
    if not tenant_id or not computer_id or not task_id:
        raise ThreadResponsePersistenceError("tenant_id, computer_id, and task_id are required")

    url = f"{api_url}/api/computers/runtime/tasks/{task_id}/thread-turn-response"
    body = {
        "tenantId": tenant_id,
        "computerId": computer_id,
        "content": content,
    }
    if model:
        body["model"] = model
    if usage is not None:
        body["usage"] = usage
    if source:
        body["source"] = source
    if requester_user_id:
        body["requesterUserId"] = requester_user_id

    payload = json.dumps(body).encode("utf-8")
    last_error: Exception | None = None
    for attempt_idx, delay in enumerate(_RETRY_DELAYS_SECONDS, start=1):
        if delay:
            time.sleep(delay)
        request = urllib.request.Request(
            url,
            method="POST",
            data=payload,
            headers={
                "Authorization": f"Bearer {api_secret}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
                response_body = response.read().decode("utf-8", errors="replace")
                return json.loads(response_body) if response_body else {}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            if 400 <= exc.code < 500:
                raise ThreadResponsePersistenceError(
                    f"thread response persistence rejected: HTTP {exc.code}: {detail}"
                ) from exc
            logger.warning(
                "thread response persistence attempt=%d HTTP %s retryable",
                attempt_idx,
                exc.code,
            )
            last_error = exc
        except (TimeoutError, urllib.error.URLError, OSError) as exc:
            logger.warning(
                "thread response persistence attempt=%d transport error: %s",
                attempt_idx,
                exc,
            )
            last_error = exc

    raise ThreadResponsePersistenceError(
        f"thread response persistence exhausted retries: {last_error}"
    ) from last_error
