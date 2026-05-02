---
title: "feat: Routine execution-aware editing"
type: feat
status: completed
date: 2026-05-02
origin: user request 2026-05-02 routine authoring feels real
---

# feat: Routine execution-aware editing

## Overview

Connect routine manual editing to routine execution output so an operator can edit a recipe step, save the workflow, test it, and inspect what that saved step produced. PR #772 made workflow execution and manual editing usable; this plan closes the next loop by making Test Routine version-aware, making execution detail render the saved step labels/config snapshot, and preventing users from accidentally testing unsaved edits.

---

## Problem Frame

Routine execution now works and the editor has a real recipe-backed workflow surface, but the authoring loop is still mentally disjointed. A user can change a field and click Test Routine, yet the output view primarily shows raw node ids and runtime events. It is too easy to confuse the latest routine definition with the version that actually ran, especially after multiple saves. The product needs the same operator-readable recipe model in both editing and run inspection: saved step label, recipe id, historical args/config, current status, and output/error for that exact run.

---

## Requirements Trace

- R1. A manual Test Routine run must resolve the exact routine ASL version that was executed, even when Step Functions does not return or persist a version ARN for the execution row.
- R2. Execution detail must render the historical workflow snapshot for the execution version, not the routine's latest definition when viewing older runs.
- R3. Execution graphs and step panels must show authored labels and recipe ids as first-class display data, with technical node ids still available.
- R4. The editor must prevent or clearly block testing unsaved workflow edits so users do not think an unpublished change was tested.
- R5. AWSJSON parsing must tolerate both string and object payloads for manifests and step input/output/error data.
- R6. Routine UI must stay focused on routines as pure Step Functions workflows; no schedule/webhook trigger concepts should be introduced in this increment.
- R7. Browser verification must prove the full edit -> save -> test -> view output loop on an existing routine.

---

## Scope Boundaries

- No schedule, scheduled job, webhook, or trigger authoring UI.
- No graph canvas or drag-and-drop workflow editor.
- No raw ASL editor.
- No new recipe catalog entries.
- No large-output presigned URL flow; existing stdout/stderr URI display remains sufficient.
- No mobile parity in this PR, though GraphQL changes must remain additive and safe for other clients.

---

## Research Summary

- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`, `RoutineWorkflowEditor.tsx`, and `RoutineStepConfigEditor.tsx` own the manual authoring surface.
- `apps/admin/src/components/routines/ExecutionList.tsx`, `ExecutionGraph.tsx`, `StepDetailPanel.tsx`, and `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` own the current run output surface.
- `packages/api/src/graphql/resolvers/routines/triggerRoutineRun.mutation.ts` creates routine execution rows before invoking Step Functions and is the right boundary to persist a deterministic ASL version pointer.
- `packages/api/src/graphql/resolvers/routines/types.ts` resolves `RoutineExecution.aslVersion` and currently relies on `stateMachineArn + versionArn`; this can fail for manual runs with null version ARN.
- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` establishes that recipe ids and typed args are the authoring model, while ASL is generated infrastructure. The UI should join run output by `nodeId`, `recipeId`, and ASL version metadata rather than inspecting raw ASL.

External research is not needed. This is a repo-local UI/API continuation with strong existing patterns and no new framework surface.

---

## Key Technical Decisions

- **Persist the ASL version id on executions.** Add an additive nullable `routine_asl_version_id` column to `routine_executions`, populate it when starting a manual routine run, and resolve `RoutineExecution.aslVersion` from that id before falling back to the existing version ARN join.
- **Normalize manifests in the admin UI.** Add a small admin helper that accepts AWSJSON strings or objects and handles both legacy manifest maps and recipe authoring manifests shaped like `definition.steps[]`.
- **Prefer historical execution metadata.** Execution detail uses `execution.aslVersion.markdownSummary` and normalized manifest labels/config as the primary source for run inspection. Latest routine fields remain fallback only.
- **Disable Test while dirty or saving.** The Test Routine button should reflect editor state from `RoutineDefinitionPanel`; unsaved edits must be saved before they can be tested.
- **Keep run output compact but direct.** Add enough output/error display to answer “what did this test produce?” without turning the editor into a log explorer.

---

## High-Level Technical Design

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

```mermaid
sequenceDiagram
    participant User
    participant Editor as Routine detail editor
    participant API as GraphQL API
    participant DB as Aurora routine tables
    participant SFN as Step Functions
    participant Output as Execution detail

    User->>Editor: Edit recipe step config
    Editor->>API: updateRoutineDefinition(steps)
    API->>DB: publish routine_asl_versions row
    API->>SFN: publish version + move live alias
    API-->>Editor: currentVersion + versionId
    Editor-->>User: Saved workflow; Test enabled
    User->>Editor: Click Test Routine
    Editor->>API: triggerRoutineRun(routineId)
    API->>DB: insert routine_execution with routine_asl_version_id
    API->>SFN: start live alias execution
    API-->>Editor: execution id
    User->>Output: View run output
    Output->>API: routineExecution(id)
    API->>DB: execution + exact aslVersion + step events
    Output-->>User: Saved labels/config + per-step output/errors
```

