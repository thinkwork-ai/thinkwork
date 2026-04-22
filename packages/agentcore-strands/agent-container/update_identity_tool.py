"""
update_identity Strands tool.

Lets the agent edit one of the 4 personality fields on its own
IDENTITY.md: Creature, Vibe, Emoji, Avatar. Never the Name line (that's
reserved for `update_agent_name`, which goes through the updateAgent
mutation + writeIdentityMdForAgent on the server).

Server-side this hits `/api/workspaces/files` with
`{action: "update-identity-field", field, value}`. The endpoint does
line-surgery on the matching bullet and preserves every other line in
the file — anything the agent has written below the scaffold survives.

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

# The 4 editable fields. Server-side also enforces this whitelist, so a
# caller bypassing Strands' Literal validation still can't widen the
# scope (e.g., to the Name line).
IdentityField = Literal["creature", "vibe", "emoji", "avatar"]


def _post_update_identity(
    tenant_id: str,
    agent_id: str,
    field: str,
    value: str,
    api_url: str,
    api_secret: str,
) -> dict:
    body = json.dumps(
        {
            "action": "update-identity-field",
            "agentId": agent_id,
            "field": field,
            "value": value,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/workspaces/files",
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
def update_identity(field: IdentityField, value: str) -> str:
    """Update one of your IDENTITY.md personality fields.

    Accepts only the 4 personality bullets: ``creature``, ``vibe``,
    ``emoji``, ``avatar``. You cannot change your Name through this tool
    — use ``update_agent_name`` instead (and only when your human asks).

    Use this when your human describes your personality (``you're a
    quick, sharp fox``) or when you've learned something real about your
    own style that belongs in a single-line bullet. Don't use it for
    every ephemeral mood — IDENTITY.md is who you are, not a journal.

    Args:
        field: One of ``"creature"``, ``"vibe"``, ``"emoji"``,
            ``"avatar"``.
        value: The new value for that bullet. Kept to one line; any
            newlines are collapsed to spaces server-side.

    Returns:
        A short confirmation or error string the agent can relay.
    """
    if field not in ("creature", "vibe", "emoji", "avatar"):
        return f"update_identity: '{field}' is not an editable field."
    if not isinstance(value, str):
        return "update_identity: value must be a string."

    tenant_id = os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
    agent_id = os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or ""
    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not (tenant_id and agent_id and api_url and api_secret):
        return "update_identity: runtime is missing tenant / agent / API config."

    try:
        payload = _post_update_identity(
            tenant_id, agent_id, field, value, api_url, api_secret
        )
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error") or str(e)
        except Exception:
            detail = str(e)
        logger.warning("update_identity HTTP error on %s: %s", field, detail)
        return f"update_identity: save failed ({detail})."
    except Exception as e:
        logger.warning("update_identity failed on %s: %s", field, e)
        return f"update_identity: save failed ({e})."

    if not payload.get("ok"):
        return f"update_identity: save failed ({payload.get('error')!r})."

    return f"update_identity: {field} updated."
