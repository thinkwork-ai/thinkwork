"""Tests for `format_external_task_context`.

Phase D wiring: ensures the external-task envelope from
`thread.metadata.external.latestEnvelope` is rendered as a system-prompt
block the agent can use as context. Without this, agents attached to
external-task threads have no idea what task they are looking at.

Run with: python -m unittest packages/agentcore-strands/agent-container/test_external_task_context.py
"""

from __future__ import annotations

import unittest

from external_task_context import format_external_task_context


def _envelope(**core_overrides):
    core = {
        "id": "task_abc",
        "provider": "linear",
        "title": "Deliver groceries",
        "description": "Bring eggs and bread from the corner store",
        "dueAt": "2026-04-20T15:00:00Z",
        "updatedAt": "2026-04-14T10:00:00Z",
        "url": "https://linear.example/tasks/abc",
        "status": {"value": "in_progress", "label": "In progress"},
        "priority": {"value": "high", "label": "High"},
        "assignee": {"id": "u1", "name": "Eric", "email": "eric@example.com"},
    }
    core.update(core_overrides)
    return {
        "external": {
            "provider": "linear",
            "externalTaskId": "task_abc",
            "latestEnvelope": {
                "_type": "external_task",
                "item": {"core": core, "capabilities": {}, "fields": [], "actions": []},
                "blocks": [],
            },
        }
    }


class TestFormatExternalTaskContext(unittest.TestCase):
    def test_returns_empty_for_none_metadata(self):
        self.assertEqual(format_external_task_context(None), "")

    def test_returns_empty_for_non_dict(self):
        self.assertEqual(format_external_task_context("nope"), "")  # type: ignore[arg-type]

    def test_returns_empty_when_no_external_block(self):
        self.assertEqual(format_external_task_context({"foo": "bar"}), "")

    def test_returns_empty_when_no_envelope(self):
        self.assertEqual(
            format_external_task_context({"external": {"provider": "linear"}}),
            "",
        )

    def test_formats_full_envelope(self):
        block = format_external_task_context(_envelope())
        self.assertIn("Active External Task (Linear)", block)
        self.assertIn("**Title:** Deliver groceries", block)
        self.assertIn("**External ID:** task_abc", block)
        self.assertIn("**Status:** In progress", block)
        self.assertIn("**Priority:** High", block)
        self.assertIn("**Assignee:** Eric", block)
        self.assertIn("**Due:** 2026-04-20T15:00:00Z", block)
        self.assertIn("**URL:** https://linear.example/tasks/abc", block)
        self.assertIn("Bring eggs and bread", block)

    def test_handles_missing_status_priority_gracefully(self):
        meta = _envelope()
        meta["external"]["latestEnvelope"]["item"]["core"]["status"] = None
        meta["external"]["latestEnvelope"]["item"]["core"]["priority"] = None
        block = format_external_task_context(meta)
        self.assertIn("**Status:** unknown", block)
        self.assertIn("**Priority:** unknown", block)

    def test_truncates_long_descriptions(self):
        long = "x" * 5000
        meta = _envelope(description=long)
        block = format_external_task_context(meta)
        # 1500-char cap + ellipsis
        self.assertIn("…", block)
        self.assertNotIn("x" * 2000, block)

    def test_omits_optional_fields_when_missing(self):
        meta = _envelope()
        core = meta["external"]["latestEnvelope"]["item"]["core"]
        core["dueAt"] = ""
        core["updatedAt"] = ""
        core["url"] = ""
        core["description"] = ""
        block = format_external_task_context(meta)
        self.assertNotIn("**Due:**", block)
        self.assertNotIn("**Last updated:**", block)
        self.assertNotIn("**URL:**", block)
        self.assertNotIn("**Description:**", block)


if __name__ == "__main__":
    unittest.main()
