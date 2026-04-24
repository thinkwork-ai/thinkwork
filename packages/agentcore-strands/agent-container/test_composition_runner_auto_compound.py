"""Tests for composition_runner's Unit 3 addition: auto-compound injection.

Contract:
  * When `context={'scope': ...}` is passed AND the composition does not
    declare compound_recall/compound_reflect explicitly, the runner
    wraps the run with them.
  * When `context` is absent (Unit 1 behavior), runner is unchanged —
    no implicit steps are injected.
  * If either compound step is already declared, the runner skips that
    injection on that side (idempotent override).
  * A failing auto-compound call is swallowed — the composition
    continues as if the step weren't there.
"""

from __future__ import annotations

import asyncio
import unittest

from composition_runner import run_composition
from skill_inputs import CompositionSkill


def _build(steps: list[dict]) -> CompositionSkill:
    return CompositionSkill.model_validate({
        "id": "t",
        "version": 1,
        "execution": "composition",
        "name": "T",
        "description": "T.",
        "steps": steps,
    })


def _make_dispatch(responses: dict | None = None):
    responses = responses or {}
    calls: list[tuple[str, dict]] = []

    async def dispatch(skill_id: str, inputs: dict):
        calls.append((skill_id, inputs))
        return responses.get(skill_id, f"{skill_id}-ok")

    dispatch.calls = calls  # type: ignore[attr-defined]
    return dispatch


