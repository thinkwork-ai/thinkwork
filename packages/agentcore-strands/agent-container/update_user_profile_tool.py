"""
update_user_profile Strands tool.

Lets the agent update structured facts about its paired human — the
fields rendered into USER.md from the user_profiles table:

  - call_by  — short/preferred name ("Eric" vs the full "Eric Odom")
  - notes    — communication preferences, working style
  - family   — free-form markdown about family / close contacts
  - context  — ongoing topics, projects, situational color

Server-side this calls the `updateUserProfile` GraphQL mutation. The
mutation's authz layer requires that the calling agent (x-agent-id) is
paired with the target user (`human_pair_id == userId`), so this tool
can only touch the agent's own paired human.

After the DB update, the mutation fans out `writeUserMdForAssignment`
to every agent paired with that user inside the same transaction —
USER.md re-renders automatically with the new field value. An S3
failure rolls the DB update back.

Phone lives on `users.phone` (account-level contact info) and is NOT
editable through this tool. Your human updates that through the admin
UI.

Part of docs/plans/2026-04-22-003-feat-agent-self-serve-tools-plan.md.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Literal

from strands import tool

logger = logging.getLogger(__name__)

UserProfileField = Literal["call_by", "notes", "family", "context"]

# Safety cap on any single field write. The server doesn't enforce a
# length limit today, but a runaway agent writing 10MB of "context"
# would bloat every USER.md re-render.
_MAX_FIELD_LENGTH = 10_000

_FIELD_TO_INPUT_KEY: dict[str, str] = {
    "call_by": "callBy",
    "notes": "notes",
    "family": "family",
    "context": "context",
}

_MUTATION = """
mutation UpdateUserProfile($userId: ID!, $input: UpdateUserProfileInput!) {
  updateUserProfile(userId: $userId, input: $input) {
    id
    userId
    callBy
    notes
    family
    context
  }
}
""".strip()


def _post_graphql(
    tenant_id: str,
    agent_id: str,
    user_id: str,
    input_key: str,
    value: str,
    api_url: str,
    api_secret: str,
) -> dict:
    body = json.dumps(
        {
            "query": _MUTATION,
            "variables": {"userId": user_id, "input": {input_key: value}},
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
def update_user_profile(field: UserProfileField, value: str) -> str:
    """Update a structured fact about your paired human on their profile.

    Use this for facts you want durable — they persist across re-pair,
    survive template migrations, and re-render USER.md automatically.
    Rough guidance:

        - ``call_by``: the short name to use ("Eric", "Rick"). Update
          when the human says "call me X".
        - ``notes``: durable style notes ("prefers bullets under 5
          lines", "hates filler", "works in bursts").
        - ``family``: people in their life — names, relationships,
          contact (free-form markdown).
        - ``context``: ongoing topics — current project, recurring
          themes, situational color.

    For ephemeral chat-scoped notes, prefer `write_memory` → one of
    your `memory/*` files instead. This tool writes to the DB and
    should be reserved for facts worth keeping.

    Args:
        field: One of ``"call_by"``, ``"notes"``, ``"family"``,
            ``"context"``.
        value: The new value (can be empty to clear the field). Capped
            at 10,000 characters. Can contain markdown, including
            multi-line content for family / context.

    Returns:
        A short confirmation or error string.
    """
    if field not in _FIELD_TO_INPUT_KEY:
        return f"update_user_profile: '{field}' is not an editable field."
    if not isinstance(value, str):
        return "update_user_profile: value must be a string."
    if len(value) > _MAX_FIELD_LENGTH:
        return (
            "update_user_profile: value exceeds 10,000 characters. "
            "Shorten it or put long-form material in a memory/ file instead."
        )

    tenant_id = os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
    agent_id = os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or ""
    user_id = os.environ.get("USER_ID") or os.environ.get("_MCP_USER_ID") or ""
    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not (tenant_id and agent_id and api_url and api_secret):
        return "update_user_profile: runtime is missing tenant / agent / API config."
    if not user_id:
        return (
            "update_user_profile: this agent has no paired human yet — nothing "
            "to update."
        )

    input_key = _FIELD_TO_INPUT_KEY[field]
    try:
        payload = _post_graphql(
            tenant_id, agent_id, user_id, input_key, value, api_url, api_secret
        )
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error") or str(e)
        except Exception:
            detail = str(e)
        logger.warning("update_user_profile HTTP error on %s: %s", field, detail)
        return f"update_user_profile: save failed ({detail})."
    except Exception as e:
        logger.warning("update_user_profile failed on %s: %s", field, e)
        return f"update_user_profile: save failed ({e})."

    errors = payload.get("errors")
    if errors:
        message = (errors[0] or {}).get("message") or "unknown error"
        return f"update_user_profile: save failed ({message})."

    data = (payload.get("data") or {}).get("updateUserProfile")
    if not data:
        return "update_user_profile: unexpected response shape."

    return f"update_user_profile: {field} updated."
