"""Workflow-skill context formatting for the agent runtime.

When `chat-agent-invoke` ships a `workflow_skill` blob alongside
`thread_metadata`, this module renders a Markdown block that steers the
agent for the duration of the thread:

- `skill.instructions` — freeform markdown from the workflow provider describing how
  to behave on this workflow (tone, guardrails, when to stop, etc.).
  Injected verbatim.
- `skill.form` — the Question Card schema the agent should pass to
  `present_form`. Rendered as a fenced JSON block so the agent can
  copy it into the tool call.

Workflow-aware skills look for this block in the system prompt and take
the dynamic path (workflow-specific form) when it appears.

Mirrors the shape + testability of `external_task_context.py`.
"""

from __future__ import annotations

import json
from typing import Any


def format_workflow_skill_context(workflow_skill: Any) -> str:
    """Render the workflow's `skill` block as a system-prompt section.

    Returns an empty string when `workflow_skill` is missing/not-a-dict
    OR when it has no workflowId and no instructions/form. When a
    workflowId is present we ALWAYS render the block (even if
    instructions/form are absent) because surfacing the workflowId is
    the whole reason the agent can call `workflow_task_create` without
    passing a placeholder like `{{thread.metadata.workflowId}}`.
    """
    if not isinstance(workflow_skill, dict):
        return ""

    instructions = workflow_skill.get("instructions")
    form = workflow_skill.get("form")
    workflow_id = workflow_skill.get("workflowId")
    workflow_name = workflow_skill.get("workflowName")

    has_instructions = isinstance(instructions, str) and instructions.strip()
    has_form = isinstance(form, dict) and form.get("id") and form.get("fields")
    has_workflow_id = isinstance(workflow_id, str) and workflow_id

    if not has_workflow_id and not has_instructions and not has_form:
        return ""

    lines: list[str] = [
        "## Workflow Skill",
        "",
        "The workflow attached to this thread ships its own intake",
        "instructions and/or form. Follow the instructions below and present",
        "the form (if any) as-is. When only the Workflow ID is present,",
        "fall back to the skill's default form via `present_form(form_path=...)`",
        "when applicable — but still pass the Workflow ID",
        "verbatim to `workflow_task_create`.",
        "",
    ]

    if has_workflow_id:
        # The agent MUST use this exact value as the `workflowId` argument
        # when calling the provider MCP's `workflow_task_create` tool —
        # guessing from other identifier-looking strings in context (the
        # agent instance_id, the form's id, etc.) produces "Workflow not
        # found" errors on the MCP side.
        lines.append(f"- **Workflow ID (pass verbatim to `workflow_task_create`):** `{workflow_id}`")
        if isinstance(workflow_name, str) and workflow_name:
            lines.append(f"- **Workflow name:** {workflow_name}")
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
            "the provider; you don't need to map them to per-column arguments.",
        )
        lines.append("")
        lines.append("```json")
        lines.append(json.dumps(form, indent=2, ensure_ascii=False))
        lines.append("```")

    return "\n".join(lines).rstrip() + "\n"
