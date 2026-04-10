"""
AgentCore Memory — AWS AgentCore Memory service for agent conversations.

Uses the native AgentCore Memory API:
- create-event: ingests conversation turns
- list-memory-records: retrieves extracted memory

Four built-in strategies with hierarchical namespaces:
- Semantic facts: /semantic/actors/{actorId}/
- User preferences: /preferences/actors/{actorId}/
- Session summaries: /summaries/actors/{actorId}/sessions/{sessionId}/
- Episodic: /episodes/actors/{actorId}/sessions/{sessionId}/

actorId = assistant slug (e.g. "capable-mosquito-358")
sessionId = thread ID (e.g. "session_abc123")

Implicit retrieval uses semantic search with a shared token budget.
"""

import logging
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone

import boto3

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logger = logging.getLogger(__name__)

# AgentCore Memory resource ID
AGENTCORE_MEMORY_ID = os.environ.get("AGENTCORE_MEMORY_ID", "")

# Implicit retrieval token budget
MEMORY_TOKEN_BUDGET = int(os.environ.get("MEMORY_TOKEN_BUDGET", "2000"))

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

_agentcore_client = None


# ---------------------------------------------------------------------------
# Client singleton
# ---------------------------------------------------------------------------

def _get_agentcore_client():
    """Get AgentCore data plane client (lazy singleton)."""
    global _agentcore_client
    if _agentcore_client is None:
        _agentcore_client = boto3.client("bedrock-agentcore", region_name=AWS_REGION)
    return _agentcore_client


# ---------------------------------------------------------------------------
# Reasoning / thinking block removal
# ---------------------------------------------------------------------------

_REASONING_PATTERNS = [
    re.compile(r"<thinking>.*?</thinking>", re.DOTALL),
    re.compile(r"<reasoning>.*?</reasoning>", re.DOTALL),
    re.compile(r"<reflection>.*?</reflection>", re.DOTALL),
]


def _strip_reasoning(text: str) -> str:
    """Remove <thinking>, <reasoning>, <reflection> blocks from text."""
    for pattern in _REASONING_PATTERNS:
        text = pattern.sub("", text)
    return text.strip()


# ---------------------------------------------------------------------------
# Event ingestion
# ---------------------------------------------------------------------------

def store_turn(
    ticket_id: str,
    role: str,
    content: str,
    turn_index: int = 0,
    **_kwargs,
) -> bool:
    """No-op — Hindsight ingests conversation data via KG Extract worker.

    PRD-41B: Per-turn ingestion removed. Messages are stored in the
    messages table by the API layer and fed to Hindsight in batches
    by the KG Extract cron worker.
    """
    logger.debug("memory.store_turn no-op (Hindsight via KG Extract)")
    return True



# ---------------------------------------------------------------------------
# Memory retrieval
# ---------------------------------------------------------------------------

def retrieve_thread_events(ticket_id: str) -> list[dict]:
    """Retrieve raw conversation events for a thread (immediate, synchronous).

    Uses list_events API which returns raw conversation turns immediately,
    unlike list_memory_records which depends on async strategy extraction.

    Returns list of {role, content} dicts ordered by timestamp.
    """
    if not AGENTCORE_MEMORY_ID:
        return []
    try:
        client = _get_agentcore_client()
        actor_id = os.environ.get("_ASSISTANT_ID", "unknown")
        response = client.list_events(
            memoryId=AGENTCORE_MEMORY_ID,
            sessionId=ticket_id,
            actorId=actor_id,
            includePayloads=True,
        )
        events = response.get("events", [])
        # Sort by eventId (timestamp-based, ascending) — API returns newest first
        events.sort(key=lambda e: e.get("eventId", ""))
        turns = []
        for event in events:
            for payload_item in event.get("payload", []):
                conv = payload_item.get("conversational", {})
                if conv:
                    role = conv.get("role", "").lower()
                    text = conv.get("content", {}).get("text", "")
                    if role and text:
                        turns.append({"role": role, "content": text})
        logger.info("memory.thread_events thread=%s actor=%s count=%d", ticket_id, actor_id, len(turns))
        return turns
    except Exception as e:
        logger.warning("memory.thread_events failed thread=%s: %s", ticket_id, e)
        return []


def retrieve_session_memory(ticket_id: str) -> list[dict]:
    """Retrieve session summary records for a thread (async-extracted)."""
    if not AGENTCORE_MEMORY_ID:
        return []
    actor_id = os.environ.get("_ASSISTANT_ID", "")
    # Session summaries namespace
    namespaces = [f"session_{ticket_id}"]
    try:
        client = _get_agentcore_client()
        all_records = []
        for ns in namespaces:
            try:
                response = client.list_memory_records(
                    memoryId=AGENTCORE_MEMORY_ID,
                    namespace=ns,
                )
                all_records.extend(response.get("memoryRecordSummaries", []))
            except Exception:
                pass
        logger.info("memory.session_records thread=%s count=%d", ticket_id, len(all_records))
        return all_records
    except Exception as e:
        logger.warning("memory.session_records failed thread=%s: %s", ticket_id, e)
        return []


