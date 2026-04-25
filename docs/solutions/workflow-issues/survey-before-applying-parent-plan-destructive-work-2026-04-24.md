---
title: Survey live consumers before applying parent-plan destructive work
date: 2026-04-24
category: workflow-issues
module: thread-detail-cleanup
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Executing a destructive unit (DROP TABLE, DROP COLUMN, file deletion, schema removal) from a multi-PR plan authored in a prior session"
  - "Parent plan lists drop targets that earlier units in the arc were supposed to retire — verify the retirement actually completed across every consumer surface, not just the most obvious one"
  - "Days or weeks have elapsed between plan authoring and the destructive unit reaching execution"
  - "About to write a Drizzle migration whose scope was set by a checklist rather than a fresh grep"
related_components:
  - database
  - documentation
tags:
  - destructive-migration
  - plan-drift
  - pre-execution-survey
  - empirical-verification
  - drizzle
  - thread-detail-cleanup
---

# Survey live consumers before applying parent-plan destructive work

## Context

When a multi-PR cleanup arc reaches a destructive-migration unit (`DROP TABLE`, `DROP COLUMN`, schema retirement), the plan document is a stale snapshot. Plans authored before the current session reflect the codebase as understood at planning time — not the codebase as it exists after intermediate units shipped. Cleanup arcs frequently ship partially: consumers get retired in U2/U3, then U5 drops the table assuming U2/U3 fully landed. When they didn't, the plan's drop list still names load-bearing structures.

This session: `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` listed `thread_comments`, `artifacts`, and `message_artifacts` as U5 drop targets. A fresh consumer survey before writing the migration found that **`artifacts` and `message_artifacts` are still load-bearing** — full CRUD GraphQL resolvers in `packages/api/src/graphql/resolvers/artifacts/`, the canonical `Artifact` GraphQL type at `packages/database-pg/graphql/types/artifacts.graphql`, `Message.artifacts` and `Message.durableArtifact` schema fields, and `ChatBubble.tsx` rendering. Only `thread_comments` was genuinely orphaned. PR #558 narrowed the migration accordingly and deferred the artifacts retirement to a future arc that retires consumers first.

The planning-time survey **had** asked the right question — it's recorded in the plan's "Resolved During Planning" block as: "Is `MessageArtifact` populated by any resolver? No — declared in GraphQL but no resolver fills it. Drop is lower-risk than origin assumed." That answer was wrong, and the wrongness was structural (session history): the survey grep checked the joining-table resolver path (which genuinely has no fill code), but missed the parent `artifacts` table's dedicated `resolvers/artifacts/` subdirectory that has full CRUD. The check was correct for `MessageArtifact` and silently incorrect for `artifacts`. (session history)

## Guidance

Before any destructive plan-driven operation, run a consumer survey at execution time and let the survey — not the plan — define the migration scope:

1. **Enumerate the plan's claimed targets.** Copy the exact table/column/index names from the plan unit into a checklist.

2. **Survey the right granularity.** For each named target, also enumerate the **parent** table/type, **joining** tables/types, and **child** tables/types. The planning-time survey that started this session got bitten by checking only `MessageArtifact` (joining) and missing `artifacts` (parent) — the parent had its own resolver subdirectory that the joining-table grep didn't reach.

3. **Grep each target across every consumer surface** before writing a single line of migration SQL:
   - GraphQL resolvers (whole subdirectory, not just the obvious file): `rg -l '<target>\b' packages/api/src/`
   - Canonical GraphQL schema: `grep -rn 'type <Target>|<targetField>' packages/database-pg/graphql/types/`
   - Drizzle schema: `rg '<target>' packages/database-pg/src/schema/`
   - Client renderers: `rg '<target>' apps/admin/src/ apps/mobile/`
   - Agent skills: `rg '<target>' packages/skill-catalog/ packages/agentcore-strands/`
   - Lambda handlers: `rg '<target>' packages/lambda/`

4. **If any surface still consumes the target, the plan is partially wrong.** Narrow the migration to genuinely orphaned structures and surface the gap to the user before applying anything destructive.

5. **Document the narrowing in the PR body.** State which targets were deferred, which consumers still reference them, and what arc/unit owns the eventual retirement. This preserves institutional knowledge so the next session doesn't have to re-survey.

Concrete commands that surfaced the gap on this session:

```bash
# Before dropping `artifacts`:
rg -l "artifacts\b" packages/api/src/                                         # found 4+ active resolvers
grep -rn "type Artifact|durableArtifact" packages/database-pg/graphql/types/  # canonical schema type still live
rg "durableArtifact" apps/mobile/                                             # ChatBubble.tsx renders it
# → narrow scope to thread_comments + 2 orphan indices; defer artifacts/message_artifacts.
```

