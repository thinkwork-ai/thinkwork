"""LastMile Tasks skill — create a LastMile task after the user fills
out the intake form.

Pairs with `references/task-intake-form.json`: the agent calls
`agent-thread-management.present_form` to collect
description/priority/due_date/assignee, reads the user's
```form_response``` reply, then calls `create_task` here to actually
fire `POST /tasks` on LastMile.

The skill never talks to LastMile REST directly — it goes through the
ThinkWork GraphQL API (`createLastmileTask` mutation) so PAT
resolution and sync-state stamping stay server-side.

Uses only Python stdlib (urllib) so the skill bundle stays
dependency-free, matching the agent-thread-management convention.
"""

import functools
import json
import os
import urllib.request
import urllib.error

API_URL = os.environ.get("THINKWORK_API_URL", "")
API_SECRET = os.environ.get("THINKWORK_API_SECRET", "")
GRAPHQL_API_KEY = os.environ.get("GRAPHQL_API_KEY", "") or API_SECRET
TENANT_ID = os.environ.get("TENANT_ID", "") or os.environ.get("_MCP_TENANT_ID", "")
AGENT_ID = os.environ.get("AGENT_ID", "") or os.environ.get("_MCP_AGENT_ID", "")
THREAD_ID = os.environ.get("CURRENT_THREAD_ID", "")


def _graphql(query: str, variables: dict | None = None) -> dict:
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{API_URL}/graphql",
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": GRAPHQL_API_KEY,
            "x-tenant-id": TENANT_ID,
            "x-agent-id": AGENT_ID,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if "errors" in result:
        return {"error": result["errors"][0].get("message", str(result["errors"]))}
    return result.get("data", result)


def _safe(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500] if exc.fp else str(exc)
            return json.dumps({"error": f"HTTP {exc.code}: {detail}"})
        except Exception as exc:
            return json.dumps({"error": str(exc)})
    return wrapper


def _extract_external_task_id(metadata) -> str | None:
    """`threads.metadata` comes back from GraphQL as either a JSON
    string (AWSJSON spec) or a pre-parsed object depending on the
    runtime. Normalize and pluck `.external.externalTaskId`."""
    if not metadata:
        return None
    meta = json.loads(metadata) if isinstance(metadata, str) else metadata
    external = meta.get("external") if isinstance(meta, dict) else None
    if not isinstance(external, dict):
        return None
    external_id = external.get("externalTaskId")
    return external_id if isinstance(external_id, str) else None


@_safe
def create_task(
    description: str = "",
    priority: str = "",
    due_date: str = "",
    assignee_email: str = "",
    form_response_json: str = "",
) -> str:
    """Fire a LastMile task-create for the current thread using details
    the user filled in on the intake form.

    Two paths, picked based on what you pass:

    1. **Workflow-skill path (preferred when available)** — when the
       system prompt contains a `## Workflow Skill` block, the thread's
       workflow ships its own form. Call `present_form(form_json=...)`
       with the inline schema from that block, then pass the resulting
       `form_response` payload verbatim as `form_response_json`. The
       other kwargs are ignored on this path; LastMile owns the mapping
       from form values to task columns.

    2. **Legacy path (fallback)** — when there is no Workflow Skill
       block in context, use the hardcoded intake form at
       `references/task-intake-form.json` and pass the extracted fields
       via the per-column kwargs below.

    The current thread's id, tenant id, workflow id, and creator are
    all derived server-side.

    Args:
        description: Legacy path. From `form_response.values.description`.
        priority: Legacy path. From `form_response.values.priority`. One
            of 'urgent', 'high', 'medium', 'low'. Required on legacy
            path; ignored on the workflow-skill path.
        due_date: Legacy path. ISO-8601 YYYY-MM-DD; empty for no
            deadline.
        assignee_email: Legacy path. Empty defaults to the thread
            creator.
        form_response_json: Workflow-skill path. The complete
            `form_response` payload as a JSON string — the whole
            `{"form_id": "...", "values": {...}}` block the user
            submitted. Forwarded opaquely to LastMile.

    Returns:
        JSON `{threadId, syncStatus, externalTaskId}` on success, or
        `{error}` on failure. Tell the user the error plainly; don't
        silently retry.
    """
    if not THREAD_ID:
        return json.dumps({"error": "CURRENT_THREAD_ID not set"})

    input_data: dict = {"threadId": THREAD_ID}

    if form_response_json:
        # Workflow-skill path — the whole form_response is opaque to us.
        # Validate shape ({form_id, values}) before forwarding so a
        # malformed blob surfaces as a clear error instead of a server
        # 4xx. Server still re-validates, so this is a friendliness
        # layer, not a trust boundary.
        try:
            parsed = json.loads(form_response_json)
        except json.JSONDecodeError as exc:
            return json.dumps(
                {"error": f"form_response_json is not valid JSON: {exc}"}
            )
        if not isinstance(parsed, dict):
            return json.dumps(
                {"error": "form_response_json must decode to an object"}
            )
        form_id = parsed.get("form_id")
        values = parsed.get("values")
        if not isinstance(form_id, str) or not form_id:
            return json.dumps(
                {"error": "form_response_json missing string form_id"}
            )
        if not isinstance(values, dict):
            return json.dumps(
                {"error": "form_response_json missing values object"}
            )
        # AWSJSON travels as a JSON string on the GraphQL wire — AppSync
        # requires the value to be a string, not a nested object. The
        # resolver parses it back on arrival via parseFormResponse().
        input_data["formResponse"] = json.dumps(
            {"form_id": form_id, "values": values}
        )
    else:
        # Legacy path — priority is the only required field.
        if not priority:
            return json.dumps(
                {"error": "priority is required — re-check the form_response"}
            )
        input_data["priority"] = priority
        if description:
            input_data["description"] = description
        if due_date:
            input_data["dueDate"] = due_date
        if assignee_email:
            input_data["assigneeEmail"] = assignee_email

    result = _graphql(
        """mutation($i: CreateLastmileTaskInput!) {
  createLastmileTask(input: $i) {
    id
    syncStatus
    syncError
    metadata
  }
}""",
        {"i": input_data},
    )
    if "error" in result:
        return json.dumps(result)

    thread = result.get("createLastmileTask", {})
    external_task_id = _extract_external_task_id(thread.get("metadata"))
    return json.dumps({
        "threadId": thread.get("id"),
        "syncStatus": thread.get("syncStatus"),
        "externalTaskId": external_task_id,
        "syncError": thread.get("syncError"),
    })