class TestAutoCompound(unittest.TestCase):
    # --- Back-compat: no context => no injection ----------------------------

    def test_no_context_no_injection(self) -> None:
        """Unit 1 callers pass no context. Behavior must be identical to
        pre-Unit-3 — no implicit recall/reflect calls."""
        comp = _build([
            {"id": "one", "mode": "sequential", "skill": "noop"},
        ])
        dispatch = _make_dispatch()
        result = asyncio.run(run_composition(comp, {}, dispatch))
        self.assertEqual([c[0] for c in dispatch.calls], ["noop"])
        self.assertEqual(result.status, "complete")

    # --- Happy path: full scope wraps run -----------------------------------

    def test_scope_wraps_with_recall_and_reflect(self) -> None:
        comp = _build([
            {"id": "one", "mode": "sequential", "skill": "noop"},
        ])
        dispatch = _make_dispatch(responses={
            "compound_recall": "prior observation X",
            "noop": "noop-out",
            "compound_reflect": '{"stored": 2}',
        })
        ctx = {
            "scope": {
                "tenant_id": "T1",
                "user_id": "U1",
                "skill_id": "sales-prep",
            },
        }
        result = asyncio.run(run_composition(comp, {}, dispatch, context=ctx))

        skill_order = [c[0] for c in dispatch.calls]
        self.assertEqual(skill_order, ["compound_recall", "noop", "compound_reflect"])

        # Scope fields flattened onto the tool calls.
        recall_inputs = dispatch.calls[0][1]
        self.assertEqual(recall_inputs["tenant_id"], "T1")
        self.assertEqual(recall_inputs["user_id"], "U1")
        self.assertEqual(recall_inputs["skill_id"], "sales-prep")
        self.assertIn("query", recall_inputs)

        # Prior learnings flow into named outputs for downstream steps.
        self.assertEqual(result.named_outputs.get("prior_learnings"),
                         "prior observation X")

        # Reflect sees the composition's resolved_inputs + deliverable.
        reflect_inputs = dispatch.calls[-1][1]
        self.assertEqual(reflect_inputs["tenant_id"], "T1")
        self.assertIn("run_inputs", reflect_inputs)
        self.assertIn("deliverable", reflect_inputs)
        self.assertIn("prior_learnings", reflect_inputs)

    # --- Explicit declarations override auto-injection ----------------------

    def test_explicit_recall_skips_auto_recall(self) -> None:
        """If the composition author wrote their own `compound_recall`
        step, the runner does NOT also inject one."""
        comp = _build([
            {
                "id": "explicit_recall",
                "mode": "sequential",
                "skill": "compound_recall",
                "inputs": {"tenant_id": "T1", "skill_id": "s", "query": "q"},
            },
            {"id": "one", "mode": "sequential", "skill": "noop"},
        ])
        dispatch = _make_dispatch()
        ctx = {"scope": {"tenant_id": "T1", "skill_id": "s"}}
        result = asyncio.run(run_composition(comp, {}, dispatch, context=ctx))

        recall_calls = [c for c in dispatch.calls if c[0] == "compound_recall"]
        self.assertEqual(len(recall_calls), 1)
        # Still auto-injects reflect at the end.
        self.assertEqual(dispatch.calls[-1][0], "compound_reflect")
        self.assertEqual(result.status, "complete")

    def test_explicit_reflect_skips_auto_reflect(self) -> None:
        comp = _build([
            {"id": "one", "mode": "sequential", "skill": "noop"},
            {
                "id": "explicit_reflect",
                "mode": "sequential",
                "skill": "compound_reflect",
                "inputs": {
                    "tenant_id": "T1",
                    "skill_id": "s",
                    "run_inputs": "{}",
                    "deliverable": "d",
                },
            },
        ])
        dispatch = _make_dispatch()
        ctx = {"scope": {"tenant_id": "T1", "skill_id": "s"}}
        asyncio.run(run_composition(comp, {}, dispatch, context=ctx))

        reflect_calls = [c for c in dispatch.calls if c[0] == "compound_reflect"]
        self.assertEqual(len(reflect_calls), 1)
        # Recall still auto-injects at the start.
        self.assertEqual(dispatch.calls[0][0], "compound_recall")

    def test_both_explicit_no_injection_at_all(self) -> None:
        comp = _build([
            {
                "id": "r",
                "mode": "sequential",
                "skill": "compound_recall",
                "inputs": {"tenant_id": "T1", "skill_id": "s", "query": "q"},
            },
            {"id": "one", "mode": "sequential", "skill": "noop"},
            {
                "id": "w",
                "mode": "sequential",
                "skill": "compound_reflect",
                "inputs": {"tenant_id": "T1", "skill_id": "s", "run_inputs": "{}", "deliverable": "d"},
            },
        ])
        dispatch = _make_dispatch()
        ctx = {"scope": {"tenant_id": "T1", "skill_id": "s"}}
        asyncio.run(run_composition(comp, {}, dispatch, context=ctx))

        recalls = [c for c in dispatch.calls if c[0] == "compound_recall"]
        reflects = [c for c in dispatch.calls if c[0] == "compound_reflect"]
        self.assertEqual(len(recalls), 1)
        self.assertEqual(len(reflects), 1)

    # --- Failure handling ---------------------------------------------------

    def test_recall_failure_does_not_abort_run(self) -> None:
        """Per plan: 'edge case: no prior learnings → recall returns empty;
        composition continues without context.' Extend that to any recall
        failure — don't let a flaky learnings tier block the composition."""
        comp = _build([{"id": "one", "mode": "sequential", "skill": "noop"}])

        async def dispatch(skill_id, inputs):
            if skill_id == "compound_recall":
                raise RuntimeError("memory tier down")
            return f"{skill_id}-ok"

        ctx = {"scope": {"tenant_id": "T1", "skill_id": "s"}}
        result = asyncio.run(run_composition(comp, {}, dispatch, context=ctx))
        self.assertEqual(result.status, "complete")
        # Downstream steps see empty prior_learnings rather than a missing key.
        self.assertEqual(result.named_outputs.get("prior_learnings"), "")

    def test_reflect_not_invoked_when_composition_failed(self) -> None:
        """If a critical step blew up, don't pretend the run was worth
        reflecting on. Keep the learnings pool honest."""
        comp = _build([
            {"id": "one", "mode": "sequential", "skill": "fail"},
        ])

        calls: list[tuple[str, dict]] = []

        async def dispatch(skill_id, inputs):
            calls.append((skill_id, inputs))
            if skill_id == "fail":
                raise RuntimeError("boom")
            return f"{skill_id}-ok"

        ctx = {"scope": {"tenant_id": "T1", "skill_id": "s"}}
        result = asyncio.run(run_composition(comp, {}, dispatch, context=ctx))
        self.assertEqual(result.status, "failed")
        self.assertNotIn("compound_reflect", [c[0] for c in calls])

    def test_reflect_failure_does_not_change_run_status(self) -> None:
        comp = _build([{"id": "one", "mode": "sequential", "skill": "noop"}])

        async def dispatch(skill_id, inputs):
            if skill_id == "compound_reflect":
                raise RuntimeError("AWS down")
            return f"{skill_id}-ok"

        ctx = {"scope": {"tenant_id": "T1", "skill_id": "s"}}
        result = asyncio.run(run_composition(comp, {}, dispatch, context=ctx))
        self.assertEqual(result.status, "complete")


if __name__ == "__main__":
    unittest.main()
