"""Thinkwork Context Engine built-in tool.

Calls the API-owned ThinkWork Brain MCP facade with service credentials so
Strands uses the same provider router and normalized result shape as Pi and
external MCP clients.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable
from typing import Any
from urllib.request import Request, urlopen


def _resolve_endpoint() -> tuple[str | None, str | None]:
    url = os.environ.get("THINKWORK_API_URL") or ""
    secret = os.environ.get("THINKWORK_API_SECRET") or os.environ.get("API_AUTH_SECRET") or ""
    if not url or not secret:
        return None, None
    return url.rstrip("/") + "/mcp/context-engine", secret


async def _json_rpc(method: str, params: dict[str, Any]) -> dict[str, Any] | str:
    url, secret = _resolve_endpoint()
    if not url or not secret:
        return "Context Engine is not enabled for this deployment yet."

    tenant_id = os.environ.get("TENANT_ID") or os.environ.get("_MCP_TENANT_ID") or ""
    user_id = os.environ.get("USER_ID") or os.environ.get("CURRENT_USER_ID") or ""
    agent_id = os.environ.get("_ASSISTANT_ID") or ""
    if not tenant_id or not user_id:
        return "Context Engine is missing tenant/user identity for this turn."

    body = {
        "jsonrpc": "2.0",
        "id": "strands-query-context",
        "method": method,
        "params": params,
    }

    def _post() -> dict[str, Any] | str:
        req = Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {secret}",
                "x-tenant-id": tenant_id,
                "x-user-id": user_id,
                "x-agent-id": agent_id,
            },
            method="POST",
        )
        with urlopen(req, timeout=20) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
        if payload.get("error"):
            return f"Context Engine failed: {payload['error'].get('message', 'unknown error')}"
        return payload.get("result") or {}

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _post)


def make_context_engine_tool(strands_tool: Callable[[Any], Any]):
    @strands_tool
    async def query_context(
        query: str,
        mode: str = "results",
        scope: str = "auto",
        depth: str = "quick",
        limit: int = 10,
        provider_ids: list[str] | None = None,
        provider_families: list[str] | None = None,
    ) -> str:
        """Search Thinkwork Context Engine across fast default providers.

        Use this first for ordinary agent context lookup across wiki,
        workspace files, knowledge bases, and approved search-safe MCP tools.
        Use query_memory_context only when raw Hindsight Memory is needed.
        """

        clean_query = (query or "").strip()
        if not clean_query:
            return "query_context requires a non-empty query."
        providers: dict[str, Any] = {}
        if provider_ids:
            providers["ids"] = provider_ids
        if provider_families:
            providers["families"] = provider_families

        result = await _json_rpc(
            "tools/call",
            {
                "name": "query_context",
                "arguments": {
                    "query": clean_query,
                    "mode": mode if mode in ("results", "answer") else "results",
                    "scope": scope if scope in ("personal", "team", "auto") else "auto",
                    "depth": depth if depth in ("quick", "deep") else "quick",
                    "limit": max(1, min(int(limit or 10), 50)),
                    **({"providers": providers} if providers else {}),
                },
            },
        )
        if isinstance(result, str):
            return result
        content = result.get("content") or []
        text = "\n".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        ).strip()
        if text:
            return text
        return json.dumps(result.get("structuredContent") or result, indent=2)

    return query_context


def make_context_engine_tools(strands_tool: Callable[[Any], Any]):
    query_context = make_context_engine_tool(strands_tool)

    @strands_tool
    async def query_memory_context(
        query: str,
        mode: str = "results",
        scope: str = "auto",
        depth: str = "quick",
        limit: int = 10,
    ) -> str:
        """Search only Thinkwork Hindsight Memory.

        Use this when the user specifically asks for raw long-term memory
        recall. This can be much slower than query_context because Hindsight
        may rerank a large personal memory bank.
        """

        clean_query = (query or "").strip()
        if not clean_query:
            return "query_memory_context requires a non-empty query."
        result = await _json_rpc(
            "tools/call",
            {
                "name": "query_memory_context",
                "arguments": {
                    "query": clean_query,
                    "mode": mode if mode in ("results", "answer") else "results",
                    "scope": scope if scope in ("personal", "team", "auto") else "auto",
                    "depth": depth if depth in ("quick", "deep") else "quick",
                    "limit": max(1, min(int(limit or 10), 50)),
                },
            },
        )
        if isinstance(result, str):
            return result
        content = result.get("content") or []
        text = "\n".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        ).strip()
        if text:
            return text
        return json.dumps(result.get("structuredContent") or result, indent=2)

    @strands_tool
    async def query_wiki_context(
        query: str,
        mode: str = "results",
        scope: str = "auto",
        depth: str = "quick",
        limit: int = 10,
    ) -> str:
        """Search only Thinkwork Compounding Wiki pages.

        Use this for fast page, entity, topic, and decision lookup without
        waiting on Hindsight Memory.
        """

        clean_query = (query or "").strip()
        if not clean_query:
            return "query_wiki_context requires a non-empty query."
        result = await _json_rpc(
            "tools/call",
            {
                "name": "query_wiki_context",
                "arguments": {
                    "query": clean_query,
                    "mode": mode if mode in ("results", "answer") else "results",
                    "scope": scope if scope in ("personal", "team", "auto") else "auto",
                    "depth": depth if depth in ("quick", "deep") else "quick",
                    "limit": max(1, min(int(limit or 10), 50)),
                },
            },
        )
        if isinstance(result, str):
            return result
        content = result.get("content") or []
        text = "\n".join(
            item.get("text", "") for item in content if isinstance(item, dict)
        ).strip()
        if text:
            return text
        return json.dumps(result.get("structuredContent") or result, indent=2)

    return [query_context, query_memory_context, query_wiki_context]


__all__ = ["make_context_engine_tool", "make_context_engine_tools"]
