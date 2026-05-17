---
title: "Evaluations autopilot status"
date: 2026-05-16
status: active
---

# Evaluations Autopilot Status

Plan: `docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md`

Target branch: `main`

## Current Unit

- **Admin active-run polling fallback + eval substrate reliability**
- Branch: `codex/evals-admin-live-poll`
- Worktree: `.Codex/worktrees/evals-admin-live-poll`
- Status: local verification complete

## Progress Log

| Date | Unit | Branch | PR | Status | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-16 | RedTeam smoke | n/a | n/a | Completed | Admin UI run on Marco; DB confirmed `41` tests, `40` pass, `1` fail, `97.56%`, `$0.000000` evaluator cost | Verified cleaned `red-team-safety-scope` set runs end to end before full-corpus sweep. |
| 2026-05-16 | Live progress | `codex/evals-live-progress` | [#1293](https://github.com/thinkwork-ai/thinkwork/pull/1293) | Merged and deployed | `pnpm --filter @thinkwork/api exec vitest run src/handlers/eval-worker.test.ts src/handlers/eval-runner.test.ts src/handlers/eval-worker-integration.test.ts src/graphql/resolvers/evaluations/index.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `bash scripts/build-lambdas.sh eval-worker`; `pnpm --filter @thinkwork/api test`; GitHub CI; main deploy `25977222833` | Worker updates aggregate counters and emits subscription updates after every completed case; GraphQL read path overlays live counters from `eval_results` for running rows. |
| 2026-05-16 | Full RedTeam Admin UI run | n/a | n/a | Running | Admin UI started run `523c63c9-f16b-41fe-a325-2e19ffd52578` on Marco for all enabled categories; DB currently shows live progress | The list page missed subscription updates, so the next unit adds polling fallback while active runs exist. |
| 2026-05-16 | Admin active-run polling fallback | `codex/evals-admin-live-poll` | [#1296](https://github.com/thinkwork-ai/thinkwork/pull/1296) | Local verification complete | `pnpm --filter @thinkwork/admin build`; `pnpm --filter @thinkwork/admin test`; `git diff --check` | Adds a 3s network refetch fallback for the evaluations list while pending/running rows exist, so progress and pass rate update even if subscription events are missed. |
| 2026-05-16 | Eval substrate reliability | `codex/evals-admin-live-poll` | [#1296](https://github.com/thinkwork-ai/thinkwork/pull/1296) | Local verification complete | `pnpm --filter @thinkwork/api exec vitest run src/handlers/eval-worker.test.ts src/handlers/eval-runner.test.ts src/handlers/eval-worker-integration.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `bash scripts/build-lambdas.sh eval-worker`; `bash scripts/build-lambdas.sh eval-runner`; `terraform fmt terraform/modules/app/lambda-api/eval-fanout.tf`; `git diff --check` | Converts eval fan-out to FIFO message grouping by selected Computer and treats timeouts/throttling as retryable infrastructure failures instead of scored eval errors. |

## Blockers

- None.
