"""YAML load + shape tests for the three deliverable-shaped seed compositions.

These tests exercise Unit 1's Pydantic schema by loading each composition
YAML end-to-end and asserting the shape invariants every deliverable-shaped
composition must preserve. If a future author edits one of these YAMLs in
a way that breaks the contract (e.g., removes the CRM branch's critical
flag, swaps the package format to something not in the enum), CI fails
here before any skill catalog sync or deploy touches production.

Integration tests that actually run the composition_runner against these
YAMLs with mocked dispatches are deferred to a follow-up unit (they need
an e2e harness that stubs the agentcore-invoke Lambda + AgentCore
Memory). This file's scope is: the YAML is structurally valid, loads
cleanly, and preserves the invariants the rest of the stack assumes.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

CATALOG = Path(__file__).resolve().parent.parent
CONTAINER = (
    CATALOG.parent / "agentcore-strands" / "agent-container"
)
sys.path.insert(0, str(CONTAINER))

from skill_inputs import (
    CompositionSkill,
    InputType,
    OnBranchFailure,
    ParallelStep,
    SequentialStep,
    load_composition,
)

SEEDS = {
    "sales-prep": CATALOG / "sales-prep" / "skill.yaml",
    "account-health-review": CATALOG / "account-health-review" / "skill.yaml",
    "renewal-prep": CATALOG / "renewal-prep" / "skill.yaml",
}

PACKAGE_FORMATS = {"sales_brief", "health_report", "renewal_risk"}


@pytest.fixture(params=list(SEEDS.keys()))
def composition(request):
    return load_composition(str(SEEDS[request.param]))


# --- Shape invariants every deliverable composition must preserve -----------


class TestDeliverableShapeInvariants:
    def test_loads_without_validation_error(self, composition: CompositionSkill):
        # load_composition already validated; this test codifies the
        # expectation that all three seeds are load-clean.
        assert composition.execution == "composition"
        assert composition.mode == "tool"

    def test_has_required_customer_input(self, composition: CompositionSkill):
        # Every deliverable-shaped seed is scoped to a customer. Changes
        # to this requires an authoring-guide update.
        assert "customer" in composition.inputs
        customer = composition.inputs["customer"]
        assert customer.required is True
        assert customer.type == InputType.STRING
        assert customer.resolver == "resolve_customer"

    def test_step_order_is_frame_gather_synthesize_package(
        self, composition: CompositionSkill
    ):
        step_ids = [s.id for s in composition.steps]
        assert step_ids == ["frame", "gather", "synthesize", "package"], (
            f"Deliverable shape invariant: steps must be "
            f"frame → gather → synthesize → package (got {step_ids})"
        )

    def test_gather_is_parallel_with_continue_footer(
        self, composition: CompositionSkill
    ):
        gather = next(s for s in composition.steps if s.id == "gather")
        assert isinstance(gather, ParallelStep)
        # Non-critical branches should degrade gracefully — every
        # deliverable shape relies on this.
        assert gather.on_branch_failure == OnBranchFailure.CONTINUE_WITH_FOOTER

    def test_gather_has_at_least_one_critical_branch(
        self, composition: CompositionSkill
    ):
        # A composition with zero critical branches can't fail even when
        # the anchor data source is down — it'll render a deliverable
        # with every section footered as "unavailable." That's worse
        # than a clean failure.
        gather = next(s for s in composition.steps if s.id == "gather")
        assert isinstance(gather, ParallelStep)
        critical_branches = [b for b in gather.branches if b.critical]
        assert len(critical_branches) >= 1, (
            "Deliverable compositions must have at least one critical "
            "gather branch — otherwise a complete outage renders a "
            "deliverable full of 'unavailable' footers with no clean abort."
        )

    def test_package_step_uses_a_known_format(
        self, composition: CompositionSkill
    ):
        package = next(s for s in composition.steps if s.id == "package")
        assert isinstance(package, SequentialStep)
        fmt = package.inputs.get("format")
        assert fmt in PACKAGE_FORMATS, (
            f"package.inputs.format must be one of {PACKAGE_FORMATS} "
            f"(got {fmt}). Add a new template under "
            f"packages/skill-catalog/package/templates/ + update the "
            f"enum before referencing a new format here."
        )

    def test_output_wiring_is_consistent(self, composition: CompositionSkill):
        # The downstream contract is: frame produces `framed`, gather
        # produces `gathered`, synthesize produces `synthesis`, package
        # produces `deliverable`. Naming drift breaks the package
        # template + downstream delivery pipeline.
        outputs = {s.id: getattr(s, "output", None) for s in composition.steps}
        assert outputs == {
            "frame": "framed",
            "gather": "gathered",
            "synthesize": "synthesis",
            "package": "deliverable",
        }, (
            f"Step outputs must follow the deliverable-shape convention "
            f"(got {outputs})"
        )


# --- Per-composition specifics -----------------------------------------------


class TestSalesPrepSpecifics:
    def setup_method(self):
        self.comp = load_composition(str(SEEDS["sales-prep"]))

    def test_focus_input_enum(self):
        focus = self.comp.inputs["focus"]
        assert focus.type == InputType.ENUM
        assert focus.values == ["financial", "expansion", "risks", "general"]
        assert focus.default == "general"

    def test_focus_default_is_tenant_overridable(self):
        assert "inputs.focus.default" in self.comp.tenant_overridable

    def test_has_both_chat_and_schedule_triggers(self):
        assert self.comp.triggers is not None
        assert self.comp.triggers.chat_intent is not None
        assert self.comp.triggers.schedule is not None
        assert self.comp.triggers.schedule.type == "cron"

    def test_crm_branch_is_critical(self):
        gather = next(s for s in self.comp.steps if s.id == "gather")
        assert isinstance(gather, ParallelStep)
        crm = next((b for b in gather.branches if b.id == "crm"), None)
        assert crm is not None and crm.critical is True

    def test_package_format_is_sales_brief(self):
        package = next(s for s in self.comp.steps if s.id == "package")
        assert isinstance(package, SequentialStep)
        assert package.inputs["format"] == "sales_brief"


class TestAccountHealthReviewSpecifics:
    def setup_method(self):
        self.comp = load_composition(str(SEEDS["account-health-review"]))

    def test_period_input_enum(self):
        period = self.comp.inputs["period"]
        assert period.type == InputType.ENUM
        assert period.values == ["last_30_days", "last_quarter", "last_year"]

    def test_focus_is_hardcoded_to_risks(self):
        # Health reviews are risk-oriented by definition — passing a
        # different focus would dilute the signal. The YAML pins this
        # rather than exposing it as an input.
        synthesize = next(s for s in self.comp.steps if s.id == "synthesize")
        assert isinstance(synthesize, SequentialStep)
        assert synthesize.inputs.get("focus") == "risks"

    def test_package_format_is_health_report(self):
        package = next(s for s in self.comp.steps if s.id == "package")
        assert isinstance(package, SequentialStep)
        assert package.inputs["format"] == "health_report"

    def test_schedule_is_weekly_monday_morning(self):
        assert self.comp.triggers is not None
        sched = self.comp.triggers.schedule
        assert sched is not None
        assert sched.expression == "0 9 ? * MON *"


class TestRenewalPrepSpecifics:
    def setup_method(self):
        self.comp = load_composition(str(SEEDS["renewal-prep"]))

    def test_renewal_date_required(self):
        d = self.comp.inputs["renewal_date"]
        assert d.required is True
        assert d.type == InputType.DATE

    def test_contract_summary_is_the_critical_branch(self):
        # Renewal prep without contract terms has no anchor — it'd
        # surface usage / AR / NPS speculation without the deal facts
        # to frame them. Critical-branch means an outage aborts instead.
        gather = next(s for s in self.comp.steps if s.id == "gather")
        assert isinstance(gather, ParallelStep)
        critical = [b for b in gather.branches if b.critical]
        assert len(critical) == 1
        assert critical[0].id == "contract"

    def test_package_format_is_renewal_risk(self):
        package = next(s for s in self.comp.steps if s.id == "package")
        assert isinstance(package, SequentialStep)
        assert package.inputs["format"] == "renewal_risk"

    def test_schedule_cadence_is_daily(self):
        # Renewal windows are time-sensitive; weekly misses deals.
        assert self.comp.triggers is not None
        sched = self.comp.triggers.schedule
        assert sched is not None
        assert sched.expression.startswith("0 7")  # daily 07:00


# --- Cross-composition coverage ---------------------------------------------


def test_three_seeds_exercise_three_distinct_package_formats():
    """Together, the three deliverable-shaped seeds must cover all three
    package templates. If someone adds a fourth seed and swaps an existing
    one to use a template already covered, we'd quietly drop coverage of
    one of the three formats from CI. Pin the invariant."""
    formats = set()
    for path in SEEDS.values():
        comp = load_composition(str(path))
        package = next(s for s in comp.steps if s.id == "package")
        assert isinstance(package, SequentialStep)
        formats.add(package.inputs["format"])
    assert formats == PACKAGE_FORMATS
