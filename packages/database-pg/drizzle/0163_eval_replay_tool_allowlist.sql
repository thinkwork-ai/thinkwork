-- Purpose: per-tenant read-only MCP tool allowlist for eval replay
--          (Evaluations Trust Core U13). Replay strips all MCP tools by
--          default (mcp_configs undefined); this table is a DEFAULT-DENY
--          allowlist — a tool is restored on replay ONLY if an operator
--          explicitly lists it for the tenant. One row per
--          (tenant_id, server_name, tool_name).
-- Plan: docs/plans/2026-06-12-003-feat-evaluations-trust-core-plan.md (U13)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0163_eval_replay_tool_allowlist.sql
--
-- Hand-rolled (NOT registered in meta/_journal.json — the journal snapshot
-- stopped at 0020; repo convention is psql-applied files gated by the
-- db:migrate-manual drift reporter).
--
-- Semantics:
--   * Default-deny: an empty allowlist for a tenant means replay carries no
--     MCP servers (mcp_configs stays undefined — current safe behavior).
--   * Per-tool: only the listed (server_name, tool_name) pairs become the
--     entry's toolWhitelist on replay; mutating tools and the email/web
--     side-effect kill-list stay blocked regardless.
--   * Lands inert until the eval payload/worker (same PR) reads it.
--
-- creates: public.eval_replay_tool_allowlist
-- creates-constraint: public.eval_replay_tool_allowlist.eval_replay_tool_allowlist_tenant_id_tenants_id_fk
-- creates: public.uq_eval_replay_tool_allowlist_tenant_server_tool
-- creates: public.idx_eval_replay_tool_allowlist_tenant

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.eval_replay_tool_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  server_name text NOT NULL,
  tool_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eval_replay_tool_allowlist_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_replay_tool_allowlist_tenant_server_tool
  ON public.eval_replay_tool_allowlist (tenant_id, server_name, tool_name);

CREATE INDEX IF NOT EXISTS idx_eval_replay_tool_allowlist_tenant
  ON public.eval_replay_tool_allowlist (tenant_id);

COMMIT;
