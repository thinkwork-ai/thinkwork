# Residual Review Findings — feat/routines-phase-d-mobile-parity

**Plan**: docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md (U13/U14 mobile parity)
**Branch**: feat/routines-phase-d-mobile-parity
**Review**: self-review across standard lenses (correctness, security, testing, maintainability, project-standards, kieran-typescript)

No P0/P1 findings. The PR has two commits — first the swap, then the type-removal cleanup. The cleanup commit closes the U15 residual ("deprecated RoutineRun + RoutineStep types still ship") that was waiting on this. Items below are P3 polish.

## Residual findings

- **P3 [maintainability] step manifest is null on mobile too**. Same Phase E schema gap that admin has: `RoutineExecution.aslVersion` doesn't yet expose a pointer to the routine_asl_versions row that backed THIS execution. ExecutionGraphMobile falls back to the events-only derivation (correct once any event has landed; renders empty for a brand-new execution). The fix is the same Phase E schema add — once `RoutineExecution.aslVersion` lands, both admin + mobile pick it up by extending their queries.

- **P3 [maintainability] `latestEventByNode` + `deriveNodes` duplicated**. Two copies now exist: one in `apps/admin/src/components/routines/ExecutionGraph.tsx`, one in `apps/mobile/components/routines/ExecutionGraphMobile.tsx`. Per the plan's "Implementation-Time Unknowns" call, sharing was deliberately deferred. A `packages/ui-routines` (or similar shared package) is the natural home once a third consumer surfaces.

- **P3 [testing] no unit tests for the mobile helpers**. `latestEventByNode` and `deriveNodes` are pure functions worth a vitest suite — same coverage as admin would benefit from.

- **P3 [maintainability] markdown rendering on mobile uses `react-markdown` directly**. Admin has a wrapper `MarkdownSummary.tsx` with anchor-click handling; mobile renders raw markdown. The anchor-click → step-select integration the plan calls out for admin doesn't apply on mobile (touch targets work differently), but if a future shared `MarkdownSummary` lands, mobile picks up consistency.

- **P3 [reliability] AppState gate is set in a `useEffect` that sets `appActive` initially from `AppState.currentState`**. Edge case: if the screen mounts while the app is already backgrounding, the polling effect still races. In practice the next `AppState.change` event corrects it within milliseconds. Worth a regression check if mobile sees stale-poll bugs.

- **P3 [advisory] retired the `runs/` subdirectory routes entirely**. Operators with bookmarked deep-links to `/routines/[id]/runs/[runId]` now hit a 404 on mobile. v1 mobile is TestFlight-only with a small user pool; the redirect surface isn't worth the extra code in this PR. If/when mobile graduates from TestFlight, add a 301-style redirect shim mirroring admin's Phase D U12 pattern.

## What this PR closes

- ✅ Deferred mobile parity for Phase D U13 (run-detail) — `apps/mobile/app/routines/[id]/executions/[executionId].tsx` + ExecutionGraphMobile component
- ✅ Deferred mobile parity for Phase D U14 (run list) — `apps/mobile/app/routines/[id]/index.tsx` swapped from useRoutineRuns to useRoutineExecutions
- ✅ U15 residual: deprecated RoutineRun + RoutineStep types removed (mobile was the last consumer)
- ✅ U15 residual: routineRuns + routineRun resolvers deleted

## Phase D + E status after this PR

- ✅ U12 — admin nav restructure
- ✅ U13 — run-detail surface (admin + mobile)
- ✅ U14 — run-list with filters (admin + mobile)
- ✅ U15 — legacy archival + admin filter + (now) deprecated type removal
- ⏳ U16 — `python()` usage dashboard
- ⏳ Schema follow-ups bundle (RoutineExecution.aslVersion, visibility/owning_agent_id, routines.code drop)
- ⏳ AppSync subscription wiring (replaces 5s poll)
