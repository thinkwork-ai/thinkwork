"""Send email from agent email address via the thinkwork email-send Lambda."""

import json
import os
import urllib.request
import urllib.error

API_URL = os.environ.get("MANIFLOW_API_URL", "")
API_SECRET = os.environ.get("MANIFLOW_API_SECRET", "")
AGENT_ID = os.environ.get("AGENT_ID", "")
AGENT_EMAIL = os.environ.get("AGENT_EMAIL_ADDRESS", "")
TENANT_ID = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
THREAD_ID = os.environ.get("CURRENT_THREAD_ID", "")


def send_email(
    to: list[str],
    subject: str,
    body: str,
    thread_id: str = "",
    in_reply_to: str = "",
    quoted_from: str = "",
    quoted_body: str = "",
) -> str:
    """Send an email from the agent's email address with threading support.

    Args:
        to: Recipient email addresses (max 5). Format: "email@example.com" or "Name <email@example.com>".
        subject: Email subject line.
        body: Email body in plain text.
        thread_id: UUID of related thread (auto-injected from context if not provided).
        in_reply_to: Message-ID of email being replied to.
        quoted_from: Display name or email of original sender.
        quoted_body: Body of original email to include as quoted text.

    Returns:
        JSON with messageId and status.
    """
    if not to:
        return json.dumps({"error": "At least one recipient is required"})
    if len(to) > 5:
        return json.dumps({"error": "Maximum 5 recipients per email"})
    if not API_URL or not API_SECRET:
        return json.dumps({"error": "MANIFLOW_API_URL and MANIFLOW_API_SECRET are required"})

    payload = {
        "agentId": AGENT_ID,
        "from": AGENT_EMAIL or f"{AGENT_ID}@agents.thinkwork.ai",
        "to": ", ".join(to),
        "subject": subject,
        "body": body,
    }
    tid = thread_id or THREAD_ID
    if tid:
        payload["threadId"] = tid
    if in_reply_to:
        payload["inReplyTo"] = in_reply_to
    if quoted_from:
        payload["quotedFrom"] = quoted_from
    if quoted_body:
        payload["quotedBody"] = quoted_body

    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{API_URL}/api/email/send",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_SECRET}",
            "x-tenant-id": TENANT_ID,
            "x-agent-id": AGENT_ID,
        },
    )

    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")[:500]
        return json.dumps({"error": f"Email send failed: HTTP {e.code}: {error_body}"})
