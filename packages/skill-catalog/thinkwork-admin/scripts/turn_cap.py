"""Per-turn mutation cap for the thinkwork-admin skill.

Unit 9 of the thinkwork-admin plan (R19a). Caps how many mutations a
single agent turn can issue — default 50, overridable per-agent via
`agent_skills.permissions.maxMutationsPerTurn`. Reads do NOT increment
the counter; only mutation wrappers call `check_and_increment`.

Keyed by `(tenant_id, thread_id, turn_id)` so a warm container serving
multiple tenants can't have one tenant's counter leak into another's.

## Turn boundary resolution

The runtime doesn't always plumb a stable turn id, so `_resolve_turn_id`
falls back in this order:

1. `CURRENT_TURN_ID` env — set by the runtime if available.
2. `_INSTANCE_ID` env — AgentCore's per-invocation id (`server.py`
   sets this today). Not a true turn id, but stable across the
   invocation, which is close enough: a new invocation resets the
   counter, and within an invocation the agent can't exceed the cap.
3. A module-scoped counter bumped on first call per `(tenant, thread)`
   pair. This is the last-resort fallback — worst case the cap is
   enforced per-thread-lifetime rather than per-turn, which is still
   meaningful protection.

The plan explicitly defers "exact turn-boundary detection" to
implementation (Unit 9 §Deferred to Implementation).
"""

from __future__ import annotations

import os
from typing import Callable

DEFAULT_MAX_MUTATIONS_PER_TURN = 50


class TurnCapExceeded(Exception):
    """Raised when a mutation would exceed the agent's per-turn cap.

    Carries the cap + count so the wrapper can emit a structured audit
    event (Unit 12) and the agent can reason about "how many have I
    issued vs how many I'm allowed."
    """

    def __init__(self, *, count: int, cap: int) -> None:
        super().__init__(
            f"turn_cap_exceeded: issued {count} mutations, cap is {cap}"
        )
        self.count = count
        self.cap = cap


# Module-scoped counter store. Key: (tenant_id, thread_id, turn_id).
# Cleared between invocations by the container's warm-container cleanup
# (Unit 1's invocation_env.cleanup_invocation_env unsets the env keys;
# the next invocation resolves a fresh turn_id and starts at 0).
_counters: dict[tuple[str, str, str], int] = {}

# Last-resort thread-pair counter — see module docstring fallback #3.
_fallback_turn_for_pair: dict[tuple[str, str], int] = {}
_next_fallback_turn_id = 1


def _resolve_turn_id(tenant_id: str, thread_id: str) -> str:
    """Pick a stable key to scope this turn's mutation counter.

    Tries env-provided turn / instance ids first, falls back to a
    module-scoped counter bumped on first-seen-(tenant, thread).
    """
    env_turn = os.environ.get("CURRENT_TURN_ID", "")
    if env_turn:
        return env_turn
    instance_id = os.environ.get("_INSTANCE_ID", "")
    if instance_id:
        return instance_id
    # Last-resort fallback.
    global _next_fallback_turn_id
    key = (tenant_id, thread_id)
    if key not in _fallback_turn_for_pair:
        _fallback_turn_for_pair[key] = _next_fallback_turn_id
        _next_fallback_turn_id += 1
    return f"fallback:{_fallback_turn_for_pair[key]}"


def _resolve_cap(fetch_override: Callable[[], int | None] | None) -> int:
    """Resolve the effective cap for this turn.

    The override is a callable rather than a bare int so tests can
    control exactly when the lookup fires (lazy — no network call
    unless the cap is actually consulted).
    """
    if fetch_override is not None:
        try:
            override = fetch_override()
        except Exception:
            override = None
        if isinstance(override, int) and override > 0:
            return override
    return DEFAULT_MAX_MUTATIONS_PER_TURN


def check_and_increment(
    *,
    fetch_override: Callable[[], int | None] | None = None,
    tenant_id: str | None = None,
    thread_id: str | None = None,
) -> int:
    """Bump the counter for the current turn and return the new count.

    Raises `TurnCapExceeded` when the counter would exceed the cap —
    the counter is NOT incremented past the cap, so repeated calls
    after refusal stay pinned at `cap` rather than drifting upward.

    Reads must NOT call this; only mutation wrappers.
    """
    t_id = tenant_id or os.environ.get("TENANT_ID") or os.environ.get(
        "_MCP_TENANT_ID", ""
    )
    th_id = thread_id or os.environ.get("CURRENT_THREAD_ID", "")
    turn_id = _resolve_turn_id(t_id, th_id)

    key = (t_id, th_id, turn_id)
    current = _counters.get(key, 0)
    cap = _resolve_cap(fetch_override)

    if current >= cap:
        raise TurnCapExceeded(count=current, cap=cap)

    _counters[key] = current + 1
    return _counters[key]


def current_count(
    *, tenant_id: str | None = None, thread_id: str | None = None
) -> int:
    """Read-only helper for the audit log (Unit 12) + tests.

    Does NOT bump the counter. Returns 0 for turns that have never
    been incremented.
    """
    t_id = tenant_id or os.environ.get("TENANT_ID") or os.environ.get(
        "_MCP_TENANT_ID", ""
    )
    th_id = thread_id or os.environ.get("CURRENT_THREAD_ID", "")
    turn_id = _resolve_turn_id(t_id, th_id)
    return _counters.get((t_id, th_id, turn_id), 0)


def reset_for_tests() -> None:
    """Clear all counters — for use in pytest setUp/tearDown only."""
    global _next_fallback_turn_id
    _counters.clear()
    _fallback_turn_for_pair.clear()
    _next_fallback_turn_id = 1


__all__ = [
    "DEFAULT_MAX_MUTATIONS_PER_TURN",
    "TurnCapExceeded",
    "check_and_increment",
    "current_count",
    "reset_for_tests",
]
