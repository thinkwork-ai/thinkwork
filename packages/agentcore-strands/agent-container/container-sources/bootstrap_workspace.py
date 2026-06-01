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

import json
import logging
import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

logger = logging.getLogger(__name__)

# Operational artifacts that live alongside the agent's workspace files
# but should never land on local disk as if they were workspace content.
_SKIP_FILES = frozenset({"manifest.json", "_defaults_version"})
_HYDRATE_MANIFEST_PATH = ".hydrate_manifest.json"
_RENDERED_MARKER_PATH = ".rendered_at"


@dataclass(frozen=True)
class BootstrapResult:
    synced: int
    deleted: int
    total: int


@dataclass(frozen=True)
class _RemoteEntry:
    key: str
    rel: str


def _agent_prefix(tenant_slug: str, agent_slug: str) -> str:
    return f"tenants/{tenant_slug}/agents/{agent_slug}/workspace/"


def _normalize_prefix(prefix: str) -> str:
    if not prefix:
        return ""
    return prefix if prefix.endswith("/") else f"{prefix}/"


def _sync_prefix(
    *,
    tenant_slug: str,
    agent_slug: str,
    rendered_workspace_prefix: str = "",
    rendered_workspace_prefix_template: str = "",
) -> str:
    if rendered_workspace_prefix_template:
        normalized_rendered_prefix = _normalize_prefix(rendered_workspace_prefix)
        if normalized_rendered_prefix:
            return normalized_rendered_prefix
    return _agent_prefix(tenant_slug, agent_slug)


def _list_agent_keys(s3_client: S3Client, bucket: str, prefix: str) -> list[_RemoteEntry]:
    listed: list[_RemoteEntry] = []
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
            rel = key[len(prefix) :]
            if not rel:
                continue
            listed.append(_RemoteEntry(key=key, rel=rel))
        if resp.get("IsTruncated"):
            continuation = resp.get("NextContinuationToken")
            if not continuation:
                break
        else:
            break

    manifest = next((entry for entry in listed if entry.rel == _HYDRATE_MANIFEST_PATH), None)
    if manifest:
        resp = s3_client.get_object(Bucket=bucket, Key=manifest.key)
        manifest_text = resp["Body"].read().decode("utf-8")
        return _remote_entries_from_manifest(manifest_text)

    out: list[_RemoteEntry] = []
    for entry in listed:
        rel = _runtime_workspace_path(entry.rel)
        if rel and rel not in _SKIP_FILES:
            out.append(_RemoteEntry(key=entry.key, rel=rel))
    return out


def _remote_entries_from_manifest(manifest_text: str) -> list[_RemoteEntry]:
    parsed = json.loads(manifest_text)
    entries: dict[str, _RemoteEntry] = {}
    for file in parsed.get("files", []) or []:
        _add_manifest_entry(entries, file)
    for mount in parsed.get("statusMounts", []) or []:
        if mount.get("available") is True:
            _add_manifest_entry(entries, mount)
    return sorted(entries.values(), key=lambda entry: entry.rel)


def _add_manifest_entry(entries: dict[str, _RemoteEntry], item: dict) -> None:
    path = item.get("path")
    source_key = item.get("sourceKey")
    if not isinstance(path, str) or not isinstance(source_key, str):
        return
    rel = _runtime_workspace_path(path)
    if not rel or rel in _SKIP_FILES:
        return
    entries[rel] = _RemoteEntry(key=source_key, rel=rel)


def _runtime_workspace_path(path: str) -> str | None:
    clean = path.lstrip("/")
    if not clean or clean in {_HYDRATE_MANIFEST_PATH, _RENDERED_MARKER_PATH}:
        return None
    if _is_workspace_archives_path(clean):
        return None
    if clean.startswith("Agent/"):
        agent_path = _strip_legacy_source_root(clean[len("Agent/") :])
        if not agent_path or _is_workspace_archives_path(agent_path):
            return None
        return agent_path
    if clean.startswith("User/"):
        user_path = _strip_legacy_source_root(clean[len("User/") :])
        if not user_path or _is_workspace_archives_path(user_path):
            return None
        return f"User/{user_path}"
    if clean.startswith("Thread/"):
        thread_path = _strip_legacy_source_root(clean[len("Thread/") :])
        if not thread_path or _is_workspace_archives_path(thread_path):
            return None
        return f"Thread/{thread_path}"
    if clean.startswith("Spaces/"):
        if clean == "Spaces/INDEX.md":
            return clean
        parts = clean.split("/")
        if len(parts) < 3:
            return None
        space_path = _strip_legacy_source_root("/".join(parts[2:]))
        if not space_path or _is_workspace_archives_path(space_path):
            return None
        return f"Spaces/{parts[1]}/{space_path}"
    runtime_path = _strip_legacy_source_root(clean)
    if not runtime_path or _is_workspace_archives_path(runtime_path):
        return None
    return runtime_path


def _strip_legacy_source_root(path: str) -> str:
    current = path
    while current.startswith(("source/", "workspace/")):
        current = current.split("/", 1)[1]
    return current


def _is_workspace_archives_path(path: str) -> bool:
    return path == "workspace-archives" or path.startswith("workspace-archives/")


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
    s3_client: S3Client,
    bucket: str,
    rendered_workspace_prefix: str = "",
    rendered_workspace_prefix_template: str = "",
) -> BootstrapResult:
    """Sync the selected S3 prefix to ``local_dir``.

    - Lists the legacy agent workspace prefix unless rendered-prefix sync
      is enabled by ``rendered_workspace_prefix_template``.
    - Downloads every file (skipping manifest.json + _defaults_version).
    - Deletes any local files no longer present in S3.

    Returns ``BootstrapResult(synced, deleted, total)``. Raises on
    list / IAM failures so the caller can surface a structured error
    rather than letting the agent run against a stale tree.
    """
    prefix = _sync_prefix(
        tenant_slug=tenant_slug,
        agent_slug=agent_slug,
        rendered_workspace_prefix=rendered_workspace_prefix,
        rendered_workspace_prefix_template=rendered_workspace_prefix_template,
    )
    remote_entries = _list_agent_keys(s3_client, bucket, prefix)
    remote_set = {entry.rel for entry in remote_entries}

    os.makedirs(local_dir, exist_ok=True)
    local_set = _list_local_paths(local_dir)

    # Download remote → local. Plain overwrite — the prefix is the truth.
    synced = 0
    for entry in remote_entries:
        rel = entry.rel
        key = entry.key
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

    return BootstrapResult(synced=synced, deleted=deleted, total=len(remote_entries))


__all__ = ["bootstrap_workspace", "BootstrapResult"]
