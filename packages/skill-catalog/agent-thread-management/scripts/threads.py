"""Thread management skill — replaces the thread-management MCP server.

Provides 8 functions for creating, querying, and managing threads
via the Thinkwork GraphQL API. Uses only Python stdlib.
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
CURRENT_USER_EMAIL = os.environ.get("CURRENT_USER_EMAIL", "")

# Cache for tenant members (fetched once per invocation)
_tenant_members_cache: list | None = None

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _graphql(query: str, variables: dict | None = None) -> dict:
    """Execute a GraphQL query/mutation against the Thinkwork API."""
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
    """Decorator — catches errors, preserves signature for Strands tool schema."""
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


def _fetch_tenant_members() -> list:
    """Fetch all tenant members with user details. Cached per invocation."""
    global _tenant_members_cache
    if _tenant_members_cache is not None:
        return _tenant_members_cache
    result = _graphql(
        "query($tenantId: ID!) { tenantMembers(tenantId: $tenantId) { principalType principalId user { id email name } } }",
        {"tenantId": TENANT_ID},
    )
    members = result.get("tenantMembers", [])
    _tenant_members_cache = [m for m in members if m.get("user")]
    return _tenant_members_cache


def _resolve_user_by_email(email: str) -> dict | None:
    """Find a tenant member by exact email match."""
    email_lower = email.lower()
    for member in _fetch_tenant_members():
        user = member.get("user", {})
        if user.get("email", "").lower() == email_lower:
            return user
    return None


# ---------------------------------------------------------------------------
# Public API — 10 functions (all use GraphQL)
# ---------------------------------------------------------------------------

THREAD_FIELDS = "id title status priority type channel parentId agentId assigneeType assigneeId description number identifier dueAt createdAt"


@_safe
def create_sub_thread(title: str, description: str,
                      parent_thread_id: str = "",
                      channel: str = "TASK",
                      assignee_email: str = "",
                      priority: str = "MEDIUM",
                      due_date: str = "") -> str:
    """Create a child task under a parent thread. Defaults to TASK channel.

    Args:
        title: Clear, specific title for the task.
        description: REQUIRED. 1-2 sentence explanation of what needs to be done.
        parent_thread_id: UUID of the parent thread. Defaults to
            CURRENT_THREAD_ID when omitted.
        channel: Thread channel. Defaults to TASK. Use CHAT for non-task threads.
        assignee_email: Email of the user to assign. If provided, resolves to
            user ID and sets assignee_type to 'user'. If omitted, assigns to
            the current agent.
        priority: LOW, MEDIUM, HIGH, URGENT, or CRITICAL. Defaults to MEDIUM.
        due_date: Optional ISO-8601 due date (e.g. '2026-04-15T09:00:00Z').

    Returns:
        JSON with the created thread (id, title, status, identifier, etc).
    """
    parent = parent_thread_id or THREAD_ID

    # Resolve assignee — default to current user if known, else unassigned
    email = assignee_email or CURRENT_USER_EMAIL
    assignee_type = None
    assignee_id = None
    if email:
        user = _resolve_user_by_email(email)
        if user:
            assignee_type = "user"
            assignee_id = user["id"]
        elif assignee_email:
            return json.dumps({"error": f"No user found with email '{assignee_email}'"})

    input_data: dict = {
        "tenantId": TENANT_ID,
        "agentId": AGENT_ID,
        "title": title,
        "description": description or None,
        "type": "TASK",
        "channel": channel.upper(),
        "parentId": parent or None,
        "assigneeType": assignee_type,
        "assigneeId": assignee_id,
        "priority": priority.upper(),
    }
    if due_date:
        input_data["dueAt"] = due_date

    result = _graphql(
        f"mutation($i: CreateThreadInput!) {{ createThread(input: $i) {{ {THREAD_FIELDS} }} }}",
        {"i": input_data},
    )
    return json.dumps(result)


@_safe
def add_dependency(thread_id: str, depends_on_thread_id: str) -> str:
    """Block a thread until another thread completes.

    Args:
        thread_id: The thread that will be blocked.
        depends_on_thread_id: The thread it depends on.

    Returns:
        JSON with the dependency result.
    """
    result = _graphql(
        "mutation($tid: ID!, $bid: ID!) { addThreadDependency(threadId: $tid, blockedByThreadId: $bid) { id } }",
        {"tid": thread_id, "bid": depends_on_thread_id},
    )
    # Also set the dependent thread status to blocked
    _graphql(
        "mutation($id: ID!, $i: UpdateThreadInput!) { updateThread(id: $id, input: $i) { id } }",
        {"id": thread_id, "i": {"status": "BLOCKED"}},
    )
    return json.dumps(result)


@_safe
def update_thread_status(
    thread_id: str,
    status: str,
    channel: str = "",
    title: str = "",
    description: str = "",
    priority: str = "",
    due_date: str = "",
    assignee_email: str = "",
) -> str:
    """Update a thread's status and optionally other fields. To convert a
    chat thread into a task, set channel='TASK' along with the desired
    status, title, description, priority, and due_date.

    Args:
        thread_id: UUID of the thread to update.
        status: New status. Must be one of: BACKLOG, TODO, IN_PROGRESS,
            IN_REVIEW, BLOCKED, DONE, CANCELLED.
        channel: Optional. Set to 'TASK' to promote a chat thread to a task.
        title: Optional new title.
        description: Optional new description.
        priority: Optional. LOW, MEDIUM, HIGH, URGENT, or CRITICAL.
        due_date: Optional ISO-8601 due date.
        assignee_email: Optional email to assign as owner.

    Returns:
        JSON with the updated thread.
    """
    status_upper = status.upper()
    valid = {"BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW",
             "BLOCKED", "DONE", "CANCELLED"}
    if status_upper not in valid:
        return json.dumps({"error": f"Invalid status '{status}'. Must be one of: {', '.join(sorted(valid))}"})
    input_data: dict = {"status": status_upper}
    if channel:
        input_data["channel"] = channel.upper()
    if title:
        input_data["title"] = title
    if description:
        input_data["description"] = description
    if priority:
        input_data["priority"] = priority.upper()
    if due_date:
        input_data["dueAt"] = due_date
    if assignee_email:
        user = _resolve_user_by_email(assignee_email)
        if user:
            input_data["assigneeType"] = "user"
            input_data["assigneeId"] = user["id"]
        else:
            return json.dumps({"error": f"No user found with email '{assignee_email}'"})
    result = _graphql(
        f"mutation($id: ID!, $i: UpdateThreadInput!) {{ updateThread(id: $id, input: $i) {{ {THREAD_FIELDS} }} }}",
        {"id": thread_id, "i": input_data},
    )
    return json.dumps(result)


@_safe
def promote_to_task(
    thread_id: str = "",
    title: str = "",
    description: str = "",
    priority: str = "MEDIUM",
    due_date: str = "",
    assignee_email: str = "",
) -> str:
    """Promote the current thread to a task. Changes the channel to TASK
    and sets task metadata. Use after creating sub-tasks to convert a
    chat thread into a parent task.

    Args:
        thread_id: UUID of the thread to promote. Defaults to CURRENT_THREAD_ID.
        title: Optional new title for the task.
        description: Optional description with task details.
        priority: LOW, MEDIUM, HIGH, URGENT, or CRITICAL.
        due_date: Optional ISO-8601 due date.
        assignee_email: Optional email of the user to assign as owner.

    Returns:
        JSON with the updated thread.
    """
    tid = thread_id or THREAD_ID
    input_data: dict = {
        "channel": "TASK",
        "status": "TODO",
        "priority": priority.upper(),
    }
    if title:
        input_data["title"] = title
    if description:
        input_data["description"] = description
    if due_date:
        input_data["dueAt"] = due_date
    if assignee_email:
        user = _resolve_user_by_email(assignee_email)
        if user:
            input_data["assigneeType"] = "user"
            input_data["assigneeId"] = user["id"]
        else:
            return json.dumps({"error": f"No user found with email '{assignee_email}'"})
    result = _graphql(
        f"mutation($id: ID!, $i: UpdateThreadInput!) {{ updateThread(id: $id, input: $i) {{ {THREAD_FIELDS} }} }}",
        {"id": tid, "i": input_data},
    )
    return json.dumps(result)


@_safe
def add_comment(thread_id: str, content: str) -> str:
    """Add a comment to a thread.

    Args:
        thread_id: UUID of the thread to comment on.
        content: The comment text (supports markdown).

    Returns:
        JSON with the created comment (id, content, createdAt).
    """
    result = _graphql(
        "mutation($i: AddThreadCommentInput!) { addThreadComment(input: $i) { id content authorType authorId createdAt } }",
        {"i": {
            "threadId": thread_id,
            "content": content,
            "authorType": "agent",
            "authorId": AGENT_ID,
        }},
    )
    return json.dumps(result)


@_safe
def list_sub_threads(parent_thread_id: str = "",
                     status_filter: str = "") -> str:
    """List child threads of a parent, optionally filtered by status.

    Args:
        parent_thread_id: UUID of the parent thread. Defaults to
            CURRENT_THREAD_ID when omitted.
        status_filter: Optional status to filter by (e.g. "IN_PROGRESS").

    Returns:
        JSON array of thread objects.
    """
    parent = parent_thread_id or THREAD_ID
    variables: dict = {"tenantId": TENANT_ID, "parentId": parent}
    if status_filter:
        variables["status"] = status_filter.upper()
    result = _graphql(
        f"query($tenantId: ID!, $parentId: ID, $status: ThreadStatus) {{ threads(tenantId: $tenantId, parentId: $parentId, status: $status) {{ {THREAD_FIELDS} }} }}",
        variables,
    )
    return json.dumps(result)


@_safe
def get_thread_details(thread_id: str) -> str:
    """Retrieve full details for a single thread including comments.

    Args:
        thread_id: UUID of the thread.

    Returns:
        JSON with the thread object and its comments.
    """
    result = _graphql(
        f"query($id: ID!) {{ thread(id: $id) {{ {THREAD_FIELDS} description comments {{ id content authorType authorId createdAt }} childCount commentCount }} }}",
        {"id": thread_id},
    )
    return json.dumps(result)


@_safe
def escalate_thread(thread_id: str = "", reason: str = "") -> str:
    """Escalate a thread to a supervisor agent.

    Args:
        thread_id: UUID of the thread to escalate. Defaults to
            CURRENT_THREAD_ID when omitted.
        reason: Free-text explanation for the escalation.

    Returns:
        JSON with the escalation result (id, status, assigneeId).
    """
    tid = thread_id or THREAD_ID
    result = _graphql(
        "mutation($i: EscalateThreadInput!) { escalateThread(input: $i) { id status assigneeId } }",
        {"i": {"threadId": tid, "reason": reason, "agentId": AGENT_ID}},
    )
    return json.dumps(result)


@_safe
def delegate_thread(thread_id: str = "", target_agent_id: str = "",
                    reason: str = "") -> str:
    """Delegate a thread to another agent.

    Args:
        thread_id: UUID of the thread to delegate. Defaults to
            CURRENT_THREAD_ID when omitted.
        target_agent_id: UUID of the agent to delegate to.
        reason: Free-text explanation for the delegation.

    Returns:
        JSON with the delegation result (id, status, assigneeId).
    """
    tid = thread_id or THREAD_ID
    result = _graphql(
        "mutation($i: DelegateThreadInput!) { delegateThread(input: $i) { id status assigneeId } }",
        {"i": {"threadId": tid, "targetAgentId": target_agent_id, "reason": reason, "agentId": AGENT_ID}},
    )
    return json.dumps(result)


@_safe
def search_users(query: str) -> str:
    """Look up a Thinkwork PLATFORM TEAMMATE by name or email.

    Use this tool ONLY when you need to find an internal Thinkwork user —
    a coworker, team member, or platform login account that exists in the
    tenant's user directory. The result is a list of {id, email, name}
    records limited to people who have logged into this Thinkwork tenant.

    DO NOT use this tool for general questions about people, customers,
    contacts, business associates, or anyone the user has merely talked
    about in past conversations. For any of those cases, the right tool
    is `hindsight_recall`, which searches your long-term memory of past
    conversations and stored facts about people, companies, and projects.

    Examples of when to USE search_users:
        - "Add Eric to this thread as a collaborator"
        - "Who on our team owns this account?"
        - "Find the Thinkwork user with email alice@thinkwork.ai"

    Examples of when NOT to use search_users (use hindsight_recall instead):
        - "Where does Cedric work?"
        - "What do I know about John Smith?"
        - "Who is the contact at Acme Corp?"
        - "Tell me about my customer Sarah"

    Args:
        query: Search string matched against the Thinkwork user directory
            name and email fields (case-insensitive substring match).

    Returns:
        JSON array of matching Thinkwork platform users
        [{id, email, name}]. Empty array if no platform user matches.
    """
    query_lower = query.lower()
    matches = []
    for member in _fetch_tenant_members():
        user = member.get("user", {})
        name = (user.get("name") or "").lower()
        email = (user.get("email") or "").lower()
        if query_lower in name or query_lower in email:
            matches.append({
                "id": user["id"],
                "email": user.get("email"),
                "name": user.get("name"),
            })
    return json.dumps({"users": matches})


@_safe
def schedule_followup(date: str, prompt: str, name: str = "") -> str:
    """Schedule a future agent wakeup to follow up on tasks.

    Args:
        date: ISO-8601 datetime for when to wake up
            (e.g. '2026-04-15T09:00:00Z').
        prompt: Instructions for the agent when it wakes up
            (e.g. 'Check status of onboarding tasks').
        name: Optional human-readable name for the scheduled job.

    Returns:
        JSON with the created scheduled job.
    """
    job_name = name or f"Follow-up: {prompt[:60]}"
    result = _graphql(
        "mutation($i: CreateScheduledJobInput!) { createScheduledJob(input: $i) { id name triggerType scheduleExpression nextRunAt } }",
        {"i": {
            "tenantId": TENANT_ID,
            "agentId": AGENT_ID,
            "triggerType": "agent_reminder",
            "name": job_name,
            "prompt": prompt,
            "scheduleType": "at",
            "scheduleExpression": f"at({date})",
            "createdByType": "agent",
            "createdById": AGENT_ID,
        }},
    )
    return json.dumps(result)
