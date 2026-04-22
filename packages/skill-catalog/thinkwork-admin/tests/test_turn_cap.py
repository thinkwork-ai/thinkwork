"""Contract tests for Unit 9's per-turn mutation cap.

Invariants pinned:

1. Default cap = 50. `check_and_increment` succeeds 50 times and the
   51st raises `TurnCapExceeded`.
2. `fetch_override` lets the caller plumb `agent_skills.permissions.
   maxMutationsPerTurn` through at call time; the override wins over
   the default.
3. Reads don't increment. Only `check_and_increment` bumps the
   counter.
4. Tenant-scoped keying: two concurrent tenants sharing thread ids
   (possible in a warm container) do NOT collide.
5. After refusal, repeated calls stay pinned at `cap` — the counter
   never drifts past the limit even if the agent retries.
6. Env-driven turn rollover: changing `CURRENT_TURN_ID` (or the
   `_INSTANCE_ID` fallback) starts a fresh counter.
"""

from __future__ import annotations

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.normpath(os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, SCRIPTS_DIR)

import turn_cap  # noqa: E402

ENV_KEYS = ["TENANT_ID", "_MCP_TENANT_ID", "CURRENT_THREAD_ID",
            "CURRENT_TURN_ID", "_INSTANCE_ID"]


def _set_env(**overrides):
    originals = {k: os.environ.get(k) for k in ENV_KEYS}
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    for k, v in overrides.items():
        if v is not None:
            os.environ[k] = v

    def cleanup():
        for k, v in originals.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        turn_cap.reset_for_tests()

    return cleanup


class DefaultCapTests(unittest.TestCase):
    def setUp(self):
        turn_cap.reset_for_tests()

    def tearDown(self):
        turn_cap.reset_for_tests()

    def test_default_cap_is_50(self):
        self.assertEqual(turn_cap.DEFAULT_MAX_MUTATIONS_PER_TURN, 50)

    def test_50_calls_succeed_51st_raises(self):
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for i in range(50):
                turn_cap.check_and_increment()
            with self.assertRaises(turn_cap.TurnCapExceeded) as cm:
                turn_cap.check_and_increment()
            self.assertEqual(cm.exception.cap, 50)
            self.assertEqual(cm.exception.count, 50)
        finally:
            cleanup()

    def test_count_stays_pinned_at_cap_after_refusal(self):
        """Agent retries after refusal don't drift the counter past
        the limit — the post-refusal count is still `cap`, not
        `cap + retries`."""
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(50):
                turn_cap.check_and_increment()
            for _ in range(5):
                with self.assertRaises(turn_cap.TurnCapExceeded):
                    turn_cap.check_and_increment()
            self.assertEqual(turn_cap.current_count(), 50)
        finally:
            cleanup()


class OverrideTests(unittest.TestCase):
    def setUp(self):
        turn_cap.reset_for_tests()

    def tearDown(self):
        turn_cap.reset_for_tests()

    def test_override_raises_the_cap(self):
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(100):
                turn_cap.check_and_increment(fetch_override=lambda: 100)
            with self.assertRaises(turn_cap.TurnCapExceeded) as cm:
                turn_cap.check_and_increment(fetch_override=lambda: 100)
            self.assertEqual(cm.exception.cap, 100)
        finally:
            cleanup()

    def test_override_lowers_the_cap(self):
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(5):
                turn_cap.check_and_increment(fetch_override=lambda: 5)
            with self.assertRaises(turn_cap.TurnCapExceeded):
                turn_cap.check_and_increment(fetch_override=lambda: 5)
        finally:
            cleanup()

    def test_nonpositive_override_falls_through_to_default(self):
        """A broken override (0 or negative) must not accidentally
        disable the cap."""
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(50):
                turn_cap.check_and_increment(fetch_override=lambda: 0)
            with self.assertRaises(turn_cap.TurnCapExceeded):
                turn_cap.check_and_increment(fetch_override=lambda: 0)
        finally:
            cleanup()

    def test_override_that_throws_falls_through_to_default(self):
        """If the DB lookup fails (e.g., transient), fail-safe to the
        default cap — never infinitely allow."""
        def boom():
            raise RuntimeError("DB down")
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(50):
                turn_cap.check_and_increment(fetch_override=boom)
            with self.assertRaises(turn_cap.TurnCapExceeded) as cm:
                turn_cap.check_and_increment(fetch_override=boom)
            self.assertEqual(cm.exception.cap, 50)
        finally:
            cleanup()


