"""Workspace memory (S3-backed) — replaces the workspace-memory MCP server."""

import json
import os

import boto3

BUCKET = os.environ.get("WORKSPACE_BUCKET", "")
TENANT_ID = os.environ.get("TENANT_ID", "")
AGENT_ID = os.environ.get("AGENT_ID", "")
REGION = os.environ.get("AWS_REGION", "us-east-1")

_s3 = boto3.client("s3", region_name=REGION)


def _prefix() -> str:
    """Build the S3 key prefix for this agent's workspace."""
    if not TENANT_ID or not AGENT_ID:
        raise ValueError("Workspace context not available (missing TENANT_ID or AGENT_ID)")
    if not BUCKET:
        raise ValueError("WORKSPACE_BUCKET not configured")
    return f"tenants/{TENANT_ID}/agents/{AGENT_ID}/workspace/"


def _regenerate_manifest() -> None:
    """Rebuild manifest.json so the runtime's ETag check detects the change."""
    import datetime

    prefix = _prefix()
    files = []
    token = None
    while True:
        kwargs = {"Bucket": BUCKET, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = _s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            rel = obj["Key"][len(prefix):]
            if not rel or rel == "manifest.json":
                continue
            files.append({
                "path": rel,
                "etag": obj.get("ETag", ""),
                "size": obj.get("Size", 0),
                "last_modified": obj["LastModified"].isoformat() if obj.get("LastModified") else "",
            })
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")

    manifest = {
        "version": 1,
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "files": files,
    }
    _s3.put_object(
        Bucket=BUCKET,
        Key=f"{prefix}manifest.json",
        Body=json.dumps(manifest),
        ContentType="application/json",
    )


def workspace_memory_write(path: str, content: str) -> str:
    """Write a structured note to workspace memory.

    Args:
        path: File path within workspace memory (must start with 'memory/').
        content: Full content to write (markdown format).

    Returns:
        JSON with written path and character count.
    """
    if not path.startswith("memory/"):
        return json.dumps({"error": f"workspace_memory_write can only write to paths starting with 'memory/'. Got: {path}"})

    key = _prefix() + path
    _s3.put_object(Bucket=BUCKET, Key=key, Body=content.encode("utf-8"), ContentType="text/plain; charset=utf-8")
    try:
        _regenerate_manifest()
    except Exception:
        pass  # Best-effort — writes must not fail due to manifest regen
    return json.dumps({"written": path, "chars": len(content)})


def workspace_memory_read(path: str) -> str:
    """Read a file from workspace memory.

    Args:
        path: File path to read (must start with 'memory/').

    Returns:
        JSON with path and content.
    """
    if not path.startswith("memory/"):
        return json.dumps({"error": f"workspace_memory_read can only read paths starting with 'memory/'. Got: {path}"})

    key = _prefix() + path
    try:
        resp = _s3.get_object(Bucket=BUCKET, Key=key)
        content = resp["Body"].read().decode("utf-8")
        return json.dumps({"path": path, "content": content or "(empty file)"})
    except _s3.exceptions.NoSuchKey:
        return json.dumps({"error": f"File not found: {path}"})
    except Exception as e:
        if "NoSuchKey" in str(type(e).__name__):
            return json.dumps({"error": f"File not found: {path}"})
        raise


def workspace_memory_list() -> str:
    """List all files in workspace memory folder.

    Returns:
        JSON with list of file paths relative to workspace root.
    """
    prefix = _prefix() + "memory/"
    files = []
    token = None

    while True:
        kwargs = {"Bucket": BUCKET, "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        resp = _s3.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            rel = obj["Key"][len(_prefix()):]
            files.append(rel)
        if not resp.get("IsTruncated"):
            break
        token = resp.get("NextContinuationToken")

    if not files:
        return json.dumps({"files": [], "message": "No memory files found."})
    return json.dumps({"files": files})
