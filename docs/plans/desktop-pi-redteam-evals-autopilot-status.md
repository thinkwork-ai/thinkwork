# Desktop Pi Redteam Evals Autopilot Status

Plan: `docs/plans/2026-06-01-004-feat-desktop-pi-redteam-evals-plan.md`

## Current Unit

- Unit: U1 Shared eval scoring core
- Branch: `codex/desktop-pi-evals-u1-scoring`
- Worktree: `.Codex/worktrees/desktop-pi-evals-u1-scoring`
- Started: 2026-06-01
- Status: in progress

## Progress Log

- 2026-06-01: Created U1 worktree from `origin/main`.
- 2026-06-01: Added shared `@thinkwork/evals-core` package for assertion scoring, rubric heuristics, echoed forbidden phrase softening, and outcome scoring.
- 2026-06-01: Refactored `eval-worker` to consume shared scoring while keeping AgentCore invocation, LLM judge wiring, and evaluator cost accounting in `@thinkwork/api`.
- 2026-06-01: Local verification passed for U1:
  `pnpm --filter @thinkwork/evals-core test`,
  `pnpm --filter @thinkwork/api test -- src/handlers/eval-worker.test.ts src/handlers/eval-worker-integration.test.ts`,
  `pnpm --filter @thinkwork/evals-core typecheck`,
  `pnpm --filter @thinkwork/api typecheck`,
  `pnpm --filter @thinkwork/evals-core build`,
  `pnpm --filter @thinkwork/api build`, and `git diff --check`.
- 2026-06-01: `pnpm install` completed and updated `pnpm-lock.yaml`; optional native packages `node-liblzma` and `canvas` reported local Node 25/pkg-config build noise, but pnpm completed successfully.
- 2026-06-01: Opened PR #1961 for U1.
- 2026-06-01: PR #1961 checks passed (`cla`, `lint`, `test`, `typecheck`, `verify`) and was squash-merged.
- 2026-06-01: Created U2 worktree from merged `origin/main`.
- 2026-06-01: Added Desktop Pi eval run REST preparation/callback handler, run provenance fields, selected test-case persistence, GraphQL/schema updates, and Lambda/API Gateway wiring.
- 2026-06-01: Local verification passed for U2:
  `pnpm --filter @thinkwork/api test -- src/handlers/desktop-eval-runs.test.ts src/handlers/eval-runner.test.ts src/graphql/resolvers/evaluations/index.test.ts src/handlers/eval-runs-reconciler.test.ts`,
  `pnpm --filter @thinkwork/api typecheck`,
  `pnpm schema:build`,
  `pnpm --filter @thinkwork/spaces codegen`,
  `pnpm --filter @thinkwork/mobile codegen`,
  `pnpm --filter thinkwork-cli codegen`,
  `bash scripts/build-lambdas.sh desktop-eval-runs`,
  `pnpm --filter thinkwork-cli typecheck`,
  `pnpm --filter @thinkwork/spaces typecheck`,
  `pnpm --filter @thinkwork/database-pg typecheck`,
  `terraform fmt terraform/modules/app/lambda-api/handlers.tf`, and
  `git diff --check`.
- 2026-06-01: Opened PR #1962 for U2.

## Pull Requests

| Unit | Branch | PR | Status | Notes |
| --- | --- | --- | --- | --- |
| U1 | `codex/desktop-pi-evals-u1-scoring` | [#1961](https://github.com/thinkwork-ai/thinkwork/pull/1961) | merged | Checks passed; squash-merged. |
| U2 | `codex/desktop-pi-evals-u2-api` | [#1962](https://github.com/thinkwork-ai/thinkwork/pull/1962) | open | Waiting for CI. |

## CI Failures

None yet.

## Blockers

None.
