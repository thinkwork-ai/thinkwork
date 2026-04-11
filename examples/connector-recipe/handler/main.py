"""
Thinkwork Connector Recipe — Webhook Handler

This is a template for building a custom connector that receives webhooks
from an external service and routes them to Thinkwork threads.

Deploy as an AWS Lambda behind API Gateway. See terraform/ for infra.
"""

import json
import os
import logging
from auth import verify_signature
from thread import create_or_resume_thread

logger = logging.getLogger()
logger.setLevel(logging.INFO)

THINKWORK_API_URL = os.environ.get("THINKWORK_API_URL", "")
THINKWORK_API_KEY = os.environ.get("THINKWORK_API_KEY", "")
CONNECTOR_ID = os.environ.get("CONNECTOR_ID", "my-connector")
DEFAULT_AGENT_ID = os.environ.get("DEFAULT_AGENT_ID", "")


def handler(event, context):
    """Lambda handler for incoming webhooks."""
    headers = event.get("headers", {})
    body = event.get("body", "")

    # Step 1: Verify webhook signature
    signature = headers.get("x-signature", "")
    timestamp = headers.get("x-timestamp", "")
    if not verify_signature(body, signature, timestamp):
        return {"statusCode": 401, "body": json.dumps({"error": "Invalid signature"})}

    # Step 2: Parse the incoming event
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {"statusCode": 400, "body": json.dumps({"error": "Invalid JSON"})}

    event_type = payload.get("type", "message")
    message = payload.get("message", payload.get("text", ""))
    sender_id = payload.get("sender_id", payload.get("user_id", "unknown"))
    external_thread_id = payload.get("thread_id", payload.get("channel_id", ""))

    if not message:
        return {"statusCode": 200, "body": json.dumps({"ok": True, "skipped": "no message"})}

    logger.info(f"Received {event_type} from {sender_id}: {message[:100]}")

    # Step 3: Route to Thinkwork
    result = create_or_resume_thread(
        api_url=THINKWORK_API_URL,
        api_key=THINKWORK_API_KEY,
        agent_id=DEFAULT_AGENT_ID,
        connector_id=CONNECTOR_ID,
        external_thread_id=external_thread_id,
        sender_id=sender_id,
        message=message,
    )

    return {
        "statusCode": 200,
        "body": json.dumps({"ok": True, "thread_id": result.get("thread_id")}),
    }
