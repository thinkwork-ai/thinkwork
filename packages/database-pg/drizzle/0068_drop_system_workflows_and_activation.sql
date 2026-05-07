-- 0068_drop_system_workflows_and_activation.sql
--
-- Phase 2 U6 of the System Workflows revert. Final unit. Drops the 11
-- Postgres tables that backed the SW + Activation features:
--   - 4 activation tables (sessions, session_turns, apply_outbox, automation_candidates)
--   - 7 SW tables (definitions, configs, extension_bindings, runs, step_events,
--     evidence, change_events)
-- Plus all the indexes/constraints declared by the deleted create-migrations
-- (0038, 0039, 0041, 0059, 0060). DROP TABLE CASCADE handles the runtime
-- removal of indexes alongside their parent tables.
--
-- Plan reference:
--   docs/plans/2026-05-06-010-refactor-system-workflows-u6-postgres-schema-plan.md
--   docs/plans/2026-05-06-001-refactor-system-workflows-activation-removal-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0068_drop_system_workflows_and_activation.sql
-- Then verify:
--   psql "$DATABASE_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('activation_sessions','activation_session_turns','activation_apply_outbox','activation_automation_candidates','system_workflow_definitions','system_workflow_configs','system_workflow_extension_bindings','system_workflow_runs','system_workflow_step_events','system_workflow_evidence','system_workflow_change_events');"
--   (expect 0 rows)
--
-- Markers (consumed by scripts/db-migrate-manual.sh as the post-deploy drift gate):
-- This file declares no creates. The drops markers below probe ABSENCE
-- of each named object. Tables and indexes/constraints are dropped
-- together via CASCADE; markers are enumerated for full audit trail of
-- what disappears.
--
-- drops: public.activation_sessions
-- drops: public.activation_session_turns
-- drops: public.activation_apply_outbox
-- drops: public.activation_automation_candidates
-- drops: public.system_workflow_definitions
-- drops: public.system_workflow_configs
-- drops: public.system_workflow_extension_bindings
-- drops: public.system_workflow_runs
-- drops: public.system_workflow_step_events
-- drops: public.system_workflow_evidence
-- drops: public.system_workflow_change_events
-- drops: public.idx_activation_sessions_user_status
-- drops: public.idx_activation_sessions_tenant
-- drops: public.uq_activation_sessions_user_in_progress
-- drops: public.idx_activation_session_turns_session_order
-- drops: public.idx_activation_apply_outbox_status_created
-- drops: public.idx_activation_apply_outbox_session
-- drops: public.idx_activation_automation_candidates_session
-- drops: public.idx_activation_automation_candidates_user_status
-- drops: public.uq_activation_automation_candidates_active_duplicate
-- drops: public.idx_system_workflow_definitions_category
-- drops: public.idx_system_workflow_definitions_status
-- drops: public.idx_system_workflow_configs_tenant_workflow_version
-- drops: public.idx_system_workflow_configs_tenant_workflow_status
-- drops: public.idx_system_workflow_extension_bindings_tenant_workflow
-- drops: public.idx_system_workflow_extension_bindings_config
-- drops: public.idx_system_workflow_runs_sfn_arn
-- drops: public.idx_system_workflow_runs_tenant_workflow_started
-- drops: public.idx_system_workflow_runs_tenant_status
-- drops: public.idx_system_workflow_runs_domain_ref
-- drops: public.idx_system_workflow_step_events_run
-- drops: public.idx_system_workflow_step_events_dedup
-- drops: public.idx_system_workflow_step_events_tenant_step
-- drops: public.idx_system_workflow_evidence_run
-- drops: public.idx_system_workflow_evidence_tenant_type
-- drops: public.idx_system_workflow_evidence_dedup
-- drops: public.idx_system_workflow_change_events_tenant_workflow
-- drops: public.idx_system_workflow_change_events_run
-- drops: public.idx_system_workflow_runs_domain_ref_dedup

\set ON_ERROR_STOP on

BEGIN;

-- Fail fast on lock contention. The 11 tables have no live writers
-- (U2 deleted the GraphQL surface, U3 deleted the Lambda library, U5
-- destroyed the Step Functions module), so a 5s wait is more than
-- sufficient; if a stale connection holds a lock past that, abort
-- rather than wedge the cluster behind a long-held ACCESS EXCLUSIVE
-- lock. Mirrors the pattern from 0031_thread_cleanup_drops.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Refuse to apply against an unexpected DB. The drop is irreversible
-- without RDS snapshot restore, so an in-script guard against stale
-- DATABASE_URL pointing at a localhost Postgres or a non-dev RDS is
-- cheap insurance.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Drop System Workflows tables (children before parents).
-- CASCADE removes incidental constraints + drops indexes alongside their
-- parent tables; the ordering here is belt-and-suspenders.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.system_workflow_change_events CASCADE;
DROP TABLE IF EXISTS public.system_workflow_evidence CASCADE;
DROP TABLE IF EXISTS public.system_workflow_step_events CASCADE;
DROP TABLE IF EXISTS public.system_workflow_runs CASCADE;
DROP TABLE IF EXISTS public.system_workflow_extension_bindings CASCADE;
DROP TABLE IF EXISTS public.system_workflow_configs CASCADE;
DROP TABLE IF EXISTS public.system_workflow_definitions CASCADE;

-- ---------------------------------------------------------------------------
-- Drop Activation tables (children before parents).
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.activation_apply_outbox CASCADE;
DROP TABLE IF EXISTS public.activation_automation_candidates CASCADE;
DROP TABLE IF EXISTS public.activation_session_turns CASCADE;
DROP TABLE IF EXISTS public.activation_sessions CASCADE;

COMMIT;
