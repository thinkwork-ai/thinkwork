-- Hand-rolled — apply manually to dev via:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0161_tenant_mcp_servers_plugin_source.sql
--
-- See docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
--
-- U10 of docs/plans/2026-06-12-001-feat-application-plugins-plan.md.
-- Extends the tenant_mcp_servers management_source CHECK constraints
-- (created by 0149) to recognize the 'plugin' ownership source used by the
-- plugin engine's MCP component handler (0159 added plugin_install_id but
-- did not relax the checks):
--
--   - management_source may now be 'manual' | 'managed_application' | 'plugin'
--   - shape: plugin rows must carry plugin_install_id; managed_application
--     rows must carry managed_application_key; manual rows carry neither
--     ownership key. An ADOPTED Twenty row (U10 cutover) is
--     management_source='plugin' with plugin_install_id set and its
--     legacy managed_application_key retained — covered by the plugin arm,
--     which does not constrain managed_application_key.
--
-- The new constraints are renamed *_v2 so the drift reporter at
-- scripts/db-migrate-manual.sh can verify application (probing by name).
-- The old constraints are DROPped in the same transaction.
--
-- creates-constraint: public.tenant_mcp_servers.tenant_mcp_servers_management_source_check_v2
-- creates-constraint: public.tenant_mcp_servers.tenant_mcp_servers_managed_application_shape_check_v2

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('migration:0161_tenant_mcp_servers_plugin_source'));

ALTER TABLE public.tenant_mcp_servers
  DROP CONSTRAINT IF EXISTS tenant_mcp_servers_management_source_check;

ALTER TABLE public.tenant_mcp_servers
  DROP CONSTRAINT IF EXISTS tenant_mcp_servers_management_source_check_v2;

ALTER TABLE public.tenant_mcp_servers
  ADD CONSTRAINT tenant_mcp_servers_management_source_check_v2
  CHECK (management_source IN ('manual', 'managed_application', 'plugin'))
  NOT VALID;

ALTER TABLE public.tenant_mcp_servers
  DROP CONSTRAINT IF EXISTS tenant_mcp_servers_managed_application_shape_check;

ALTER TABLE public.tenant_mcp_servers
  DROP CONSTRAINT IF EXISTS tenant_mcp_servers_managed_application_shape_check_v2;

ALTER TABLE public.tenant_mcp_servers
  ADD CONSTRAINT tenant_mcp_servers_managed_application_shape_check_v2
  CHECK (
    (management_source = 'manual' AND managed_application_key IS NULL)
    OR (management_source = 'managed_application' AND managed_application_key IS NOT NULL)
    OR (management_source = 'plugin' AND plugin_install_id IS NOT NULL)
  )
  NOT VALID;

COMMIT;
