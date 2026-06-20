-- Roll back workflow control-plane schema.
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0177_workflow_control_plane_rollback.sql

DROP TABLE IF EXISTS public.workflow_evidence;
DROP TABLE IF EXISTS public.workflow_run_events;
DROP TABLE IF EXISTS public.workflow_runs;
DROP TABLE IF EXISTS public.workflow_engine_bindings;
DROP TABLE IF EXISTS public.workflow_triggers;
DROP TABLE IF EXISTS public.workflow_versions;
DROP TABLE IF EXISTS public.workflows;
