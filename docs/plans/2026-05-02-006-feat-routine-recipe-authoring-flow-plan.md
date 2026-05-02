---
title: "feat: Routine recipe authoring flow"
type: feat
status: completed
date: 2026-05-02
origin: docs/plans/2026-05-02-002-feat-real-routine-authoring-plan.md
---

# feat: Routine recipe authoring flow

## Overview

Turn the current one-shot routine creation form into a real recipe-backed authoring flow. A user describes a routine, the server-side planner chooses steps from the recipe catalog, the UI previews those steps with per-step configurable fields, and only then does the user publish the routine through the existing Step Functions `createRoutine` path.

This is the next PR after `docs/plans/2026-05-02-005-feat-routine-step-config-editor-plan.md`: that PR made persisted routine definitions editable by step. This PR brings the same step-config model into pre-publish authoring so routine creation is no longer an Austin-weather-specific black box.

---

## Problem Frame

The merged MVP proves that a recipe-authored Austin weather routine can be created, edited, tested, and executed. The gap is the authoring experience: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` still submits name + description directly to `createRoutine`, and `packages/api/src/lib/routines/routine-authoring-planner.ts` still exposes a narrow `weather_email` kind with Austin-specific copy and recognition logic.

That shape is not scalable. Configurable fields now belong to recipes and steps, so the authoring planner and UI need to treat Austin weather as one planner output, not as the product model. Users should see the proposed recipe graph before AWS resources are created, edit recipe config in the same grouped-by-step shape used on the Definition panel, and publish only reviewed artifacts.

---

## Requirements Trace

- R1. New-routine authoring must add a draft/preview step before creating AWS Step Functions resources.
- R2. The planner must choose steps from `RECIPE_CATALOG`; recipe metadata is the source of truth for labels, categories, arg schemas, and configurable fields.
- R3. The draft response must include step config grouped by step, using the same field model as persisted `RoutineDefinition`.
- R4. Austin weather email remains supported, but no UI component may hardcode Austin/weather/email as a product concept.
- R5. Publishing a reviewed draft must call the existing `createRoutine` explicit-artifact path so validation and AWS provisioning stay centralized.
- R6. Unsupported intents must return actionable planner feedback without creating routines or Step Functions resources.
- R7. End-to-end verification must create a routine from the new authoring flow, review/edit a step config field before publish, publish it, click `Test Routine`, and observe a successful execution.

---

## Scope Boundaries

- This PR targets the admin new-routine authoring flow first. Mobile chat-builder migration remains covered by `docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md`.
- This PR does not introduce a visual graph canvas or raw ASL editor.
- This PR does not add schedule or webhook trigger configuration to routines.
- This PR does not require an LLM planner. A deterministic catalog-backed planner is acceptable for this slice, as long as the planner output is recipe graph data rather than UI-specific fields.
- This PR does not add agent MCP routine authoring tools; those remain Phase C U11 follow-up work.

### Deferred to Follow-Up Work

- Conversational planner with validator-feedback retries.
- Broader recipe coverage for Slack, HTTP, approval, and agent/tool invocation once those recipes have safe authoring metadata.
- Execution-detail debugging UI for inspecting failed step output.
- Relationship affordances showing which scheduled jobs or webhooks trigger a routine.

---

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/routines/recipe-catalog.ts` defines recipe ids, display names, arg schemas, ASL emitters, and `configFields`.
- `packages/api/src/lib/routines/routine-authoring-planner.ts` currently produces a concrete `RoutinePlan`, ASL, markdown summary, and step manifest, but its public kind is `weather_email` and its copy is Austin-specific.
- `packages/api/src/lib/routines/routine-draft-authoring.ts` is a thin wrapper around the planner used by `createRoutine`.
- `packages/api/src/graphql/resolvers/routines/createRoutine.mutation.ts` already supports an explicit `{ asl, markdownSummary, stepManifest }` path and an intent-only fallback.
- `packages/api/src/graphql/resolvers/routines/routineDefinition.query.ts` and `updateRoutineDefinition.mutation.ts` already expose/persist step-level config for existing routines.
- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx` is the closest UI pattern for grouped step config editing.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` is the admin entry point to replace with a draft/review/publish flow.
- `packages/api/src/__tests__/routines-publish-flow.test.ts`, `packages/api/src/lib/routines/routine-authoring-planner.test.ts`, and `packages/api/src/lib/routines/recipe-catalog.test.ts` cover the current publish and definition semantics.

### Institutional Learnings

- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` supports treating recipe ids + args as the authoring DSL and platform-owned emitters as the only ASL generation path.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` applies to any new authoring/publish mutation.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` supports keeping runtime function-name details server-side.

### External Research

No external research is needed. This is an internal product architecture slice that extends recently merged local patterns.

---

## Key Technical Decisions

- **Draft before publish:** Add a server-side draft operation that plans and validates a routine without creating DB rows or AWS resources.
- **Recipe graph as the draft contract:** The draft payload carries title, description, steps, args, config fields, markdown summary, ASL, and step manifest. The UI renders from that generic shape.
- **Reuse the Definition editor field model:** Shared UI helpers should render `RoutineDefinitionConfigField`-shaped fields for both pre-publish drafts and persisted definitions.
- **Explicit-artifact publish:** After review/edit, the UI submits `createRoutine` with explicit ASL artifacts produced from the edited draft. `createRoutine` remains the only place that provisions Step Functions resources.
- **Planner output is generic:** Rename or loosen the planner model away from a closed `weather_email` public concept. If an internal planner recipe still recognizes Austin weather, it returns a normal `recipe_graph` draft with `python` + `email_send` steps.
- **Catalog-gated edits:** Draft config edits are applied through the same catalog metadata validation used for persisted definition edits: unknown step fields, non-editable changes, and invalid required values are rejected before publish.

---

## Open Questions

### Resolved During Planning

- **Should the new flow publish immediately from the first form submit?** No. The core product improvement is the review/edit step before resource creation.
- **Should Austin weather remain a special UI mode?** No. It remains one deterministic planner output behind the generic recipe graph contract.
- **Should schedules be configured here?** No. Scheduled jobs and webhooks remain separate automation modules.

### Deferred to Implementation

- Whether the draft operation should be a GraphQL query or mutation. It has no side effects, but mutation semantics may fit “Plan routine” better because it can perform validation work and return actionable errors.
- Whether edited draft state should be sent back as a full plan or as step config patches. Prefer step config patches if it keeps payloads smaller and mirrors `updateRoutineDefinition`.

---

## High-Level Design

```mermaid
sequenceDiagram
    participant User as Admin user
    participant UI as New Routine page
    participant API as GraphQL routines resolver
    participant Planner as Routine planner
    participant Catalog as Recipe catalog
    participant Create as createRoutine
    participant SFN as Step Functions

    User->>UI: Name + intent
    UI->>API: planRoutineDraft(input)
    API->>Planner: choose recipe steps
    Planner->>Catalog: read recipe metadata + config fields
    Planner-->>API: draft graph + ASL artifacts
    API-->>UI: editable step config draft
    User->>UI: Edit per-step config
    UI->>API: publish reviewed draft via createRoutine explicit artifacts
    Create->>Catalog: validate recipe-emitted ASL
    Create->>SFN: create state machine + live alias
    Create-->>UI: routine id
    UI->>User: Navigate to routine detail
```

---

## Implementation Units

- U1. **Generic recipe graph planner contract**

**Goal:** Replace the public Austin-specific planner contract with a generic recipe-graph draft that is backed by `RECIPE_CATALOG`.

**Requirements:** R2, R3, R4, R6

**Files:**

- Modify: `packages/api/src/lib/routines/routine-authoring-planner.ts`
- Modify: `packages/api/src/lib/routines/routine-draft-authoring.ts`
- Modify: `packages/api/src/lib/routines/routine-authoring-planner.test.ts`
- Modify: `packages/api/src/lib/routines/recipe-catalog.test.ts`

**Approach:**

- Introduce a generic draft kind such as `recipe_graph` or remove `RoutineDefinitionKind` from authoring-facing branching.
- Keep deterministic recognition for the current Austin weather email proof case, but have it return normal step graph data: `python` step, `email_send` step, catalog labels, args, and config fields.
- Move Austin-specific strings into the planner rule output only; do not expose them as a UI condition or schema enum.
- Ensure `buildRoutineArtifactsFromPlan`, `routineDefinitionFromArtifacts`, and `applyRoutineDefinitionEdits` operate over recipe steps and catalog metadata rather than `weather_email` branching where possible.
- Preserve backward compatibility for already-published manifests that still contain `kind: "weather_email"`.

**Test Scenarios:**

- Happy path: Austin weather email intent returns a generic recipe graph with `python` and `email_send` steps.
- Happy path: plan artifacts include catalog-derived `configFields` for each step.
- Edge case: old `kind: "weather_email"` manifests still hydrate into an editable generic plan.
- Error path: unsupported intent returns an actionable message and no artifacts.
- Error path: unknown recipe id in a manifest returns an unsupported-definition message.

---

- U2. **Draft planning GraphQL operation**

**Goal:** Add an admin-safe operation that returns a reviewable routine draft without creating Step Functions resources.

**Requirements:** R1, R2, R3, R5, R6

**Files:**

- Modify: `packages/database-pg/graphql/types/routines.graphql`
- Create: `packages/api/src/graphql/resolvers/routines/planRoutineDraft.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/routines/index.ts`
- Modify: `packages/api/src/__tests__/routines-publish-flow.test.ts`
- Modify generated artifacts after schema changes: `apps/admin/src/gql/graphql.ts`, `apps/admin/src/gql/gql.ts`, `apps/cli/src/gql/graphql.ts`, `apps/mobile/lib/gql/graphql.ts`

**Approach:**

- Add input type with `tenantId`, `name`, `description`, and optional step config edits.
- Add payload types that mirror persisted `RoutineDefinition` enough for UI reuse: title, description, steps, args, config fields, markdown summary, ASL, and step manifest.
- Gate with the same admin/API authorization posture as `createRoutine`, but do not create DB rows or AWS resources.
- Plan initial drafts from intent; when step edits are provided, apply them through catalog validation and rebuild artifacts.
- Return GraphQL errors for unsupported intents or invalid edits; clients show the error inline.

**Test Scenarios:**

- Happy path: planning an Austin weather email routine returns a draft and does not send any SFN commands.
- Happy path: edited email subject/to config returns rebuilt artifacts and updated config field values.
- Error path: unsupported intent returns an actionable error and no SFN side effects.
- Error path: editing read-only `python.networkAllowlist` is rejected.
- Error path: invalid recipient email is rejected.

---

- U3. **Shared step-config editor component**

**Goal:** Reuse one generic step-config renderer for persisted definitions and pre-publish drafts.

**Requirements:** R3, R4

**Files:**

- Create: `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx`
- Modify: `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`

**Approach:**

- Extract field rendering, value normalization for UI state, dirty detection, and mutation-value conversion from `RoutineDefinitionPanel`.
- Keep support for current input types: `text`, `number`, `select`, `email_array`, and `string_array`.
- Render read-only fields visually distinct from editable fields without implying they are user-configurable.
- Avoid any recipe-specific labels or UI branches beyond generic styling.

**Test Scenarios:**

- Happy path: editable email fields can be changed and dirty state is reported.
- Happy path: read-only fields render but do not emit editable changes.
- Edge case: empty config field list renders a compact empty state.
- Visual/browser: fields do not overflow on the routine detail page or the new authoring page.

---

- U4. **Admin new-routine draft/review/publish flow**

**Goal:** Replace one-shot creation with a two-phase authoring UI: describe, review/edit steps, then create.

**Requirements:** R1, R3, R4, R5, R6

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx`
- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Modify generated artifacts: `apps/admin/src/gql/graphql.ts`, `apps/admin/src/gql/gql.ts`

