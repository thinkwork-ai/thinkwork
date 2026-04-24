"""External-task context formatting for the agent runtime.

When chat-agent-invoke ships `thread.metadata` to the agent container, this
module turns the embedded `external.latestEnvelope` (LastMile etc.) into a
structured Markdown block that gets appended to the system prompt. Without
this, an agent attached to an external-task thread sees only the user's
literal message and has no idea what task is being discussed.

Kept in its own module (instead of inline in server.py) so it can be
unit-tested without pulling in the full agentcore Lambda layer.
"""

from __future__ import annotations


def format_external_task_context(thread_metadata: dict | None) -> str:
    """Render `thread_metadata.external.latestEnvelope` as a system-prompt block.

    Returns an empty string when the thread has no external-task envelope.
    """
    if not isinstance(thread_metadata, dict):
        return ""
    external = thread_metadata.get("external")
    if not isinstance(external, dict):
        return ""
    envelope = external.get("latestEnvelope")
    if not isinstance(envelope, dict):
        return ""
    item = envelope.get("item") or {}
    core = item.get("core") if isinstance(item, dict) else None
    if not isinstance(core, dict):
        return ""

    provider = external.get("provider") or core.get("provider") or "external"
    title = core.get("title") or "Untitled task"
    external_id = core.get("id") or external.get("externalTaskId") or ""
    description = core.get("description") or ""
    url = core.get("url") or ""
    due_at = core.get("dueAt") or ""
    updated_at = core.get("updatedAt") or ""

    status_obj = core.get("status") if isinstance(core.get("status"), dict) else {}
    priority_obj = core.get("priority") if isinstance(core.get("priority"), dict) else {}
    status_label = status_obj.get("label") or status_obj.get("value") or "unknown"
    priority_label = priority_obj.get("label") or priority_obj.get("value") or "unknown"

    assignee = core.get("assignee") if isinstance(core.get("assignee"), dict) else {}
    assignee_name = assignee.get("name") or assignee.get("email") or "unknown"

    lines = [
        f"## Active External Task ({str(provider).capitalize()})",
        "",
        "You are responding inside a thread that represents a specific external task.",
        "Use the details below as context for any tool calls and responses. When the",
        "user asks for related information (CRM records, customer details, history),",
        "use the task identifiers and assignee as the lookup key for any available",
        "MCP tools or skills.",
        "",
        f"- **Title:** {title}",
        f"- **External ID:** {external_id}",
        f"- **Status:** {status_label}",
        f"- **Priority:** {priority_label}",
        f"- **Assignee:** {assignee_name}",
    ]
    if due_at:
        lines.append(f"- **Due:** {due_at}")
    if updated_at:
        lines.append(f"- **Last updated:** {updated_at}")
    if url:
        lines.append(f"- **URL:** {url}")
    if description:
        snippet = description.strip()
        if len(snippet) > 1500:
            snippet = snippet[:1500].rstrip() + "…"
        lines.append("")
        lines.append("**Description:**")
        lines.append(snippet)
    return "\n".join(lines)
