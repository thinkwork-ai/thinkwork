"""
write_memory Strands tool (Unit 7).

Lets the agent append to its own memory/*.md working notes from inside a
tool call. Parameter is a basename *enum* — not a path — so there is no
string the model could escape via ``..``, an absolute path, or a
newline-injected second path segment. Strands' type system enforces the
Literal at the tool boundary; the server-side handler (Unit 5) also
validates `agentId` against the caller's tenant, so a cross-tenant write
is not reachable even if someone bypassed the enum.

Writes go through the same /api/workspaces/files endpoint as everything
else — the composer handles cache invalidation so the next
_ensure_workspace_ready pulls the updated bytes.
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

# The enum; also the only paths `write_memory` will ever target. Kept in
# sync with @thinkwork/workspace-defaults' AGENT_WRITABLE_MEMORY_BASENAMES.
MemoryBasename = Literal["lessons.md", "preferences.md", "contacts.md"]


def _post_put(tenant_id: str, agent_id: str, rel_path: str,
              content: str, api_url: str, api_secret: str) -> None:
    body = json.dumps({
        "action": "put",
        "agentId": agent_id,
        "path": rel_path,
        "content": content,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/workspaces/files",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_secret,
            "x-tenant-id": tenant_id,
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(f"write_memory: composer returned {payload.get('error')!r}")


@tool
def write_memory(name: MemoryBasename, content: str) -> str:
    """Append or replace an agent-writable memory note.

    Only three basenames are accepted: ``lessons.md``, ``preferences.md``,
    ``contacts.md``. There is no way to target any other file — the
    Literal type is enforced at the tool boundary, so attempts to pass an
    absolute path or a path with ``/`` are rejected before any network
    call.

    Args:
        name: One of ``"lessons.md"``, ``"preferences.md"``,
            ``"contacts.md"``. These files live under
            ``memory/`` in the agent's workspace.
        content: The full new content for the file. This is a write, not
            an append — read the file first if you want to preserve prior
            entries.

    Returns:
        A short confirmation string the agent can relay back to the user.
    """
    # Defensive second check — the Literal already rejects this, but a
    # caller using the tool dynamically (without Strands' validation)
    # shouldn't be able to bypass it.
    if name not in ("lessons.md", "preferences.md", "contacts.md"):
        return f"write_memory: '{name}' is not an accepted basename."

    tenant_id = os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
    agent_id = os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or ""
    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not (tenant_id and agent_id and api_url and api_secret):
        return "write_memory: runtime is missing tenant / agent / API config."

    rel_path = f"memory/{name}"
    try:
        _post_put(tenant_id, agent_id, rel_path, content, api_url, api_secret)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8")).get("error") or str(e)
        except Exception:
            detail = str(e)
        logger.warning("write_memory HTTP error on %s: %s", rel_path, detail)
        return f"write_memory: save failed ({detail})."
    except Exception as e:
        logger.warning("write_memory failed on %s: %s", rel_path, e)
        return f"write_memory: save failed ({e})."

    return f"write_memory: {rel_path} saved ({len(content)} chars)."
