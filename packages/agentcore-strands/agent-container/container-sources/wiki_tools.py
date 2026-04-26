"""Compounding Memory (wiki) agent tools.

Exposes `search_wiki` and `read_wiki_page` to Strands. Both tools call the
internal graphql-http Lambda (via API Gateway + x-api-key auth). Scope is
strictly user-scoped — the user id is ALWAYS derived from the calling
runtime's identity at registration time, never a model-supplied argument, so
the model cannot read another user's wiki even within the same tenant.

Lifecycle mirrors the hindsight_recall/hindsight_reflect pattern:

- `async def` so Strands awaits on the main event loop (not `asyncio.to_thread`).
- Fresh `httpx.AsyncClient` per call, closed in `finally` — no cached session,
  no "Unclosed client session" warnings on warm Lambda invocations.
- Transient-error retry with exponential backoff (1 s → 2 s, 3 attempts).
- Graceful empty-result message + non-throwing disabled message when the API
  env vars aren't plumbed through (so the deployment stays healthy even before
  PR 5 wires them up).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Callable

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_WIKI_QUERY_SEARCH = """
query WikiSearch($tenantId: ID!, $userId: ID!, $query: String!, $limit: Int) {
  wikiSearch(tenantId: $tenantId, userId: $userId, query: $query, limit: $limit) {
    score
    matchedAlias
    page {
      id
      type
      slug
      title
      summary
      lastCompiledAt
    }
  }
}
""".strip()

_WIKI_QUERY_PAGE = """
query WikiPage($tenantId: ID!, $userId: ID!, $type: WikiPageType!, $slug: String!) {
  wikiPage(tenantId: $tenantId, userId: $userId, type: $type, slug: $slug) {
    id
    type
    slug
    title
    summary
    bodyMd
    aliases
    sections {
      sectionSlug
      heading
      bodyMd
      position
    }
  }
}
""".strip()


def _resolve_api_endpoint() -> tuple[str | None, str | None]:
    """Look up the internal GraphQL URL + API key from env. Returns (url, key)
    with None for either if unset."""
    url = os.environ.get("THINKWORK_API_URL") or ""
    secret = (
        os.environ.get("THINKWORK_API_SECRET")
        or os.environ.get("API_AUTH_SECRET")
        or ""
    )
    if not url or not secret:
        return None, None
    return url.rstrip("/") + "/graphql", secret


async def _graphql(
    query: str,
    variables: dict[str, Any],
    *,
    timeout_s: float = 15.0,
) -> dict[str, Any] | str:
    """Run a GraphQL call against the internal API. Returns `data` on success,
    or a human-readable error string for the tool to return verbatim."""
    url, key = _resolve_api_endpoint()
    if not url or not key:
        return (
            "Wiki is not enabled for this deployment yet "
            "(THINKWORK_API_URL / THINKWORK_API_SECRET not configured)."
        )

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                resp = await client.post(
                    url,
                    json={"query": query, "variables": variables},
                    headers={
                        "content-type": "application/json",
                        "x-api-key": key,
                    },
                )
            if resp.status_code >= 500:
                last_err = RuntimeError(
                    f"graphql {resp.status_code}: {resp.text[:200]}"
                )
            else:
                payload = resp.json()
                errors = payload.get("errors")
                if errors:
                    # Treat errors as terminal — the resolvers already
                    # normalize auth/validation failures; retrying won't help.
                    return f"Wiki call failed: {errors[0].get('message', 'unknown error')}"
                return payload.get("data") or {}
        except Exception as err:  # network / JSON / etc.
            last_err = err
        if attempt < 2:
            await asyncio.sleep(1.0 * (2**attempt))  # 1 s, 2 s
    logger.warning("wiki_tools transient failure: %s", last_err)
    return (
        f"Wiki call failed after 3 attempts: "
        f"{getattr(last_err, 'args', [str(last_err)])[0]}"
    )


# ---------------------------------------------------------------------------
# Tool factories — closures capture (tenant_id, owner_id-as-user-id) so the
# model can never address another user's wiki.
# ---------------------------------------------------------------------------


def make_wiki_tools(
    strands_tool: Callable[[Any], Any],
    *,
    tenant_id: str,
    owner_id: str,
) -> tuple[Callable[..., Any], Callable[..., Any]]:
    """Build the two wiki tools bound to a fixed (tenant, user) scope.

    Parameters
    ----------
    strands_tool:
        The Strands `@tool` decorator. Passed in explicitly so tests can
        substitute a no-op decorator and exercise the underlying coroutines
        without the Strands import side-effects.
    tenant_id, owner_id:
        Caller's scope. Both are captured by closure. The tools expose NO
        arguments for these so the model cannot pass a different user's id.
    """

    @strands_tool
    async def search_wiki(query: str, limit: int = 10) -> str:
        """Search this user's compiled-memory wiki pages (entities, topics,
        decisions the user has accumulated) by free-text query.

        Use this when the user asks about something the agent should "already
        know" — a place, person, topic, or past decision — and you want a
        quick list of the most relevant compiled pages. Each hit includes
        the page type, slug, title, and a short summary; call
        `read_wiki_page` to drill in.

        Prefer this over `hindsight_recall` when the user asks about a named
        subject (restaurant, person, project) that the wiki may already have
        compiled — wiki pages carry the user's distilled knowledge. Use
        `hindsight_recall` for raw facts or freshly-remembered details that
        may not yet be compiled.
        """
        data = await _graphql(
            _WIKI_QUERY_SEARCH,
            {
                "tenantId": tenant_id,
                "userId": owner_id,
                "query": query,
                "limit": max(1, min(limit, 25)),
            },
        )
        if isinstance(data, str):
            return data
        hits = (data.get("wikiSearch") or []) if isinstance(data, dict) else []
        if not hits:
            return f"No wiki pages matched {query!r}."
        lines = [f"Wiki search results for {query!r}:"]
        for i, hit in enumerate(hits, 1):
            page = hit.get("page") or {}
            alias = hit.get("matchedAlias")
            alias_note = f" (alias: {alias})" if alias else ""
            summary = (page.get("summary") or "").strip()
            summary_line = f"\n  {summary}" if summary else ""
            lines.append(
                f"{i}. [{page.get('type','?').lower()}] "
                f"{page.get('title','(untitled)')} — slug={page.get('slug','?')}"
                f"{alias_note}{summary_line}"
            )
        return "\n".join(lines)

    @strands_tool
    async def read_wiki_page(slug: str, type: str = "entity") -> str:
        """Fetch the full body of one compiled-memory wiki page owned by this
        user, by slug and type.

        `type` must be one of: entity, topic, decision. Use this when you
        have a specific slug from `search_wiki` and want the full compiled
        body — including all sections (overview / notes / etc.) — to answer
        an open-ended question.
        """
        gql_type = type.strip().upper()
        if gql_type not in ("ENTITY", "TOPIC", "DECISION"):
            return (
                f"Unknown page type {type!r}. "
                "Use one of: entity, topic, decision."
            )
        data = await _graphql(
            _WIKI_QUERY_PAGE,
            {
                "tenantId": tenant_id,
                "userId": owner_id,
                "type": gql_type,
                "slug": slug,
            },
        )
        if isinstance(data, str):
            return data
        page = data.get("wikiPage") if isinstance(data, dict) else None
        if not page:
            return f"No wiki page found for {gql_type.lower()}/{slug}."
        parts = [f"# {page.get('title','(untitled)')}"]
        if page.get("summary"):
            parts.append(f"_{page['summary'].strip()}_")
        for section in page.get("sections") or []:
            parts.append(
                f"\n## {section.get('heading','(no heading)')}\n"
                f"{(section.get('bodyMd') or '').strip()}"
            )
        aliases = page.get("aliases") or []
        if aliases:
            parts.append("\n_Aliases: " + ", ".join(aliases) + "_")
        return "\n".join(parts)

    return search_wiki, read_wiki_page


# Test-only surface
__all__ = ["make_wiki_tools"]
