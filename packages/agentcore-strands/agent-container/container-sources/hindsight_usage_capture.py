"""PRD-41B Phase 7 — Hindsight client patches for the strands agent.

Two unrelated monkey-patches live here:

1. **Usage capture** (item 2) — `Hindsight.retain_batch` and
   `Hindsight.reflect` are wrapped to push the response.usage block onto
   a per-process list. _call_strands_agent drains the list at the end of
   each invoke and ships it back to chat-agent-invoke as
   `hindsight_usage: [...]`, which then writes one cost_events row per
   entry attributing the Bedrock spend to the originating agent/tenant.
   Recall has no Bedrock cost (local embeddings + Postgres) so it's not
   patched.

2. **Asyncio loop fix** (item 2 followup) — `hindsight_client._run_async`
   is replaced with one that always creates a fresh asyncio event loop
   per call and closes it after. The shipped 0.4.22 version reuses
   loops via `asyncio.get_event_loop()`, which combined with the
   `ThreadPoolExecutor(max_workers=4)` thread reuse in
   `hindsight-strands._run_in_thread` leaves stale loop state on the
   second invocation in the same worker thread. That stale state causes
   aiohttp's internal `asyncio.timeout()` to raise `Timeout context
   manager should be used inside a task` mid-request. The fresh-loop
   replacement avoids the issue entirely.

   Upstream: same root cause as vectorize-io/hindsight#677 and #880.
   Both were closed but the fix only landed in hindsight-hermes —
   hindsight-client and hindsight-strands still have the buggy
   `_run_async`.

The usage_log is a module-level list and the agent container processes
one request at a time per process, so a plain list is safe; do not
share it across threads. Both patches are lock-guarded and idempotent —
calling install() / install_loop_fix() twice is a no-op.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_installed = False
_loop_fix_installed = False
_usage_log: list[dict[str, Any]] = []


def _push(phase: str, model: str, usage: Any) -> None:
    """Append one usage entry to the log. Best-effort; never raises."""
    try:
        # usage is a TokenUsage pydantic model on RetainResponse / ReflectResponse
        in_tok = int(getattr(usage, "input_tokens", 0) or 0)
        out_tok = int(getattr(usage, "output_tokens", 0) or 0)
        if in_tok <= 0 and out_tok <= 0:
            return
        with _lock:
            _usage_log.append({
                "phase": phase,
                "model": model,
                "input_tokens": in_tok,
                "output_tokens": out_tok,
            })
    except Exception as e:
        logger.warning("hindsight_usage_capture _push failed: %s", e)


def install(retain_model: str = "openai.gpt-oss-20b-1:0",
            reflect_model: str = "openai.gpt-oss-120b-1:0") -> bool:
    """Monkey-patch Hindsight retain/reflect (sync + async) to capture usage.

    Returns True on first install, False if already installed or if the
    hindsight_client package isn't importable. Defaults match the
    HINDSIGHT_API_RETAIN_LLM_MODEL / HINDSIGHT_API_REFLECT_LLM_MODEL env
    vars set on the Hindsight ECS task in terraform.

    Note: the upstream class is named `Hindsight`, not `HindsightClient` —
    confirmed against vectorize-io/hindsight main on 2026-04-08. The
    hindsight-strands integration calls `client.retain(...)` which
    delegates to `self.retain_batch(...)`, so patching retain_batch alone
    is enough to cover both single (`retain`) and batch (`retain_batch`)
    sync callers — patching both would push the same usage twice for a
    single retain call.

    We patch BOTH the sync methods (`retain_batch`, `reflect`) and the
    async variants (`aretain_batch`, `areflect`). The agent's tool
    wrappers call the async variants directly to avoid `_run_async`'s
    stale-loop reuse, so without async-side patches `hindsight_usage`
    would silently drop to zero whenever the agent uses memory tools —
    a regression we hit after PR #24 made the wrappers async.
    """
    global _installed
    with _lock:
        if _installed:
            return False
        try:
            from hindsight_client import Hindsight
        except Exception as e:
            logger.warning("hindsight_usage_capture: hindsight_client.Hindsight not importable: %s", e)
            return False

        original_retain_batch = Hindsight.retain_batch
        original_reflect = Hindsight.reflect
        original_aretain_batch = getattr(Hindsight, "aretain_batch", None)
        original_areflect = getattr(Hindsight, "areflect", None)

        def patched_retain_batch(self, *args, **kwargs):
            resp = original_retain_batch(self, *args, **kwargs)
            usage = getattr(resp, "usage", None)
            if usage is not None:
                _push("retain", retain_model, usage)
            return resp

        def patched_reflect(self, *args, **kwargs):
            resp = original_reflect(self, *args, **kwargs)
            usage = getattr(resp, "usage", None)
            if usage is not None:
                _push("reflect", reflect_model, usage)
            return resp

        async def patched_aretain_batch(self, *args, **kwargs):
            resp = await original_aretain_batch(self, *args, **kwargs)
            usage = getattr(resp, "usage", None)
            if usage is not None:
                _push("retain", retain_model, usage)
            return resp

        async def patched_areflect(self, *args, **kwargs):
            resp = await original_areflect(self, *args, **kwargs)
            usage = getattr(resp, "usage", None)
            if usage is not None:
                _push("reflect", reflect_model, usage)
            return resp

        Hindsight.retain_batch = patched_retain_batch  # type: ignore[method-assign]
        Hindsight.reflect = patched_reflect  # type: ignore[method-assign]
        if original_aretain_batch is not None:
            Hindsight.aretain_batch = patched_aretain_batch  # type: ignore[method-assign]
        if original_areflect is not None:
            Hindsight.areflect = patched_areflect  # type: ignore[method-assign]

        _installed = True
        logger.info(
            "hindsight_usage_capture installed on Hindsight (retain=%s reflect=%s, async_patched=%s)",
            retain_model, reflect_model,
            (original_aretain_batch is not None) and (original_areflect is not None),
        )
        return True


def install_loop_fix() -> bool:
    """Replace `hindsight_client._run_async` with a fresh-loop variant.

    The shipped 0.4.22 implementation does:

        loop = asyncio.get_event_loop()  # may return stale loop
        return loop.run_until_complete(coro)

    Combined with hindsight-strands' `_run_in_thread` thread pool reuse,
    this leaves stale event loop state on the second call from the same
    worker thread. Inside aiohttp the stale state causes
    `asyncio.timeout()` to raise "Timeout context manager should be used
    inside a task" mid-request.

    The replacement always creates a brand-new loop, runs the coroutine,
    and closes the loop. No reuse, no stale state. Returns True on first
    install, False if already installed or if hindsight_client isn't
    importable.
    """
    global _loop_fix_installed
    with _lock:
        if _loop_fix_installed:
            return False
        try:
            import hindsight_client.hindsight_client as _hc_mod
        except Exception as e:
            logger.warning("hindsight_usage_capture: cannot import hindsight_client.hindsight_client: %s", e)
            return False

        def _run_async_fresh(coro):
            loop = asyncio.new_event_loop()
            try:
                return loop.run_until_complete(coro)
            finally:
                try:
                    loop.close()
                except Exception:
                    pass

        _hc_mod._run_async = _run_async_fresh  # type: ignore[attr-defined]
        _loop_fix_installed = True
        logger.info("hindsight_usage_capture: installed _run_async fresh-loop fix")
        return True


def drain() -> list[dict[str, Any]]:
    """Return all captured usage entries since the last drain and clear the log."""
    with _lock:
        out = list(_usage_log)
        _usage_log.clear()
        return out


def reset() -> None:
    """Clear the log without returning anything. Use at the start of an invoke."""
    with _lock:
        _usage_log.clear()
