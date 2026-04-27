"""Workspace bootstrap — flat S3 sync of the agent's prefix to local disk.

Per docs/plans/2026-04-27-003 (materialize-at-write-time): the runtime
reads only the agent's S3 prefix. There is no overlay walk, no template
fallback, no read-time substitution. Bootstrap is "list the prefix,
download every file."

Called on every invocation (cold and warm) so operator edits propagate
on the next turn without any cache-invalidation choreography. A typical
agent has ~10-50 small markdown files; the per-invocation cost is one
ListObjectsV2 + N GetObject calls, both region-local. If profiling later
shows this matters, we can layer ETag-conditional GETs on top — but the
contract under test stays "just sync the prefix."

All config takes positional args — no `os.environ` reads inside —
per `feedback_completion_callback_snapshot_pattern`. Caller (server.py)
snapshots env at request entry.
"""

from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

logger = logging.getLogger(__name__)

# Operational artifacts that live alongside the agent's workspace files
# but should never land on local disk as if they were workspace content.
_SKIP_FILES = frozenset({"manifest.json", "_defaults_version"})


@dataclass(frozen=True)
class BootstrapResult:
    synced: int
    deleted: int
    total: int


def _agent_prefix(tenant_slug: str, agent_slug: str) -> str:
    return f"tenants/{tenant_slug}/agents/{agent_slug}/workspace/"


def _list_agent_keys(s3_client: "S3Client", bucket: str, prefix: str) -> list[str]:
    out: list[str] = []
    continuation: str | None = None
    while True:
        params: dict = {"Bucket": bucket, "Prefix": prefix}
        if continuation:
            params["ContinuationToken"] = continuation
        resp = s3_client.list_objects_v2(**params)
        for obj in resp.get("Contents", []) or []:
            key = obj.get("Key")
            if not key:
                continue
            rel = key[len(prefix):]
            if not rel or rel in _SKIP_FILES:
                continue
            out.append(rel)
        if resp.get("IsTruncated"):
            continuation = resp.get("NextContinuationToken")
            if not continuation:
                break
        else:
            break
    return out


def _list_local_paths(local_dir: str) -> set[str]:
    """Walk local_dir and return relative paths of regular files."""
    found: set[str] = set()
    if not os.path.isdir(local_dir):
        return found
    for root, _dirs, files in os.walk(local_dir):
        for name in files:
            abs_path = os.path.join(root, name)
            rel = os.path.relpath(abs_path, local_dir)
            # Cross-platform: normalize to forward slashes since S3 keys
            # use forward slashes regardless of OS.
            rel = rel.replace(os.sep, "/")
            found.add(rel)
    return found


def bootstrap_workspace(
    tenant_slug: str,
    agent_slug: str,
    local_dir: str,
    s3_client: "S3Client",
    bucket: str,
) -> BootstrapResult:
    """Sync the agent's S3 prefix to ``local_dir``.

    - Lists ``tenants/{tenant_slug}/agents/{agent_slug}/workspace/``.
    - Downloads every file (skipping manifest.json + _defaults_version).
    - Deletes any local files no longer present in S3.

    Returns ``BootstrapResult(synced, deleted, total)``. Raises on
    list / IAM failures so the caller can surface a structured error
    rather than letting the agent run against a stale tree.
    """
    prefix = _agent_prefix(tenant_slug, agent_slug)
    remote_keys = _list_agent_keys(s3_client, bucket, prefix)
    remote_set = set(remote_keys)

    os.makedirs(local_dir, exist_ok=True)
    local_set = _list_local_paths(local_dir)

    # Download remote → local. Plain overwrite — the prefix is the truth.
    synced = 0
    for rel in remote_keys:
        key = prefix + rel
        local_path = os.path.join(local_dir, rel)
        parent = os.path.dirname(local_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        try:
            resp = s3_client.get_object(Bucket=bucket, Key=key)
            body = resp["Body"].read()
            with open(local_path, "wb") as fh:
                fh.write(body)
            synced += 1
        except Exception:  # pragma: no cover - exercised in container tests
            logger.exception("[bootstrap_workspace] failed to fetch %s", key)
            raise

    # Delete locals that are no longer in S3.
    deleted = 0
    for rel in local_set - remote_set:
        local_path = os.path.join(local_dir, rel)
        try:
            os.remove(local_path)
            deleted += 1
        except FileNotFoundError:
            pass

    # Best-effort empty-directory cleanup so deletions don't leave orphan dirs.
    for root, dirs, files in os.walk(local_dir, topdown=False):
        if root == local_dir:
            continue
        if not files and not dirs:
            try:
                os.rmdir(root)
            except OSError:
                pass

    return BootstrapResult(synced=synced, deleted=deleted, total=len(remote_keys))


__all__ = ["bootstrap_workspace", "BootstrapResult"]
