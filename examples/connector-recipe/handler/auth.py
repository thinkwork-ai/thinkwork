"""Webhook signature verification using HMAC-SHA256."""

import hashlib
import hmac
import os
import time

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SIGNING_SECRET", "")
MAX_TIMESTAMP_AGE = 300  # 5 minutes


def verify_signature(body: str, signature: str, timestamp: str) -> bool:
    """Verify an incoming webhook signature.

    Uses HMAC-SHA256 with timestamp to prevent replay attacks.

    Args:
        body: Raw request body string
        signature: The x-signature header value
        timestamp: The x-timestamp header value (unix seconds)

    Returns:
        True if the signature is valid and timestamp is recent.
    """
    if not WEBHOOK_SECRET or not signature or not timestamp:
        return False

    # Check timestamp freshness (anti-replay)
    try:
        ts = int(timestamp)
        if abs(time.time() - ts) > MAX_TIMESTAMP_AGE:
            return False
    except ValueError:
        return False

    # Compute expected signature
    signing_input = f"{timestamp}.{body}"
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        signing_input.encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(signature, expected)
