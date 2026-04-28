"""
write_memory Strands tool — Plan §008 U12 (path parameter).

Lets the agent (parent or sub-agent) write to its agent-writable memory
notes from inside a tool call. The parameter is a **path string** validated
against a strict allowlist; sub-agents at ``{folder}/`` must compose
``{folder}/memory/{basename}.md`` themselves so the call lands at sub scope.

The path is **relative from the agent root** per Key Decisions §008
(line 165). Sub-agents do not get folder-context magic — pass the full
path. Master plan U12's unit-body language about "relative paths bind to
the sub-agent's folder" is overruled by the Key Decision.

Allowed paths match::

    ^([a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*){0,4}/)?memory/(lessons|preferences|contacts)\\.md$

Examples::

    memory/lessons.md                            (parent agent)
    expenses/memory/preferences.md               (depth-1 sub-agent)
    support/escalation/legal/case/memory/contacts.md   (depth-4 sub-agent)
    a/b/c/d/e/memory/lessons.md                  (depth-5 hard cap)

Validation runs **before** any network call, so adversarial inputs return
an operator-readable error in O(string-parse) time. Writes go through the
same /api/workspaces/files endpoint as everything else; the composer
handles cache invalidation so the next ``_ensure_workspace_ready`` pulls
the updated bytes.

ETag-guarded optimistic concurrency for memory writes is a separate
plan-008 follow-up (see Scope Boundaries in the U12 narrowed plan).
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
import urllib.error
import urllib.request

from skill_resolver import MAX_FOLDER_DEPTH, RESERVED_FOLDER_NAMES
from strands import tool
_WORKSPACE_DIR = os.environ.get("WORKSPACE_DIR", "/tmp/workspace")


def _mirror_locally(rel_path: str, content: str) -> None:
    """Write the same bytes to /tmp/workspace so within-turn reads in
    this same agent loop see the new memory file without re-syncing.

    Best-effort: failures here don't propagate. The server-side write
    has already succeeded by this point — local mirror is a within-turn
    optimization, and the next invocation's bootstrap reconciles either
    way.
    """
    try:
        local_path = os.path.join(_WORKSPACE_DIR, rel_path)
        parent = os.path.dirname(local_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(local_path, "w", encoding="utf-8") as fh:
            fh.write(content)
    except Exception as exc:  # pragma: no cover - best-effort
        logger.warning("write_memory local mirror failed on %s: %s", rel_path, exc)

logger = logging.getLogger(__name__)

# Three writable basenames — kept in sync with @thinkwork/workspace-defaults'
# AGENT_WRITABLE_MEMORY_BASENAMES. Enforced via regex alternation below.
_BASENAME_ALTERNATION = "lessons|preferences|contacts"

# Canonical-path regex. Anchors on both ends so suffix-extension attacks
# like "memory/lessons.md/foo" fail the match. The optional folder-prefix
# group allows up to 5 segments before the trailing memory/ directory,
# matching the U9 depth-5 cap from Key Decisions §008.
_CANONICAL_RE = re.compile(
    r"^([a-z0-9][a-z0-9-]*(?:/[a-z0-9][a-z0-9-]*){0,4}/)?"
    rf"memory/({_BASENAME_ALTERNATION})\.md$"
)

# Depth cap (Key Decisions §008): shared with delegate_to_workspace_tool via
# `skill_resolver.MAX_FOLDER_DEPTH`. Aliased here for the existing read sites
# in error messages.
_MAX_FOLDER_DEPTH = MAX_FOLDER_DEPTH


def _validate_memory_path(path: str | None) -> str:
    """Validate and NFKC-normalize a write_memory path.

    Returns the normalized path on success; raises :class:`ValueError`
    with an operator-readable message on any rejection. The validator is
    pure (no I/O) so adversarial inputs are rejected in O(string-parse)
    time and tests can exercise it without mocks.

    Rejection order (cheap → expensive):
        1. ``None`` / non-string / empty / whitespace-only
        2. Absolute (leading ``/``)
        3. Windows-style separator (``\\``)
        4. NFKC normalize, then check for ``..``, ``.``, ``//`` segments
        5. Regex match against the canonical pattern (depth bounded by
           the regex's ``{0,4}`` quantifier — at most 5 folder segments
           before ``memory/``)
        6. Folder-prefix segment-walk: reject any segment in
           ``RESERVED_FOLDER_NAMES`` (memory / skills as a *prefix* — the
           trailing ``memory/`` is consumed by the regex so it never
           enters this check)
    """
    if path is None:
        raise ValueError("write_memory path is empty")
    if not isinstance(path, str):
        raise ValueError(
            f"write_memory path must be a string, got {type(path).__name__}"
        )
    stripped = path.strip()
    if not stripped:
        raise ValueError("write_memory path is empty")
    if stripped.startswith("/"):
        raise ValueError(
            f"write_memory path {path!r}: absolute paths not allowed"
        )
    if "\\" in stripped:
        raise ValueError(
            f"write_memory path {path!r}: invalid OS separator (backslash)"
        )

    normalized = unicodedata.normalize("NFKC", stripped)

    # Traversal / dot-segment / double-slash checks operate on the
    # normalized form so a fullwidth dot doesn't slip past.
    segments = normalized.split("/")
    if ".." in segments:
        raise ValueError(
            f"write_memory path {path!r}: path traversal not allowed"
        )
    if "." in segments:
        raise ValueError(
            f"write_memory path {path!r}: path traversal segment '.'"
        )
    if "//" in normalized:
        raise ValueError(
            f"write_memory path {path!r}: invalid double slash (empty segment)"
        )

    match = _CANONICAL_RE.match(normalized)
    if not match:
        raise ValueError(
            f"write_memory path {path!r}: invalid path — must match "
            f"`(folder/)?memory/(lessons|preferences|contacts).md` from "
            f"the agent root, max depth {_MAX_FOLDER_DEPTH} folder "
            f"segments before memory/"
        )

    folder_prefix = match.group(1)  # e.g. "expenses/" or None
    if folder_prefix:
        # Depth is bounded by the regex's `{0,4}` quantifier — no need for
        # an explicit cap check here. Only reserved-name segment-walk runs
        # post-match; depth-6+ inputs already failed the regex above.
        for seg in folder_prefix.rstrip("/").split("/"):
            if seg in RESERVED_FOLDER_NAMES:
                raise ValueError(
                    f"write_memory path {path!r}: reserved folder name "
                    f"{seg!r} — only the trailing memory/ is allowed"
                )

    return normalized


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
def write_memory(path: str, content: str) -> str:
    """Append or replace an agent-writable memory note.

    The ``path`` is **relative from the agent root** — sub-agents must
    compose ``{folder}/memory/{basename}.md`` themselves. Allowed shapes::

        memory/lessons.md                  (parent / root)
        memory/preferences.md              (parent / root)
        memory/contacts.md                 (parent / root)
        expenses/memory/lessons.md         (sub-agent)
        support/escalation/memory/lessons.md   (nested sub-agent)

    The basename must be one of ``lessons.md``, ``preferences.md``,
    ``contacts.md``. There is at most a 5-segment folder prefix before
    the trailing ``memory/`` directory. Path traversal, absolute paths,
    Windows separators, dot-segments, double slashes, and reserved-name
    folder prefixes (``memory``, ``skills`` as folders, not as the
    canonical trailing memory/) are rejected before any network call.

    Args:
        path: Path from the agent root, e.g. ``"memory/lessons.md"`` for
            the parent agent or ``"expenses/memory/lessons.md"`` for a
            sub-agent rooted at ``expenses/``.
        content: The full new content for the file. This is a write, not
            an append — read the file first if you want to preserve prior
            entries.

    Returns:
        A short confirmation string the agent can relay back to the user
        on success, or an operator-readable rejection message on path
        validation failure.
    """
    try:
        rel_path = _validate_memory_path(path)
    except ValueError as exc:
        return f"write_memory: {exc}"

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

    try:
        _post_put(tenant_id, agent_id, rel_path, content, api_url, api_secret)
        _mirror_locally(rel_path, content)
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
