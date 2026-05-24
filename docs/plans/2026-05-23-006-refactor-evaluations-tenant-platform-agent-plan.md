---
title: "refactor: Evaluations run against tenant platform agent"
type: refactor
status: completed
date: 2026-05-23
origin: docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md
---

# refactor: Evaluations run against tenant platform agent

## Summary

Retire the dedicated `type='eval', source='system'` "Eval Agent" provisioning path and rewire every eval invocation surface (GraphQL `startEvalRun`, `eval-runner` Lambda, `eval-worker` Lambda, `scheduled-jobs` cron trigger) to resolve the run target through `resolveTenantPlatformAgent(tenantId)` — the canonical tenant platform agent introduced by the one-platform-agent refactor. Drop `agentId` from the GraphQL eval inputs and from `eval_test_cases` since there is now only one possible target per tenant. The eval scoring stack (AgentCore evaluators, judge model, assertion engine, AgentCore payload shape) is unchanged; only the agent-resolution seam moves.

This plan is the eval-semantics-evolution follow-up the one-platform-agent brainstorm explicitly deferred (`docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md` Scope Boundaries: "Evaluations referencing legacy `agent_id` semantics will need a mechanical backfill but the v1 cut here just makes those evals reference the per-tenant platform agent row — eval semantics evolution is its own follow-up").

---

## Problem Frame

Today every eval run targets a dedicated per-tenant agent row that exists for one reason: to give the runner something to invoke. `ensureEvalAgentForTarget` in `packages/api/src/lib/evals/eval-agent-provisioning.ts` finds (or creates) an agent with `type='eval', source='system'`, gives it a generated slug (`eval-agent-<tenant-slug>-<rand>`), provisions an `email_channel` capability (vanity address `<slug>@agents.thinkwork.ai`), bootstraps a workspace, regenerates a workspace map, and hands its `id` back to the caller. The `startEvalRun` resolver, the `eval-runner` Lambda, the `eval-worker` Lambda's per-case fallback, and the `scheduled-jobs` eval-trigger handler all flow through this resolver, optionally accepting an `agentId` override on input.

Three forces collide on this design:

1. **One-platform-agent commitment.** The 2026-05-22 brainstorm and the in-flight `2026-05-22-005` refactor collapse `agents` to one row per tenant (`is_platform_default=true`). The dedicated eval agent is one of the N rows that 005's U2 migration archives and FK-repoints to the canonical row. After 005, the eval provisioning code keeps creating *new* `type='eval'` rows on every fresh tenant whose first eval run happens after the cutover — directly contradicting the "one agent per tenant" invariant.
2. **Vanity email retirement.** R26 of the brainstorm explicitly retires per-agent vanity email (`<agent.slug>@agents.thinkwork.ai`) in favor of per-Space addresses. The eval provisioner currently emits exactly this address pattern. Even with the agent row archived, every fresh tenant still gets a vanity email row provisioned for the eval agent.
3. **Per-case `agentId` is meaningless.** `eval_test_cases.agent_id` is documented as "optional per-case override of the run-level Agent." With one platform agent per tenant, there is no second target to override to. The column, the GraphQL field on the test-case CRUD inputs, and the `EvalTestCase.agentId` GraphQL output exist for an option that no longer exists.

The cost of leaving this in place: every new tenant accumulates dead `type='eval'` rows; operators encounter two competing answers to "which agent ran this eval?" (the row referenced by `eval_runs.agent_id` vs. `is_platform_default=true`); and the GraphQL surface keeps an input slot that admin no longer uses (the Run Evaluation dialog at `apps/admin/src/routes/_authed/_tenant/evaluations/index.tsx:476-496` never passes `agentId` — the field is admin-invisible and only serves the legacy resolver fallback).

---

## Requirements

