---
title: "fix: Routine execution step status reconciliation"
status: completed
created: 2026-05-03
origin: deployed E2E for PR #774
---

# fix: Routine execution step status reconciliation

## Problem

The deployed E2E for the routine execution-aware editing work succeeded end to end, but the routine execution detail page rendered the `EmailAustinWeather` step as `Pending` while the overall execution was `Succeeded` and the run result contained `EmailAustinWeather.messageId`.

The current execution graph only colors a manifest step from `routine_step_events`. That works for wrapper-backed steps like `python`, which emit callback events, but Lambda-backed notification recipes can complete and appear in the final Step Functions output without a corresponding step event. The UI should not show a completed terminal execution as if one of its output-bearing steps never ran.

## Requirements

- R1. A terminal succeeded routine execution should render a manifest step as `Succeeded` when the execution output contains that step's result object, even if `routine_step_events` lacks a row for that node.
- R2. Explicit step events remain authoritative when present. A real `failed`, `running`, `awaiting_approval`, `cancelled`, or `timed_out` step event must not be overwritten by output inference.
- R3. Non-terminal executions keep the current behavior: manifest steps without events remain `Pending`.
- R4. Malformed, missing, or non-object `outputJson` must not crash the execution detail page.
- R5. Existing event-driven graph behavior and manifest normalization remain unchanged.

## Scope

In scope:
- Admin routine execution detail graph/status rendering.
- Pure helper tests for deriving graph nodes/status from manifest, events, terminal execution status, and parsed output JSON.

Out of scope:
- Changing Step Functions ASL emitters to inject callback events for every native or Lambda-integrated recipe.
- Backfilling historical `routine_step_events`.
- Mobile execution detail parity unless it shares the same helper after a low-risk import is already available.

## Research Summary

- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` maps GraphQL `stepEvents` into `StepEventLite` and passes those plus `aslVersion.stepManifestJson` into `ExecutionGraph`.
- `apps/admin/src/components/routines/ExecutionGraph.tsx` derives nodes through `deriveNodes(stepManifest, events)` and marks steps without `latestEvent` as `Pending`.
- `apps/admin/src/components/routines/routineExecutionManifest.ts` already provides pure JSON parsing and manifest normalization helpers.
- `packages/api/src/lib/routines/recipe-catalog.ts` emits `email_send` with `ResultSelector: { "messageId.$": "$.Payload.messageId" }`, so successful runs contain an `EmailAustinWeather` output key even if no callback event was written.
- `packages/database-pg/src/schema/routine-step-events.ts` documents step events as callback populated, but not every recipe currently emits one.
- No external research is needed; this is a local product consistency bug with established UI patterns.

## Design

Add a small reconciliation layer before graph rendering:

- Keep `latestEventByNode` as the authoritative source for nodes with explicit events.
- Parse `execution.outputJson` with the existing `parseAwsJson` helper in the route.
- Pass `execution.status` and parsed `executionOutput` into the graph derivation.
- For terminal `succeeded` executions only, synthesize a minimal `succeeded` event for manifest nodes that:
  - have no explicit latest event, and
  - have a same-named key in the parsed output object.
- Use the synthetic event only for graph status presentation. Do not invent detail-panel event rows; the absence of callback metadata should remain visible if the user selects the step.

This keeps the implementation honest: the UI can say "this step produced output in a succeeded execution" without pretending the callback log contains richer timing/details that it does not.

## Implementation Units

### U1. Reconcile output-backed step statuses in graph derivation

Files:
- Modify: `apps/admin/src/components/routines/ExecutionGraph.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx`

Approach:
- Extend `deriveNodes` or add a wrapper helper that accepts optional `executionStatus` and `executionOutput`.
- Add an `outputHasNodeResult(output, nodeId)` guard that only matches plain objects with an own property for the node id.
- Synthesize `StepEventLite` with `status: "succeeded"` only when `executionStatus === "succeeded"` and no explicit event exists.
- Give synthetic events stable ids such as `inferred:<nodeId>` and null timestamps so rendering remains deterministic.

Test scenarios:
- Succeeded execution with manifest step `EmailAustinWeather`, no event, and output key `EmailAustinWeather` renders that node as `Succeeded`.
- Explicit failed event for `EmailAustinWeather` remains `Failed` even if output contains `EmailAustinWeather`.
- Running execution with output key does not infer success.
- Malformed or primitive output does not infer status and does not throw.

### U2. Add focused unit coverage

Files:
- Modify: `apps/admin/src/components/routines/routineExecutionManifest.test.ts` or create `apps/admin/src/components/routines/ExecutionGraph.test.ts`

Approach:
- Prefer testing pure helpers rather than mounting the full route.
- Preserve existing `normalizeRoutineExecutionManifest` coverage.
- If testing `deriveNodes`, keep inputs as plain objects and assert the returned `latestEvent.status`.

Test scenarios:
- Existing manifest normalization tests still pass.
- Output inference tests cover the four cases from U1.

## Validation

- `pnpm --filter @thinkwork/admin test -- src/components/routines/routineExecutionManifest.test.ts`
- If a new graph test file is created, run that file too.
- `pnpm --filter @thinkwork/admin typecheck` if available in package scripts.
- Browser verification against deployed or local admin after merge/deploy: open a succeeded routine execution whose output contains `EmailAustinWeather` and verify the step list shows `Email Austin weather · Succeeded`.

## Risks

- Synthetic statuses could overstate evidence if applied too broadly. Limiting inference to overall `succeeded` executions and exact output keys keeps it conservative.
- Detail panel may still show no event details for inferred steps. That is acceptable for this slice because it avoids fabricating callback data.
- A future backend callback for `email_send` should naturally override this inference because explicit events remain authoritative.
