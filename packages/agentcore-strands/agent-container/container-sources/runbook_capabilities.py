"""Runbook capability-role mapping for the Strands runtime.

Runbook definitions declare stable capability roles, not concrete specialist
agent names. This module is the Python-side adapter that maps those product
roles to the v1 execution target. Later releases can point individual roles at
agents-as-tools or Strands workflow nodes without changing authored runbooks.
"""

from __future__ import annotations

from typing import Any

RUNBOOK_CAPABILITY_ROLES: tuple[str, ...] = (
    "research",
    "analysis",
    "artifact_build",
    "map_build",
    "validation",
)


class RunbookCapabilityError(ValueError):
    """Raised when a runbook task declares an unsupported capability role."""


_KNOWN_ROLES = set(RUNBOOK_CAPABILITY_ROLES)

_ROLE_GUIDANCE: dict[str, dict[str, Any]] = {
    "research": {
        "executionTarget": "main_computer_agent",
        "guidance": "Gather and inspect available evidence before producing conclusions.",
        "preferredTools": ["workspace search", "context engine", "web search"],
    },
    "analysis": {
        "executionTarget": "main_computer_agent",
        "guidance": "Synthesize evidence into structured findings, tradeoffs, risks, and caveats.",
        "preferredTools": ["workspace context", "memory", "reasoning"],
    },
    "artifact_build": {
        "executionTarget": "main_computer_agent",
        "guidance": (
            "Use the Computer artifact path in this parent turn. Build and persist "
            "the applet with save_app when artifact tools are available."
        ),
        "preferredTools": ["artifact-builder", "save_app", "load_app", "list_apps"],
    },
    "map_build": {
        "executionTarget": "main_computer_agent",
        "guidance": "Build inspectable map artifacts using available location evidence and source caveats.",
        "preferredTools": ["artifact-builder", "save_app", "workspace search"],
    },
    "validation": {
        "executionTarget": "main_computer_agent",
        "guidance": "Verify outputs against the requested scope, source evidence, and runbook output contract.",
        "preferredTools": ["load_app", "workspace search", "reasoning"],
    },
}


def is_allowed_runbook_capability_role(role: str) -> bool:
    return role in _KNOWN_ROLES or role.startswith("experimental:")


def resolve_runbook_capability(role: str, *, task_id: str = "") -> dict[str, Any]:
    """Return the v1 execution mapping for a runbook capability role."""

    if role in _ROLE_GUIDANCE:
        return {
            "role": role,
            **_ROLE_GUIDANCE[role],
        }
    if role.startswith("experimental:"):
        return {
            "role": role,
            "executionTarget": "main_computer_agent",
            "guidance": (
                "Experimental runbook capability. Execute conservatively with the main "
                "Computer agent and record any missing capability assumptions."
            ),
            "preferredTools": ["workspace context", "reasoning"],
        }
    detail = f"Unknown runbook capability role {role!r}"
    if task_id:
        detail += f" for task {task_id}"
    raise RunbookCapabilityError(detail)


def resolve_task_capabilities(task: dict[str, Any]) -> list[dict[str, Any]]:
    roles = task.get("capabilityRoles")
    if roles is None:
        roles = task.get("capability_roles")
    if not isinstance(roles, list) or not roles:
        task_id = str(task.get("id") or task.get("taskKey") or task.get("task_key") or "")
        raise RunbookCapabilityError(
            f"Runbook task {task_id or '<unknown>'} has no capability roles"
        )
    task_id = str(task.get("id") or task.get("taskKey") or task.get("task_key") or "")
    return [resolve_runbook_capability(str(role), task_id=task_id) for role in roles]
