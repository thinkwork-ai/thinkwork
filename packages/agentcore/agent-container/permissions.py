"""
Permission profile management.

Reads/writes per-tenant permission profiles from SSM Parameter Store.
Profiles are injected into the agent's system prompt (Plan A enforcement).
"""
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

STACK_NAME = os.environ.get("STACK_NAME", "dev")

PROFILES = {
    "basic": {
        "profile": "basic",
        "tools": [
            "web_search", "web_read", "company_research",
            "create_artifact", "update_artifact", "list_artifacts",
            "create_sub_ticket", "add_dependency", "update_ticket_status",
            "add_comment", "list_sub_tickets", "get_ticket_details",
            "send_email",
            "gmail_list_messages", "gmail_get_message", "gmail_search_messages",
            "gmail_modify_labels", "gmail_create_draft",
            "gcal_list_events", "gcal_get_event", "gcal_check_availability",
            "gcal_create_event", "gcal_update_event", "gcal_delete_event",
            "browser_use", "browser", "browse_website", "restaurant_search", "restaurant_lookup",
            "knowledge_base_search",
        ],
        "data_permissions": {"file_paths": [], "api_endpoints": []},
    },
    "advanced": {
        "profile": "advanced",
        "tools": [
            "web_search", "web_read", "company_research",
            "create_artifact", "update_artifact", "list_artifacts",
            "create_sub_ticket", "add_dependency", "update_ticket_status",
            "add_comment", "list_sub_tickets", "get_ticket_details",
            "send_email",
            "gmail_list_messages", "gmail_get_message", "gmail_search_messages",
            "gmail_modify_labels", "gmail_create_draft",
            "gcal_list_events", "gcal_get_event", "gcal_check_availability",
            "gcal_create_event", "gcal_update_event", "gcal_delete_event",
            "browser_use", "browse_website", "restaurant_search",
            "knowledge_base_search",
            "shell", "browser", "file", "file_write", "code_execution",
        ],
        "data_permissions": {"file_paths": [], "api_endpoints": []},
    },
}

DEFAULT_PROFILE = PROFILES["basic"]

# Always blocked regardless of profile — arbitrary code execution risk
ALWAYS_BLOCKED_TOOLS = {"install_skill", "load_extension", "eval"}


class PermissionDeniedError(Exception):
    def __init__(self, tenant_id: str, tool: str, resource: Optional[str] = None):
        self.tenant_id = tenant_id
        self.tool = tool
        self.resource = resource
        super().__init__(f"Permission denied: tenant={tenant_id} tool={tool}")


