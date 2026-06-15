---
title: "Skill eval datasets can be rated before they are evaluable"
date: 2026-06-15
category: docs/solutions/architecture-patterns/
module: Evaluations / Skill Catalog
problem_type: architecture_pattern
component: tooling
severity: high
applies_when:
  - "A feature separates skill-eval case collection from isolated eval execution"
  - "A skill can receive operator-flagged eval cases before its catalog activation wiring is complete"
  - "A UI action launches eval-baseline materialization for a catalog skill"
  - "An eval score surface needs to distinguish no cases, no score, and cannot run"
related_components:
  - graphql-api
  - skill-catalog
  - eval-baseline-agent
  - settings-ui
tags:
  - skill-evals
  - eval-baseline
  - wiring-md
  - skill-catalog
  - rated-vs-evaluable
  - operator-feedback
  - thnk-16
---

# Skill eval datasets can be rated before they are evaluable

## Context

THNK-16 added skill-level evals on top of the Evaluations Trust Core: bundled
or operator-flagged cases sync into a per-skill dataset, and an isolated
eval-baseline agent runs those cases with exactly one skill installed. The
initial implementation correctly allowed cases to be attributed to a skill, but
live validation found a second state axis: a skill can have cases and still be
unable to materialize into the eval-baseline agent.

The concrete failure was `research-dashboard`. An operator could flag a thread
turn into `skill-research-dashboard`, so the skill detail showed one case and
`Not scored yet`. Clicking `Run evals now` then failed in the backend because
the catalog skill had no `WIRING.md`, which is required by the same
materialization path used for normal skill installs. The durable learning is
that "rated" means "has cases"; it does not mean "can be run."

## Guidance

Model skill eval state with two independent concepts:

- `rated`: the per-skill dataset has at least one enabled case.
- `evaluable`: the catalog skill can be materialized into the isolated
  eval-baseline workspace.

The API should expose both states on the detail surface. THNK-16 uses
`SkillEvalScore.rated`, `totalCases`, `passRate`, and `evaluable` /
`ineligibleReason`. `evaluable` is computed lazily because it reads catalog
files from S3; list views should avoid requesting it unless they need run
eligibility.

Run eligibility must mirror the real materialization requirement exactly. In
the current system, a skill is evaluable only when
`tenants/<tenant>/skill-catalog/<skill-slug>/WIRING.md` exists and contains a
usable wiring choice. Do not invent a softer UI-only rule, and do not relax the
eval-baseline installer just so a seeded dataset can run. The point of isolated
skill evals is to test the same activation path the runtime depends on.

Seeding and running should stay decoupled:

- A not-yet-evaluable skill can still receive bundled or flagged cases.
- The skill detail should show the case count and dataset link.
- `Run evals now` should be disabled while `evaluable === false`.
- The UI should show the backend-provided ineligibility reason and explain that
  the cases will run once the skill becomes evaluable.

This shape preserves forward progress. Operators can capture real failures as
soon as they happen, and skill authors get a precise activation gap instead of a
generic eval-run error.

## Why This Matters

Without the split, the product presents a false promise. A visible case count
and a run button imply that the system can evaluate the skill now, but the
eval-baseline agent cannot install a skill whose catalog folder lacks activation
wiring. The resulting backend error is technically correct and user-hostile.

Keeping `rated` separate from `evaluable` also protects future feature work.
Skill eval datasets are durable learning assets; they may be created before the
skill is fully runnable, especially when cases come from operator-flagged real
failures. Eval execution is an activation check. Mixing the two would either
block useful case collection or repeatedly launch runs that can only fail during
materialization.

## When to Apply

- Adding a score, run, or gate surface for skill evals.
- Extending skill catalog install/update paths that affect `WIRING.md` or
  materialization.
- Allowing operator-flagged threads to seed a skill-specific dataset.
- Debugging a skill that shows cases but never starts an isolated eval run.
- Designing future dependency-aware or in-context skill evals where a dataset
  may exist before the isolated-run contract is satisfiable.

## Examples

Good detail-state contract:

```graphql
type SkillEvalScore {
  skillSlug: String!
  datasetSlug: String!
  rated: Boolean!
  passRate: Float
  totalCases: Int!
  evaluable: Boolean!
  ineligibleReason: String
}
```

Good run-button gate:

```tsx
<Button
  type="button"
  disabled={starting || !score?.rated || score?.evaluable === false}
  onClick={() => void runNow()}
>
  {starting ? <Spinner className="size-3.5" /> : "Run evals now"}
</Button>
```

Good eligibility helper:

```ts
export async function checkSkillEvalEligibility(
  tenantId: string,
  skillSlug: string,
): Promise<{ evaluable: boolean; reason: string | null }> {
  const wiringMd = await readCatalogFile(tenantId, skillSlug, "WIRING.md");

  if (wiringMd == null) {
    return {
      evaluable: false,
      reason:
        "This skill has no WIRING.md, so it can't be materialized for an isolated eval.",
    };
  }

  return firstWiringChoiceId(wiringMd)
    ? { evaluable: true, reason: null }
    : {
        evaluable: false,
        reason:
          "This skill's WIRING.md has no wiring suggestions, so it can't be materialized for an isolated eval.",
      };
}
```

Poor outcome:

```text
Skill detail:
- totalCases: 1
- rated: true
- Run evals now: enabled

Backend:
- startEvalRun fails with EvalBaselineMaterializationError because WIRING.md is missing
- no visible operator feedback if the app shell forgot to mount toast rendering
```

## Related

- [THNK-16](https://linear.app/thinkworkai/issue/THNK-16/skill-tests-and-evals)
- [PR #2458: skill tests and evals](https://github.com/thinkwork-ai/thinkwork/pull/2458)
- [PR #2463: gate non-evaluable skill runs and mount app-wide Toaster](https://github.com/thinkwork-ai/thinkwork/pull/2463)
- [Skill tests and evals plan](../../plans/2026-06-13-003-feat-skill-tests-and-evals-plan.md)
- [Skill eval UI validation runbook](../../plans/2026-06-13-005-skill-evals-ui-validation-runbook.md)
- [Load agent skills from the copied workspace](./workspace-skills-load-from-copied-agent-workspace-2026-04-28.md)
- [Branch deploys to the continuous-CD dev stage are ephemeral](../workflow-issues/branch-deploy-to-continuous-cd-dev-stage-is-ephemeral.md)
