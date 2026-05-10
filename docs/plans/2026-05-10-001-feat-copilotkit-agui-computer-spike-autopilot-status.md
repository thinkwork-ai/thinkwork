---
title: "Autopilot status: CopilotKit / AG-UI Computer foundation spike"
date: 2026-05-10
plan: docs/plans/2026-05-10-001-feat-copilotkit-agui-computer-spike-plan.md
status: active
---

# Autopilot status: CopilotKit / AG-UI Computer foundation spike

## Current Unit

- Unit: U3 — Experimental Thread + Canvas route
- Branch: `codex/agui-spike-u3`
- Worktree: `.Codex/worktrees/agui-spike-u3`
- Status: in progress

## Progress Log

- 2026-05-10: Created U1 worktree from `origin/main`.
- 2026-05-10: Copied origin brainstorm and implementation plan into U1 branch.
- 2026-05-10: Started U1 implementation.
- 2026-05-10: Implemented local AG-UI event model, chunk/event adapters, and hook tests.
- 2026-05-10: Verified U1 with focused tests, full `@thinkwork/computer` tests, and typecheck.
- 2026-05-10: Opened PR #1102: https://github.com/thinkwork-ai/thinkwork/pull/1102.
- 2026-05-10: PR #1102 passed CI and was squash-merged to `main`.
- 2026-05-10: Removed U1 worktree/local branch and synced `main`.
- 2026-05-10: Created U2 worktree from `origin/main`.
- 2026-05-10: Implemented U2 typed AG-UI event envelope helper and publisher tests.
- 2026-05-10: Verified U2 with focused API tests, full `@thinkwork/api` tests, typecheck, and Prettier.
- 2026-05-10: Opened PR #1103: https://github.com/thinkwork-ai/thinkwork/pull/1103.
- 2026-05-10: PR #1103 passed CI and was squash-merged to `main`.
- 2026-05-10: Removed U2 worktree/local branch and synced `main`.
- 2026-05-10: Created U3 worktree from `origin/main`.
- 2026-05-10: Started U3 experimental Thread + Canvas route implementation.
- 2026-05-10: Implemented `/agui/threads/$id` experimental route with transcript, run/tool timeline, Canvas placeholder, diagnostics, raw chunk subscription handling, and follow-up sending.
- 2026-05-10: Verified U3 with route tests, full `@thinkwork/computer` tests, typecheck, build, and Prettier.
- 2026-05-10: Opened PR #1104: https://github.com/thinkwork-ai/thinkwork/pull/1104.

## Unit Status

| Unit                                                     | Status  | Branch                | PR    | Notes                                                                                           |
| -------------------------------------------------------- | ------- | --------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| U1 — Local AG-UI event model and existing-stream adapter | Merged  | `codex/agui-spike-u1` | #1102 | CI passed; branch/worktree cleaned up.                                                          |
| U2 — Server helper for typed spike events                | Merged  | `codex/agui-spike-u2` | #1103 | CI passed; branch/worktree cleaned up.                                                          |
| U3 — Experimental Thread + Canvas route                  | PR open | `codex/agui-spike-u3` | #1104 | Awaiting CI.                                                                                    |
| U4 — Registered Canvas component proof                   | Pending |                       |       | Starts after U3 merges.                                                                         |
| U5 — Real scenario smoke path                            | Pending |                       |       | Starts after U4 merges.                                                                         |
| U6 — Optional OSS CopilotKit integration check           | Pending |                       |       | Starts after U5; may be skipped only if U5 verdict rejects package integration as out of scope. |
| U7 — Verdict document and follow-up recommendation       | Pending |                       |       | Final unit.                                                                                     |

## CI / Verification Log

- 2026-05-10 U1: `pnpm --filter @thinkwork/computer test -- src/agui/event-mapping.test.ts src/agui/use-agui-thread-stream.test.tsx` passed.
- 2026-05-10 U1: `pnpm --filter @thinkwork/computer typecheck` passed.
- 2026-05-10 U1: `pnpm --filter @thinkwork/computer test` passed.
- 2026-05-10 U1: `pnpm dlx prettier --check <touched files>` passed.
- 2026-05-10 U1 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed on PR #1102.
- 2026-05-10 U2: `pnpm --filter @thinkwork/api test -- src/graphql/agui-event.test.ts src/__tests__/computer-thread-chunk-publish.test.ts` passed.
- 2026-05-10 U2: `pnpm --filter @thinkwork/api typecheck` passed.
- 2026-05-10 U2: `pnpm --filter @thinkwork/api test` passed: 2,470 tests passed, 16 skipped.
- 2026-05-10 U2: `pnpm dlx prettier --check <touched files>` passed.
- 2026-05-10 U2 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed on PR #1103.
- 2026-05-10 U3: `pnpm --filter @thinkwork/computer test -- src/components/computer-agui/AguiThreadCanvasRoute.test.tsx` passed.
- 2026-05-10 U3: `pnpm --filter @thinkwork/computer typecheck` passed.
- 2026-05-10 U3: `pnpm --filter @thinkwork/computer build` passed.
- 2026-05-10 U3: `pnpm --filter @thinkwork/computer test` passed: 212 tests passed.
- 2026-05-10 U3: `pnpm dlx prettier --check <touched files>` passed.

## Blockers

- None.
