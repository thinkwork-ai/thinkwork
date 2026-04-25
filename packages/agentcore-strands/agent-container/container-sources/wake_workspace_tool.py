"""``wake_workspace`` Strands tool for async folder-addressed work."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable

from workspace_target import parse_target

try:
    from strands import tool
except ModuleNotFoundError:  # unit tests run without the full Strands runtime
    def tool(fn):
        return fn


def _post_json(api_url: str, api_secret: str, tenant_id: str, agent_id: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/workspaces/orchestration/write",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_secret,
            "x-tenant-id": tenant_id,
            "x-agent-id": agent_id,
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def make_wake_workspace_fn(
    *,
    tenant_id: str,
    agent_id: str,
    api_url: str,
    api_secret: str,
    agents_md_routes: Iterable[str],
    post_json: Callable[[str, str, str, str, dict], dict] = _post_json,
):
    """Build a validated ``wake_workspace`` callable.

    Environment values are captured by the caller before the function is
    created, following the snapshot-at-coroutine-entry pattern used by other
    runtime tools.
    """

    route_list = list(agents_md_routes)

    @tool
    def wake_workspace(
        target: str,
        request_md: str,
        reason: str | None = None,
        idempotency_key: str | None = None,
        wait_for_result: bool = False,
    ) -> str:
        """Wake a folder-addressed agent context asynchronously.

        Use this for long-running specialist work, work that may need human
        review, or work that should resume the current run later. Use
        ``delegate`` / ``delegate_to_workspace`` when the result is needed in
        the current turn.
        """

        parsed = parse_target(target, route_list)
        if not parsed.valid:
            return f"wake_workspace: invalid target ({parsed.reason})."
        if not request_md or not request_md.strip():
            return "wake_workspace: request_md is required."
        if not (tenant_id and agent_id and api_url and api_secret):
            return "wake_workspace: runtime is missing tenant / agent / API config."

        body = {
            "action": "wake_workspace",
            "agentId": agent_id,
            "targetPath": parsed.normalized_path,
            "requestMd": request_md,
            "waitForResult": wait_for_result,
        }
        if reason:
            body["reason"] = reason
        if idempotency_key:
            body["idempotencyKey"] = idempotency_key

        try:
            payload = post_json(api_url, api_secret, tenant_id, agent_id, body)
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8")).get("error") or str(exc)
            except Exception:
                detail = str(exc)
            return f"wake_workspace: write failed ({detail})."
        except Exception as exc:
            return f"wake_workspace: write failed ({exc})."

        if not payload.get("ok"):
            return f"wake_workspace: write failed ({payload.get('error')!r})."
        source_key = payload.get("sourceObjectKey") or payload.get("key")
        if source_key:
            return f"wake_workspace: queued {source_key}."
        return "wake_workspace: queued."

    return wake_workspace


def make_wake_workspace_from_env():
    routes = [
        item.strip()
        for item in (os.environ.get("WORKSPACE_ROUTE_TARGETS") or "").split(",")
        if item.strip()
    ]
    if not routes:
        try:
            from agents_md_parser import parse_agents_md

            with open("/tmp/workspace/AGENTS.md") as fh:
                ctx = parse_agents_md(fh.read())
            routes = [row.go_to.rstrip("/") for row in ctx.routing]
        except Exception:
            routes = []
    return make_wake_workspace_fn(
        tenant_id=os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or "",
        agent_id=os.environ.get("AGENT_ID") or os.environ.get("_MCP_AGENT_ID") or "",
        api_url=os.environ.get("THINKWORK_API_URL") or "",
        api_secret=os.environ.get("API_AUTH_SECRET")
        or os.environ.get("THINKWORK_API_SECRET")
        or "",
        agents_md_routes=routes,
        post_json=_post_json,
    )
