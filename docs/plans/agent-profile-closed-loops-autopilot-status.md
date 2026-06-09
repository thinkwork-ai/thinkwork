---
title: Agent Profile Closed Loops Autopilot Status
date: 2026-06-08
status: in_progress
---

# Agent Profile Closed Loops Autopilot Status

- Plan:
  `docs/plans/2026-06-08-001-feat-agent-profile-closed-loops-plan.md`.
- Target branch: `main`.
- Current unit: U5 - Persist Loop Evidence And Cost Totals.
- Current branch: `codex/agent-profile-closed-loops-u5`.
- Current worktree:
  `.Codex/worktrees/agent-profile-closed-loops-u5`.
- Status: local verification passed; preparing PR.

## Progress

- U1 normalized Agent Profile loop policy through API/runtime config and was
  squash merged in PR
  [#2237](https://github.com/thinkwork-ai/thinkwork/pull/2237) as
  `747190ee`.
- U2 added the ThinkWork-owned Pi goal-state compatibility contract and was
  squash merged in PR
  [#2238](https://github.com/thinkwork-ai/thinkwork/pull/2238) as
  `da455597`.
- U3 added specialist closed-loop prompts and structured handoff evidence and
  was squash merged in PR
  [#2240](https://github.com/thinkwork-ai/thinkwork/pull/2240) as
  `d3095eb`.
- U4 replaced special-case profile chains with parent-owned orchestration and
  was squash merged in PR
  [#2243](https://github.com/thinkwork-ai/thinkwork/pull/2243) as
  `3167652`.
- U5 preserves loop evidence in finalization, exposes loop evidence through
  observability trace rows, and aggregates parent plus profile/reviewer/retry
  token and cost totals into the turn usage summary.

## U5 Verification

- `pnpm --filter @thinkwork/api exec vitest run src/lib/chat-finalize/process-finalize.test.ts src/graphql/resolvers/observability/threadTraces.query.test.ts`
  passed: 2 files, 21 tests.
- `pnpm --filter @thinkwork/api test` passed before final formatting: 436
  files passed, 3 skipped; 3,716 tests passed, 9 skipped.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm --filter @thinkwork/web typecheck` passed.
- `pnpm --filter thinkwork-cli typecheck` passed.
- `pnpm dlx prettier@3.8.2 --check` over U5-touched files passed.
- `git diff --check` passed.

## Notes

- `pnpm install` completed, but local Node 25 logged the existing optional
  `canvas@2.11.2` native fallback build failure due to missing
  `pkg-config`/`pixman-1`. This did not affect focused tests or typechecks.
- U5 intentionally writes a dedicated status document so the active Kestra
  autopilot ledger in `docs/plans/autopilot-status.md` is not clobbered.
