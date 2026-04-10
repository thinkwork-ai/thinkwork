"""
PermissionRequest dataclass for the Authorization_Agent workflow.

When an Agent Container encounters a PermissionDeniedError it constructs a
PermissionRequest and forwards it to the Authorization_Agent session so that a
Human_Approver can review and approve or reject the request.

Requirements: 9.1, 9.2
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional


@dataclass
class PermissionRequest:
    """Represents a runtime permission request sent to the Authorization_Agent."""

    request_id: str  # UUID, uniquely identifies this request
    tenant_id: str  # The tenant that needs the permission
    resource_type: Literal["tool", "data_path", "api_endpoint"]
    resource: str  # Tool name, data path, or API endpoint being requested
    reason: str  # Why the agent needs this permission
    duration_type: Literal["temporary", "persistent"]
    suggested_duration_hours: Optional[int]  # Only relevant for temporary grants
    requested_at: datetime
    expires_at: datetime  # 30 minutes after requested_at; auto-reject after this
    status: Literal["pending", "approved", "rejected", "partial", "timeout"]
