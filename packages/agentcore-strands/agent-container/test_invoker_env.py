"""Tests for per-invocation env setup in server.py.

Unit 1 of the thinkwork-admin plan plumbs `CURRENT_USER_ID` into the
container's per-invocation env so downstream skills can trust it. Two
invariants matter:

1. The env aliases (`TENANT_ID`, `AGENT_ID`, `USER_ID`, `CURRENT_USER_ID`,
   `CURRENT_THREAD_ID`) are set consistently from the payload fields —
   regardless of whether the invocation goes through the normal path or
   the `kind="run_skill"` composition branch (which today returns before
   reaching the env block).

2. Warm-container reuse does not leak identity. After an invocation
   finishes, the env keys are cleared so the next invocation starts
   clean; two back-to-back invocations from different users must never
   see each other's IDs.

Run with:
    uv run --with pytest --no-project pytest \
        packages/agentcore-strands/agent-container/test_invoker_env.py
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import invocation_env  # noqa: E402


ENV_KEYS = [
    "TENANT_ID",
    "AGENT_ID",
    "USER_ID",
    "CURRENT_USER_ID",
    "CURRENT_THREAD_ID",
    "_MCP_TENANT_ID",
    "_MCP_AGENT_ID",
    "_MCP_USER_ID",
]


class ApplyInvocationEnvTests(unittest.TestCase):
    def setUp(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def tearDown(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def test_full_payload_sets_all_ids_including_current_user_id(self):
        """Happy path: chat invocation with full identity → CURRENT_USER_ID set."""
        payload = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "user_id": "user-a",
            "thread_id": "thread-a",
        }
        keys = invocation_env.apply_invocation_env(payload)
        self.assertEqual(os.environ.get("TENANT_ID"), "tenant-a")
        self.assertEqual(os.environ.get("AGENT_ID"), "agent-a")
        self.assertEqual(os.environ.get("USER_ID"), "user-a")
        self.assertEqual(os.environ.get("CURRENT_USER_ID"), "user-a")
        self.assertEqual(os.environ.get("CURRENT_THREAD_ID"), "thread-a")
        # MCP aliases stay consistent with existing container behavior.
        self.assertEqual(os.environ.get("_MCP_TENANT_ID"), "tenant-a")
        self.assertEqual(os.environ.get("_MCP_AGENT_ID"), "agent-a")
        self.assertEqual(os.environ.get("_MCP_USER_ID"), "user-a")
        # Helper returns the keys it set so the caller can clean up.
        self.assertIn("CURRENT_USER_ID", keys)
        self.assertIn("TENANT_ID", keys)

    def test_missing_user_id_does_not_set_current_user_id(self):
        """R15: no invoker → CURRENT_USER_ID stays unset.

        A webhook-triggered invocation (or a system-initiated wakeup) has
        no human invoker. The admin skill's `_env()` probe refuses when
        CURRENT_USER_ID is unset; setting it to an empty string would
        bypass that check.
        """
        payload = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "thread_id": "thread-a",
        }
        keys = invocation_env.apply_invocation_env(payload)
        self.assertIsNone(os.environ.get("CURRENT_USER_ID"))
        self.assertNotIn("CURRENT_USER_ID", keys)
        # Tenant + agent aliases still set; only CURRENT_USER_ID gates on
        # a real invoker.
        self.assertEqual(os.environ.get("TENANT_ID"), "tenant-a")
        self.assertEqual(os.environ.get("AGENT_ID"), "agent-a")

    def test_empty_string_user_id_treated_as_absent(self):
        """Edge case: upstream may pass user_id="" rather than omitting.

        R15 requires CURRENT_USER_ID to be unset, not blank, so skills
        can `os.environ['CURRENT_USER_ID']` and trust a KeyError as
        "no invoker."
        """
        payload = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "user_id": "",
            "thread_id": "thread-a",
        }
        invocation_env.apply_invocation_env(payload)
        self.assertIsNone(os.environ.get("CURRENT_USER_ID"))

    def test_missing_thread_id_skips_current_thread_id(self):
        """Edge case: no thread (e.g., wakeup without resolved thread)."""
        payload = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "user_id": "user-a",
        }
        invocation_env.apply_invocation_env(payload)
        self.assertIsNone(os.environ.get("CURRENT_THREAD_ID"))
        # CURRENT_USER_ID still set — thread ID is independent of invoker
        self.assertEqual(os.environ.get("CURRENT_USER_ID"), "user-a")


class CleanupInvocationEnvTests(unittest.TestCase):
    def setUp(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def tearDown(self):
        for k in ENV_KEYS:
            os.environ.pop(k, None)

    def test_cleanup_clears_all_keys_set_by_apply(self):
        payload = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "user_id": "user-a",
            "thread_id": "thread-a",
        }
        keys = invocation_env.apply_invocation_env(payload)
        self.assertEqual(os.environ.get("CURRENT_USER_ID"), "user-a")
        invocation_env.cleanup_invocation_env(keys)
        for k in ENV_KEYS:
            self.assertIsNone(
                os.environ.get(k),
                msg=f"{k} should be unset after cleanup",
            )

    def test_warm_container_isolation_between_invocations(self):
        """Integration: back-to-back invocations from different users.

        Simulates a warm container serving one invocation for user-A, then
        another for user-B. CURRENT_USER_ID must match the current
        payload — no bleed-through from the previous invocation.
        """
        # First invocation — user-A
        payload_a = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "user_id": "user-a",
            "thread_id": "thread-a",
        }
        keys_a = invocation_env.apply_invocation_env(payload_a)
        self.assertEqual(os.environ.get("CURRENT_USER_ID"), "user-a")
        invocation_env.cleanup_invocation_env(keys_a)
        self.assertIsNone(os.environ.get("CURRENT_USER_ID"))

        # Second invocation — user-B on a DIFFERENT tenant
        payload_b = {
            "workspace_tenant_id": "tenant-b",
            "assistant_id": "agent-b",
            "user_id": "user-b",
            "thread_id": "thread-b",
        }
        invocation_env.apply_invocation_env(payload_b)
        self.assertEqual(os.environ.get("CURRENT_USER_ID"), "user-b")
        self.assertEqual(os.environ.get("TENANT_ID"), "tenant-b")

    def test_warm_container_isolation_webhook_after_chat(self):
        """Integration: chat invocation (with user) → webhook (without user).

        The second invocation has NO user_id (webhook path). Without
        cleanup, CURRENT_USER_ID would still hold user-a from the chat
        invocation — and the admin skill would refuse *silently* instead
        of refusing on the "no invoker" shape. Cleanup guarantees R15
        holds across warm-container boundaries.
        """
        payload_chat = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "user_id": "user-a",
            "thread_id": "thread-a",
        }
        keys_chat = invocation_env.apply_invocation_env(payload_chat)
        self.assertEqual(os.environ.get("CURRENT_USER_ID"), "user-a")
        invocation_env.cleanup_invocation_env(keys_chat)

        payload_webhook = {
            "workspace_tenant_id": "tenant-a",
            "assistant_id": "agent-a",
            "thread_id": "thread-b",
        }
        invocation_env.apply_invocation_env(payload_webhook)
        self.assertIsNone(
            os.environ.get("CURRENT_USER_ID"),
            msg="webhook invocation must not inherit user-a's identity",
        )


if __name__ == "__main__":
    unittest.main()
