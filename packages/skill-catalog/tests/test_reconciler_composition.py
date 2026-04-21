"""YAML load + shape tests for the reconciler-shaped seed composition
(`customer-onboarding-reconciler`).

The deliverable-shape invariants live in `test_seed_compositions.py`. A
reconciler is a different shape — no `frame`, no `package`, delivery goes
to `agent_owner` not chat, and critical-branch handling is stricter (both
the customer-lookup AND existing-tasks branches are critical, since a
missing existing_tasks read risks duplicate creates). This file pins those
invariants separately so a future author can't drift the reconciler into
a half-deliverable shape by accident.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

CATALOG = Path(__file__).resolve().parent.parent
CONTAINER = CATALOG.parent / "agentcore-strands" / "agent-container"
sys.path.insert(0, str(CONTAINER))

from skill_inputs import (
    CompositionSkill,
    OnBranchFailure,
    ParallelStep,
    SequentialStep,
    load_composition,
)

RECONCILER_YAML = (
    CATALOG / "customer-onboarding-reconciler" / "skill.yaml"
)


@pytest.fixture
def reconciler() -> CompositionSkill:
    return load_composition(str(RECONCILER_YAML))


class TestReconcilerShapeInvariants:
    def test_loads_clean(self, reconciler: CompositionSkill):
        assert reconciler.execution == "composition"
        assert reconciler.mode == "tool"
        assert reconciler.id == "customer-onboarding-reconciler"

    def test_has_no_frame_or_package_step(self, reconciler: CompositionSkill):
        # Reconciler shape is gather → synthesize → act. A `frame` step
        # implies "produce a deliverable from a question" — reconcilers
        # don't produce deliverables. A `package` step implies rendering
        # to a format (email body, PDF) — reconcilers write tasks, not
        # documents.
        step_ids = [s.id for s in reconciler.steps]
        assert "frame" not in step_ids
        assert "package" not in step_ids

    def test_steps_are_gather_synthesize_act(self, reconciler: CompositionSkill):
        step_ids = [s.id for s in reconciler.steps]
        assert step_ids == ["gather", "synthesize", "act"], (
            f"Reconciler shape invariant: steps must be "
            f"gather → synthesize → act (got {step_ids})"
        )

    def test_gather_is_strict_failure(self, reconciler: CompositionSkill):
        # Deliverables can degrade a gather branch and footer it. A
        # reconciler that lost its `existing_tasks` branch would start
        # creating duplicate tasks — that's worse than a failed run.
        gather = next(s for s in reconciler.steps if s.id == "gather")
        assert isinstance(gather, ParallelStep)
        assert gather.on_branch_failure == OnBranchFailure.FAIL

    def test_customer_and_existing_tasks_are_both_critical(
        self, reconciler: CompositionSkill
    ):
        # Customer context — needed to anchor the gap analysis.
        # existing_tasks — needed to avoid duplicate creates.
        # Both must be critical. Anything else is a bug.
        gather = next(s for s in reconciler.steps if s.id == "gather")
        assert isinstance(gather, ParallelStep)
        criticals = {b.id for b in gather.branches if b.critical}
        assert "customer" in criticals
        assert "existing_tasks" in criticals

    def test_synthesize_uses_gap_analysis_focus(
        self, reconciler: CompositionSkill
    ):
        # The `synthesize` primitive's `focus` field steers the analysis
        # toward gap-oriented reasoning instead of risks/opportunities.
        synth = next(s for s in reconciler.steps if s.id == "synthesize")
        assert isinstance(synth, SequentialStep)
        assert synth.inputs.get("focus") == "gap_analysis"

    def test_act_step_delegates_to_agent_sub_skill(
        self, reconciler: CompositionSkill
    ):
        act = next(s for s in reconciler.steps if s.id == "act")
        assert isinstance(act, SequentialStep)
        # Sub-skill path under the composition's own package — the
        # convention for composition-owned sub-skills.
        assert act.skill == "customer-onboarding-reconciler/act"

    def test_delivery_is_agent_owner_only(self, reconciler: CompositionSkill):
        # Webhook-invoked runs have no chat thread. Email delivery would
        # be a 2-party send without a rendered deliverable. agent_owner
        # is the only sensible channel; anything else is misconfiguration.
        assert reconciler.delivery == ["agent_owner"]

    def test_has_webhook_trigger(self, reconciler: CompositionSkill):
        # R3a + D7b — webhook is a first-class invocation path.
        assert reconciler.triggers is not None
        assert reconciler.triggers.webhook is not None
        sources = {ex.source for ex in reconciler.triggers.webhook.examples}
        assert "crm" in sources, "reconciler must document CRM webhook trigger"
        assert "task-system" in sources, (
            "reconciler must document task-event webhook trigger "
            "(this is the HITL re-invoke path)"
        )

    def test_no_scheduled_trigger(self, reconciler: CompositionSkill):
        # v1: event-driven only. A cron fallback is Phase 2 once we've
        # seen real quiet-period behavior.
        assert reconciler.triggers is not None
        assert reconciler.triggers.schedule is None

    def test_no_tenant_overridable_fields(self, reconciler: CompositionSkill):
        # v1 locks the reconciler body. Override surface area expands
        # once we have real adoption data; opening it prematurely risks
        # customer-specific divergence from the canonical shape.
        assert reconciler.tenant_overridable == []
