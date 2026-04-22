"""Agent mutation wrappers for the thinkwork-admin skill.

Unit 8 of the thinkwork-admin plan. Each wrapper runs the same
pre/post pipeline via `_begin_mutation` / `_end_mutation`:

  1. `_env()` — refuse on R15 no-invoker.
  2. `_check_admin_role()` — wrapper-side role gate.
  3. `turn_cap.check_and_increment()` — per-turn cap (Unit 9).
  4. `_graphql(...)` — server-side authz runs through Unit 3's
     `requireAdminOrApiKeyCaller` + `requireAgentAllowsOperation`.
  5. `audit.emit(...)` — structured log, Unit 12 redaction.

Server-side idempotency wire-through lands in a follow-on; the
`idempotency_key` kwarg flows into the GraphQL field where the
resolver currently ignores it, but the Python wrappers are already
shaped to pass it.
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

_AGENT_FIELDS = (
    "id name slug role type adapterType status "
    "budgetMonthlyCents humanPairId templateId parentAgentId createdAt"
)
_SKILL_FIELDS = "agentId skillId config permissions rateLimitRpm modelOverride enabled"
_CAP_FIELDS = "agentId capability config enabled"


def _with_key(d: dict, idempotency_key: str) -> dict:
    """Add idempotencyKey to a dict when truthy. Pattern used everywhere."""
    if idempotency_key:
        d["idempotencyKey"] = idempotency_key
    return d


@_safe
def create_agent(
    tenant_id: str,
    template_id: str,
    name: str,
    role: str = "",
    type: str = "",  # noqa: A002
    system_prompt: str = "",
    reports_to: str = "",
    human_pair_id: str = "",
    parent_agent_id: str = "",
    adapter_type: str = "",
    avatar_url: str = "",
    budget_monthly_cents: int = 0,
    idempotency_key: str = "",
) -> str:
    """Create a new agent in a tenant, optionally linked to a template."""
    ctx = _begin_mutation("create_agent")
    input_dict: dict[str, object] = {
        "tenantId": tenant_id,
        "templateId": template_id,
        "name": name,
    }
    if role:
        input_dict["role"] = role
    if type:
        input_dict["type"] = type
    if system_prompt:
        input_dict["systemPrompt"] = system_prompt
    if reports_to:
        input_dict["reportsTo"] = reports_to
    if human_pair_id:
        input_dict["humanPairId"] = human_pair_id
    if parent_agent_id:
        input_dict["parentAgentId"] = parent_agent_id
    if adapter_type:
        input_dict["adapterType"] = adapter_type
    if avatar_url:
        input_dict["avatarUrl"] = avatar_url
    if budget_monthly_cents > 0:
        input_dict["budgetMonthlyCents"] = budget_monthly_cents
    _with_key(input_dict, idempotency_key)

    try:
        result = _graphql(
            f"mutation($input: CreateAgentInput!) {{ createAgent(input: $input) {{ {_AGENT_FIELDS} }} }}",
            {"input": input_dict},
        )
        _end_mutation(ctx, status="success", arguments={"input": input_dict})
        return json.dumps(result.get("createAgent"))
    except Exception as exc:
        _end_mutation(
            ctx, status="failed", arguments={"input": input_dict},
            refusal_reason=type(exc).__name__,
        )
        raise


@_safe
def set_agent_skills(agent_id: str, skills: list[dict], idempotency_key: str = "") -> str:
    """Replace the full agent_skills set for an agent.

    `skills` items shape: {skillId, config?, permissions?, rateLimitRpm?,
    modelOverride?, enabled?}. Passing an empty list is a no-op (the
    resolver refuses empty lists to guard against stale-UI wipes).
    """
    ctx = _begin_mutation("set_agent_skills")
    args: dict[str, object] = {"agentId": agent_id, "skills": skills}
    if idempotency_key:
        args["idempotencyKey"] = idempotency_key
    try:
        result = _graphql(
            f"""mutation(
                $agentId: ID!, $skills: [AgentSkillInput!]!, $idempotencyKey: String
            ) {{
                setAgentSkills(
                    agentId: $agentId, skills: $skills, idempotencyKey: $idempotencyKey
                ) {{ {_SKILL_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("setAgentSkills"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def set_agent_capabilities(
    agent_id: str,
    capabilities: list[dict],
    idempotency_key: str = "",
) -> str:
    """Replace the agent_capabilities set for an agent.

    `capabilities` items shape: {capability, config?, enabled?}.
    """
    ctx = _begin_mutation("set_agent_capabilities")
    args: dict[str, object] = {"agentId": agent_id, "capabilities": capabilities}
    if idempotency_key:
        args["idempotencyKey"] = idempotency_key
    try:
        result = _graphql(
            f"""mutation(
                $agentId: ID!, $capabilities: [AgentCapabilityInput!]!, $idempotencyKey: String
            ) {{
                setAgentCapabilities(
                    agentId: $agentId, capabilities: $capabilities, idempotencyKey: $idempotencyKey
                ) {{ {_CAP_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("setAgentCapabilities"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


__all__ = [
    "create_agent",
    "set_agent_skills",
    "set_agent_capabilities",
]
