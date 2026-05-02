---
title: "feat: Routine workflow graph editor"
type: feat
status: completed
date: 2026-05-02
origin: user request 2026-05-02 routine authoring follow-up
---

# feat: Routine workflow graph editor

## Overview

Build the next routine authoring slice: users can see a recipe catalog, assemble workflow steps from recipes, and edit an existing routine's workflow graph by adding, removing, reordering, relabeling, and configuring recipe steps. The UI should make routines feel like Step Functions assembled from product-owned recipe blocks, not a prompt-only Austin weather demo.

This follows `docs/plans/2026-05-02-006-feat-routine-recipe-authoring-flow-plan.md`, which shipped prompt-to-draft and per-step config editing. This plan extends that MVP from "planner proposes a fixed graph" to "user can directly modify the graph."

## Problem Frame

The current new-routine page still leads with a prompt form and only shows recipe blocks after the planner succeeds. Existing routine detail pages allow editing config fields, but the workflow shape is fixed. That undercuts the product model: routines are pure Step Functions backed by a recipe catalog, so users need visible recipes and direct graph controls in both creation and edit contexts.

## Requirements Trace

- R1. New routine authoring must show recipe blocks/catalog affordances before planner output exists.
- R2. Users must be able to add catalog recipes to a draft workflow.
- R3. Users must be able to edit an existing routine's workflow graph, not only step config.
- R4. Graph editing must support add, remove, reorder, and step-label edits.
- R5. Recipe catalog metadata must remain the source of truth for display names, descriptions, categories, config fields, and default args.
- R6. Saving graph edits must rebuild and publish the Step Functions ASL through the existing routine version pipeline.
- R7. Routine UI must not hardcode Austin weather as a product concept.
- R8. Schedules and webhooks remain separate automation modules and must not appear as routine-step metadata.
- R9. End-to-end verification must prove creating and editing a workflow, then testing a routine from the UI.

## Scope Boundaries

- This PR ships a list-based graph editor, not a canvas.
- This PR does not add schedule or webhook trigger editing to Routines.
- This PR does not expose raw ASL editing.
- This PR does not make every recipe production-ready for every possible tenant integration. The catalog can expose recipes with validation requiring the user to supply missing config before save.
- This PR does not replace the prompt planner. Prompt planning remains a fast-start path that can populate the editable graph.

## Context & Patterns

