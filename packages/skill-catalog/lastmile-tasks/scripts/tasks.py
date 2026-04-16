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
) -> str:
    """Fire the LastMile `POST /tasks` for the current thread using
    details the user filled in on the intake form.

    Call this **only after** you have received a `form_response` from
    the user's task-intake form (see `references/task-intake-form.json`).
    The form enforces required fields and pre-populates defaults;
    forward the submitted values verbatim.

    The current thread's id, tenant id, workflow id, and creator are
    all derived server-side — you don't need to pass them.

    Args:
        description: From `form_response.values.description`. Empty
            string if the user left it blank (the task will carry the
            thread's own description, or none).
        priority: From `form_response.values.priority`. One of
            'urgent', 'high', 'medium', 'low'. Required.
        due_date: From `form_response.values.due_date`, ISO-8601
            YYYY-MM-DD. Empty string for "no deadline".
        assignee_email: From `form_response.values.assignee_email`.
            Empty string defaults the assignee to the thread creator
            (usually the user who opened the thread).

    Returns:
        JSON `{threadId, syncStatus, externalTaskId}` on success, or
        `{error}` on failure. Tell the user the error plainly; don't
        silently retry.
    """
    if not THREAD_ID:
        return json.dumps({"error": "CURRENT_THREAD_ID not set"})
    if not priority:
        return json.dumps(
            {"error": "priority is required — re-check the form_response"}
        )

    input_data: dict = {"threadId": THREAD_ID, "priority": priority}
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
