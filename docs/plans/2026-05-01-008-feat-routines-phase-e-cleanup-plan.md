---
title: "feat: Routines rebuild Phase E — cleanup and observability"
type: feat
status: active
date: 2026-05-01
origin: docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md
---

# feat: Routines rebuild Phase E — cleanup and observability

## Summary

Final cleanup and observability for the Routines rebuild. Archive legacy Python-script routines and remove the deprecated GraphQL types + code paths. Ship the operator-only `python()` usage dashboard that surfaces frequency + signature clusters across the tenant's routines, drives the recipe-promotion loop, and surfaces promoted-recipe candidates for refactor.

## Closeout Status

Partially complete; keep this plan active. U15's legacy archival and deprecated `RoutineRun` / `RoutineStep` cleanup landed through follow-up work, including mobile parity so old GraphQL consumers could be removed safely. U16 remains open: no admin `python()` usage dashboard or signature-clustering query is currently implemented.

## Next Implementation Slice

Implement U16 as the next routine PR. Keep it narrowly scoped to observability and recipe-promotion signal; do not reopen authoring or execution behavior in this slice.

### Recommended Scope

- Add `pythonUsageDashboard(tenantId: ID!, windowDays: Int): PythonUsageDashboard!`.
- Query only `routine_step_events` for `recipe_type = 'python'` in the requested window.
- Group rows by deterministic signature hash. For v0, use stable fields already present in `input_json`; include code/function shape and network allowlist when present. Do not add LLM summarization yet.
- Return totals, clusters, last seen, count, percent of total `python()` use, and top routine/execution links.
- Add an admin Automations page for the dashboard with an empty state when there are no `python()` steps.
- Keep route and resolver admin-only via the existing tenant-admin patterns.

### Suggested Files

- `packages/database-pg/graphql/types/routines.graphql`
- `packages/api/src/graphql/resolvers/routines/pythonUsageDashboard.query.ts`
- `packages/api/src/graphql/resolvers/routines/index.ts`
- `packages/api/src/__tests__/routines-publish-flow.test.ts` or a focused routines dashboard test file
- `apps/admin/src/lib/graphql-queries.ts`
- `apps/admin/src/routes/_authed/_tenant/automations/python-usage/index.tsx`
- generated GraphQL files for admin/API/CLI/mobile if schema/codegen requires them

### Verification

- Unit test: empty tenant returns zero totals and no clusters.
- Unit test: multiple `python` step events with the same signature cluster together.
- Unit test: tenant scoping prevents cross-tenant counts.
- UI manual check: dashboard empty state and populated table render without schedule/webhook concepts leaking into Routines.
- Run codegen if GraphQL schema changes.
- Run API tests that cover the new resolver and admin typecheck.

---

## Problem Frame

Phase E of the master plan (`docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`). After Phases A-D, the new Step Functions runtime is live across admin and mobile surfaces, with agent tool shells present but still requiring runtime activation verification. U15 removed the legacy clutter that blocked schema cleanup; U16 still needs to give ops the data needed to drive recipe curation by showing which `python()` patterns customers are reaching for repeatedly.

---

## Requirements

R-IDs trace to the origin requirements doc.

- R24, R25. Legacy Python routine archival + deprecation removal (U15).
- R26, R27. `python()` usage dashboard with frequency, signature clusters, drill-down, and promotion-candidate badges (U16).

**Origin actors:** A2 (operator viewing dashboard), A4 (ThinkWork engineer reviewing for promotion).
**Origin flows:** F5 (recipe promotion).
**Origin acceptance examples:** AE6 (signature clustering for repeated `python()` patterns).

---

## Scope Boundaries

- No new step types or runtime changes (Phases A/B own those).
- No new authoring surfaces (Phase C).
- No new run UI (Phase D).
- Origin Scope Boundaries carried forward unchanged.

### Deferred to Follow-Up Work