---

## System-Wide Impact

- Admin operators get a clearer routine authoring loop and fewer false positives from testing stale saved versions.
- The API gains an additive execution-to-ASL-version pointer that improves historical run fidelity for existing and future admin surfaces.
- Database schema changes require a Drizzle migration and generated GraphQL/codegen updates where schema files change.

---

## Implementation Units

- U1. **Persist execution ASL version identity**

  **Goal:** Make every new routine test run able to resolve the exact ASL version that backed the execution.

  **Requirements:** R1, R2

  **Dependencies:** None

  **Files:**
  - Modify: `packages/database-pg/src/schema/routines.ts`
  - Add: `packages/database-pg/drizzle/<next>_routine_execution_asl_version_id.sql`
  - Modify: `packages/api/src/graphql/resolvers/routines/triggerRoutineRun.mutation.ts`
  - Modify: `packages/api/src/graphql/resolvers/routines/types.ts`
  - Modify: `packages/api/src/graphql/resolvers/routines/types.test.ts`
  - Modify: `packages/api/src/graphql/resolvers/routines/routineExecutions.query.test.ts`

  **Approach:** Add nullable `routine_asl_version_id` to `routine_executions` with a foreign key to `routine_asl_versions.id`. In `triggerRoutineRun`, load the routine's current ASL version row before inserting the execution, store that id on the execution row, and keep the existing Step Functions invocation unchanged. In `RoutineExecution.aslVersion`, first resolve by `routine_asl_version_id`; if absent, preserve the existing `(state_machine_arn, version_arn)` fallback for older rows and out-of-band starts.

  **Patterns to follow:** Use existing Drizzle schema naming in `packages/database-pg/src/schema/routines.ts`; use resolver test mocking style in `packages/api/src/graphql/resolvers/routines/types.test.ts`.

  **Test scenarios:**
  - Happy path: `triggerRoutineRun` inserts `routine_asl_version_id` for a routine with a current version row.
  - Edge case: `RoutineExecution.aslVersion` resolves by `routine_asl_version_id` when `versionArn` is null.
  - Backward compatibility: resolver falls back to `stateMachineArn + versionArn` when `routine_asl_version_id` is null.
  - Failure path: routine without a current ASL version returns the existing trigger error behavior rather than inserting an unusable execution row.

  **Verification:** API tests prove deterministic version resolution and existing trigger behavior still works.

- U2. **Normalize historical workflow manifests for display**

  **Goal:** Give admin UI a stable view model for execution workflow snapshots across old and new manifest shapes.

  **Requirements:** R2, R3, R5

  **Dependencies:** U1

  **Files:**
  - Add: `apps/admin/src/components/routines/routineExecutionManifest.ts`
  - Add: `apps/admin/src/components/routines/routineExecutionManifest.test.ts`
  - Modify: `apps/admin/src/components/routines/ExecutionGraph.tsx`
  - Modify: `apps/admin/src/components/routines/StepDetailPanel.tsx`
  - Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx`

  **Approach:** Add a helper that parses AWSJSON values safely and returns normalized step nodes with `nodeId`, `recipeId`, `recipeType`, `label`, and optional `args`. Support at least two inputs: legacy object maps like `{ FetchWeather: { recipeType: "python" } }` and recipe authoring manifests like `{ definition: { steps: [...] } }`. Preserve raw event fallback when no manifest exists.

  **Patterns to follow:** Keep display transformation near routine UI components, similar to `deriveNodes` and `latestEventByNode` in `ExecutionGraph.tsx`.

  **Test scenarios:**
  - Happy path: normalizes a `definition.steps[]` manifest with labels and args.
  - Backward compatibility: normalizes legacy node-map manifests.
  - AWSJSON handling: accepts object input, JSON string input, malformed string input, null, and arrays.
  - Display fallback: unknown recipe metadata still shows manifest label and recipe id.

  **Verification:** Admin unit tests cover the normalizer, and admin build proves route/component integration compiles.

- U3. **Render execution detail from the run version**

  **Goal:** Make output inspection read like “this saved workflow ran and produced this,” not like raw Step Functions event plumbing.

  **Requirements:** R2, R3, R5

  **Dependencies:** U2

  **Files:**
  - Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx`
  - Modify: `apps/admin/src/components/routines/ExecutionGraph.tsx`
  - Modify: `apps/admin/src/components/routines/StepDetailPanel.tsx`
  - Modify: `apps/admin/src/lib/graphql-queries.ts`

  **Approach:** Feed normalized manifest nodes into the graph so labels render primary and node ids render secondary. Prefer `execution.aslVersion.markdownSummary` for the summary card and fall back to `routine.documentationMd` only when no version summary exists. Add a compact routine output/error card using already-fetched `outputJson`, `errorCode`, and `errorMessage`. Guard against URL mismatches by showing a not-found/error state if the loaded execution's `routineId` differs from the route `routineId`.

  **Patterns to follow:** Preserve the current execution detail layout and polling behavior; keep dense operator UI styling consistent with adjacent cards.

  **Test scenarios:**
  - Happy path: graph displays saved step label as primary, recipe id and node id as supporting metadata.
  - Historical path: route shows `aslVersion.markdownSummary` even if latest routine documentation differs.
  - Error path: execution-level `errorCode` and `errorMessage` are visible without selecting a step.
  - Mismatch path: route refuses to render an execution whose `routineId` does not match URL params.

  **Verification:** Admin build passes and browser smoke confirms execution output uses authored labels.

