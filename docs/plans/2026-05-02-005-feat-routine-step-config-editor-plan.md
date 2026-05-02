---
title: "feat: Routine step configuration editor"
type: feat
status: active
date: 2026-05-02
origin: docs/plans/2026-05-02-004-feat-routine-definition-editing-plan.md
---

# feat: Routine step configuration editor

## Overview

Refactor the merged routine Definition MVP from top-level routine fields into a generic recipe-step configuration editor. The current Austin weather routine should remain one planner output, but the editable source of truth must be each step's recipe args, with field metadata derived from `recipe-catalog.ts`.

This keeps the product direction honest: routines are recipe graphs, not one-off forms. `email_send.to` should be edited as configuration on the `EmailAustinWeather` step, and future recipes should become editable by adding catalog metadata, not by hardcoding routine-kind-specific UI.

## Problem Frame

PR #761 added a Definition panel, but its editable model is still too bespoke:

- `recipientEmail` is stored under `RoutinePlan.editableFields`, detached from the `email_send` step that owns it.
- `UpdateRoutineDefinitionInput` sends anonymous field edits rather than step-specific recipe args.
- The admin UI renders a generic field list, but the API field model still encodes an Austin/weather-specific top-level concept.
- The recipe catalog already owns `argSchema`, `displayName`, `description`, and recipe identity; the definition editor should use that catalog as the configuration authority.

The next slice should preserve the working publish/test path while changing the shape so it can scale to Slack, webhook, approval, agent-invoke, and other recipe-backed routines later.

## Requirements Trace

- R1. Routine definition data returned by GraphQL must model recipe steps as the primary editable units.
- R2. Editable configuration must live under each `RoutineDefinitionStep`, not under top-level `RoutineDefinition.editableFields`.
- R3. `email_send.to` must replace the special `recipientEmail` field for the Austin weather email routine.
- R4. Editable field metadata must be derived from recipe catalog metadata/schema, with recipe-specific overrides only when the catalog lacks enough UI hints.
- R5. Saving edits must address a specific `nodeId` and merge the submitted config into that step's args before regenerating ASL.
- R6. Server validation must reject unknown step ids, unknown config keys, invalid arg values, and attempts to edit non-configurable/internal fields before Step Functions side effects.
- R7. The admin Definition panel must render editable config grouped by step.
- R8. Existing Austin weather creation, rebuild, save, and Test Routine execution paths must continue to work.

## Scope Boundaries

- No visual graph editing, step insertion, deletion, branching, drag-and-drop ordering, or raw ASL editing.
- No new DB migration. Continue to persist structured definition data inside `stepManifestJson` for newly authored versions and derive older versions from ASL when possible.
- No full JSON Schema form renderer. Support a small catalog-backed field metadata layer for scalar strings, string arrays, enums, and read-only/internal fields.
- No mobile edit UI in this slice; generated mobile types still need to stay in sync.
- No broadened planner support beyond the existing Austin weather email output.

## Context & Research

### Existing Code

- `packages/api/src/lib/routines/recipe-catalog.ts` defines recipes, `argSchema`, display names, descriptions, ASL emitters, and `recipe:<id>` markers.
- `email_send` currently owns `to`, `subject`, `body`, `bodyPath`, `bodyFormat`, and `cc` args. Its `argSchema` already expresses required keys and body/bodyPath alternatives.
- `packages/api/src/lib/routines/routine-authoring-planner.ts` currently exposes `RoutinePlan.editableFields` and stores `definition.recipientEmail` in the step manifest.
- `packages/api/src/graphql/resolvers/routines/routineDefinition.query.ts` and `updateRoutineDefinition.mutation.ts` expose/read/write the current top-level editable-field shape.
- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx` renders `definition.steps` separately from `definition.editableFields`.
- `packages/api/src/__tests__/routines-publish-flow.test.ts` covers routineDefinition read/update and publish side-effect ordering.

### Institutional Learning

- `docs/solutions/architecture-patterns/recipe-catalog-llm-dsl-validator-feedback-loop-2026-05-01.md` says recipe ids and args are the safe, typed DSL. ASL is generated infrastructure, and catalog entries are the schema authority.
- `docs/plans/2026-05-02-004-feat-routine-definition-editing-plan.md` already states that routine definition should be a recipe graph; this plan corrects the implementation shape so the code matches that decision.

### External Research

Skipped. This is a local architecture correction against established repo patterns.

## Key Technical Decisions

- **Step args are the editable source.** `RoutinePlanStep.args` is the canonical editable payload; field metadata is a view over those args.
- **Catalog-derived config metadata.** Add recipe catalog metadata such as `configFields` or a helper that derives configurable fields from `argSchema` and recipe-specific UI hints. Keep internal/runtime fields read-only or hidden.
- **GraphQL edits are step-scoped.** Replace `fields: [RoutineDefinitionFieldInput!]` with `steps: [RoutineDefinitionStepConfigInput!]`, where each item names `nodeId` and `args`.
- **Per-step config fields in the response.** `RoutineDefinitionStep` should include `configFields` and `args`; remove or deprecate top-level `editableFields`.
- **Preserve backwards read compatibility from old manifests.** For existing versions with `definition.recipientEmail`, convert it into `EmailAustinWeather.args.to` in the returned plan and write the new step-config manifest on the next save.
- **Only expose safe fields initially.** For `email_send`, expose `to`, `subject`, and `bodyFormat`; show `bodyPath` as read-only or hidden because it wires output from the previous step. For `python`, keep `code`, `timeoutSeconds`, and `networkAllowlist` read-only in this slice.

## Proposed API Shape

Directional GraphQL shape:

```graphql
type RoutineDefinitionStep {
  nodeId: String!
  recipeId: String!
  recipeName: String!
  label: String!
  args: AWSJSON!
  configFields: [RoutineDefinitionConfigField!]!
}

