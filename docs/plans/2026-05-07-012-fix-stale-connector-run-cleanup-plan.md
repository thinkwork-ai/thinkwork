---
title: Stale Connector Run Cleanup And Checkpoint Runbook
status: active
created: 2026-05-07
origin: direct
---

# Stale Connector Run Cleanup And Checkpoint Runbook

## Problem Frame

The Linear-only Symphony checkpoint now works for fresh issues: scheduled polling creates a terminal connector execution, hands work to a Computer, completes delegation, succeeds the managed-agent turn, moves the Linear issue to In Progress, and shows `Linear: In Progress` in Symphony Runs.

Older proof attempts still appear in Symphony Runs with stale `dispatching`, pending task/delegation/turn, or pre-fix running delegation states. Those rows are historical noise from earlier broken lifecycle behavior, not actionable current work. Operators need a safe way to mark them stale/cancelled and a runbook that explains how to verify the checkpoint without falling back to SQL.

## Scope

- Add an idempotent operator cleanup/backfill path for stale Linear connector proof rows.
- Keep fresh successful rows untouched.
- Preserve existing connector idempotency and runtime behavior.
- Keep Symphony Runs readable by relying on existing cancelled-row filtering and clear cleanup metadata.
- Update the checkpoint runbook with UI-first verification and stale cleanup instructions.

Out of scope:

- Automatic production cleanup during deploy.
- New connector types.
- Reprocessing historical Linear issues.
- Changing Computer runtime delegation semantics.

## Existing Patterns

- Operator scripts live under `packages/api/scripts/` and are run with `pnpm -C packages/api exec tsx scripts/<name>.ts`.
- `docs/runbooks/computer-first-linear-connector-checkpoint.md` is the current operator proof doc.
- `connector_executions.current_state` already supports `cancelled`.
- `computer_tasks.status` and `computer_delegations.status` already support `cancelled`.
- Symphony Runs already hides cancelled connector executions unless the operator toggles "Show cancelled".
- `apps/admin/src/lib/connector-admin.ts` parses `outcomePayload.cleanup.reason`, giving us a stable metadata hook.

## Implementation Units

### U1. Stale Connector Run Cleanup Script

Files:

- `packages/api/scripts/cleanup-stale-connector-runs.ts`

Approach:

- Add a dry-run-by-default script with `--apply`, `--tenant`, `--connector`, `--older-than-hours`, and `--external-ref-prefix` options.
- Target only stale connector executions whose state is active (`pending`, `dispatching`, `invoking`, `recording_result`) and older than the cutoff.
- Optionally target stale `connector_work` tasks and linked delegations whose ids are present in the connector execution `outcome_payload`.
- Mark targeted connector executions `cancelled`, set `finished_at` when missing, set `error_class='stale_connector_cleanup'`, and merge cleanup metadata into `outcome_payload`.
- Mark linked non-terminal Computer tasks/delegations `cancelled` with structured error payloads, without touching completed/failed/cancelled rows.
- Print before/after counts and row ids so operators can review dry-run output before applying.

Tests:

- Script-level coverage is mostly exercised by TypeScript compilation. The SQL is intentionally explicit and dry-run-first.
- Add helper/unit coverage only if implementation extracts non-trivial argument parsing or payload formatting.

### U2. Symphony Runs Stale Display Polish

Files:

- `apps/admin/src/lib/connector-admin.ts`
- `apps/admin/src/lib/connector-admin.test.ts`
- `apps/admin/src/routes/_authed/_tenant/symphony.tsx`

Approach:

- Use existing cleanup metadata parsing to show a compact cancelled reason for rows when cancelled runs are visible.
- Keep rows single-line and truncated.
- Do not add horizontal scroll.

Tests:

- Extend `connector-admin.test.ts` for cleanup reason parsing/display helper if a new helper is introduced.

### U3. Checkpoint Runbook Update

Files:

- `docs/runbooks/computer-first-linear-connector-checkpoint.md`

Approach:

- Promote Symphony Runs as the primary verification surface.
- Document `Linear: In Progress` as the writeback success signal.
- Add a stale cleanup section with dry-run/apply commands and guardrails:
  - always dry-run first;
  - prefer tenant/connector scoping;
  - use a conservative cutoff;
  - do not run against fresh successful rows.

Tests:

- `pnpm format:check` covers Markdown formatting.

## Verification

- Run focused tests for connector admin helpers and connector lifecycle resolver if touched.
- Run `pnpm --filter @thinkwork/admin test -- connector-admin.test.ts`.
- Run package typechecks for touched packages where practical.
- Run `pnpm format:check`.
- Open PR, monitor CI, merge when green.

## Risks

- Cleanup script could mark live work cancelled if run with too broad a cutoff. Mitigation: dry-run default, explicit `--apply`, conservative defaults, and tenant/connector scoping.
- Historical rows may not all have complete outcome payloads. Mitigation: update connector executions independently, and only update tasks/delegations when a linked id is present.
- UI could become too dense if cleanup details are verbose. Mitigation: compact label plus tooltip.
