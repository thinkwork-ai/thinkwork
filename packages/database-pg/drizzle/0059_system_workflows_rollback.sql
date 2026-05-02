-- Rollback for 0059_system_workflows.sql.

\set ON_ERROR_STOP on

BEGIN;

DROP TABLE IF EXISTS public.system_workflow_change_events;
DROP TABLE IF EXISTS public.system_workflow_evidence;
DROP TABLE IF EXISTS public.system_workflow_step_events;
DROP TABLE IF EXISTS public.system_workflow_runs;
DROP TABLE IF EXISTS public.system_workflow_extension_bindings;
DROP TABLE IF EXISTS public.system_workflow_configs;
DROP TABLE IF EXISTS public.system_workflow_definitions;

COMMIT;
