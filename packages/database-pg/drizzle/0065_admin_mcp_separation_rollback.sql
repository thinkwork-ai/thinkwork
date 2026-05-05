-- Rollback for 0065_admin_mcp_separation.sql.
--
-- Drops the join tables first (FKs to admin_mcp_servers), then the
-- admin_mcp_servers table, then the is_admin trigger + column.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_agent_template_admin_mcp_servers_template;
DROP INDEX IF EXISTS public.uq_agent_template_admin_mcp_servers;
DROP TABLE IF EXISTS public.agent_template_admin_mcp_servers;

DROP INDEX IF EXISTS public.idx_agent_admin_mcp_servers_agent;
DROP INDEX IF EXISTS public.uq_agent_admin_mcp_servers;
DROP TABLE IF EXISTS public.agent_admin_mcp_servers;

DROP INDEX IF EXISTS public.idx_admin_mcp_servers_tenant;
DROP INDEX IF EXISTS public.uq_admin_mcp_servers_slug;
DROP TABLE IF EXISTS public.admin_mcp_servers;

DROP TRIGGER IF EXISTS agent_templates_is_admin_one_way ON public.agent_templates;
DROP FUNCTION IF EXISTS public.enforce_agent_templates_is_admin_one_way();

ALTER TABLE public.agent_templates
  DROP COLUMN IF EXISTS is_admin;

COMMIT;
