-- Add the Customize-page anchor agent column on computers, plus a backfill
-- pass for existing rows. Greenfield Computer creation should set this
-- column at insert time; the backfill is a safety net for pre-existing
-- rows that were created before this column existed.
--
-- Plan:
--   docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0077_computers_primary_agent_id.sql
--
-- creates-column: public.computers.primary_agent_id
-- creates: public.idx_computers_primary_agent

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.computers
  ADD COLUMN IF NOT EXISTS primary_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_computers_primary_agent
  ON public.computers (primary_agent_id)
  WHERE primary_agent_id IS NOT NULL;

-- Backfill from migrated_from_agent_id where set. The fallback lookup
-- (single agent matching tenant_id + owner_user_id + template_id) is
-- handled in application code (primary-agent-resolver.ts) because it
-- requires conflict-aware error handling that doesn't fit a SQL backfill.
UPDATE public.computers
   SET primary_agent_id = migrated_from_agent_id
 WHERE primary_agent_id IS NULL
   AND migrated_from_agent_id IS NOT NULL;

COMMIT;
