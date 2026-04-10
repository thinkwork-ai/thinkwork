"""
Agent Memory Tools — remember, recall, forget.

Strands-native Python tools for explicit agent memory management.
Uses AgentCore Memory API (L2) and optionally Bedrock Knowledge Bases (L3).

- remember() routes through CreateEvent for Bedrock consolidation/dedup
- recall() defaults to L2 memory only; agent opts into L3 with scope="all"
- forget() soft-deletes to /archived/ namespace (Dream purges after 30 days)
"""

import logging
import os
import uuid
from datetime import datetime, timezone

from strands import tool

logger = logging.getLogger(__name__)


def _get_memory_config():
    """Get memory configuration from environment."""
    import boto3
    memory_id = os.environ.get("AGENTCORE_MEMORY_ID", "")
    region = os.environ.get("AWS_REGION", "us-east-1")
    actor_id = os.environ.get("_ASSISTANT_ID", "")
    if not memory_id or not actor_id:
        return None, None, None
    client = boto3.client("bedrock-agentcore", region_name=region)
    return client, memory_id, actor_id


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
        now = datetime.now(timezone.utc)
        response = client.batch_create_memory_records(
            memoryId=memory_id,
            records=[{
                "requestIdentifier": request_id,
                "content": {"text": f"[{category}] {fact}"},
                "namespaces": [f"assistant_{actor_id}"],
                "timestamp": now,
            }],
        )
        # Check for failures
        failed = response.get("failedRecords", [])
        if failed:
            logger.warning("memory_tools.remember batch_create failed: %s", failed)

        # 2. Also fire a CreateEvent so conversation-based strategies
        #    (summary, preference, episodic) can process it over time.
        session_id = os.environ.get("CURRENT_THREAD_ID", f"memory_{actor_id}")
        client.create_event(
            memoryId=memory_id,
            actorId=actor_id,
            sessionId=session_id,
            eventTimestamp=now,
            payload=[{
                "conversational": {
                    "content": {"text": f"The user asked me to remember: {fact}"},
                    "role": "USER",
                }
            }],
        )

        logger.info("memory_tools.remember actor=%s category=%s fact=%s",
                     actor_id, category, fact[:80])

        # Parallel: also retain in Hindsight (PRD-41B spike)
        import hindsight_client
        if hindsight_client.is_available():
            try:
                hs_bank = os.environ.get("_INSTANCE_ID", "") or actor_id
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
    remember past conversations, or find previously stored knowledge.

    Args:
        query: What to search for in memory.
        scope: "memory" (default, your memory only), "all" (memory + knowledge bases + knowledge graph),
               "knowledge" (knowledge bases only), "graph" (knowledge graph entities only).
        strategy: Optional filter — "semantic", "preferences", "episodes", or empty for all.

    Returns:
        Matching memories as formatted text, or message if nothing found.
    """
    from memory import search_memories

    actor_id = os.environ.get("_ASSISTANT_ID", "")
    session_id = os.environ.get("CURRENT_THREAD_ID", "")
    results = []

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
        results.extend(l2_results)

    # Knowledge Graph (Neptune entity relationships)
    if scope in ("graph", "all"):
        try:
            from memory import graph_search
            graph_results = graph_search(query=query, actor_id=actor_id)
            results.extend(graph_results)
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
                    results.append({
                        "text": kb_context,
                        "score": 0.5,
                        "strategy": "knowledge_base",
                    })
        except Exception as e:
            logger.debug("KB retrieval in recall failed: %s", e)

    # Parallel: also recall from Hindsight (PRD-41B spike)
    import hindsight_client
    if hindsight_client.is_available() and scope in ("all", "graph", "memory"):
        try:
            hs_bank = os.environ.get("_INSTANCE_ID", "") or actor_id
            hs_results = hindsight_client.recall(bank_id=hs_bank, query=query, max_tokens=2000)
            if hs_results.get("results"):
                for fact in hs_results["results"]:
                    text = fact.get("text", fact.get("content", ""))
                    if text:
                        results.append({"text": text, "score": 0.5, "strategy": "hindsight"})
        except Exception as he:
            logger.warning("Hindsight recall failed (non-fatal): %s", he)

    if not results:
        return f"No memories found for: {query}"

    # Format results
    lines = []
    for r in results[:10]:
        strategy_label = r.get("strategy", "unknown")
        lines.append(f"[{strategy_label}] {r['text']}")

    logger.info("memory_tools.recall query=%s scope=%s results=%d",
                query[:50], scope, len(results))
    return "\n\n".join(lines)


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
            memoryRecords=[{
                "memoryRecordId": record_id,
                "namespace": f"/archived/actors/{actor_id}/",
            }],
        )
        logger.info("memory_tools.forget actor=%s record=%s archived", actor_id, record_id)
        return f"Archived memory: {top['text'][:100]}..."
    except Exception as e:
        logger.warning("memory_tools.forget failed: %s", e)
        return f"Failed to archive memory: {e}"
