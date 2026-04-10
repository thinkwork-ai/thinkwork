"""
AgentCore Identity — token issuance and validation.

Implements a lightweight in-memory approval-token store that mirrors the
@requires_access_token pattern described in the design document.

Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# Tools that require an approval token before execution (requirement 5.6)
REQUIRES_TOKEN_TOOLS = ["shell", "file_write", "code_execution"]

# Maximum token lifetime in hours (requirement 5.5)
MAX_TOKEN_TTL_HOURS = 24

# In-memory token store keyed by (tenant_id, resource)
_token_store: Dict[Tuple[str, str], "ApprovalToken"] = {}


@dataclass
class ApprovalToken:
    """Represents a time-limited approval token for a protected tool/resource."""

    token_id: str
    tenant_id: str
    resource: str
    issued_at: datetime
    expires_at: datetime


def issue_approval_token(
    tenant_id: str,
    resource: str,
    ttl_hours: int,
) -> ApprovalToken:
    """
    Issue an approval token for *tenant_id* to access *resource*.

    The effective TTL is ``min(ttl_hours, MAX_TOKEN_TTL_HOURS)`` hours so that
    no token can ever be valid for more than 24 hours (requirement 5.5).

    Any previously stored token for the same (tenant_id, resource) pair is
    replaced — there is no auto-renewal; the caller must explicitly request a
    new token (requirement 5.7).

    Requirements: 5.4, 5.5
    """
    effective_ttl = min(ttl_hours, MAX_TOKEN_TTL_HOURS)
    now = datetime.now(timezone.utc)
    token = ApprovalToken(
        token_id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        resource=resource,
        issued_at=now,
        expires_at=now + timedelta(hours=effective_ttl),
    )
    _token_store[(tenant_id, resource)] = token
    logger.info(
        "Approval token issued tenant_id=%s resource=%s ttl_hours=%d expires_at=%s",
        tenant_id,
        resource,
        effective_ttl,
        token.expires_at.isoformat(),
    )
    return token


def validate_token(tenant_id: str, resource: str) -> bool:
    """
    Return True if a valid (non-expired) approval token exists for
    *tenant_id* / *resource*, False otherwise.

    When the token is missing or expired the function logs a message
    indicating that authorization is required and returns False — the
    caller is responsible for triggering the authorization-request flow
    (requirement 5.3).  Expired tokens are NOT auto-renewed (requirement 5.7).

    Requirements: 5.2, 5.3, 5.7
    """
    token: Optional[ApprovalToken] = _token_store.get((tenant_id, resource))

    if token is None:
        logger.info(
            "No approval token found — authorization required "
            "tenant_id=%s resource=%s",
            tenant_id,
            resource,
        )
        return False

    now = datetime.now(timezone.utc)
    if now >= token.expires_at:
        logger.info(
            "Approval token expired — re-authorization required "
            "tenant_id=%s resource=%s expired_at=%s",
            tenant_id,
            resource,
            token.expires_at.isoformat(),
        )
        # Remove the stale token; no auto-renewal (requirement 5.7)
        del _token_store[(tenant_id, resource)]
        return False

    return True


def revoke_token(tenant_id: str, resource: str) -> None:
    """Remove the token for (tenant_id, resource) if it exists."""
    _token_store.pop((tenant_id, resource), None)
    logger.info("Approval token revoked tenant_id=%s resource=%s", tenant_id, resource)


def clear_all_tokens() -> None:
    """Clear the entire in-memory token store (useful for testing)."""
    _token_store.clear()
