"""Composition runner: executes a validated CompositionSkill step-by-step.

Design invariants (see docs/plans/2026-04-21-003-...-plan.md):

  * Runs synchronously inside one AgentCore Runtime session — no queues, no
    cross-invocation state machine, no phase-artifact table.
  * Sequential steps run one at a time; parallel steps fan out via
    asyncio.gather with per-branch timeouts and per-branch critical flags.
  * Critical branch failure: run aborts with status=failed, no further steps.
  * Non-critical branch failure (on_branch_failure=continue_with_footer):
    run continues; the failure is recorded as a footer on the step output.
  * Reconciler contract: sub-skills MUST NOT block waiting for external events.
    That's a contributor-facing rule; this runner enforces it implicitly via
    the per-branch timeout.

The runner is intentionally skill-dispatch-agnostic. A caller supplies a
`dispatch` coroutine `(skill_id, inputs) -> result`; the runner handles the
orchestration shape. In production that coroutine is wired to the Strands
agent; in tests it's stubbed so the orchestration can be exercised
independently.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from skill_inputs import (
    CompositionSkill,
    OnBranchFailure,
    ParallelBranch,
    ParallelStep,
    SequentialStep,
)

logger = logging.getLogger(__name__)


# --- Dispatch contract -------------------------------------------------------


SkillDispatch = Callable[[str, dict[str, Any]], Awaitable[Any]]
"""A coroutine that invokes a skill by id with resolved inputs and returns its output.

