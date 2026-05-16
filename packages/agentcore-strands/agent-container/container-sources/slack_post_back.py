"""Slack post-back bridge for Computer thread turns.

This is platform plumbing, not a workspace skill. A Slack-sourced Computer
turn is already underway by the time this helper is built; the helper snapshots
the API callback credentials and Slack envelope at entry, then persists the
final response through the same durable Thread response endpoint as normal
Computer turns with ``source=slack``.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from computer_thread_response import record_thread_turn_response


@dataclass(frozen=True)
class SlackPostBackClient:
    tenant_id: str
    computer_id: str
    task_id: str
    api_url: str
    api_secret: str
    envelope: dict[str, Any]

    @property
    def available(self) -> bool:
        return bool(
            self.tenant_id
            and self.computer_id
            and self.task_id
            and self.api_url
            and self.api_secret
            and self.envelope
        )

    def post_response(
        self,
        *,
        content: str,
        model: str | None = None,
        usage: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("Slack post-back client is missing required context")
        return record_thread_turn_response(
            tenant_id=self.tenant_id,
            computer_id=self.computer_id,
            task_id=self.task_id,
            content=content,
            model=model,
            usage=usage,
            source="slack",
            api_url=self.api_url,
            api_secret=self.api_secret,
        )


def build_slack_post_back_client(payload: dict[str, Any]) -> SlackPostBackClient | None:
    """Snapshot Slack response context from payload/env at coroutine entry."""

    envelope = _payload_slack_envelope(payload)
    if not envelope:
        return None

    return SlackPostBackClient(
        tenant_id=str(payload.get("sessionId") or payload.get("tenant_id") or ""),
        computer_id=str(payload.get("computer_id") or payload.get("computerId") or ""),
        task_id=str(payload.get("computer_task_id") or payload.get("computerTaskId") or ""),
        api_url=str(
            payload.get("thinkwork_api_url") or os.environ.get("THINKWORK_API_URL") or ""
        ).rstrip("/"),
        api_secret=str(
            payload.get("thinkwork_api_secret")
            or os.environ.get("API_AUTH_SECRET")
            or os.environ.get("THINKWORK_API_SECRET")
            or ""
        ),
        envelope=envelope,
    )


def _payload_slack_envelope(payload: dict[str, Any]) -> dict[str, Any]:
    slack = payload.get("slack")
    if isinstance(slack, dict):
        return dict(slack)

    raw = os.environ.get("SLACK_ENVELOPE") or ""
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}