- Phase A (Substrate) — `docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md` (must merge first)
- Phase B (Runtime) — `docs/plans/2026-05-01-005-feat-routines-phase-b-runtime-plan.md` (must merge first)
- Phase C (Authoring) — `docs/plans/2026-05-01-006-feat-routines-phase-c-authoring-plan.md` (must merge first)
- Phase D (UI) — `docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md` (must merge first)
- LLM-summarized `python()` signature clustering (deferred from origin); v0 uses signature-hash only.

---

## Context & Research

Defer to the master plan's "Context & Research" section. Phase-E-specific highlights:

- `packages/database-pg/src/schema/routines.ts` — `engine` partition column from Phase A U2 segregates legacy from new
- `packages/api/src/graphql/resolvers/triggers/index.ts` — residual comment mentions the now-removed legacy `routineRun` / `routineRuns` query surfaces
- `packages/database-pg/graphql/types/routines.graphql` — deprecated `RoutineRun` and `RoutineStep` types have been removed; only `RoutineStepEvent` remains
- `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` — list filter `engine = 'step_functions'`
- `apps/admin/src/routes/_authed/_tenant/analytics.tsx` — admin-only dashboard pattern
- `docs/solutions/workflow-issues/survey-before-applying-parent-plan-destructive-work-2026-04-24.md` — survey live consumers before destructive change

---

## Key Technical Decisions

Carry from the master plan (Phase E-relevant subset):

- **Archival is set-status, not delete** — recoverable if a customer demo turns out to depend on a legacy routine.
- **Pre-flight survey** — query dev DB for `engine = 'legacy_python'` row count + tenant breakdown before running the archival migration.
- **`python()` clustering uses signature hash** (function name + sorted-arg-shape from AST extraction) for v0; LLM-summarized clustering deferred.
- **Dashboard is admin-only**, gated with `requireTenantAdmin`.

---

## Open Questions

### Resolved During Planning

All Phase E open questions resolved in the master plan.

### Deferred to Implementation

- Pre-archival survey: which tenants have legacy routines, how many active, and whether any are pinned demos. Surface count + tenant breakdown before applying the migration.
- U15 already removed the deprecated `RoutineRun` / `RoutineStep` consumers and types after mobile parity landed.

---

## Implementation Units

Units carried verbatim from the master plan. U-IDs preserved.

- U15. **Legacy Python routine archival + deprecation**

**Goal:** Mark legacy Python routines as archived (R24), remove the deprecated GraphQL fields and code paths (R25), surface deprecation warnings in any remaining consumer.

**Status:** Completed. See `docs/residual-review-findings/feat-routines-phase-d-mobile-parity.md` for the mobile parity and deprecated-type cleanup closeout notes.

**Requirements:** R24, R25

**Dependencies:** All preceding phases — cleanup is last.

**Files:**
- Create: `packages/database-pg/drizzle/NNNN_archive_legacy_python_routines.sql` (UPDATE routines SET status='archived' WHERE engine='legacy_python')
- Modify: `packages/database-pg/graphql/types/routines.graphql` (remove deprecated `RoutineRun` and `RoutineStep` types; remove the deprecated `update_routine` mutation if it was kept through Phases A-D)
- Modify: `packages/api/src/graphql/resolvers/triggers/routineRuns.query.ts` (delete or redirect to `routineExecutions`)
- Modify: `packages/api/src/graphql/resolvers/triggers/routineRun.query.ts` (delete)
- Modify: `apps/mobile/prompts/routine-builder.ts` (final scrub for any Python-code references that survived Phase C)
- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/index.tsx` (filter `engine = 'step_functions'` only — exclude archived legacy)

**Approach:**
- Pre-flight: query dev DB for `engine = 'legacy_python'` row count + tenant breakdown; share with the user (or operator) before running the archival migration.
- Archival is `UPDATE ... SET status='archived'`, not delete.
- Survey consumers (existing tenant routines, scheduled_jobs rows pointing at archived routines, GraphQL queries) before deleting types.
- Bump GraphQL schema; codegen ripples through to apps; remove now-orphaned imports.

**Test scenarios:**
- Happy path: archival migration on dev results in 0 active legacy routines
- Happy path: GraphQL deprecated types removed; codegen rebuilds without them
- Edge case: a `scheduled_jobs` row pointing at an archived routine surfaces a clear "routine archived" message instead of silent failure
- Verification: no residual references to `update_routine` Python code path in any source file

**Verification:**
- `pnpm typecheck` clean across all consumers after deprecated types removed
- `grep -rn "update_routine.*code" apps/ packages/` returns zero results
- `grep -rn "RoutineRun\|RoutineStep" --include='*.ts' --include='*.graphql' packages/ apps/` returns only the new types (or zero, if fully renamed)

---

- U16. **`python()` usage dashboard (admin only)**

**Goal:** Operator dashboard surfacing `python()` step frequency + signature clusters across the tenant's routines, with drill-down to the routines using each pattern and promotion-candidate badges.

**Status:** Open. No `pythonUsageDashboard` GraphQL query or admin route exists yet.

**Requirements:** R26, R27, AE6

**Dependencies:** Phase B U9 (`routine_step_events` populated), Phase D U12 (admin nav has `/automations/python-usage` slot)

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/automations/python-usage/index.tsx`
- Create: `apps/admin/src/components/routines/PythonUsageDashboard.tsx`
- Create: `packages/api/src/graphql/resolvers/routines/pythonUsageDashboard.query.ts`
- Modify: `packages/database-pg/graphql/types/routines.graphql` (add `pythonUsageDashboard(tenantId: ID!): PythonUsageDashboard!` query type)

