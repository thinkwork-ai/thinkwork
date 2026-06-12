-- Purpose: space-local Agent Profiles (dynamic workspace U7). Profiles defined
--   under a Space source's agents/ folder project into agent_profiles scoped to
--   that Space via source_space_id (NULL = central/agent-source profile). Slug
--   uniqueness becomes per-origin: central keeps tenant+slug uniqueness, while
--   space-local rows are unique per (tenant, slug, source_space_id) so a
--   space-local slug may intentionally shadow a central one while its Space is
--   active.
-- Plan: docs/plans/2026-06-12-002-feat-dynamic-workspace-plan.md U7
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0159_agent_profiles_space_local.sql
-- creates-column: public.agent_profiles.source_space_id
-- creates-constraint: public.agent_profiles.agent_profiles_source_space_id_spaces_id_fk
-- creates: public.uq_agent_profiles_tenant_slug
-- creates: public.uq_agent_profiles_tenant_slug_source_space

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0159_agent_profiles_space_local'));

ALTER TABLE public.agent_profiles
  ADD COLUMN IF NOT EXISTS source_space_id uuid;

DO $$
BEGIN
  ALTER TABLE public.agent_profiles
    ADD CONSTRAINT agent_profiles_source_space_id_spaces_id_fk
    FOREIGN KEY (source_space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Recreate the tenant+slug uniqueness as a partial index over central rows
-- only; space-local rows get their own per-Space uniqueness.
DROP INDEX IF EXISTS uq_agent_profiles_tenant_slug;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profiles_tenant_slug
  ON public.agent_profiles (tenant_id, slug)
  WHERE source_space_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_profiles_tenant_slug_source_space
  ON public.agent_profiles (tenant_id, slug, source_space_id)
  WHERE source_space_id IS NOT NULL;

SELECT pg_advisory_unlock(hashtext('migration:0159_agent_profiles_space_local'));
