"""Hindsight Bedrock-usage capture and asyncio loop fix.

This module hosts two unrelated pieces — kept together because they are
both Hindsight-client-specific patches with similar shape, but they are
on independent axes and should not be confused.

1. **Usage capture helpers** (``_push`` / ``_lock`` / ``_usage_log`` /
   ``drain`` / ``reset``).

   The agent's tool wrappers in ``hindsight_tools.py`` call ``_push``
   in-body after each ``aretain_batch`` / ``areflect`` response with
   ``response.usage``. ``drain()`` returns and clears the captured
   entries; ``_call_strands_agent`` drains at the end of each invoke and
   ships the entries back to ``chat-agent-invoke`` as
   ``hindsight_usage: [...]``, which writes one ``cost_events`` row per
   entry attributing the Bedrock spend to the originating agent/tenant.

   The previous ``install()`` function monkey-patched
   ``Hindsight.retain_batch`` / ``Hindsight.reflect`` (sync + async) at
   module scope. That has been retired in favor of the in-body push
   pattern in ``hindsight_tools.py`` — ``install()`` no longer exists
   and importing this module has no side effects beyond defining the
   helper surface. Recall has no Bedrock cost (local embeddings +
   Postgres) so it is intentionally not captured.

   The usage_log is a module-level list and the agent container
   processes one request at a time per process, so a plain list is safe;
   do not share it across threads.

2. **Asyncio loop fix** (``install_loop_fix``) — separate axis.
   ``hindsight_client._run_async`` is replaced with one that always
   creates a fresh asyncio event loop per call and closes it after.
   The shipped 0.4.22 version reuses loops via
   ``asyncio.get_event_loop()``, which combined with
   ``hindsight-strands._run_in_thread``'s ``ThreadPoolExecutor``
   (max_workers=4) thread reuse leaves stale loop state on the second
   invocation in the same worker thread. That stale state causes
   aiohttp's internal ``asyncio.timeout()`` to raise ``Timeout context
   manager should be used inside a task`` mid-request. The fresh-loop
   replacement avoids the issue entirely.

   Upstream: same root cause as ``vectorize-io/hindsight#677`` and
   ``#880``. Both were closed but the fix only landed in
   ``hindsight-hermes`` — ``hindsight-client`` and ``hindsight-strands``
   still have the buggy ``_run_async``. ``install_loop_fix`` is kept
   here on its own axis; the U10 retirement only applies to the usage
   capture monkey-patches.

   ``install_loop_fix`` is lock-guarded and idempotent — calling it
   twice is a no-op.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_loop_fix_installed = False
_usage_log: list[dict[str, Any]] = []


def _push(phase: str, model: str, usage: Any) -> None:
    """Append one usage entry to the log. Best-effort; never raises.

    Called in-body by ``hindsight_tools.retain`` and
    ``hindsight_tools.hindsight_reflect`` after each Hindsight API call.
    """
    if usage is None:
        return
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


def install_loop_fix() -> bool:
    """Replace ``hindsight_client._run_async`` with a fresh-loop variant.

    The shipped 0.4.22 implementation does::

        loop = asyncio.get_event_loop()  # may return stale loop
        return loop.run_until_complete(coro)

    Combined with hindsight-strands' ``_run_in_thread`` thread pool reuse,
    this leaves stale event loop state on the second call from the same
    worker thread. Inside aiohttp the stale state causes
    ``asyncio.timeout()`` to raise "Timeout context manager should be used
    inside a task" mid-request.

    The replacement always creates a brand-new loop, runs the coroutine,
    and closes the loop. No reuse, no stale state. Returns True on first
    install, False if already installed or if hindsight_client isn't
    importable. This is on a separate axis from usage capture and
    intentionally remains a monkey-patch — it works around a vendor SDK
    bug, not a Thinkwork-side concern.
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