def retrieve_assistant_memory(assistant_id: str = "") -> list[dict]:
    """Retrieve long-term semantic memory for an assistant (cross-thread)."""
    if not AGENTCORE_MEMORY_ID:
        return []
    if not assistant_id:
        assistant_id = os.environ.get("_ASSISTANT_ID", "")
    if not assistant_id:
        return []
    # Search all active namespaces for this assistant
    namespaces = [
        f"assistant_{assistant_id}",       # semantic strategy
        f"preferences_{assistant_id}",     # user preference strategy
    ]
    try:
        client = _get_agentcore_client()
        all_records = []
        for ns in namespaces:
            try:
                response = client.list_memory_records(
                    memoryId=AGENTCORE_MEMORY_ID,
                    namespace=ns,
                )
                all_records.extend(response.get("memoryRecordSummaries", []))
            except Exception:
                pass
        logger.info("memory.assistant_records assistant=%s count=%d", assistant_id, len(all_records))
        return all_records
    except Exception as e:
        logger.warning("memory.assistant_records failed assistant=%s: %s", assistant_id, e)
        return []


# ---------------------------------------------------------------------------
# Semantic search across strategy namespaces
# ---------------------------------------------------------------------------

# Namespace templates matching the configured AgentCore strategies.
# These are the ACTIVE namespaces where strategies extract records.
STRATEGY_NAMESPACES = {
    "semantic": "assistant_{actor_id}",
    "preferences": "preferences_{actor_id}",
    "summaries": "session_{session_id}",
    "episodes": "episodes_{actor_id}/{session_id}",
    "reflections": "episodes_{actor_id}/",
}

# Future hierarchical namespaces (PRD-34 target, not yet migrated)
FUTURE_NAMESPACES = {
    "semantic": "/semantic/actors/{actor_id}/",
    "preferences": "/preferences/actors/{actor_id}/",
    "summaries": "/summaries/actors/{actor_id}/sessions/{session_id}/",
    "episodes": "/episodes/actors/{actor_id}/sessions/{session_id}/",
}


def search_memories(
    query: str,
    actor_id: str = "",
    session_id: str = "",
    strategies: list[str] | None = None,
    top_k: int = 10,
) -> list[dict]:
    """Search memories via Hindsight recall API.

    PRD-41B: Replaces AgentCore Memory with Hindsight multi-strategy recall.
    Returns list of dicts with {text, score, strategy}.
    """
    try:
        import hindsight_client
        if not hindsight_client.is_available():
            logger.debug("memory.search skipped: HINDSIGHT_ENDPOINT not set")
            return []

        bank_id = os.environ.get("_INSTANCE_ID", "") or actor_id or os.environ.get("_ASSISTANT_ID", "")
        if not bank_id:
            return []

        hs_results = hindsight_client.recall(bank_id=bank_id, query=query, max_results=top_k)
        results = []
        for r in hs_results.get("memory_units", hs_results.get("results", [])):
            text = r.get("text", r.get("content", ""))
            if text:
                results.append({
                    "text": text,
                    "score": r.get("relevance_score", r.get("score", 0.5)),
                    "strategy": r.get("fact_type", "semantic"),
                    "namespace": bank_id,
                    "memoryRecordId": r.get("id", ""),
                })

        results.sort(key=lambda r: r["score"], reverse=True)
        logger.info("memory.search query=%s results=%d (Hindsight)", query[:50], len(results))
        return results
    except Exception as e:
        logger.warning("memory.search failed: %s", e)
        return []


def retrieve_implicit_memory(
    query: str,
    actor_id: str = "",
    session_id: str = "",
    token_budget: int = 0,
) -> str:
    """Retrieve relevant memories for implicit context injection.

    Searches all strategy namespaces, merges by relevance score,
    fills a shared token budget, and returns formatted context blocks.
    """
    budget = token_budget or MEMORY_TOKEN_BUDGET
    if not actor_id:
        actor_id = os.environ.get("_ASSISTANT_ID", "")
    results = search_memories(
        query=query,
        actor_id=actor_id,
        session_id=session_id,
        strategies=["semantic", "preferences", "episodes", "reflections"],
        top_k=10,
    )

    # Greedily fill token budget
    selected = []
    token_count = 0
    for record in results:
        est_tokens = len(record["text"]) // 4
        if token_count + est_tokens > budget:
            break
        selected.append(record)
        token_count += est_tokens

    if not selected:
        return ""

    # Group by strategy for structured output
    by_strategy = defaultdict(list)
    for r in selected:
        by_strategy[r["strategy"]].append(r["text"])

    strategy_labels = {
        "semantic": "Facts",
        "preferences": "Preferences",
        "summaries": "Session Summary",
        "episodes": "Episodes & Reflections",
    }

    context_parts = []
    for strategy, texts in by_strategy.items():
        label = strategy_labels.get(strategy, strategy.title())
        context_parts.append(f"[Memory: {label}]\n" + "\n---\n".join(texts))

    memory_block = "\n\n".join(context_parts)
    logger.info("memory.implicit_retrieval records=%d tokens=%d budget=%d",
                len(selected), token_count, budget)
    return memory_block