## Why This Matters

Skipping the survey and trusting the plan's drop list is a one-way break. If `artifacts` had been dropped per the original U5 scope:

- All `artifact` / `durableArtifact` GraphQL queries return runtime errors against Aurora.
- Mobile `ChatBubble.tsx` fails to render any thread that previously included an artifact bubble.
- The 4+ resolver files in `packages/api/src/graphql/resolvers/artifacts/` start throwing on every invocation.
- Recovery requires restoring from an Aurora snapshot or replaying the migration in reverse — hours of work, plus user-visible downtime once the destructive change reaches a stage where users live.

The survey costs five minutes. The recovery costs hours and a regression that could escape to a deployed stage. Same family of failure as `feedback_verify_wire_format_empirically` (auto memory [claude]) — empirical state of the live system always supersedes a written specification — and `feedback_diff_against_origin_before_patching` (auto memory [claude]) — fetch and diff against `origin/main` before forward-patching, because another session may have already changed the ground truth the plan was written against.

There's a sister failure mode worth noting from the same arc: PR #559 fixed a `type: "TASK"` residual the original U3d sweep missed. Mobile's `useCreateThread` was called with `as any`-spread arguments, which defeated TypeScript's excess-property check and let the dead `type` field pass through codegen sweeps undetected. (session history) Same family: consumer surveys can miss callers when type-system escape hatches let dead fields hide.

## When to Apply

Run the consumer survey before:

- Any `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`, `DROP CONSTRAINT`, or other destructive Drizzle migration.
- Any cleanup or retirement arc whose plan was authored more than a session ago.
- Any plan unit that names structures as "deprecated" or "retired" — verify the deprecation actually completed across resolvers, schema, clients, skills, and Lambdas before destructive work.
- Any multi-PR plan with intermediate units that may have shipped only partially. Dependency gates in the plan are an indicator: if U5 depends on U2/U3, re-confirm U2/U3 actually retired the consumers, not just opened the work.
- Any branch where you didn't personally author the prior units in the arc and can't recall their final scope without re-reading the merged PRs.
- Any planning-time survey that resolved a question with a single grep — re-run that grep at execution time, this time at parent-table / joining-table / child-table granularity, not just the surface the planning grep checked.

## Examples

**Before — trust the parent plan blindly:**

> Plan U5 says drop `thread_comments`, `artifacts`, `message_artifacts`. Generate a migration with three `DROP TABLE` statements. PR. Apply. → GraphQL artifact resolvers 500 on every invocation. Mobile thread view crashes on any historical artifact. Recovery requires Aurora snapshot restore.

**After — survey-first narrowing:**

> Plan U5 says drop `thread_comments`, `artifacts`, `message_artifacts`. Survey:
> - `rg -l 'thread_comments' packages/api/src/ apps/ packages/database-pg/graphql/` → empty. Orphaned.
> - `rg -l 'artifacts\b' packages/api/src/` → 4+ resolver files in `resolvers/artifacts/`. Live.
> - `grep -rn 'type Artifact|durableArtifact' packages/database-pg/graphql/types/` → canonical type still defined. Live.
> - `rg 'durableArtifact' apps/mobile/` → `ChatBubble.tsx` renders it. Live.
>
> Narrow migration to `thread_comments` + 2 orphan indices. Document the deferral of `artifacts` / `message_artifacts` in the PR body, naming the consumers that still depend on them. Apply. → clean, no regression. (PR #558.)

**Real-session reference:** PR #558, U5 of `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`. Migration scope reduced from 3 tables to 1 table + 2 indices after the consumer survey identified 5+ live `artifacts` consumers across `packages/api/src/`, `packages/database-pg/graphql/types/`, and `apps/mobile/components/chat/ChatBubble.tsx`. Applied cleanly to dev. Artifacts retirement deferred to a future arc.

## Related

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — sibling drift failure mode. That doc covers *forward* drift (declared migrations not yet applied). This doc covers *reverse* drift (parent plan declares dropping things that are still load-bearing). Cross-link.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — same methodological spirit ("inspect the live data before touching the knob"), different domain.
- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md` — same shape on the prevention side: a "count live consumers" SQL block applied to skill retirement instead of schema retirement.
- PR #558 — narrowed U5 migration that prompted this learning.
- PR #559 — sister symptom: mobile `type: "TASK"` residual that slipped past the U3d sweep because `as any`-spread defeated excess-property checks.
- `docs/brainstorms/2026-04-24-pre-launch-db-schema-cleanup-requirements.md` (plan 003) — explicitly defers `message_artifacts` to plan 002. When plan 002 retires the artifacts surface in a future arc, plan 003 will need updating.
