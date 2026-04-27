"""
Agent Memory Tools — remember, recall, forget.

Strands-native Python tools for explicit agent memory management.
Uses AgentCore Memory API (L2) and optionally Bedrock Knowledge Bases (L3).

- remember() routes through CreateEvent for Bedrock consolidation/dedup
- recall() defaults to managed memory + Hindsight + compiled wiki lookup
- forget() soft-deletes to /archived/ namespace (Dream purges after 30 days)
"""

import asyncio
import logging
import os
import threading
import uuid
from datetime import UTC, datetime
from typing import Any

from strands import tool

logger = logging.getLogger(__name__)


def _get_memory_config():
    """Get memory configuration from environment."""
    import boto3

    memory_id = os.environ.get("AGENTCORE_MEMORY_ID", "")
    region = os.environ.get("AWS_REGION", "us-east-1")
    actor_id = _get_user_actor_id()
    if not memory_id or not actor_id:
        return None, None, None
    client = boto3.client("bedrock-agentcore", region_name=region)
    return client, memory_id, actor_id


def _get_user_actor_id() -> str:
    """Return the current user id used as the managed-memory actor.

    AgentCore memory, Hindsight, and wiki tools are intentionally scoped to
    the user, not the agent/template. Do not fall back to `_ASSISTANT_ID`;
    doing so would let delegated sub-agents write to agent-specific memory
    while the rest of the runtime reads user-scoped memory.
    """
    return (
        os.environ.get("USER_ID", "")
        or os.environ.get("CURRENT_USER_ID", "")
        or os.environ.get("_MCP_USER_ID", "")
    )


def _get_tenant_id() -> str:
    """Return the current tenant id for user-scoped wiki lookup."""
    return (
        os.environ.get("TENANT_ID", "")
        or os.environ.get("CURRENT_TENANT_ID", "")
        or os.environ.get("_MCP_TENANT_ID", "")
    )