class TenantIsolationTests(unittest.TestCase):
    def setUp(self):
        turn_cap.reset_for_tests()

    def tearDown(self):
        turn_cap.reset_for_tests()

    def test_tenant_ids_isolate_counters(self):
        """Warm container serves tenant-A turn-1 then tenant-B turn-1
        (identical thread_id + turn_id strings). They must NOT share
        a counter."""
        turn_cap.check_and_increment(
            tenant_id="tenant-A", thread_id="thread-1"
        )
        self.assertEqual(
            turn_cap.current_count(tenant_id="tenant-A", thread_id="thread-1"),
            1,
        )
        self.assertEqual(
            turn_cap.current_count(tenant_id="tenant-B", thread_id="thread-1"),
            0,
        )

    def test_thread_ids_isolate_within_tenant(self):
        turn_cap.check_and_increment(
            tenant_id="tenant-A", thread_id="thread-1"
        )
        self.assertEqual(
            turn_cap.current_count(tenant_id="tenant-A", thread_id="thread-1"),
            1,
        )
        self.assertEqual(
            turn_cap.current_count(tenant_id="tenant-A", thread_id="thread-2"),
            0,
        )


class TurnRolloverTests(unittest.TestCase):
    def setUp(self):
        turn_cap.reset_for_tests()

    def tearDown(self):
        turn_cap.reset_for_tests()

    def test_new_turn_id_resets_counter(self):
        """Env-driven turn rollover: flip CURRENT_TURN_ID and the
        counter for the new (tenant, thread, turn) tuple starts at 0."""
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(50):
                turn_cap.check_and_increment()
            with self.assertRaises(turn_cap.TurnCapExceeded):
                turn_cap.check_and_increment()
            # Rollover
            os.environ["CURRENT_TURN_ID"] = "turn-2"
            # Fresh counter — no refusal.
            turn_cap.check_and_increment()
            self.assertEqual(turn_cap.current_count(), 1)
        finally:
            cleanup()

    def test_instance_id_fallback_used_when_turn_id_absent(self):
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            _INSTANCE_ID="inst-A",
        )
        try:
            turn_cap.check_and_increment()
            self.assertEqual(turn_cap.current_count(), 1)
            # Flipping _INSTANCE_ID rolls the turn over even without
            # an explicit CURRENT_TURN_ID env var.
            os.environ["_INSTANCE_ID"] = "inst-B"
            self.assertEqual(turn_cap.current_count(), 0)
        finally:
            cleanup()

    def test_fallback_turn_id_when_env_empty(self):
        """Neither CURRENT_TURN_ID nor _INSTANCE_ID set — module-scoped
        fallback keys off (tenant, thread). Still enforces a cap."""
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
        )
        try:
            turn_cap.check_and_increment()
            self.assertEqual(turn_cap.current_count(), 1)
        finally:
            cleanup()


class CurrentCountTests(unittest.TestCase):
    def setUp(self):
        turn_cap.reset_for_tests()

    def tearDown(self):
        turn_cap.reset_for_tests()

    def test_current_count_does_not_bump_counter(self):
        """Reads don't increment — covers the plan's explicit invariant
        that 100 reads + 50 mutations all succeed."""
        cleanup = _set_env(
            TENANT_ID="tenant-A",
            CURRENT_THREAD_ID="thread-1",
            CURRENT_TURN_ID="turn-1",
        )
        try:
            for _ in range(100):
                turn_cap.current_count()
            # Counter untouched; all 50 mutations still succeed.
            for _ in range(50):
                turn_cap.check_and_increment()
            self.assertEqual(turn_cap.current_count(), 50)
        finally:
            cleanup()


if __name__ == "__main__":
    unittest.main()