def get_next_turn_index(ticket_id: str) -> int:
    """Returns 0 — AgentCore Memory uses timestamps, not indices.

    Kept for API compatibility with server.py callers.
    """
    return 0


# ---------------------------------------------------------------------------
# Raw event retrieval for explicit memories (fallback before extraction)
# ---------------------------------------------------------------------------

def retrieve_memory_events(actor_id: str, query: str = "") -> list[dict]:
    """Retrieve explicitly remembered facts from the dedicated memory session.

    Falls back to raw event scanning when semantic search returns nothing
    (i.e., before async strategy extraction has processed the events).

    Returns list of dicts with {text, score, strategy}.
    """
    if not AGENTCORE_MEMORY_ID or not actor_id:
        return []
    memory_session = f"memory_{actor_id}"
    try:
        client = _get_agentcore_client()
        response = client.list_events(
            memoryId=AGENTCORE_MEMORY_ID,
            sessionId=memory_session,
            actorId=actor_id,
            includePayloads=True,
        )
        events = response.get("events", [])
        query_lower = query.lower()
        results = []
        for event in events:
            for payload_item in event.get("payload", []):
                conv = payload_item.get("conversational", {})
                if not conv:
                    continue
                role = conv.get("role", "").lower()
                text = conv.get("content", {}).get("text", "")
                # Only include USER events (the "Please remember this: ..." messages)
                if role != "user" or not text:
                    continue
                # Strip the "Please remember this: " prefix
                fact = text.replace("Please remember this: ", "")
                # Simple relevance: check if query terms appear in the fact
                if query_lower and not any(
                    term in fact.lower() for term in query_lower.split()
                ):
                    continue
                results.append({
                    "text": fact,
                    "score": 0.5,  # Default score for raw event matches
                    "strategy": "explicit_memory",
                })
        logger.info("memory.memory_events actor=%s query=%s results=%d",
                    actor_id, query[:50], len(results))
        return results
    except Exception as e:
        logger.debug("memory.memory_events failed: %s", e)
        return []


# ---------------------------------------------------------------------------
# Message builders for Bedrock Converse
# ---------------------------------------------------------------------------

def _enforce_alternation(messages: list[dict]) -> list[dict]:
    """Ensure messages alternate between user and assistant roles.

    Bedrock Converse requires strict alternation.
    """
    if not messages:
        return messages

    merged = [messages[0]]
    for msg in messages[1:]:
        if msg["role"] == merged[-1]["role"]:
            merged[-1]["content"].extend(msg["content"])
        else:
            merged.append(msg)
    return merged


def _records_to_context(records: list[dict]) -> str:
    """Extract text content from memory records into a context string."""
    parts = []
    for record in records:
        content = record.get("content", {})
        if isinstance(content, dict):
            text = content.get("text", "")
        else:
            text = str(content)
        if text:
            parts.append(text)
    return "\n---\n".join(parts)


def build_converse_messages(ticket_id: str, new_message: str) -> list[dict]:
    """Build Bedrock Converse messages array with conversation history.

    Uses semantic search for relevant implicit memory (shared token budget)
    and list_events for raw turn history.
    """
    messages = []

    # 1. Implicit memory retrieval — semantic search with token budget
    actor_id = os.environ.get("_ASSISTANT_ID", "")
    memory_context = retrieve_implicit_memory(
        query=new_message, actor_id=actor_id, session_id=ticket_id,
    )
    if memory_context:
        messages.append({"role": "user", "content": [{"text": f"[Memory]\n{memory_context}"}]})
        messages.append({"role": "assistant", "content": [{"text": "I have the context. How can I help?"}]})

    # 2. Raw conversation history from events (immediate turn recall)
    turns = retrieve_thread_events(ticket_id)
    for turn in turns:
        messages.append({
            "role": turn["role"],
            "content": [{"text": turn["content"]}],
        })

    # 3. Append the new message
    messages.append({"role": "user", "content": [{"text": new_message}]})
    return _enforce_alternation(messages)


def build_conversation_string(ticket_id: str) -> str:
    """Retrieve memory → format as context string for BUILD mode."""
    parts = []

    # Implicit memory retrieval
    actor_id = os.environ.get("_ASSISTANT_ID", "")
    memory_context = retrieve_implicit_memory(
        query="conversation context", actor_id=actor_id, session_id=ticket_id,
    )
    if memory_context:
        parts.append(f"Long-term memory:\n{memory_context}")

    # Raw conversation history
    turns = retrieve_thread_events(ticket_id)
    if turns:
        conv_lines = [f"[{t['role']}]: {t['content']}" for t in turns]
        parts.append("Conversation history:\n" + "\n\n".join(conv_lines))

    return "\n\n---\n\n".join(parts)


# ---------------------------------------------------------------------------
# Thread cleanup
# ---------------------------------------------------------------------------

def clear_thread_memory(ticket_id: str) -> bool:
    """No-op for AgentCore Memory (service manages retention via TTL)."""
    logger.info("memory.clear_thread thread=%s (managed by AgentCore Memory TTL)", ticket_id)
    return True


