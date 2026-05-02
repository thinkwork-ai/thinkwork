---
title: "fix: Prove Austin weather routine test end to end"
type: fix
status: completed
date: 2026-05-02
origin: ad hoc live routine validation
---

# fix: Prove Austin weather routine test end to end

## Summary

Make the currently configured "Check Austin Weather" routine (`e0464ffe-2c9c-4722-bf61-d87ae759d71d`) run as a real Austin weather email workflow, then prove it by clicking the admin routine detail page's **Test** button. The outcome must be a successful routine run through the product path, not just a manual Step Functions console execution.

## Problem Frame

The routine row and Step Functions state machine exist, and the admin route exposes a Test button. Earlier console executions only proved the state machine alias could be invoked directly; they did not prove the admin Test button path, because direct Step Functions executions do not create `routine_executions` rows. The current routine definition may also still be the no-op placeholder ASL from the builder stub, which means a "successful" execution would not fetch weather or send email.

## Requirements

- R1. The existing routine id `e0464ffe-2c9c-4722-bf61-d87ae759d71d` remains the routine under test.
- R2. The live Step Functions alias for that routine executes a workflow that fetches Austin weather and emails it to the configured recipient.
- R3. Clicking the admin **Test** button starts the run through `triggerRoutineRun`, creating a `routine_executions` row.
- R4. The admin run list can read and display triggered executions for this routine.
- R5. The run succeeds in AWS Step Functions, with enough evidence to distinguish the product-path run from prior console/manual executions.

## Scope Boundaries

- Do not rebuild the routine authoring chat flow in this fix.
- Do not change the routine id, tenant, or recipient.
- Do not add unrelated routine recipe types.
- Avoid direct production data edits unless they are needed to repair the currently configured dev routine for this validation.

## Context & Research

- Admin route: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId.tsx`
- Test button mutation: `TriggerRoutineRunMutation` in `apps/admin/src/lib/graphql-queries.ts`
- Trigger resolver: `packages/api/src/graphql/resolvers/routines/triggerRoutineRun.mutation.ts`
- Routine execution read schema: `packages/database-pg/graphql/types/routines.graphql`
- Routine resolver exports: `packages/api/src/graphql/resolvers/routines/index.ts`
- Current routine state machine naming convention: `thinkwork-dev-routine-<routineId>`

## Implementation Units

- U1. **Restore routine execution read resolvers**

  **Goal:** Ensure admin can list and inspect routine executions created by the Test button.

  **Files:**
  - Create: `packages/api/src/graphql/resolvers/routines/routineExecutions.query.ts`
  - Create: `packages/api/src/graphql/resolvers/routines/routineExecutions.query.test.ts`
  - Modify: `packages/api/src/graphql/resolvers/routines/index.ts`
  - Modify: `packages/api/src/graphql/resolvers/routines/types.ts`
  - Modify: `packages/api/src/graphql/resolvers/routines/types.test.ts`

  **Approach:** Implement the schema-declared `routineExecution`, `routineExecutions`, `routineStepEvents`, and `routineAslVersion` queries using Drizzle and existing camel-case mapping conventions. Add `RoutineExecution.routine`, `trigger`, and `stepEvents` field resolvers so the run-detail surface has the data it asks for.

  **Test scenarios:**
  - Listing executions filters by routine id and optional status.
  - Listing executions orders newest first and respects a conservative limit.
  - Missing single execution returns `null`.
  - Step events are scoped to an execution and ordered chronologically.

  **Verification:** Targeted Vitest resolver tests pass.

- U2. **Repair the configured routine definition if it is still no-op**

  **Goal:** Make the existing routine's live alias execute a weather-fetch-and-email workflow.

  **Files and services:**
  - Inspect: routine recipe catalog and Step Functions deployment outputs.
  - Update, if needed: dev Step Functions state machine alias/version and matching routine version metadata for `e0464ffe-2c9c-4722-bf61-d87ae759d71d`.

  **Approach:** Inspect the deployed routine definition and available routine recipes. Prefer the product publish path if it is usable from the current authenticated admin session; otherwise use the narrowest dev repair path that keeps database metadata, current version, and the live Step Functions alias aligned.

  **Test scenarios:**
  - Existing live definition is identified as no-op or real workflow before changing it.
  - The repaired live definition invokes supported routine task resources.
  - The repaired definition preserves the routine id and live alias.

  **Verification:** A new Step Functions execution from the live alias performs the intended weather/email work.

- U3. **Verify through the admin Test button**

  **Goal:** Prove the complete product path works.

  **Files and services:**
  - Admin dev server on `localhost:5174`
  - Deployed dev GraphQL API
  - AWS Step Functions routine state machine
  - Routine execution persistence

  **Approach:** Use browser/computer automation to click **Test** on the running admin page. Refresh the run list if needed, then corroborate with AWS/DB evidence.

  **Test scenarios:**
  - Clicking **Test** starts a run without GraphQL/UI error.
  - The run appears in the admin list.
  - The corresponding Step Functions execution succeeds.
  - Email delivery is attempted by the configured routine workflow.

  **Verification:** Browser-observed success plus AWS/DB run evidence.

## Implementation-Time Unknowns

- The current deployed GraphQL Lambda may not yet include the routine execution read resolver fix; if the UI still cannot show runs, the fix must be shipped or temporarily deployed to dev before final browser proof.
- The routine authoring path may not yet be able to publish a real ASL from the existing natural-language routine prompt; if so, manually publishing the dev routine definition is acceptable for this validation.
