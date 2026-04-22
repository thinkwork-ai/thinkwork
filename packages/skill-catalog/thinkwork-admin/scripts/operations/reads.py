"""Read-only tool functions for the thinkwork-admin skill.

Unit 7 of the thinkwork-admin plan (R5). Each function wraps an
existing GraphQL query, returns JSON, is gated by `_check_admin_role`,
and carries the `@_safe` decorator so errors surface as structured
refusal shapes instead of propagating.

The operation names (snake_case) in this module must match the entries
declared in `skill.yaml` and the `default_enabled` flags there — Unit 3's
`requireAgentAllowsOperation` resolver-side gate keys on those names, so
any mismatch would look like a permanent refusal at the server.

Deliberately scoped: this ships the "most useful" read set — platform,
agents, templates, teams, artifacts — rather than all ~20 reads from the
origin R5 list. Follow-ons can add threads / inbox / memory / scheduled
jobs once Unit 8 lands and we see which reads the Marco-generalist
scenario actually needs end-to-end.
"""

from __future__ import annotations

import json
import sys
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PARENT = os.path.normpath(os.path.join(HERE, ".."))
if PARENT not in sys.path:
    sys.path.insert(0, PARENT)

from thinkwork_admin import _check_admin_role, _graphql, _safe  # noqa: E402

# ---------------------------------------------------------------------------
# Field selection strings. Kept terse — skills don't need every column.
# ---------------------------------------------------------------------------

_AGENT_FIELDS = (
    "id name slug role type adapterType status "
    "budgetMonthlyCents humanPairId templateId parentAgentId createdAt"
)
_TEMPLATE_FIELDS = (
    "id name slug description category icon model isPublished createdAt"
)
_TENANT_FIELDS = "id name slug plan issuePrefix issueCounter createdAt"
_USER_FIELDS = "id tenantId email name image phone createdAt"
_TENANT_MEMBER_FIELDS = (
    "id tenantId principalType principalId role status createdAt"
)
_TEAM_FIELDS = "id name slug description type status budgetMonthlyCents createdAt"
_ARTIFACT_FIELDS = (
    "id tenantId threadId agentId type status title contentRef "
    "createdAt updatedAt"
)


def _gated(query: str, variables: dict | None = None) -> dict:
    """Every read runs the wrapper-side role gate first.

    The resolver-side gate (Unit 3) is still authoritative; this early-
    fail UX stops a member-role agent from making doomed GraphQL calls.
    """
    _check_admin_role()
    return _graphql(query, variables)


# ---------------------------------------------------------------------------
# Platform reads — tenant, members, self
# ---------------------------------------------------------------------------


@_safe
def me() -> str:
    """Return the caller's own User record."""
    result = _gated(f"query {{ me {{ {_USER_FIELDS} }} }}")
    return json.dumps(result.get("me"))


@_safe
def get_tenant(tenant_id: str) -> str:
    """Fetch a tenant by id."""
    result = _gated(
        f"query($id: ID!) {{ tenant(id: $id) {{ {_TENANT_FIELDS} }} }}",
        {"id": tenant_id},
    )
    return json.dumps(result.get("tenant"))


@_safe
def get_tenant_by_slug(slug: str) -> str:
    """Fetch a tenant by slug — common onboarding lookup (slug known, id not)."""
    result = _gated(
        f"query($slug: String!) {{ tenantBySlug(slug: $slug) {{ {_TENANT_FIELDS} }} }}",
        {"slug": slug},
    )
    return json.dumps(result.get("tenantBySlug"))


@_safe
def get_user(user_id: str) -> str:
    """Fetch a user by id."""
    result = _gated(
        f"query($id: ID!) {{ user(id: $id) {{ {_USER_FIELDS} }} }}",
        {"id": user_id},
    )
    return json.dumps(result.get("user"))


@_safe
def list_tenant_members(tenant_id: str) -> str:
    """List all members of a tenant — role/status per principal."""
    result = _gated(
        f"""query($tenantId: ID!) {{
            tenantMembers(tenantId: $tenantId) {{ {_TENANT_MEMBER_FIELDS} }}
        }}""",
        {"tenantId": tenant_id},
    )
    return json.dumps(result.get("tenantMembers", []))


# ---------------------------------------------------------------------------
# Agent reads
# ---------------------------------------------------------------------------


@_safe
def list_agents(
    tenant_id: str,
    status: str | None = None,
    type: str | None = None,  # noqa: A002 — param name matches the GraphQL arg
    include_system: bool = False,
) -> str:
    """List agents in a tenant, optionally filtered by status/type."""
    variables: dict[str, object] = {
        "tenantId": tenant_id,
        "includeSystem": include_system,
    }
    if status is not None:
        variables["status"] = status
    if type is not None:
        variables["type"] = type
    result = _gated(
        f"""query(
            $tenantId: ID!, $status: AgentStatus, $type: AgentType,
            $includeSystem: Boolean
        ) {{
            agents(
                tenantId: $tenantId, status: $status, type: $type,
                includeSystem: $includeSystem
            ) {{ {_AGENT_FIELDS} }}
        }}""",
        variables,
    )
    return json.dumps(result.get("agents", []))


