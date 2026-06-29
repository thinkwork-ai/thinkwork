---
linear: THINK-103
title: Fix Hindsight memory retain timeouts and simplify user/Space memory write path
status: in-progress
started_at: 2026-06-28
target_branch: main
active_branch: codex/think-103-completion-audit
---

# THINK-103 Autopilot Status

## Context

- Linear issue: `THINK-103`
- Linear plan document: `Plan: Make memory retain and recall reliable`
- Repo plan: `docs/plans/2026-06-28-001-fix-memory-retain-recall-reliability-plan.md`
- Requirements: `docs/brainstorms/2026-06-28-think-103-memory-retain-recall-reliability-requirements.md`

## Implementation Units

- U1. Durable retain-attempt schema and canonical GraphQL type surface — merged via PR #3071
- U2. Route `memory-retain` through the ledger and retry worker — merged via PR #3075
- U3. High-confidence safe user and Space fact capture during retain — merged in follow-up THINK-103 PRs, including PR #3092
- U4. Space-aware retain envelope and direct memory-question preflight — completion-audit branch adds missing direct-question preflight and tests
- U5. Retain diagnostics through GraphQL and trace/activity evidence — present on `origin/main` with `memoryRetainAttempts` resolver
- U6. Memory page muted refresh action and retain status surface — completion-audit branch adds header refresh, diagnostics refetch, and retry/dead-letter strip
- U7. User and Space memory reliability regression coverage — completion-audit branch adds deployed retain/recall smoke script and runbook

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
- 2026-06-28: U2 merged through PR #3075 after rebasing onto `main`; CI passed `cla`, `lint`, `verify`, `typecheck`, and `test`. Cleaned the U2 worktree/local branch; remote branch was deleted by GitHub.
- 2026-06-28: Created isolated U3 worktree at `.Codex/worktrees/think-103-u3-safe-fact-capture` from updated `origin/main`.
- 2026-06-28: Local browser test on `localhost:5180` passed for the U3 worktree web shell: copied `apps/web/.env`, installed dependencies, started `@thinkwork/web` on port 5180, authenticated via SSO, and loaded `/memory/brain` with rendered Memory rows and no browser console warnings/errors. The muted refresh icon is not present yet because that is U6.
- 2026-06-28: U3 implementation in progress:
  - Added deterministic high-confidence fact extraction for Birdie-style user pet facts, Space codenames/project facts, and unsafe candidate rejection.
  - Wired `memory-retain` to write extracted facts as idempotent supplemental Hindsight markdown documents tied to the retain attempt.
  - Extended safety filters for approval-rule/tool-send instructions and added Hindsight source labeling for `thinkwork_high_confidence_fact`.
  - Focused tests currently pass for extractor, safety, and handler fact-write flows.
- 2026-06-28: Completion audit created isolated worktree at `.Codex/worktrees/think-103-completion-audit` from current `origin/main`.
- 2026-06-28: Audit found a real U4 gap: `packages/pi-extensions/src/memory.ts` supports `groundingQuery`, but Pi runtime loaded the memory extension without passing one, so direct questions such as "what's my dog's name?" still depended on the model choosing the recall tool.
- 2026-06-28: Completion-audit U4 patch added:
  - `packages/agentcore-pi/agent-container/src/runtime/memory-question.ts`
  - direct-memory-question detection for user and Space memory prompts
  - conditional `groundingQuery` wiring in `packages/agentcore-pi/agent-container/src/server.ts`
  - regression coverage proving direct memory questions issue Hindsight session-start recall while ordinary prompts do not
- 2026-06-28: Completion-audit U6 patch added:
  - `ComputerMemoryRetainAttemptsQuery` in `apps/web/src/lib/graphql-queries.ts`
  - Memory tab refresh controller that refetches memory records and retain diagnostics together
  - muted top-right header refresh icon in `SettingsMemoryHome`
  - compact retry/dead-letter diagnostics strip when retain attempts need attention
- 2026-06-28: Completion-audit U7 patch added:
  - `packages/api/src/__smoke__/memory-retain-recall-smoke.ts`
  - `pnpm --filter @thinkwork/api memory:retain-recall-smoke`
  - optional deploy workflow smoke step behind `workflow_dispatch` `run_smokes`
  - `docs/runbooks/memory-retain-recall.md`
- 2026-06-28: Completion-audit verification passed:
  - `pnpm --filter @thinkwork/agentcore-pi test -- agent-container/tests/memory-question.test.ts agent-container/tests/server.test.ts`
  - `pnpm --filter @thinkwork/agentcore-pi typecheck`
  - `pnpm --filter @thinkwork/web test -- src/components/settings/SettingsMemory.render.test.tsx`
  - `pnpm --filter @thinkwork/web typecheck`
