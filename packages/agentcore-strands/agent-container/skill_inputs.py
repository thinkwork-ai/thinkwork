"""Pydantic schemas for composition-mode skills (Unit 1 of the composable-skills plan).

Composition-mode skills declare a sequence of sub-skill invocations (sequential
steps + one level of parallel fan-out) and are loaded from a `skill.yaml` file
with `execution: composition`. The schema here validates:

  * Typed inputs (string | date | enum | int) with resolver + on_missing_input
  * A `tenant_overridable` allowlist of dotted paths (server-enforced elsewhere)
  * Composition steps with critical-branch semantics and per-step timeouts
  * Trigger shapes for chat intent / cron schedule / webhook

The loader intentionally does NOT touch execution: script skills — those keep
using the hand-rolled parser in skill_runner.py for back-compat.

Reviewer guidance baked in:
  * axis is `execution: script | context | mcp | composition` × `mode: tool | agent`
    (not `mode: composition` — that was an early-draft slip)
  * path-component sanitizer helper deferred until a templated-path output
    destination (wiki, PDF) actually ships
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# --- Enums -------------------------------------------------------------------


class InputType(StrEnum):
    STRING = "string"
    DATE = "date"
    ENUM = "enum"
    INT = "int"


class OnMissingInput(StrEnum):
    ASK = "ask"
    DEFAULT = "default"
    FAIL = "fail"


class OnBranchFailure(StrEnum):
    CONTINUE_WITH_FOOTER = "continue_with_footer"
    FAIL = "fail"


class Disambiguation(StrEnum):
    ASK = "ask"
    HIGHEST_CONFIDENCE = "highest_confidence"
    REFUSE = "refuse"


# --- Input specification -----------------------------------------------------


class InputSpec(BaseModel):
    """Typed input for a composition skill."""

    model_config = ConfigDict(extra="forbid")

    type: InputType
    required: bool = False
    resolver: str | None = None
    on_missing_input: OnMissingInput = OnMissingInput.FAIL
    values: list[str] | None = None  # enum only
    default: Any = None

    @model_validator(mode="after")
    def _check_enum_values(self) -> InputSpec:
        if self.type == InputType.ENUM and not self.values:
            raise ValueError("enum inputs must declare 'values'")
        if self.type != InputType.ENUM and self.values is not None:
            raise ValueError("'values' is only valid on enum inputs")
        return self


# --- Step shapes -------------------------------------------------------------


class ParallelBranch(BaseModel):
    """A single branch inside a parallel step."""

    model_config = ConfigDict(extra="forbid")

    id: str
    skill: str
    inputs: dict[str, Any] = Field(default_factory=dict)
    critical: bool = False
    timeout_seconds: int = Field(default=120, gt=0)
    prompt_file: str | None = None


class SequentialStep(BaseModel):
    """A step that runs a single skill invocation sequentially."""

    model_config = ConfigDict(extra="forbid")

    id: str
    mode: Literal["sequential"] = "sequential"
    skill: str | None = None  # defaults to id when absent
    inputs: dict[str, Any] = Field(default_factory=dict)
    reads: list[str] = Field(default_factory=list)
    output: str | None = None
    prompt_file: str | None = None
    deliverable_template: str | None = None
    timeout_seconds: int = Field(default=120, gt=0)

    @model_validator(mode="after")
    def _default_skill_to_id(self) -> SequentialStep:
        if not self.skill:
            # Pydantic v2: mutate via model_copy is awkward; just set the field.
            object.__setattr__(self, "skill", self.id)
        return self


class ParallelStep(BaseModel):
    """A step that fans out over multiple branches executed concurrently."""

    model_config = ConfigDict(extra="forbid")

    id: str
    mode: Literal["parallel"]
    branches: list[ParallelBranch] = Field(..., min_length=1)
    on_branch_failure: OnBranchFailure = OnBranchFailure.CONTINUE_WITH_FOOTER
    output: str | None = None


Step = Annotated[
    SequentialStep | ParallelStep,
    Field(discriminator="mode"),
]


# --- Triggers ----------------------------------------------------------------


class ChatIntentTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    examples: list[str] = Field(default_factory=list)
    disambiguation: Disambiguation = Disambiguation.ASK


class ScheduleTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["cron", "rate"]
    expression: str
    bindings: dict[str, Any] = Field(default_factory=dict)


class WebhookTriggerExample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str
    event: str
    when: str | None = None


class WebhookTrigger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    examples: list[WebhookTriggerExample] = Field(default_factory=list)


class Triggers(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chat_intent: ChatIntentTrigger | None = None
    schedule: ScheduleTrigger | None = None
    webhook: WebhookTrigger | None = None


# --- Budget ------------------------------------------------------------------


class BudgetCap(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tokens: int = Field(default=200_000, gt=0, le=1_000_000)


# --- Delivery ----------------------------------------------------------------


# Delivery destinations are either a plain string name (e.g. "chat", "email",
# "agent_owner") or a single-key dict when the destination needs config
# (e.g. {"wiki": "accounts/{customer.slug}/briefs/{meeting_date}"}).
DeliveryEntry = str | dict[str, Any]


# --- Composition skill root --------------------------------------------------


class CompositionSkill(BaseModel):
    """Top-level composition skill loaded from skill.yaml."""

    model_config = ConfigDict(extra="forbid")

    id: str
    version: int
    execution: Literal["composition"]
    mode: Literal["tool", "agent"] = "tool"
    name: str
    description: str
    inputs: dict[str, InputSpec] = Field(default_factory=dict)
    tenant_overridable: list[str] = Field(default_factory=list)
    delivery: list[DeliveryEntry] = Field(default_factory=list)
    triggers: Triggers | None = None
    budget_cap: BudgetCap | None = None
    steps: list[Step] = Field(..., min_length=1)

    @model_validator(mode="after")
    def _validate_unique_step_ids(self) -> CompositionSkill:
        seen: set[str] = set()
        for step in self.steps:
            if step.id in seen:
                raise ValueError(f"duplicate step id: {step.id!r}")
            seen.add(step.id)
            if isinstance(step, ParallelStep):
                branch_ids: set[str] = set()
                for branch in step.branches:
                    if branch.id in branch_ids:
                        raise ValueError(
                            f"duplicate branch id in step {step.id!r}: {branch.id!r}"
                        )
                    branch_ids.add(branch.id)
        return self

    @model_validator(mode="after")
    def _validate_overridable_paths(self) -> CompositionSkill:
        for path in self.tenant_overridable:
            if not _overridable_path_resolves(self, path):
                raise ValueError(
                    f"tenant_overridable path {path!r} does not resolve to a field "
                    "on this composition"
                )
        return self


# --- Dotted-path resolver for tenant_overridable -----------------------------


_TOP_LEVEL_PREFIXES = frozenset({"inputs", "delivery", "triggers", "budget_cap"})


def _overridable_path_resolves(comp: CompositionSkill, path: str) -> bool:
    """Check that a dotted-path entry in `tenant_overridable` resolves to a real field.

    Supported prefixes:
      * inputs.<name>(.default|.resolver|.on_missing_input|.values)
      * delivery.<destination_name>  (must be present in comp.delivery)
      * triggers.<chat_intent|schedule|webhook>(.<sub-field>...)
      * budget_cap.tokens

    Anything else returns False so the caller raises ValidationError with a
    specific offending path.
    """
    if not path:
        return False
    parts = path.split(".")
    head = parts[0]
    if head not in _TOP_LEVEL_PREFIXES:
        return False

    if head == "inputs":
        if len(parts) < 2:
            return False
        input_name = parts[1]
        if input_name not in comp.inputs:
            return False
        if len(parts) == 2:
            return True
        # walk remaining parts against InputSpec fields
        return _walk_pydantic(comp.inputs[input_name], parts[2:])

    if head == "delivery":
        if len(parts) < 2:
            return False
        dest_name = parts[1]
        for entry in comp.delivery:
            if isinstance(entry, str) and entry == dest_name:
                return True
            if isinstance(entry, dict) and dest_name in entry:
                return True
        return False

    if head == "triggers":
        if comp.triggers is None:
            return False
        if len(parts) < 2:
            return True
        return _walk_pydantic(comp.triggers, parts[1:])

    if head == "budget_cap":
        if comp.budget_cap is None:
            return False
        if len(parts) < 2:
            return True
        return _walk_pydantic(comp.budget_cap, parts[1:])

    return False


def _walk_pydantic(model: Any, parts: list[str]) -> bool:
    cur: Any = model
    for p in parts:
        if isinstance(cur, BaseModel):
            if p not in type(cur).model_fields:
                return False
            cur = getattr(cur, p)
            if cur is None:
                # optional sub-model absent — path is still structurally valid
                return True
        elif isinstance(cur, dict):
            if p not in cur:
                return False
            cur = cur[p]
        else:
            return False
    return True


# --- Loaders -----------------------------------------------------------------


def load_composition(yaml_path: str) -> CompositionSkill:
    """Load + validate a composition skill from a YAML file.

    Raises ValueError if the file is not a composition-mode skill.
    Raises pydantic.ValidationError on schema violations.
    """
    import yaml

    with open(yaml_path) as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"Expected mapping at root of {yaml_path}")
    if data.get("execution") != "composition":
        raise ValueError(
            f"{yaml_path}: execution must be 'composition' "
            f"(got {data.get('execution')!r})"
        )
    return CompositionSkill.model_validate(data)


def validate_composition_file(yaml_path: str) -> tuple[bool, list[str]]:
    """Return (ok, errors) for a composition YAML file.

    Used by scripts/validate-skill-catalog.sh to lint the seed library.
    """
    try:
        load_composition(yaml_path)
        return True, []
    except Exception as exc:
        return False, [f"{yaml_path}: {exc}"]
