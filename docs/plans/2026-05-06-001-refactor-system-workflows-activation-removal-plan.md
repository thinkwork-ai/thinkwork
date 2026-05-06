---
title: "refactor: System Workflows + Activation removal (revert Phase 2)"
type: refactor
status: active
date: 2026-05-06
origin: docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md
---

# refactor: System Workflows + Activation removal (revert Phase 2)

## Summary

Delete the System Workflows orchestration substrate and the Activation feature in their entirety: 11 Postgres tables (7 `system_workflow_*` + 4 `activation_*`), 5 Lambda handlers, three Step Functions state machines + their EventBridge wiring + IAM, the `agentcore-activation` runtime container, the admin UI routes (3 files) and mobile activation screens (4 files), the GraphQL types and resolvers (2 type files + 2 resolver directories) plus the AppSync subscription bridge. Sequenced as 6 implementation units across roughly 5 PRs, each independently mergeable to `main` while the build stays green. Coordinates strictly with Phase 1 (Wiki + Evals revert) which must merge first.

---

## Problem Frame

System Workflows shipped late April 2026 wrapping three platform processes (Wiki Build, Evaluation Runs, Tenant/Agent Activation) in a Step Functions–backed multi-step abstraction. Phase 1 of this revert (`R1`, `R2` — separately scoped, ships first) returns Wiki Build and Evaluation Runs to direct Lambda invocation. Phase 2 — this plan — removes the now-unused orchestration infrastructure and the Activation feature it was the only remaining caller for.

(See origin: `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md` for the Problem Frame and product rationale.)

---

## Requirements

- R3. Activation feature is removed: resolver, runtime invocation, all four `activation_*` tables (`activation_sessions`, `activation_session_turns`, `activation_apply_outbox`, `activation_automation_candidates`). The in-flight `codex/activation-deploy-smoke-plan` branch is closed without merging. *(see origin: R3)*
- R4. All multi-step orchestration infrastructure removed: Step Functions state machines, adapter Lambdas, the seven `system_workflow_*` tables, multi-step admin UI routes. The separate `workflow_configs` table (per-tenant Routines orchestration config) is **not** in scope. *(see origin: R4)*

**Origin actors:** A1 (Tenant admin, no Compliance UI yet — Phase 3), A3 (Platform services).
**Origin flows:** F2 (Remove multi-step orchestration entirely) — covered end-to-end by this plan.
**Origin acceptance examples:** None directly assigned to this plan — AE1 covers R1/R2 (Phase 1, separate plan). This plan's verification is structural (resources gone, SFN executions drained, schema dropped, codegen clean); see per-unit Verification blocks. Phase 2 indirectly upholds AE1 by removing the SW infrastructure that AE1 verifies-against.

---

## Scope Boundaries

- `workflow_configs` table and the `orchestration/` GraphQL resolvers — separate from `system_workflow_*`, serves Routines and other product-owned orchestration. Survives this revert.
- Phase 3 Compliance feature design and implementation — separate `/ce-plan` after the 30 Resolve-Before-Planning items in the origin doc are resolved.
- Phase 1 (Wiki + Evals revert from System Workflows back to direct Lambda) — merges before this plan starts. Specifically the 20 SW recorder call sites in `wiki-compile.ts` and `eval-runner.ts` must be stripped in Phase 1.
- Onboarding-flow replacement for Activation — see Key Technical Decisions; Activation removal does not introduce a replacement in Phases 1-3.

### Deferred to Follow-Up Work

- Compose post-removal `docs/solutions/` learning capturing the multi-PR retirement runbook shape (analog of `retire-thinkwork-admin-skill-2026-04-24.md`) — recurring shape worth codifying. Run `/ce-compound` after Phase 2 ships.

---

## Context & Research

### Relevant Code and Patterns

