"""Agent-template mutations for the thinkwork-admin skill.

Unit 8. `sync_template_to_all_agents` is OPT-IN (tenant-wide blast
radius). `create_agent_from_template` is default-enabled because it's
central to the stamp-out-an-enterprise recipe.
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

_TEMPLATE_FIELDS = (
    "id name slug description category icon model isPublished createdAt"
)
_AGENT_FIELDS = (
    "id name slug role type adapterType status "
    "budgetMonthlyCents humanPairId templateId createdAt"
)
_SYNC_SUMMARY_FIELDS = "agentsSynced agentsFailed errors"


@_safe
def create_agent_template(
    tenant_id: str,
    name: str,
    slug: str,
    description: str = "",
    category: str = "",
    model: str = "",
    is_published: bool = True,
    idempotency_key: str = "",
) -> str:
    """Create an agent template in a tenant."""
    ctx = _begin_mutation("create_agent_template")
    input_dict: dict[str, object] = {
        "tenantId": tenant_id,
        "name": name,
        "slug": slug,
        "isPublished": is_published,
    }
    if description:
        input_dict["description"] = description
    if category:
        input_dict["category"] = category
    if model:
        input_dict["model"] = model
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"input": input_dict}
    try:
        result = _graphql(
            f"""mutation($input: CreateAgentTemplateInput!) {{
                createAgentTemplate(input: $input) {{ {_TEMPLATE_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("createAgentTemplate"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def create_agent_from_template(
    template_id: str,
    name: str,
    slug: str,
    team_id: str = "",
    idempotency_key: str = "",
) -> str:
    """Instantiate an agent from a template. Core of the onboarding recipe."""
    ctx = _begin_mutation("create_agent_from_template")
    input_dict: dict[str, object] = {
        "templateId": template_id,
        "name": name,
        "slug": slug,
    }
    if team_id:
        input_dict["teamId"] = team_id
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"input": input_dict}
    try:
        result = _graphql(
            f"""mutation($input: CreateAgentFromTemplateInput!) {{
                createAgentFromTemplate(input: $input) {{ {_AGENT_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("createAgentFromTemplate"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def sync_template_to_agent(
    template_id: str,
    agent_id: str,
    idempotency_key: str = "",
) -> str:
    """Sync one linked agent's skills/KBs/workspace to match its template.

    Snapshots current state first — rollbackable via the version history.
    """
    ctx = _begin_mutation("sync_template_to_agent")
    args: dict[str, object] = {"templateId": template_id, "agentId": agent_id}
    if idempotency_key:
        args["idempotencyKey"] = idempotency_key
    try:
        result = _graphql(
            f"""mutation(
                $templateId: ID!, $agentId: ID!, $idempotencyKey: String
            ) {{
                syncTemplateToAgent(
                    templateId: $templateId, agentId: $agentId,
                    idempotencyKey: $idempotencyKey
                ) {{ {_AGENT_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("syncTemplateToAgent"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def sync_template_to_all_agents(
    template_id: str,
    idempotency_key: str = "",
) -> str:
    """Sync every linked agent to the template. OPT-IN — tenant-wide blast.

    Returns a summary: {agentsSynced, agentsFailed, errors[]}.
    """
    ctx = _begin_mutation("sync_template_to_all_agents")
    args: dict[str, object] = {"templateId": template_id}
    if idempotency_key:
        args["idempotencyKey"] = idempotency_key
    try:
        result = _graphql(
            f"""mutation($templateId: ID!, $idempotencyKey: String) {{
                syncTemplateToAllAgents(
                    templateId: $templateId, idempotencyKey: $idempotencyKey
                ) {{ {_SYNC_SUMMARY_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("syncTemplateToAllAgents"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def accept_template_update(
    agent_id: str,
    filename: str,
    idempotency_key: str = "",
) -> str:
    """Advance an agent's pinned hash for a guardrail-class file."""
    ctx = _begin_mutation("accept_template_update")
    args: dict[str, object] = {"agentId": agent_id, "filename": filename}
    if idempotency_key:
        args["idempotencyKey"] = idempotency_key
    try:
        result = _graphql(
            f"""mutation(
                $agentId: ID!, $filename: String!, $idempotencyKey: String
            ) {{
                acceptTemplateUpdate(
                    agentId: $agentId, filename: $filename,
                    idempotencyKey: $idempotencyKey
                ) {{ {_AGENT_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("acceptTemplateUpdate"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


__all__ = [
    "create_agent_template",
    "create_agent_from_template",
    "sync_template_to_agent",
    "sync_template_to_all_agents",
    "accept_template_update",
]
