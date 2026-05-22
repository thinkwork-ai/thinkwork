-- Drop the computer-runbook tables introduced in 0083_computer_runbooks.sql.
-- Runbooks are being retired as a platform feature — the runbook-shaped
-- skills (crm-dashboard, research-dashboard, map-artifact) have been
-- rewritten as regular agentskills.io skills that compose with the
-- platform artifact-builder skill, and the runbook orchestration
-- machinery in the Strands runtime + the API resolvers + the
-- packages/agentcore-strands runbook code paths have all been removed.
-- See refactor commit "drop runbook functionality entirely (L3)".
--
-- The dev tenant has no production data in these tables that needs
-- preserving; this is a destructive drop. The indexes drop with the
-- tables via CASCADE-on-drop-table.
--
-- drops: public.tenant_runbook_catalog
-- drops: public.computer_runbook_runs
-- drops: public.computer_runbook_tasks

\set ON_ERROR_STOP on

BEGIN;

DROP TABLE IF EXISTS public.computer_runbook_tasks;
DROP TABLE IF EXISTS public.computer_runbook_runs;
DROP TABLE IF EXISTS public.tenant_runbook_catalog;

COMMIT;