- **Drizzle schema for SW**: `packages/database-pg/src/schema/system-workflows.ts` (323 lines, 7 tables with declared FK chain).
- **Drizzle schema for activation**: `packages/database-pg/src/schema/activation.ts` (301 lines, 4 tables with cascade FKs into `activation_sessions`).
- **SW migrations**: `packages/database-pg/drizzle/0059_system_workflows.sql` + `0060_system_workflow_run_domain_ref_dedup.sql`. Both hand-rolled (not in `meta/_journal.json`). Rollbacks already exist: `0059_system_workflows_rollback.sql` + `0060_system_workflow_run_domain_ref_dedup_rollback.sql` — re-usable as-is.
- **Activation migrations**: `0038_activation_sessions.sql`, `0039_activation_apply_outbox.sql`, `0041_activation_automation_candidates.sql`. Hand-rolled. **No rollback files exist** — this plan authors them.
- **SW launcher and helpers**: `packages/api/src/lib/system-workflows/` (11 files: `start.ts`, `registry.ts`, `asl.ts`, `types.ts`, `validation.ts`, `events.ts`, `evidence.ts`, `wiki-build.ts`, `evaluation-runs.ts`, `activation.ts`, `export-asl.ts`, plus 4 test files).
- **Lambda handlers to delete**: `packages/api/src/handlers/{activation-workflow-adapter,activation-apply-worker,activation,system-workflow-step-callback,system-workflow-execution-callback}.ts`. Each has matching entries in `scripts/build-lambdas.sh` and `terraform/modules/app/lambda-api/handlers.tf`.
- **Step Functions Terraform module**: `terraform/modules/app/system-workflows-stepfunctions/` (entire 263-line module + `asl/*.json` templates). Instantiated at `terraform/modules/thinkwork/main.tf:312-327`. IAM policy `aws_iam_role_policy.lambda_system_workflows_stepfunctions` at `terraform/modules/app/lambda-api/main.tf:636-658`.
- **GraphQL surfaces**: `packages/database-pg/graphql/types/system-workflows.graphql` (153 lines) + `activation.graphql` (165 lines). Resolvers at `packages/api/src/graphql/resolvers/{system-workflows,activation}/`. Registered at `resolvers/index.ts:36, 40-41, 66, 69, 93, 96`.
- **Admin UI routes**: `apps/admin/src/routes/_authed/_tenant/automations/system-workflows/{index.tsx, $workflowId.tsx, $workflowId.runs.$runId.tsx}` + Sidebar link in `apps/admin/src/components/Sidebar.tsx` + queries in `apps/admin/src/lib/graphql-queries.ts`.
- **Mobile activation screens**: `apps/mobile/app/activation/{index.tsx, interview/[layerId].tsx, review/index.tsx, refresh.tsx}` + activation block in `apps/mobile/lib/graphql-queries.ts` + tab navigation entry.
- **AgentCore activation runtime**: `packages/agentcore-activation/` — parallel runtime container to `agentcore-strands`, with its own Terraform module instantiation. Path confirmed at implementation time per learning `activation-runtime-narrow-tool-surface-2026-04-26.md`.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — Manual-track migration template (`-- creates: …` markers, `to_regclass` pre-flight, FK drop ordering). Load-bearing: `deploy.yml` runs `db:migrate-manual` as a gate after `terraform-apply` and missing-object failures block deploys.
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — Run consumer survey at execution time, not planning time. Granularity: parent + joining + child grep across all packages and apps. The previous arc's U5 narrowed from 3 tables to 1 + 2 indices after a fresh consumer grep.
- `docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md` — Inverted for deletions: don't delete a table while a consumer still writes to it. Phase 1 = "consumers stop writing"; Phase 2 (this plan) = "schema drop." Verify with grep before each table drop.
- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md` — Runbook shape for retirements: prereqs, count-live-consumers SQL, idempotent UPDATE before DROP, "what stays" list to prevent over-deletion, 3-step rollback ladder.
- `docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md` — Documents the Activation runtime's 5-tool allowlist and privacy invariant. Confirms it's a separate runtime container needing symmetric Terraform + AgentCore cleanup, not just Lambda + table drops.
- `docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md` — Confirms `cancelEvalRun` doesn't `StopExecution` on the SFN. In-flight executions must be drained before Phase 2 begins schema work.
- `docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md` — Multi-source-of-truth reconciliation for SFN-backed features: every layer (DB rows, generated ASL, SFN versions/aliases, EventBridge rules, IAM roles, UI) needs symmetric cleanup. Post-merge `grep -r system_workflow packages/ apps/` is the closure check.

### External References

External research skipped — internal cleanup with strong local patterns and prior retirement runbooks.

---

## Key Technical Decisions

- **Multi-PR delivery, not a single mega-PR.** Six PRs across the six implementation units, each independently mergeable. Aligns with `feedback_pr_target_main` (PRs target main, never stack) and `feedback_merge_prs_as_ci_passes`. Single PR would touch ~50 files across 5 layers and review/revert risk is asymmetric.
- **Phase 1 must merge first.** Phase 2 unit U3 (library + handler removal) deletes `lib/system-workflows/{wiki-build,evaluation-runs}.ts` — Phase 1 must already have stripped the 20 importers in `wiki-compile.ts` + `eval-runner.ts`, otherwise Phase 2 fails typecheck immediately. Verify Phase 1 merged + deployed to `dev` before starting U3.
- **Replacement onboarding flow: deferred to Phase 6.** Activation removal does not introduce a replacement onboarding flow in Phases 1-3. Enterprise customer onboarding falls back to platform's pre-Activation manual provisioning path (admin creates tenant + invites users + bootstraps agents directly). Phase 6 (SomaOS-style governed-action contract) is the eventual home for onboarding-as-a-governed-action. **Surface this decision in the Phase 2 PR description for stakeholder visibility.**
- **Drain-then-drop sequencing on SFN executions.** `cancelEvalRun` only flips a DB row — it doesn't call `StopExecution` on Step Functions. Before Terraform destroys the state machines (U5), explicitly list and `StopExecution` on any in-flight executions to prevent post-Terraform errors and orphaned step_events writes. Use `aws stepfunctions list-executions --state-machine-arn ... --status-filter RUNNING` per state machine.
- **Re-use existing SW rollback migrations; author new activation rollbacks.** `0059_system_workflows_rollback.sql` and `0060_system_workflow_run_domain_ref_dedup_rollback.sql` already exist with the correct FK drop order — re-use as-is in U6. Activation tables have no rollback files (`0038/0039/0041`) — author them in U6 with the proper `-- creates:` headers and `to_regclass` pre-flight.
- **Forward "drop migration" composes existing rollbacks rather than duplicating SQL.** The forward drop migration (`0062_drop_system_workflows_and_activation.sql` or next available number) reads/applies the rollback SQL inline rather than re-stating drop syntax. Reduces drift risk between rollback and forward-drop.
- **Single coordinated PR for GraphQL + UI cleanup (U2).** Deleting GraphQL types alone breaks admin and mobile codegen; deleting UI alone leaves orphan resolvers. Bundle GraphQL types + resolvers + `pnpm schema:build` + admin route delete + mobile screen delete + cross-app codegen into one PR. Verify by running `pnpm typecheck` across the workspace pre-merge.
- **Branch hygiene first (U1) is independent and ships immediately.** Doc rescue is pure file moves with no code dependency; lands right away to clear the smoke-plan branch's non-activation cargo.
- **Force-destroy on `system_workflow_output` S3 bucket may be needed at U5.** S3 buckets with objects fail Terraform destroy unless `force_destroy = true`. **Force-destroy is one-shot:** add the flag in a precursor commit only if `terraform plan` reports `BucketNotEmpty`. If the destroy plan then fails for any unrelated reason (e.g., Step Functions still draining, IAM policy still attached, S3 replication config blocking), immediately revert the flag in a hotfix — do not leave a force-destroy-enabled bucket in production.

---

## Open Questions

### Resolve Before Work

*Surfaced from doc-review (2026-05-06) — must be resolved before `/ce-work` begins each affected unit.*

- [P1][Affects U3] **Phase 1 plan document not cited.** U3 hard-depends on Phase 1 having merged + deployed (the 20 SW recorder call sites in `wiki-compile.ts` + `eval-runner.ts` must be stripped). Either cite `docs/plans/<phase-1-plan>.md` here, or note that Phase 1 doesn't yet have a plan document and must be authored first via a separate `/ce-plan` for R1+R2.
- [P1][Affects U6] **Deploy gate ordering for the forward-drop migration.** `db:migrate-manual` runs after `terraform-apply` and **blocks** deploys on missing-object failures. The plan calls forward-drop a "post-deploy `psql -f`" but doesn't pin order. Decide: (a) apply migration via `psql` BEFORE merging the U6 PR (out-of-band ops), (b) add the migration to the deploy pipeline before the `db:migrate-manual` gate, or (c) use the existing manual track with proper `-- creates:` markers so the gate accepts it as already-applied.
- [P1][Affects all units] **Cross-stage promotion mechanism.** Six PRs auto-deploy to `dev` on CI cadence. The "24-hour soak per major unit" claim needs a concrete promotion-gating mechanism: GitHub Environment protection rules on `staging`/`prod` jobs, manual hold via stage-specific deploy workflow, feature-flag-controlled rollout, or an alternative. Without this, all six PRs may ride to all stages within hours of each other, voiding the soak claim.
- [P1][Affects U5] **IAM audit beyond the named SW policy.** U5 deletes `aws_iam_role_policy.lambda_system_workflows_stepfunctions` (lines 636-658). Confirm the broader `RoutineExecution` Sid (lines 558-573) does not grant `states:StartExecution` against `system-*` ARN patterns via wildcard expansion. Run `aws iam simulate-principal-policy` against `arn:aws:states:<region>:<account>:stateMachine:thinkwork-<stage>-system-*` after deletion to verify no residual grants.
- [P1][Affects R3] **Onboarding fallback at scale.** The plan's "manual provisioning" fallback ("admin creates tenant + invites users + bootstraps agents directly") is unverified at the 4 enterprises × 100+ agents scale named in CLAUDE.md scope guardrails. Activation existed precisely because manual scale-out was the bottleneck. Either verify the manual path can handle expected enterprise-onboarding velocity, or commit to a Phase 1-3 onboarding bridge (deferring activation removal until Phase 6 has a concrete replacement).
- [P1][Affects all units] **Partial-merge failure mode.** Six independently-mergeable PRs across 5 layers — high-likelihood failure mode is U2-U4 land, then Phase 5 priorities pull attention, U5/U6 stall. System left strictly worse than pre-revert state (deleted user-facing surfaces but live SFN, IAM, S3 bucket, 11 orphan tables). Decide: a commitment window for all 6 PRs (e.g., "all merged within 2 weeks or roll back U2-U4"), explicit abandonment criteria, or alternative phasing that delivers value in fewer steps.
- [P2][Affects U6] **Activation table drain story.** U6 drops `activation_sessions` (with `in_progress` status), `activation_apply_outbox` (queue with potentially unprocessed entries), and `activation_session_turns` without row-state preflight. Decide: (a) explicitly acknowledge that in-progress sessions and pending outbox entries silently disappear (acceptable since data is going away anyway), or (b) add a drain step (mark in-progress sessions as cancelled, drain outbox).
- [P2][Affects U5] **SFN execution log group destruction has no pre-destroy data review.** State machines were configured with `include_execution_data = true` and `level = "ALL"`, capturing tenant payloads (sessionId, tenantId, userId for activation). Decide: (a) capture/audit log content before destroy (export to long-term storage, scrub PII, document destruction in a SOC2-relevant audit record), or (b) accept silent destruction as part of the "current data is not auditor-grade" framing.
- [P2][Affects U2] **Codegen drift defense during U2 single-PR review window.** U2 deletes types + resolvers + admin + mobile + regenerates 4 codegen pipelines. If a different GraphQL change merges to `main` during review, U2 needs a regenerate-and-rebase cycle. Decide: temporary lock on `main` GraphQL types during U2 review (manual coordination), sequence U2 to land first thing in a quiet window, or accept rebase churn as cost of bundled cleanup.
- [P2][Affects U1] **U1 scope split.** U1 moves 10 unrelated docs (Flue/Routines/Connectors/Brain) off the activation smoke-plan branch. These are independent feature streams. Decide: keep U1 in this plan (couples Phase 2 review surface to unrelated PR review), or split U1 into a separate prior chore PR that runs before this plan opens.
- [P2][Affects R3 user comms] **Mobile activation 404 user comms.** TestFlight has been live since 2026-04-12; activation has been in beta-tester hands ~3 weeks. Decide what users see when activation tab disappears: release notes only, in-app banner explaining the change, graceful empty state for the now-orphaned tab navigation entry, or no comms (assume internal-only beta with no expectation of stable features).
- [P2][Affects sequencing] **Opportunity cost vs Phase 5.** Phase 5 (Type 2 + AI controls) is the actual enterprise-sales motion. This plan's full 6-PR cleanup competes for engineering bandwidth in the same window. Decide: ship all 6 PRs now (current plan), or ship U2/U3 (user-facing + handlers) now and defer U4/U5/U6 (runtime + Terraform + schema, where resources are already idle) until Phase 3 design lands and any replacement shape is concrete.

### Resolved During Planning

- **Q: How many adapter Lambdas exist?** A: One dedicated (`activation-workflow-adapter`); Wiki/Evals state machines invoke `wiki-compile`/`eval-runner` directly via SFN payload context. Total Lambdas to delete = 5 (the adapter, the two SW callbacks, plus `activation-apply-worker` and the `activation` REST handler). The brainstorm's "three adapter Lambdas" framing was wrong; planning research corrected.
- **Q: Are `wiki-compile.test.ts` and `eval-runner.test.ts` Phase 1 or Phase 2 scope?** A: Phase 1. They mock SW recorder helpers; mocks must be removed when Phase 1 strips the 20 recorder call sites. Phase 2 verification confirms they don't reappear.
- **Q: Replacement onboarding flow?** A: None in Phases 1-3 — see Key Technical Decisions.
- **Q: Where does the AgentCore activation runtime live?** A: `packages/agentcore-activation/` (parallel to `agentcore-strands`), per learning `activation-runtime-narrow-tool-surface-2026-04-26.md`. Confirm exact path at U4 implementation time.

### Deferred to Implementation

- Exact handler ARN list for `aws stepfunctions list-executions` calls (depends on stage being drained — `dev`/`staging`/`prod`). Implementer enumerates from `aws stepfunctions list-state-machines` in U5.
- Whether the `system_workflow_output` S3 bucket has objects at destroy time. Implementer checks during U5 and adds `force_destroy = true` if needed.
- Exact non-activation file list to rescue from `codex/activation-deploy-smoke-plan` (research enumerated 11 candidates) — implementer runs `git fetch && git diff origin/main -- <path>` per file before move per `feedback_diff_against_origin_before_patching` to confirm none are stale duplicates of already-merged work.
- Whether the `notifyActivationSessionUpdate` mutation has any subscriber outside the AppSync subscription bridge. Implementer greps in U2; if none, deletion is clean.

---

## High-Level Technical Design

> *This illustrates the intended dependency ordering and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
                       Phase 1 (separate scope) — must merge + deploy first
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │ U1            │
                                  │ Branch +      │  (independent, no code change;
                                  │ doc rescue    │   ships immediately)
                                  └───────────────┘
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │ U2            │
                                  │ GraphQL +     │  (frontend cleanup — types,
                                  │ UI surfaces   │   resolvers, admin, mobile,
                                  │               │   codegen across workspace)
                                  └───────┬───────┘
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │ U3            │
                                  │ Library +     │  (REQUIRES Phase 1 deployed
                                  │ Lambda        │   — recorder importers stripped)
                                  │ handlers      │
                                  └───────┬───────┘
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │ U4            │
                                  │ AgentCore     │  (runtime container + Terraform
                                  │ activation    │   for the parallel runtime)
                                  │ runtime       │
                                  └───────┬───────┘
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │ U5            │
                                  │ Drain SFN +   │  (ops drain → terraform apply
                                  │ Terraform SFN │   destroys SFN/EventBridge/IAM)
                                  └───────┬───────┘
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │ U6            │
                                  │ Schema drop   │  (post-deploy psql apply +
                                  │               │   db:migrate-manual verify)
                                  └───────────────┘
```

