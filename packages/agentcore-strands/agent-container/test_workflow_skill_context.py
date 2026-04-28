"""Tests for `format_workflow_skill_context`.

Exercises the rendering of workflow-skill blocks into the agent's system
prompt. Workflow-aware skills read this block to decide between the
dynamic form path and any skill default, so the presence/absence of
specific markers matters.

Run with: python -m unittest packages/agentcore-strands/agent-container/test_workflow_skill_context.py
"""

from __future__ import annotations

import json
import unittest

from workflow_skill_context import format_workflow_skill_context

SAMPLE_FORM = {
    "id": "eng_task_intake",
    "title": "Engineering task",
    "fields": [
        {"id": "description", "label": "Description", "type": "textarea"},
        {
            "id": "severity",
            "label": "Severity",
            "type": "select",
            "options": [
                {"value": "sev1", "label": "SEV 1"},
                {"value": "sev2", "label": "SEV 2"},
            ],
        },
    ],
}


class TestFormatWorkflowSkillContext(unittest.TestCase):
    def test_returns_empty_for_none(self):
        self.assertEqual(format_workflow_skill_context(None), "")

    def test_returns_empty_for_non_dict(self):
        self.assertEqual(format_workflow_skill_context("nope"), "")

    def test_returns_empty_when_neither_instructions_nor_form(self):
        self.assertEqual(
            format_workflow_skill_context({"schemaVersion": 1}), ""
        )

    def test_returns_empty_for_blank_instructions(self):
        self.assertEqual(
            format_workflow_skill_context(
                {"schemaVersion": 1, "instructions": "   "}
            ),
            "",
        )

    def test_instructions_only(self):
        block = format_workflow_skill_context(
            {"schemaVersion": 1, "instructions": "Be concise and echo key fields."}
        )
        self.assertIn("## Workflow Skill", block)
        self.assertIn("### Instructions", block)
        self.assertIn("Be concise and echo key fields.", block)
        self.assertNotIn("### Form schema", block)

    def test_form_only(self):
        block = format_workflow_skill_context(
            {"schemaVersion": 1, "form": SAMPLE_FORM}
        )
        self.assertIn("## Workflow Skill", block)
        self.assertIn("### Form schema", block)
        # Form schema is rendered as a fenced JSON block that preserves
        # field ids — the agent copies it verbatim into present_form.
        self.assertIn("```json", block)
        self.assertIn('"id": "eng_task_intake"', block)
        self.assertIn('"severity"', block)
        self.assertNotIn("### Instructions", block)

    def test_both_instructions_and_form(self):
        block = format_workflow_skill_context(
            {
                "schemaVersion": 1,
                "instructions": "Be brief.",
                "form": SAMPLE_FORM,
            }
        )
        self.assertIn("### Instructions", block)
        self.assertIn("### Form schema", block)
        self.assertLess(block.index("### Instructions"), block.index("### Form schema"))

    def test_form_missing_id_or_fields_is_skipped(self):
        # A `form` with no id / fields should not render a ### Form schema
        # block — we only take the dynamic path for well-formed forms.
        block = format_workflow_skill_context(
            {
                "schemaVersion": 1,
                "instructions": "hi",
                "form": {"title": "no id here"},
            }
        )
        self.assertIn("### Instructions", block)
        self.assertNotIn("### Form schema", block)

    def test_rendered_form_is_valid_json(self):
        block = format_workflow_skill_context(
            {"schemaVersion": 1, "form": SAMPLE_FORM}
        )
        # Pluck the fenced JSON and parse it — the agent needs to be able
        # to copy-paste this into present_form(form_json=...).
        start = block.index("```json") + len("```json\n")
        end = block.index("```", start)
        parsed = json.loads(block[start:end])
        self.assertEqual(parsed["id"], "eng_task_intake")
        self.assertEqual(len(parsed["fields"]), 2)


if __name__ == "__main__":
    unittest.main()
