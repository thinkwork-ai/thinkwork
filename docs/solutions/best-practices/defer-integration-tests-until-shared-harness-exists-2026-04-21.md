---
module: packages/skill-catalog/tests + packages/api/test/integration (planned)
date: 2026-04-21
category: best-practices
problem_type: best_practice
component: testing_framework
severity: medium
related_components:
  - development_workflow
applies_when:
  - "A plan lists many integration tests that all need the same infrastructure (Lambda stub, AgentCore Memory stub, mock GraphQL harness)"
  - "Each test would require rebuilding most of that infrastructure per file"
  - "Shape-invariant or contract-level tests can cover the immediate regression surface at PR time"
  - "The harness is a legitimate standalone piece of work, not something to cobble together on the side"
tags:
  - testing
  - integration-tests
  - yagni
  - test-harness
  - incremental-delivery
  - skill-runs
---

# Defer integration tests until the shared harness earns its first customer

## Context

Unit 9 of the composable-skills plan listed 8 integration tests:
`chat-intent.test.ts`, `scheduled.test.ts`, `catalog.test.ts`,
`webhook.test.ts`, `critical-failure.test.ts`, `cancel.test.ts`,
`learnings-roundtrip.test.ts`, and `reconciler-hitl-loop.test.ts`.
Each exercises a different invocation path or failure mode against
a composition-runner + AgentCore Memory + GraphQL mutation stack.

Every test would need the same harness: a stub for the
`agentcore-invoke` Lambda (RequestResponse return shape + the
`run_skill` envelope contract), a stub for AgentCore Memory
(recall returns seed learnings, reflect captures writes), a mock
of the `startSkillRun` mutation's DB side effects, and a way to
drive the composition_runner from test fixtures. Building that
harness piecemeal across 8 test files would mean 8 parallel
copies of the infrastructure, each slightly different, drifting
independently.

We shipped zero integration tests in Unit 9 and instead shipped
35 **YAML-load + shape-invariant tests** that exercise Unit 1's
Pydantic schema against the seed compositions (step order,
output wiring, critical-branch invariant, package-format enum
coverage). Full integration tests defer to Unit 8 alongside the
webhook ingress — when the harness is built once, the cost
amortizes across 8+ tests.

This is the *"defer the shared infrastructure until it earns
itself"* instinct applied to test harnesses. This doc captures
the reasoning and the guardrail — what tests did ship, so the
deferral doesn't leave the PR untested.

## Guidance

When a plan lists many integration tests that share infrastructure
needs, but the infrastructure doesn't exist yet, **don't ship the
integration tests yet**. Building the harness piecemeal produces 8
divergent copies; building it on the side of an otherwise-scoped
PR expands the PR's blast radius; building it as its own deferred
piece of work lets it be designed with all N consumers in view.

The deferral is only honest if you replace the gap with **tests
that catch the real risks at PR time**, not "tests deferred"
with nothing in the breach. In Unit 9's case the risks at PR time
were:

