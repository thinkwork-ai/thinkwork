---
title: "chore: Evaluation Runs System Workflow Smoke"
type: chore
status: completed
date: 2026-05-02
origin: docs/plans/2026-05-02-008-feat-system-workflow-runtime-eval-adapter-plan.md
---

# chore: Evaluation Runs System Workflow Smoke

## Overview

Merge the CLI GraphQL serialization fix, update the local checkout to the merged mainline, then run a real dev smoke for the `evaluation-runs` System Workflow path. The goal is to prove the Evaluation Runs adapter still works end to end now that CLI GraphQL generated-document serialization is fixed, and to apply narrowly scoped polish only if the smoke exposes a concrete defect.

## Problem Frame

The System Workflow runtime and Evaluation Runs adapter already landed, followed by Wiki Build and Tenant/Agent Activation adapters. During the Wiki Build smoke, the CLI failed before useful workflow validation because generated GraphQL documents were not reaching the API as query strings. PR #773 fixes that CLI transport issue. The next useful step is to merge it, then return to Evaluation Runs and validate the representative Standard Step Functions flow against dev with real records, System Workflow run rows, step events, and evidence.

## Requirements Trace

- R1. PR #773 is merged before the smoke so dev can receive the CLI GraphQL serialization fix through the normal main deploy path.
- R2. A real dev Evaluation Run can be started from the CLI in non-interactive JSON mode.
- R3. The run reaches a terminal Evaluation domain status (`completed` or a clear actionable failure).
- R4. A corresponding `system_workflow_runs` row exists for workflow id `evaluation-runs` and the evaluation run domain reference.
- R5. The System Workflow run has Step Functions execution identity, step events, and evidence that make the run inspectable under Automations.
- R6. If the smoke uncovers a defect, the fix stays narrowly scoped to the CLI/evaluation/System Workflow adapter surface that caused the failure.
- R7. Unrelated local untracked files remain untouched.

## Scope Boundaries

- Do not redesign Evaluation Runs or add Express child fan-out.
- Do not change Evaluation GraphQL API shape unless the smoke proves an existing contract is broken.
- Do not hand-edit production/dev data except through existing CLI/API paths.
- Do not touch unrelated `docs/plans/2026-05-02-011-feat-activation-system-workflow-deploy-smoke-plan.md` or `symphony/` files if present locally.

## Context & Research

### Relevant Code and Patterns

- `apps/cli/src/commands/eval/run.ts` starts and optionally watches Evaluation Runs.
- `apps/cli/src/commands/eval/gql.ts` contains the CLI generated GraphQL documents used by eval commands.
- `packages/api/src/graphql/resolvers/evaluations/index.ts` routes `startEvalRun` through `startSystemWorkflow`.
- `packages/api/src/lib/system-workflows/start.ts` owns System Workflow run creation, idempotency, and Step Functions launch.
- `packages/api/src/lib/system-workflows/evaluation-runs.ts` records evaluation step/evidence summaries.
- `packages/api/src/handlers/eval-runner.ts` remains the existing domain runner behind the Standard parent.
- `packages/api/src/graphql/resolvers/system-workflows/queries.ts` is the read path used to inspect workflow runs after smoke.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`: deployed smoke should verify the actual target database has required objects rather than assuming migrations have landed.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`: idempotent/dedupe paths need visible evidence, not silent no-ops.

## Key Technical Decisions

- **Use existing CLI/API surfaces first:** The smoke should prove the same path an operator would use, not a bespoke SQL-only launch.
- **Inspect both domain and workflow layers:** Evaluation domain status alone is insufficient; this smoke must also verify the System Workflow run, Step Functions identity, step trail, and evidence.
- **Patch only observed defects:** If the smoke passes, the durable output is the plan plus smoke evidence. If it fails, fix the narrow cause and rerun the smoke.
- **Prefer deployed dev truth:** Because ThinkWork has no local-only end-to-end mode, use dev stage commands and GitHub deployment status as the source of truth.

## Open Questions

### Resolved During Planning

- Should this include the third adapter? No. Tenant/Agent Activation already landed; this task returns to the Evaluation Runs adapter smoke/polish loop.
- Should this wait for the main deploy after merging #773? Yes. The smoke should run against the deployed stack after main has the CLI transport fix.

### Deferred to Execution

- Exact tenant/template/test-case identifiers: discover from dev via CLI/API at smoke time.
- Whether the Evaluation Run finishes quickly enough for `--watch`: start with a bounded watch and fall back to explicit polling if needed.

## Implementation Units

- U1. **Merge CLI Serialization Fix And Sync Main**

**Goal:** Merge PR #773 and prepare the local checkout for the Evaluation Runs smoke.

**Requirements:** R1, R7.

**Files:**

