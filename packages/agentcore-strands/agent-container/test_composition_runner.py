"""Tests for composition_runner: sequential + parallel execution, critical
branch failure, timeout routing, footer semantics, and input materialization.

Run with: uv run --no-project --with pydantic --with PyYAML --with pytest \\
    pytest packages/agentcore-strands/agent-container/test_composition_runner.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from composition_runner import CompositionResult, run_composition
from skill_inputs import CompositionSkill

# --- Helpers -----------------------------------------------------------------


def _build_composition(steps: list[dict], inputs: dict | None = None) -> CompositionSkill:
    """Build a minimal CompositionSkill from a list of step dicts."""
    return CompositionSkill.model_validate(
        {
            "id": "test",
            "version": 1,
            "execution": "composition",
            "name": "Test",
            "description": "Test.",
            "inputs": inputs or {},
            "steps": steps,
        }
    )


def _make_dispatch(responses: dict, raises: dict | None = None, sleeps: dict | None = None):
    """Build a stub dispatch coroutine.

    responses: skill_id -> static return value
    raises: skill_id -> Exception to raise when dispatched
    sleeps: skill_id -> float seconds to sleep (for timeout tests)
    """
    raises = raises or {}
    sleeps = sleeps or {}
    calls: list[tuple[str, dict]] = []

    async def dispatch(skill_id: str, inputs: dict):
        calls.append((skill_id, inputs))
        if skill_id in sleeps:
            await asyncio.sleep(sleeps[skill_id])
        if skill_id in raises:
            raise raises[skill_id]
        return responses.get(skill_id)

    dispatch.calls = calls  # type: ignore[attr-defined]
    return dispatch


def _run(coro):
    return asyncio.run(coro)


# --- Sequential --------------------------------------------------------------


class TestSequentialExecution(unittest.TestCase):
    def test_single_sequential_step(self):
        comp = _build_composition(
            [{"id": "frame", "skill": "frame", "mode": "sequential"}]
        )
        dispatch = _make_dispatch(responses={"frame": "framed output"})
        result = _run(run_composition(comp, {}, dispatch))
        self.assertIsInstance(result, CompositionResult)
        self.assertEqual(result.status, "complete")
        self.assertEqual(result.named_outputs["frame"], "framed output")

    def test_sequential_steps_chain_named_outputs(self):
        comp = _build_composition(
            [
                {"id": "a", "skill": "a", "mode": "sequential"},
                {"id": "b", "skill": "b", "mode": "sequential"},
            ]
        )
        dispatch = _make_dispatch(responses={"a": "A", "b": "B"})
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "complete")
        self.assertEqual(result.named_outputs, {"a": "A", "b": "B"})

    def test_sequential_step_error_fails_composition(self):
        comp = _build_composition(
            [
                {"id": "a", "skill": "a", "mode": "sequential"},
                {"id": "b", "skill": "b", "mode": "sequential"},
            ]
        )
        dispatch = _make_dispatch(
            responses={"a": "A"}, raises={"b": RuntimeError("boom")}
        )
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "failed")
        self.assertIn("b", result.failure_reason)

    def test_sequential_step_timeout(self):
        comp = _build_composition(
            [{"id": "slow", "skill": "slow", "mode": "sequential", "timeout_seconds": 1}]
        )
        dispatch = _make_dispatch(responses={}, sleeps={"slow": 5})
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "failed")
        self.assertIn("timed out", result.failure_reason)


# --- Parallel ----------------------------------------------------------------


class TestParallelExecution(unittest.TestCase):
    def test_parallel_all_success(self):
        comp = _build_composition(
            [
                {
                    "id": "gather",
                    "mode": "parallel",
                    "branches": [
                        {"id": "a", "skill": "a"},
                        {"id": "b", "skill": "b"},
                    ],
                }
            ]
        )
        dispatch = _make_dispatch(responses={"a": "A_out", "b": "B_out"})
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "complete")
        self.assertEqual(result.named_outputs["gather"], {"a": "A_out", "b": "B_out"})

    def test_parallel_critical_branch_fails_aborts(self):
        comp = _build_composition(
            [
                {
                    "id": "gather",
                    "mode": "parallel",
                    "branches": [
                        {"id": "a", "skill": "a", "critical": True},
                        {"id": "b", "skill": "b"},
                    ],
                }
            ]
        )
        dispatch = _make_dispatch(
            responses={"b": "B_out"}, raises={"a": RuntimeError("boom")}
        )
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.step_results[0].status, "failed")

    def test_parallel_non_critical_fail_continues_with_footer(self):
        comp = _build_composition(
            [
                {
                    "id": "gather",
                    "mode": "parallel",
                    "branches": [
                        {"id": "a", "skill": "a", "critical": True},
                        {"id": "b", "skill": "b"},
                    ],
                }
            ]
        )
        dispatch = _make_dispatch(
            responses={"a": "A_out"}, raises={"b": RuntimeError("slow")}
        )
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "complete")
        step = result.step_results[0]
        self.assertEqual(step.status, "footered")
        self.assertEqual(len(step.footer_notes), 1)
        self.assertIn("b unavailable", step.footer_notes[0])
        self.assertEqual(step.output, {"a": "A_out"})

    def test_parallel_on_branch_failure_fail_aborts_on_any_failure(self):
        comp = _build_composition(
            [
                {
                    "id": "gather",
                    "mode": "parallel",
                    "on_branch_failure": "fail",
                    "branches": [
                        {"id": "a", "skill": "a"},
                        {"id": "b", "skill": "b"},
                    ],
                }
            ]
        )
        dispatch = _make_dispatch(
            responses={"a": "A_out"}, raises={"b": RuntimeError("err")}
        )
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "failed")

    def test_parallel_branch_timeout_routes_per_critical(self):
        comp = _build_composition(
            [
                {
                    "id": "gather",
                    "mode": "parallel",
                    "branches": [
                        {"id": "fast", "skill": "fast"},
                        {
                            "id": "slow",
                            "skill": "slow",
                            "critical": False,
                            "timeout_seconds": 1,
                        },
                    ],
                }
            ]
        )
        dispatch = _make_dispatch(
            responses={"fast": "F_out"}, sleeps={"slow": 5}
        )
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "complete")
        step = result.step_results[0]
        self.assertEqual(step.status, "footered")
        self.assertIn("slow", step.footer_notes[0])

    def test_parallel_branches_run_concurrently(self):
        """Confirms asyncio.gather actually parallelizes — two 1s sleeps should
        finish in ~1s total, not ~2s. Upper-bound is generous to absorb CI jitter.
        """
        comp = _build_composition(
            [
                {
                    "id": "gather",
                    "mode": "parallel",
                    "branches": [
                        {"id": "one", "skill": "one", "timeout_seconds": 3},
                        {"id": "two", "skill": "two", "timeout_seconds": 3},
                    ],
                }
            ]
        )
        dispatch = _make_dispatch(
            responses={"one": 1, "two": 2}, sleeps={"one": 0.5, "two": 0.5}
        )
        import time

        t0 = time.monotonic()
        result = _run(run_composition(comp, {}, dispatch))
        elapsed = time.monotonic() - t0
        self.assertEqual(result.status, "complete")
        self.assertLess(elapsed, 0.9, "branches did not run concurrently")


# --- Full pipeline -----------------------------------------------------------


class TestMixedPipeline(unittest.TestCase):
    def test_sequential_then_parallel_then_sequential(self):
        comp = _build_composition(
            [
                {"id": "frame", "skill": "frame", "mode": "sequential"},
                {
                    "id": "gather",
                    "mode": "parallel",
                    "branches": [
                        {"id": "a", "skill": "a"},
                        {"id": "b", "skill": "b"},
                    ],
                },
                {
                    "id": "synth",
                    "skill": "synth",
                    "mode": "sequential",
                    "inputs": {"framed": "{frame}", "gathered": "{gather}"},
                },
            ]
        )
        dispatch = _make_dispatch(
            responses={
                "frame": "FRAMED",
                "a": "A_OUT",
                "b": "B_OUT",
                "synth": "SYNTH_OUT",
            }
        )
        result = _run(run_composition(comp, {}, dispatch))
        self.assertEqual(result.status, "complete")
        # Final synthesize saw the aggregated gather output + framed string
        synth_call = next(
            call for call in dispatch.calls if call[0] == "synth"
        )
        self.assertEqual(synth_call[1]["framed"], "FRAMED")
        self.assertEqual(synth_call[1]["gathered"], {"a": "A_OUT", "b": "B_OUT"})


# --- Input materialization ---------------------------------------------------


class TestInputMaterialization(unittest.TestCase):
    def test_placeholder_resolves_from_resolved_inputs(self):
        comp = _build_composition(
            [
                {
                    "id": "frame",
                    "skill": "frame",
                    "mode": "sequential",
                    "inputs": {"problem": "{customer}"},
                }
            ],
            inputs={"customer": {"type": "string", "required": True}},
        )
        dispatch = _make_dispatch(responses={"frame": "ok"})
        _run(run_composition(comp, {"customer": "ABC Fuels"}, dispatch))
        self.assertEqual(dispatch.calls[0][1]["problem"], "ABC Fuels")

    def test_unknown_placeholder_passes_through(self):
        comp = _build_composition(
            [
                {
                    "id": "frame",
                    "skill": "frame",
                    "mode": "sequential",
                    "inputs": {"x": "{unknown}"},
                }
            ]
        )
        dispatch = _make_dispatch(responses={"frame": "ok"})
        _run(run_composition(comp, {}, dispatch))
        self.assertEqual(dispatch.calls[0][1]["x"], "{unknown}")

    def test_non_string_inputs_pass_through(self):
        comp = _build_composition(
            [
                {
                    "id": "frame",
                    "skill": "frame",
                    "mode": "sequential",
                    "inputs": {"count": 5, "flags": ["a", "b"]},
                }
            ]
        )
        dispatch = _make_dispatch(responses={"frame": "ok"})
        _run(run_composition(comp, {}, dispatch))
        self.assertEqual(dispatch.calls[0][1]["count"], 5)
        self.assertEqual(dispatch.calls[0][1]["flags"], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
