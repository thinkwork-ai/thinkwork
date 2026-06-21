---
title: "Workflow/Routine reference cleanup audit"
date: 2026-06-21
module: workflows
status: active
tags:
  - workflows
  - routines
  - compatibility
---

# Workflow/Routine reference cleanup audit

This audit supports THNK-59 U8. The cleanup is intentionally not a
find-and-replace: Workflow is now the product/control-plane noun, while Routine
remains the Step Functions adapter name, compatibility API name, table prefix,
and historical documentation term until the adapter is retired.

## Product-Facing Changes Made

- Settings navigation presents `Workflows`, not `Routines`.
- `/settings/routines` redirects to `/settings/workflows`.
- Routine detail and execution deep links remain compatibility routes that
  redirect to the matching Workflow detail/run when a binding exists.
- Current operator docs now describe multi-step work as Workflows, with
  Step Functions/Routine called out only as adapter evidence.
- Customize's older reusable `workflowCatalog` surface is clarified as
  Workflow templates, not active Workflow inventory.
- Additive GraphQL aliases were added:
  `workflowTemplateCatalog`, `WorkflowTemplateCatalogItem`,
  `WorkflowTemplateBinding`, `enableWorkflowTemplate`,
  `disableWorkflowTemplate`, and `connectedWorkflowTemplateSlugs`.

## References Intentionally Kept

- `routine_*` tables, Drizzle schema names, and Step Functions callback handler
  names remain because they describe the native Step Functions adapter.
- GraphQL Routine types and mutations remain as compatibility API. Agent/admin
  tool aliases are owned by the later workflow invocation unit.
- `routine_invoke`, `publishRoutineVersion`, `triggerRoutineRun`, and related
  recipe/API names remain where they are the concrete adapter contract.
- CLI docs still list the actual `thinkwork routine` command surface until the
  CLI/API workflow invocation aliases land.
- Historical `docs/solutions/**` entries keep Routine terminology when they
  document the original Routine rebuild or recipe-catalog architecture.

## Review Heuristic

New product/UI/docs copy should prefer Workflow. New code may use Routine only
when it is inside the Step Functions adapter, preserving compatibility APIs, or
referencing historical artifacts. If a new user-facing surface says Routine, it
should explain that it is a Step Functions adapter detail.
