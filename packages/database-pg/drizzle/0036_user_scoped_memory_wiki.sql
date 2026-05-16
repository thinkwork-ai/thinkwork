-- User-scoped memory/wiki migration.
--
-- Plan:
--   docs/plans/2026-04-24-001-refactor-user-scope-memory-and-hindsight-ingest-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0036_user_scoped_memory_wiki.sql
--
-- This is hand-rolled because ordering matters:
--   - validate user-owned threads can be backfilled from agents.human_pair_id
--   - add threads.user_id while keeping threads.agent_id
--   - truncate rebuildable wiki data before switching owner_id FKs
--   - skip that truncate on re-run once the old agent-owned FKs are gone
--   - add per-user external compile opt-in
--
-- creates-column: public.threads.user_id
-- creates-column: public.users.wiki_compile_external_enabled
-- creates: public.idx_threads_tenant_user
-- creates-constraint: public.threads.threads_user_id_users_id_fk
-- Wiki FK constraints below: schema/table paths updated post-0089. FK constraint
-- names retain their original 'wiki_<table>_owner_id_users_id_fk' form (0089 did not
-- rename FK constraints), but their pg_constraint namespace path moved to wiki.* when
-- their parent tables moved. Old `public.wiki_*` paths would report MISSING from the
-- drift reporter after 0089 applies.
-- creates-constraint: wiki.pages.wiki_pages_owner_id_users_id_fk
-- creates-constraint: wiki.unresolved_mentions.wiki_unresolved_mentions_owner_id_users_id_fk
-- creates-constraint: wiki.compile_jobs.wiki_compile_jobs_owner_id_users_id_fk
-- creates-constraint: wiki.compile_cursors.wiki_compile_cursors_owner_id_users_id_fk
-- creates-constraint: wiki.places.wiki_places_owner_id_users_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*)
    INTO orphan_count
  FROM public.threads t
  JOIN public.agents a ON a.id = t.agent_id
  WHERE a.source = 'user'
    AND a.human_pair_id IS NULL;

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Cannot backfill public.threads.user_id: % user-owned agent thread(s) lack agents.human_pair_id',
      orphan_count;
  END IF;
END $$;

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE public.threads t
SET user_id = a.human_pair_id
FROM public.agents a
WHERE a.id = t.agent_id
  AND a.source = 'user'
  AND t.user_id IS NULL;

ALTER TABLE public.threads
  DROP CONSTRAINT IF EXISTS threads_user_id_users_id_fk;

ALTER TABLE public.threads
  ADD CONSTRAINT threads_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS idx_threads_tenant_user
  ON public.threads (tenant_id, user_id);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wiki_compile_external_enabled boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  old_wiki_owner_fk_count integer;
BEGIN
  SELECT COUNT(*)
    INTO old_wiki_owner_fk_count
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'public'
    AND c.conname IN (
      'wiki_pages_owner_id_agents_id_fk',
      'wiki_unresolved_mentions_owner_id_agents_id_fk',
      'wiki_compile_jobs_owner_id_agents_id_fk',
      'wiki_compile_cursors_owner_id_agents_id_fk',
      'wiki_places_owner_id_agents_id_fk'
    );

  IF old_wiki_owner_fk_count > 0 THEN
    TRUNCATE TABLE
      public.wiki_pages,
      public.wiki_unresolved_mentions,
      public.wiki_compile_jobs,
      public.wiki_compile_cursors,
      public.wiki_places
    CASCADE;
  END IF;
END $$;

ALTER TABLE public.wiki_pages
  DROP CONSTRAINT IF EXISTS wiki_pages_owner_id_agents_id_fk;
ALTER TABLE public.wiki_unresolved_mentions
  DROP CONSTRAINT IF EXISTS wiki_unresolved_mentions_owner_id_agents_id_fk;
ALTER TABLE public.wiki_compile_jobs
  DROP CONSTRAINT IF EXISTS wiki_compile_jobs_owner_id_agents_id_fk;
ALTER TABLE public.wiki_compile_cursors
  DROP CONSTRAINT IF EXISTS wiki_compile_cursors_owner_id_agents_id_fk;
ALTER TABLE public.wiki_places
  DROP CONSTRAINT IF EXISTS wiki_places_owner_id_agents_id_fk;

ALTER TABLE public.wiki_pages
  DROP CONSTRAINT IF EXISTS wiki_pages_owner_id_users_id_fk;
ALTER TABLE public.wiki_unresolved_mentions
  DROP CONSTRAINT IF EXISTS wiki_unresolved_mentions_owner_id_users_id_fk;
ALTER TABLE public.wiki_compile_jobs
  DROP CONSTRAINT IF EXISTS wiki_compile_jobs_owner_id_users_id_fk;
ALTER TABLE public.wiki_compile_cursors
  DROP CONSTRAINT IF EXISTS wiki_compile_cursors_owner_id_users_id_fk;
ALTER TABLE public.wiki_places
  DROP CONSTRAINT IF EXISTS wiki_places_owner_id_users_id_fk;

ALTER TABLE public.wiki_pages
  ADD CONSTRAINT wiki_pages_owner_id_users_id_fk
  FOREIGN KEY (owner_id) REFERENCES public.users(id);
ALTER TABLE public.wiki_unresolved_mentions
  ADD CONSTRAINT wiki_unresolved_mentions_owner_id_users_id_fk
  FOREIGN KEY (owner_id) REFERENCES public.users(id);
ALTER TABLE public.wiki_compile_jobs
  ADD CONSTRAINT wiki_compile_jobs_owner_id_users_id_fk
  FOREIGN KEY (owner_id) REFERENCES public.users(id);
ALTER TABLE public.wiki_compile_cursors
  ADD CONSTRAINT wiki_compile_cursors_owner_id_users_id_fk
  FOREIGN KEY (owner_id) REFERENCES public.users(id);
ALTER TABLE public.wiki_places
  ADD CONSTRAINT wiki_places_owner_id_users_id_fk
  FOREIGN KEY (owner_id) REFERENCES public.users(id);

COMMIT;

-- Post-apply verification:
--   SELECT COUNT(*) FROM public.threads t JOIN public.agents a ON a.id = t.agent_id
--    WHERE a.source = 'user' AND t.user_id IS NULL; -- should be 0
--   SELECT COUNT(*) FROM public.wiki_pages;          -- should be 0 before journal reload
--   \d public.wiki_pages                             -- owner_id FK should reference users(id)