**Approach:**
- Dashboard query aggregates `routine_step_events` rows where `recipe_type = 'python'` over a window (default 30 days), groups by signature hash. Signature hash = SHA-256 over `(function-name, sorted-arg-shape, network-grant)` extracted from `input_json`.
- Each cluster row: signature label, count, % of total `python()` use, last_seen, top 5 routines using this pattern (drill-down).
- Promotion candidate badge: show if the signature has been previously promoted to a curated recipe in a later release; link to the recipe.
- Admin-only route, gated with `requireTenantAdmin`.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/analytics.tsx` (admin-only dashboard)
- `packages/api/src/graphql/resolvers/analytics/*` (aggregate query pattern)

**Test scenarios:**
- Happy path: covers AE6 — five routines with same Stripe-API signature cluster together
- Edge case: tenant with zero `python()` steps shows empty state
- Integration: drill-down from cluster row navigates to one of the routines; the `python` step is highlighted in the run-detail graph

**Verification:**
- Manual on dev — generate 3 routines with similar `python()` steps; dashboard clusters them
- `pnpm --filter @thinkwork/admin typecheck` passes

---

## System-Wide Impact

- **Interaction graph:** Removing legacy types ripples through all four GraphQL consumers via codegen. The `python()` dashboard is purely additive — new admin route, new resolver, no runtime touch.
- **Error propagation:** Scheduled jobs pointing at archived routines must surface clear errors (test scenario in U15).
- **State lifecycle risks:** Archival is reversible (status flag, not delete); audit log captures the migration timestamp.
- **Unchanged invariants:** All Phase A-D code paths unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Customer demo pinned to a legacy routine fails after archival | Pre-flight survey + status archival (not delete); operator can revert in one UPDATE |
| Deprecated GraphQL type removal breaks an unknown consumer | grep all consumers; codegen catches at typecheck |
| Signature-hash clustering produces too-broad clusters | Tune the hash to include sorted-arg-shape + network-grant; if still noisy, follow-up plan adds LLM summarization |
| Promotion-candidate badge wrong (signature was promoted but routine still uses python) | Cross-check against the recipe catalog at query time; signature → recipe-id mapping lives in the catalog module |
| `routine_step_events` row count grows unbounded | Existing high-volume event table pattern (`thread_turn_events`) handles this; add retention policy in a follow-up |

---

## Sources & References

- **Master design plan:** `docs/plans/2026-05-01-003-feat-routines-step-functions-rebuild-plan.md`
- **Origin requirements:** `docs/brainstorms/2026-05-01-routines-step-functions-rebuild-requirements.md`
- **Predecessors:** Phase A, B, C, D plans (all must merge first)
