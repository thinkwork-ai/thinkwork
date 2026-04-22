"""Tenant-scope mutations for the thinkwork-admin skill.

Unit 8. Does NOT expose `create_tenant` — that's a different privilege
class (global, not tenant-scoped) and stays humans-only per plan.
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.normpath(os.path.join(HERE, ".."))
if PARENT not in sys.path:
    sys.path.insert(0, PARENT)

from thinkwork_admin import _begin_mutation, _end_mutation, _graphql, _safe  # noqa: E402

_TENANT_FIELDS = "id name slug plan issuePrefix issueCounter createdAt"
_MEMBER_FIELDS = (
    "id tenantId principalType principalId role status createdAt"
)


@_safe
def update_tenant(
    tenant_id: str,
    name: str = "",
    plan: str = "",
    issue_prefix: str = "",
    idempotency_key: str = "",
) -> str:
    """Update a tenant's name / plan / issue prefix."""
    ctx = _begin_mutation("update_tenant")
    input_dict: dict[str, object] = {}
    if name:
        input_dict["name"] = name
    if plan:
        input_dict["plan"] = plan
    if issue_prefix:
        input_dict["issuePrefix"] = issue_prefix
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"id": tenant_id, "input": input_dict}
    try:
        result = _graphql(
            f"""mutation($id: ID!, $input: UpdateTenantInput!) {{
                updateTenant(id: $id, input: $input) {{ {_TENANT_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("updateTenant"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def add_tenant_member(
    tenant_id: str,
    principal_id: str,
    principal_type: str = "USER",
    role: str = "member",
    idempotency_key: str = "",
) -> str:
    """Add an existing user (or agent) to a tenant's members table."""
    ctx = _begin_mutation("add_tenant_member")
    input_dict: dict[str, object] = {
        "principalType": principal_type,
        "principalId": principal_id,
        "role": role,
    }
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"tenantId": tenant_id, "input": input_dict}
    try:
        result = _graphql(
            f"""mutation($tenantId: ID!, $input: AddTenantMemberInput!) {{
                addTenantMember(tenantId: $tenantId, input: $input) {{ {_MEMBER_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("addTenantMember"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def update_tenant_member(
    member_id: str,
    role: str = "",
    status: str = "",
    idempotency_key: str = "",
) -> str:
    """Change a tenant member's role or status. Last-owner guard enforced
    server-side."""
    ctx = _begin_mutation("update_tenant_member")
    input_dict: dict[str, object] = {}
    if role:
        input_dict["role"] = role
    if status:
        input_dict["status"] = status
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"id": member_id, "input": input_dict}
    try:
        result = _graphql(
            f"""mutation($id: ID!, $input: UpdateTenantMemberInput!) {{
                updateTenantMember(id: $id, input: $input) {{ {_MEMBER_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("updateTenantMember"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def remove_tenant_member(member_id: str, idempotency_key: str = "") -> str:
    """Hard-delete a tenant member. OPT-IN — not in default allowlist.

    An admin must explicitly add `remove_tenant_member` to an agent's
    `permissions.operations` jsonb for this call to succeed at the
    resolver. Last-owner guard enforced server-side.
    """
    ctx = _begin_mutation("remove_tenant_member")
    args: dict[str, object] = {"id": member_id}
    if idempotency_key:
        args["idempotencyKey"] = idempotency_key
    try:
        result = _graphql(
            "mutation($id: ID!, $idempotencyKey: String) { "
            "removeTenantMember(id: $id, idempotencyKey: $idempotencyKey) "
            "}",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps({"removed": bool(result.get("removeTenantMember"))})
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def invite_member(
    tenant_id: str,
    email: str,
    name: str = "",
    role: str = "member",
    idempotency_key: str = "",
) -> str:
    """Create a Cognito user + tenant-member row in one call. Sends an
    invite email via Cognito's AdminCreateUser."""
    ctx = _begin_mutation("invite_member")
    input_dict: dict[str, object] = {"email": email, "role": role}
    if name:
        input_dict["name"] = name
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"tenantId": tenant_id, "input": input_dict}
    try:
        result = _graphql(
            f"""mutation($tenantId: ID!, $input: InviteMemberInput!) {{
                inviteMember(tenantId: $tenantId, input: $input) {{ {_MEMBER_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("inviteMember"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


__all__ = [
    "update_tenant",
    "add_tenant_member",
    "update_tenant_member",
    "remove_tenant_member",
    "invite_member",
]