The arrows are hard dependencies; reordering breaks build (U2 before U3) or breaks deploy (U3 before Phase 1, or U6 before U5).

---

## Implementation Units

- U1. **Branch hygiene + doc rescue**

**Goal:** Move 10 non-activation docs off `codex/activation-deploy-smoke-plan` to a worktree off `origin/main`, then close the branch without merging — clearing in-flight work that's not part of the Activation removal so it isn't lost when R3 closes the branch.

**Requirements:** R3 (branch closure step).

**Dependencies:** None — independent file moves, ships first.

**Files:**
- Move (off `codex/activation-deploy-smoke-plan`, target = a fresh worktree off `origin/main`):
  - `docs/plans/2026-05-03-003-feat-routine-visual-workflow-ux-plan.md`
  - `docs/plans/2026-05-03-004-feat-flue-fr9a-integration-spike-plan.md`
  - `docs/plans/2026-05-03-005-feat-flue-runtime-production-wiring-plan.md`
  - `docs/plans/2026-05-04-001-refactor-company-brain-sources-table-plan.md`
  - `docs/plans/2026-05-05-001-feat-thinkwork-connector-data-model-plan.md`
  - `docs/plans/2026-05-06-001-feat-flue-auto-retain-end-of-turn-plan.md` (if present at impl time)
  - `docs/brainstorms/2026-05-03-flue-framework-pi-parallel-reframe-requirements.md`
  - `docs/brainstorms/2026-05-03-routine-visual-workflow-ux-requirements.md`
  - `docs/solutions/architecture-patterns/flue-deep-researcher-launch-2026-05-04.md`
  - `docs/solutions/architecture-patterns/flue-framework-spike-verdict-2026-05-03.md`