In production this is wrapped around the Strands agent; tests substitute a stub.
"""


# --- Result objects ----------------------------------------------------------


@dataclass
class BranchResult:
    id: str
    skill: str
    status: str  # "complete" | "failed" | "timed_out"
    output: Any = None
    error_reason: str | None = None
    critical: bool = False


@dataclass
class StepResult:
    id: str
    mode: str  # "sequential" | "parallel"
    status: str  # "complete" | "failed" | "footered"
    output: Any = None
    footer_notes: list[str] = field(default_factory=list)
    branch_results: list[BranchResult] = field(default_factory=list)


@dataclass
class CompositionResult:
    composition_id: str
    status: str  # "complete" | "failed"
    step_results: list[StepResult] = field(default_factory=list)
    named_outputs: dict[str, Any] = field(default_factory=dict)
    failure_reason: str | None = None


# --- Runner ------------------------------------------------------------------


async def run_composition(
    composition: CompositionSkill,
    resolved_inputs: dict[str, Any],
    dispatch: SkillDispatch,
) -> CompositionResult:
    """Execute a composition start-to-finish and return a structured result.

    `resolved_inputs` must already be valid per `composition.inputs` — this
    runner does not re-validate input types. Callers validate at the mutation
    boundary (startSkillRun) before invoking.

    The runner is pure in the sense that it calls `dispatch` for any side
    effect — it doesn't touch the DB, doesn't post chat messages, doesn't
    write artifacts. Those belong to the caller (a later unit wires them in).
    """
    result = CompositionResult(composition_id=composition.id, status="complete")
    named_outputs: dict[str, Any] = {}

    for step in composition.steps:
        if isinstance(step, SequentialStep):
            step_result = await _run_sequential(step, resolved_inputs, named_outputs, dispatch)
        elif isinstance(step, ParallelStep):
            step_result = await _run_parallel(step, resolved_inputs, named_outputs, dispatch)
        else:  # pragma: no cover — discriminator guarantees one of the two
            raise TypeError(f"unknown step type: {type(step).__name__}")

        result.step_results.append(step_result)

        if step_result.status == "failed":
            result.status = "failed"
            result.failure_reason = (
                f"step {step.id!r} failed"
                + (f": {step_result.footer_notes[0]}" if step_result.footer_notes else "")
            )
            break

        if step_result.output is not None:
            output_key = getattr(step, "output", None) or step.id
            named_outputs[output_key] = step_result.output

    result.named_outputs = named_outputs
    return result


# --- Sequential -------------------------------------------------------------


async def _run_sequential(
    step: SequentialStep,
    resolved_inputs: dict[str, Any],
    named_outputs: dict[str, Any],
    dispatch: SkillDispatch,
) -> StepResult:
    step_inputs = _materialize_inputs(step.inputs, resolved_inputs, named_outputs)
    try:
        output = await asyncio.wait_for(
            dispatch(step.skill or step.id, step_inputs),
            timeout=step.timeout_seconds,
        )
        return StepResult(id=step.id, mode="sequential", status="complete", output=output)
    except TimeoutError:
        msg = f"{step.skill or step.id} timed out after {step.timeout_seconds}s"
        logger.warning("composition step timed out: %s", msg)
        return StepResult(
            id=step.id, mode="sequential", status="failed", footer_notes=[msg]
        )
    except Exception as exc:
        msg = f"{step.skill or step.id} error: {type(exc).__name__}"
        logger.warning("composition step errored: %s", msg)
        return StepResult(
            id=step.id, mode="sequential", status="failed", footer_notes=[msg]
        )


# --- Parallel ----------------------------------------------------------------


async def _run_parallel(
    step: ParallelStep,
    resolved_inputs: dict[str, Any],
    named_outputs: dict[str, Any],
    dispatch: SkillDispatch,
) -> StepResult:
    branch_tasks = [
        _run_branch(branch, resolved_inputs, named_outputs, dispatch)
        for branch in step.branches
    ]
    branch_results: list[BranchResult] = await asyncio.gather(*branch_tasks)

    critical_failures = [
        br for br in branch_results if br.status != "complete" and br.critical
    ]
    if critical_failures:
        msgs = [f"{br.skill}: {br.error_reason}" for br in critical_failures]
        return StepResult(
            id=step.id,
            mode="parallel",
            status="failed",
            footer_notes=msgs,
            branch_results=branch_results,
        )

    non_critical_failures = [
        br for br in branch_results if br.status != "complete" and not br.critical
    ]
    footer_notes = [
        f"{br.skill} unavailable: {br.error_reason}" for br in non_critical_failures
    ]

    # Aggregate successful branch outputs keyed by branch id.
    aggregated = {
        br.id: br.output for br in branch_results if br.status == "complete"
    }

    if step.on_branch_failure == OnBranchFailure.FAIL and non_critical_failures:
        return StepResult(
            id=step.id,
            mode="parallel",
            status="failed",
            footer_notes=footer_notes,
            branch_results=branch_results,
        )

    final_status = "footered" if footer_notes else "complete"
    return StepResult(
        id=step.id,
        mode="parallel",
        status=final_status,
        output=aggregated,
        footer_notes=footer_notes,
        branch_results=branch_results,
    )


async def _run_branch(
    branch: ParallelBranch,
    resolved_inputs: dict[str, Any],
    named_outputs: dict[str, Any],
    dispatch: SkillDispatch,
) -> BranchResult:
    branch_inputs = _materialize_inputs(branch.inputs, resolved_inputs, named_outputs)
    try:
        output = await asyncio.wait_for(
            dispatch(branch.skill, branch_inputs),
            timeout=branch.timeout_seconds,
        )
        return BranchResult(
            id=branch.id,
            skill=branch.skill,
            status="complete",
            output=output,
            critical=branch.critical,
        )
    except TimeoutError:
        return BranchResult(
            id=branch.id,
            skill=branch.skill,
            status="timed_out",
            error_reason=f"timed out after {branch.timeout_seconds}s",
            critical=branch.critical,
        )
    except Exception as exc:
        return BranchResult(
            id=branch.id,
            skill=branch.skill,
            status="failed",
            error_reason=f"{type(exc).__name__}",
            critical=branch.critical,
        )


# --- Input materialization ---------------------------------------------------


_PLACEHOLDER_PREFIX = "{"
_PLACEHOLDER_SUFFIX = "}"


def _materialize_inputs(
    step_inputs: dict[str, Any],
    resolved_inputs: dict[str, Any],
    named_outputs: dict[str, Any],
) -> dict[str, Any]:
    """Resolve `{placeholder}` references in a step's declared inputs.

    Values may reference either top-level composition inputs (`{customer}`) or
    prior step outputs (`{gather}` → the aggregated branch outputs for step id
    `gather`). Non-placeholder values pass through unchanged. Unknown
    placeholders are left literal — the dispatched skill sees the raw string
    and decides how to handle it. (We don't raise; the runner is intentionally
    permissive to let authors iterate on prompts without hitting validation
    errors for every typo.)
    """
    materialized: dict[str, Any] = {}
    for key, value in step_inputs.items():
        materialized[key] = _resolve_placeholder(value, resolved_inputs, named_outputs)
    return materialized


def _resolve_placeholder(
    value: Any,
    resolved_inputs: dict[str, Any],
    named_outputs: dict[str, Any],
) -> Any:
    if not isinstance(value, str):
        return value
    if not (value.startswith(_PLACEHOLDER_PREFIX) and value.endswith(_PLACEHOLDER_SUFFIX)):
        return value
    # Only fully-wrapped tokens are treated as references (no partial
    # interpolation in v1 — keep semantics obvious).
    key = value[1:-1].strip()
    if key in named_outputs:
        return named_outputs[key]
    if key in resolved_inputs:
        return resolved_inputs[key]
    return value