def _run_async(coro):
    """Run an async helper from this sync Strands tool."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict[str, Any] = {}

    def runner() -> None:
        try:
            result["value"] = asyncio.run(coro)
        except Exception as err:
            result["error"] = err

    thread = threading.Thread(target=runner, daemon=True)
    thread.start()
    thread.join()
    if "error" in result:
        raise result["error"]
    return result.get("value")


def _memory_text(record: dict[str, Any]) -> str:
    return str(record.get("text") or record.get("content") or "").strip()


def _format_record_section(title: str, records: list[dict[str, Any]]) -> str:
    lines = [title]
    for index, record in enumerate(records[:10], 1):
        text = _memory_text(record)
        if not text:
            continue
        strategy = record.get("strategy")
        label = f"[{strategy}] " if strategy else ""
        lines.append(f"{index}. {label}{text}")
    return "\n".join(lines)


def _format_wiki_section(hits: list[dict[str, Any]], error: str | None = None) -> str:
    lines = ["Wiki"]
    if error:
        lines.append(f"Wiki search failed: {error}")
        return "\n".join(lines)
    for index, hit in enumerate(hits[:10], 1):
        page = hit.get("page") or {}
        title = page.get("title") or "(untitled)"
        page_type = str(page.get("type") or "?").lower()
        slug = page.get("slug") or "?"
        alias = hit.get("matchedAlias")
        score = hit.get("score")
        suffix = f" (alias: {alias})" if alias else ""
        score_suffix = f", score={score:.3g}" if isinstance(score, int | float) else ""
        lines.append(f"{index}. [{page_type}] {title} - slug={slug}{suffix}{score_suffix}")
        summary = str(page.get("summary") or "").strip()
        if summary:
            lines.append(f"   {summary}")
    return "\n".join(lines)


def _search_wiki_for_recall(
    actor_id: str,
    query: str,
    limit: int = 5,
) -> tuple[list[dict[str, Any]], str | None]:
    tenant_id = _get_tenant_id()
    if not tenant_id:
        return [], None

    try:
        from wiki_tools import search_wiki_for_user

        hits = _run_async(
            search_wiki_for_user(
                tenant_id=tenant_id,
                owner_id=actor_id,
                query=query,
                limit=max(1, min(limit, 10)),
            )
        )
        if isinstance(hits, str):
            if "not enabled" in hits:
                logger.debug("Wiki recall skipped: %s", hits)
                return [], None
            return [], hits
        return [hit for hit in hits if isinstance(hit, dict)], None
    except Exception as err:
        logger.warning("Wiki recall failed (non-fatal): %s", err)
        return [], str(err)


@tool
def remember(fact: str, category: str = "general") -> str:
    """Store an important fact about the user or conversation to long-term memory.

    Use this when the user shares preferences, important context, or asks you to
    remember something. The memory persists across all future conversations.

    Args:
        fact: The fact or preference to remember. Be specific and concise.
        category: Optional category hint (e.g., "preference", "context", "instruction").

    Returns:
        Confirmation that the fact was stored.
    """
    client, memory_id, actor_id = _get_memory_config()
    if not client:
        return "Memory system not configured — unable to store."

    try:
        # 1. Write directly to the semantic namespace for immediate searchability.
        request_id = uuid.uuid4().hex[:16]
        now = datetime.now(UTC)
        response = client.batch_create_memory_records(
            memoryId=memory_id,
            records=[
                {
                    "requestIdentifier": request_id,
                    "content": {"text": f"[{category}] {fact}"},
                    "namespaces": [f"user_{actor_id}"],
                    "timestamp": now,
                }
            ],
        )
        # Check for failures
        failed = response.get("failedRecords", [])
        if failed:
            logger.warning("memory_tools.remember batch_create failed: %s", failed)

        # 2. Also fire a CreateEvent so conversation-based strategies
        #    (summary, preference, episodic) can process it over time.
        session_id = os.environ.get("CURRENT_THREAD_ID", f"memory_user_{actor_id}")
        client.create_event(
            memoryId=memory_id,
            actorId=actor_id,
            sessionId=session_id,
            eventTimestamp=now,
            payload=[
                {
                    "conversational": {
                        "content": {"text": f"The user asked me to remember: {fact}"},
                        "role": "USER",
                    }
                }
            ],
        )

        logger.info(
            "memory_tools.remember actor=%s category=%s fact=%s", actor_id, category, fact[:80]
        )

        # Parallel: also retain in Hindsight (PRD-41B spike)
        import hs_urllib_client as hindsight_client

        if hindsight_client.is_available():
            try:
                hs_bank = f"user_{actor_id}"
                hindsight_client.retain(
                    bank_id=hs_bank,
                    content=f"[{category}] {fact}",
                    context="explicit_memory",
                )
            except Exception as he:
                logger.warning("Hindsight retain failed (non-fatal): %s", he)

        return f"Remembered: {fact}"
    except Exception as e:
        logger.warning("memory_tools.remember failed: %s", e)
        return f"Failed to store memory: {e}"


@tool
def recall(query: str, scope: str = "memory", strategy: str = "") -> str:
    """Search long-term memory for relevant information.

    Use this when you need to check if you know something about the user,
    remember past conversations, or find previously stored knowledge. Default
    recall fans out across managed memory, Hindsight, and compiled wiki pages,
    then returns one grouped result.

    Args:
        query: What to search for.
        scope: "memory" (default, managed memory + Hindsight + wiki),
               "all" (memory + knowledge bases + knowledge graph + wiki),
               "knowledge" (knowledge bases only), "graph" (knowledge graph entities only).
        strategy: Optional filter — "semantic", "preferences", "episodes", or empty for all.

    Returns:
        Matching memories as formatted text, or message if nothing found.
    """
    from memory import search_memories

    actor_id = _get_user_actor_id()
    if not actor_id:
        return "Memory system not configured — unable to search."
    session_id = os.environ.get("CURRENT_THREAD_ID", "")
    managed_results: list[dict[str, Any]] = []
    graph_results: list[dict[str, Any]] = []
    knowledge_results: list[dict[str, Any]] = []
    hindsight_results: list[dict[str, Any]] = []
    wiki_results: list[dict[str, Any]] = []
    wiki_error: str | None = None

    # L2: AgentCore Memory — semantic search across strategy namespaces
    if scope in ("memory", "all"):
        strategies = [strategy] if strategy else None
        l2_results = search_memories(
            query=query,
            actor_id=actor_id,
            session_id=session_id,
            strategies=strategies,
            top_k=10,
        )
        managed_results.extend(l2_results)

    # Knowledge Graph (Neptune entity relationships)
    if scope in ("graph", "all"):
        try:
            from memory import graph_search

            graph_results.extend(graph_search(query=query, actor_id=actor_id))
        except Exception as e:
            logger.debug("Graph search in recall failed: %s", e)

    # L3: Bedrock Knowledge Bases (only if explicitly requested)
    if scope in ("knowledge", "all"):
        try:
            from server import _retrieve_kb_context

            kb_config_str = os.environ.get("_KB_CONFIG", "")
            if kb_config_str:
                import json

                kb_config = json.loads(kb_config_str)
                kb_context = _retrieve_kb_context(kb_config, query)
                if kb_context:
                    knowledge_results.append(
                        {
                            "text": kb_context,
                            "score": 0.5,
                            "strategy": "knowledge_base",
                        }
                    )
        except Exception as e:
            logger.debug("KB retrieval in recall failed: %s", e)

    # Parallel: also recall from Hindsight (PRD-41B spike)
    import hs_urllib_client as hindsight_client

    if hindsight_client.is_available() and scope in ("all", "graph", "memory"):
        try:
            hs_bank = f"user_{actor_id}"
            hs_results = hindsight_client.recall(bank_id=hs_bank, query=query, max_tokens=2000)
            if hs_results.get("results"):
                for fact in hs_results["results"]:
                    text = fact.get("text", fact.get("content", ""))
                    if text:
                        hindsight_results.append({"text": text, "score": 0.5})
        except Exception as he:
            logger.warning("Hindsight recall failed (non-fatal): %s", he)

    if scope in ("memory", "all"):
        wiki_results, wiki_error = _search_wiki_for_recall(actor_id, query, limit=5)

    sections = []
    if managed_results:
        sections.append(_format_record_section("Managed Memory", managed_results))
    if hindsight_results:
        sections.append(_format_record_section("Hindsight", hindsight_results))
    if wiki_results or wiki_error:
        sections.append(_format_wiki_section(wiki_results, wiki_error))
    if graph_results:
        sections.append(_format_record_section("Knowledge Graph", graph_results))
    if knowledge_results:
        sections.append(_format_record_section("Knowledge Base", knowledge_results))

    if not sections:
        return f"No memories found for: {query}"

    total_results = (
        len(managed_results)
        + len(hindsight_results)
        + len(wiki_results)
        + len(graph_results)
        + len(knowledge_results)
    )
    logger.info(
        "memory_tools.recall query=%s scope=%s managed=%d hindsight=%d wiki=%d graph=%d kb=%d",
        query[:50],
        scope,
        len(managed_results),
        len(hindsight_results),
        len(wiki_results),
        len(graph_results),
        len(knowledge_results),
    )
    if total_results == 0 and wiki_error:
        logger.warning("memory_tools.recall returned only a wiki error: %s", wiki_error)
    return "\n\n".join(sections)


@tool
def forget(query: str) -> str:
    """Remove a memory by archiving it. The memory will be permanently deleted after 30 days.

    Use this when the user asks you to forget something or when information is outdated.

    Args:
        query: Description of the memory to forget (searched semantically).

    Returns:
        Confirmation of what was archived.
    """
    from memory import search_memories

    client, memory_id, actor_id = _get_memory_config()
    if not client:
        return "Memory system not configured."

    session_id = os.environ.get("CURRENT_THREAD_ID", "")

    # Search for matching records
    results = search_memories(
        query=query,
        actor_id=actor_id,
        session_id=session_id,
        top_k=3,
    )

    if not results:
        return f"No matching memories found for: {query}"

    # Soft-delete: move top match to /archived/ namespace
    top = results[0]
    record_id = top.get("memoryRecordId", "")
    if not record_id:
        return "Found a match but couldn't identify the record to archive."

    try:
        # Move to archived namespace via batch update
        client.batch_update_memory_records(
            memoryId=memory_id,
            memoryRecords=[
                {
                    "memoryRecordId": record_id,
                    "namespace": f"/archived/users/{actor_id}/",
                }
            ],
        )
        logger.info("memory_tools.forget actor=%s record=%s archived", actor_id, record_id)
        return f"Archived memory: {top['text'][:100]}..."
    except Exception as e:
        logger.warning("memory_tools.forget failed: %s", e)
        return f"Failed to archive memory: {e}"
