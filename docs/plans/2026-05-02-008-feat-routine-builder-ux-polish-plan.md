---
title: "feat: Routine builder UX polish"
type: feat
status: completed
date: 2026-05-02
origin: user request 2026-05-02 builder UX polish + better config inputs
---

# feat: Routine builder UX polish

## Overview

Polish the routine workflow builder added in `docs/plans/2026-05-02-007-feat-routine-graph-editor-plan.md` so it feels like an intentional product editor instead of catalog metadata rendered directly onto the page. The focus is frontend UX: clearer builder layout, better step controls, stronger empty/dirty states, and config inputs that match the data being edited.

## Problem Frame

The current PR proves the workflow graph can be edited, but the experience is rough:

- The recipe catalog is visually heavy and reads like a stack of cards.
- Workflow steps look like a backend form dump rather than an ordered graph.
- Code, body, SQL, JSON, and prompt-like fields are cramped into one-line inputs.
- Users can save graph changes, but the UI does not clearly communicate draft state or that Test Routine uses the published version.

This pass should improve the product feel without changing the backend graph/publish contract.

## Requirements Trace

- R1. The builder must show a clearer two-pane editing surface: compact recipe palette plus focused workflow editor.
- R2. Recipe search/filtering must make the catalog scannable.
- R3. Workflow steps must look selected/ordered/editable, with actions that are easy to understand.
- R4. Config fields must use appropriate input controls: multiline text for body/code/SQL/context, select for enum fields, number inputs for numeric fields, and textarea-style editing for array/list content.
- R5. Existing create and edit flows must continue to share the same workflow editor.
- R6. Unsaved changes on existing routines must be obvious, with Save enabled only when there are real edits.
- R7. UI must not introduce routine schedule/webhook concepts or Austin-weather-specific concepts.
- R8. Browser verification must cover initial catalog visibility, manual block add/config, existing routine edit/save, and responsive layout sanity.

## Scope Boundaries

- No backend schema or resolver changes unless a frontend type gap is discovered during implementation.
- No graph canvas or drag-and-drop in this pass. Button-based reorder remains sufficient.
- No live execution trace mapping in this PR.
- No raw ASL editor.
- No schedule/webhook trigger UI.

## Context & Patterns

- `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx` owns the catalog + workflow layout.
- `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx` owns config field rendering and mutation value conversion.
- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx` owns existing-routine save/draft state.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` owns new-routine prompt/manual publish state.
- Existing shadcn-style UI primitives live in `apps/admin/src/components/ui/`.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` and adjacent admin tables are good references for restrained operational UI density.

## Technical Decisions

- **Keep the editor list-based.** Make the existing workflow list feel deliberate instead of adding a canvas.
- **Searchable compact palette.** Add a search box and compact recipe rows grouped by category.
- **Step header owns actions.** Move step action buttons into a consistent header row with icon buttons and stable dimensions.
- **Textarea heuristics from field metadata.** Without new schema fields, infer multiline controls from config field keys/input type: `body`, `code`, `sql`, `text`, `markdownContext`, `expression`, `args`, `input`, and JSON-like object values.
- **No client-only validation framework.** Preserve server validation; add local affordances and required indicators only.
- **Save-state messaging.** Existing detail editor should show a small unsaved-changes hint when dirty, and clarify that Test Routine uses the saved/published workflow.

## Implementation Units

### U1. Workflow builder layout polish

**Goal:** Make the routine builder look and behave like a purpose-built editor.

**Files:**

- Modify: `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx`
- Modify: `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx`

**Approach:**

- Add catalog search state inside `RoutineWorkflowEditor`.
- Render the palette as compact rows with category labels, recipe id pills, and a right-aligned add icon/button.
- Improve the workflow empty state with a clear primary add-from-catalog affordance.
- Make workflow step blocks visually distinct with step number, recipe label, recipe id, and action icon buttons in a stable header.
- Keep the layout responsive: single column on smaller widths, two-pane on wide screens.

**Test Scenarios:**

- Catalog appears before a draft exists.
- Searching by recipe display name, id, or description filters the palette.
- Adding a recipe from a filtered palette creates a workflow block and clears no existing config.
- Long recipe descriptions truncate and do not stretch the layout.
- Reorder/remove buttons remain stable and accessible.

### U2. Better config field inputs

**Goal:** Match controls to the values users are editing.

**Files:**

- Modify: `apps/admin/src/components/routines/RoutineStepConfigEditor.tsx`

**Approach:**

- Use `<textarea>` for multiline fields: `body`, `code`, `sql`, `text`, `markdownContext`, `expression`, JSON-like values, and array/list input types.
- Keep select and number behavior as-is where appropriate.
- Display required markers in labels.
- Preserve `argsFromStepFields`, `valuesFromSteps`, and mutation conversion semantics.
- Use monospace textarea styling for `code`, `sql`, JSON-like fields, and path/expression-style fields.

**Test Scenarios:**

- Email body renders as a multiline textarea and still serializes as a string.
- Python code renders as a multiline monospace textarea and still serializes as a string.
- Email arrays/string arrays render as multiline text and still serialize to arrays split by comma/newline.
- Number and select fields continue to work.
- Read-only fields remain read-only and visually subdued.

### U3. Draft/save state copy and affordances

**Goal:** Make existing-routine editing feel safer.

**Files:**

- Modify: `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx`

**Approach:**

- Show an unsaved-changes hint on existing routine definitions when dirty.
- Keep Save disabled when clean.
- Add concise copy near the existing routine editor explaining that Test Routine uses the saved workflow.
- Make new-routine publish affordance read as publishing the current workflow, whether it came from prompt planning or manual recipe selection.

**Test Scenarios:**

- Existing routine editor shows no unsaved warning when clean.
- Adding/removing/reordering/changing config shows the unsaved warning and enables Save.
- Save clears the warning after the refreshed definition loads.
- New routine manual workflow can still publish without a planner prompt.

## Verification

- `pnpm --filter @thinkwork/api exec vitest run src/lib/routines/recipe-catalog.test.ts src/lib/routines/routine-authoring-planner.test.ts src/__tests__/routines-publish-flow.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/admin build`
- Browser smoke on the PR dev server:
  - Open `/automations/routines/new`
  - Confirm searchable catalog and polished workflow empty state
  - Add email block, fill multiline body, publish through mocked or deployed GraphQL as appropriate
  - Open routine detail, add/reorder/remove a step, confirm unsaved state and Save behavior
  - Check responsive snapshot around mobile/tablet width if practical in the browser tool
