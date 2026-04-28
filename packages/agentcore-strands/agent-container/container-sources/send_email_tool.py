"""Injected Send Email tool for Strands agents.

Send Email is a platform built-in backed by ``/api/email/send``. It is not a
workspace filesystem skill: the parent agent gets a direct ``send_email`` tool
when the agent template enables it.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


def _post_json(url: str, *, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _append_cost(
    cost_sink: list[dict],
    *,
    recipient_count: int,
    duration_sec: float,
    error: str | None = None,
) -> None:
    metadata: dict[str, Any] = {"recipient_count": recipient_count}
    if error:
        metadata["error"] = error[:200]
    cost_sink.append(
        {
            "provider": "thinkwork-email",
            "event_type": "send_email",
            "amount_usd": 0,
            "duration_ms": int(duration_sec * 1000),
            "metadata": metadata,
        },
    )


def _normalize_recipients(to: list[str] | str) -> list[str]:
    if isinstance(to, str):
        raw = to.split(",")
    else:
        raw = to
    return [str(item).strip() for item in raw if str(item).strip()]


def build_send_email_tool(
    *,
    strands_tool_decorator: Callable[..., Any],
    send_email_config: dict[str, Any],
    cost_sink: list[dict],
) -> Any:
    api_url = str(send_email_config.get("apiUrl") or "").rstrip("/")
    api_secret = str(send_email_config.get("apiSecret") or "")
    agent_id = str(send_email_config.get("agentId") or "")
    tenant_id = str(send_email_config.get("tenantId") or "")
    default_thread_id = str(send_email_config.get("threadId") or "")
    inbound_message_id = str(send_email_config.get("inboundMessageId") or "")
    inbound_from = str(send_email_config.get("inboundFrom") or "")
    inbound_body = str(send_email_config.get("inboundBody") or "")

    @strands_tool_decorator
    def send_email(
        to: list[str] | str,
        subject: str,
        body: str,
        thread_id: str = "",
        mode: str = "outbound",
        in_reply_to: str = "",
        quoted_from: str = "",
        quoted_body: str = "",
    ) -> str:
        """Send a plain text email from the agent email address.

        Args:
            to: Recipient email address or list of addresses. Maximum 5 recipients.
            subject: Email subject line.
            body: Plain text email body.
            thread_id: Optional Thinkwork thread id. Defaults to the current thread.
            mode: "outbound" for new emails, or "reply" for inbound email replies.
            in_reply_to: Message-ID being replied to. Auto-filled in reply mode when available.
            quoted_from: Original sender for quoted replies. Auto-filled in reply mode when available.
            quoted_body: Original body for quoted replies. Auto-filled in reply mode when available.
        """

        start = time.time()
        recipients = _normalize_recipients(to)
        if mode not in ("outbound", "reply"):
            return json.dumps({"ok": False, "error": "mode must be 'outbound' or 'reply'"})
        if not recipients:
            return json.dumps({"ok": False, "error": "At least one recipient is required"})
        if len(recipients) > 5:
            return json.dumps({"ok": False, "error": "Maximum 5 recipients per email"})
        if not api_url or not api_secret or not agent_id:
            return json.dumps(
                {
                    "ok": False,
                    "error": "Send Email is enabled but runtime API credentials are missing.",
                }
            )
        if mode == "outbound" and (in_reply_to or quoted_from or quoted_body):
            return json.dumps(
                {
                    "ok": False,
                    "error": "mode='outbound' forbids reply threading fields",
                }
            )

        if mode == "reply":
            in_reply_to = in_reply_to or inbound_message_id
            quoted_from = quoted_from or inbound_from
            quoted_body = quoted_body or inbound_body

        payload: dict[str, Any] = {
            "agentId": agent_id,
            "to": ", ".join(recipients),
            "subject": subject,
            "body": body,
        }
        resolved_thread_id = thread_id or default_thread_id
        if resolved_thread_id:
            payload["threadId"] = resolved_thread_id
        if in_reply_to:
            payload["inReplyTo"] = in_reply_to
        if quoted_from:
            payload["quotedFrom"] = quoted_from
        if quoted_body:
            payload["quotedBody"] = quoted_body

        try:
            result = _post_json(
                f"{api_url}/api/email/send",
                headers={
                    "Authorization": f"Bearer {api_secret}",
                    "x-tenant-id": tenant_id,
                    "x-agent-id": agent_id,
                    "User-Agent": "Thinkwork-AgentCore/1.0",
                },
                payload=payload,
            )
            _append_cost(
                cost_sink,
                recipient_count=len(recipients),
                duration_sec=time.time() - start,
            )
            return json.dumps({"ok": True, **result})
        except urllib.error.HTTPError as err:
            error_body = err.read().decode("utf-8")[:500]
            message = f"Email send failed: HTTP {err.code}: {error_body}"
        except (urllib.error.URLError, TimeoutError, ValueError) as err:
            message = f"Email send failed: {err}"

        logger.warning("send_email failed recipient_count=%d: %s", len(recipients), message)
        _append_cost(
            cost_sink,
            recipient_count=len(recipients),
            duration_sec=time.time() - start,
            error=message,
        )
        return json.dumps({"ok": False, "error": message})

    return send_email
