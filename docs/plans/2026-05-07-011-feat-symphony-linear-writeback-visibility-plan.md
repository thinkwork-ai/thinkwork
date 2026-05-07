---
title: "feat: Symphony Linear writeback visibility"
status: active
created: 2026-05-07
origin: direct user request
---

# feat: Symphony Linear writeback visibility

## Problem

The deployed Linear checkpoint now proves the backend path: a real Linear issue with only the `symphony` label is picked up by the scheduled connector poller, routed through connector execution, Computer task/event, Computer-owned thread, delegation, and managed-agent turn, then moved to Linear `In Progress`.

Operators can see most of that chain in **Symphony > Runs**, but the external Linear writeback result currently lives only in `connector_executions.outcome_payload.providerWriteback`. That means a failed Linear state update would still require SQL or raw JSON inspection.

## Scope

- Show provider writeback status in the existing Symphony Runs table.
- Keep the v0 provider-specific formatting limited to Linear because the checkpoint is Linear-only.
- Preserve single-line rows, truncation, and `allowHorizontalScroll={false}`.
- Add focused helper tests for success, skipped/already-in-state, failed, and missing writeback payloads.

Out of scope:

- New GraphQL fields or schema/codegen changes.
- New connector types or Slack/GitHub behavior.
- Replaying old connector executions.
- Adding comments or notifications in Linear.

## Existing Patterns

- `apps/admin/src/routes/_authed/_tenant/symphony.tsx` owns the Symphony tab UI and Runs `DataTable`.
- `apps/admin/src/lib/connector-admin.ts` already parses `ConnectorExecution.outcomePayload` for thread, Linear identifier, and cleanup reason.
- `apps/admin/src/lib/connector-admin.test.ts` is the focused unit-test home for connector UI payload helpers.
- `ConnectorRunLifecyclesQuery` already selects `execution.outcomePayload`, so the UI can render this without GraphQL schema changes.

## Implementation Unit

### U1. Linear Writeback Chip In Runs

Files:

- Modify: `apps/admin/src/lib/connector-admin.ts`
- Modify: `apps/admin/src/lib/connector-admin.test.ts`
- Modify: `apps/admin/src/routes/_authed/_tenant/symphony.tsx`

Approach:

- Add a helper that parses `outcomePayload.providerWriteback`.
- Return a compact display model with provider, status, label, tone, and title text.
- For Linear:
  - `updated` or `skipped` with `stateName` renders as `Linear: <stateName>`.
  - `failed` renders as `Linear writeback failed`.
  - missing payload renders nothing so older rows stay clean.
- Add the chip to the existing Runs row in a compact `Writeback` column next to the lifecycle stages.
- Use the same rounded status-chip visual language as `LifecycleStage`, keep text truncatable, and set title text for full details.

Test scenarios:

- Updated Linear payload with `stateName: "In Progress"` returns a green/success display of `Linear: In Progress`.
- Skipped already-in-state payload returns the same success display with a title that preserves reason.
- Failed Linear payload returns a destructive display with the error in the title.
- Missing or malformed writeback payload returns null.

## Verification

- `pnpm --filter @thinkwork/admin exec vitest run src/lib/connector-admin.test.ts`
- `pnpm --filter @thinkwork/admin typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm dlx prettier@3.8.2 --check apps/admin/src/lib/connector-admin.ts apps/admin/src/lib/connector-admin.test.ts apps/admin/src/routes/_authed/_tenant/symphony.tsx docs/plans/2026-05-07-011-feat-symphony-linear-writeback-visibility-plan.md`
- Browser check: open Symphony Runs and confirm rows remain single-line with no horizontal scroll and the Linear writeback chip appears for recent runs.

## Risks

| Risk                                        | Mitigation                                         |
| ------------------------------------------- | -------------------------------------------------- |
| Long writeback errors make rows wrap        | Render only a short label; put details in `title`. |
| Older executions have no writeback metadata | Helper returns null; no chip rendered.             |
| Provider-specific logic leaks into GraphQL  | Keep formatting in admin helper only.              |
