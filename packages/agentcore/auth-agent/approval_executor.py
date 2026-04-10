"""
Authorization_Agent — approval result execution.

Implements execute_approval() which carries out the Human_Approver's decision:
  - approve_temporary : issue a time-limited ApprovalToken via identity.py
  - approve_persistent: add the resource to the tenant's SSM Cedar Policy
  - reject            : notify the Agent Container and record the reason

All decisions are logged as structured CloudWatch entries.

Requirements: 9.5, 9.6
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional

# Allow importing from agent-container when running inside auth-agent
_agent_container_path = os.path.join(os.path.dirname(__file__), "..", "agent-container")
if _agent_container_path not in sys.path:
    sys.path.insert(0, _agent_container_path)

try:
    from .permission_request import PermissionRequest
except ImportError:
    from permission_request import PermissionRequest  # type: ignore[no-redef]

from identity import issue_approval_token  # noqa: E402
from permissions import write_permission_profile, read_permission_profile  # noqa: E402

import boto3  # noqa: E402

logger = logging.getLogger(__name__)

STACK_NAME = os.environ.get("STACK_NAME", "dev")


# ---------------------------------------------------------------------------
# SSM client factory (mockable in tests)
# ---------------------------------------------------------------------------

def _ssm_client():
    return boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "us-east-1"))


# ---------------------------------------------------------------------------
# CloudWatch logging
# ---------------------------------------------------------------------------

def _log_approval_decision(
    request: PermissionRequest,
    decision: str,
    approver_note: Optional[str],
) -> None:
    """Emit a structured CloudWatch log entry for the approval decision."""
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "log_stream": "auth-agent",
        "event_type": "approval_decision",
        "request_id": request.request_id,
        "tenant_id": request.tenant_id,
        "resource": request.resource,
        "resource_type": request.resource_type,
        "decision": decision,
        "approver_note": approver_note,
    }
    logger.info("APPROVAL_DECISION %s", json.dumps(entry, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Agent Container notification (actual channel integration out of scope)
# ---------------------------------------------------------------------------

def _notify_agent_container(
    tenant_id: str,
    status: str,
    token=None,
    reason: Optional[str] = None,
) -> None:
    """Log the notification that would be sent to the Agent Container."""
    logger.info(
        "[auth-agent] AGENT_NOTIFY tenant_id=%s status=%s token_id=%s reason=%s",
        tenant_id,
        status,
        token.token_id if token else None,
        reason or "",
    )


# ---------------------------------------------------------------------------
# Persistent authorisation helper
# ---------------------------------------------------------------------------

def _update_cedar_policy(tenant_id: str, resource: str, resource_type: str) -> None:
    """
    Add *resource* to the tenant's allowed tools list in SSM.

    Reads the current Permission_Profile, appends the resource if not already
    present, then writes it back.  The SSM path is:
        /thinkwork/{stack}/agentcore/tenants/{tenant_id}/permissions
    """
    profile = read_permission_profile(tenant_id)

    if resource_type == "tool":
        tools: list = profile.get("tools", [])
        if resource not in tools:
            tools.append(resource)
            profile["tools"] = tools
    elif resource_type in ("data_path", "api_endpoint"):
        data_perms: dict = profile.setdefault("data_permissions", {})
        key = "file_paths" if resource_type == "data_path" else "api_endpoints"
        paths: list = data_perms.get(key, [])
        if resource not in paths:
            paths.append(resource)
            data_perms[key] = paths

    profile["updated_at"] = datetime.now(timezone.utc).isoformat()
    profile["updated_by"] = "auth-agent"
    write_permission_profile(tenant_id, profile)
    logger.info(
        "Cedar Policy updated tenant_id=%s resource=%s resource_type=%s",
        tenant_id,
        resource,
        resource_type,
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def execute_approval(
    request: PermissionRequest,
    decision: str,
    approver_note: Optional[str] = None,
) -> None:
    """
    Execute the Human_Approver's decision for a PermissionRequest.

    Parameters
    ----------
    request:       The original PermissionRequest.
    decision:      One of "approve_temporary", "approve_persistent", "reject".
    approver_note: Optional free-text note from the Human_Approver.

    Requirements: 9.5, 9.6
    """
    if decision == "approve_temporary":
        duration_hours = request.suggested_duration_hours or 1
        effective_ttl = min(duration_hours, 24)  # requirement 9.5 / 5.5
        token = issue_approval_token(
            tenant_id=request.tenant_id,
            resource=request.resource,
            ttl_hours=effective_ttl,
        )
        _notify_agent_container(request.tenant_id, "approved_temporary", token=token)

    elif decision == "approve_persistent":
        _update_cedar_policy(
            tenant_id=request.tenant_id,
            resource=request.resource,
            resource_type=request.resource_type,
        )
        _notify_agent_container(request.tenant_id, "approved_persistent")

    elif decision == "reject":
        _notify_agent_container(
            request.tenant_id, "rejected", reason=approver_note
        )
        logger.warning(
            "[auth-agent] REJECTED request_id=%s tenant_id=%s resource=%s reason=%s",
            request.request_id,
            request.tenant_id,
            request.resource,
            approver_note or "(no reason given)",
        )

    else:
        logger.error(
            "[auth-agent] Unknown decision=%s request_id=%s", decision, request.request_id
        )

    # All decisions are recorded (requirement 9.6)
    _log_approval_decision(request, decision, approver_note)
