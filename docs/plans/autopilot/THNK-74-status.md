---
title: "THNK-74 Autopilot Status"
date: 2026-06-25
issue: THNK-74
status: active
plan: docs/plans/2026-06-25-003-feat-trace-cost-substrate-plan.md
requirements: docs/brainstorms/2026-06-25-trusted-trace-cost-accounting-substrate-requirements.md
---

# THNK-74 Autopilot Status

## Issue

- Linear: https://linear.app/thinkworkai/issue/THNK-74/trusted-trace-and-cost-accounting-substrate
- Goal: build a trusted trace and cost accounting substrate so thread history,
  Activity, analytics, budgets, eval snapshots, CLI trace commands, and audit
  surfaces are projections from canonical execution and accounting evidence.
- Target branch: `main`.

## Context Discovery

- Read `AGENTS.md`.
- Read the THNK-74 autopilot request attachment.
- Read Linear issue THNK-74, including description, project, labels, documents,
  comments, status history, and relations.
- Read Linear documents attached to THNK-74:
  - `Requirements Summary: Trusted Trace and Cost Accounting Substrate`
  - `Plan: Build trusted trace and cost accounting substrate`
- Read related Linear issues:
  - THNK-13 Token Monitoring
  - THNK-60 Account Usage
  - THNK-75 Explore trace/eval workbench for production traces
- Read THNK-60's attached plan and comments as downstream usage/analytics
  context. THNK-60 is completed and not an implementation unit for THNK-74.
- Confirmed THNK-74 has no file attachments, no child issues, no blockers, and
  no customer needs or releases.
- Confirmed THNK-75 is intentionally separate follow-up workbench exploration,
  not part of the trusted accounting source-of-truth implementation.
- Searched the repo for THNK-74, the issue title, and referenced filenames.
- Read repo-local source artifacts:
  - `docs/brainstorms/2026-06-25-trusted-trace-cost-accounting-substrate-requirements.md`
  - `docs/plans/2026-06-25-003-feat-trace-cost-substrate-plan.md`
- Read relevant institutional docs surfaced by the plan:
  - `docs/solutions/runtime-errors/wakeup-turns-zero-token-usage-extractusage-2026-06-11.md`
  - `docs/plans/2026-06-06-005-fix-tool-tracking-fallback-cost-plan.md`
  - `docs/src/content/docs/concepts/control/budgets-usage-and-audit.mdx`
  - `docs/src/content/docs/applications/admin/analytics.mdx`
- Read the Compound Engineering `ce-work` and `lfg` workflow guidance. This
  run uses the THNK-74 plan as the implementation authority and records all
  state changes here.

## Implementation Units

1. U1: Define canonical trace and accounting schema.
2. U2: Ingest runtime and finalize evidence into the ledger.
3. U3: Reconcile Bedrock invocations per invocation.
4. U4: Reconcile aggregate spend against AWS billing exports.
5. U5: Make budgets and cost APIs confidence-aware.
6. U6: Move trace detail GraphQL, web, and CLI projections onto the substrate.
7. U7: Snapshot trace evidence for evals and roll out safely.

Dependency order from the plan:

- U1 is first and enables U2, U3, and U4.
- U2 enables U3, U6, and U7.
- U3 and U4 enable U5.
- U5 plus U2/U3 enables U6.
- U7 depends on U1, U2, and U6, and benefits from U3-U5.

## Linear State Changes

- 2026-06-25 08:17 CT: moved THNK-74 from `Plan Review` to `In Progress`,
  assigned it to Eric Odom, and added an implementation-start comment after
  context discovery completed.

## Unit Log

### U1: Define Canonical Trace And Accounting Schema

Objective: create the durable trace/accounting schema and TypeScript domain
layer for trace identity, parent/child trace evidence, source-evidence
references, reconciliation facts, and cost confidence states while keeping
existing `cost_events` consumers compatible during migration.

Planned branch/worktree:

- Branch: `codex/thnk-74-u1-trace-accounting-schema`
- Worktree: `.Codex/worktrees/thnk-74-u1-trace-accounting-schema`
- Base: `origin/main` at `09d199cc6`.

Planned local verification:

- Focused database/API tests for reconciliation-state lifecycle and schema
  helpers.
- Existing cost-event and observability tests affected by GraphQL/schema changes.
- GraphQL schema/codegen steps required by `AGENTS.md` if canonical GraphQL
  types change.
- Package typechecks for touched packages.

Implementation status:

- Created branch `codex/thnk-74-u1-trace-accounting-schema` from `origin/main`
  at `09d199cc6`.
- Ran `pnpm install`; it exited successfully, but dependency install logged a
  non-fatal `canvas` native build warning because `pkg-config` was unavailable
  under local Node 25.6.0.
