"""Workflow-skill context formatting for the agent runtime.

When `chat-agent-invoke` ships a `workflow_skill` blob alongside
`thread_metadata`, this module renders a Markdown block that steers the
agent for the duration of the thread:

- `skill.instructions` — freeform markdown from LastMile describing how
  to behave on this workflow (tone, guardrails, when to stop, etc.).
  Injected verbatim.
- `skill.form` — the Question Card schema the agent should pass to
  `present_form`. Rendered as a fenced JSON block so the agent can
  copy it into the tool call.

The `lastmile-tasks` skill looks for this block in its system prompt
and takes the dynamic path (workflow-specific form) when it appears,
falling back to the hardcoded static form when it doesn't. See
`packages/skill-catalog/lastmile-tasks/SKILL.md`.

Mirrors the shape + testability of `external_task_context.py`.
"""

from __future__ import annotations

import json
from typing import Any


def format_workflow_skill_context(workflow_skill: Any) -> str:
    """Render the workflow's `skill` block as a system-prompt section.

    Returns an empty string when `workflow_skill` is missing, isn't a
    dict, or has neither `instructions` nor `form` populated. The
    ThinkWork side already validated `schemaVersion=1` before shipping
    the blob, so we don't re-check it here.
    """
    if not isinstance(workflow_skill, dict):
        return ""

    instructions = workflow_skill.get("instructions")
    form = workflow_skill.get("form")
    workflow_id = workflow_skill.get("workflowId")

    has_instructions = isinstance(instructions, str) and instructions.strip()
    has_form = isinstance(form, dict) and form.get("id") and form.get("fields")

    if not has_instructions and not has_form:
        return ""

    lines: list[str] = [
        "## Workflow Skill",
        "",
        "The LastMile workflow attached to this thread ships its own intake",
        "instructions and form. Follow the instructions below and present the",
        "form (if any) as-is — do NOT fall back to the generic task-intake",
        "form when this block is present.",
        "",
    ]

    if isinstance(workflow_id, str) and workflow_id:
        # The agent MUST use this exact value as the `workflowId` argument
        # when calling the LastMile MCP's `workflow_task_create` tool —
        # guessing from other identifier-looking strings in context (the
        # agent instance_id, the form's id, etc.) produces "Workflow not
        # found" errors on the MCP side.
        lines.append(f"- **Workflow ID (pass verbatim to `workflow_task_create`):** `{workflow_id}`")
        lines.append("")

    if has_instructions:
        lines.append("### Instructions")
        lines.append("")
        lines.append(instructions.strip())
        lines.append("")

    if has_form:
        lines.append("### Form schema")
        lines.append("")
        lines.append(
            "Pass this schema verbatim to `present_form`'s `form_json` "
            "argument — do not modify field ids or types. The `form_response` "
            "values come back as an opaque payload that ThinkWork forwards to "
            "LastMile; you don't need to map them to per-column arguments.",
        )
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps(form, indent=2, ensure_ascii=False))
        lines.append("```")

    return "\n".join(lines).rstrip() + "\n"
