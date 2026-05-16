-- 0091_drop_wiki_brain_compat_views.sql
--
-- Phase C / PR 3 of 3 in the wiki+brain schema extraction arc. Drops the
-- 15 compatibility views in `public.*` that 0089 (wiki) and 0090 (brain)
-- created as a deploy bridge. The views protected old bundled Lambda
-- READ paths during the brief window between psql apply and Lambda
-- redeploy completing; now that both PRs have merged + stabilized in
-- prod, no consumer reads through these names anymore and the views
-- can come down.
--
-- Views dropped:
--   public.wiki_pages, public.wiki_page_sections, public.wiki_page_links,
--   public.wiki_page_aliases, public.wiki_unresolved_mentions,
--   public.wiki_section_sources, public.wiki_compile_jobs,
--   public.wiki_compile_cursors, public.wiki_places,
--   public.tenant_entity_pages, public.tenant_entity_page_sections,
--   public.tenant_entity_page_links, public.tenant_entity_page_aliases,
--   public.tenant_entity_section_sources, public.tenant_entity_external_refs
--
-- Pre-merge consumer survey: verified zero production code references
-- these names (excludes the legitimate test fixture in
-- packages/database-pg/__tests__/schema-customize-retirement.test.ts
-- which only grep-checks 0087's literal text, and excludes historical
-- migration files 0036/0051/0087 which document past state).
--
-- Plan reference:    docs/plans/2026-05-16-001-refactor-wiki-brain-schema-extraction-plan.md
-- Origin brainstorm: docs/brainstorms/2026-05-16-wiki-brain-schema-extraction-requirements.md
-- Pattern doc:       docs/solutions/database-issues/feature-schema-extraction-pattern.md
-- Wiki PR (merged):  #1251
-- Brain PR (merged): #1259
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0091_drop_wiki_brain_compat_views.sql
-- Then verify:
--   pnpm db:migrate-manual packages/database-pg/drizzle/0091_drop_wiki_brain_compat_views.sql
--   psql -c "\dv public.wiki_*"           -- 0 views expected
--   psql -c "\dv public.tenant_entity_*"  -- 0 views expected
--   psql -c "\dt wiki.*"                  -- 9 tables still present
--   psql -c "\dt brain.*"                 -- 6 tables still present
--
-- Inverse runbook (rollback): re-create each view. Mirror of 0089/0090's
-- CREATE VIEW statements — see those migration headers for the column
-- enumeration on public.wiki_pages and public.tenant_entity_pages views
-- (both omit the GENERATED ALWAYS search_tsv column).
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- drops: public.wiki_pages
-- drops: public.wiki_page_sections
-- drops: public.wiki_page_links
-- drops: public.wiki_page_aliases
-- drops: public.wiki_unresolved_mentions
-- drops: public.wiki_section_sources
-- drops: public.wiki_compile_jobs
-- drops: public.wiki_compile_cursors
-- drops: public.wiki_places
-- drops: public.tenant_entity_pages
-- drops: public.tenant_entity_page_sections
-- drops: public.tenant_entity_page_links
-- drops: public.tenant_entity_page_aliases
-- drops: public.tenant_entity_section_sources
-- drops: public.tenant_entity_external_refs

\set ON_ERROR_STOP on

BEGIN;

-- Set timeouts before any potentially blocking operation. DROP VIEW is
-- fast but takes ACCESS EXCLUSIVE on the view's name — and any query in
-- flight against the view holds an ACCESS SHARE that briefly blocks the
-- DROP. Bounded waits ensure the migration fails fast if a long-running
-- query holds a lock.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

-- Serialize concurrent application attempts.
SELECT pg_advisory_xact_lock(hashtext('drop_wiki_brain_compat_views'));

-- Refuse to apply against an unexpected DB.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight: wiki.* and brain.* must exist (0089 + 0090 must have applied)
-- before it makes sense to drop their compat views.
DO $$
BEGIN
  IF to_regclass('wiki.pages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.pages does not exist — 0089 must apply before 0091';
  END IF;
  IF to_regclass('brain.pages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.pages does not exist — 0090 must apply before 0091';
  END IF;
END $$;

-- Drop the wiki compat views (9). IF EXISTS so re-running is safe.
DROP VIEW IF EXISTS public.wiki_pages;
DROP VIEW IF EXISTS public.wiki_page_sections;
DROP VIEW IF EXISTS public.wiki_page_links;
DROP VIEW IF EXISTS public.wiki_page_aliases;
DROP VIEW IF EXISTS public.wiki_unresolved_mentions;
DROP VIEW IF EXISTS public.wiki_section_sources;
DROP VIEW IF EXISTS public.wiki_compile_jobs;
DROP VIEW IF EXISTS public.wiki_compile_cursors;
DROP VIEW IF EXISTS public.wiki_places;

-- Drop the brain compat views (6).
DROP VIEW IF EXISTS public.tenant_entity_pages;
DROP VIEW IF EXISTS public.tenant_entity_page_sections;
DROP VIEW IF EXISTS public.tenant_entity_page_links;
DROP VIEW IF EXISTS public.tenant_entity_page_aliases;
DROP VIEW IF EXISTS public.tenant_entity_section_sources;
DROP VIEW IF EXISTS public.tenant_entity_external_refs;

COMMIT;
