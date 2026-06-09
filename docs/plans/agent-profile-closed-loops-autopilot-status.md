---
title: Agent Profile Closed Loops Autopilot Status
date: 2026-06-08
status: in_progress
---

# Agent Profile Closed Loops Autopilot Status

- Plan:
  `docs/plans/2026-06-08-001-feat-agent-profile-closed-loops-plan.md`.
- Target branch: `main`.
- Current unit: U8 - Update Verification And Institutional Docs.
- Current branch: `codex/agent-profile-closed-loops-u8`.
- Current worktree:
  `.Codex/worktrees/agent-profile-closed-loops-u8`.
- Status: implementation in progress.

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
  token and cost totals into the turn usage summary. It was squash merged in PR
  [#2247](https://github.com/thinkwork-ai/thinkwork/pull/2247) as
  `2c3e8e7`.
- U6 renders closed-loop evidence in Activity, Thread Detail, and the Thread
  conversation so sequential delegate/profile paths show as
  parent -> delegate -> specialist lane -> delegate -> reviewer lane -> parent
  return, while retry runs remain distinct even when they reuse the same
  profile slug. It was squash merged in PR
  [#2253](https://github.com/thinkwork-ai/thinkwork/pull/2253) as
  `391b174`.
- U7 adds operator-facing Loop / Review controls to Settings -> Agents profile
  detail, writing the authored policy into `executionControls.loopPolicy`. It
  was squash merged in PR
  [#2257](https://github.com/thinkwork-ai/thinkwork/pull/2257) as
  `56497e6`.
- U8 updates the closed-loop verification runbook and institutional solution
  notes so Research -> Reviewer -> parent-answer behavior can be validated
  before releases.

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

## U6 Verification

- `pnpm install` completed sufficiently to link workspace tools. Local Node 25
  logged the existing optional `canvas@2.11.2` native fallback build failure due
  to missing `pkg-config`/`pixman-1`; pnpm exited successfully and focused web
  tests/typecheck were unaffected.
- `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsActivityThreadDetail.test.tsx src/components/workbench/TaskThreadView.test.tsx src/components/workbench/InlineShortcutText.test.tsx`
  passed: 3 files, 105 tests.
- `pnpm --filter @thinkwork/web typecheck` passed.
- `pnpm dlx prettier@3.6.2 --write` was run on U6-touched files.
- `git diff --check` passed.

## U7 Verification

- `pnpm install` completed sufficiently to link workspace tools. Local Node 25
  logged the existing optional `canvas@2.11.2` native fallback build failure due
  to missing `pkg-config`/`pixman-1`; pnpm exited successfully and focused web
  tests/typecheck were unaffected.
- `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsAgents.test.tsx`
  passed: 1 file, 7 tests.
- `pnpm --filter @thinkwork/web typecheck` passed.
- `pnpm dlx prettier@3.6.2 --write` was run on U7-touched files.
- `git diff --check` passed.
- Local browser validation on `http://localhost:5174` passed after copying
  `apps/web/.env.old` into the U7 worktree `apps/web/.env`: Settings -> Agents
  rendered Research/Coding/Analyst/Reviewer profile rows; Reviewer detail
  rendered the Loop / Review section with Closed mode, max iterations 1, review
  gate defaults, External reviewer `Never`, max review loops 2, and failure
  behavior `Return blocker`.

## U8 Verification

- `pnpm dlx prettier@3.6.2 --write` was run on U8-touched Markdown files.
- `rg -n "/agent\\s"` returned no matches in U8-touched verification and
  solution docs, confirming the runbook no longer points at the old slash-agent
  shortcut.
- `git diff --check` passed.
