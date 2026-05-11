-- Add `favorited_at` to artifacts so users can star artifacts and the
-- apps/computer sidebar can show a Favorites section.
--
-- Plan:
--   docs/plans/2026-05-10-005-feat-computer-ui-updates-plan.md (U3)
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0084_artifacts_favorited_at.sql
--
-- creates-column: public.artifacts.favorited_at
-- creates: public.idx_artifacts_favorited_at

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS favorited_at timestamptz;

-- Partial index covers the sidebar query
-- (favorited_at IS NOT NULL, ORDER BY favorited_at DESC) without
-- bloating the table-wide index footprint for the un-favorited common
-- case. Tenant_id leads so the same query stays fast under multi-tenant
-- access patterns.
CREATE INDEX IF NOT EXISTS idx_artifacts_favorited_at
  ON public.artifacts (tenant_id, favorited_at DESC)
  WHERE favorited_at IS NOT NULL;

COMMIT;
