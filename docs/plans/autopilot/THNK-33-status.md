---
date: 2026-06-17
linear: THNK-33
status: active
---

# THNK-33 Twenty Server Contract Autopilot Status

## Current State

- Linear issue: THNK-33, moved to `In Progress` on 2026-06-17 after the
  server-contract-only implementation started.
- Implementation base: `origin/main`; active worktree branch:
  `codex/thnk-33-twenty-server-contract`.
- Current proof target: `server_contract_verified`.
- Explicitly blocked proof target: `native_producer_verified = false`.

## Context Read

- `AGENTS.md` repository workflow, including Linear automation worktree,
  planning/status artifact, PR, CI, merge, and cleanup requirements.
- Linear issue THNK-33, comments, and attached documents:
  - `U0 Verification: Twenty Embedded Application Proof Gate`
  - `Plan: Twenty Server Contract Verification`
  - `Requirements: Twenty-native ThinkWork operating surface`
  - `Twenty-native ThinkWork workflow options`
- Repo-local planning and requirements:
  - `docs/plans/2026-06-16-001-feat-thread-event-sources-plan.md`
  - `docs/plans/2026-06-16-001-feat-twenty-native-operating-surface-plan.md`
  - `docs/brainstorms/2026-06-16-thread-event-sources-requirements.md`
  - `docs/brainstorms/2026-06-16-twenty-native-operating-surface-requirements.md`
- Application Plugin context from the U0 result:
  - `packages/plugin-catalog/src/plugins/twenty/manifest.ts` does not exist on
    current `main`.
  - The desired Twenty embedded application/native producer is not installable
    by the current plugin engine yet.
  - Self-hosted Twenty logic-function/app packaging remains a future product
    proof, not part of this implementation slice.

## Scope Decision

Proceed with a server-contract-only implementation:

- Signed normalized Twenty task-event ingress.
- `twenty` linked-task provider support.
- Status-change and comment-event normalization.
- Tenant-scoped idempotent linked-task event append behavior.
- Append-and-wake behavior through existing linked-task wake paths.
- Durable diagnostics for authenticated deliveries, including unmatched task
  events, without raw-body logging.
- Smoke fixtures and deployed runbook for `server_contract_verified`.

Do not implement native Twenty app installation, plugin-catalog manifest work,
embedded component packaging, or Twenty logic-function deployment in this unit.

## Progress

| Unit                                               | Status              | Evidence                                                                                                                |
| -------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| U0 verification and plan pivot                     | Complete            | Linear docs updated before implementation; native producer marked blocked                                               |
| U1 linked-task provider/event contracts            | Implemented locally | Added `twenty` provider and `comment_added` event contract plus migration                                               |
| U2 signed task-event normalization and diagnostics | Implemented locally | Added timestamped HMAC, freshness checks, safe delivery diagnostics, Twenty fixtures                                    |
| U3 linked-task append/wake behavior                | Implemented locally | Twenty status/comment events resolve by linked task id, dedupe by provider event id, append compact messages, wake once |
| U4 deployed smoke/runbook                          | Implemented locally | Added runbook and smoke fixtures; live deployed smoke still pending environment execution                               |
| PR lint fix                                        | Complete            | Renamed platform migration/fixtures to provider-neutral paths; `pnpm lint` passes locally                               |
| Pull request                                       | Open                | PR #2612: https://github.com/thinkwork-ai/thinkwork/pull/2612                                                           |
| Native producer / embedded app package             | Blocked follow-up   | Not attempted in this server-contract-only slice                                                                        |

## Security Notes

- Timestamp freshness is required for task-event ingress using
  `x-thinkwork-timestamp`.
- HMAC verification signs `timestamp.rawBody`.
- Idempotency is scoped by tenant, provider, and external event id.
- Authenticated delivery diagnostics avoid raw-body logging and store only
  bounded safe fields such as body hash/size and normalized metadata.
- CRM/user text is treated as untrusted and rendered as compact bounded Thread
  message content, not raw provider payload.
- Diagnostics retention uses the existing `webhook_deliveries` retention model;
  this unit does not add a new retention surface.

## Verification Log

Rebased branch verification on 2026-06-17:

- `pnpm schema:build`
- `pnpm --filter @thinkwork/web codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/api test -- src/__tests__/webhook-shared.test.ts src/__tests__/webhook-task-event.test.ts src/lib/linked-tasks/sync-linked-task.test.ts`
- `pnpm --filter @thinkwork/database-pg test -- __tests__/linked-tasks-schema.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/database-pg typecheck`
- `pnpm --filter @thinkwork/web typecheck`
- `pnpm --filter @thinkwork/mobile typecheck` returned no matching package
  script.
- `pnpm --filter thinkwork-cli typecheck`
- `git diff --check`
- `bash -n scripts/smoke/webhook-smoke.sh`
- `bash scripts/build-lambdas.sh webhook-task-event`
- `pnpm --filter @thinkwork/api test` passed: 509 files, 4,890 tests; 3 files
  and 9 tests skipped.
- `pnpm lint` after CI plugin-source-boundary feedback.

## Pending Autopilot Steps

- Monitor PR #2612 CI.
- Fix any CI failures, then squash merge when green.
- Delete the branch/worktree after merge and sync `main`.
- Record PR/merge evidence here and in Linear.

## Current Recommendation

Go for the server-contract implementation. Do not claim native producer or
embedded application proof for THNK-33 until the plugin/component model can
install a Twenty-native producer package.
