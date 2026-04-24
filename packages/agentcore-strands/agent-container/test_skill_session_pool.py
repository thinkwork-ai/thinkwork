"""Tests for SkillSessionPool.

Run with:
    uv run --no-project --with pytest --with pytest-asyncio \
        pytest packages/agentcore-strands/agent-container/test_skill_session_pool.py
"""

from __future__ import annotations

import asyncio
import time
from contextlib import contextmanager

import pytest
import pytest_asyncio  # noqa: F401  -- registers asyncio plugin
from skill_session_pool import SkillSessionPool


@contextmanager
def frozen_time(monkeypatch, start: float = 1000.0):
    """Freeze skill_session_pool's time.monotonic at a controllable value."""
    import skill_session_pool as mod

    now = {"t": start}
    monkeypatch.setattr(mod.time, "monotonic", lambda: now["t"])
    yield now


class FakeAgentCore:
    """In-memory stand-in for the AgentCore Code Interpreter control API."""

    def __init__(self) -> None:
        self.started: list[tuple[str, int]] = []
        self.stopped: list[tuple[str, str]] = []
        self._counter = 0

    async def start(self, interpreter_id: str, timeout_s: int) -> str:
        self._counter += 1
        self.started.append((interpreter_id, timeout_s))
        await asyncio.sleep(0)  # give tests an opportunity to race
        return f"sess-{self._counter}"

    async def stop(self, interpreter_id: str, session_id: str) -> None:
        self.stopped.append((interpreter_id, session_id))
        await asyncio.sleep(0)


def _pool(ac: FakeAgentCore, **kwargs) -> SkillSessionPool:
    return SkillSessionPool(
        interpreter_id="ipi-test",
        start_session=ac.start,
        stop_session=ac.stop,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Acquire + reuse
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_acquire_starts_a_fresh_session_when_no_warm():
    ac = FakeAgentCore()
    pool = _pool(ac)
    handle = await pool.acquire(("tenant-a", "user-a", "dev"))

    assert handle.session_id == "sess-1"
    assert handle.interpreter_id == "ipi-test"
    assert handle.key == ("tenant-a", "user-a", "dev")
    assert len(ac.started) == 1


@pytest.mark.asyncio
async def test_release_allows_reuse_on_same_key():
    ac = FakeAgentCore()
    pool = _pool(ac)
    key = ("tenant-a", "user-a", "dev")

    h1 = await pool.acquire(key)
    await h1.release()
    h2 = await pool.acquire(key)

    assert h1.session_id == h2.session_id
    assert len(ac.started) == 1, "second acquire should reuse the released session"


@pytest.mark.asyncio
async def test_concurrent_acquires_on_same_key_do_not_double_start():
    ac = FakeAgentCore()
    pool = _pool(ac)
    key = ("tenant-a", "user-a", "dev")

    h1, h2 = await asyncio.gather(pool.acquire(key), pool.acquire(key))
    # Both callers must have received distinct sessions (one slot in use,
    # so the second acquire starts a new one) — but never more starts
    # than acquires.
    assert len(ac.started) == 2
    assert h1.session_id != h2.session_id


# ---------------------------------------------------------------------------
# LRU cap + eviction
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_free_session_is_reused_before_eviction_fires():
    # Sequential acquire/release patterns never need eviction — the warm
    # slot gets reused every time. This is the common-case path the pool
    # is optimised for.
    ac = FakeAgentCore()
    pool = _pool(ac, max_per_key=2)
    key = ("tenant-a", "user-a", "dev")

    for _ in range(5):
        h = await pool.acquire(key)
        await h.release()

    assert len(ac.started) == 1
    assert len(ac.stopped) == 0
    assert pool.size_for_key(key) == 1


@pytest.mark.asyncio
async def test_lru_evicts_stale_free_slots_before_starting_a_fresh_one(monkeypatch):
    # Eviction fires when the bucket is at cap and every existing slot is
    # idle-expired. Common real trigger: a burst finishes, the sessions sit
    # idle, and the next burst hits after the idle window has closed but
    # before prune_idle fires.
    ac = FakeAgentCore()
    pool = _pool(ac, max_per_key=2, idle_timeout_s=10)
    key = ("tenant-a", "user-a", "dev")

    with frozen_time(monkeypatch, start=1000.0) as clock:
        # Grow the bucket to cap by holding two sessions concurrently.
        h1 = await pool.acquire(key)
        h2 = await pool.acquire(key)
        assert pool.size_for_key(key) == 2
        await h1.release()
        await h2.release()

        # Age both warm slots past the idle timeout.
        clock["t"] = 2000.0

        # Third acquire: _take_warm skips both (idle-expired);
        # _start_fresh finds bucket at cap (2), evicts the LRU free slot,
        # starts a new session.
        h3 = await pool.acquire(key)

        # Let the fire-and-forget stop task run.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

        stopped_ids = {sid for (_, sid) in ac.stopped}
        # At least the LRU evictee landed in the stop record.
        assert h1.session_id in stopped_ids
        assert h3.session_id not in stopped_ids

        await h3.release()


@pytest.mark.asyncio
async def test_in_use_session_is_never_evicted_even_beyond_cap():
    ac = FakeAgentCore()
    pool = _pool(ac, max_per_key=1)
    key = ("tenant-a", "user-a", "dev")

    h1 = await pool.acquire(key)  # in use
    # Second acquire on same key while h1 is held: cap forces a fresh start,
    # but h1 must NOT be stopped.
    h2 = await pool.acquire(key)
    assert h1.session_id != h2.session_id
    assert not any(sid == h1.session_id for (_, sid) in ac.stopped)
    await h1.release()
    await h2.release()


# ---------------------------------------------------------------------------
# Idle pruning
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_prune_idle_stops_sessions_older_than_timeout(monkeypatch):
    ac = FakeAgentCore()
    pool = _pool(ac, idle_timeout_s=10)
    key = ("tenant-a", "user-a", "dev")

    with frozen_time(monkeypatch, start=1000.0) as clock:
        h = await pool.acquire(key)
        await h.release()
        assert pool.size() == 1

        # Still fresh.
        clock["t"] = 1005.0
        stopped = await pool.prune_idle()
        assert stopped == 0
        assert pool.size() == 1

        # Older than the timeout → pruned.
        clock["t"] = 1020.0
        stopped = await pool.prune_idle()
        assert stopped == 1
        assert pool.size() == 0
    assert len(ac.stopped) == 1


# ---------------------------------------------------------------------------
# Flush hooks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flush_for_tenant_only_stops_that_tenants_sessions():
    ac = FakeAgentCore()
    pool = _pool(ac)

    ha = await pool.acquire(("tenant-a", "user-1", "dev"))
    hb = await pool.acquire(("tenant-b", "user-2", "dev"))
    await ha.release()
    await hb.release()

    stopped = await pool.flush_for_tenant("tenant-a")

    assert stopped == 1
    # tenant-b's session is untouched.
    assert pool.size_for_key(("tenant-b", "user-2", "dev")) == 1
    assert ac.stopped == [("ipi-test", ha.session_id)]


@pytest.mark.asyncio
async def test_flush_all_stops_every_pooled_session():
    ac = FakeAgentCore()
    pool = _pool(ac)

    h1 = await pool.acquire(("tenant-a", "user-a", "dev"))
    await h1.release()
    h2 = await pool.acquire(("tenant-b", "user-b", "dev"))
    await h2.release()

    stopped = await pool.flush_all()

    assert stopped == 2
    assert pool.size() == 0
    assert len(ac.stopped) == 2
