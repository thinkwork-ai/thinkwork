"""Team mutations for the thinkwork-admin skill.

Unit 8. `remove_team_agent` and `remove_team_user` are OPT-IN —
server-side `requireAgentAllowsOperation` refuses unless an admin
explicitly added the op name to the agent's
`permissions.operations` jsonb.
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

_TEAM_FIELDS = "id name slug description type status budgetMonthlyCents createdAt"
_TEAM_AGENT_FIELDS = "id teamId agentId tenantId role joinedAt"
_TEAM_USER_FIELDS = "id teamId userId tenantId role joinedAt"


@_safe
def create_team(
    tenant_id: str,
    name: str,
    description: str = "",
    type: str = "",  # noqa: A002
    budget_monthly_cents: int = 0,
    idempotency_key: str = "",
) -> str:
    """Create a team in a tenant."""
    ctx = _begin_mutation("create_team")
    input_dict: dict[str, object] = {"tenantId": tenant_id, "name": name}
    if description:
        input_dict["description"] = description
    if type:
        input_dict["type"] = type
    if budget_monthly_cents > 0:
        input_dict["budgetMonthlyCents"] = budget_monthly_cents
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"input": input_dict}
    try:
        result = _graphql(
            f"""mutation($input: CreateTeamInput!) {{
                createTeam(input: $input) {{ {_TEAM_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("createTeam"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def add_team_agent(
    team_id: str,
    agent_id: str,
    role: str = "member",
    idempotency_key: str = "",
) -> str:
    """Add an agent to a team."""
    ctx = _begin_mutation("add_team_agent")
    input_dict: dict[str, object] = {"agentId": agent_id, "role": role}
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"teamId": team_id, "input": input_dict}
    try:
        result = _graphql(
            f"""mutation($teamId: ID!, $input: AddTeamAgentInput!) {{
                addTeamAgent(teamId: $teamId, input: $input) {{ {_TEAM_AGENT_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("addTeamAgent"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def add_team_user(
    team_id: str,
    user_id: str,
    role: str = "member",
    idempotency_key: str = "",
) -> str:
    """Add a user to a team."""
    ctx = _begin_mutation("add_team_user")
    input_dict: dict[str, object] = {"userId": user_id, "role": role}
    if idempotency_key:
        input_dict["idempotencyKey"] = idempotency_key
    args = {"teamId": team_id, "input": input_dict}
    try:
        result = _graphql(
            f"""mutation($teamId: ID!, $input: AddTeamUserInput!) {{
                addTeamUser(teamId: $teamId, input: $input) {{ {_TEAM_USER_FIELDS} }}
            }}""",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps(result.get("addTeamUser"))
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def remove_team_agent(team_id: str, agent_id: str) -> str:
    """Remove an agent from a team. OPT-IN — not default-allowed."""
    ctx = _begin_mutation("remove_team_agent")
    args = {"teamId": team_id, "agentId": agent_id}
    try:
        result = _graphql(
            "mutation($teamId: ID!, $agentId: ID!) { "
            "removeTeamAgent(teamId: $teamId, agentId: $agentId) "
            "}",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps({"removed": bool(result.get("removeTeamAgent"))})
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


@_safe
def remove_team_user(team_id: str, user_id: str) -> str:
    """Remove a user from a team. OPT-IN — not default-allowed."""
    ctx = _begin_mutation("remove_team_user")
    args = {"teamId": team_id, "userId": user_id}
    try:
        result = _graphql(
            "mutation($teamId: ID!, $userId: ID!) { "
            "removeTeamUser(teamId: $teamId, userId: $userId) "
            "}",
            args,
        )
        _end_mutation(ctx, status="success", arguments=args)
        return json.dumps({"removed": bool(result.get("removeTeamUser"))})
    except Exception as exc:
        _end_mutation(ctx, status="failed", arguments=args, refusal_reason=type(exc).__name__)
        raise


__all__ = [
    "create_team",
    "add_team_agent",
    "add_team_user",
    "remove_team_agent",
    "remove_team_user",
]
