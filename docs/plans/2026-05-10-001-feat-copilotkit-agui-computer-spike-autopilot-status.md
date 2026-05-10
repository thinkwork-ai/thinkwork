---
title: "Autopilot status: CopilotKit / AG-UI Computer foundation spike"
date: 2026-05-10
plan: docs/plans/2026-05-10-001-feat-copilotkit-agui-computer-spike-plan.md
status: active
---

# Autopilot status: CopilotKit / AG-UI Computer foundation spike

## Current Unit

- Unit: U1 — Local AG-UI event model and existing-stream adapter
- Branch: `codex/agui-spike-u1`
- Worktree: `.Codex/worktrees/agui-spike-u1`
- Status: PR open

## Progress Log

- 2026-05-10: Created U1 worktree from `origin/main`.
- 2026-05-10: Copied origin brainstorm and implementation plan into U1 branch.
- 2026-05-10: Started U1 implementation.
- 2026-05-10: Implemented local AG-UI event model, chunk/event adapters, and hook tests.
- 2026-05-10: Verified U1 with focused tests, full `@thinkwork/computer` tests, and typecheck.
- 2026-05-10: Opened PR #1102: https://github.com/thinkwork-ai/thinkwork/pull/1102.

## Unit Status

| Unit                                                     | Status  | Branch                | PR    | Notes                                                                                           |
| -------------------------------------------------------- | ------- | --------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| U1 — Local AG-UI event model and existing-stream adapter | PR open | `codex/agui-spike-u1` | #1102 | Awaiting CI.                                                                                    |
| U2 — Server helper for typed spike events                | Pending |                       |       | Starts after U1 merges.                                                                         |
| U3 — Experimental Thread + Canvas route                  | Pending |                       |       | Starts after U2 merges.                                                                         |
| U4 — Registered Canvas component proof                   | Pending |                       |       | Starts after U3 merges.                                                                         |
| U5 — Real scenario smoke path                            | Pending |                       |       | Starts after U4 merges.                                                                         |
| U6 — Optional OSS CopilotKit integration check           | Pending |                       |       | Starts after U5; may be skipped only if U5 verdict rejects package integration as out of scope. |
| U7 — Verdict document and follow-up recommendation       | Pending |                       |       | Final unit.                                                                                     |

## CI / Verification Log

- 2026-05-10 U1: `pnpm --filter @thinkwork/computer test -- src/agui/event-mapping.test.ts src/agui/use-agui-thread-stream.test.tsx` passed.
- 2026-05-10 U1: `pnpm --filter @thinkwork/computer typecheck` passed.
- 2026-05-10 U1: `pnpm --filter @thinkwork/computer test` passed.
- 2026-05-10 U1: `pnpm dlx prettier --check <touched files>` passed.

## Blockers

- None.
