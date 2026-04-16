"""LastMile Tasks skill — agent-facing tools for proposing a LastMile
task creation via the user-approval (inbox item) path.

Does NOT call LastMile REST directly: the backend GraphQL API centralizes
PAT resolution, so the skill goes through `lastmileTerminals` /
`createInboxItem`. The actual `POST /tasks` fires server-side when the
user approves the resulting inbox item — see
`packages/api/src/graphql/resolvers/inbox/approveInboxItem.mutation.ts`.

Uses only the Python stdlib so the skill bundle stays dependency-free.
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
    with urllib.request.urlopen(req, timeout=15) as resp:
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


@_safe
def list_terminals() -> str:
    """List the current user's LastMile terminals.

    Call this when you need to pick a terminalId for
    `propose_task_create` and the terminal isn't obvious from the
    conversation. The ids are opaque LastMile identifiers (e.g.
    `term_s0qvm3iyq0jgbd4e6hgx51y9`) — always use the id from this
    response verbatim, never invent one.

    Returns:
        JSON array of {id, name, externalId, abbv, city, state}.
        Example: `[{"id": "term_...", "name": "CALUMET SAN ANTONIO",
        "externalId": "TMW:CALSAN", "city": "San Antonio", "state": "TX"}]`
    """
    if not THREAD_ID:
        return json.dumps({"error": "CURRENT_THREAD_ID not set"})
    result = _graphql(
        "query($t: ID!) { lastmileTerminals(threadId: $t) { id name externalId abbv city state } }",
        {"t": THREAD_ID},
    )
    if "error" in result:
        return json.dumps(result)
    return json.dumps(result.get("lastmileTerminals", []))


@_safe
def propose_task_create(
    title: str,
    terminal_id: str,
    description: str = "",
    priority: str = "",
    due_date: str = "",
    workflow_id: str = "",
) -> str:
    """Propose a LastMile task creation for the user to approve.

    Does NOT create the task in LastMile directly. Creates an inbox item
    (`type='create_task'`) with the payload; the user taps Approve on
    mobile to deterministically fire `POST /tasks` server-side. The
    current thread id is used as the entity id so the confirmation card
    surfaces in the right thread context.

    Call `list_terminals` first if you aren't sure of the terminalId.

    Args:
        title: Short, specific task title. Required.
        terminal_id: Opaque LastMile terminal id from `list_terminals`.
            Required — do not invent.
        description: Optional longer description.
        priority: Optional — one of 'urgent', 'high', 'medium', 'low'.
        due_date: Optional ISO-8601 date (e.g. '2026-04-20').
        workflow_id: Optional LastMile workflow id (display-only on
            ThinkWork side; not sent in the POST body).

    Returns:
        JSON `{ inboxItemId: "..." }` on success. The user must approve
        the inbox item before the task exists in LastMile.
    """
    if not THREAD_ID:
        return json.dumps({"error": "CURRENT_THREAD_ID not set"})
    if not title:
        return json.dumps({"error": "title is required"})
    if not terminal_id:
        return json.dumps(
            {"error": "terminal_id is required — call list_terminals to pick one"}
        )

    config: dict = {"title": title, "terminalId": terminal_id, "provider": "lastmile"}
    if description:
        config["description"] = description
    if priority:
        config["priority"] = priority
    if due_date:
        config["dueDate"] = due_date
    if workflow_id:
        config["workflowId"] = workflow_id

    input_data = {
        "tenantId": TENANT_ID,
        "requesterType": "agent",
        "requesterId": AGENT_ID or None,
        "type": "create_task",
        "title": f"Create task in LastMile: {title}",
        "description": description or None,
        "entityType": "thread",
        "entityId": THREAD_ID,
        # createInboxItem expects a JSON string that it parses server-side.
        "config": json.dumps(config),
    }

    result = _graphql(
        "mutation($i: CreateInboxItemInput!) { createInboxItem(input: $i) { id type status } }",
        {"i": input_data},
    )
    if "error" in result:
        return json.dumps(result)
    item = result.get("createInboxItem", {})
    return json.dumps({"inboxItemId": item.get("id"), "status": item.get("status")})