- Stay on the activation revert branch (do not move):
  - `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md`
  - `docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md` (this plan)
  - `docs/plans/2026-05-02-011-feat-activation-system-workflow-deploy-smoke-plan.md` (committed; deletes with branch)
- Test: none — file-move operation only.

**Approach:**
- Per `feedback_diff_against_origin_before_patching`: `git fetch && git diff origin/main -- <path>` for each file before moving. If a file already exists upstream and matches, skip; if it differs, surface the diff for the user to resolve before moving.
- Create a fresh worktree (`.claude/worktrees/rescue-from-activation-smoke/`) off `origin/main` per `feedback_worktree_isolation`.
- Cherry-pick or copy each non-activation file into the rescue worktree; commit per logical group (Flue plans, Routine UX, Connector data model, etc.); open separate small PRs to `main`.
- After all rescued files are merged to `main`, close `codex/activation-deploy-smoke-plan` (no merge — `gh pr close` or branch delete).

**Patterns to follow:**
- Worktree creation per `feedback_worktree_isolation` and `feedback_cleanup_worktrees_when_done`.
- Diff-against-origin per `feedback_diff_against_origin_before_patching`.

**Test scenarios:**
- *Test expectation: none — file-move operation with no behavioral change. Verification is qualitative: each rescued file lands on `main`, branch closes cleanly.*

