---
title: "Evaluations autopilot status"
date: 2026-05-16
status: active
---

# Evaluations Autopilot Status

Plan: `docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md`

Target branch: `main`

## Current Unit

- **CLI eval run shortcut**
- Branch: `codex/evals-cli-default-run`
- Worktree: `.Codex/worktrees/evals-cli-default-run`
- Status: CI passed; ready to merge

## Progress Log

| Date | Unit | Branch | PR | Status | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-16 | RedTeam smoke | n/a | n/a | Completed | Admin UI run on Marco; DB confirmed `41` tests, `40` pass, `1` fail, `97.56%`, `$0.000000` evaluator cost | Verified cleaned `red-team-safety-scope` set runs end to end before full-corpus sweep. |
| 2026-05-16 | Live progress | `codex/evals-live-progress` | [#1293](https://github.com/thinkwork-ai/thinkwork/pull/1293) | Merged and deployed | `pnpm --filter @thinkwork/api exec vitest run src/handlers/eval-worker.test.ts src/handlers/eval-runner.test.ts src/handlers/eval-worker-integration.test.ts src/graphql/resolvers/evaluations/index.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `bash scripts/build-lambdas.sh eval-worker`; `pnpm --filter @thinkwork/api test`; GitHub CI; main deploy `25977222833` | Worker updates aggregate counters and emits subscription updates after every completed case; GraphQL read path overlays live counters from `eval_results` for running rows. |
| 2026-05-16 | Full RedTeam Admin UI run | n/a | n/a | Diagnostic only | Admin UI started run `523c63c9-f16b-41fe-a325-2e19ffd52578` on Marco for all enabled categories; DB showed live progress but also timeout/throttling errors | This run started before FIFO fan-out/retry deployment, so it is not used as final proof. |
| 2026-05-16 | Admin active-run polling fallback | `codex/evals-admin-live-poll` | [#1296](https://github.com/thinkwork-ai/thinkwork/pull/1296) | Merged and deployed | `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/admin test`; GitHub CI; main deploy `25977751627`; `git diff --check` | Adds a 3s network refetch fallback for the evaluations list while pending/running rows exist, so progress and pass rate update even if subscription events are missed. |
| 2026-05-16 | Eval substrate reliability | `codex/evals-admin-live-poll` | [#1296](https://github.com/thinkwork-ai/thinkwork/pull/1296) | Merged and deployed | `pnpm --filter @thinkwork/api exec vitest run src/handlers/eval-worker.test.ts src/handlers/eval-runner.test.ts src/handlers/eval-worker-integration.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `bash scripts/build-lambdas.sh eval-worker`; `bash scripts/build-lambdas.sh eval-runner`; `terraform fmt terraform/modules/app/lambda-api/eval-fanout.tf`; GitHub CI; main deploy `25977751627`; `git diff --check` | Converts eval fan-out to FIFO message grouping by selected Computer and treats timeouts/throttling as retryable infrastructure failures instead of scored eval errors. |
| 2026-05-16 | Clean post-fix Admin UI run | n/a | n/a | Running | Admin UI started run `4fbc6dd6-5276-4506-b227-f32962e6fcab` on Marco for all enabled categories; live table showed `2/189`, `100.0%`, `$0.0000`; DB showed `5/189`, `100.0%`, no timeout/throttling result rows | Proves the Admin table now updates running counts/pass rate before completion. Single-computer FIFO is reliable but intentionally slow; next optimization should shard evals across a target pool. |
| 2026-05-16 | CLI run shortcut | `codex/evals-cli-default-run` | [#1295](https://github.com/thinkwork-ai/thinkwork/pull/1295) | CI passed; ready to merge | `pnpm --filter thinkwork-cli exec vitest run __tests__/eval-registration.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm --filter thinkwork-cli build`; GitHub CI; `git diff --check` | Adds `thinkwork evals` as a direct interactive eval run shortcut while keeping `thinkwork eval run` as the explicit equivalent. |

## Blockers

- None.
