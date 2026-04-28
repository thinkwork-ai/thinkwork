"""Injected Web Search tool for Strands agents.

Web Search is configured at the tenant/template layer and passed to the
runtime as ``web_search_config``. It is intentionally not a workspace
filesystem skill: the parent agent gets a direct ``web_search`` tool when
policy and tenant credentials allow it.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


def _append_cost(
    cost_sink: list[dict],
    *,
    provider: str,
    query: str,
    result_count: int,
    duration_sec: float,
    error: str | None = None,
) -> None:
    metadata: dict[str, Any] = {
        "query": query[:200],
        "result_count": result_count,
    }
    if error:
        metadata["error"] = error[:200]
    cost_sink.append(
        {
            "provider": provider,
            "event_type": "web_search",
            "amount_usd": 0,
            "duration_ms": int(duration_sec * 1000),
            "metadata": metadata,
        },
    )


def _post_json(url: str, *, headers: dict[str, str], payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.loads(response.read().decode("utf-8"))


def _exa_search(api_key: str, query: str, num_results: int) -> list[dict[str, str]]:
    data = _post_json(
        "https://api.exa.ai/search",
        headers={"x-api-key": api_key, "User-Agent": "Thinkwork/1.0"},
        payload={"query": query, "numResults": num_results},
    )
    results = data.get("results") or []
    out: list[dict[str, str]] = []
    for item in results[:num_results]:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "title": str(item.get("title") or ""),
                "url": str(item.get("url") or ""),
                "snippet": str(item.get("text") or item.get("summary") or "")[:500],
            },
        )
    return out


def _serpapi_search(api_key: str, query: str, num_results: int) -> list[dict[str, str]]:
    params = urllib.parse.urlencode(
        {
            "engine": "google",
            "q": query,
            "num": max(1, min(num_results, 10)),
            "api_key": api_key,
        },
    )
    data = _get_json(f"https://serpapi.com/search.json?{params}")
    if data.get("error"):
        raise RuntimeError(str(data["error"]))
    results = data.get("organic_results") or []
    out: list[dict[str, str]] = []
    for item in results[:num_results]:
        if not isinstance(item, dict):
            continue
        out.append(
            {
                "title": str(item.get("title") or ""),
                "url": str(item.get("link") or ""),
                "snippet": str(item.get("snippet") or "")[:500],
            },
        )
    return out


def build_web_search_tool(
    *,
    strands_tool_decorator: Callable[..., Any],
    web_search_config: dict[str, Any],
    cost_sink: list[dict],
) -> Any:
    provider = str(web_search_config.get("provider") or "exa").lower()
    api_key = str(web_search_config.get("apiKey") or "")

    @strands_tool_decorator
    def web_search(query: str, num_results: int = 5) -> str:
        """Search the web for current information.

        Args:
            query: Specific search query.
            num_results: Number of results to return, from 1 to 10.
        """

        bounded_results = max(1, min(int(num_results or 5), 10))
        if not api_key:
            return json.dumps(
                {
                    "ok": False,
                    "provider": provider,
                    "result_count": 0,
                    "error": "Web Search is enabled but no API key is configured.",
                },
            )

        start = time.time()
        try:
            if provider == "serpapi":
                results = _serpapi_search(api_key, query, bounded_results)
            else:
                results = _exa_search(api_key, query, bounded_results)
            _append_cost(
                cost_sink,
                provider=provider,
                query=query,
                result_count=len(results),
                duration_sec=time.time() - start,
            )
            return json.dumps(
                {
                    "ok": True,
                    "provider": provider,
                    "query": query,
                    "result_count": len(results),
                    "results": results,
                },
            )
        except (urllib.error.URLError, TimeoutError, RuntimeError, ValueError) as err:
            logger.warning("web_search failed provider=%s query=%r: %s", provider, query, err)
            _append_cost(
                cost_sink,
                provider=provider,
                query=query,
                result_count=0,
                duration_sec=time.time() - start,
                error=str(err),
            )
            return json.dumps(
                {
                    "ok": False,
                    "provider": provider,
                    "query": query,
                    "result_count": 0,
                    "error": str(err),
                },
            )

    return web_search
