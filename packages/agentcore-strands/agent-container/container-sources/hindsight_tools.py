"""Hindsight agent tool factory.

Builds Thinkwork's custom ``retain``, ``hindsight_recall`` and
``hindsight_reflect`` async wrappers. Each wrapper creates a fresh
Hindsight client per call, closes it explicitly, retries transient upstream
failures, and pushes Bedrock token usage to ``hindsight_usage_capture``
in-body — replacing the previous module-level monkey-patch.

ARCHITECTURAL INVARIANT (load-bearing): every Hindsight retain/reflect
call site must flow through ``make_hindsight_tools``. The in-body
``_push`` pattern only fires for tools registered through this factory;
direct ``hindsight_strands.tools.*`` imports or ad-hoc ``Hindsight``
client instantiation outside this module silently bypasses cost
attribution. PR review must flag any new path that does not route here.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
from collections.abc import Callable, Sequence
from typing import Any

logger = logging.getLogger(__name__)


def _is_transient_error(err: Exception) -> bool:
    msg = str(err)
    return (
        "(500)" in msg
        or "(502)" in msg
        or "(503)" in msg
        or "(504)" in msg
        or "BedrockException" in msg
        or "ServiceUnavailableError" in msg
        or "Try your request again" in msg
        or "throttl" in msg.lower()
    )


def _make_client_factory(hs_endpoint: str):
    from hindsight_client import Hindsight

    def _factory():
        return Hindsight(base_url=hs_endpoint, timeout=300.0)

    return _factory


def make_hindsight_tools(
    strands_tool: Callable[[Any], Any],
    *,
    hs_endpoint: str,
    hs_bank: str,
    hs_tags: Sequence[str] | None = None,
    client_factory: Callable[[], Any] | None = None,
) -> tuple[Any, ...]:
    """Build Hindsight tools bound to one snapshotted bank.

    ``hs_endpoint`` and ``hs_bank`` are captured by the returned tool closures.
    Missing values return an empty tuple so callers can degrade gracefully.
    ``client_factory`` is the test seam.

    Closure-captures retain/reflect Bedrock model IDs from
    ``HINDSIGHT_API_RETAIN_LLM_MODEL`` / ``HINDSIGHT_API_REFLECT_LLM_MODEL``
    at registration time. Subsequent env mutation does not affect the
    captured values; that lockstep matches what the prior monkey-patch
    install() did.
    """

    if not hs_endpoint or not hs_bank:
        return ()

    if client_factory is None:
        client_factory = _make_client_factory(hs_endpoint)

    # Snapshot the cost-attribution model IDs at registration time so
    # they cannot drift mid-turn under env shadowing.
    retain_model = os.environ.get("HINDSIGHT_API_RETAIN_LLM_MODEL", "openai.gpt-oss-20b-1:0")
    reflect_model = os.environ.get("HINDSIGHT_API_REFLECT_LLM_MODEL", "openai.gpt-oss-120b-1:0")

    # Lazy import so test code can patch the module before it loads.
    import hindsight_usage_capture

    async def _close_client(client: Any, *, tool_name: str) -> None:
        try:
            close = getattr(client, "aclose", None)
            if close is None:
                return
            result = close()
            if inspect.isawaitable(result):
                await result
        except Exception as close_err:  # pragma: no cover - defensive log only
            logger.warning("%s aclose failed: %s", tool_name, close_err)

    @strands_tool
    async def retain(content: str) -> str:
        """Save a fact, observation, or insight to long-term Hindsight memory.

        Use this when the user shares information you should remember across
        sessions: preferences, decisions, contacts, recurring projects, prior
        work context. The content is sent verbatim to Hindsight; phrase it as
        the durable fact you want preserved (e.g. "Marco prefers Slack over
        email for code review pings").

        Returns a confirmation string when the memory was stored, or an
        error description if storage failed. Best-effort — failures do not
        propagate.
        """
        last_exc: Exception | None = None
        for attempt in range(3):
            client = client_factory()
            try:
                response = await client.aretain_batch(
                    bank_id=hs_bank,
                    items=[{"content": content, "tags": list(hs_tags or [])}],
                )
                # Push Bedrock token usage in-body so cost_events keeps
                # one row per retain call (matches the prior install()
                # behavior). _push no-ops on missing/zero usage.
                hindsight_usage_capture._push(
                    "retain", retain_model, getattr(response, "usage", None)
                )
                return "Memory stored."
            except Exception as err:
                last_exc = err
                if attempt < 2 and _is_transient_error(err):
                    backoff = 1.0 * (2**attempt)
                    logger.warning(
                        "retain attempt %d/3 transient failure, retrying in %.1fs: %s",
                        attempt + 1,
                        backoff,
                        str(err)[:200],
                    )
                    await asyncio.sleep(backoff)
                    continue
                logger.error("retain failed (attempt %d/3): %s", attempt + 1, err)
                return f"Memory storage failed: {err}"
            finally:
                await _close_client(client, tool_name="retain")
        return f"Memory storage failed: {last_exc}"

    @strands_tool
    async def hindsight_recall(query: str) -> str:
        """Search Hindsight-only memory for facts about people, companies, projects, places, and prior conversations.

        Prefer `recall()` for normal user-facing memory lookup. `recall()`
        returns one grouped result from managed memory, Hindsight, and the
        user's compiled wiki pages, so it is the right first tool for fresh or
        specific facts. Use `hindsight_recall` only when you specifically need
        raw Hindsight facts after `recall()` was incomplete, or when the user
        explicitly asks you to inspect Hindsight.

        Use `recall()` first when the user asks ANY of:
          * "Where does <person> work?"
          * "Who is <person>?"
          * "What do I know about <person/company/project>?"
          * "Tell me about <X>"
          * "Have we talked about <X> before?"
          * "What's the contact info for <X>?"
          * Any factual recall question naming a person, company, customer,
            product, location, or event.

        DO NOT use `search_users` for these — that tool only finds Thinkwork
        platform teammates (people with login accounts on this app), not
        people you have learned about in conversations.

        DO NOT use CRM tools (`accounts`, `contacts`, `leads`,
        `opportunities`) as the FIRST step for general "who is X" or "where
        does X work" questions. Always try `recall()` FIRST. Only fall back to
        CRM tools if recall returns no relevant memory/wiki facts AND you have
        a specific reason to believe the person is a CRM record.

        The query is matched via multi-strategy retrieval (semantic + BM25 +
        entity graph + temporal) and reranked by a cross-encoder. Phrase the
        query as the question you want answered, not just keywords. Returns a
        numbered list of matching memory facts.

        FOLLOW-UP WHEN USING THIS HINDSIGHT-ONLY TOOL: For any "tell me about
        X", "what do you know about Y", "summarize Z", "brief me on W", or
        similar open-ended Hindsight-only investigation, call
        `hindsight_reflect` in the SAME turn after this tool returns. Recall
        surfaces the raw Hindsight facts; reflect runs a larger LLM over those
        facts to produce a coherent narrative answer with reasoning across
        multiple memories. Skipping reflect for these question shapes leaves
        the user with a flat list instead of a synthesized briefing.

        The ONLY case where you may skip the reflect follow-up is a narrowly
        scoped factual lookup with a single expected answer, e.g. "what is X's
        email address?", "where does Y work?", "when did we last talk about
        Z?". For anything broader, run BOTH tools.
        """
        last_exc: Exception | None = None
        for attempt in range(3):
            client = client_factory()
            try:
                response = await client.arecall(
                    bank_id=hs_bank,
                    query=query,
                    budget="low",
                    max_tokens=1500,
                )
                raw = getattr(response, "results", None) or []
                if not raw:
                    return "No relevant memories found."
                from hindsight_recall_filter import (
                    filter_recall_results,
                    format_results_for_agent,
                )

                filtered = filter_recall_results(raw, query)
                return format_results_for_agent(filtered)
            except Exception as err:
                last_exc = err
                if attempt < 2 and _is_transient_error(err):
                    backoff = 1.0 * (2**attempt)
                    logger.warning(
                        "hindsight_recall attempt %d/3 transient failure, retrying in %.1fs: %s",
                        attempt + 1,
                        backoff,
                        str(err)[:200],
                    )
                    await asyncio.sleep(backoff)
                    continue
                logger.error("hindsight_recall failed (attempt %d/3): %s", attempt + 1, err)
                return f"Memory recall failed: {err}"
            finally:
                await _close_client(client, tool_name="hindsight_recall")
        return f"Memory recall failed: {last_exc}"

    @strands_tool
    async def hindsight_reflect(query: str) -> str:
        """Synthesize a narrative answer over many long-term memory facts at once.

        PAIRING WITH hindsight_recall: This tool is the second half of a
        two-step flow. The correct order is:

          1. `hindsight_recall(query)` → returns the raw matching facts
          2. `hindsight_reflect(query)` → returns a synthesized narrative
              answer over those facts

        You should call BOTH tools in the same turn for ANY open-ended memory
        question:

          * "What do you know about <X>?"
          * "Tell me about <person/company/project>"
          * "Summarize what we know about <X>"
          * "Brief me on <account>"
          * "What are the key relationships between <A> and <B>?"

        Reflect runs a larger LLM behind the scenes (more expensive than
        recall), so the only case where you may SKIP reflect is a narrowly
        scoped factual lookup with a single expected answer. For anything
        broader — anything that asks for context, summary, briefing,
        narrative, or synthesis — run reflect after recall.
        """
        last_exc: Exception | None = None
        for attempt in range(3):
            client = client_factory()
            try:
                response = await client.areflect(
                    bank_id=hs_bank,
                    query=query,
                    budget="mid",
                )
                # Push Bedrock token usage in-body (U9). _push no-ops on
                # missing/zero usage so a cheap reflect with no Bedrock
                # spend does not leak a row.
                hindsight_usage_capture._push(
                    "reflect", reflect_model, getattr(response, "usage", None)
                )
                return getattr(response, "text", None) or "No relevant memories found."
            except Exception as err:
                last_exc = err
                if attempt < 2 and _is_transient_error(err):
                    backoff = 1.0 * (2**attempt)
                    logger.warning(
                        "hindsight_reflect attempt %d/3 transient failure, retrying in %.1fs: %s",
                        attempt + 1,
                        backoff,
                        str(err)[:200],
                    )
                    await asyncio.sleep(backoff)
                    continue
                logger.error("hindsight_reflect failed (attempt %d/3): %s", attempt + 1, err)
                return f"Memory reflect failed: {err}"
            finally:
                await _close_client(client, tool_name="hindsight_reflect")
        return f"Memory reflect failed: {last_exc}"

    logger.info(
        "Hindsight tools registered: custom retain + hindsight_recall/reflect bank=%s tags=%s timeout=300s",
        hs_bank,
        list(hs_tags or []),
    )
    return (retain, hindsight_recall, hindsight_reflect)


__all__ = ["make_hindsight_tools"]
