"""Artifact management via Aurora RDS Data API — replaces the artifacts MCP server."""

import json
import os

import boto3

# RDS Data API configuration (injected by AgentCore environment)
CLUSTER_ARN = os.environ.get("DATABASE_CLUSTER_ARN", "")
SECRET_ARN = os.environ.get("DATABASE_SECRET_ARN", "")
DATABASE = os.environ.get("DATABASE_NAME", "thinkwork")
TENANT_ID = os.environ.get("TENANT_ID", "")
AGENT_ID = os.environ.get("AGENT_ID", "")
THREAD_ID = os.environ.get("CURRENT_THREAD_ID", "")

_rds = boto3.client("rds-data", region_name=os.environ.get("AWS_REGION", "us-east-1"))


def _execute(sql: str, params: list[dict]) -> dict:
    """Execute SQL via RDS Data API."""
    return _rds.execute_statement(
        resourceArn=CLUSTER_ARN,
        secretArn=SECRET_ARN,
        database=DATABASE,
        sql=sql,
        parameters=params,
        formatRecordsAs="JSON",
    )


def create_artifact(
    title: str,
    type: str,
    content: str,
    status: str = "final",
    summary: str = "",
    thread_id: str = "",
    source_message_id: str = "",
) -> str:
    """Create a durable artifact from agent output.

    Args:
        title: Descriptive title for the artifact.
        type: One of: data_view, note, report, plan, draft, digest.
        content: Full markdown content.
        status: draft, final, or superseded (default: final).
        summary: Short plain-text summary (1-2 sentences).
        thread_id: UUID of related thread.
        source_message_id: UUID of triggering message.

    Returns:
        JSON with the created artifact's id, title, type, status, and created_at.
    """
    tid = thread_id or THREAD_ID or None
    sql = """
        INSERT INTO artifacts (tenant_id, agent_id, thread_id, title, type, status, content, summary, source_message_id)
        VALUES (:tenant_id::uuid, :agent_id::uuid, :thread_id::uuid, :title, :type, :status, :content, :summary, :source_msg::uuid)
        RETURNING id, title, type, status, created_at
    """
    params = [
        {"name": "tenant_id", "value": {"stringValue": TENANT_ID}},
        {"name": "agent_id", "value": {"stringValue": AGENT_ID} if AGENT_ID else {"isNull": True}},
        {"name": "thread_id", "value": {"stringValue": tid} if tid else {"isNull": True}},
        {"name": "title", "value": {"stringValue": title}},
        {"name": "type", "value": {"stringValue": type}},
        {"name": "status", "value": {"stringValue": status}},
        {"name": "content", "value": {"stringValue": content}},
        {"name": "summary", "value": {"stringValue": summary} if summary else {"isNull": True}},
        {"name": "source_msg", "value": {"stringValue": source_message_id} if source_message_id else {"isNull": True}},
    ]
    result = _execute(sql, params)
    records = json.loads(result.get("formattedRecords", "[]"))
    return json.dumps(records[0] if records else {"error": "Insert failed"}, indent=2)


def update_artifact(
    artifact_id: str,
    title: str = "",
    content: str = "",
    status: str = "",
    summary: str = "",
) -> str:
    """Update an existing artifact.

    Args:
        artifact_id: UUID of artifact to update.
        title: New title (optional).
        content: New content (optional).
        status: New status: draft, final, superseded (optional).
        summary: New summary (optional).

    Returns:
        JSON with updated artifact's id, title, type, status, and updated_at.
    """
    sets = ["updated_at = now()"]
    params = [
        {"name": "id", "value": {"stringValue": artifact_id}},
        {"name": "tenant_id", "value": {"stringValue": TENANT_ID}},
    ]
    if title:
        sets.append("title = :title")
        params.append({"name": "title", "value": {"stringValue": title}})
    if content:
        sets.append("content = :content")
        params.append({"name": "content", "value": {"stringValue": content}})
    if status:
        sets.append("status = :status")
        params.append({"name": "status", "value": {"stringValue": status}})
    if summary:
        sets.append("summary = :summary")
        params.append({"name": "summary", "value": {"stringValue": summary}})

    sql = f"""
        UPDATE artifacts SET {', '.join(sets)}
        WHERE id = :id::uuid AND tenant_id = :tenant_id::uuid
        RETURNING id, title, type, status, updated_at
    """
    result = _execute(sql, params)
    records = json.loads(result.get("formattedRecords", "[]"))
    if not records:
        return json.dumps({"error": "Artifact not found or access denied"})
    return json.dumps(records[0], indent=2)


def list_artifacts(
    type: str = "",
    thread_id: str = "",
    status: str = "",
    limit: int = 10,
) -> str:
    """List artifacts for the current tenant with optional filters.

    Args:
        type: Filter by type (data_view, note, report, plan, draft, digest).
        thread_id: Filter by thread UUID.
        status: Filter by status (draft, final, superseded).
        limit: Max results (1-50, default 10).

    Returns:
        JSON array of artifacts with id, title, type, status, summary, created_at, updated_at.
    """
    conditions = ["tenant_id = :tenant_id::uuid"]
    params = [{"name": "tenant_id", "value": {"stringValue": TENANT_ID}}]

    if AGENT_ID:
        conditions.append("agent_id = :agent_id::uuid")
        params.append({"name": "agent_id", "value": {"stringValue": AGENT_ID}})
    if type:
        conditions.append("type = :type")
        params.append({"name": "type", "value": {"stringValue": type}})
    if thread_id:
        conditions.append("thread_id = :thread_id::uuid")
        params.append({"name": "thread_id", "value": {"stringValue": thread_id}})
    if status:
        conditions.append("status = :status")
        params.append({"name": "status", "value": {"stringValue": status}})

    safe_limit = max(1, min(limit, 50))
    sql = f"""
        SELECT id, title, type, status, summary, thread_id, created_at, updated_at
        FROM artifacts
        WHERE {' AND '.join(conditions)}
        ORDER BY created_at DESC
        LIMIT {safe_limit}
    """
    result = _execute(sql, params)
    records = json.loads(result.get("formattedRecords", "[]"))
    return json.dumps(records, indent=2)
