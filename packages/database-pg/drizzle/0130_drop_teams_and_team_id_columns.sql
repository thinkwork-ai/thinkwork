-- 0130_drop_teams_and_team_id_columns.sql
--
-- Drops the teams feature end-to-end.
--
-- Origin: docs/brainstorms/2026-05-24-codebase-and-database-simplification-cleanup-requirements.md
--
-- Removes the three team tables (teams, team_users, team_agents) and the
-- four orphan team_id columns left on routines/scheduled_jobs/workflow_configs/
-- cost_events after the teams feature was retired in this PR. The
-- computer_assignments.team_id column is intentionally NOT dropped here —
-- computer_assignments goes away entirely in the P3 Computer-residual sweep,
-- and dropping the column requires invalidating the multi-CHECK constraint
-- that distinguishes user vs team subject types. Cleanup of that column
-- ships with T4.
--
-- Apply manually after merge:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0130_drop_teams_and_team_id_columns.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0130_drop_teams_and_team_id_columns.sql
--
-- drops: public.teams
-- drops: public.team_users
-- drops: public.team_agents
-- drops-column: public.routines.team_id
-- drops-column: public.scheduled_jobs.team_id
-- drops-column: public.workflow_configs.team_id
-- drops-column: public.cost_events.team_id

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_teams_and_team_id_columns'));

-- Drop the workflow_configs team index that referenced team_id
DROP INDEX IF EXISTS public.workflow_configs_tenant_team_idx;

-- Drop team_id columns from alive tables
ALTER TABLE public.routines DROP COLUMN IF EXISTS team_id;
ALTER TABLE public.scheduled_jobs DROP COLUMN IF EXISTS team_id;
ALTER TABLE public.workflow_configs DROP COLUMN IF EXISTS team_id;
ALTER TABLE public.cost_events DROP COLUMN IF EXISTS team_id;

-- Drop the teams tables themselves. CASCADE handles any incidental FKs
-- (the only internal FKs are team_users.team_id and team_agents.team_id
-- pointing back at teams, which CASCADE removes implicitly via table drop).
DROP TABLE IF EXISTS public.team_users CASCADE;
DROP TABLE IF EXISTS public.team_agents CASCADE;
DROP TABLE IF EXISTS public.teams CASCADE;

COMMIT;
