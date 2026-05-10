---
title: "Autopilot status: CopilotKit / AG-UI Computer foundation spike"
date: 2026-05-10
plan: docs/plans/2026-05-10-001-feat-copilotkit-agui-computer-spike-plan.md
status: active
---

# Autopilot status: CopilotKit / AG-UI Computer foundation spike

## Current Unit

- Unit: U7 — Verdict document and follow-up recommendation
- Branch: `codex/agui-spike-u7`
- Worktree: `.Codex/worktrees/agui-spike-u7`
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
- 2026-05-10: PR #1104 passed CI and was squash-merged to `main`.
- 2026-05-10: Removed U3 worktree/local branch and synced `main`.
- 2026-05-10: Created U4 worktree from `origin/main`.
- 2026-05-10: Started U4 registered Canvas component proof implementation.
- 2026-05-10: Implemented registered `lastmile_risk_canvas` rendering with zod prop validation and diagnostic fallbacks for unknown components or invalid props.
- 2026-05-10: Verified U4 with registry/component tests, route regression test, full `@thinkwork/computer` tests, typecheck, and Prettier.
- 2026-05-10: Opened PR #1105: https://github.com/thinkwork-ai/thinkwork/pull/1105.
- 2026-05-10: PR #1105 passed CI and was squash-merged to `main`.
- 2026-05-10: Removed U4 worktree/local branch and synced `main`.
- 2026-05-10: Created U5 worktree from `origin/main`.
- 2026-05-10: Started U5 real scenario smoke path implementation.
- 2026-05-10: Implemented deterministic `/agui/threads/<thread-id>?aguiSmoke=lastmile` smoke path and README verification notes for the LastMile prompt.
- 2026-05-10: Verified U5 with focused route/registry/component tests, full `@thinkwork/computer` tests, typecheck, and Prettier.
- 2026-05-10: Opened PR #1106: https://github.com/thinkwork-ai/thinkwork/pull/1106.
- 2026-05-10: PR #1106 passed CI and was squash-merged to `main`.
- 2026-05-10: Removed U5 worktree/local branch and synced `main`.
- 2026-05-10: Created U6 worktree from `origin/main`.
- 2026-05-10: Started U6 CopilotKit OSS package integration check.
- 2026-05-10: Started U6 dev server on http://127.0.0.1:5176/ for smoke inspection.
- 2026-05-10: Checked current CopilotKit/AG-UI package metadata for `@copilotkit/react-core@1.57.1`, `@copilotkit/react-ui@1.57.1`, and `@ag-ui/client@0.0.53`.
- 2026-05-10: Decided not to install CopilotKit React packages during the spike; added a local adapter and architecture note so the integration stays reversible.
- 2026-05-10: Verified U6 with focused adapter tests, full `@thinkwork/computer` tests, typecheck, and Prettier.
- 2026-05-10: Opened PR #1107: https://github.com/thinkwork-ai/thinkwork/pull/1107.
- 2026-05-10: PR #1107 passed CI and was squash-merged to `main`.
- 2026-05-10: Removed U6 worktree/local branch and synced `main`.
- 2026-05-10: Created U7 worktree from `origin/main`.
- 2026-05-10: Started U7 verdict document.
- 2026-05-10: Wrote U7 verdict recommending a pivot to a ThinkWork-owned AG-UI protocol layer while deferring CopilotKit React package adoption.
- 2026-05-10: Verified U7 with Prettier on the verdict and status docs.
- 2026-05-10: Opened PR #1108: https://github.com/thinkwork-ai/thinkwork/pull/1108.

## Unit Status

| Unit                                                     | Status  | Branch                | PR    | Notes                                  |
| -------------------------------------------------------- | ------- | --------------------- | ----- | -------------------------------------- |
| U1 — Local AG-UI event model and existing-stream adapter | Merged  | `codex/agui-spike-u1` | #1102 | CI passed; branch/worktree cleaned up. |
| U2 — Server helper for typed spike events                | Merged  | `codex/agui-spike-u2` | #1103 | CI passed; branch/worktree cleaned up. |
| U3 — Experimental Thread + Canvas route                  | Merged  | `codex/agui-spike-u3` | #1104 | CI passed; branch/worktree cleaned up. |
| U4 — Registered Canvas component proof                   | Merged  | `codex/agui-spike-u4` | #1105 | CI passed; branch/worktree cleaned up. |
| U5 — Real scenario smoke path                            | Merged  | `codex/agui-spike-u5` | #1106 | CI passed; branch/worktree cleaned up. |
| U6 — Optional OSS CopilotKit integration check           | Merged  | `codex/agui-spike-u6` | #1107 | CI passed; branch/worktree cleaned up. |
| U7 — Verdict document and follow-up recommendation       | PR open | `codex/agui-spike-u7` | #1108 | Awaiting CI.                           |

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
- 2026-05-10 U3 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed on PR #1104.
- 2026-05-10 U4: `pnpm --filter @thinkwork/computer test -- src/agui/component-registry.test.tsx src/components/computer-agui/LastMileRiskCanvas.test.tsx src/components/computer-agui/AguiThreadCanvasRoute.test.tsx` passed.
- 2026-05-10 U4: `pnpm --filter @thinkwork/computer typecheck` passed.
- 2026-05-10 U4: `pnpm --filter @thinkwork/computer test` passed: 217 tests passed.
- 2026-05-10 U4: `pnpm dlx prettier --check <touched files>` passed.
- 2026-05-10 U4 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed on PR #1105.
- 2026-05-10 U5: `pnpm --filter @thinkwork/computer test -- src/components/computer-agui/AguiThreadCanvasRoute.test.tsx src/agui/component-registry.test.tsx src/components/computer-agui/LastMileRiskCanvas.test.tsx` passed.
- 2026-05-10 U5: `pnpm --filter @thinkwork/computer typecheck` passed.
- 2026-05-10 U5: `pnpm --filter @thinkwork/computer test` passed: 218 tests passed.
- 2026-05-10 U5: `pnpm dlx prettier --check <touched files>` passed.
- 2026-05-10 U5 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed on PR #1106.
- 2026-05-10 U6: `pnpm --filter @thinkwork/computer test -- src/agui/copilotkit-adapter.test.ts` passed.
- 2026-05-10 U6: `pnpm --filter @thinkwork/computer typecheck` passed.
- 2026-05-10 U6: `pnpm --filter @thinkwork/computer test` passed: 220 tests passed.
- 2026-05-10 U6: `pnpm dlx prettier --check <touched files>` passed.
- 2026-05-10 U6 CI: `cla`, `lint`, `test`, `typecheck`, and `verify` passed on PR #1107.
- 2026-05-10 U7: `pnpm dlx prettier --check docs/solutions/architecture-patterns/copilotkit-agui-computer-spike-verdict-2026-05-10.md docs/plans/2026-05-10-001-feat-copilotkit-agui-computer-spike-autopilot-status.md` passed.

## Blockers

- None.
