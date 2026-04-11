"""Thinkwork API helpers for thread management."""

import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def create_or_resume_thread(
    api_url: str,
    api_key: str,
    agent_id: str,
    connector_id: str,
    external_thread_id: str,
    sender_id: str,
    message: str,
) -> dict:
    """Create a new Thinkwork thread or resume an existing one.

    Looks up existing threads by external_thread_id to maintain
    conversation continuity across the connector boundary.

    Args:
        api_url: Thinkwork API base URL
        api_key: API authentication key
        agent_id: Agent to handle the message
        connector_id: This connector's identifier
        external_thread_id: Thread ID in the external service
        sender_id: User ID in the external service
        message: The message text

    Returns:
        Dict with thread_id and message_id.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Send message via the connector endpoint
    payload = {
        "agent_id": agent_id,
        "connector_id": connector_id,
        "external_thread_id": external_thread_id,
        "sender_id": sender_id,
        "message": message,
        "channel": "CONNECTOR",
    }

    req = Request(
        f"{api_url}/api/messages/inbound",
        data=json.dumps(payload).encode(),
        headers=headers,
        method="POST",
    )

    try:
        with urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except HTTPError as e:
        return {"error": e.code, "message": e.read().decode()}
