---
title: Evals Overhaul Autopilot Status
date_started: 2026-05-16
plan: docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md
target_branch: main
status: active
---

# Evals Overhaul Autopilot Status

## Current Unit

- Unit: U6. Red-team library — skills (GitHub + file system + workspace)
- Branch: `codex/evals-overhaul-u6-skill-redteam`
- Worktree: `.Codex/worktrees/evals-overhaul-u6-skill-redteam`
- State: PR open, CI pending

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

## Pull Requests

| Unit   | Branch                                         | PR                                                           | CI      | Merge   | Notes                                                                                                                            |
| ------ | ---------------------------------------------- | ------------------------------------------------------------ | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| U1     | `codex/evals-overhaul-u1-stall-probe`          | [#1252](https://github.com/thinkwork-ai/thinkwork/pull/1252) | passed  | merged  | Stall probe script + findings doc                                                                                                |
| U2     | `codex/evals-overhaul-u2-sqs-substrate`        | [#1253](https://github.com/thinkwork-ai/thinkwork/pull/1253) | passed  | merged  | Inert SQS queue, DLQ, alarm, worker stub, IAM, build entry                                                                       |
| U3     | `codex/evals-overhaul-u3-worker-live`          | [#1254](https://github.com/thinkwork-ai/thinkwork/pull/1254) | passed  | merged  | Worker live body, dispatcher rewrite, run finalizer; post-merge deploy failed on duplicate historical rows blocking unique index |
| U3 fix | `codex/evals-overhaul-u3-advisory-idempotency` | [#1255](https://github.com/thinkwork-ai/thinkwork/pull/1255) | passed  | merged  | Replace unique-index idempotency with advisory-lock idempotency to avoid destructive duplicate cleanup; post-merge Deploy passed |
| U4     | `codex/evals-overhaul-u4-agents-redteam`       | [#1256](https://github.com/thinkwork-ai/thinkwork/pull/1256) | passed  | merged  | Default-agent red-team starter pack; post-merge Deploy passed                                                                    |
| U5     | `codex/evals-overhaul-u5-computer-redteam`     | [#1258](https://github.com/thinkwork-ai/thinkwork/pull/1258) | passed  | merged  | Default-Computer red-team starter pack; post-merge Deploy passed                                                                 |
| U6     | `codex/evals-overhaul-u6-skill-redteam`        | [#1260](https://github.com/thinkwork-ai/thinkwork/pull/1260) | pending | pending | Skill red-team starter pack for GitHub, filesystem, and workspace                                                                |

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

## Blockers

None.