- Modify: none expected.
- Smoke artifact/update: `docs/plans/2026-05-02-013-chore-evaluation-runs-system-workflow-smoke-plan.md`

**Approach:**

- Confirm PR #773 remains green and mergeable.
- Merge through GitHub using the repo's squash-merge convention.
- Update local `main` after merge without disturbing unrelated untracked files.
- Wait for the merged main deploy to dev if a deployment workflow is triggered.

**Verification:**

- PR #773 is merged.
- Local branch reflects `origin/main` after merge.
- No unrelated untracked files are staged or modified.

- U2. **Run Evaluation Runs End-To-End Smoke**

**Goal:** Start a real Evaluation Run through the CLI and verify the associated System Workflow record is inspectable.

**Requirements:** R2, R3, R4, R5.

**Files:**

- Modify only if needed: `apps/cli/src/commands/eval/*`, `packages/api/src/graphql/resolvers/evaluations/index.ts`, `packages/api/src/lib/system-workflows/*`, `packages/api/src/handlers/eval-runner.ts`
- Test only if needed: matching focused tests under `apps/cli/__tests__/` or `packages/api/src/**/*.test.ts`
- Update: `docs/plans/2026-05-02-013-chore-evaluation-runs-system-workflow-smoke-plan.md`

**Approach:**

- Discover dev tenant, agent template, and enabled test-case scope through existing CLI/API commands.
- Start `thinkwork eval run` in JSON mode with explicit tenant/template/scope flags.
- Watch or poll the Evaluation Run until terminal.
- Inspect `system_workflow_runs` for workflow id `evaluation-runs` and the run domain reference.
- Inspect related step events and evidence through GraphQL/CLI/API queries or direct dev database inspection if no CLI surface exists.
- If a concrete defect appears, patch only that defect, run focused tests, and repeat the smoke.

**Test scenarios:**

- Happy path: CLI starts an Evaluation Run and returns a run id.
- Domain terminal: `thinkwork eval get` or equivalent polling shows a terminal status with result counts.
- Workflow run: exactly one `evaluation-runs` System Workflow run exists for the eval run domain ref.
- Workflow evidence: the System Workflow run has at least one step event and one evidence record.
- Failure path: if the run fails, the error is visible in either Evaluation Run or System Workflow evidence rather than hidden behind a silent success.

**Verification:**

- CLI smoke command output records run id and terminal status.
- System Workflow inspection records run id, execution ARN/status, step count, and evidence count.
- Focused tests pass if any code was changed.

- U3. **Review, Browser Applicability, And PR Handoff**

**Goal:** Finish the LFG quality gates for any smoke polish changes.

**Requirements:** R6, R7.

**Files:**

- Modify only if needed by U2.
- Update: `docs/plans/2026-05-02-013-chore-evaluation-runs-system-workflow-smoke-plan.md`

**Approach:**

- Run code review in autofix posture against this plan.
- Persist any safe autofixes.
- Treat browser testing as not applicable unless the smoke changes Admin UI behavior.
- Commit/push/open a PR if code or tracked docs changed.

**Verification:**

- Review residuals are none or durably recorded.
- Browser step is either run for affected Admin routes or explicitly marked not applicable for CLI/backend-only changes.
- PR exists if tracked changes remain after smoke.

## Execution Notes

- Merged PR #773 after verifying GitHub marked it `MERGED`; the remote branch was deleted.
- Waited for the merged main deploy run `25265713426` to complete successfully for commit `efbac8fe478946426672f8c56ab060eb2f9eb7b8`.
- Started a dev Evaluation Run from the CLI using an explicit tenant, agent template, and one `--test-case`.
- Smoke run id: `dde38d23-4b27-42bf-b048-5c5e9a25b259`.
- System Workflow run id: `db63b997-4fc5-4bfa-8075-b6122393a029`.
- Step Functions execution ARN: `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-system-evaluation-runs:evaluation-runs-eval_run-dde38d23-4b27-42bf-b048-5c5e9a25b259`.
- Smoke finding: the run expanded to all 96 enabled test cases even though the CLI sent one selected test-case id.
- Root cause: `startEvalRun` forwarded `testCaseIds` into the System Workflow input, but `eval-runner` only scoped by persisted run categories and ignored the workflow input selection.
- Fix: `eval-runner` now reads `input.testCaseIds`, gives explicit selected test cases precedence over categories, and records the selected ids in the `SnapshotTestPack` step output.

## Verification Results

- `pnpm --filter @thinkwork/api test -- src/handlers/eval-runner.test.ts` passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `git diff --check` passed.
- API package lint was not run because the package has no `lint` script.
- Prettier was not run because `prettier` is not installed in this checkout's current dependency graph.
- Browser testing is not applicable for this CLI/backend-only fix.