type RoutineDefinitionConfigField {
  key: String!
  label: String!
  value: AWSJSON
  inputType: String!
  required: Boolean!
  editable: Boolean!
  options: [String!]
}

input RoutineDefinitionStepConfigInput {
  nodeId: String!
  args: AWSJSON!
}

input UpdateRoutineDefinitionInput {
  routineId: ID!
  steps: [RoutineDefinitionStepConfigInput!]!
}
```

Implementation can keep deprecated top-level `editableFields` for one release only if codegen or older clients require it, but the admin UI must stop using it.

## Implementation Units

### U1. Add recipe config metadata helpers

**Goal:** Make the recipe catalog the source of truth for editable config fields.

**Requirements:** R2, R4, R6

**Files:**

- Modify: `packages/api/src/lib/routines/recipe-catalog.ts`
- Create or modify: `packages/api/src/lib/routines/recipe-catalog.test.ts`

**Approach:**

- Add a catalog-facing config metadata layer. Prefer explicit metadata on `RecipeDefinition` because raw JSON Schema alone cannot say which fields are safe to edit, read-only, or UI-hidden.
- Define field metadata with `key`, `label`, `inputType`, `required`, `editable`, optional `options`, optional `itemType`, and optional helper text if needed.
- Add helpers such as `getRecipeConfigFields(recipeId, args)` or `configFieldsForRecipe(recipe, args)`.
- For `email_send`, expose:
  - `to`: editable string array or email-list field
  - `subject`: editable text
  - `bodyFormat`: editable enum
  - `bodyPath`: read-only or hidden
  - `cc`: optional hidden or deferred
- For `python`, expose read-only config metadata for at least `timeoutSeconds` and `networkAllowlist`, but do not allow editing code in this slice.

**Test scenarios:**

- `email_send` config fields include `to`, `subject`, and `bodyFormat`, with values from args.
- `bodyPath` is not editable.
- Unknown recipe id returns no editable config fields or a clear unsupported result.
- Required flags match the recipe arg schema for supported fields.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/routines/recipe-catalog.test.ts`

### U2. Refactor routine planner to step-owned config

**Goal:** Remove Austin-specific top-level editable state from the server plan model.

**Requirements:** R1, R2, R3, R4, R6, R8

**Files:**

- Modify: `packages/api/src/lib/routines/routine-authoring-planner.ts`
- Modify: `packages/api/src/lib/routines/routine-authoring-planner.test.ts`
- Modify: `packages/api/src/lib/routines/routine-draft-authoring.ts` only if adapter types change

**Approach:**

- Replace `RoutinePlan.editableFields` with step-level config metadata on each `RoutinePlanStep`.
- Persist `stepManifest.definition` as a recipe graph shape, for example:

```json
{
  "kind": "weather_email",
  "steps": [
    {
      "nodeId": "FetchAustinWeather",
      "recipeId": "python",
      "label": "Fetch Austin weather",
      "args": { "...": "..." }
    },
    {
      "nodeId": "EmailAustinWeather",
      "recipeId": "email_send",
      "label": "Email Austin weather",
      "args": {
        "to": ["ericodom37@gmail.com"],
        "subject": "Austin weather update",
        "bodyPath": "$.FetchAustinWeather.stdoutPreview",
        "bodyFormat": "markdown"
      }
    }
  ]
}
```

- Keep fallback parsing for old `definition.recipientEmail` manifests and old ASL-only definitions, but normalize them into the new step args shape.
- Replace `applyRoutineDefinitionEdits(plan, fields)` with `applyRoutineStepConfigEdits(plan, stepConfigEdits)`.
- Validate submitted args against recipe metadata before building artifacts:
  - unknown `nodeId` -> error
  - unknown recipe arg key -> error
  - non-editable arg changed -> error
  - `email_send.to` empty or invalid -> error

**Test scenarios:**

