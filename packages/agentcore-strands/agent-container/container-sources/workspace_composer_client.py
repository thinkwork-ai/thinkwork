"""
Composer HTTP client + local disk sync (Unit 7).

Extracted from server.py so the workspace-bootstrap logic can be
exercised in unit tests without importing the full Strands agent
runtime (strands, boto3, nova_act, …).

The container calls this helper at `do_POST` time to replace what used
to be a direct S3 ListObjects + GetObject + PutObject dance.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.request

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# In-process short-TTL cache (Plan §004 U3)
# ────────────────────────────────────────────────────────────────────────────
#
# `delegate_to_workspace` calls `fetch_composed_workspace` on every spawn.
# At enterprise scale (4 enterprises × 100+ agents) the same parent agent
# can fan out N delegations in rapid succession; without a cache that's N
# round-trips through HTTP API + Lambda + S3.
#
# Mirror shape of the TS-side composer cache in
# `packages/api/src/lib/workspace-overlay.ts` (60s LRU): module-level dict
# keyed by `(tenant_id, agent_id)` with monotonic-clock timestamps and a
# threading.Lock for cross-thread safety. Values are returned by reference
# (callers MUST treat the result as read-only — `delegate_to_workspace`
# already does so via `list(files)` when building `resolved_context`).
#
# Snapshot pattern (per `feedback_completion_callback_snapshot_pattern`):
# this wrapper takes all config as positional arguments — no `os.environ`
# reads — so the caller controls invalidation by changing the cache key.

_COMPOSED_CACHE: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_COMPOSED_CACHE_LOCK = threading.Lock()


def fetch_composed_workspace(
    tenant_id: str,
    agent_id: str,
    api_url: str,
    api_secret: str,
    timeout_seconds: float = 15.0,
) -> list[dict]:
    """POST /api/workspaces/files and return [{path, source, sha256, content}].

    Raises on network / auth / protocol errors. Callers decide whether to
    fall back to the legacy direct-S3 sync (transitional) or surface the
    failure.
    """
    if not api_url or not api_secret or not tenant_id or not agent_id:
        raise RuntimeError(
            "composer fetch: missing api_url / api_secret / tenant_id / agent_id"
        )

    body = json.dumps({
        "action": "list",
        "agentId": agent_id,
        "includeContent": True,
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

    with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
        payload = json.loads(resp.read().decode("utf-8"))

    if not payload.get("ok"):
        raise RuntimeError(f"composer returned error: {payload.get('error')!r}")
    return payload.get("files") or []


def fetch_composed_workspace_cached(
    tenant_id: str,
    agent_id: str,
    api_url: str,
    api_secret: str,
    ttl_seconds: float = 30.0,
    timeout_seconds: float = 15.0,
) -> list[dict]:
    """Cached wrapper around :func:`fetch_composed_workspace`.

    Returns the cached value when ``(tenant_id, agent_id)`` was fetched
    within the last ``ttl_seconds`` seconds; otherwise calls through and
    stores the result. ``ttl_seconds=0`` disables the cache entirely
    (pass-through to :func:`fetch_composed_workspace`).

    The cache key intentionally excludes ``api_url`` / ``api_secret``
    because both are stage-scoped — the runtime never talks to two
    different composers in the same process. Callers in tests that
    do want strict isolation should call :func:`_reset_composed_cache`
    in their setUp.

    Time source is :func:`time.monotonic` so wall-clock skews don't
    leak through. Thread-safe via a module-level lock.
    """
    if ttl_seconds <= 0:
        return fetch_composed_workspace(
            tenant_id=tenant_id,
            agent_id=agent_id,
            api_url=api_url,
            api_secret=api_secret,
            timeout_seconds=timeout_seconds,
        )

    key = (tenant_id, agent_id)
    now = time.monotonic()
    with _COMPOSED_CACHE_LOCK:
        cached = _COMPOSED_CACHE.get(key)
        if cached is not None:
            cached_at, cached_files = cached
            if now - cached_at < ttl_seconds:
                return cached_files

    files = fetch_composed_workspace(
        tenant_id=tenant_id,
        agent_id=agent_id,
        api_url=api_url,
        api_secret=api_secret,
        timeout_seconds=timeout_seconds,
    )
    with _COMPOSED_CACHE_LOCK:
        _COMPOSED_CACHE[key] = (time.monotonic(), files)
    return files


def _reset_composed_cache() -> None:
    """Clear the in-process cache. Test-only — production has no caller."""
    with _COMPOSED_CACHE_LOCK:
        _COMPOSED_CACHE.clear()


def write_composed_to_dir(files: list[dict], workspace_dir: str) -> int:
    """Write each composed file to workspace_dir/{path}. Returns count written.

    Missing or empty `content` fields are skipped — the composer only
    omits `content` when `includeContent=false` was passed, which is not
    the bootstrap path.
    """
    os.makedirs(workspace_dir, exist_ok=True)
    written = 0
    for f in files:
        rel_path = (f.get("path") or "").lstrip("/")
        content = f.get("content")
        if not rel_path or content is None:
            continue
        local_path = os.path.join(workspace_dir, rel_path)
        parent = os.path.dirname(local_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(local_path, "w") as fh:
            fh.write(content)
        written += 1
    return written


def compute_fingerprint(files: list[dict]) -> str:
    """Stable hash of the {path, sha256} set for warm-cache skip semantics."""
    fingerprint_input = "|".join(
        f"{f.get('path','')}:{f.get('sha256','')}" for f in files
    )
    return str(hash(fingerprint_input))
