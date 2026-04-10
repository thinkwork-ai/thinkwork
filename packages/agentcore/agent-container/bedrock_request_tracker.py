"""
Captures Bedrock request IDs from boto3 API responses.

Used by agent containers to correlate cost events with Bedrock model
invocation logs. The invocation log's `requestId` field matches the
`x-amzn-requestid` response header, which boto3 exposes as
`ResponseMetadata.RequestId`.

Thread-local storage ensures concurrent requests on the same VM
don't cross-contaminate request IDs.

Usage:
    import boto3
    from bedrock_request_tracker import install_on_session, get_captured_request_ids, reset_captured_request_ids

    # Once at startup
    install_on_session(boto3.Session())

    # Before each agent invocation
    reset_captured_request_ids()
    result = agent(prompt)
    request_ids = get_captured_request_ids()
"""

import logging
import threading

logger = logging.getLogger(__name__)

_request_ids = threading.local()


def get_captured_request_ids() -> list:
    """Return all Bedrock request IDs captured since last reset."""
    return getattr(_request_ids, "ids", [])


def reset_captured_request_ids():
    """Clear captured request IDs for a new invocation."""
    _request_ids.ids = []


def _capture_response(parsed, **kwargs):
    """boto3 event handler — fires after every bedrock-runtime API call."""
    request_id = parsed.get("ResponseMetadata", {}).get("RequestId", "")
    if request_id:
        if not hasattr(_request_ids, "ids"):
            _request_ids.ids = []
        _request_ids.ids.append(request_id)
        logger.debug("Captured Bedrock requestId: %s", request_id)


def install_on_session(session):
    """Register the capture handler on a boto3 Session's event system."""
    session.events.register("after-call.bedrock-runtime.*", _capture_response)
    logger.info("Bedrock request ID tracker installed on boto3 session")
