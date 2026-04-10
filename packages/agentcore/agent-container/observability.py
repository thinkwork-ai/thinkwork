"""
Structured logging utilities for CloudWatch observability.

All log entries are emitted via Python's standard logging module in the format:
    STRUCTURED_LOG {json_string}

This prefix allows tests and log processors to reliably parse structured entries.

Requirements: 8.1, 8.2, 8.3, 8.4
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import List, Optional

# Allow importing PermissionRequest from auth-agent when running inside agent-container
_auth_agent_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auth-agent")
if _auth_agent_path not in sys.path:
    sys.path.insert(0, _auth_agent_path)

try:
    from permission_request import PermissionRequest  # noqa: E402
except ImportError:
    PermissionRequest = None  # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)


def log_agent_invocation(
    tenant_id: str,
    tools_used: List[str],
    duration_ms: int,
    status: str,
) -> None:
    """
    Log a structured entry for each AgentCore Runtime invocation.

    The log stream is identified by the ``log_stream`` field set to
    ``tenant_{tenant_id}`` (requirement 8.4).

    Fields emitted (requirement 8.1):
    - tenant_id
    - session_id  (= tenant_id)
    - tools_used  (list)
    - duration_ms
    - status
    - timestamp
    - event_type  = "agent_invocation"
    - log_stream  = "tenant_{tenant_id}"

    Requirements: 8.1, 8.4
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "log_stream": f"tenant_{tenant_id}",
        "tenant_id": tenant_id,
        "session_id": tenant_id,
        "event_type": "agent_invocation",
        "tools_used": tools_used,
        "duration_ms": duration_ms,
        "status": status,
    }
    logger.info("STRUCTURED_LOG %s", json.dumps(entry))


def log_permission_denied(
    tenant_id: str,
    tool_name: str,
    cedar_decision: str,
    request_id: Optional[str] = None,
) -> None:
    """
    Log an audit entry when a tool call is denied by the permission system.

    The log stream is identified by the ``log_stream`` field set to
    ``tenant_{tenant_id}`` (requirement 8.4).

    Fields emitted (requirement 8.2):
    - tenant_id
    - tool_name
    - cedar_decision
    - request_id   (optional permission-request UUID)
    - timestamp
    - event_type   = "permission_denied"
    - log_stream   = "tenant_{tenant_id}"

    Requirements: 8.2, 8.4
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "log_stream": f"tenant_{tenant_id}",
        "tenant_id": tenant_id,
        "event_type": "permission_denied",
        "tool_name": tool_name,
        "cedar_decision": cedar_decision,
        "request_id": request_id,
    }
    logger.warning("STRUCTURED_LOG %s", json.dumps(entry))


def log_approval_decision(
    request: "PermissionRequest",
    decision: str,
    approver_note: Optional[str] = None,
) -> None:
    """
    Log an audit entry for every approval decision made by the Authorization_Agent.

    The log stream is ``auth-agent`` (not tenant-prefixed) because this event
    originates from the Authorization_Agent session, not a tenant session.

    Fields emitted (requirement 8.3):
    - request_id
    - tenant_id
    - resource
    - decision
    - approver_note
    - timestamp
    - event_type  = "approval_decision"
    - log_stream  = "auth-agent"

    Requirements: 8.3
    """
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "log_stream": "auth-agent",
        "event_type": "approval_decision",
        "request_id": request.request_id,
        "tenant_id": request.tenant_id,
        "resource": request.resource,
        "decision": decision,
        "approver_note": approver_note,
    }
    logger.info("STRUCTURED_LOG %s", json.dumps(entry))