- Seed composition YAML might be structurally invalid (fails
  Pydantic validation or the composition runner's assumptions)
- Authors copy-pasting new compositions might break shape
  invariants (step order, critical-branch count, output wiring)
- Composition authors reach for a new `package.format` without
  adding the template

All three of those are tractable with load + shape tests. We
shipped 35 of them, parametrized across the three seed
compositions, covering every shape invariant we knew to care
about. The deferred integration tests catch a *different* risk
(runtime failure modes: AgentCore Memory unavailable, critical
branch timeout, HITL loop re-entry idempotency) that the shape
tests genuinely can't catch — but those risks don't fire at PR
time, they fire on real runs, and the lag until Unit 8 is short
enough that the risk is acceptable.

## Why This Matters

"Test-first" is load-bearing when the infrastructure to test
against is obvious. When the infrastructure is itself a design
question — what's a "stub AgentCore Memory"? does it store real
rows or just shape-correct responses? how do we inject a mocked
Lambda into a composition_runner that reaches out via an
envelope? — building it on the side of feature work produces
bad infrastructure. One of the 8 files will design the
"obvious" stub; the next 7 will inherit its shortcuts; three
PRs later someone notices half the tests aren't exercising what
they claim to exercise.

The cheap alternative: write the contract tests you *can* write
cheaply at the right layer (Pydantic schema + shape invariants
in this case), mark the integration tests explicitly deferred
with a named owner (Unit 8), and let the harness be designed
deliberately by the unit that needs all N tests at once.

## When to Apply

This pattern fits when:

- The deferred tests all share a specific piece of test
  infrastructure that doesn't exist yet
- Building that infrastructure is a legitimate N-hour piece of
  work, not a 15-minute scaffold
- There's a shape-level or contract-level test you can ship
  **instead** that covers the regressions the PR could actually
  introduce
- There's a named future owner (PR, unit, or sprint) who will
  build the harness in one focused pass

Does **not** fit when:

- The tests are simple unit tests that don't share infrastructure
- The harness would be cheap to scaffold and the deferral is just
  "I don't feel like it"
- No shape/contract tests are available — at which point you're
  shipping untested feature work, not deferred integration tests
- The "future owner" is unclear or there's no commitment to the
  next step

## Examples

**Unit 9's 35 shape tests — what fills the gap at PR time:**

```python
# packages/skill-catalog/tests/test_seed_compositions.py
class TestDeliverableShapeInvariants:
    def test_step_order_is_frame_gather_synthesize_package(self, composition):
        step_ids = [s.id for s in composition.steps]
        assert step_ids == ["frame", "gather", "synthesize", "package"]

    def test_gather_has_at_least_one_critical_branch(self, composition):
        gather = next(s for s in composition.steps if s.id == "gather")
        critical_branches = [b for b in gather.branches if b.critical]
        assert len(critical_branches) >= 1, (
            "Deliverable compositions must have at least one critical "
            "gather branch — otherwise a complete outage renders a "
            "deliverable full of 'unavailable' footers with no clean abort."
        )

    def test_package_step_uses_a_known_format(self, composition):
        package = next(s for s in composition.steps if s.id == "package")
        fmt = package.inputs.get("format")
        assert fmt in {"sales_brief", "health_report", "renewal_risk"}

def test_three_seeds_exercise_three_distinct_package_formats():
    """Together, the three deliverable-shaped seeds must cover all
    three package templates. Catches the regression where adding a
    seed drops coverage of an existing format."""
    formats = {
        next(s for s in load_composition(str(path)).steps
             if s.id == "package").inputs["format"]
        for path in SEEDS.values()
    }
    assert formats == {"sales_brief", "health_report", "renewal_risk"}
```

Parametrized across three seeds: 35 tests total, each one running
in milliseconds, catching the regressions a composition author can
plausibly introduce.

**The integration tests Unit 8 inherits, with the contract
pre-specified:**

The Unit 9 PR description + this doc name each deferred test and
its coverage target:

| Test | Coverage target |
|------|-----------------|
| `chat-intent.test.ts` | skill-dispatcher routes a user message to `startSkillRun`, posts ack, composition runs end-to-end |
| `scheduled.test.ts` | `job-trigger.ts` skill_run branch fires correctly on EventBridge |
| `catalog.test.ts` | Admin "Run now" button hits `startSkillRun` with the right caller context |
| `webhook.test.ts` | CRM webhook handler validates signing secret + dispatches to tenant system-user |
| `critical-failure.test.ts` | Critical gather branch failure aborts the run with `status = failed` |
| `cancel.test.ts` | `cancelSkillRun` flips status; composition_runner aborts between steps |
| `learnings-roundtrip.test.ts` | Run 1 reflects → Run 2 recalls → second brief cites first's learning |
| `reconciler-hitl-loop.test.ts` | Tick 1 → task completion webhook → Tick 2 → no duplicate task creation |

Unit 8 inherits a specific, enumerated set. The harness can be
designed to satisfy all 8 tests' needs at once — stub AgentCore
Memory that records writes and returns them on recall, a fake
Lambda invoker that drives the composition_runner directly,
a mock GraphQL client that returns typed responses. Designed
once, applied 8×.

## When to revisit this doc

If Unit 8 ships, builds the harness, and the deferred tests all
land cleanly — this pattern worked, keep it.

If Unit 8 ships, builds the harness, and half the tests turn out
to need different infrastructure anyway — the deferral was a
mistake; the right move would have been to build each test's
stubs independently. Update this doc with the counter-example.

If Unit 8 never ships and the deferred tests sit un-implemented —
the pattern degenerates into "defer tests forever." Update this
doc's guardrails: deferrals need commitment dates, not just
named owners.

## Related

- `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md`
  (Unit 9 section) — the plan that listed the 8 integration tests.
- `packages/skill-catalog/tests/test_seed_compositions.py` — the 35
  shape tests that shipped instead.
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`
  — adjacent instinct: defer the shared infrastructure until
  extraction earns itself. Here we defer a test harness; there
  we defer a shared helpers package. Both reject the "do it now,
  even if it's expensive, because DRY / test-first" reflex in
  favor of staged delivery.
