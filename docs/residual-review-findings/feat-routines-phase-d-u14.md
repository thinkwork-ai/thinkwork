# Residual Review Findings — feat/routines-phase-d-u14

**Plan**: docs/plans/2026-05-01-007-feat-routines-phase-d-ui-plan.md (U14)
**Branch**: feat/routines-phase-d-u14
**Review**: self-review across standard lenses

No P0/P1. Items below are P3 polish.

## Residual findings

- **P3 [testing] no unit tests for `parseStatusFilter` or pagination cursor logic**. The exported helpers are pure; a vitest suite covering "unknown status normalizes to all" / "valid pill ids round-trip" / "cursor-stack push and pop are inverse" would be cheap insurance.

- **P3 [maintainability] `TERMINAL_STATUSES` duplicated from U13's run-detail page**. The same set lives in `routines/$routineId.executions.$executionId.tsx`. A small `apps/admin/src/lib/routines/status.ts` module exporting the canonical set + helpers (`isTerminal`, `parseStatusFilter`) would dedupe and become the natural home for the next routine-status helper that surfaces.

- **P3 [reliability] AppSync subscription deferred**. The plan accepts polling for U14; `OnRoutineExecutionUpdated` (mirroring the existing `OnThreadTurnUpdatedSubscription` pattern) is the natural follow-up once subscription wiring extends cleanly to `routine_executions`. At 4-tenant scale, 5s polling is fine.

- **P3 [advisory] cursor uses `started_at` only**. Brand-new executions with `started_at IS NULL` fall back to `created_at`, which works but mixes two columns at the boundary. The resolver enforces ordering; if a future schema change drops `started_at` in favor of `created_at`-only, this fallback becomes load-bearing rather than defensive.

## Deferred from U14

- **Mobile parity** — `apps/mobile/app/routines/[id]/index.tsx` mobile run list. Admin is the primary operator surface; mobile parity unblocks F1 but isn't load-bearing for the v1 demo.

- **`OnRoutineExecutionUpdated` subscription** — replaces the 5s poll once AppSync wiring extends cleanly.