- `packages/api/src/lib/routines/recipe-catalog.ts` defines recipe metadata and ASL emitters.
- `packages/api/src/lib/routines/routine-authoring-planner.ts` builds recipe-backed plans, ASL, summaries, and manifests.
- `packages/api/src/graphql/resolvers/routines/planRoutineDraft.mutation.ts` returns pre-publish drafts without creating AWS resources.
- `packages/api/src/graphql/resolvers/routines/updateRoutineDefinition.mutation.ts` updates existing routine definitions and publishes a new ASL version.
- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx` renders the existing persisted-definition editor.
- `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx` renders step-grouped config fields.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` owns new-routine authoring.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId.tsx` hosts the existing routine detail definition panel.
- `packages/api/src/__tests__/routines-publish-flow.test.ts` and `packages/api/src/lib/routines/routine-authoring-planner.test.ts` are the backend safety net.

## Technical Decisions

- **Expose the recipe catalog via GraphQL.** The admin app should not duplicate recipe metadata. Add a `routineRecipeCatalog` query backed by `listRecipes()`.
- **Extend step inputs to full graph steps.** Keep the existing config-only update path compatible, but allow `recipeId` and `label` on step inputs so clients can submit the full ordered workflow.
- **Use default args from recipe metadata.** Add catalog-owned `defaultArgs` so the UI can create new blocks without hardcoded recipe-specific placeholders.
- **Share one workflow editor component.** Create a reusable admin component used by new-routine drafts and existing routine definitions.
- **Server remains authoritative.** UI edits are submitted to `planRoutineDraft` or `updateRoutineDefinition`; server rebuilds ASL and validates editable config through catalog metadata.
- **Save-before-test.** Existing routine detail continues to use `Test Routine` against the last published version; graph edits must be saved first.

## Implementation Units

### U1. Recipe catalog API

**Goal:** Make recipe catalog metadata available to admin UI from the server.

**Files:**

- Modify: `packages/database-pg/graphql/types/routines.graphql`
- Modify: `packages/api/src/graphql/resolvers/routines/index.ts`
- Create: `packages/api/src/graphql/resolvers/routines/routineRecipeCatalog.query.ts`
- Modify: `packages/api/src/lib/routines/recipe-catalog.ts`
- Modify: `packages/api/src/__tests__/routines-publish-flow.test.ts`
- Modify generated codegen outputs in `apps/admin`, `apps/mobile`, and `apps/cli`

**Test Scenarios:**

- Query returns catalog entries grouped by recipe metadata, including category, description, config fields, and default args.
- Query requires an admin/API-authorized tenant caller.
- Catalog default args produce valid editable config field values for recipes that define config fields.

### U2. Full graph step planning and update contract

**Goal:** Allow draft planning and existing-routine updates to accept complete ordered recipe steps.

**Files:**

- Modify: `packages/database-pg/graphql/types/routines.graphql`
- Modify: `packages/api/src/lib/routines/routine-authoring-planner.ts`
- Modify: `packages/api/src/graphql/resolvers/routines/planRoutineDraft.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/routines/updateRoutineDefinition.mutation.ts`
- Modify: `packages/api/src/lib/routines/routine-authoring-planner.test.ts`
- Modify: `packages/api/src/__tests__/routines-publish-flow.test.ts`

**Test Scenarios:**

- Existing config-only updates still publish a new version.
- Full ordered step input can add an `email_send` step to an existing routine and publish a rebuilt ASL.
- Full ordered step input can remove or reorder steps and publish a rebuilt ASL.
- Duplicate node ids, unknown recipes, and missing required editable config are rejected.
- `planRoutineDraft` can build artifacts from explicit steps without requiring an Austin-weather intent.

### U3. Shared workflow editor UI

**Goal:** Render an editable workflow list with visible recipe catalog controls.

**Files:**

- Create: `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx`
- Modify: `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx`
- Modify: `apps/admin/src/lib/graphql-queries.ts`

**Test Scenarios:**

- Recipe catalog is visible before a draft exists.
- Add recipe creates a new workflow block with catalog-derived label and default config.
- Remove, move up/down, and label edit update local workflow state.
- Config field editing still handles text, number, select, string array, and email array values.
- Long labels/descriptions truncate without multiline table-style overflow.

### U4. New routine authoring with blocks plus planner

**Goal:** Replace prompt-only creation with a visible workflow builder that can be seeded by either prompt planning or manual recipe selection.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx`
- Modify generated admin GraphQL artifacts after schema/codegen changes

**Test Scenarios:**

- User sees catalog/workflow builder on first load.
- User can manually add recipe blocks, fill config, publish, and navigate to detail.
- User can still describe Austin weather, click Plan routine, review generated blocks, edit config, publish, and test.
- Unsupported prompt errors do not clear manually assembled blocks.

### U5. Existing routine graph editing

**Goal:** Existing routine details support direct graph editing and publish updated versions.

**Files:**

- Modify: `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
- Modify generated admin GraphQL artifacts after schema/codegen changes

**Test Scenarios:**

- Existing routine detail shows the same catalog/workflow editor.
- User can add, remove, reorder, relabel, and configure steps.
- Save publishes a new version and refreshes the displayed definition.
- Test Routine runs the newly saved definition successfully for a supported workflow.

## Verification

- `pnpm schema:build`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/mobile codegen`
- `pnpm --filter thinkwork-cli codegen`
- Targeted API tests for routine planner/publish flow.
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin build`
- Browser test in admin:
  - open `/automations/routines/new`
  - confirm recipe catalog visible on initial load
  - create a workflow via prompt planning and publish
  - edit an existing routine's graph on detail
  - save, click `Test Routine`, and observe a successful execution