- Austin weather planner output has no top-level `editableFields`.
- `EmailAustinWeather.args.to` contains the recipient.
- `EmailAustinWeather.configFields` derives from `email_send` recipe metadata.
- Updating `EmailAustinWeather.args.to` changes ASL payload and manifest args.
- Updating `recipientEmail` in the old manifest shape still reads successfully and writes the new shape on save.
- Attempting to edit `FetchAustinWeather.code` is rejected before publish.
- Invalid email in `email_send.to` is rejected before publish.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/lib/routines/routine-authoring-planner.test.ts src/lib/routines/routine-draft-authoring.test.ts`

### U3. Update GraphQL contract and resolver tests

**Goal:** Expose the step-config model through GraphQL and publish step-scoped updates.

**Requirements:** R1, R2, R3, R5, R6, R8

**Files:**

- Modify: `packages/database-pg/graphql/types/routines.graphql`
- Modify: `packages/api/src/graphql/resolvers/routines/routineDefinition.shared.ts`
- Modify: `packages/api/src/graphql/resolvers/routines/updateRoutineDefinition.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/routines/routineDefinition.query.ts` if mapping changes
- Modify: `packages/api/src/__tests__/routines-publish-flow.test.ts`
- Generated: `apps/admin/src/gql/graphql.ts`
- Generated: `apps/admin/src/gql/gql.ts`
- Generated: `apps/mobile/lib/gql/graphql.ts`
- Generated: `apps/cli/src/gql/graphql.ts`

**Approach:**

- Add `RoutineDefinitionConfigField` and `RoutineDefinitionStepConfigInput`.
- Add `configFields` to `RoutineDefinitionStep`.
- Replace `UpdateRoutineDefinitionInput.fields` with `steps`.
- Remove top-level `editableFields`, or keep it nullable/deprecated only if generated clients need a transition. The admin UI must not query it.
- `updateRoutineDefinition` should pass step-scoped edits to the planner, then call `publishRoutineArtifacts` exactly as today.
- Keep admin/api-key authorization unchanged.

**Test scenarios:**

- `routineDefinition` returns `EmailAustinWeather.configFields` and `args.to`.
- `updateRoutineDefinition` with `{ nodeId: "EmailAustinWeather", args: { to: ["new@example.com"] } }` publishes a new ASL version.
- Unknown node id rejects before validation/SFN.
- Attempting to update non-editable `bodyPath` or `FetchAustinWeather.code` rejects before validation/SFN.
- Publish still updates routine description/documentation when email args change.

**Verification:**

- `pnpm --filter @thinkwork/api test -- src/__tests__/routines-publish-flow.test.ts`
- `pnpm schema:build`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`

### U4. Refactor admin Definition panel to grouped step config

**Goal:** Render a scalable per-step editor rather than a routine-level field list.

**Requirements:** R1, R2, R3, R7

**Files:**

- Modify: `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
- Modify: `apps/admin/src/lib/graphql-queries.ts`

**Approach:**

- Query `steps { nodeId recipeId recipeName label args configFields { ... } }`.
- Render each step as a compact section/card row with recipe badge and node id.
- Render editable config fields inside the owning step.
- Use field metadata to choose controls:
  - `text` / `email` -> `Input`
  - `string_array` or `email_array` -> comma/newline text input or simple list editor
  - `select` -> existing select component if available
  - read-only -> muted value row or hidden if not useful
- Track dirty state per `nodeId`.
- Save sends `steps: [{ nodeId, args: editedArgs }]` and no top-level fields.
- Keep the UI compact and aligned with the existing Routines page style; no nested cards inside cards.

**Test scenarios:**

- Definition panel renders the email recipient under the `EmailAustinWeather` step.
- Editing the recipient enables Save and sends `nodeId + args` mutation variables.
- Save disabled when no step config changes.
- Read-only fields render without writable controls.
- Old deployed GraphQL mismatch guard can be removed after the deployed schema is updated; if retained, it must match the new field names.

**Verification:**

- `pnpm --filter @thinkwork/admin build`
- `agent-browser open http://localhost:5174/automations/routines/<routineId>`
- Confirm Definition panel shows step-grouped config after deployed API catches up.

## Cross-Cutting Verification

- `git diff --check`
- `pnpm --filter @thinkwork/api test -- src/lib/routines/recipe-catalog.test.ts src/lib/routines/routine-authoring-planner.test.ts src/lib/routines/routine-draft-authoring.test.ts src/__tests__/routines-publish-flow.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin build`
- Browser check through `agent-browser` in pipeline mode.

## Risks & Mitigations

- **GraphQL breaking change for generated clients:** Regenerate admin, mobile, and CLI codegen in the same PR. Mobile does not consume the new UI yet, but generated types must compile.
- **Old routines with the PR #761 manifest shape:** Keep a read fallback for `definition.recipientEmail`; write the new step-config shape on the next publish.
- **JSON Schema UI overreach:** Do not build a full schema form engine. Add explicit recipe config metadata and support only field types needed by current recipes.
- **Accidental edit of runtime wiring:** Mark connector fields such as `bodyPath` and `python.code` read-only or hidden until there is a real product design for editing them.
- **Validation drift:** Continue to call `validateRoutineAsl` through `publishRoutineArtifacts`; add pre-publish tests that no invalid config reaches SFN.

## Definition of Done

- Admin Definition panel no longer queries or renders top-level `editableFields`.
- The email recipient is represented and edited as `EmailAustinWeather.args.to`.
- The update mutation accepts step-scoped config edits.
- Recipe catalog metadata drives visible editable fields.
- Existing Austin weather routine creation, save, and run list behavior remain intact.
- CI, browser smoke, and the LFG review pipeline pass.
