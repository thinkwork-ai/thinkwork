"""Download skills from S3 to /app/skills/.

Skills are loaded per-request via the `skills` payload field. Each invocation
includes a list of {skillId, s3Key} entries pointing to the agent's S3
prefix (tenants/{tenantSlug}/agents/{agentSlug}/skills/{slug}/). The runtime
calls install_skill_from_s3() for each skill before building the system prompt.

The startup install_skills() is a no-op — it only creates the local
directory. The old skills/v1/ global catalog prefix is no longer used.
"""
import logging
import os

AWS_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1"))

logger = logging.getLogger(__name__)

AGENTCORE_FILES_BUCKET = os.environ.get("AGENTCORE_FILES_BUCKET", "")
SKILLS_DIR = "/tmp/skills"


def install_skills():
    """Prepare the local skills directory. Skills are loaded per-request."""
    os.makedirs(SKILLS_DIR, exist_ok=True)
    logger.info("Skills directory ready: %s (loaded per-request from tenant S3 prefix)", SKILLS_DIR)


WORKSPACE_DIR = "/tmp/workspace"

# ETag cache for manifest-based incremental sync
_etag_cache: dict[str, str] = {}


def _try_manifest_sync(s3, bucket: str, prefix: str,
                       file_filter: set[str] | None, filter_dirs: list[str],
                       workspace_dir: str | None = None) -> int | None:
    """Attempt manifest-based incremental sync. Returns file count or None if no manifest."""
    import json as _json

    target_dir = workspace_dir or WORKSPACE_DIR

    manifest_key = f"{prefix}manifest.json"
    try:
        resp = s3.get_object(Bucket=bucket, Key=manifest_key)
        manifest = _json.loads(resp["Body"].read().decode("utf-8"))
    except s3.exceptions.NoSuchKey:
        return None
    except Exception as e:
        logger.warning("Failed to read manifest, falling back to full sync: %s", e)
        return None

    files = manifest.get("files", [])
    count = 0

    for entry in files:
        rel_path = entry.get("path", "")
        etag = entry.get("etag", "")
        if not rel_path or rel_path == "manifest.json":
            continue

        # Apply filter if provided
        if file_filter is not None:
            if rel_path not in file_filter:
                if not any(rel_path.startswith(d) for d in filter_dirs):
                    continue

        # Skip if ETag matches local cache (file unchanged)
        cache_key = f"{prefix}{rel_path}"
        if cache_key in _etag_cache and _etag_cache[cache_key] == etag:
            local_path = os.path.join(target_dir, rel_path)
            if os.path.isfile(local_path):
                continue

        # Download file
        s3_key = f"{prefix}{rel_path}"
        local_path = os.path.join(target_dir, rel_path)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        s3.download_file(bucket, s3_key, local_path)
        _etag_cache[cache_key] = etag
        count += 1

    return count


def install_workspace(tenant_id: str, assistant_id: str,
                      file_filter: list[str] | None = None,
                      workspace_dir: str | None = None):
    """Download per-assistant workspace files from S3.

    Args:
        tenant_id: Tenant slug or ID for S3 prefix.
        assistant_id: Agent slug or ID for S3 prefix.
        file_filter: Optional list of relative paths to download. If provided,
            only these files (plus ROUTER.md which is always needed) are synced.
            Paths ending in / match all files under that directory.
            If None, all workspace files are downloaded (backward compatible).
        workspace_dir: Target directory for downloaded files. Defaults to WORKSPACE_DIR.
    """
    bucket = os.environ.get("AGENTCORE_FILES_BUCKET", "")
    if not bucket or not tenant_id or not assistant_id:
        return

    target_dir = workspace_dir or WORKSPACE_DIR

    import boto3

    s3 = boto3.client("s3", region_name=AWS_REGION)
    prefix = f"tenants/{tenant_id}/agents/{assistant_id}/workspace/"
    os.makedirs(target_dir, exist_ok=True)

    # Build filter set for selective download
    filter_set: set[str] | None = None
    filter_dirs: list[str] = []
    if file_filter is not None:
        filter_set = set()
        # Always include ROUTER.md so the parser can read it
        filter_set.add("ROUTER.md")
        for f in file_filter:
            if f.endswith("/"):
                filter_dirs.append(f)
            else:
                filter_set.add(f)

    # Try manifest-based incremental sync first
    manifest_count = _try_manifest_sync(s3, bucket, prefix, filter_set, filter_dirs,
                                         workspace_dir=target_dir)
    if manifest_count is not None:
        logger.info("Workspace synced (manifest): %d files downloaded from s3://%s/%s → %s",
                    manifest_count, bucket, prefix, target_dir)
        return

    # Fallback: full ListObjects + download
    paginator = s3.get_paginator("list_objects_v2")
    count = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            rel_path = key[len(prefix):]
            if not rel_path or rel_path == "manifest.json":
                continue

            # Apply filter if provided
            if filter_set is not None:
                if rel_path not in filter_set:
                    # Check if it falls under a directory filter
                    if not any(rel_path.startswith(d) for d in filter_dirs):
                        continue

            local_path = os.path.join(target_dir, rel_path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            s3.download_file(bucket, key, local_path)
            count += 1

    if file_filter is not None:
        logger.info("Workspace synced (selective, no manifest): %d files from s3://%s/%s → %s (filter: %d entries)",
                    count, bucket, prefix, target_dir, len(file_filter))
    else:
        logger.info("Workspace synced (full, no manifest): %d files from s3://%s/%s → %s",
                    count, bucket, prefix, target_dir)


SYSTEM_WORKSPACE_DIR = "/tmp/workspace-defaults"
_system_workspace_loaded = False


def install_system_workspace():
    """Download system workspace files from S3 (once per container lifetime)."""
    global _system_workspace_loaded
    if _system_workspace_loaded:
        return

    bucket = os.environ.get("AGENTCORE_FILES_BUCKET", "")
    if not bucket:
        return

    import boto3

    os.makedirs(SYSTEM_WORKSPACE_DIR, exist_ok=True)
    s3 = boto3.client("s3", region_name=AWS_REGION)
    prefix = "system/workspace/"
    paginator = s3.get_paginator("list_objects_v2")
    count = 0
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            rel_path = key[len(prefix):]
            if not rel_path:
                continue
            local_path = os.path.join(SYSTEM_WORKSPACE_DIR, rel_path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            s3.download_file(bucket, key, local_path)
            count += 1

    _system_workspace_loaded = True
    logger.info("System workspace synced: %d files from s3://%s/%s", count, bucket, prefix)


def install_skill_from_s3(s3_key: str, skill_id: str):
    """Download a specific skill from S3 to /app/skills/{skill_id}/."""
    bucket = os.environ.get("AGENTCORE_FILES_BUCKET", "")
    if not bucket:
        return

    import boto3

    s3 = boto3.client("s3", region_name=AWS_REGION)
    prefix = f"{s3_key}/"
    skill_dir = os.path.join(SKILLS_DIR, skill_id)
    os.makedirs(skill_dir, exist_ok=True)

    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            rel_path = key[len(prefix):]
            if not rel_path:
                continue
            local_path = os.path.join(skill_dir, rel_path)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            s3.download_file(bucket, key, local_path)
