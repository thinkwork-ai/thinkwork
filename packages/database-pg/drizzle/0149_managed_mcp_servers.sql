-- Purpose: add explicit ownership metadata for ThinkWork-managed MCP servers.
-- Plan: docs/plans/2026-06-06-003-feat-twenty-crm-mcp-oauth-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0149_managed_mcp_servers.sql
-- Pre-flight:
--   SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenant_mcp_servers' AND column_name IN ('management_source', 'managed_application_key');
--   SELECT to_regclass('public.uq_tenant_mcp_servers_managed_application');
-- creates-column: public.tenant_mcp_servers.management_source
-- creates-column: public.tenant_mcp_servers.managed_application_key
-- creates: public.uq_tenant_mcp_servers_managed_application
-- creates-constraint: public.tenant_mcp_servers.tenant_mcp_servers_management_source_check
-- creates-constraint: public.tenant_mcp_servers.tenant_mcp_servers_managed_application_shape_check

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('migration:0149_managed_mcp_servers'));

ALTER TABLE public.tenant_mcp_servers
  ADD COLUMN IF NOT EXISTS management_source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS managed_application_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_mcp_servers_management_source_check'
      AND conrelid = 'public.tenant_mcp_servers'::regclass
  ) THEN
    ALTER TABLE public.tenant_mcp_servers
      ADD CONSTRAINT tenant_mcp_servers_management_source_check
      CHECK (management_source IN ('manual', 'managed_application'))
      NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_mcp_servers_managed_application_shape_check'
      AND conrelid = 'public.tenant_mcp_servers'::regclass
  ) THEN
    ALTER TABLE public.tenant_mcp_servers
      ADD CONSTRAINT tenant_mcp_servers_managed_application_shape_check
      CHECK (
        (management_source = 'manual' AND managed_application_key IS NULL)
        OR (management_source = 'managed_application' AND managed_application_key IS NOT NULL)
      )
      NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_mcp_servers_managed_application
  ON public.tenant_mcp_servers (tenant_id, managed_application_key)
  WHERE managed_application_key IS NOT NULL;

COMMIT;
