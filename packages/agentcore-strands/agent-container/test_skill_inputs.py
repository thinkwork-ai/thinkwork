"""Tests for skill_inputs: Pydantic schemas for typed inputs, tenant_overridable
allowlist, and composition steps.

Run with: uv run pytest packages/agentcore-strands/agent-container/test_skill_inputs.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import textwrap
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pydantic import ValidationError
from skill_inputs import (
    CompositionSkill,
    InputSpec,
    ParallelBranch,
    ParallelStep,
    SequentialStep,
    load_composition,
    validate_composition_file,
)

# --- InputSpec ---------------------------------------------------------------


class TestInputSpec(unittest.TestCase):
    def test_string_input_minimal(self):
        spec = InputSpec(type="string", required=True)
        self.assertTrue(spec.required)
        self.assertEqual(spec.on_missing_input, "fail")

    def test_enum_input_requires_values(self):
        with self.assertRaises(ValidationError):
            InputSpec(type="enum", required=True)

    def test_values_rejected_on_non_enum(self):
        with self.assertRaises(ValidationError):
            InputSpec(type="string", values=["a", "b"])

    def test_enum_with_default(self):
        spec = InputSpec(type="enum", values=["a", "b", "c"], default="a")
        self.assertEqual(spec.default, "a")

    def test_on_missing_input_values(self):
        for val in ("ask", "default", "fail"):
            spec = InputSpec(type="string", on_missing_input=val)
            self.assertEqual(spec.on_missing_input, val)
        with self.assertRaises(ValidationError):
            InputSpec(type="string", on_missing_input="guess")


# --- Step shapes -------------------------------------------------------------


class TestStepShapes(unittest.TestCase):
    def test_sequential_step_minimal(self):
        step = SequentialStep(id="frame", skill="frame", mode="sequential")
        self.assertEqual(step.timeout_seconds, 120)
        self.assertEqual(step.inputs, {})

    def test_parallel_step_with_branches(self):
        step = ParallelStep(
            id="gather",
            mode="parallel",
            branches=[
                ParallelBranch(id="a", skill="crm_lookup", critical=True),
                ParallelBranch(id="b", skill="ar_lookup"),
            ],
        )
        self.assertEqual(step.on_branch_failure, "continue_with_footer")
        self.assertEqual(step.branches[0].critical, True)
        self.assertEqual(step.branches[1].timeout_seconds, 120)

    def test_parallel_step_requires_branches(self):
        with self.assertRaises(ValidationError):
            ParallelStep(id="gather", mode="parallel", branches=[])


# --- CompositionSkill validation ---------------------------------------------


MINIMAL_COMPOSITION_DICT = {
    "id": "test-comp",
    "version": 1,
    "execution": "composition",
    "name": "Test Composition",
    "description": "A test composition.",
    "inputs": {
        "customer": {"type": "string", "required": True},
        "focus": {
            "type": "enum",
            "values": ["general", "financial"],
            "default": "general",
        },
    },
    "tenant_overridable": [
        "inputs.focus.default",
        "delivery.email",
        "triggers.schedule.expression",
    ],
    "delivery": ["chat", "email"],
    "triggers": {
        "schedule": {"type": "cron", "expression": "0 14 ? * MON-FRI *"},
    },
    "steps": [
        {"id": "frame", "skill": "frame", "mode": "sequential"},
        {
            "id": "gather",
            "mode": "parallel",
            "branches": [
                {"id": "a", "skill": "lookup_a", "critical": True},
                {"id": "b", "skill": "lookup_b"},
            ],
        },
        {"id": "synth", "skill": "synthesize", "mode": "sequential"},
    ],
}


class TestCompositionSkill(unittest.TestCase):
    def test_minimal_valid(self):
        comp = CompositionSkill.model_validate(MINIMAL_COMPOSITION_DICT)
        self.assertEqual(comp.id, "test-comp")
        self.assertEqual(len(comp.steps), 3)

    def test_execution_must_be_composition(self):
        bad = {**MINIMAL_COMPOSITION_DICT, "execution": "script"}
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_duplicate_step_id_rejected(self):
        bad = {**MINIMAL_COMPOSITION_DICT}
        bad["steps"] = [
            {"id": "dup", "skill": "a", "mode": "sequential"},
            {"id": "dup", "skill": "b", "mode": "sequential"},
        ]
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_duplicate_branch_id_rejected(self):
        bad = {**MINIMAL_COMPOSITION_DICT}
        bad["steps"] = [
            {
                "id": "gather",
                "mode": "parallel",
                "branches": [
                    {"id": "dup", "skill": "a"},
                    {"id": "dup", "skill": "b"},
                ],
            }
        ]
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_empty_steps_rejected(self):
        bad = {**MINIMAL_COMPOSITION_DICT, "steps": []}
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    # --- tenant_overridable walker ---

    def test_overridable_path_on_unknown_input_rejected(self):
        bad = dict(MINIMAL_COMPOSITION_DICT)
        bad["tenant_overridable"] = ["inputs.missing_input.default"]
        with self.assertRaises(ValidationError) as ctx:
            CompositionSkill.model_validate(bad)
        self.assertIn("missing_input", str(ctx.exception))

    def test_overridable_path_on_unknown_top_level_rejected(self):
        bad = dict(MINIMAL_COMPOSITION_DICT)
        bad["tenant_overridable"] = ["frobnozzle.whatever"]
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_overridable_delivery_not_in_delivery_list_rejected(self):
        bad = dict(MINIMAL_COMPOSITION_DICT)
        bad["delivery"] = ["chat"]  # no email
        bad["tenant_overridable"] = ["delivery.email"]
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_overridable_trigger_path_requires_trigger(self):
        bad = dict(MINIMAL_COMPOSITION_DICT)
        bad["triggers"] = None
        bad["tenant_overridable"] = ["triggers.schedule.expression"]
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_overridable_budget_cap_requires_budget_cap(self):
        bad = dict(MINIMAL_COMPOSITION_DICT)
        bad["tenant_overridable"] = ["budget_cap.tokens"]
        # budget_cap is absent — path should fail
        with self.assertRaises(ValidationError):
            CompositionSkill.model_validate(bad)

    def test_overridable_budget_cap_with_budget_cap_ok(self):
        good = dict(MINIMAL_COMPOSITION_DICT)
        good["budget_cap"] = {"tokens": 500_000}
        good["tenant_overridable"] = ["budget_cap.tokens"]
        comp = CompositionSkill.model_validate(good)
        self.assertEqual(comp.budget_cap.tokens, 500_000)


# --- load_composition from file ----------------------------------------------


class TestLoadComposition(unittest.TestCase):
    def test_load_valid_yaml_file(self):
        yaml_body = textwrap.dedent(
            """
            id: prep-for-meeting
            version: 1
            execution: composition
            name: Prep for Meeting
            description: Sales meeting prep.
            inputs:
              customer:
                type: string
                required: true
                on_missing_input: ask
            tenant_overridable:
              - delivery.email
            delivery:
              - chat
              - email
            steps:
              - id: frame
                skill: frame
                mode: sequential
              - id: gather
                mode: parallel
                branches:
                  - id: crm
                    skill: crm_lookup
                    critical: true
                  - id: ar
                    skill: ar_lookup
            """
        ).strip()
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write(yaml_body)
            path = f.name
        try:
            comp = load_composition(path)
            self.assertEqual(comp.id, "prep-for-meeting")
            self.assertEqual(comp.inputs["customer"].required, True)
            self.assertEqual(len(comp.steps), 2)
        finally:
            os.unlink(path)

    def test_validate_composition_file_returns_errors(self):
        yaml_body = "id: broken\nversion: 1\nexecution: script\n"
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write(yaml_body)
            path = f.name
        try:
            ok, errors = validate_composition_file(path)
            self.assertFalse(ok)
            self.assertEqual(len(errors), 1)
        finally:
            os.unlink(path)

    def test_load_rejects_non_composition_execution(self):
        yaml_body = "id: x\nversion: 1\nexecution: script\nname: X\ndescription: X.\nsteps: []\n"
        with tempfile.NamedTemporaryFile("w", suffix=".yaml", delete=False) as f:
            f.write(yaml_body)
            path = f.name
        try:
            with self.assertRaises(ValueError):
                load_composition(path)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
