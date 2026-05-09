"""Computer runtime event helpers for the Python Strands container."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def append_computer_task_event(
    *,
    tenant_id: str,
    computer_id: str,
    task_id: str,
    event_type: str,
    level: str = "info",
    payload: dict[str, Any] | None = None,
    api_url: str,
    api_secret: str,
    timeout: float = 10.0,
) -> dict[str, Any]:
    """Append a Computer task event through the runtime API."""

    if not tenant_id or not computer_id or not task_id:
        raise ValueError("tenant_id, computer_id, and task_id are required")
    if not event_type:
        raise ValueError("event_type is required")
    if not api_url or not api_secret:
        raise ValueError("api_url and api_secret are required")

    url = f"{api_url.rstrip('/')}/api/computers/runtime/tasks/{task_id}/events"
    body = json.dumps(
        {
            "tenantId": tenant_id,
            "computerId": computer_id,
            "eventType": event_type,
            "level": level,
            "payload": payload or {},
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "authorization": f"Bearer {api_secret}",
            "content-type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Computer event append failed HTTP {err.code}: {detail}") from err

    return json.loads(raw) if raw else {}
