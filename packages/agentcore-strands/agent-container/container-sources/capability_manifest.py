"""Resolved Capability Manifest capture (plan §U15, part 2/3).

At the moment every agent session is about to hand its tool list to
``Agent(tools=...)``, call :func:`build_and_log` once with the fully
resolved state: the exact tools + skills + approved MCP servers the
session will see, plus the kill-switch / block inputs that narrowed
the list. The module does two things with that manifest:

1. **Structured CloudWatch log** — the durable observation. If the API
   POST fails (network hiccup, auth drift, API Lambda cold-start),
   the log line is still written and operators can reconstruct the
   session's capability surface from CloudWatch Insights.
2. **Best-effort POST to ``/api/runtime/manifests``** — persists the
   manifest to Aurora for admin-UI read-back (U15 part 2/3 exposes
   the read path; part 3 turns on SI-7 enforcement in
   ``Agent(tools=...)``). Failures here are logged + swallowed — the
   session must not block on manifest persistence.

Manifest shape is intentionally forward-compatible: the server stores
``manifest_json`` as opaque jsonb, and the admin UI renders whatever
keys the runtime emits. New fields can ship runtime-first without a
DB migration.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.request
from collections.abc import Iterable
from typing import Any

logger = logging.getLogger(__name__)

# Bump when the manifest shape changes in a way admins should care about
# (e.g. field renames, semantic shifts). Stored verbatim in the log +
# persisted row so downstream readers can version-gate their parsing.
MANIFEST_RUNTIME_VERSION = "v1.0.0"

# Best-effort POST — don't hang the session on API latency. The real
# durability story is the CloudWatch log above.
POST_TIMEOUT_SECONDS = 5


# ---------------------------------------------------------------------------
# Manifest construction
# ---------------------------------------------------------------------------


def _resolve_tool_name(tool: Any) -> str | None:
    """Best-effort slug extraction for a Strands tool callable.

    Matches the duck-typing in builtin_tool_filter — tools expose
    ``tool_name`` (Strands @tool decorator) or fall back to ``__name__``.
    """
    for attr in ("tool_name", "__name__"):
        value = getattr(tool, attr, None)
        if isinstance(value, str) and value:
            return value
    return None


def build_manifest(
    *,
    session_id: str,
    tenant_id: str,
    agent_id: str = "",
    template_id: str = "",
    user_id: str = "",
    tools: Iterable[Any] = (),
    skills: Iterable[dict[str, Any]] = (),
    mcp_servers: Iterable[dict[str, Any]] = (),
    workspace_files: Iterable[dict[str, Any]] = (),
    tenant_disabled_builtins: Iterable[str] = (),
    template_blocked_tools: Iterable[str] = (),
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the manifest struct that gets logged + posted.

    The caller passes the already-resolved state at ``Agent(tools=...)``
    construction — this function doesn't consult DB / env; it just
    normalizes shapes and adds the runtime metadata (version, timestamp).
    """
    tool_entries: list[dict[str, Any]] = []
    for t in tools:
        slug = _resolve_tool_name(t)
        if slug is None:
            continue
        tool_entries.append({"slug": slug})

    manifest: dict[str, Any] = {
        "session_id": session_id or "",
        "tenant_id": tenant_id or "",
        "agent_id": agent_id or "",
        "template_id": template_id or "",
        "user_id": user_id or "",
        "skills": [dict(s) for s in skills],
        "tools": tool_entries,
        "mcp_servers": [dict(m) for m in mcp_servers],
        "workspace_files": [dict(f) for f in workspace_files],
        "blocks": {
            "tenant_disabled_builtins": sorted(set(tenant_disabled_builtins)),
            "template_blocked_tools": sorted(set(template_blocked_tools)),
        },
        "runtime_version": MANIFEST_RUNTIME_VERSION,
        "timestamp": int(time.time()),
    }
    if extra:
        # Forward-compatible escape hatch for callers that want to add
        # fields without changing the signature (e.g. a future
        # integration_context block). We keep it on an explicit key so
        # an observer can distinguish runtime-core fields from extras.
        manifest["extra"] = dict(extra)
    return manifest


# ---------------------------------------------------------------------------
# Logging + POST
# ---------------------------------------------------------------------------


def log_manifest(manifest: dict[str, Any], *, prefix: str = "capability_manifest") -> None:
    """Emit the manifest as a single structured INFO line.

    CloudWatch Insights can parse this with
    ``@message LIKE '%capability_manifest%' | parse @message '* *'``. The
    prefix is kept short so the JSON payload wins the per-line byte
    budget.
    """
    try:
        payload = json.dumps(manifest, default=str)
    except (TypeError, ValueError) as err:
        # A value in the manifest (e.g. a bytes blob accidentally passed
        # through) isn't JSON-serializable. Don't drop the whole line —
        # log what we can reconstruct plus the error.
        logger.warning("%s serialize_failed err=%s", prefix, err)
        return
    logger.info("%s %s", prefix, payload)


def post_manifest(manifest: dict[str, Any]) -> bool:
    """Best-effort POST to /api/runtime/manifests.

    Reads ``THINKWORK_API_URL`` + ``API_AUTH_SECRET`` (or
    ``THINKWORK_API_SECRET``) from env per the existing runtime→API
    pattern (write_memory_tool, hindsight). Returns True when the
    response was 2xx, False on any failure — either way the caller
    continues; CloudWatch is the durable record.
    """
    api_url = os.environ.get("THINKWORK_API_URL") or ""
    api_secret = (
        os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or ""
    )
    if not api_url or not api_secret:
        logger.warning(
            "capability_manifest post_skipped reason=missing_env "
            "api_url_set=%s api_secret_set=%s",
            bool(api_url),
            bool(api_secret),
        )
        return False

    body = json.dumps(
        {
            "session_id": manifest.get("session_id", ""),
            "tenant_id": manifest.get("tenant_id", ""),
            "agent_id": manifest.get("agent_id") or None,
            "template_id": manifest.get("template_id") or None,
            "user_id": manifest.get("user_id") or None,
            "manifest_json": manifest,
        },
        default=str,
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/runtime/manifests",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=POST_TIMEOUT_SECONDS) as resp:
            status = resp.status
            if 200 <= status < 300:
                return True
            logger.warning(
                "capability_manifest post_failed status=%d", status,
            )
            return False
    except urllib.error.HTTPError as err:
        logger.warning(
            "capability_manifest post_failed status=%d err=%s",
            err.code,
            err.reason,
        )
        return False
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        logger.warning("capability_manifest post_failed err=%s", err)
        return False


def build_and_log(
    *,
    session_id: str,
    tenant_id: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """Convenience wrapper: build → log → best-effort POST.

    Callers pass the same kwargs as :func:`build_manifest`. Returns the
    constructed manifest so server.py can hold onto it (e.g. for
    diagnostics) without re-building.
    """
    manifest = build_manifest(session_id=session_id, tenant_id=tenant_id, **kwargs)
    log_manifest(manifest)
    # Swallow the POST result — log already captured the outcome. The
    # session must continue regardless so the agent turn doesn't block
    # on manifest persistence.
    post_manifest(manifest)
    return manifest
