"""
update_agent_name Strands tool.

Lets the agent rename itself — calls the `updateAgent` GraphQL mutation
with service auth (x-api-key + x-tenant-id + x-agent-id). The mutation's
authz layer requires `x-agent-id == args.id`, so this tool can only
rename the agent it's running as.

Server-side this triggers `writeIdentityMdForAgent` inside the same DB
transaction, which does name-line surgery on the agent's IDENTITY.md in
S3. DB name and IDENTITY.md stay atomic — a failure on either side
rolls both back.

Part of docs/plans/2026-04-22-003-feat-agent-self-serve-tools-plan.md.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

from strands import tool

logger = logging.getLogger(__name__)

_MUTATION = """
mutation UpdateAgentName($id: ID!, $input: UpdateAgentInput!) {
  updateAgent(id: $id, input: $input) {
    id
    name
  }
}
""".strip()


def _post_graphql(
    tenant_id: str,
    agent_id: str,
    api_url: str,
    api_secret: str,
    new_name: str,
) -> dict:
    body = json.dumps(
        {
            "query": _MUTATION,
            "variables": {"id": agent_id, "input": {"name": new_name}},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/graphql",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_secret,
            "x-tenant-id": tenant_id,
            "x-agent-id": agent_id,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


@tool
def update_agent_name(new_name: str) -> str:
    """Rename yourself. This updates both the database record and your
    IDENTITY.md's Name line.

    You can only rename yourself — the tool cannot target any other
    agent. Your human can still rename you through the admin UI; this
    tool is an addition, not a replacement.

    Use this when your human explicitly asks you to change your name
    ("call yourself X", "from now on you're Y"). Do not rename yourself
    on your own initiative — your name is part of your identity and
    the human is the authority on it.

    Args:
        new_name: The new name. Must be non-empty after trimming. Any
            newlines in the name are collapsed to spaces server-side
            (the Name line in IDENTITY.md is a single-line bullet).

    Returns:
        A short confirmation string the agent can relay to the human,
        or an error description if the rename failed (in which case the
        agent's previous name is unchanged).
    """
    if not isinstance(new_name, str) or not new_name.strip():
        return "update_agent_name: name must be a non-empty string."

    tenant_id = os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
    agent_id = os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or ""
    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not (tenant_id and agent_id and api_url and api_secret):
        return "update_agent_name: runtime is missing tenant / agent / API config."

    try:
        payload = _post_graphql(tenant_id, agent_id, api_url, api_secret, new_name)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error") or str(e)
        except Exception:
            detail = str(e)
        logger.warning("update_agent_name HTTP error: %s", detail)
        return f"update_agent_name: rename failed ({detail})."
    except Exception as e:
        logger.warning("update_agent_name failed: %s", e)
        return f"update_agent_name: rename failed ({e})."

    errors = payload.get("errors")
    if errors:
        message = (errors[0] or {}).get("message") or "unknown error"
        return f"update_agent_name: rename failed ({message})."

    data = (payload.get("data") or {}).get("updateAgent")
    # Validate that the rename actually took by comparing the returned
    # name to what we requested — not just the id (authz would prevent a
    # wrong id anyway). Trimmed because server-side sanitization may have
    # collapsed leading/trailing whitespace.
    if not data:
        return "update_agent_name: unexpected response shape (empty data)."
    returned_name = (data.get("name") or "").strip()
    if returned_name != new_name.strip():
        return (
            f"update_agent_name: rename returned unexpected name "
            f"{returned_name!r} (requested {new_name.strip()!r})."
        )

    return f"update_agent_name: renamed to {data.get('name')!r}."
