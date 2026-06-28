---
linear: THINK-103
title: Fix Hindsight memory retain timeouts and simplify user/Space memory write path
status: in-progress
started_at: 2026-06-28
target_branch: main
active_branch: codex/think-103-u2-retain-worker
---

# THINK-103 Autopilot Status

## Context

- Linear issue: `THINK-103`
- Linear plan document: `Plan: Make memory retain and recall reliable`
- Repo plan: `docs/plans/2026-06-28-001-fix-memory-retain-recall-reliability-plan.md`
- Requirements: `docs/brainstorms/2026-06-28-think-103-memory-retain-recall-reliability-requirements.md`

## Implementation Units

- U1. Durable retain-attempt schema and canonical GraphQL type surface — merged via PR #3071
- U2. Route `memory-retain` through the ledger and retry worker — in progress on `codex/think-103-u2-retain-worker`
- U3. High-confidence safe user and Space fact capture during retain
- U4. Space-aware retain envelope and direct memory-question preflight
- U5. Retain diagnostics through GraphQL and trace/activity evidence
- U6. Memory page muted refresh action and retain status surface
- U7. User and Space memory reliability regression coverage

## Progress Log

- 2026-06-28: Created isolated worktree at `.Codex/worktrees/think-103-u1-retain-ledger` from `origin/main`.
- 2026-06-28: Moved Linear issue `THINK-103` from Plan Review to In Progress when implementation began.
- 2026-06-28: Started U1, adding `memory_retain_attempts` schema, migration, GraphQL diagnostic type, and schema coverage.
- 2026-06-28: U1 verification passed:
  - `pnpm --filter @thinkwork/database-pg test -- memory-retain-attempts-schema.test.ts`
  - `pnpm --filter @thinkwork/database-pg test`
  - `pnpm --filter @thinkwork/database-pg typecheck`
  - `pnpm schema:build`
  - `pnpm --dir apps/cli codegen`
  - `pnpm --filter @thinkwork/web codegen`
  - `pnpm --filter @thinkwork/mobile codegen`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm --filter @thinkwork/web typecheck`
- 2026-06-28: `@thinkwork/api` has no `codegen` script in this checkout; `@thinkwork/mobile` has no `typecheck` script. Root `format` references `prettier`, but the root package does not declare it, so touched files were formatted with one-off `pnpm dlx prettier@3.6.2`.
- 2026-06-28: U1 merged through PR #3071 (`5e7a9042b94ee3e4f6279c1c7c441574ebc82735`). Applied `0194_memory_retain_attempts.sql` to dev to satisfy the manual migration drift gate, reran CI, merged, and cleaned the U1 worktree/local branch.
- 2026-06-28: Created isolated U2 worktree at `.Codex/worktrees/think-103-u2-retain-worker` from updated `origin/main`.
- 2026-06-28: U2 implementation added:
  - `packages/api/src/lib/memory/retain-attempts.ts` for source-event keys, classification, retry backoff, upsert/claim/list/mark helpers.
  - `memory-retain` handler enqueue/claim/process flow plus `kind: "drain_due"` retry drain.
  - structured `HindsightRetainError` for retain writes.
  - EventBridge Scheduler `memory_retain_retry_drainer` with Lambda async retry still disabled.
- 2026-06-28: U2 verification passed:
  - `pnpm --filter @thinkwork/api test -- src/lib/memory/retain-attempts.test.ts src/handlers/memory-retain.test.ts src/lib/memory/adapters/hindsight-adapter.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `bash scripts/build-lambdas.sh memory-retain`
  - `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf`