@_safe
def get_agent(agent_id: str) -> str:
    """Fetch an agent by id."""
    result = _gated(
        f"query($id: ID!) {{ agent(id: $id) {{ {_AGENT_FIELDS} }} }}",
        {"id": agent_id},
    )
    return json.dumps(result.get("agent"))


@_safe
def list_all_tenant_agents(
    tenant_id: str,
    include_system: bool = False,
    include_sub_agents: bool = False,
) -> str:
    """Unfiltered agent list (subs + system optional). Use for onboarding
    reconcilers that need the full inventory."""
    result = _gated(
        f"""query($tenantId: ID!, $includeSystem: Boolean, $includeSubAgents: Boolean) {{
            allTenantAgents(
                tenantId: $tenantId, includeSystem: $includeSystem,
                includeSubAgents: $includeSubAgents
            ) {{ {_AGENT_FIELDS} }}
        }}""",
        {
            "tenantId": tenant_id,
            "includeSystem": include_system,
            "includeSubAgents": include_sub_agents,
        },
    )
    return json.dumps(result.get("allTenantAgents", []))


# ---------------------------------------------------------------------------
# Template reads
# ---------------------------------------------------------------------------


@_safe
def list_templates(tenant_id: str) -> str:
    """List agent templates for a tenant."""
    result = _gated(
        f"""query($tenantId: ID!) {{
            agentTemplates(tenantId: $tenantId) {{ {_TEMPLATE_FIELDS} }}
        }}""",
        {"tenantId": tenant_id},
    )
    return json.dumps(result.get("agentTemplates", []))


@_safe
def get_template(template_id: str) -> str:
    """Fetch a template by id."""
    result = _gated(
        f"query($id: ID!) {{ agentTemplate(id: $id) {{ {_TEMPLATE_FIELDS} }} }}",
        {"id": template_id},
    )
    return json.dumps(result.get("agentTemplate"))


@_safe
def list_linked_agents_for_template(template_id: str) -> str:
    """List all agents currently linked to a given template."""
    result = _gated(
        f"""query($templateId: ID!) {{
            linkedAgentsForTemplate(templateId: $templateId) {{ {_AGENT_FIELDS} }}
        }}""",
        {"templateId": template_id},
    )
    return json.dumps(result.get("linkedAgentsForTemplate", []))


# ---------------------------------------------------------------------------
# Team reads
# ---------------------------------------------------------------------------


@_safe
def list_teams(tenant_id: str) -> str:
    """List all teams in a tenant."""
    result = _gated(
        f"""query($tenantId: ID!) {{
            teams(tenantId: $tenantId) {{ {_TEAM_FIELDS} }}
        }}""",
        {"tenantId": tenant_id},
    )
    return json.dumps(result.get("teams", []))


@_safe
def get_team(team_id: str) -> str:
    """Fetch a team by id."""
    result = _gated(
        f"query($id: ID!) {{ team(id: $id) {{ {_TEAM_FIELDS} }} }}",
        {"id": team_id},
    )
    return json.dumps(result.get("team"))


# ---------------------------------------------------------------------------
# Artifact reads
# ---------------------------------------------------------------------------


@_safe
def list_artifacts(
    tenant_id: str,
    thread_id: str | None = None,
    agent_id: str | None = None,
    type: str | None = None,  # noqa: A002
    status: str | None = None,
    limit: int | None = None,
) -> str:
    """List artifacts in a tenant, filterable by thread/agent/type/status."""
    variables: dict[str, object] = {"tenantId": tenant_id}
    if thread_id is not None:
        variables["threadId"] = thread_id
    if agent_id is not None:
        variables["agentId"] = agent_id
    if type is not None:
        variables["type"] = type
    if status is not None:
        variables["status"] = status
    if limit is not None:
        variables["limit"] = limit
    result = _gated(
        f"""query(
            $tenantId: ID!, $threadId: ID, $agentId: ID,
            $type: ArtifactType, $status: ArtifactStatus, $limit: Int
        ) {{
            artifacts(
                tenantId: $tenantId, threadId: $threadId, agentId: $agentId,
                type: $type, status: $status, limit: $limit
            ) {{ {_ARTIFACT_FIELDS} }}
        }}""",
        variables,
    )
    return json.dumps(result.get("artifacts", []))


@_safe
def get_artifact(artifact_id: str) -> str:
    """Fetch an artifact by id."""
    result = _gated(
        f"query($id: ID!) {{ artifact(id: $id) {{ {_ARTIFACT_FIELDS} }} }}",
        {"id": artifact_id},
    )
    return json.dumps(result.get("artifact"))


__all__ = [
    "me",
    "get_tenant",
    "get_tenant_by_slug",
    "get_user",
    "list_tenant_members",
    "list_agents",
    "get_agent",
    "list_all_tenant_agents",
    "list_templates",
    "get_template",
    "list_linked_agents_for_template",
    "list_teams",
    "get_team",
    "list_artifacts",
    "get_artifact",
]
