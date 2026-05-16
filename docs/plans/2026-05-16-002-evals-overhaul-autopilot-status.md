---
title: Evals Overhaul Autopilot Status
date_started: 2026-05-16
plan: docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md
target_branch: main
status: active
---

# Evals Overhaul Autopilot Status

## Current Unit

- Unit: U3. Worker live + dispatcher rewrite + run finalizer
- Branch: `codex/evals-overhaul-u3-worker-live`
- Worktree: `.Codex/worktrees/evals-overhaul-u3-worker-live`
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

## Pull Requests

| Unit | Branch | PR | CI | Merge | Notes |
| --- | --- | --- | --- | --- | --- |
| U1 | `codex/evals-overhaul-u1-stall-probe` | [#1252](https://github.com/thinkwork-ai/thinkwork/pull/1252) | passed | merged | Stall probe script + findings doc |
| U2 | `codex/evals-overhaul-u2-sqs-substrate` | [#1253](https://github.com/thinkwork-ai/thinkwork/pull/1253) | passed | merged | Inert SQS queue, DLQ, alarm, worker stub, IAM, build entry |
| U3 | `codex/evals-overhaul-u3-worker-live` | [#1254](https://github.com/thinkwork-ai/thinkwork/pull/1254) | pending | pending | Worker live body, dispatcher rewrite, run finalizer, idempotency index; locally verified |

## CI Failures

None yet.

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
- `bash scripts/db-migrate-manual.sh --dry-run` - sees `0089_eval_results_run_test_case_unique.sql` marker. The command exits nonzero because pre-existing files `0076_scheduled_jobs_marco_backfill.sql` and `0079_seed_tenant_customize_catalog.sql` have no markers.

## Blockers

None.
