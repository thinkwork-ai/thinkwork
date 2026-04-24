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
import urllib.request


logger = logging.getLogger(__name__)


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
