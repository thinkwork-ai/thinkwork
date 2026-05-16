---
title: Evals Overhaul Autopilot Status
date_started: 2026-05-16
plan: docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md
target_branch: main
status: active
---

# Evals Overhaul Autopilot Status

## Current Unit

- Unit: U12. CLI polish
- Branch: `codex/evals-overhaul-u12-cli-polish`
- Worktree: `.Codex/worktrees/evals-overhaul-u12-cli-polish`
- State: PR #1270 open; waiting for required checks

## Final Proof Request

- After all implementation units are merged and deployed, run a full end-to-end evaluation from the Admin UI, watch it reach a terminal state, open the run detail, and capture the result surface so the current eval system state is visible.

## Progress Log

- 2026-05-16: Created clean worktree from `origin/main` for U1 and copied the referenced plan into the worktree.
- 2026-05-16: Added `scripts/eval-stall-probe.ts` and API-package implementation at `packages/api/scripts/eval-stall-probe.ts`.
- 2026-05-16: Ran dev probes against stuck run `b945fc4d-c811-4c60-bec5-56e5bd2aabad`; findings recorded in `docs/solutions/diagnostics/eval-runner-stall-findings-2026-05-16.md`.
- 2026-05-16: Local verification passed: probe help, live dev probe, API typecheck, eval-runner unit test, and `git diff --check`.
- 2026-05-16: Opened PR #1252 for U1.
- 2026-05-16: PR #1252 required checks passed: `cla`, `lint`, `test`, `typecheck`, and `verify`.
- 2026-05-16: Squash-merged PR #1252 to `main`, deleted the U1 branch/worktree, and confirmed post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U2 worktree from `origin/main`.
- 2026-05-16: Implemented inert SQS eval fan-out substrate with queue, DLQ, DLQ depth alarm, eval-worker Lambda stub, event source mapping, scoped SQS IAM policies, and Lambda build entry.
- 2026-05-16: Local U2 verification passed: API typecheck, eval-worker/eval-runner unit tests, eval-worker Lambda build, Lambda API Terraform validate, Terraform fmt, focused no-refresh Terraform plan, and `git diff --check`.
- 2026-05-16: Opened PR #1253 for U2.
- 2026-05-16: PR #1253 required checks passed, squash-merged to `main`, deleted the U2 branch/worktree, and confirmed post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U3 worktree from `origin/main`.
- 2026-05-16: Started U3 rewrite: eval-runner dispatcher, live eval-worker body, result idempotency unique index, and worker/dispatcher shape tests.
- 2026-05-16: Wired the eval_results idempotency index into the normal deploy workflow before Lambda code swap, so the worker's `ON CONFLICT` target exists when U3 deploys.
- 2026-05-16: Local U3 verification passed: API typecheck, database build, eval-runner/eval-worker/integration tests, eval-runner/eval-worker Lambda builds, Lambda API Terraform validate, Terraform fmt, and `git diff --check`.
- 2026-05-16: Opened PR #1254 for U3.
- 2026-05-16: PR #1254 required checks passed and was squash-merged, but the post-merge Deploy failed before Terraform apply: creating `uq_eval_results_run_test_case` found existing duplicate dev rows for `(run_id, test_case_id)`.
- 2026-05-16: Created fix-forward worktree `codex/evals-overhaul-u3-advisory-idempotency`. Removed the unique-index migration/deploy step and changed worker idempotency to use `pg_advisory_xact_lock(hashtext(runId), hashtext(testCaseId))` plus a transaction-local duplicate check before insert.
- 2026-05-16: Local U3 fix verification passed: API typecheck, database build, eval-runner/eval-worker/integration tests, eval-worker Lambda build, and `git diff --check`.
- 2026-05-16: Opened PR #1255 for the U3 deploy fix.
- 2026-05-16: PR #1255 required checks passed, was squash-merged to `main`, and post-merge Deploy passed.
- 2026-05-16: Removed meaningless dev eval run data at operator request: deleted 9 `eval_runs`, 488 cascading `eval_results`, and 0 eval-related `cost_events`; remaining dev counts are 0 eval runs, 0 eval results, and 0 eval cost events.
- 2026-05-16: Created clean U4 worktree from `origin/main`.
- 2026-05-16: Started U4 agent red-team starter pack with four new default-agent files and shape-invariant tests.
- 2026-05-16: Local U4 verification passed: seed shape-invariant test, API build, touched-file Prettier check, and `git diff --check`.
- 2026-05-16: Opened PR #1256 for U4.
- 2026-05-16: PR #1256 required checks passed: `cla`, `lint`, `test`, `typecheck`, and `verify`.
- 2026-05-16: Squash-merged PR #1256 to `main`, deleted the U4 branch/worktree, and confirmed post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U5 worktree from `origin/main`.
- 2026-05-16: Started U5 Computer red-team starter pack with four new default-Computer files and expanded shape-invariant tests.
- 2026-05-16: Local U5 verification passed: seed shape-invariant test, API build, touched-file Prettier check, and `git diff --check`.
- 2026-05-16: Opened PR #1258 for U5.
- 2026-05-16: PR #1258 required checks passed: `cla`, `lint`, `test`, `typecheck`, and `verify`.
- 2026-05-16: Squash-merged PR #1258 to `main`, deleted the U5 branch/worktree, and confirmed post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U6 worktree from `origin/main`.
- 2026-05-16: Started U6 skill red-team starter pack with GitHub, filesystem, and workspace seed files.
- 2026-05-16: Local U6 verification passed: seed shape-invariant test, API build, touched-file Prettier check, and `git diff --check`.
- 2026-05-16: Opened PR #1260 for U6.
- 2026-05-16: PR #1260 required checks passed: `cla`, `lint`, `test`, `typecheck`, and `verify`.
- 2026-05-16: Squash-merged PR #1260 to `main`, deleted the U6 branch/worktree, and confirmed post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U7 worktree from `origin/main`.
- 2026-05-16: Started U7 Performance v1 slice with agent, Computer, and skill seed files.
- 2026-05-16: Local U7 verification passed: seed shape-invariant test, API build, touched-file Prettier check, and `git diff --check`.
- 2026-05-16: Opened PR #1261 for U7.
- 2026-05-16: PR #1261 required checks passed: `cla`, `lint`, `test`, `typecheck`, and `verify`.
- 2026-05-16: Squash-merged PR #1261 to `main`, deleted the U7 branch/worktree, and confirmed post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U8 worktree from `origin/main`.
- 2026-05-16: Replaced the API seed import surface with the 14 new red-team/performance seed files, removed all 13 maniflow-era JSON files from the seed pack, and updated seed metadata to carry tags plus authored evaluator IDs.
- 2026-05-16: Added `0089_remove_maniflow_eval_seeds.sql`, wired it into the normal dev deploy workflow, added a marker view for drift probing, and documented customer-fork cleanup under docs deploy operations.
- 2026-05-16: Applied the U8 cleanup SQL to dev pre-merge. First apply deleted 96 legacy `yaml-seed` test cases and created `view_eval_seed_maniflow_cleanup_0089`; a deployed-old-code CLI seed probe briefly reinserted 100 legacy cases, then the cleanup was rerun and verified legacy seed count returned to 0.
- 2026-05-16: Local U8 verification passed: API seed tests, API build, Admin build, docs build, touched-file Prettier check, manual-migration dry-run marker check, and `git diff --check`.
- 2026-05-16: Opened PR #1263 for U8.
- 2026-05-16: PR #1263 required checks passed and was squash-merged to `main`; the local merge command printed a worktree checkout error after GitHub completed the merge, so PR state was verified directly.
- 2026-05-16: Confirmed post-merge `main` workflows including Deploy passed for U8, deleted the U8 branch/worktree, and synced from `origin/main`.
- 2026-05-16: Created clean U9 worktree from `origin/main`.
- 2026-05-16: Started U9 drill-in surface: extracting shared AgentCore span loading, adding the `evalResultSpans` GraphQL query, and extending the admin run-detail sheet with evaluator reasoning plus lazy trace loading.
- 2026-05-16: Local U9 verification passed: schema build, CLI/mobile codegen, API/admin/mobile tests, API/admin/CLI builds or typechecks, graphql-http/eval-worker Lambda bundles, non-generated touched-file Prettier check, and `git diff --check`. Admin codegen remains blocked by pre-existing configured-extension GraphQL documents that reference fields absent from the checked-in schema.
- 2026-05-16: PR #1266 required checks passed, was squash-merged to `main`, and post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U10 worktree from `origin/main`.
- 2026-05-16: Implemented eval schedule authoring on the shared scheduled-job dialog. The target picker supports both Computer templates and generic Agent templates, stores the selected template in schedule config, and the scheduled/manual-fire paths persist it as `eval_runs.agent_template_id`.
- 2026-05-16: Extended `/automations/schedules?type=eval_scheduled` filtering, row labeling, edit prefill, and the immediate Admin UI "Run Evaluation" dialog so both Computer templates and Agent templates can be evaluated.
- 2026-05-16: Local U10 verification passed: focused admin/API/Lambda tests, Admin/API/Lambda builds, `git diff --check`, and Prettier check for the newly formatted admin/Lambda files. Full touched-file Prettier check was skipped for pre-existing non-Prettier files (`scheduled-jobs.ts`, `scheduled-jobs.fire.test.ts`, and the schedule detail route) to avoid formatting-only churn.
- 2026-05-16: Opened PR #1267 for U10.
- 2026-05-16: PR #1267 required checks passed, was squash-merged to `main`, and post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U11 worktree from `origin/main`.
- 2026-05-16: Added manual migration `0093_eval_runs_scheduled_job_id.sql` with column, FK constraint, and index drift markers; applied it to dev and verified the column, FK, and index exist.
- 2026-05-16: Wired scheduled eval provenance into `job-trigger` and manual schedule fire, exposed `scheduledJobId` on `EvalRun`, regenerated CLI/mobile GraphQL types, and added the Admin Recent Runs schedule badge linking to the scheduled job detail.
- 2026-05-16: Local U11 verification passed: schema build, database/API/Lambda/Admin builds, focused Admin/API/Lambda tests, CLI typecheck, mobile tests, job-trigger Lambda bundle, dev manual-migration drift probe, and `git diff --check`. Admin codegen remains blocked by the same pre-existing configured-extension GraphQL documents noted in U9.
- 2026-05-16: Opened PR #1268 for U11.
- 2026-05-16: PR #1268 required checks passed, was squash-merged to `main`, and post-merge `main` workflows including Deploy passed.
- 2026-05-16: Created clean U12 worktree from `origin/main`.
- 2026-05-16: Updated CLI eval seed help text from the stale maniflow 96/9 copy to the current ThinkWork 210 test cases across 14 categories.
- 2026-05-16: Local U12 verification passed: CLI eval seed help output, CLI typecheck, CLI build, and `git diff --check`.
- 2026-05-16: Opened PR #1270 for U12.