def _ssm_client():
    return boto3.client("ssm", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def _permissions_ssm_path(tenant_id: str) -> str:
    return f"/thinkwork/{STACK_NAME}/agentcore/tenants/{tenant_id}/permissions"


def read_permission_profile(tenant_id: str) -> dict:
    """Read tenant's Permission_Profile from SSM. Falls back to basic."""
    ssm = _ssm_client()
    path = _permissions_ssm_path(tenant_id)
    try:
        response = ssm.get_parameter(Name=path)
        return json.loads(response["Parameter"]["Value"])
    except ssm.exceptions.ParameterNotFound:
        return dict(DEFAULT_PROFILE)
    except ClientError as e:
        # --- UPSTREAM_FIX: graceful fallback when SSM is not accessible ---
        logger.warning("SSM read failed tenant_id=%s error=%s, using default", tenant_id, e)
        return dict(DEFAULT_PROFILE)
        # --- END UPSTREAM_FIX ---


def write_permission_profile(tenant_id: str, profile: dict) -> None:
    """Write tenant's Permission_Profile to SSM."""
    ssm = _ssm_client()
    ssm.put_parameter(
        Name=_permissions_ssm_path(tenant_id),
        Value=json.dumps(profile),
        Type="String",
        Overwrite=True,
    )


def _log_permission_denied(tenant_id: str, tool_name: str, resource: Optional[str]) -> None:
    logger.warning("AUDIT %s", json.dumps({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "log_stream": f"tenant_{tenant_id}",
        "tenant_id": tenant_id,
        "event_type": "permission_denied",
        "tool_name": tool_name,
        "resource": resource,
    }))


def check_tool_permission(
    tenant_id: str, tool_name: str, resource: Optional[str] = None
) -> bool:
    """Check tool permission against SSM profile. Raises PermissionDeniedError if denied."""
    if tool_name in ALWAYS_BLOCKED_TOOLS:
        _log_permission_denied(tenant_id, tool_name, resource)
        raise PermissionDeniedError(tenant_id=tenant_id, tool=tool_name, resource=resource)

    profile = read_permission_profile(tenant_id)
    if tool_name not in profile.get("tools", []):
        _log_permission_denied(tenant_id, tool_name, resource)
        raise PermissionDeniedError(tenant_id=tenant_id, tool=tool_name, resource=resource)
    return True


def check_data_permission(tenant_id: str, data_path: str) -> bool:
    """Check data path permission against SSM profile. Raises PermissionDeniedError if denied."""
    profile = read_permission_profile(tenant_id)
    allowed_paths = profile.get("data_permissions", {}).get("file_paths", [])

    def _normalise(p: str) -> str:
        return p.rstrip("*").rstrip("/") + "/"

    for allowed in allowed_paths:
        if data_path.startswith(_normalise(allowed)):
            return True

    _log_permission_denied(tenant_id, "data_access", data_path)
    raise PermissionDeniedError(tenant_id=tenant_id, tool="data_access", resource=data_path)


# ---------------------------------------------------------------------------
# Authorization Agent integration
# ---------------------------------------------------------------------------

AUTH_AGENT_RUNTIME_ID = os.environ.get("AUTH_AGENT_RUNTIME_ID", "")

_auth_agent_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auth-agent")
if _auth_agent_path not in sys.path:
    sys.path.insert(0, _auth_agent_path)

try:
    from permission_request import PermissionRequest  # noqa: E402
except ImportError:
    PermissionRequest = None  # type: ignore


def _agentcore_client():
    return boto3.client(
        "bedrock-agentcore-runtime",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )


def send_permission_request(
    tenant_id: str,
    tool_name: str,
    resource: Optional[str] = None,
    reason: str = "Permission required",
    duration_type: str = "temporary",
    suggested_duration_hours: Optional[int] = 1,
):
    """Send a PermissionRequest to the Authorization Agent."""
    now = datetime.now(timezone.utc)
    request = PermissionRequest(
        request_id=str(uuid4()),
        tenant_id=tenant_id,
        resource_type="tool",
        resource=resource or tool_name,
        reason=reason,
        duration_type=duration_type,
        suggested_duration_hours=suggested_duration_hours,
        requested_at=now,
        expires_at=now + timedelta(minutes=30),
        status="pending",
    )

    session_id = f"auth-agent-{STACK_NAME}"
    payload = {
        "request_id": request.request_id,
        "tenant_id": request.tenant_id,
        "resource_type": request.resource_type,
        "resource": request.resource,
        "reason": request.reason,
        "duration_type": request.duration_type,
        "suggested_duration_hours": request.suggested_duration_hours,
        "requested_at": request.requested_at.isoformat(),
        "expires_at": request.expires_at.isoformat(),
        "status": request.status,
    }

    try:
        _agentcore_client().invoke_agent_runtime(
            agentRuntimeId=AUTH_AGENT_RUNTIME_ID,
            sessionId=session_id,
            payload=json.dumps(payload),
        )
        logger.info(
            "PermissionRequest sent request_id=%s tenant_id=%s session_id=%s",
            request.request_id, tenant_id, session_id,
        )
    except Exception as e:
        logger.error("Failed to send PermissionRequest request_id=%s error=%s", request.request_id, e)

    return request