**Approach:**

- First state: name + description + “Plan routine” action.
- Draft state: show proposed steps using `RoutineStepConfigEditor`, show Save/Publish action, and allow returning to edit the intent.
- On config edits, either rebuild draft explicitly through the new draft operation or apply local state and submit reviewed artifacts from the server response. The server remains authoritative for final artifacts.
- On publish, call `createRoutine` with explicit `asl`, `markdownSummary`, and `stepManifest` from the reviewed draft.
- Navigate to the routine detail page after publish.

**Test Scenarios:**

- Happy path: user enters Austin weather email intent, sees proposed `python` + `email_send` steps before publish.
- Happy path: user changes the email subject before publish and the published definition shows that subject.
- Error path: unsupported intent shows the planner error and stays on the first state.
- Error path: publish error leaves the reviewed draft on screen so the user does not lose edits.

---

- U5. **End-to-end verification and docs cleanup**

**Goal:** Prove the new authoring flow creates and runs a real routine end to end, and keep local docs aligned with the shipped behavior.

**Requirements:** R7

**Files:**

- Modify as needed: `docs/plans/2026-05-02-006-feat-routine-recipe-authoring-flow-plan.md`

**Approach:**

- Run unit/type/build checks for touched packages.
- Use the admin dev server against the deployed dev stack.
- Create a new routine through the draft/review UI.
- Edit an email step config field before publish.
- Publish, open the routine detail page, click `Test Routine`, and confirm the new execution succeeds.

**Test Scenarios:**

- Browser E2E: new authoring flow produces a persisted routine with reviewed config.
- Browser E2E: `Test Routine` succeeds for the created routine.
- Regression: existing routine detail Definition panel still saves and republishes step config.

---

## Verification Plan

- `pnpm schema:build`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`
- `pnpm --filter @thinkwork/api exec vitest run src/lib/routines/routine-authoring-planner.test.ts src/lib/routines/recipe-catalog.test.ts src/__tests__/routines-publish-flow.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin build`
- Browser E2E on `localhost:5174`:
  - create a draft from an Austin weather email intent
  - edit the email step subject before publish
  - publish routine
  - click `Test Routine`
  - confirm the new run succeeds

---

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Draft operation accidentally provisions resources | Test with mocked SFN client proving no commands are sent during planning. |
| UI edits diverge from server-authored artifacts | Rebuild artifacts server-side after edits; publish only server-returned ASL/manifest. |
| Existing routines with `weather_email` manifests stop editing | Preserve backward hydration tests for legacy manifest kind. |
| Planner appears more general than it is | Unsupported-intent messages should be explicit about currently supported recipe combinations. |
| Generated GraphQL artifacts drift | Run codegen for admin, mobile, and CLI after schema changes. |

---

## Dependencies and Sequencing

1. U1 must land before U2 so the GraphQL operation can return generic recipe-graph drafts.
2. U2 must land before U4 so the UI has a server-authoritative draft operation.
3. U3 can happen in parallel with U2 after the field shape is stable.
4. U4 depends on U2 and U3.
5. U5 follows implementation and deployment.
