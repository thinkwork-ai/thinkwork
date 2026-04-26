"""User-scoped workspace storage helpers.

The agent runtime already receives tenant and user ids from the invocation
payload. This module turns those ids into the one S3 key the runtime may read
for distilled user knowledge:

    tenants/{tenant_id}/users/{user_id}/knowledge-pack.md

Missing packs are normal on first boot and return ``None`` without noise.
Transient S3 errors are logged and also return ``None`` so a pack outage never
blocks the agent turn.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class PackResult:
    body: str
    etag: str
    last_modified: datetime | None = None


def user_knowledge_pack_key(tenant_id: str, user_id: str) -> str:
    """Return the canonical user-scoped pack key or raise on unsafe ids."""
    if not _SAFE_ID_RE.match(tenant_id or ""):
        raise ValueError("tenant_id contains unsupported characters")
    if not _SAFE_ID_RE.match(user_id or ""):
        raise ValueError("user_id contains unsupported characters")
    return f"tenants/{tenant_id}/users/{user_id}/knowledge-pack.md"


def get_user_knowledge_pack(
    tenant_id: str,
    user_id: str,
    *,
    bucket: str | None = None,
    s3_client: Any | None = None,
) -> PackResult | None:
    """Fetch the rendered user knowledge pack from S3.

    Returns ``None`` when ids, bucket, or object are missing. Raises only for
    local programmer errors such as unsafe ids; S3 service failures are logged
    and suppressed because the pack is an optimization over source-of-truth
    memory/wiki tools.
    """
    if not tenant_id or not user_id:
        logger.info(
            "user_knowledge_pack skipped reason=missing_scope tenant_id=%s user_id_present=%s",
            tenant_id,
            bool(user_id),
        )
        return None

    try:
        key = user_knowledge_pack_key(tenant_id, user_id)
    except ValueError as exc:
        logger.warning("user_knowledge_pack skipped reason=invalid_scope error=%s", exc)
        return None

    resolved_bucket = bucket or os.environ.get("WORKSPACE_BUCKET") or ""
    if not resolved_bucket:
        logger.info("user_knowledge_pack skipped reason=missing_bucket")
        return None

    client = s3_client
    if client is None:
        import boto3

        client = boto3.client("s3")

    try:
        resp = client.get_object(Bucket=resolved_bucket, Key=key)
    except Exception as exc:  # noqa: BLE001 - supports botocore without hard import
        code = _error_code(exc)
        if code in {"NoSuchKey", "404", "NotFound"}:
            logger.info(
                "user_knowledge_pack miss tenant_id=%s user_id=%s key=%s",
                tenant_id,
                user_id,
                key,
            )
            return None
        logger.warning(
            "user_knowledge_pack fetch_failed tenant_id=%s user_id=%s key=%s error=%s",
            tenant_id,
            user_id,
            key,
            exc,
        )
        return None

    body_obj = resp.get("Body")
    raw = body_obj.read() if hasattr(body_obj, "read") else body_obj
    if isinstance(raw, bytes):
        body = raw.decode("utf-8", errors="replace")
    else:
        body = str(raw or "")
    if not body.strip():
        return None

    return PackResult(
        body=body,
        etag=str(resp.get("ETag") or "").strip('"'),
        last_modified=resp.get("LastModified"),
    )


def _error_code(exc: Exception) -> str:
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        if isinstance(error, dict) and error.get("Code"):
            return str(error["Code"])
        metadata = response.get("ResponseMetadata")
        if isinstance(metadata, dict) and metadata.get("HTTPStatusCode"):
            return str(metadata["HTTPStatusCode"])
    return exc.__class__.__name__
