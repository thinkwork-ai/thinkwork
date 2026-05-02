---
title: Routine Config Metadata and Validation
status: completed
created: 2026-05-02
owner: codex
---

# Routine Config Metadata and Validation

## Purpose

Make routine step configuration safer and more scalable by moving field presentation and validation hints into the recipe catalog metadata, then using that metadata in both new-routine authoring and existing-routine editing. The UI should no longer infer important behavior from Austin-weather-specific field names or let invalid config reach the publish/update mutations.

## Context

The current graph editor already shows recipe steps, allows adding/reordering/removing steps, and edits per-step `configFields`. Those fields are produced by `packages/api/src/lib/routines/recipe-catalog.ts` and exposed through GraphQL. However, the shape is still thin: `key`, `label`, `value`, `inputType`, `required`, `editable`, and `options`.

That leaves the admin UI to guess whether a field is multiline, code-like, or constrained, and it only performs light value normalization before saving. This is brittle as the recipe catalog grows beyond the Austin weather example.

## Requirements

- R1. Recipe catalog metadata remains the source of truth for configurable fields.
- R2. Additive GraphQL fields expose UI/validation hints for both recipe catalog fields and routine definition fields.
- R3. Existing clients continue to work while new admin code consumes the richer metadata.
- R4. New-routine publish and existing-routine save block obvious invalid config before mutation.
- R5. Validation errors appear inline, grouped by step, without hiding the workflow.
- R6. Austin weather stays just one catalog output; no Austin-weather-specific UI branches.

## Design

Extend `RecipeConfigFieldDefinition` and `RecipeConfigField` with optional metadata:

- `control`: preferred editor control such as `text`, `textarea`, `code`, `select`, `number`, `email_list`, or `string_list`.
- `placeholder`: concise input hint.
- `helpText`: one-line operational hint.
- `min` / `max`: numeric constraints when the recipe arg schema has them.
- `pattern`: string constraint when a catalog field needs one.

Expose the same fields on:

- `RoutineDefinitionConfigField`
- `RoutineRecipeConfigField`

Use catalog metadata to mark known long or structured fields (`python.code`, `aurora_query.sql`, approval markdown/context, HTTP bodies, etc.) instead of frontend key-name heuristics. Derive min/max from explicit catalog field metadata for fields like `wait.seconds` and `python.timeoutSeconds`.

Implement admin-side validation in a small shared helper used by both:

- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
- `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx`

Validation should cover:

- required values
- email list syntax
- non-empty required lists
- numeric min/max
- select values within options
- regex patterns when present

## Implementation Units

### U1. API metadata shape

Modify:

- `packages/database-pg/graphql/types/routines.graphql`
- `packages/api/src/lib/routines/recipe-catalog.ts`
- `packages/api/src/lib/routines/recipe-catalog.test.ts`

Add optional metadata to config field types and populate it in the catalog for the recipes whose inputs need better controls. Keep every field additive and nullable so deployed clients are not broken.

### U2. Admin codegen and types

Modify:

- `apps/admin/src/lib/graphql-queries.ts`
- generated admin GraphQL files under `apps/admin/src/gql/`

Query the new metadata fields for plan drafts, recipe catalog entries, and routine definitions. Regenerate admin codegen.

### U3. Shared routine config validation

Create or modify:

- `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx`
- optional helper under `apps/admin/src/components/routines/`

Use metadata-driven controls and inline validation errors. Remove field-name heuristics where catalog metadata now supplies the intent.

### U4. Wire validation into save and publish

Modify:

- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
- `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx`

Disable Save/Publish while invalid, surface clear inline errors, and keep dirty-state behavior intact.

## Verification

- `pnpm --filter @thinkwork/api exec vitest run src/lib/routines/recipe-catalog.test.ts src/lib/routines/routine-authoring-planner.test.ts src/__tests__/routines-publish-flow.test.ts`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/admin build`
- Browser smoke on a local admin server:
  - open new routine page
  - confirm recipe catalog is visible before planning
  - add an email step and confirm required `To` blocks publish when empty
  - enter a valid recipient and confirm validation clears
  - open an existing routine and confirm definition save is blocked for invalid email then enabled after correction

## Risks

- The deployed dev GraphQL API will not know the new fields until this branch is deployed. Local browser smoke should use the branch-local API/mock or be limited to pages where the local GraphQL handler serves the schema.
- Generated GraphQL drift can break admin typecheck; regenerate immediately after schema/query changes.
- Over-validating flexible fields can block legitimate dynamic JSONPath/JSONata values; keep validation conservative and only enforce constraints represented in catalog metadata.
