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
import json
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

# Skill ids the auto-compound injection looks for. Accept both the Python
# function name (compound_recall) and the dotted shorthand (compound.recall)
# so a composition author can write either and the runner won't double-wrap.
_COMPOUND_RECALL_IDS = frozenset({"compound_recall", "compound.recall"})
_COMPOUND_REFLECT_IDS = frozenset({"compound_reflect", "compound.reflect"})


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
    context: dict[str, Any] | None = None,
) -> CompositionResult:
    """Execute a composition start-to-finish and return a structured result.

    `resolved_inputs` must already be valid per `composition.inputs` — this
    runner does not re-validate input types. Callers validate at the mutation
    boundary (startSkillRun) before invoking.

    `context` is optional run-scoped state that callers can use to opt into
    cross-cutting behaviors without changing the composition YAML. Recognized
    keys:
      * `scope` — a `{tenant_id, user_id?, skill_id, subject_entity_id?}`
        dict. When present, the runner auto-invokes `compound_recall` before
        the first declared step and `compound_reflect` after the last (Unit 3).
        If the composition already declares either step explicitly, that side
        of the wrap is skipped so authors who want custom recall/reflect
        semantics retain full control.
      * `recall_query` — override the string the auto-recall queries with.
        Defaults to the composition's description. Ignored when scope is absent.

    The runner is pure in the sense that it calls `dispatch` for any side
    effect — it doesn't touch the DB, doesn't post chat messages, doesn't
    write artifacts. Those belong to the caller (a later unit wires them in).
    """
    context = context or {}
    scope = context.get("scope")

    has_explicit_recall = _declares_skill(composition, _COMPOUND_RECALL_IDS)
    has_explicit_reflect = _declares_skill(composition, _COMPOUND_REFLECT_IDS)
    auto_recall = bool(scope) and not has_explicit_recall
    auto_reflect = bool(scope) and not has_explicit_reflect

    result = CompositionResult(composition_id=composition.id, status="complete")
    named_outputs: dict[str, Any] = {}

    if auto_recall:
        prior = await _auto_compound_recall(
            scope=scope,
            query=context.get("recall_query") or composition.description,
            dispatch=dispatch,
        )
        named_outputs["prior_learnings"] = prior

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

    # Reflect only when the run actually finished. Reflecting on a failed
    # run would poison the learnings pool with bad examples.
    if auto_reflect and result.status == "complete":
        await _auto_compound_reflect(
            scope=scope,
            resolved_inputs=resolved_inputs,
            named_outputs=named_outputs,
            step_results=result.step_results,
            dispatch=dispatch,
        )

    result.named_outputs = named_outputs
    return result


# --- Auto-compound helpers ---------------------------------------------------


def _declares_skill(composition: CompositionSkill, skill_ids: frozenset[str]) -> bool:
    """Does this composition's step list contain a step whose skill matches?"""
    for step in composition.steps:
        if isinstance(step, SequentialStep):
            if (step.skill or step.id) in skill_ids:
                return True
        elif isinstance(step, ParallelStep):
            for branch in step.branches:
                if branch.skill in skill_ids:
                    return True
    return False


def _scope_to_inputs(scope: dict[str, Any]) -> dict[str, str]:
    """Flatten a scope dict to the string-keyed args compound_* tools expect."""
    return {
        "tenant_id": str(scope.get("tenant_id") or ""),
        "user_id": str(scope.get("user_id") or ""),
        "skill_id": str(scope.get("skill_id") or ""),
        "subject_entity_id": str(scope.get("subject_entity_id") or ""),
    }


async def _auto_compound_recall(
    scope: dict[str, Any],
    query: str,
    dispatch: SkillDispatch,
) -> str:
    """Invoke compound_recall with scope inputs. Swallow any failure so the
    composition continues with an empty prior_learnings context."""
    inputs = {**_scope_to_inputs(scope), "query": query or ""}
    try:
        result = await dispatch("compound_recall", inputs)
    except Exception as exc:
        logger.warning("auto compound_recall failed: %s", exc)
        return ""
    if result is None:
        return ""
    return result if isinstance(result, str) else str(result)


async def _auto_compound_reflect(
    scope: dict[str, Any],
    resolved_inputs: dict[str, Any],
    named_outputs: dict[str, Any],
    step_results: list[StepResult],
    dispatch: SkillDispatch,
) -> None:
    """Invoke compound_reflect after the run. Best-effort — a write failure
    must not change the composition's status."""
    deliverable = _pick_deliverable(named_outputs, step_results)
    inputs = {
        **_scope_to_inputs(scope),
        "run_inputs": json.dumps(resolved_inputs, default=str),
        "deliverable": deliverable,
        "prior_learnings": str(named_outputs.get("prior_learnings") or ""),
    }
    try:
        await dispatch("compound_reflect", inputs)
    except Exception as exc:
        logger.warning("auto compound_reflect failed: %s", exc)


def _pick_deliverable(
    named_outputs: dict[str, Any], step_results: list[StepResult]
) -> str:
    """Heuristic: the deliverable is the named output called `deliverable`
    if one exists, otherwise the last step's output."""
    if "deliverable" in named_outputs:
        return str(named_outputs["deliverable"])
    if step_results:
        last = step_results[-1]
        if last.output is not None:
            return str(last.output)
    return ""


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
