---
title: Fix Artifact Builder Dashboard UI Contract
status: completed
created: 2026-05-13
origin: user request
---

# Fix Artifact Builder Dashboard UI Contract

## Problem

CRM dashboard applets can currently pass generation and save validation while rendering as a vertical stack of full-width metric cards with inconsistent spacing. The skill text asks for dense dashboards, but it still permits metric panels built from raw `Card` composition and it does not stop generated TSX from relying on ad hoc Tailwind grid utilities for the core dashboard layout.

That is brittle for two reasons: prompt guidance drifts under pressure, and generated class names may not be present in the deployed iframe CSS bundle. The fix needs to make the good path easier and the bad path impossible to persist for CRM dashboards.

## Scope

In scope:

- Tighten the CRM artifact-generation instructions in the installed workspace defaults and published CRM dashboard skill.
- Add API-side CRM dashboard quality checks before applets are persisted.
- Add tests that reject the observed bad layout shape and accept the stdlib-driven dashboard shape.

Out of scope:

- Rerendering or rewriting already-saved artifact source.
- Building visual scoring or screenshot critique for generated dashboards.
- Changing the general applet runtime, preview flow, or tenant theme injection.
- Broad Tailwind safelisting or transform-time Tailwind compilation.

## Requirements

- R1. CRM dashboard applets must use `@thinkwork/computer-stdlib` dashboard primitives for the main dashboard shape, especially `KpiStrip` for top-level metrics.
- R2. CRM dashboard applets must not hand-compose top-level KPI metrics as a vertical stack of full-width `Card` components.
- R3. CRM dashboard applets must not rely on generated responsive Tailwind grid-column utilities for their core dashboard layout.
- R4. Save-time validation must return actionable errors before bad CRM dashboards are persisted.
- R5. Non-CRM generated applets should keep the existing source policy.
- R6. Skill guidance must tell artifact-producing agents which primitives to use and which layout patterns will be rejected.

## Existing Patterns

- `packages/api/src/lib/applets/validation.ts` already centralizes applet syntax, import, runtime, and CRM-specific quality checks.
- `packages/api/src/__tests__/applets-validation.test.ts` already covers CRM dashboard component requirements and forbidden patterns.
- `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md` is the installed artifact-builder contract for Computer workspaces.
- `packages/workspace-defaults/files/skills/artifact-builder/references/crm-dashboard.md` is the compatibility CRM dashboard reference loaded by artifact-builder.
- `packages/skill-catalog/crm-dashboard/SKILL.md` and `packages/skill-catalog/crm-dashboard/references/produce.md` are the published runbook skill path.
- `packages/computer-stdlib/src/primitives/KpiStrip.tsx` already supports both `cards` and `kpis`, so guidance can standardize on `cards={data.kpis}` without a runtime change.

## Decisions

- Require `KpiStrip` for CRM dashboard KPIs instead of allowing `Card` as an equivalent metric primitive. `Card` remains available for chart and section containers.
- Require a `@thinkwork/computer-stdlib` import for CRM dashboards so the validator catches artifacts that only use generic shadcn layout.
- Reject CRM dashboards that include responsive grid-column layout utilities such as `grid-cols-*` or `md:grid-cols-*`. CRM dashboards should use compiled stdlib layout primitives for KPI and chart structure.
- Keep this scoped to CRM dashboard detection via existing metadata/name heuristics so other applets are not surprised by the stricter CRM contract.

## Implementation Units

### U1. Enforce CRM Dashboard Layout Contract

Files:

- `packages/api/src/lib/applets/validation.ts`
- `packages/api/src/__tests__/applets-validation.test.ts`

Behavior:

- CRM dashboard validation requires imports from both `@thinkwork/ui` and `@thinkwork/computer-stdlib`.
- CRM dashboard validation requires JSX usage of `KpiStrip`.
- CRM dashboard validation rejects generated responsive grid-column utility classes in the source.
- Existing raw table, raw button, emoji, and component checks continue to run.

Tests:

- Accept a CRM dashboard source that imports `@thinkwork/ui`, imports `KpiStrip` from `@thinkwork/computer-stdlib`, renders a table, and uses approved chart/table components.
- Reject a CRM dashboard source that renders multiple metric `Card` components without `KpiStrip`.
- Reject a CRM dashboard source that uses `grid grid-cols-*` classes for dashboard layout.
- Preserve existing non-CRM applet validation behavior.

### U2. Tighten Artifact Builder And CRM Skill Guidance

Files:

- `packages/workspace-defaults/files/skills/artifact-builder/SKILL.md`
- `packages/workspace-defaults/files/skills/artifact-builder/references/crm-dashboard.md`
- `packages/workspace-defaults/src/__tests__/artifact-builder.test.ts`
- `packages/skill-catalog/crm-dashboard/SKILL.md`
- `packages/skill-catalog/crm-dashboard/references/produce.md`
- `packages/skill-catalog/__tests__/runbook-skill-contract.test.ts`

Behavior:

- The artifact-builder and CRM dashboard skill docs state that CRM KPIs must use `KpiStrip`, not hand-composed metric cards.
- The guidance points agents toward `@thinkwork/computer-stdlib` primitives for CRM dashboards and warns that raw responsive grid utility layouts will be rejected.
- Existing theme, shadcn, and no-emoji rules remain intact.

Tests:

- Workspace-default tests assert the artifact-builder skill documents `KpiStrip` as mandatory for CRM dashboard KPIs and forbids full-width KPI card stacks.
- Skill-catalog tests assert the CRM dashboard runbook produce guidance includes the same hard UI contract.

### U3. Verification And PR

Checks:

- `pnpm --filter @thinkwork/api test -- src/__tests__/applets-validation.test.ts`
- `pnpm --filter @thinkwork/workspace-defaults test`
- `pnpm --filter @thinkwork/skill-catalog test`
- Run focused typecheck or broader checks if the touched package scripts require it.

Review:

- Run the Compound code-review autofix pass against this plan before opening the PR.

## Risks

- Existing saved CRM applets that fail the stricter source policy may need regeneration rather than source edits. That is acceptable because this change is about preventing new bad artifacts from being saved.
- A future CRM dashboard may need layout primitives beyond `KpiStrip`, charts, and `DataTable`. Add those to `@thinkwork/computer-stdlib` rather than re-opening arbitrary layout CSS as the default.
