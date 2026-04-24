"""Tests for scope-aware learning helpers in memory.py.

Covers the `(tenant_id, user_id?, skill_id, subject_entity_id?)` scope tuple
encoding into AgentCore Memory namespaces, the user→tenant retrieval
priority, top_k cap, and graceful-degradation when the boto3 client
raises.

These tests stub out the AgentCore Memory client entirely — no AWS
calls. The scope-to-namespace mapping is the load-bearing contract the
chat agent's recall / reflect tools depend on; pin it down explicitly.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ["AGENTCORE_MEMORY_ID"] = "mem-test-123"

import memory  # noqa: E402


class TestLearningNamespace(unittest.TestCase):
    """Scope → namespace encoding. Writes go to ONE namespace; reads walk
    an ordered priority list of namespaces."""

    def test_tenant_skill_only(self):
        ns = memory._learning_namespace({"tenant_id": "T1", "skill_id": "sales-prep"})
        self.assertEqual(ns, "learnings/tenant_T1/skill_sales-prep")

    def test_tenant_user_skill(self):
        ns = memory._learning_namespace({
            "tenant_id": "T1", "user_id": "U1", "skill_id": "sales-prep",
        })
        self.assertEqual(ns, "learnings/tenant_T1/user_U1/skill_sales-prep")

    def test_tenant_user_skill_subject(self):
        ns = memory._learning_namespace({
            "tenant_id": "T1", "user_id": "U1",
            "skill_id": "sales-prep", "subject_entity_id": "cust-abc",
        })
        self.assertEqual(
            ns,
            "learnings/tenant_T1/user_U1/skill_sales-prep/subject_cust-abc",
        )

    def test_missing_tenant_raises(self):
        with self.assertRaises(ValueError):
            memory._learning_namespace({"skill_id": "sales-prep"})

    def test_missing_skill_raises(self):
        with self.assertRaises(ValueError):
            memory._learning_namespace({"tenant_id": "T1"})

    def test_subject_without_user_falls_back_to_tenant_level(self):
        """Webhook path: no user, but subject. Write lands at tenant + skill
        + subject — the learning is about the subject entity, regardless
        of which user happens to reflect on it."""
        ns = memory._learning_namespace({
            "tenant_id": "T1",
            "skill_id": "customer-onboarding",
            "subject_entity_id": "cust-abc",
        })
        self.assertEqual(
            ns,
            "learnings/tenant_T1/skill_customer-onboarding/subject_cust-abc",
        )


class TestRecallNamespacePriority(unittest.TestCase):
    """Read-time: walk namespaces in priority order, user-first."""

    def test_full_scope_walks_three_tiers(self):
        tiers = memory._learning_recall_namespaces({
            "tenant_id": "T1", "user_id": "U1",
            "skill_id": "sales-prep", "subject_entity_id": "cust-abc",
        })
        self.assertEqual(tiers, [
            "learnings/tenant_T1/user_U1/skill_sales-prep/subject_cust-abc",
            "learnings/tenant_T1/user_U1/skill_sales-prep",
            "learnings/tenant_T1/skill_sales-prep",
        ])

    def test_user_scope_no_subject(self):
        tiers = memory._learning_recall_namespaces({
            "tenant_id": "T1", "user_id": "U1", "skill_id": "sales-prep",
        })
        self.assertEqual(tiers, [
            "learnings/tenant_T1/user_U1/skill_sales-prep",
            "learnings/tenant_T1/skill_sales-prep",
        ])

    def test_tenant_only_scope(self):
        tiers = memory._learning_recall_namespaces({
            "tenant_id": "T1", "skill_id": "sales-prep",
        })
        self.assertEqual(tiers, ["learnings/tenant_T1/skill_sales-prep"])

    def test_tenant_subject_no_user(self):
        tiers = memory._learning_recall_namespaces({
            "tenant_id": "T1", "skill_id": "customer-onboarding",
            "subject_entity_id": "cust-abc",
        })
        self.assertEqual(tiers, [
            "learnings/tenant_T1/skill_customer-onboarding/subject_cust-abc",
            "learnings/tenant_T1/skill_customer-onboarding",
        ])


class TestStoreLearning(unittest.TestCase):
    def test_store_calls_batch_create_with_scoped_namespace(self):
        fake = mock.MagicMock()
        fake.batch_create_memory_records.return_value = {"failedRecords": []}
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            ok = memory.store_learning(
                {"tenant_id": "T1", "user_id": "U1", "skill_id": "sales-prep"},
                "Reps engage best on customer-specific financials.",
            )
        self.assertTrue(ok)
        fake.batch_create_memory_records.assert_called_once()
        call_kwargs = fake.batch_create_memory_records.call_args.kwargs
        self.assertEqual(call_kwargs["memoryId"], "mem-test-123")
        record = call_kwargs["records"][0]
        self.assertEqual(
            record["namespaces"],
            ["learnings/tenant_T1/user_U1/skill_sales-prep"],
        )
        self.assertEqual(
            record["content"]["text"],
            "Reps engage best on customer-specific financials.",
        )

    def test_store_logs_and_swallows_failed_record(self):
        fake = mock.MagicMock()
        fake.batch_create_memory_records.return_value = {
            "failedRecords": [{"reason": "ValidationError"}],
        }
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            ok = memory.store_learning(
                {"tenant_id": "T1", "skill_id": "sales-prep"},
                "content",
            )
        self.assertFalse(ok)

    def test_store_swallows_boto_exception(self):
        """Reflect writes must not surface errors to the caller.
        memory.store_learning returns False and the caller proceeds."""
        fake = mock.MagicMock()
        fake.batch_create_memory_records.side_effect = RuntimeError("AWS down")
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            ok = memory.store_learning(
                {"tenant_id": "T1", "skill_id": "sales-prep"},
                "content",
            )
        self.assertFalse(ok)

    def test_store_skips_when_memory_id_unset(self):
        with mock.patch.object(memory, "AGENTCORE_MEMORY_ID", ""):
            ok = memory.store_learning(
                {"tenant_id": "T1", "skill_id": "sales-prep"}, "content",
            )
        self.assertFalse(ok)

    def test_store_rejects_empty_content(self):
        ok = memory.store_learning(
            {"tenant_id": "T1", "skill_id": "sales-prep"}, "",
        )
        self.assertFalse(ok)

    def test_store_rejects_invalid_scope(self):
        ok = memory.store_learning({"skill_id": "sales-prep"}, "content")
        self.assertFalse(ok)


class TestRecallLearnings(unittest.TestCase):
    def _fake_record(self, text, ns):
        return {
            "content": {"text": text},
            "memoryRecordId": f"rec-{text[:3]}",
            "namespaces": [ns],
            "score": 0.9,
        }

    def test_user_scoped_results_ranked_before_tenant(self):
        """Priority walk: the user-scoped namespace is queried first and
        its records appear before tenant-scoped records in the output,
        regardless of their raw similarity score."""
        fake = mock.MagicMock()

        def fake_retrieve(memoryId, namespace, searchCriteria):
            if "user_U1" in namespace:
                return {"memoryRecordSummaries": [
                    self._fake_record("USER-scoped A", namespace),
                ]}
            return {"memoryRecordSummaries": [
                self._fake_record("TENANT-scoped B", namespace),
            ]}

        fake.retrieve_memories.side_effect = fake_retrieve
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "user_id": "U1", "skill_id": "sales-prep"},
                query="ABC Fuels upcoming meeting",
                top_k=5,
            )

        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["text"], "USER-scoped A")
        self.assertEqual(out[1]["text"], "TENANT-scoped B")
        # Priority tier tagged so callers can format them differently.
        self.assertEqual(out[0]["priority"], 0)
        self.assertEqual(out[1]["priority"], 1)

    def test_top_k_cap(self):
        fake = mock.MagicMock()
        fake.retrieve_memories.return_value = {"memoryRecordSummaries": [
            self._fake_record(f"learning-{i}", "learnings/tenant_T1/skill_s")
            for i in range(20)
        ]}
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "skill_id": "s"},
                query="whatever",
                top_k=3,
            )
        self.assertEqual(len(out), 3)

    def test_empty_results_no_error(self):
        fake = mock.MagicMock()
        fake.retrieve_memories.return_value = {"memoryRecordSummaries": []}
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "skill_id": "s"}, query="x",
            )
        self.assertEqual(out, [])

    def test_duplicate_text_across_tiers_deduped(self):
        """If a learning was promoted from tenant→user, both namespaces
        may return it; we dedupe by text, keeping the highest-priority
        tier."""
        fake = mock.MagicMock()

        def fake_retrieve(memoryId, namespace, searchCriteria):
            return {"memoryRecordSummaries": [
                self._fake_record("Same learning", namespace),
            ]}

        fake.retrieve_memories.side_effect = fake_retrieve
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "user_id": "U1", "skill_id": "s"},
                query="x",
            )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["priority"], 0)  # user tier wins

    def test_recall_swallows_boto_exception(self):
        """recall must not fail the caller — if AgentCore is down,
        return empty and let the run continue without context."""
        fake = mock.MagicMock()
        fake.retrieve_memories.side_effect = RuntimeError("AWS down")
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "skill_id": "s"}, query="x",
            )
        self.assertEqual(out, [])

    def test_recall_skips_when_memory_id_unset(self):
        with mock.patch.object(memory, "AGENTCORE_MEMORY_ID", ""):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "skill_id": "s"}, query="x",
            )
        self.assertEqual(out, [])

    def test_recall_falls_back_to_list_when_retrieve_unsupported(self):
        """Older boto3 / regions may not expose retrieve_memories. Fall
        back to list_memory_records so the primitive degrades gracefully
        instead of silently returning nothing."""
        fake = mock.MagicMock()
        # Simulate AttributeError (no method) on retrieve_memories.
        del fake.retrieve_memories
        fake.list_memory_records.return_value = {"memoryRecordSummaries": [
            self._fake_record("list-result", "learnings/tenant_T1/skill_s"),
        ]}
        with mock.patch.object(memory, "_get_agentcore_client", return_value=fake):
            out = memory.recall_learnings(
                {"tenant_id": "T1", "skill_id": "s"}, query="x",
            )
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["text"], "list-result")


if __name__ == "__main__":
    unittest.main()
