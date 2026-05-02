# Residual Review Findings — feat/routines-phase-e-u15

**Plan**: docs/plans/2026-05-01-008-feat-routines-phase-e-cleanup-plan.md (U15)
**Branch**: feat/routines-phase-e-u15
**Review**: self-review across standard lenses (correctness, security, data-migrations, maintainability, project-standards)

No P0/P1 findings. The diff is small (archival SQL migration + GraphQL query selection cleanup + admin list filter). Items below are scope cuts the plan called for but mobile's still-pending parity blocks.

## Residual findings

- **P2 [maintainability] deprecated `RoutineRun` + `RoutineStep` GraphQL types still ship**. Plan §U15 calls for their removal. Mobile's `apps/mobile/app/routines/[id]/index.tsx`, `[id]/runs/index.tsx`, and `[id]/runs/[runId].tsx` still consume the types via the legacy `RoutineRunsQuery` / `RoutineRunDetailQuery`. Removing the types here would break mobile in a "cleanup" PR. Resolution: gate type removal on the deferred Phase D mobile-parity PR (the one that swaps mobile to `routineExecutions`).

- **P2 [maintainability] deprecated `routineRuns` + `routineRun` resolvers still wired**. Same reason as above — they back the mobile queries. Delete in the same follow-up PR that swaps mobile.

- **P3 [maintainability] `routines.code` column not dropped**. Per user guidance: behavioral risk warrants explicit handler accounting before drop (e.g., any reader still expecting the field needs to be migrated first). The legacy code-factory mobile flow was retired in Phase C U10 and the deprecated `update_routine` mutation has no callers (verified by grep), so a cleanup follow-up could safely drop the column. Tracked here so it doesn't fall off.

- **P3 [data-migration] hand-rolled migration drift report**. Migration 0057 is hand-rolled (matches the project's pattern for partial indices, CHECK constraints, etc.). The `-- creates-column: public.routines.archived_at_legacy_cutover` marker is in place so `pnpm db:migrate-manual` reports application status. The migration must be applied via `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0057_archive_legacy_python_routines.sql` against each stage before deploy.yml's drift gate goes green.

- **P3 [advisory] dev DB has 0 routines**. Pre-flight query confirmed the migration is purely defensive on dev. Real legacy_python rows (if any exist on prod after Phase A's substrate migration runs) will get archived on first apply.

## Deferred to Phase E follow-ups

- **Mobile run-detail parity**: swap `apps/mobile/app/routines/[id]/index.tsx` + the `runs/` subroutes from RoutineRun → RoutineExecution. Mirror admin's Phase D U13/U14 work.
- **Type + resolver removal**: gated on the mobile parity above. Delete `RoutineRun` + `RoutineStep` types from `routines.graphql`, delete the resolver files, regen all consumers.
- **`routines.code` column drop**: defensive sequence — confirm no remaining reader, then `ALTER TABLE routines DROP COLUMN code` in a hand-rolled migration.
- **`Routine.runs @deprecated` field**: still on the type but selected by no query after this PR. Removable in the same follow-up that kills `RoutineRun`.

## Advisory

- **[learnings] gradual schema deprecation pattern**. This PR demonstrates the right pattern for retiring shared types: drop selections from queries first (this PR), THEN remove the underlying types in a follow-up once the deprecated-type's consumer count is zero. Worth a small docs/solutions entry.