**Verification:**
- `git log origin/main -- <each rescued path>` shows the file present after merge.
- `git branch -a | grep codex/activation-deploy-smoke-plan` returns nothing (branch deleted).
- The activation-revert branch (whatever it's named for U2-U6) inherits only `docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md` and this plan from the closed branch.

---

- U2. **Delete System Workflows + Activation user-facing surfaces**

**Goal:** Remove the GraphQL types, resolvers, admin UI routes, mobile activation screens, and AppSync subscription bridge in a single coordinated PR that keeps the workspace build green.

**Requirements:** R3 (Activation feature removed — user-facing layer), R4 (multi-step admin UI tabs removed).

**Dependencies:** None on other units; can ship in parallel with U1 in time but logically lands after U1.

**Files:**
- Delete:
  - `packages/database-pg/graphql/types/system-workflows.graphql`
  - `packages/database-pg/graphql/types/activation.graphql`
  - `packages/api/src/graphql/resolvers/system-workflows/` (3 files: `index.ts`, `queries.ts`, `queries.test.ts`)
  - `packages/api/src/graphql/resolvers/activation/` (12 files)
  - `packages/api/src/__tests__/activation-system-workflow.test.ts`
  - `packages/api/src/__tests__/activation-automation-candidate-builder.test.ts`
  - `apps/admin/src/routes/_authed/_tenant/automations/system-workflows/` (3 route files)
  - `apps/mobile/app/activation/` (5 files: `index.tsx`, `apply.tsx`, `refresh.tsx`, `interview/[layerId].tsx`, `review/index.tsx`)
- Modify:
  - `packages/api/src/graphql/resolvers/index.ts` — remove imports and registry spreads at lines 36, 40-41, 66, 69, 93, 96, **plus the `systemWorkflowRunTypeResolvers` / `systemWorkflowTypeResolvers` import block at lines 104-107 and the `SystemWorkflow:` + `SystemWorkflowRun:` entries in the `typeResolvers` map at lines 115-116** (omitting these breaks U2's typecheck immediately after the resolver directory is deleted)
  - `apps/admin/src/components/Sidebar.tsx` — remove "System Workflows" navigation link
  - `apps/admin/src/lib/graphql-queries.ts` — remove `SystemWorkflowsList`, `SystemWorkflowDetail`, `SystemWorkflowRunDetail` query exports
  - `apps/mobile/lib/graphql-queries.ts` — remove activation query/mutation block
  - Mobile tab navigation — remove activation tab (path TBD at impl time, likely `apps/mobile/app/_layout.tsx` or `app/(tabs)/_layout.tsx`)
  - `terraform/schema.graphql` — regenerated by `pnpm schema:build`, not hand-edited
  - `apps/admin/src/gql/{gql,graphql}.ts` — regenerated by `pnpm --filter @thinkwork/admin codegen`
  - `apps/mobile/lib/gql/{gql,graphql}.ts` — regenerated by `pnpm --filter @thinkwork/mobile codegen`
  - `apps/cli/src/gql/graphql.ts` — regenerated by `pnpm --filter @thinkwork/cli codegen`
  - `packages/api/src/graphql/generated.ts` (or equivalent) — regenerated by `pnpm --filter @thinkwork/api codegen`
- Test files affected (not deleted, but assertions about SW/activation types removed):
  - `packages/api/src/__tests__/graphql-contract.test.ts` — drop assertions referencing SW + activation types

**Approach:**
- Run consumer survey first per learning `survey-before-applying-parent-plan-destructive-work-2026-04-24.md`: `grep -r "SystemWorkflow\|activation" --include="*.ts" --include="*.tsx" --include="*.graphql"` across all packages + apps to confirm no missed callers.
- Delete GraphQL type files first, then resolver directories, then run `pnpm schema:build` to regenerate `terraform/schema.graphql`.
- Run codegen across all consumers (`apps/admin`, `apps/mobile`, `apps/cli`, `packages/api`).
- Delete admin routes; codegen failure becomes typecheck failure if any reference dangles.
- Delete mobile screens + tab nav entry.
- Run `pnpm typecheck` workspace-wide; iterate on any dangling references.
- Run `pnpm test -r --if-present` to confirm nothing relies on deleted types.

**Patterns to follow:**
- Consumer survey at execution time per `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md`.
- Codegen pipeline per CLAUDE.md ("After editing GraphQL types, regenerate codegen in every consumer").

**Test scenarios:**
- *Happy path:* After deletion + codegen, `pnpm typecheck` passes across the workspace with zero references to `SystemWorkflow*` or `Activation*` types.
- *Happy path:* `pnpm test -r --if-present` passes — no test depends on deleted resolvers.
- *Edge case:* Run `pnpm schema:build` and inspect `terraform/schema.graphql` — confirm `onActivationSessionUpdated` subscription is absent.
- *Integration:* `grep -r "SystemWorkflow\|onActivationSessionUpdated\|startActivation\|notifyActivationSessionUpdate" packages/ apps/ --include="*.ts" --include="*.tsx" --include="*.graphql"` returns zero non-comment matches.
- *Edge case:* AppSync schema regeneration handles the dropped subscription cleanly (no orphan `@aws_subscribe` references in `terraform/schema.graphql`).

**Verification:**
- All typecheck and tests pass in CI.
- `pnpm format:check` passes.
- Manual smoke: open admin SPA on a deployed `dev` stage; confirm Sidebar has no "System Workflows" entry and no broken routes.
- Manual smoke: open mobile app on `dev` (TestFlight build or local Expo); confirm activation tab is absent and no dangling deep-link routes.

---

- U3. **Delete System Workflows library + Lambda handlers**

**Goal:** Remove `packages/api/src/lib/system-workflows/` and the 5 Lambda handlers it backed: `activation-workflow-adapter`, `activation-apply-worker`, `activation` (REST), `system-workflow-step-callback`, `system-workflow-execution-callback`. Strip their entries from `scripts/build-lambdas.sh` and Terraform `handlers.tf`.

**Requirements:** R3 (runtime invocation removed), R4 (adapter Lambdas removed, library deleted).

**Dependencies:** **U2** (resolvers must be gone before lib deletion — they import the launcher and recorders); **Phase 1 must merge + deploy to `dev`** (`wiki-compile.ts` and `eval-runner.ts` must already have stripped their 20 recorder call sites).

**Files:**
- Delete (entire directory):
  - `packages/api/src/lib/system-workflows/` — all 11 files plus 4 test files
- Delete (handlers + their tests):
  - `packages/api/src/handlers/activation-workflow-adapter.ts` + `activation-workflow-adapter.test.ts`
  - `packages/api/src/handlers/activation-apply-worker.ts` (+ test if present)
  - `packages/api/src/handlers/activation.ts` (+ test if present)
  - `packages/api/src/handlers/system-workflow-step-callback.ts` (+ test if present)
  - `packages/api/src/handlers/system-workflow-execution-callback.ts` (+ test if present)
- Modify:
  - `scripts/build-lambdas.sh` — remove entries at lines 142-146 (activation, activation-apply-worker), 297-300 (system-workflow-step-callback, system-workflow-execution-callback). Confirm exact line numbers at impl time; pattern is `BUNDLE_HANDLERS=(...)` array entries.
  - `terraform/modules/app/lambda-api/handlers.tf` — remove blocks at lines 203-204 (activation), 204 (activation-apply-worker), 272-274 (SW callbacks + activation-workflow-adapter), 538-543 (activation REST routes), 609-612 (SW callback routes). Each removed `aws_lambda_function` resource also has matching `aws_lambda_permission` and API Gateway integration / route blocks — remove all symmetrically per `feedback_lambda_zip_build_entry_required` (inverted for removal).

**Approach:**
- **Verify Phase 1 merged + deployed** before opening this PR. Run `git log origin/main --oneline -- packages/api/src/handlers/wiki-compile.ts packages/api/src/handlers/eval-runner.ts` to confirm the recorder-strip commit is present. Run `pnpm typecheck` against `main` to confirm `lib/system-workflows/wiki-build.ts` and `evaluation-runs.ts` have zero importers in handler code.
- Delete the lib directory.
- Delete each handler file + its test (if present).
- Strip entries from `scripts/build-lambdas.sh` and `terraform/modules/app/lambda-api/handlers.tf` symmetrically.
- Run `pnpm typecheck` — confirm clean.
- Run `pnpm build:lambdas` — confirm no stale references in the bundling script.
- Run `terraform -chdir=terraform/examples/greenfield plan -var-file=terraform.tfvars` — expect a destroy diff for the 5 Lambdas (and only those Lambdas; if any other resource shows up as destroy, stop and investigate).

**Patterns to follow:**
- Symmetric Terraform + build-script cleanup per `feedback_lambda_zip_build_entry_required` (inverted for deletion: removal must touch both `handlers.tf` and `scripts/build-lambdas.sh`).
- "Ship inert" inverted: don't delete a library while consumers still import it. Verify Phase 1 importers are gone first.

**Test scenarios:**
- *Happy path:* `pnpm typecheck` passes across the workspace post-deletion.
- *Happy path:* `pnpm build:lambdas` exits cleanly — no missing handler entry-point errors.
- *Integration:* `terraform plan` shows exactly 5 Lambda destroys + their permissions/routes; no other unexpected destroys.
- *Edge case:* `grep -r "system-workflows\|SystemWorkflow" packages/api/src/lib packages/api/src/handlers` returns zero matches (excluding deleted files).
- *Integration:* Wiki Build and Evaluation Runs continue to work end-to-end on `dev` post-merge (they were on direct Lambda after Phase 1; this unit doesn't touch them, but verify no regression).

**Verification:**
- CI green: typecheck + tests + build + lint.
- `terraform plan` diff matches expected destroy set.
- Post-deploy smoke: trigger Wiki Build and Eval Run via GraphQL on `dev`; both succeed; no log entries in CloudWatch reference deleted handlers.

---

- U4. **Delete AgentCore activation runtime**

**Goal:** Remove the `agentcore-activation` runtime container (parallel to `agentcore-strands`) and its Terraform definition, completing Activation feature removal at the runtime layer.

**Requirements:** R3 (runtime invocation removed).

**Dependencies:** U2 (Activation GraphQL surface gone, no caller invokes the runtime); U3 (`activation-apply-worker` Lambda gone).

**Files:**
- Delete (path confirmed at impl time per learning `activation-runtime-narrow-tool-surface-2026-04-26.md`):
  - `packages/agentcore-activation/` — entire directory (Python source, Dockerfile, `pyproject.toml`, tests)
- Modify:
  - **The runtime is NOT Terraform-managed** — verified at planning time: `grep -r "agentcore-activation\|agentcore_activation" terraform/` returns zero matches; root `pyproject.toml` does not register `packages/agentcore-activation` as a workspace member. Cleanup is direct AWS CLI calls plus source deletion, not Terraform module removal.
  - GitHub Actions / CI workflows — if any workflow specifically builds, tests, or pushes `agentcore-activation`, remove the workflow file or scope the activation-specific job/triggers (audit at impl time: `grep -r agentcore-activation .github/`).

**Approach:**
- The activation runtime is built by `packages/agentcore-activation/scripts/build-and-push.sh` directly to ECR; there is no Terraform to plan/apply. Cleanup is direct AWS API calls per stage (`dev`, then `staging`, then `prod`).
- Find the runtime: `aws bedrock-agentcore list-agent-runtimes --query 'agentRuntimes[?contains(agentRuntimeName, \`activation\`)].{name:agentRuntimeName,id:agentRuntimeId,arn:agentRuntimeArn}'`. Capture the runtime ID(s) per stage.
- Confirm no live invocations: once U3's Lambdas are gone, no caller invokes the runtime. Verify CloudWatch invocation count is zero in the last 24 hours before deletion.
- Delete the runtime per stage: `aws bedrock-agentcore delete-agent-runtime --agent-runtime-id <id>`. Verify with `list-agent-runtimes` returning empty for the activation pattern.
- Find the ECR repo: `aws ecr describe-repositories --query 'repositories[?contains(repositoryName, \`activation\`)].repositoryName'`. Capture repo names per stage.
- Delete the ECR repo (forces image deletion): `aws ecr delete-repository --force --repository-name <name>` per stage.
- Delete the source directory: `rm -rf packages/agentcore-activation/`.
- Run `uv sync` — confirms `pyproject.toml` workspace was clean (the package was never registered, per planning verification).
- Run `pnpm typecheck` — passes since no TS code references the Python runtime directly (it's invoked via runtime ARN, which is gone).
- Audit CI workflows: `grep -r "agentcore-activation" .github/` — if any workflow file references the runtime, remove or scope.

**Patterns to follow:**
- AgentCore runtime decommission: mirror the shape used when other AgentCore runtimes have been retired (search git log for prior runtime removals if any).
- Per memory `project_agentcore_default_endpoint_no_flush`, AgentCore DEFAULT endpoint can't be flushed via API — the runtime decommission destroys the resource entirely, which is fine for this case.

**Test scenarios:**
- *Happy path:* Per stage, `aws bedrock-agentcore list-agent-runtimes --query 'agentRuntimes[?contains(agentRuntimeName, \`activation\`)]'` returns empty after `delete-agent-runtime`.
- *Happy path:* Per stage, `aws ecr describe-repositories --query 'repositories[?contains(repositoryName, \`activation\`)]'` returns empty after `delete-repository --force`.
- *Edge case:* `uv sync` succeeds with `agentcore-activation` no longer in the source tree (workspace was always clean — the package was never registered).
- *Edge case:* `pnpm typecheck` passes — no TS imports reference the Python runtime directly.
- *Integration:* CloudWatch metrics for the activation runtime show zero invocations in the 24 hours before deletion (confirms Phase 1 + U3 already silenced it).
- *Test expectation: none for code paths — runtime deletion is AWS-API-only after Phase 1+U3 strip the callers.*

**Verification:**
- CI green (typecheck, tests, lint).
- Per stage: AWS Console / CLI shows no activation AgentCore runtime, no activation-named ECR repo.
- `grep -r agentcore-activation packages/ apps/ terraform/ .github/` returns zero matches.

---

- U5. **Drain Step Functions executions + remove Terraform SFN module + IAM**

**Goal:** Stop any in-flight SFN executions, then `terraform apply` to destroy the three state machines, EventBridge rule, S3 output bucket, log group, and IAM role/policy that backed System Workflows.

**Requirements:** R4 (Step Functions state machines removed, EventBridge wiring removed).

**Dependencies:** U3 (Lambda handlers gone, so SFN can't invoke them anyway), U4 (activation runtime gone). Should not run before U2/U3 because terraform-apply destroying SFN before handlers are gone leaves orphaned Lambda integrations.

**Files:**
- Delete (entire directories):
  - `terraform/modules/app/system-workflows-stepfunctions/` — entire 263-line module + `asl/*.json` templates
- Modify:
  - `terraform/modules/thinkwork/main.tf` — remove `module "system_workflows_stepfunctions"` block at lines 312-327
  - `terraform/modules/app/lambda-api/main.tf` — remove `aws_iam_role_policy.lambda_system_workflows_stepfunctions` at lines 636-658

**Approach:**
- **IAM preflight.** Before drain, verify the deploying principal has `states:StopExecution` on `system-*` ARNs: `aws iam simulate-principal-policy --policy-source-arn <role-arn> --action-names states:StopExecution --resource-arns 'arn:aws:states:<region>:<account>:execution:thinkwork-<stage>-system-*:*'`. The Lambda role policy at lines 636-658 of `lambda-api/main.tf` grants only `Start/Describe/GetExecutionHistory` — not `Stop`. If the simulation returns `denied`, attach a temporary policy or run drain via an admin role with the permission. Same audit applies to the broader `RoutineExecution` Sid (lines 558-573) — confirm it does not grant `states:StartExecution` against `system-*` ARN patterns via wildcard expansion before relying on policy removal alone.
- **Disable EventBridge before drain.** Disable the `sfn_state_change` EventBridge rule per stage to prevent state-change events from spawning callback Lambda invocations during the drain window: `aws events disable-rule --name <rule-name>` per stage. (The rule fires on SFN state changes; with the callback Lambda already deleted in U3, every fire would surface as an alarm. Disabling first makes the drain window quiet.)
- **Drain before destroy.** For each stage (`dev`, then `staging`, then `prod` if applicable) and each state machine ARN (3 per stage):
  ```
  aws stepfunctions list-executions \
    --state-machine-arn arn:aws:states:us-east-1:<account>:stateMachine:thinkwork-<stage>-system-<workflow> \
    --status-filter RUNNING \
    --query 'executions[].executionArn' --output text
  ```
  For each running execution, `aws stepfunctions stop-execution --execution-arn <arn> --cause "Phase 2 retirement"`. Wait until `status-filter RUNNING` returns empty for all three state machines per stage.
- Check S3 bucket for objects: `aws s3 ls s3://thinkwork-<stage>-system-workflow-output --recursive | wc -l`. If non-zero, set `force_destroy = true` on the bucket in a precursor commit, deploy, then delete.
- Open the PR with the Terraform deletes; `terraform plan` should show: 3 state machines destroyed + 1 EventBridge rule + 1 target + 1 Lambda permission + 1 IAM role + 1 policy + 1 S3 bucket + 1 log group.
- Merge → CI runs `terraform apply` → resources destroyed.

**Patterns to follow:**
- Drain pattern per `docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md` (calling out that `cancelEvalRun` doesn't actually `StopExecution`).
- Terraform destroy ordering — module-level deletion handles internal ordering; outer instantiation goes last.

**Test scenarios:**
- *Happy path:* After drain, `aws stepfunctions list-executions --status-filter RUNNING` returns empty for all 3 state machines per stage.
- *Edge case:* `terraform plan` on `dev` shows exactly the expected destroy set; no unrelated resources affected.
- *Edge case:* If S3 bucket has objects, plan fails with `BucketNotEmpty`; resolve with `force_destroy = true` precursor commit.
- *Integration:* Post-`terraform apply`, AWS Console shows: no SFN state machines named `thinkwork-<stage>-system-*`; no EventBridge rule named `*sfn-state-change*` for SW; the `system-workflow-output` S3 bucket is gone.
- *Edge case:* If a new SFN execution is started during the drain window (race with a slow caller), the Lambda integration fails (handlers already gone in U3) and the execution self-terminates as failed; no orphan rows because no callback handler exists.

**Verification:**
- `aws stepfunctions list-state-machines | grep system-workflow` returns nothing per stage.
- `terraform apply` exits 0; CloudWatch alarms (if any tied to these resources) clean up automatically.
- `grep -r system_workflows_stepfunctions terraform/` returns zero matches outside `.terraform/` cache.

---

- U6. **Drop database tables — schema rollback migrations + forward drop migration + apply**

**Goal:** Remove the 7 `system_workflow_*` tables and 4 `activation_*` tables from Aurora Postgres in dependency-safe order, with proper rollback files for `db:migrate-manual` parity and a forward drop migration applied via `psql` post-deploy.

**Requirements:** R3 (4 activation tables dropped), R4 (7 system_workflow tables dropped).

**Dependencies:** U2 (resolvers gone), U3 (recorder writers gone), U4 (runtime gone), U5 (SFN gone). All write paths must be removed before schema drop.

**Files:**
- Create (new rollback migrations for activation — none exist):
  - `packages/database-pg/drizzle/0038_activation_sessions_rollback.sql` — `DROP TABLE activation_session_turns; DROP TABLE activation_sessions;` with proper header (`-- creates: public.activation_sessions, public.activation_session_turns` markers reference what's being dropped) and `to_regclass` pre-flight checks
  - `packages/database-pg/drizzle/0039_activation_apply_outbox_rollback.sql` — `DROP TABLE activation_apply_outbox;`
  - `packages/database-pg/drizzle/0041_activation_automation_candidates_rollback.sql` — `DROP TABLE activation_automation_candidates;`
- Create (forward drop migration):
  - `packages/database-pg/drizzle/0062_drop_system_workflows_and_activation.sql` (next available sequence number — confirm at impl time) — composes the existing `0059_system_workflows_rollback.sql` + `0060_system_workflow_run_domain_ref_dedup_rollback.sql` + the 3 new activation rollbacks above. Drop order: SW first (no FK in either direction with activation), then activation (candidates → outbox → turns → sessions).
- Modify:
  - `packages/database-pg/src/schema/system-workflows.ts` — delete entire file (Drizzle schema source)
  - `packages/database-pg/src/schema/activation.ts` — delete entire file
  - `packages/database-pg/src/schema/index.ts` (or wherever schemas are re-exported) — remove the SW + activation exports
- Re-use as-is (already exist):
  - `packages/database-pg/drizzle/0059_system_workflows_rollback.sql`
  - `packages/database-pg/drizzle/0060_system_workflow_run_domain_ref_dedup_rollback.sql`

**Approach:**
- **Final consumer survey before authoring drops** per learning `survey-before-applying-parent-plan-destructive-work-2026-04-24.md`:
  ```
  grep -rn "system_workflow_\|activation_" packages/ apps/ --include="*.ts" --include="*.sql"
  ```
  Confirm zero non-comment hits before proceeding.
- Author the 3 activation rollback files following the manual-track template per `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`. Each file gets a header block with `-- creates: <fully qualified table>` markers (so `db:migrate-manual` knows which objects to verify), `-- requires:` for prerequisite migrations, and `to_regclass` pre-flight check that returns early if the table is already absent (idempotency).
- Author the forward drop migration. Single file with header + ordered drops:
  ```
  -- creates: (none — this is a destructive migration)
  -- drops: public.system_workflow_change_events, public.system_workflow_evidence, ...
  -- requires: 0061_<previous>
  BEGIN;
  -- SW side (FK chain handles cascades)
  DROP TABLE IF EXISTS public.system_workflow_change_events;
  DROP TABLE IF EXISTS public.system_workflow_evidence;
  DROP TABLE IF EXISTS public.system_workflow_step_events;
  DROP TABLE IF EXISTS public.system_workflow_runs;
  DROP TABLE IF EXISTS public.system_workflow_extension_bindings;
  DROP TABLE IF EXISTS public.system_workflow_configs;
  DROP TABLE IF EXISTS public.system_workflow_definitions;
  -- Activation side
  DROP TABLE IF EXISTS public.activation_automation_candidates;
  DROP TABLE IF EXISTS public.activation_apply_outbox;
  DROP TABLE IF EXISTS public.activation_session_turns;
  DROP TABLE IF EXISTS public.activation_sessions;
  COMMIT;
  ```
  (Note: pseudo-SQL above is *directional guidance for review only* — the actual migration follows the manual-track header template exactly.)
- Delete the Drizzle schema source files (`system-workflows.ts`, `activation.ts`).
- Run `pnpm --filter @thinkwork/database-pg build` — Drizzle codegen should reflect the deletions cleanly.
- Apply via `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0062_drop_system_workflows_and_activation.sql` per stage post-deploy.
- Run `pnpm db:migrate-manual` per stage — must report all dropped tables as expected-absent.
- The `deploy.yml` workflow's `db:migrate-manual` gate will fail if any expected object is missing; this confirms the drop succeeded.

**Patterns to follow:**
- Manual-track migration headers per `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.
- Drop ordering per the existing rollback files (SW: change_events → evidence → step_events → runs → extension_bindings → configs → definitions; activation: candidates → outbox → turns → sessions).
- `to_regclass` idempotency pre-flight in each rollback file.

**Test scenarios:**
- *Happy path:* `pnpm --filter @thinkwork/database-pg build` succeeds with the schema source files deleted.
- *Happy path (per stage):* `psql -f 0062_drop_*.sql` exits 0; `\dt public.system_workflow_*` and `\dt public.activation_*` return empty.
- *Edge case (idempotency):* Re-running the drop migration on an already-dropped database exits 0 (the `IF EXISTS` clauses + `to_regclass` checks make it idempotent).
- *Edge case (rollback):* Running `0059_system_workflows_rollback.sql` then `0059_system_workflows.sql` on a fresh DB recreates the tables identically (sanity-check the rollback file's drop order matches forward order — already exists, just verify).
- *Integration:* `pnpm db:migrate-manual` post-apply reports zero missing objects across the dropped set; `deploy.yml` gate passes.
- *Integration:* Cross-stage progression (`dev` → `staging` → `prod`): apply migration on `dev`, verify a week of `dev` operation, then promote.

**Verification:**
- Per stage: `psql "$DATABASE_URL" -c "\dt public.system_workflow_* public.activation_*"` returns zero rows.
- Per stage: `pnpm db:migrate-manual --stage <stage>` reports clean.
- `grep -r "system_workflow\|activation_" packages/database-pg/src/` returns zero non-comment matches outside historical migrations and rollback files.
- Final closure check per `docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md`: `grep -r "system_workflow\|SystemWorkflow\|/activation/\|notifyActivationSession" packages/ apps/ terraform/ --include="*.ts" --include="*.tsx" --include="*.tf" --include="*.graphql"` returns zero non-comment matches anywhere except historical migrations.

---

## System-Wide Impact

- **Interaction graph:** Three GraphQL resolver imports go away (`startSystemWorkflow` from `wiki/compileWikiNow.mutation.ts`, `evaluations/index.ts`, `activation/startActivation.mutation.ts`). Phase 1 already strips the first two; U2 strips the third (the entire activation resolver). The `notifyActivationSessionUpdate` → `onActivationSessionUpdated` AppSync subscription bridge is severed entirely.
- **Error propagation:** No remaining error paths flow through SW infrastructure post-merge. Wiki and Evals failures surface directly through GraphQL resolver error responses (Phase 1's behavior).
- **State lifecycle risks:** In-flight SFN executions during U5 are the primary partial-write risk. Drained explicitly before Terraform destroy. Schema drop in U6 happens after all writers are removed (U2-U5 sequencing) — no race window where active code writes to a soon-to-be-dropped table.
- **API surface parity:** Mobile activation deep-links (`/activation/...`) return **502 (integration failure) transiently during the U3 `terraform apply` window**, then **404 after the API Gateway integration is destroyed**. Admin sidebar loses one entry. No external API contracts are affected — SW and Activation were both internal-only surfaces.
- **Integration coverage:** Cross-stage soak (`dev` for at least 24 hours per major unit) before promoting to higher stages. Watch CloudWatch logs for any references to deleted handlers — would indicate a missed caller.
- **Unchanged invariants:** `workflow_configs` table and the `orchestration/` resolver directory remain intact (Routines orchestration). `wiki-compile` and `eval-runner` Lambda handlers remain (Phase 1's direct-invoke targets). The mobile app's non-activation tabs and deep-links are unaffected. AgentCore Strands runtime (`agentcore-strands`) is unaffected — only the parallel `agentcore-activation` container goes.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Phase 1 not deployed when U3 starts; library deletion fails typecheck because handler imports remain | Verify Phase 1 merged + deployed to `dev` before opening U3 PR. Run `git log origin/main` to confirm; run `pnpm typecheck` against current `main` to confirm zero importers. |
| In-flight SFN executions write to `system_workflow_step_events` after U6 schema drop, causing 500s | Drain explicitly in U5 (`stop-execution` per running execution) before Terraform destroy. By U6, all SFN state machines are gone — no possible new executions. |
| `cancelEvalRun` / similar admin actions don't `StopExecution`, leaving zombies | Per learning `eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md` — drain pattern in U5 explicitly handles this; admin "cancel" rows on `dev` may exist but their SFN counterparts get stopped at drain time. |
| Codegen regen leaves stale generated files in worktree, causing typecheck false-positives | Per `feedback_worktree_tsbuildinfo_bootstrap`: after `pnpm install` on a fresh checkout, `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` BEFORE typecheck. |
| `system_workflow_output` S3 bucket has objects, blocking Terraform destroy | Check at U5 impl time with `aws s3 ls`; if non-empty, add `force_destroy = true` in a precursor commit, deploy, then proceed with destroy. Revert flag after. |
| Branch-rescue diff conflicts: a non-activation file on `codex/activation-deploy-smoke-plan` differs from a sibling already merged to `main` by another session | `git fetch && git diff origin/main -- <path>` per file before move (per `feedback_diff_against_origin_before_patching`). Surface conflicts to user; do not silently overwrite. |
| `db:migrate-manual` deploy gate fails because new rollback file headers are malformed | Author rollback files locally first; run `pnpm db:migrate-manual --stage dev` against a synced dev DB; iterate on header format until clean before opening U6 PR. |
| Non-trivial rollback path: re-creating dropped infrastructure if Phase 3 is delayed and a stakeholder demands the SW substrate back | Rollback files re-create tables, but full restoration is multi-day work: replay 5 migrations on a database that may have drifted post-drop, rebuild the activation AgentCore runtime container + re-push to ECR (image is GC-able once the repo is deleted), `git revert` Lambda handlers + lib code, re-deploy SFN module + IAM. Re-running consumed migration sequence numbers may collide with later migrations applied between drop and revert. **Time-to-restore: 2-3 days, not 1.** |

---

## Documentation / Operational Notes

- **PR description language for U3 + U5 + U6**: explicitly call out the "no replacement onboarding flow in Phases 1-3" decision (per Key Technical Decisions) so stakeholders see the gap.
- **Post-merge announcement**: notify the team that mobile activation deep-links return 404 and the admin "System Workflows" sidebar entry is gone. If any external docs/tutorials reference these, update or mark deprecated.
- **CloudWatch dashboard cleanup** (optional follow-up): if dashboards exist that aggregated SW metrics or alarms, retire them. Likely zero — the brainstorm noted "I'm not seeing any auditing data here that could be useful."
- **AgentCore reconciler**: per `project_agentcore_deploy_race_env`, warm container env-injection has a 15-min reconciler. After U4 merges, the activation runtime stops appearing in reconciler output. Confirm.
- **SOC2 / audit context**: this plan removes infrastructure that the brainstorm described as "the shape of compliance infrastructure without the substance." The replacement (Phase 3 Compliance feature) is gated on the 30 RBP items in the origin doc and is not part of this plan.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md](../brainstorms/2026-05-06-system-workflows-revert-compliance-reframe-requirements.md)
- **Project memory:** `project_system_workflows_revert_compliance_reframe.md` (overall arc), `project_soc2_type2_ai_strategic_horizon.md` (downstream Phase 5 framing)
- **Institutional learnings (most-load-bearing):**
  - [docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md](../solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md)
  - [docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md](../solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md)
  - [docs/solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md](../solutions/architecture-patterns/inert-to-live-seam-swap-pattern-2026-04-25.md)
  - [docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md](../solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md)
  - [docs/solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md](../solutions/best-practices/activation-runtime-narrow-tool-surface-2026-04-26.md)
  - [docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md](../solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md)
  - [docs/solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md](../solutions/developer-experience/routine-rebuild-closeout-checkpoints-2026-05-03.md)
- **Code references:** see Context & Research § Relevant Code and Patterns
