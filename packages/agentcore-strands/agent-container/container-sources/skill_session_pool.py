"""Pool of AgentCore Code Interpreter sessions, keyed by (tenant, user, env).

Why a pool at all:
    Starting a fresh AgentCore session costs ~2–5 s. Skills fire from every
    turn and from compositions-within-turns. A per-call session model is
    visibly slow to end users. The pool reuses warm sessions for the next
    call on the same key.

Why user_id is in the pool key (security invariant SI-3):
    The AgentCore Code Interpreter preamble historically injected per-user
    OAuth tokens into the session's ``os.environ`` (v1). That specific vector
    was retired in the v2 preamble, but sharing a warm session across users
    still leaks more than it needs to — sys.modules, class patches, open file
    descriptors, skill-level globals, any lingering stdout pointer. Binding
    the pool key to ``user_id`` is the boundary that keeps those leaks scoped
    to one human, matching how AgentCore IAM + runtime permissions are scoped
    one level up.

Why LRU + idle eviction:
    AgentCore sessions are expensive to hold idle, and the Code Interpreter
    service is rate-limited on total live sessions per account. 8 live
    sessions per (tenant, user) is a conservative cap for the pilot
    workload (4 enterprises × 100+ agents). 30-minute idle timeout sheds
    warm sessions that stopped serving calls. Both are knobs that can be
    tuned without touching callers.

Concurrency model:
    Callers are async. Two tasks that call ``acquire`` for the same key
    concurrently must not race each other into creating two sessions.
    We hold a short asyncio lock per key while starting the session; after
    that the handle is lent out for the life of a single dispatch call and
    returned on ``release``.

Flush hooks (U12 + plugin re-upload):
    Tenant kill-switch toggles and plugin re-uploads need to invalidate
    warm sessions so the next call picks up the new state. ``flush_for_tenant``
    and ``flush_all`` are the entry points; the caller decides when to fire
    them.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

# Default caps — tuned per plan #007 §U4 Approach. Exposed as constructor
# kwargs so test harnesses can override.
DEFAULT_MAX_PER_KEY = 8
DEFAULT_IDLE_TIMEOUT_S = 30 * 60
DEFAULT_SESSION_TIMEOUT_S = 60 * 60

# Pool key shape. Keep tuples instead of a dataclass so the key is
# hashable without a custom __hash__ and cheap to log.
PoolKey = tuple[str, str, str]  # (tenant_id, user_id, environment)


@dataclass
class PooledSession:
    """One AgentCore Code Interpreter session plus bookkeeping."""

    session_id: str
    interpreter_id: str
    key: PoolKey
    created_at: float
    last_used_at: float
    # Set while a dispatch call owns this session; prevents a second caller
    # from picking it up mid-run. Each per-session lock is distinct, not a
    # pool-wide lock.
    in_use: bool = False
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def touch(self) -> None:
        self.last_used_at = time.monotonic()

    def is_idle_beyond(self, idle_timeout_s: float) -> bool:
        return (time.monotonic() - self.last_used_at) >= idle_timeout_s


class SessionHandle:
    """Lent-out view of a pooled session. Released back to the pool on exit."""

    def __init__(self, pool: "SkillSessionPool", pooled: PooledSession) -> None:
        self._pool = pool
        self._pooled = pooled

    @property
    def session_id(self) -> str:
        return self._pooled.session_id

    @property
    def interpreter_id(self) -> str:
        return self._pooled.interpreter_id

    @property
    def key(self) -> PoolKey:
        return self._pooled.key

    async def release(self) -> None:
        await self._pool._release(self._pooled)


class SkillSessionPool:
    """Async pool of sandbox sessions, keyed by ``(tenant_id, user_id, env)``."""

    def __init__(
        self,
        interpreter_id: str,
        *,
        start_session: Callable[[str, int], Awaitable[str]],
        stop_session: Callable[[str, str], Awaitable[None]],
        max_per_key: int = DEFAULT_MAX_PER_KEY,
        idle_timeout_s: int = DEFAULT_IDLE_TIMEOUT_S,
        session_timeout_s: int = DEFAULT_SESSION_TIMEOUT_S,
    ) -> None:
        self._interpreter_id = interpreter_id
        self._start_session = start_session
        self._stop_session = stop_session
        self._max_per_key = max_per_key
        self._idle_timeout_s = idle_timeout_s
        self._session_timeout_s = session_timeout_s
        # OrderedDict per key lets us pop the LRU session when we hit the cap.
        self._sessions: dict[PoolKey, OrderedDict[str, PooledSession]] = {}
        # One per-key lock serialises concurrent acquires on that key.
        self._key_locks: dict[PoolKey, asyncio.Lock] = {}
        # Pool-wide lock guards the dict bookkeeping itself; never held during
        # the actual start_session IO call.
        self._mutex = asyncio.Lock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def acquire(self, key: PoolKey) -> SessionHandle:
        """Return a ready-to-use SessionHandle for ``key``.

        Prefers a free warm session; evicts LRU if at cap; starts a fresh
        session otherwise. Idle-timeout expiry is evaluated inline so we
        never hand out a session that has aged out.
        """
        key_lock = await self._get_key_lock(key)
        async with key_lock:
            pooled = self._take_warm(key)
            if pooled is None:
                pooled = await self._start_fresh(key)
            pooled.in_use = True
            pooled.touch()
            return SessionHandle(self, pooled)

    async def flush_for_tenant(self, tenant_id: str) -> int:
        """Tear down every session whose key starts with ``tenant_id``.

        Used by U12's kill-switch toggle path: when a tenant changes their
        ``disabled_builtin_tools``, the next session for that tenant must
        pick up the new filter, so warm sessions are invalidated.
        """
        to_stop: list[PooledSession] = []
        async with self._mutex:
            for key in list(self._sessions.keys()):
                if key[0] == tenant_id:
                    bucket = self._sessions.pop(key, None)
                    if bucket:
                        to_stop.extend(bucket.values())
        return await self._stop_batch(to_stop)

    async def flush_all(self) -> int:
        """Tear down every pooled session. For ops ``thinkwork flush`` paths."""
        to_stop: list[PooledSession] = []
        async with self._mutex:
            for bucket in self._sessions.values():
                to_stop.extend(bucket.values())
            self._sessions.clear()
        return await self._stop_batch(to_stop)

    async def prune_idle(self) -> int:
        """Evict sessions older than the idle timeout. Safe to call periodically.

        Not called on a timer from inside the pool — the runtime's main loop
        decides cadence. Exposed so tests can advance time explicitly.
        """
        to_stop: list[PooledSession] = []
        async with self._mutex:
            for key, bucket in list(self._sessions.items()):
                for sess_id in list(bucket.keys()):
                    pooled = bucket[sess_id]
                    if pooled.in_use:
                        continue
                    if pooled.is_idle_beyond(self._idle_timeout_s):
                        del bucket[sess_id]
                        to_stop.append(pooled)
                if not bucket:
                    del self._sessions[key]
        return await self._stop_batch(to_stop)

    def size(self) -> int:
        return sum(len(bucket) for bucket in self._sessions.values())

    def size_for_key(self, key: PoolKey) -> int:
        return len(self._sessions.get(key, {}))

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    async def _get_key_lock(self, key: PoolKey) -> asyncio.Lock:
        async with self._mutex:
            lock = self._key_locks.get(key)
            if lock is None:
                lock = asyncio.Lock()
                self._key_locks[key] = lock
            return lock

    def _take_warm(self, key: PoolKey) -> PooledSession | None:
        bucket = self._sessions.get(key)
        if not bucket:
            return None
        for sess_id, pooled in list(bucket.items()):
            if pooled.in_use:
                continue
            if pooled.is_idle_beyond(self._idle_timeout_s):
                # Stale — the caller of acquire will start a fresh one. We
                # don't stop the session here; prune_idle handles that.
                continue
            # LRU bookkeeping: moving to the end keeps MRU on the right.
            bucket.move_to_end(sess_id)
            return pooled
        return None

    async def _start_fresh(self, key: PoolKey) -> PooledSession:
        # Evict the LRU *free* session for this key if we're at cap. A
        # session that's in_use cannot be evicted; if every slot is in use
        # we exceed the cap momentarily — the pool size is a soft upper
        # bound to keep a burst from starving concurrent callers.
        async with self._mutex:
            bucket = self._sessions.setdefault(key, OrderedDict())
            while len(bucket) >= self._max_per_key:
                evicted_id, evicted = next(
                    ((k, v) for k, v in bucket.items() if not v.in_use),
                    (None, None),
                )
                if evicted_id is None:
                    break
                del bucket[evicted_id]
                # Fire-and-forget the stop — the caller waits on start, not stop.
                asyncio.create_task(
                    self._stop_session(evicted.interpreter_id, evicted.session_id)
                )

        # Actual session start happens outside the mutex.
        session_id = await self._start_session(self._interpreter_id, self._session_timeout_s)
        now = time.monotonic()
        pooled = PooledSession(
            session_id=session_id,
            interpreter_id=self._interpreter_id,
            key=key,
            created_at=now,
            last_used_at=now,
        )
        async with self._mutex:
            self._sessions.setdefault(key, OrderedDict())[session_id] = pooled
        return pooled

    async def _release(self, pooled: PooledSession) -> None:
        pooled.in_use = False
        pooled.touch()

    async def _stop_batch(self, items: list[PooledSession]) -> int:
        count = 0
        for p in items:
            try:
                await self._stop_session(p.interpreter_id, p.session_id)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "skill-pool: stop_session failed for %s", p.session_id, exc_info=True
                )
            count += 1
        return count


__all__ = [
    "DEFAULT_IDLE_TIMEOUT_S",
    "DEFAULT_MAX_PER_KEY",
    "DEFAULT_SESSION_TIMEOUT_S",
    "PoolKey",
    "PooledSession",
    "SessionHandle",
    "SkillSessionPool",
]
