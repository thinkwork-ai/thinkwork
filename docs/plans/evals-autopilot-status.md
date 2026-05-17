---
title: "Evaluations autopilot status"
date: 2026-05-16
status: active
---

# Evaluations Autopilot Status

Plan: `docs/plans/2026-05-16-002-feat-evals-overhaul-redteam-library-and-substrate-fix-plan.md`

Target branch: `main`

## Current Unit

- **Live running progress for eval runs**
- Branch: `codex/evals-live-progress`
- Worktree: `.Codex/worktrees/evals-live-progress`
- Status: local verification in progress

## Progress Log

| Date | Unit | Branch | PR | Status | Verification | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-16 | RedTeam smoke | n/a | n/a | Completed | Admin UI run on Marco; DB confirmed `41` tests, `40` pass, `1` fail, `97.56%`, `$0.000000` evaluator cost | Verified cleaned `red-team-safety-scope` set runs end to end before full-corpus sweep. |
| 2026-05-16 | Live progress | `codex/evals-live-progress` | pending | Local verification complete | `pnpm --filter @thinkwork/api exec vitest run src/handlers/eval-worker.test.ts src/handlers/eval-runner.test.ts src/handlers/eval-worker-integration.test.ts src/graphql/resolvers/evaluations/index.test.ts`; `pnpm --filter @thinkwork/api typecheck`; `bash scripts/build-lambdas.sh eval-worker`; `pnpm --filter @thinkwork/api test`; `git diff --check` | Worker now updates aggregate counters and emits subscription updates after every completed case; GraphQL read path overlays live counters from `eval_results` for running rows. |

## Blockers

- None.