## Pull Requests

| Unit   | Branch                                         | PR                                                           | CI      | Merge   | Notes                                                                                                                              |
| ------ | ---------------------------------------------- | ------------------------------------------------------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| U1     | `codex/evals-overhaul-u1-stall-probe`          | [#1252](https://github.com/thinkwork-ai/thinkwork/pull/1252) | passed  | merged  | Stall probe script + findings doc                                                                                                  |
| U2     | `codex/evals-overhaul-u2-sqs-substrate`        | [#1253](https://github.com/thinkwork-ai/thinkwork/pull/1253) | passed  | merged  | Inert SQS queue, DLQ, alarm, worker stub, IAM, build entry                                                                         |
| U3     | `codex/evals-overhaul-u3-worker-live`          | [#1254](https://github.com/thinkwork-ai/thinkwork/pull/1254) | passed  | merged  | Worker live body, dispatcher rewrite, run finalizer; post-merge deploy failed on duplicate historical rows blocking unique index   |
| U3 fix | `codex/evals-overhaul-u3-advisory-idempotency` | [#1255](https://github.com/thinkwork-ai/thinkwork/pull/1255) | passed  | merged  | Replace unique-index idempotency with advisory-lock idempotency to avoid destructive duplicate cleanup; post-merge Deploy passed   |
| U4     | `codex/evals-overhaul-u4-agents-redteam`       | [#1256](https://github.com/thinkwork-ai/thinkwork/pull/1256) | passed  | merged  | Default-agent red-team starter pack; post-merge Deploy passed                                                                      |
| U5     | `codex/evals-overhaul-u5-computer-redteam`     | [#1258](https://github.com/thinkwork-ai/thinkwork/pull/1258) | passed  | merged  | Default-Computer red-team starter pack; post-merge Deploy passed                                                                   |
| U6     | `codex/evals-overhaul-u6-skill-redteam`        | [#1260](https://github.com/thinkwork-ai/thinkwork/pull/1260) | passed  | merged  | Skill red-team starter pack for GitHub, filesystem, and workspace; post-merge Deploy passed                                        |
| U7     | `codex/evals-overhaul-u7-performance`          | [#1261](https://github.com/thinkwork-ai/thinkwork/pull/1261) | passed  | merged  | Performance v1 slice; post-merge Deploy passed                                                                                     |
| U8     | `codex/evals-overhaul-u8-seed-plumbing`        | [#1263](https://github.com/thinkwork-ai/thinkwork/pull/1263) | passed  | merged  | Seed import replacement, maniflow cleanup migration, deploy hook, docs, and post-merge Deploy passed                               |
| U9     | `codex/evals-overhaul-u9-drill-in`             | [#1266](https://github.com/thinkwork-ai/thinkwork/pull/1266) | passed  | merged  | Drill-in sheet evaluator reasoning and lazy AgentCore span trace; post-merge Deploy passed                                         |
| U10    | `codex/evals-overhaul-u10-schedules`           | [#1267](https://github.com/thinkwork-ai/thinkwork/pull/1267) | passed  | merged  | Eval schedule authoring, eval schedule filtering, and Agent/Computer template target selection; post-merge Deploy passed           |
| U11    | `codex/evals-overhaul-u11-provenance`          | [#1268](https://github.com/thinkwork-ai/thinkwork/pull/1268) | passed  | merged  | Scheduled eval provenance column, resolver field, job-trigger population, and Recent Runs schedule badge; post-merge Deploy passed |
| U12    | `codex/evals-overhaul-u12-cli-polish`          | [#1270](https://github.com/thinkwork-ai/thinkwork/pull/1270) | pending | pending | CLI eval seed help text reflects current seed corpus                                                                               |

## CI Failures

- 2026-05-16: Post-merge Deploy for U3 merge commit `77e3f9810328a54442f7aef150a96f739ec02f1b` failed in Terraform Apply step `Add eval_results run/test-case idempotency index (evals U3)`. `psql` could not create `uq_eval_results_run_test_case` because dev already has duplicate key `(run_id, test_case_id)=(bac89ee3-1876-4459-b49a-82d559a83976, 9a9eb780-ec0e-400f-8976-e90a741ff87b)`.

## Verification

- `pnpm exec tsx scripts/eval-stall-probe.ts --help` - passed.
- Live dev probe against stuck run `b945fc4d-c811-4c60-bec5-56e5bd2aabad` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/api test -- eval-runner.test.ts` - passed.
- `git diff --check` - passed.
- `pnpm format:check` - not run locally because this workspace does not install `prettier`.
- `pnpm --filter @thinkwork/api test -- eval-worker.test.ts eval-runner.test.ts` - passed.
- `bash scripts/build-lambdas.sh eval-worker` - passed.
- `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf terraform/modules/app/lambda-api/eval-fanout.tf` - passed.
- `terraform -chdir=terraform/modules/app/lambda-api validate` - passed.
- Focused no-refresh Terraform plan with `lambda_zips_dir` set to local `dist/lambdas` - passed for the intended U2 resources. The copied local greenfield tfvars still show unrelated DNS/Cognito drift, so this plan was used only for config/resource-shape validation and was not applied.
- `pnpm --filter @thinkwork/api test -- eval-runner.test.ts eval-worker.test.ts eval-worker-integration.test.ts` - passed.
- `pnpm --filter @thinkwork/api typecheck` - passed.
- `pnpm --filter @thinkwork/database-pg build` - passed.
- `bash scripts/build-lambdas.sh eval-runner && bash scripts/build-lambdas.sh eval-worker` - passed.
- `terraform fmt -check terraform/modules/app/lambda-api/eval-fanout.tf terraform/modules/app/lambda-api/handlers.tf` - passed.
- `terraform -chdir=terraform/modules/app/lambda-api validate` - passed after `terraform init -backend=false`.
- `pnpm --filter @thinkwork/api test -- eval-runner.test.ts eval-worker.test.ts eval-worker-integration.test.ts` - passed for U3 fix.
- `pnpm --filter @thinkwork/api typecheck` - passed for U3 fix.
- `pnpm --filter @thinkwork/database-pg build` - passed for U3 fix.
- `bash scripts/build-lambdas.sh eval-worker` - passed for U3 fix.
- Dev eval data cleanup verification query - passed; remaining eval run/result/cost-event counts are zero.
- `pnpm --filter @thinkwork/api test -- shape-invariants.test.ts` - passed for U4.
- `pnpm --filter @thinkwork/api build` - passed for U4.
- `node_modules/.pnpm/node_modules/.bin/prettier --check <U4 touched files>` - passed for U4.
- `git diff --check` - passed for U4.
- `pnpm --filter @thinkwork/api test -- shape-invariants.test.ts` - passed for U5.
- `pnpm --filter @thinkwork/api build` - passed for U5.
- `node_modules/.pnpm/node_modules/.bin/prettier --check <U5 touched files>` - passed for U5.
- `git diff --check` - passed for U5.
- `pnpm --filter @thinkwork/api test -- shape-invariants.test.ts` - passed for U6.
- `pnpm --filter @thinkwork/api build` - passed for U6.
- `node_modules/.pnpm/node_modules/.bin/prettier --check <U6 touched files>` - passed for U6.
- `git diff --check` - passed for U6.
- `pnpm --filter @thinkwork/api test -- shape-invariants.test.ts` - passed for U7.
- `pnpm --filter @thinkwork/api build` - passed for U7.
- `node_modules/.pnpm/node_modules/.bin/prettier --check <U7 touched files>` - passed for U7.
- `pnpm --filter @thinkwork/api test -- shape-invariants.test.ts eval-seeds.test.ts` - passed for U8.
- `pnpm --filter @thinkwork/api build` - passed for U8.
- `pnpm --filter @thinkwork/admin build` - passed for U8.
- `pnpm --filter @thinkwork/docs build` - passed for U8.
- U8 post-merge Deploy workflow - passed.
- `pnpm schema:build` - passed for U9.
- `pnpm --filter thinkwork-cli codegen` - passed for U9.
- `pnpm --filter @thinkwork/mobile codegen` - passed for U9.
- `pnpm --filter @thinkwork/admin codegen` - blocked for U9 by pre-existing external-extension documents (`SpendPeriod`, `currentQueue`, `dispatchState`, `workflowVersions`, `currentSpend`, `pauseDispatch`, `resumeDispatch`) not present in the checked-in GraphQL schema.
- `pnpm --filter @thinkwork/api test -- agentcore-spans.test.ts index.test.ts eval-worker.test.ts` - passed for U9.
- `pnpm --filter @thinkwork/admin exec vitest run src/routes/_authed/_tenant/evaluations/-result-detail.test.ts` - passed for U9.
- `pnpm --filter @thinkwork/api build` - passed for U9.
- `pnpm --filter @thinkwork/admin build` - passed for U9.
- `pnpm --filter thinkwork-cli build` - passed for U9.
- `pnpm --filter thinkwork-cli typecheck` - passed for U9.
- `bash scripts/build-lambdas.sh graphql-http && bash scripts/build-lambdas.sh eval-worker` - passed for U9.
- `pnpm --filter @thinkwork/api test` - passed for U9.
- `pnpm --filter @thinkwork/admin test` - passed for U9.
- `pnpm --filter @thinkwork/mobile test` - passed for U9.
- Non-generated touched-file Prettier check - passed for U9.
- `git diff --check` - passed for U9.
- `pnpm --filter @thinkwork/admin exec vitest run src/components/scheduled-jobs/ScheduledJobFormDialog.test.ts` - passed for U10.
- `pnpm --filter @thinkwork/api test -- scheduled-jobs.fire.test.ts` - passed for U10.
- `pnpm --filter @thinkwork/lambda test -- job-trigger.skill-run.test.ts` - passed for U10.
- `pnpm --filter @thinkwork/admin build` - passed for U10 with pre-existing Vite sourcemap/chunk warnings.
- `pnpm --filter @thinkwork/api build` - passed for U10.
- `pnpm --filter @thinkwork/lambda build` - passed for U10.
- Prettier check for newly formatted admin/Lambda files - passed for U10. Full touched-file check intentionally skipped for pre-existing non-Prettier files to avoid formatting-only churn.
- `git diff --check` - passed for U10.
- `pnpm schema:build` - passed for U11.
- `pnpm --filter @thinkwork/database-pg build` - passed for U11.
- `pnpm --filter thinkwork-cli codegen` - passed for U11.
- `pnpm --filter @thinkwork/mobile codegen` - passed for U11.
- `pnpm --filter @thinkwork/admin codegen` - blocked for U11 by pre-existing configured-extension documents (`SpendPeriod`, `currentQueue`, `dispatchState`, `workflowVersions`, `currentSpend`, `pauseDispatch`, `resumeDispatch`) not present in the checked-in GraphQL schema.
- Dev apply of `packages/database-pg/drizzle/0093_eval_runs_scheduled_job_id.sql` - passed for U11; verified column type `uuid`, FK `eval_runs_scheduled_job_id_scheduled_jobs_id_fk`, and index `idx_eval_runs_scheduled_job_id`.
- `DATABASE_URL="$DATABASE_URL" bash scripts/db-migrate-manual.sh | rg -A3 -B2 "0093_eval_runs_scheduled_job_id|idx_eval_runs_scheduled_job_id|scheduled_job_id"` - passed for U11 marker visibility.
- `pnpm --filter @thinkwork/admin exec vitest run src/routes/_authed/_tenant/evaluations/-result-detail.test.ts` - passed for U11.
- `pnpm --filter @thinkwork/api test -- index.test.ts scheduled-jobs.fire.test.ts` - passed for U11.
- `pnpm --filter @thinkwork/lambda test -- job-trigger.skill-run.test.ts` - passed for U11.
- `pnpm --filter @thinkwork/admin build` - passed for U11 with pre-existing Vite sourcemap/chunk warnings.
- `pnpm --filter @thinkwork/api build` - passed for U11.
- `pnpm --filter @thinkwork/lambda build` - passed for U11.
- `pnpm --filter thinkwork-cli typecheck` - passed for U11.
- `pnpm --filter @thinkwork/mobile test` - passed for U11.
- `bash scripts/build-lambdas.sh job-trigger` - passed for U11.
- Prettier check for newly formatted admin/Lambda files - passed for U11. Full touched-file check intentionally skipped for pre-existing non-Prettier files and SQL parser limits.
- `git diff --check` - passed for U11.
- `pnpm --filter thinkwork-cli exec tsx src/cli.ts eval seed --help` - passed for U12 and showed the current 210 test cases across 14 categories copy.
- `pnpm --filter thinkwork-cli typecheck` - passed for U12.
- `pnpm --filter thinkwork-cli build` - passed for U12.
- `git diff --check` - passed for U12.
- `git diff --check` - passed for U7.
- `pnpm --filter @thinkwork/api test -- shape-invariants.test.ts eval-seeds.test.ts` - passed for U8.
- `pnpm --filter @thinkwork/api build` - passed for U8.
- `pnpm --filter @thinkwork/admin build` - passed for U8 with pre-existing Vite sourcemap/chunk warnings.
- `pnpm --filter @thinkwork/docs build` - passed for U8 with pre-existing Starlight i18n/site warnings and npm config warnings from Pagefind.
- `node_modules/.pnpm/node_modules/.bin/prettier --check <U8 touched files>` - passed for U8.
- `bash scripts/db-migrate-manual.sh --dry-run | rg -A2 -B1 "0089_remove_maniflow_eval_seeds|view_eval_seed_maniflow_cleanup"` - passed for U8 marker visibility.
- Dev U8 cleanup SQL apply - passed; final legacy `yaml-seed` category count is 0 and marker view row count is 1.
- `git diff --check` - passed for U8.

## Blockers

None.