- U4. **Coordinate editor dirty state with Test Routine**

  **Goal:** Prevent users from testing stale saved versions while believing they tested unsaved edits.

  **Requirements:** R4, R6, R7

  **Dependencies:** U1

  **Files:**
  - Modify: `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
  - Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId.tsx`
  - Modify: `apps/admin/src/components/routines/ExecutionList.tsx`

  **Approach:** Lift definition editor state upward through a small callback such as `onStateChange({ dirty, invalid, saving, currentVersion })`. Disable Test Routine when the editor is dirty, invalid, or saving, and provide concise title/copy explaining that saving is required before testing. Adjust the post-test banner copy so it does not claim the run is visible in the list when filters may hide it; keep the direct `View run output` link. Ensure empty run state does not route users to schedule/trigger setup.

  **Patterns to follow:** Use PR #772's existing dirty-state badges and button titles rather than adding modal confirmations.

  **Test scenarios:**
  - Happy path: clean saved workflow enables Test Routine.
  - Dirty path: changing a field disables Test Routine and explains why.
  - Saving path: Save in progress disables Test Routine until the refreshed version is available.
  - Invalid path: invalid config disables both Save and Test.
  - Empty state: no routine executions does not introduce schedule/webhook setup CTAs.

  **Verification:** Browser smoke proves unsaved edits cannot be accidentally tested.

- U5. **Post-deploy browser verification and PR evidence**

  **Goal:** Prove the user-facing authoring loop works through the deployed dev API, not just static builds.

  **Requirements:** R7

  **Dependencies:** U1, U2, U3, U4

  **Files:**
  - Modify: PR description only, or add demo assets if the implementation workflow captures screenshots.

  **Approach:** Run the admin dev server from the feature worktree with the copied admin `.env`. Open an existing routine, edit a safe configurable field, save, confirm the version changes, click Test Routine, wait for terminal success or a clear runtime error, click `View run output`, and verify the execution detail page shows the saved step label/config context and real output/error. If the deployed dev stack is temporarily unavailable, record the exact blocking deploy/runtime error and keep local verification evidence.

  **Patterns to follow:** Use browser verification lessons from prior routine PRs: refresh stale UI, click through the actual route, and do not accept a run-list row as proof that output inspection works.

  **Test scenarios:**
  - Browser E2E: edit -> save -> test -> view output on an existing routine.
  - Browser E2E: unsaved edit keeps Test disabled.
  - Browser E2E: execution detail renders output for a just-started or freshly completed run.

  **Verification:** PR body includes checks run, browser path tested, and any residual runtime caveat.

---

## Deferred Implementation Notes

- If adding a foreign key to `routine_executions` exposes existing data drift in dev, preserve rows with nullable `routine_asl_version_id` and rely on the fallback resolver.
- If the existing `step_manifest_json` never carries step args for a routine shape, do not invent args client-side. Show labels/recipe ids and step event input/output, then leave richer historical config capture for a later PR.
- If browser testing with a real email routine would send mail repeatedly, use a harmless editable field or a clearly named test routine created for this verification path.

---

## Risks & Mitigations

| Risk                                                  | Mitigation                                                                                            |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Migration conflicts with hand-rolled Drizzle workflow | Add clear migration markers if needed and run targeted API tests; keep the column nullable.           |
| Historical runs still lack manifest data              | Keep events-only fallback and label the absence clearly rather than rendering a misleading workflow.  |
| UI overstates version certainty                       | Show version metadata only when `execution.aslVersion` is resolved; otherwise use a neutral fallback. |
| Test Routine disabled state feels blocking            | Use concise button title/copy and keep Save prominent inside the Definition panel.                    |
| AWSJSON handling diverges across components           | Centralize parsing/normalization in one routine UI helper.                                            |

---

## Verification Plan

- `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/routines/types.test.ts src/graphql/resolvers/routines/routineExecutions.query.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin test -- routineExecutionManifest`
- `pnpm --filter @thinkwork/admin build`
- Browser smoke on local admin:
  - Open `/automations/routines`
  - Open an existing routine detail page
  - Make a safe config edit and confirm Test Routine disables while dirty
  - Save and confirm Test Routine re-enables
  - Click Test Routine and open `View run output`
  - Confirm execution detail uses saved step labels and displays output/error