- R1. Every eval invocation path resolves its target via `resolveTenantPlatformAgent(tenantId)` — the canonical tenant platform agent row (`is_platform_default=true`). The dedicated `type='eval', source='system'` agent row is no longer created, looked up, or required.
- R2. `packages/api/src/lib/evals/eval-agent-provisioning.ts` and its consumers (`resolveEvalAgentId`, `ensureEvalAgentForTarget`, `requireEvalAgentTarget`) are deleted. No code path may bootstrap an eval agent, provision an eval vanity email capability, or generate an `eval-agent-*` slug.
- R3. The GraphQL eval surface retires per-target agent selection. `StartEvalRunInput.agentId`, `CreateEvalTestCaseInput.agentId`, `UpdateEvalTestCaseInput.agentId`, `EvalTestCase.agentId`, and the `evalRuns(..., agentId: ID, ...)` query argument are removed. Sequencing: U1 has the resolvers ignore the field (so callers don't break), U2 deletes the field from the canonical GraphQL schema and regenerates codegen. `EvalRun.agentId` remains (always = the platform agent's id post-resolve; useful for cost-event FK and admin display).
- R4. The `eval_test_cases.agent_id` column is dropped along with its FK index. `eval_runs.agent_id` is preserved (FK still useful for cost-event attribution and reconciler logic).
- R5. The scheduled-jobs eval trigger no longer reads `cfg.agentId`. If a stored `scheduled_jobs.trigger_config` payload still carries the field, it is ignored (parsed but unused; no error). The handler logs a one-time deprecation warning when ignored input is observed.
- R6. When a tenant has no `is_platform_default=true` row (tenant not yet migrated by `2026-05-22-005`'s U2), eval invocations fail fast with a typed `PlatformAgentNotFoundError`; the run is recorded with `status='failed'` and a human-readable `error_message`. No code path falls back to creating a new eval agent.
- R7. The eval AgentCore payload shape (`buildEvalAgentCorePayload` in `packages/api/src/lib/evals/agentcore-direct.ts`) is unchanged. The agent's runtime config (`resolveAgentRuntimeConfig`) continues to drive what AgentCore receives; the only difference is that the `agentId` passed in is now always the platform agent's id.
- R8. Per-case `system_prompt` overrides (`eval_test_cases.system_prompt`) are preserved unchanged — they remain a useful per-test knob (red-team prompts, scenario-specific framing) even with a single agent.
- R9. Existing `eval_runs` rows whose `agent_id` previously pointed at a legacy `type='eval'` row continue to display correctly post-cutover. (Achieved transitively: `2026-05-22-005`'s U2 already repoints `eval_runs.agent_id` FKs to the canonical row as part of its 28+ FK sweep.)
- R10. The admin UI's existing "Run Evaluation" dialog continues to work without UI changes (it already omits `agentId`). The `/evaluations` and `/evaluations/studio` routes render with no per-test-case agent picker.

---

## Scope Boundaries

### In scope

- API: `packages/api/src/graphql/resolvers/evaluations/index.ts`, `packages/api/src/handlers/eval-runner.ts`, `packages/api/src/handlers/eval-worker.ts`, `packages/api/src/handlers/scheduled-jobs.ts`.
- GraphQL canonical schema: `packages/database-pg/graphql/types/evaluations.graphql`.
- Drizzle schema: `packages/database-pg/src/schema/evaluations.ts`.
- Generated codegen: admin, mobile, CLI, api consumers of the touched types (`pnpm --filter @thinkwork/<name> codegen`).
- Test files: `eval-runner.test.ts`, `eval-worker.test.ts`, `eval-worker-integration.test.ts`, `scheduled-jobs.fire.test.ts`.
- Operator runbook update in `docs/src/content/docs/operator/`.

### Out of scope

- Any change to AgentCore evaluator IDs, the LLM-judge prompt, deterministic assertion engine, or `buildEvalAgentCorePayload`'s field set. R7 explicitly preserves these.
- Per-case `system_prompt` override behavior (kept per user direction).
- The eval-worker's `invokeComputer` / `resolveEvalComputerTarget` paths. The Computer concept is being removed in a separate follow-up (see [Computer concept removed](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_computer_concept_removed.md) in memory); existing runs with `run.computer_id` set continue to flow through that path. New `startEvalRun` calls with `computerId` continue to be rejected as today.
- The `2026-05-22-005` refactor itself (single-platform-agent migration, schema, override columns, admin `/agents` retirement). This plan strictly assumes 005's U1 + U2 land first.
- Removal of the `agents.type = 'eval'` enum value. The column remains on the table; existing archived rows still carry the value. Cleanup of the enum value is a separate cosmetic follow-up.
- Mobile (`apps/mobile`) changes. Mobile does not surface evals.

### Deferred to Follow-Up Work

- Removal of `agents.type='eval'` enum value once no archived rows reference it.
- A migration to delete the archived `type='eval', source='system'` rows entirely (rather than just leaving them archived) once we are confident the FK repoints from 005 are stable.
- An admin UI affordance to choose which Space's runtime config evals execute under (currently uses the platform agent's bare runtime — pre-Space overlay). This is a product question, not a follow-on cleanup.

---

## Context & Research

### Existing files (read-only context)

- `packages/api/src/lib/evals/eval-agent-provisioning.ts` — current resolver. Functions to delete: `resolveEvalAgentId`, `ensureEvalAgentForTarget`, `requireEvalAgentTarget`. Lines 1-127.
- `packages/api/src/lib/agents/tenant-platform-agent.ts` — existing platform-agent resolver. `resolveTenantPlatformAgent(tenantId, db?)` returns the canonical row, throws `PlatformAgentNotFoundError` or `MultiplePlatformAgentsError`. Already shipped. Lines 1-37.
- `packages/api/src/graphql/resolvers/evaluations/index.ts:648` — `startEvalRun`'s call to `resolveEvalAgentId(args.tenantId, args.input.agentId)`. Replace with platform-agent resolution.
- `packages/api/src/handlers/eval-runner.ts:193-203` — dispatcher's "no `computer_id` and no `agent_id`" branch that calls `ensureEvalAgentForTarget`. Replace.
- `packages/api/src/handlers/eval-worker.ts:692-701` — per-case fallback when `tc.agent_id` and `run.agent_id` are both null. After R3+R4, `tc.agent_id` disappears entirely; `run.agent_id` is always set by `startEvalRun` / scheduled-jobs / eval-runner before the worker sees the row. This fallback becomes unreachable code that we delete.
- `packages/api/src/handlers/scheduled-jobs.ts:740-760` — eval-trigger handler. Replace `resolveEvalAgentId(tenantId, cfg.agentId)` + `ensureEvalAgentForTarget` with `resolveTenantPlatformAgent(tenantId).id`; ignore `cfg.agentId` with a one-time deprecation log.
- `packages/database-pg/graphql/types/evaluations.graphql` — canonical eval schema. `EvalTestCase.agentId`, `EvalRun.agentId` (keep), `StartEvalRunInput.agentId`, `CreateEvalTestCaseInput.agentId`, `UpdateEvalTestCaseInput.agentId`, `evalRuns(..., agentId, ...)` query arg.
- `packages/database-pg/src/schema/evaluations.ts:50, 208-210` — `eval_test_cases.agent_id` column + its relation. Drop both.
- `apps/admin/src/routes/_authed/_tenant/evaluations/index.tsx:476-496` — confirmed no admin UI today passes `agentId` to `startEvalRun`. No UI change required.
- `apps/admin/src/routes/_authed/_tenant/evaluations/studio/*.tsx` — confirmed no admin UI today exposes per-case `agentId` editing. No UI change required beyond codegen-driven type refresh.

### Dependencies on in-flight work

- **`2026-05-22-005-refactor-single-platform-agent-and-space-runtime-overrides-plan.md` U1 + U2 must land first.** U1 adds `is_platform_default` (already in main schema); U2 marks one row per tenant as `is_platform_default=true` and FK-repoints all consumers. This plan's U1 throws on tenants where 005's U2 has not yet been run; running this plan without 005's data migration would break every existing tenant's evals at the first attempted run. Sequencing is a hard prerequisite, not soft.
- `2026-05-22-005` U3 introduces `applyRuntimeOverrides` and extends `resolveAgentRuntimeConfig(tenantId, agentId, spaceId)`. Evals do not pass a `spaceId` today, so evals will continue to use the platform agent's baseline config (no Space overlay applied). This is intentional — evals are tenant-scoped, not Space-scoped — and is preserved by this plan.

### Institutional learnings to honor

- [Hand-rolled migrations need dev psql apply](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_handrolled_migrations_apply_to_dev.md) — the column-drop migration (U3 in this plan) is a generated Drizzle migration, not hand-rolled, so `db:push` covers it. No separate `psql -f` step required.
- [Migration Precheck CI gate](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_migration_precheck_ci_gate.md) — the column-drop migration falls under the precheck gate; ensure CI passes on the PR.
- [GraphQL Lambda deploys via PR](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_graphql_deploy_via_pr.md) — `graphql-http` Lambda picks up the resolver changes via the merge pipeline; do not `aws lambda update-function-code` directly.
- [Don't deeplink to billing](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_dont_deeplink_to_billing.md) — when reporting eval run failures for missing platform agent, surface the mechanics ("run failed — tenant has no platform agent; complete the 005 migration") not cost framing.
- [Watch post-merge Deploy run](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_watch_post_merge_deploy_run.md) — after merging each PR, watch `gh run list --branch main` until terraform-apply succeeds.

---

## Key Technical Decisions

- **Direct call to `resolveTenantPlatformAgent` at each call site, no eval-specific wrapper.** Considered keeping a thin `resolveEvalAgentId(tenantId)` shim for "one logical hop's worth of indirection." Rejected: the shim adds no value (no extra validation, no caching, no eval-specific behavior) and obscures the fact that evals are now just-another-platform-agent caller. Following [Filesystem IS the agent](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_filesystem_is_the_agent.md) and the brainstorm's R34 ("Legacy concepts that no longer have a place are removed, not hidden"), we delete `eval-agent-provisioning.ts` entirely.
- **`scheduled_jobs.trigger_config.agentId` ignored with a warning, not rejected.** Existing scheduled-job rows in dev may carry the field. Rejecting them at fire time would put a fix-the-row burden on operators for a field whose value never affected anything meaningful (it was the eval agent's id, which 005's U2 already archived). Ignore + log is the lowest-friction path; the cron continues to fire.
- **Drop `eval_test_cases.agent_id` rather than NULLing it in place.** Considered nullable-and-ignored. Rejected for the same reason as the helper: dead columns accumulate semantic weight ("what if I set this?"). Per-case agent override is meaningless under one-platform-agent; the column is dead and goes. (Confirmed in scoping synthesis.)
- **`EvalRun.agentId` stays.** It always equals the platform agent's id post-resolve, but downstream consumers (cost events, reconciler, admin display) read it as a normal FK. Dropping it would force them to re-derive the platform agent on every render. Keep.
- **Hard-fail on tenants without a platform agent.** No retry, no auto-provision, no synthesized fallback. The error is loud and points operators to the 005 migration. This matches the brainstorm's commitment ("there is exactly one platform agent per tenant") — if the invariant isn't satisfied, eval invocation is an unsafe operation.
- **Delete `eval-agent-provisioning.ts` and its types in the same PR that switches call sites.** Considered the inert-first seam swap pattern (rewire callers, leave the helper as orphan, delete in a follow-up). Rejected for this surface: the rewire is small (4 call sites, all in `packages/api`), the helper has zero external consumers, and there is no rollback story where we'd want to re-introduce a dedicated eval agent. Ship in one PR.

---

## Open Questions

- None blocking. The only operational unknown — "what if 005's U2 hasn't run yet on a given tenant?" — is resolved by R6 (typed error, run recorded as failed).

---

## High-Level Technical Design

```text
Before (current):
  startEvalRun(input)             scheduled-jobs eval trigger
        │                                  │
        ▼                                  ▼
  resolveEvalAgentId(t, input.agentId)  resolveEvalAgentId(t, cfg.agentId)
        │                                  │
        ▼ (no agentId provided)            ▼
  ensureEvalAgentForTarget(t)  ──→  SELECT agents WHERE type='eval' AND source='system'
                               ──→  if none: INSERT new agent row (slug, email_channel, workspace bootstrap)
                               ──→  return agent.id


After:
  startEvalRun(input)             scheduled-jobs eval trigger
        │                                  │
        ▼                                  ▼
       resolveTenantPlatformAgent(tenantId)    ◀──── existing helper
        │
        ▼
   SELECT agents WHERE is_platform_default = true LIMIT 2
        │
        ▼
   row.id  (or throw PlatformAgentNotFoundError / MultiplePlatformAgentsError)
```

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

---

## Implementation Units

### U1. Switch eval call sites to `resolveTenantPlatformAgent`; delete `eval-agent-provisioning.ts`

**Goal:** Replace every consumer of `resolveEvalAgentId` / `ensureEvalAgentForTarget` with `resolveTenantPlatformAgent(tenantId)`. Delete the eval-agent provisioning module and its imports. Update tests.

**Requirements:** R1, R2, R5, R6, R7, R9.

**Dependencies:** `2026-05-22-005` U1 + U2 must be live on the target stage. No intra-plan dependencies.

**Files:**
- Delete: `packages/api/src/lib/evals/eval-agent-provisioning.ts`
- Modify: `packages/api/src/graphql/resolvers/evaluations/index.ts` — drop `ensureEvalAgentForTarget` / `resolveEvalAgentId` imports; rewrite `resolveRunTarget` (or inline it into `startEvalRun`) to call `resolveTenantPlatformAgent`.
- Modify: `packages/api/src/handlers/eval-runner.ts` — replace the `!run.computer_id && !run.agent_id` branch's `ensureEvalAgentForTarget` call with `resolveTenantPlatformAgent`.
- Modify: `packages/api/src/handlers/eval-worker.ts` — delete the per-case fallback at lines 692-701 (becomes unreachable once `tc.agent_id` is dropped in U3; safe to delete in U1 because the runner already sets `run.agent_id` before fan-out).
- Modify: `packages/api/src/handlers/scheduled-jobs.ts` — replace `resolveEvalAgentId(tenantId, cfg.agentId)` + `ensureEvalAgentForTarget` with `resolveTenantPlatformAgent(tenantId)`; add a one-time `console.warn` when `cfg.agentId` is present.
- Modify: `packages/api/src/handlers/scheduled-jobs.fire.test.ts` — drop `resolveEvalAgentId` / `ensureEvalAgentForTarget` mocks; add `resolveTenantPlatformAgent` mock; update assertions at lines 209-324.
- Modify: `packages/api/src/handlers/eval-runner.test.ts` — drop any mocks of `ensureEvalAgentForTarget`; assert `resolveTenantPlatformAgent` is called for runs with neither `agent_id` nor `computer_id`.
- Modify: `packages/api/src/handlers/eval-worker.test.ts` and `packages/api/src/handlers/eval-worker-integration.test.ts` — drop the per-case-fallback test paths; ensure remaining tests pass.

**Approach:**
- The simplest possible inline: `const agentId = (await resolveTenantPlatformAgent(tenantId)).id`. No new wrapper module.
- `startEvalRun`'s `resolveRunTarget` helper collapses to a single `resolveTenantPlatformAgent` call. The `args.input.agentId` field on `StartEvalRunInput` is still present at the schema level (dropped in U2) — for U1, the resolver simply ignores it. Add a one-line code comment that U2 removes the input field.
- `eval-runner.ts` already sets `run.agent_id` on the `evalRuns` row via `update().set({ agent_id })` (lines 197-202). Preserve that update — just compute the value from `resolveTenantPlatformAgent` instead.
- The eval-worker's per-case-fallback `ensureEvalAgentForTarget` call at lines 692-701 is defensive coverage for "what if both `tc.agent_id` and `run.agent_id` are null?" The dispatcher (`eval-runner.ts`) guarantees `run.agent_id` is set before fan-out, so this is unreachable in practice today and definitively unreachable after U3 drops `tc.agent_id`. Delete the branch in U1; the failure mode "run.agent_id is somehow null at worker time" becomes a hard error ("Eval run has no AgentCore agent target") with a clear message — the right behavior.
- `scheduled-jobs.ts` eval handler: log `console.warn` when `cfg.agentId` is observed, but proceed using the platform agent. Pattern: `if (cfg.agentId) console.warn('[scheduled-jobs] eval cfg.agentId is deprecated and ignored; using tenant platform agent', { tenantId, schedJobId: trig.id });`.
- Tests use existing platform-agent mock pattern from `packages/api/src/lib/agents/tenant-platform-agent.test.ts`. Mock `resolveTenantPlatformAgent` to return `{ id: 'platform-agent-1', ... }` in scheduled-jobs and eval-runner tests.

**Execution note:** Add a characterization integration test for the scheduled-jobs eval-trigger path before swapping the resolver — the path was the source of multiple silent-failure incidents historically (see git log on `packages/api/src/handlers/scheduled-jobs.ts`). The characterization test must assert: given a `scheduled_jobs` row of kind `eval_run` with `trigger_config = {}`, when the cron fires for tenant T, an `eval_runs` row is created with `agent_id` = T's platform agent id and `status='pending'`, and the `eval-runner` Lambda is invoked with `Event` invocation type.

**Patterns to follow:**
- `packages/api/src/lib/agents/tenant-platform-agent.ts` — existing helper, error shapes already defined.
- `packages/api/src/lib/email/cold-contact-trigger.ts` (post-005-U3) — pattern for resolving the platform agent at the seam between an external trigger and the eval/chat path.
- `Completion callback env snapshot` learning ([feedback_completion_callback_snapshot_pattern.md](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_completion_callback_snapshot_pattern.md)) — snapshot the resolved agent id at the entry of the eval coroutine; never re-resolve inside the worker mid-case.

**Test scenarios:**
- Happy path: `startEvalRun({ tenantId: 'T', input: {} })` → `evalRuns.agent_id` is set to T's `is_platform_default=true` row id; eval-runner Lambda is invoked with the new run id.
- Happy path: `startEvalRun({ tenantId: 'T', input: { agentId: 'some-other-id' } })` → `input.agentId` is ignored; resolver still uses platform agent. (U1 ignores; U2 removes the field from the schema entirely.)
- Happy path: scheduled-jobs cron fires for an `eval_run` trigger → `eval_runs.agent_id` = platform agent id; `cfg.agentId` (if present) generates a `console.warn` line.
- Happy path: `eval-runner` Lambda receives a run with `agent_id=null, computer_id=null` (e.g., a directly-inserted row from a future caller) → runner resolves platform agent, updates the run row, fans out cases.
- Error path: tenant T has no `is_platform_default=true` row (005 U2 not run for T) → `startEvalRun` throws `PlatformAgentNotFoundError`; resolver catches; eval_runs row written with `status='failed'`, `error_message` includes "platform agent not found" and the tenant id.
- Error path: tenant T has two `is_platform_default=true` rows (defensive — the partial unique index should prevent this) → `MultiplePlatformAgentsError` surfaces identically; run fails with clear error.
- Regression: existing `eval_runs` row whose `agent_id` previously pointed at a now-archived `type='eval'` row (already FK-repointed by 005's U2 to the canonical row) renders unchanged; admin's `evalRuns` query returns it as it did pre-cutover.
- Regression: existing `eval-worker.test.ts` scenarios that don't exercise the per-case `ensureEvalAgentForTarget` fallback continue to pass.
- Cleanup: `rg 'eval-agent-provisioning|ensureEvalAgentForTarget|resolveEvalAgentId' packages/` returns zero hits in source files (test files referencing the removed mocks are also updated).

**Verification:**
- `pnpm --filter @thinkwork/api test packages/api/src/handlers/scheduled-jobs.fire.test.ts` passes.
- `pnpm --filter @thinkwork/api test packages/api/src/handlers/eval-runner.test.ts` passes.
- `pnpm --filter @thinkwork/api test packages/api/src/handlers/eval-worker.test.ts` passes.
- `pnpm -r --if-present typecheck` clean.
- Manual on dev: `pnpm thinkwork login -s dev`; in admin, run an evaluation (categories = "tool-safety"); verify the `eval_runs` row's `agent_id` matches the dev tenant's `is_platform_default=true` row; verify AgentCore CloudWatch logs show the platform agent invoked, not an eval-agent slug.

---

### U2. Drop `agentId` from eval GraphQL inputs and outputs; regenerate codegen

**Goal:** Remove `StartEvalRunInput.agentId`, `CreateEvalTestCaseInput.agentId`, `UpdateEvalTestCaseInput.agentId`, `EvalTestCase.agentId`, and the `evalRuns(..., agentId: ID, ...)` query argument from the canonical GraphQL schema. Regenerate the AppSync subscription schema and per-consumer codegen.

**Requirements:** R3, R10.

**Dependencies:** U1 (resolver must already ignore `input.agentId` before the schema removes it; this preserves wire-compat for a deploy window).

**Files:**
- Modify: `packages/database-pg/graphql/types/evaluations.graphql` — delete `agentId: ID` field/input lines at 20 (EvalTestCase), 135 (CreateEvalTestCaseInput), 147 (UpdateEvalTestCaseInput), 160 (StartEvalRunInput), and the `agentId: ID` argument on `evalRuns` at line 176. Keep `EvalRun.agentId` at line 42.
- Run: `pnpm schema:build` to regenerate `terraform/schema.graphql` (AppSync subscription-only schema).
- Run: `pnpm --filter @thinkwork/api codegen` — regenerate `packages/api/src/graphql/codegen.ts` (or equivalent).
- Run: `pnpm --filter @thinkwork/admin codegen` — regenerate `apps/admin/src/gql/*`.
- Run: `pnpm --filter @thinkwork/cli codegen` — regenerate any eval-related types in `apps/cli`.
- Run: `pnpm --filter @thinkwork/mobile codegen` — verify no mobile types referenced eval `agentId` (expect no diff).
- Modify (likely no-op, verify): `apps/admin/src/lib/graphql-queries.ts` — if any admin query selects `agentId` on `EvalTestCase` or passes `agentId` to `StartEvalRun`, drop. The Run Evaluation dialog at `apps/admin/src/routes/_authed/_tenant/evaluations/index.tsx:476-496` already omits it.
- Modify (likely no-op, verify): `apps/admin/src/routes/_authed/_tenant/evaluations/studio/*.tsx` — verify nothing references `EvalTestCase.agentId`.
- Modify: `packages/api/src/graphql/resolvers/evaluations/index.ts` — drop the now-unused `agentId` argument handling in `startEvalRun`, `createEvalTestCase`, `updateEvalTestCase`; drop the unused `agentId` filter from the `evalRuns` query.

**Approach:**
- Schema change is mechanical. Codegen propagates the type changes; any code still passing `agentId` becomes a typecheck failure to fix.
- `evalRuns` query no longer filters by `agentId`. The query signature drops the optional argument entirely. Confirm no caller passes it (admin's `EvalRunsQuery` in `apps/admin/src/lib/graphql-queries.ts` likely passes `tenantId` only — verify and update if needed).
- The resolver's `startEvalRun` handler no longer reads `args.input.agentId`; delete the (now-unused) `StartEvalRunInput.agentId` field handling. Same for `createEvalTestCase` and `updateEvalTestCase`.
- AppSync subscription schema in `terraform/schema.graphql` is consumed by the AppSync subscription Lambda; ensure the regeneration runs in CI and the resulting file is committed.

**Execution note:** Run codegen across every workspace consumer in one pass to surface stale references atomically. Per AGENTS.md: "After editing GraphQL types, regenerate codegen in every consumer that has a `codegen` script."

**Patterns to follow:**
- Recent type-removal PRs in this repo (e.g., the deprecation of `setAgentSkills` mutation) — same shape: drop schema field, regenerate codegen, fix typecheck breakages mechanically.

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/api typecheck` passes after schema change + codegen.
- Happy path: `pnpm --filter @thinkwork/admin typecheck` passes; admin builds.
- Happy path: admin's `/evaluations` route renders; "Run Evaluation" dialog submits successfully; no GraphQL validation error.
- Happy path: admin's `/evaluations/studio/new` route allows creating a test case (without an agent picker — it never had one).
- Happy path: admin's `/evaluations/studio/$testCaseId` renders an existing test case (loaded via `evalTestCase` query); the rendered view doesn't reference a per-case agent.
- Regression: existing `eval_test_cases` rows with `agent_id` set (legacy data) still load via the `evalTestCase` query — the resolver simply doesn't select the column anymore now that the GraphQL field is gone. (U3 later drops the column from the database schema entirely.)
- Schema-build verification: `terraform/schema.graphql` after `pnpm schema:build` no longer contains `EvalTestCase.agentId` or `StartEvalRunInput.agentId`.
- Grep verification: `rg 'agentId' packages/database-pg/graphql/types/evaluations.graphql` returns only the surviving `EvalRun.agentId` field.

**Verification:**
- `pnpm -r --if-present typecheck` clean.
- `pnpm -r --if-present build` clean.
- `pnpm schema:build` runs without error; check the diff to `terraform/schema.graphql` matches expectations.
- Manual on dev: deploy, then exercise the admin Run Evaluation dialog; verify a run is created and a result row appears in the admin UI within ~1 minute.

---

### U3. Drop `eval_test_cases.agent_id` column

**Goal:** Remove the `eval_test_cases.agent_id` column (and its FK + index) from the Drizzle schema. Generate the migration and verify it applies cleanly.

**Requirements:** R4.

**Dependencies:** U2 (the GraphQL surface must no longer reference the column before the column is dropped; otherwise codegen + resolvers would still try to read it).

**Files:**
- Modify: `packages/database-pg/src/schema/evaluations.ts` — delete the `agent_id` column declaration (line 50) and the relation block referencing it (lines 207-210).
- Generated: `packages/database-pg/drizzle/NNNN_<name>.sql` — Drizzle-generated migration (via `pnpm --filter @thinkwork/database-pg db:generate`).
- Modify (likely): `packages/database-pg/drizzle/meta/_journal.json` — Drizzle updates the journal automatically.
- Verify: `packages/api/src/lib/evals/agentcore-direct.ts` and `packages/api/src/handlers/eval-worker.ts` — neither should read `tc.agent_id` after U2 (the field is no longer selected). Drop any remaining references.

**Approach:**
- Generate with `pnpm --filter @thinkwork/database-pg db:generate`. Inspect the generated SQL: it should `ALTER TABLE eval_test_cases DROP COLUMN agent_id;` and drop any associated index (none currently appears to exist beyond the FK constraint).
- The migration is reversible in principle (re-add the column nullable, no data to recover) but reversibility is not a requirement — the data is meaningless under one-platform-agent.
- After migration generation, run `pnpm --filter @thinkwork/database-pg build` and `pnpm -r --if-present typecheck` to confirm no remaining references.
- Apply on dev: `pnpm db:push -- --stage dev`. Per `feedback_handrolled_migrations_apply_to_dev.md`, this is a generated migration (not hand-rolled), so `db:push` covers it — no separate `psql -f` required.

**Execution note:** This is a structural schema change to a v1 table; if any consumer outside this repo still expects `agent_id`, the deploy will hard-fail. The pre-launch posture ([feedback_merge_prs_as_ci_passes.md](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_merge_prs_as_ci_passes.md)) accepts this — dev is the validation loop.

**Patterns to follow:**
- Recent column-drop PRs in `packages/database-pg/drizzle/` (e.g., the per-agent vanity-email column cleanups from 005's U6).

**Test scenarios:**
- Happy path: `pnpm --filter @thinkwork/database-pg db:generate` produces a single migration file dropping `eval_test_cases.agent_id`.
- Happy path: `pnpm --filter @thinkwork/database-pg build` passes.
- Happy path: `pnpm -r --if-present typecheck` clean.
- Happy path on dev: `pnpm db:push -- --stage dev` applies cleanly; `psql -c "\d eval_test_cases" "$DATABASE_URL"` confirms `agent_id` column is gone.
- Integration: post-migration, the existing `eval-worker-integration.test.ts` passes — confirms a full run cycle (create test case → start run → worker invokes AgentCore → result row written) works without the column.
- Migration Precheck: CI's `.github/workflows/migration-precheck.yml` ([project_migration_precheck_ci_gate.md](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_migration_precheck_ci_gate.md)) passes against dev — confirms no markers go missing.
- Cleanup: `rg 'eval_test_cases\.agent_id|tc\.agent_id|testCase\.agentId' packages/` returns zero hits (excluding the migration file itself, which references the column being dropped).

**Verification:**
- `pnpm --filter @thinkwork/database-pg db:generate` produces a clean diff.
- `pnpm -r --if-present typecheck && pnpm -r --if-present build && pnpm -r --if-present test` all clean.
- `pnpm db:push -- --stage dev` applies cleanly; dev schema inspection confirms column gone.
- Migration Precheck CI gate green on the PR.

---

### U4. Operator runbook + verification sweep

**Goal:** Document the new model in the operator docs; run a final manual verification on dev that the full eval flow works end-to-end against the platform agent.

**Requirements:** R10 (admin continues to work), plus operational visibility.

**Dependencies:** U1, U2, U3 all merged and deployed to dev.

**Files:**
- Modify: `docs/src/content/docs/operator/evaluations.md` (or create if absent under `docs/src/content/docs/operator/`) — short section: "Eval target resolution: evals run against the tenant's platform agent (`is_platform_default=true`). There is no per-eval or per-test-case agent picker. If a tenant has no platform agent, the run fails with `PlatformAgentNotFoundError` — complete the platform-agent migration (see `2026-05-22-005`)."
- Modify: `docs/src/content/docs/compliance/audit-events.md` if present — note that eval-triggered cost events are attributed to the platform agent id, not a dedicated eval agent.
- Modify (if exists): `CHANGELOG.md` or release notes for v1 — one-line entry: "Evaluations now run against the tenant platform agent; the dedicated eval agent is retired."

**Approach:**
- Pure docs unit. No code changes.
- Manual verification flow: see Test scenarios below.

**Patterns to follow:**
- Existing operator docs under `docs/src/content/docs/operator/` — concise, scoped to operational concerns, no implementation detail.

**Test expectation: none — pure documentation unit.** The verification step below is a manual smoke against the dev stack, not an automated test.

**Verification (manual smoke on dev):**
- `pnpm thinkwork login -s dev`
- In admin (`/evaluations`), click "Run Evaluation" with one category selected.
- Within ~60s, the run shows `completed` (or `running` then `completed`) with a passed/failed breakdown.
- `psql "$DATABASE_URL" -c "SELECT agent_id FROM eval_runs ORDER BY created_at DESC LIMIT 1"` → returns the dev tenant's `is_platform_default=true` row id.
- `psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM agents WHERE tenant_id='<dev-tenant>' AND type='eval' AND status != 'archived'"` → returns 0 (no live eval agent row).
- `psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM agents WHERE tenant_id='<dev-tenant>' AND is_platform_default=true"` → returns 1.
- AgentCore CloudWatch logs for the test run show the platform agent id, not an `eval-agent-*` slug.

---

## System-Wide Impact

| Surface | Impact | Notes |
| --- | --- | --- |
| GraphQL HTTP API | Breaking schema change | `agentId` removed from 4 input/output sites; AppSync schema regenerated. Tenant clients that hand-construct queries with `agentId` on eval inputs will fail validation. Admin and CLI use codegen and pick it up automatically. |
| AppSync subscriptions | No behavioral change | `EvalRun.agentId` (the surviving field) continues to propagate via existing `notifyEvalRunUpdate` flow. |
| Aurora schema | Column drop | `eval_test_cases.agent_id` dropped. Existing data ignored (legacy values pointed at type='eval' rows, already archived by 005's U2). |
| `agents` table | No new rows from evals | The provisioner stops creating `type='eval', source='system'` rows. Existing archived rows remain (cleanup deferred). |
| `agent_capabilities` table | No new vanity email rows | The provisioner stops inserting `capability='email_channel'` for eval agents (legacy rows on archived agents are already `enabled=false` per 005's U2). |
| Cost events | Attribution unchanged in shape | `cost_events.agent_id` is now always the platform agent's id for eval-source events. Cost summary queries (filtered by `event_type='eval'`) continue to work unchanged. |
| Admin SPA | No UI change | The Run Evaluation dialog and Studio routes already omit the per-case agent picker. Codegen update is silent. |
| Mobile | No change | Mobile does not surface evals. |
| CLI | No change | `thinkwork-cli` does not surface evals today. |
| Operators | Documentation update | New section in operator docs; behavior change is invisible day-to-day (one less moving part). |

---

## Risks & Dependencies

### Risks

- **R-R1: 005's U2 migration not yet run on a stage.** Without `is_platform_default=true` set, every eval run after this plan ships fails with `PlatformAgentNotFoundError`. **Mitigation:** Treat 005's U2 as a hard prerequisite in the U1 PR description; ensure dev has been migrated before merging this plan's U1. The runbook (U4) makes this gate explicit for prod when it lands.
- **R-R2: Existing `eval_test_cases.agent_id` values on legacy rows.** Today these point at archived `type='eval'` rows. U3 drops the column entirely; the values disappear. **Mitigation:** No mitigation required — the per-case agent picker was never exposed in admin, so no operator workflow relied on these values. Confirm via `SELECT COUNT(*) FROM eval_test_cases WHERE agent_id IS NOT NULL` on dev before merging U3; if non-zero, the diff is purely informational since the column is going.
- **R-R3: Scheduled-jobs trigger_config.agentId carrying stale state.** Existing scheduled-job rows may have `cfg.agentId` set. **Mitigation:** U1 ignores the field with a deprecation warning. No row-level edit required. Eventual cleanup (re-saving the scheduled job from admin) clears it; U4's runbook notes this.
- **R-R4: AppSync schema rebuild causes a momentary subscription gap.** Standard AppSync redeploy behavior. **Mitigation:** Existing pattern; deploy in a normal merge window.
- **R-R5: Cost-event attribution looks like a regression.** Operators inspecting `cost_events` with `event_type='eval'` will see `agent_id` = platform agent rather than the old eval agent. **Mitigation:** Document in U4. The attribution is correct — the platform agent actually executed the eval.
- **R-R6: `agents.type='eval'` enum value lingering.** The enum value is unused for new rows but still appears on archived rows and the column definition. **Mitigation:** Deferred to follow-up (Scope Boundaries). No active concern.

### Dependencies

- **D-1: `2026-05-22-005-refactor-single-platform-agent-and-space-runtime-overrides-plan.md` U1 + U2 deployed to the target stage.** Hard prerequisite per R1, R6.
- **D-2: `resolveTenantPlatformAgent` helper.** Already shipped at `packages/api/src/lib/agents/tenant-platform-agent.ts`. No work to do.
- **D-3: Migration Precheck CI gate.** Already shipped. Runs automatically on PRs that touch `drizzle/*.sql`.
- **D-4: Codegen pipeline.** Already shipped; runs in CI.

---

## Documentation / Operational Notes

- Add a short paragraph to `docs/src/content/docs/operator/evaluations.md` (or create the file) explaining the new resolution rule and the error operators see if the platform agent migration is incomplete on a stage.
- The change is invisible to end-users (admin SPA users): the Run Evaluation dialog and Studio routes were already agent-blind.
- For external API consumers (none known internal): the breaking schema change should be flagged in the v1 release notes once compiled.

---

## Sources & References

- Origin: `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md` (Scope Boundaries — eval semantics deferral).
- In-flight dependency plan: `docs/plans/2026-05-22-005-refactor-single-platform-agent-and-space-runtime-overrides-plan.md` (U1 schema, U2 migration, U3 platform-agent resolver).
- Memory: [project_one_platform_agent_supersession](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_one_platform_agent_supersession.md), [project_evals_scoring_stack](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/project_evals_scoring_stack.md), [feedback_filesystem_is_the_agent](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_filesystem_is_the_agent.md), [feedback_user_opt_in_over_admin_config](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_user_opt_in_over_admin_config.md).
- Existing helper: `packages/api/src/lib/agents/tenant-platform-agent.ts` + `tenant-platform-agent.test.ts`.
- Current eval provisioner being retired: `packages/api/src/lib/evals/eval-agent-provisioning.ts`.