- Added `trace_runs`, `trace_events`, `trace_source_evidence`, and
  `trace_cost_reconciliation_facts` schema tables.
- Added additive `cost_events` compatibility columns for trace linkage,
  reconciliation state/source/timestamp, and source-evidence references.
- Added migration `packages/database-pg/drizzle/0189_trace_cost_substrate.sql`
  with manual-migration `-- creates` markers for drift reporting.
- Added GraphQL vocabulary for source evidence and reconciliation facts, plus
  nullable projection fields on `TraceEvent` and `CostEvent`.
- Added small API domain helpers for reconciliation state validation and
  evidence-backed provider/billing transitions.
- Regenerated CLI/mobile GraphQL type surfaces, then manually kept web/CLI/mobile
  generated diffs minimal to avoid formatter-only churn.

Local verification:

- `pnpm --filter @thinkwork/database-pg test -- __tests__/schema-trace-ledger.test.ts`
  passed.
- `pnpm --filter @thinkwork/api test -- src/lib/trace-ledger/reconciliation-state.test.ts`
  passed.
- `pnpm --filter @thinkwork/database-pg typecheck` passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm --filter thinkwork-cli typecheck` passed.
- `pnpm --filter @thinkwork/web typecheck` passed.
- `pnpm --filter @thinkwork/mobile typecheck` reported that the mobile package
  does not define a `typecheck` script.
- `pnpm dlx prettier@3.6.2 --check` on authored TS/GraphQL/Markdown files
  passed.
- `git diff --check` passed.

PR / merge:

- PR: https://github.com/thinkwork-ai/thinkwork/pull/2955
- Merge commit: `5d50ab85ee0862a5473e2ea62b49eefc2ba06f77`
- Dev migration `0189_trace_cost_substrate.sql` was applied and drift-verified.

### U2: Ingest Runtime And Finalize Evidence Into The Ledger

Objective: dual-write runtime/finalize evidence into the canonical trace ledger
while preserving existing `thread_turns.usage_json` and `cost_events`
projections.

Planned branch/worktree:

- Branch: `codex/thnk-74-u2-runtime-ledger-ingest`
- Worktree: `.Codex/worktrees/thnk-74-u2-runtime-ledger-ingest`
- Base: `origin/main` at `ee5617b44` (includes U1 merge plus PR #2956).

Planned local verification:

- `pnpm --filter @thinkwork/api exec vitest run src/lib/trace-ledger/record-trace-evidence.test.ts`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/chat-finalize/process-finalize.test.ts`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/cost-recording.extract-usage.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `git diff --check`

Implementation status:

- 2026-06-25 08:57 CDT: cleaned stale aborted U2 worktree and reset duplicate
  U1 scratch changes from `/Users/ericodom/.codex/worktrees/536d/thinkwork`.
- 2026-06-25 08:57 CDT: created fresh U2 branch/worktree from `origin/main`.
- Added `packages/api/src/lib/trace-ledger/record-trace-evidence.ts` with a
  pure trace event-plan builder plus a best-effort DB writer that:
  - upserts one `trace_runs` row for the turn;
  - appends root turn, parent model, runtime compute/phase, workspace
    reconcile, tool, model-routed tool, agent profile, and finalization events;
  - appends runtime source-evidence rows;
  - links matching `cost_events` rows to trace events as `runtime-reported`;
  - appends runtime-scope `trace_cost_reconciliation_facts` for linked cost
    rows.
- Wired `processFinalize` to call the trace-ledger writer after existing
  `usage_json` and cost projections are computed. The write is best-effort:
  failures log a `trace_ledger_write_failed` thread-turn event and do not block
  assistant-message insertion, turn finalization, or existing cost/thread
  projections.
- Added failed-turn trace ledger ingestion with failed status, error summary,
  workspace reconcile diagnostics, and zero/available runtime usage evidence.
- Added runtime source evidence metadata to new `cost_events` rows while keeping
  their existing projection shape and reconciliation state at
  `runtime-reported`.

Local verification:

- `pnpm install` passed; local `canvas` native build still logs a non-fatal
  missing `pkg-config` warning under Node 25.6.0.
- `pnpm --filter @thinkwork/api exec vitest run src/lib/trace-ledger/record-trace-evidence.test.ts src/lib/chat-finalize/process-finalize.test.ts src/lib/cost-recording.extract-usage.test.ts src/__tests__/cost-recording.test.ts`
  passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm dlx prettier@3.6.2 --check packages/api/src/lib/trace-ledger/record-trace-evidence.ts packages/api/src/lib/trace-ledger/record-trace-evidence.test.ts packages/api/src/lib/chat-finalize/process-finalize.ts packages/api/src/lib/chat-finalize/process-finalize.test.ts packages/api/src/lib/cost-recording.ts docs/plans/autopilot/THNK-74-status.md`
  passed.
- `git diff --check` passed.
