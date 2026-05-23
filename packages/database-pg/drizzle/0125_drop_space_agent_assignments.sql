-- 0125_drop_space_agent_assignments.sql
--
-- Drops the retired Space-agent assignment table after the platform-agent
-- collapse and GraphQL/admin consumer rewrites have shipped.
--
-- Plan: docs/plans/2026-05-22-005-refactor-single-platform-agent-and-space-runtime-overrides-plan.md (U1b)
-- Dependencies:
--   - U3 merged: cold-contact no longer resolves agents through assignments.
--   - U5/U7 merged: GraphQL/admin/API consumers no longer read assignments.
--   - U6 merged: legacy email paths no longer need assignment-era agent email state.
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0125_drop_space_agent_assignments.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0125_drop_space_agent_assignments.sql
--
-- The table's local_instructions values were backfilled into spaces.prompt
-- by the U2 collapse migration before this drop. The remaining columns
-- (local_role, auto_subscribe, allowed_capabilities, allowed_tools, status)
-- are retired with the per-Space agent assignment model.
--
-- drops: public.space_agent_assignments
-- drops: public.uq_space_agent_assignments_agent
-- drops: public.idx_space_agent_assignments_agent
-- drops: public.idx_space_agent_assignments_space
-- drops-constraint: public.space_agent_assignments.space_agent_assignments_tenant_id_tenants_id_fk
-- drops-constraint: public.space_agent_assignments.space_agent_assignments_space_id_spaces_id_fk
-- drops-constraint: public.space_agent_assignments.space_agent_assignments_agent_id_agents_id_fk
-- drops-constraint: public.space_agent_assignments.space_agent_assignments_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_space_agent_assignments'));

DROP TABLE IF EXISTS public.space_agent_assignments CASCADE;

COMMIT;
