-- Safe rollback for 0178_workflow_backfill_existing_routines.sql.
--
-- Apply manually only before any backfilled workflow has accumulated product
-- run evidence:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0178_workflow_backfill_existing_routines_rollback.sql
--
-- This rollback intentionally does not drop the 0177 control-plane schema.
-- It removes only workflow identities whose Step Functions binding was stamped
-- by the 0178 backfill and that have no workflow_runs. If a workflow has runs,
-- keep the projection and use the application-level disable-new-writes rollback
-- described in docs/runbooks/workflow-control-plane-migration.md.

DROP VIEW IF EXISTS public.view_workflow_backfill_existing_routines_status;

DELETE FROM public.workflows w
WHERE EXISTS (
  SELECT 1
    FROM public.workflow_engine_bindings b
   WHERE b.workflow_id = w.id
     AND b.binding_type = 'step_functions_routine'
     AND b.connection_ref->>'backfillMigration' = '0178_workflow_backfill_existing_routines'
)
AND NOT EXISTS (
  SELECT 1
    FROM public.workflow_runs wr
   WHERE wr.workflow_id = w.id
);
