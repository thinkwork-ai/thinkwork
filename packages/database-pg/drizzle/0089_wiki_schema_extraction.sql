-- 0089_wiki_schema_extraction.sql
--
-- Phase A of the wiki + brain schema extraction (PR 1 of 3-PR arc).
-- Moves 9 wiki tables from public.* into the new `wiki.*` Postgres schema,
-- drops the redundant `wiki_` prefix from internal table names, renames
-- indexes/constraints to match, and creates compat views in public.* so old
-- bundled Lambda code keeps reading during the deploy bridge window.
--
-- Tables moved:
--   public.wiki_pages               → wiki.pages
--   public.wiki_page_sections       → wiki.page_sections
--   public.wiki_page_links          → wiki.page_links
--   public.wiki_page_aliases        → wiki.page_aliases
--   public.wiki_unresolved_mentions → wiki.unresolved_mentions
--   public.wiki_section_sources     → wiki.section_sources
--   public.wiki_compile_jobs        → wiki.compile_jobs
--   public.wiki_compile_cursors     → wiki.compile_cursors
--   public.wiki_places              → wiki.places
--
-- FK constraints follow their parent tables automatically (Postgres
-- preserves them across SET SCHEMA). Cross-schema FKs to public.tenants
-- and public.users continue to work — see Key Technical Decisions in the
-- plan for the rationale (compliance precedent stripped FKs for RTBF
-- isolation; wiki preserves them to honor 'keep functionality'). FK
-- constraint names retain their original 'wiki_<table>_*' prefix — a
-- cosmetic cleanup can come later. No FK-rename markers below.
--
-- Compat views: each table also gets a view in public.* aliasing the new
-- location. Old bundled Lambdas (graphql-http, wiki-compile,
-- wiki-bootstrap-import, memory-retain) continue reading via
-- `public.wiki_pages` during the deploy bridge window; new Lambdas read
-- `wiki.pages` directly. PR 3 (cleanup) drops the views once deploys
-- stabilize. Postgres simple views are auto-updatable, so any write paths
-- via the old names also work transparently.
--
-- Plan reference:   docs/plans/2026-05-16-001-refactor-wiki-brain-schema-extraction-plan.md
-- Origin brainstorm: docs/brainstorms/2026-05-16-wiki-brain-schema-extraction-requirements.md
-- Pattern doc:      docs/solutions/database-issues/feature-schema-extraction-pattern.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0089_wiki_schema_extraction.sql
-- Then verify:
--   pnpm db:migrate-manual
--   psql -c "\dt wiki.*"      -- 9 tables expected
--   psql -c "\dv public.wiki_*"  -- 9 compat views expected
--   psql -c "\dt public.wiki_*"  -- 0 tables expected
--
-- Inverse runbook (rollback): drop the views, then SET SCHEMA back, then
-- RENAME back. Indexes and constraints follow their parent table's schema
-- automatically. After SET SCHEMA moves the table to public, its indexes
-- live in public — so ALTER INDEX statements must qualify with `public.`,
-- not `wiki.`.
--   DROP VIEW IF EXISTS public.wiki_pages, public.wiki_page_sections, ...;
--   ALTER TABLE wiki.pages SET SCHEMA public;    -- index moves to public too
--   ALTER TABLE public.pages RENAME TO wiki_pages;
--   ALTER INDEX public.idx_pages_owner RENAME TO idx_wiki_pages_owner;  -- × 28 indexes
--   ... (× 9 tables, parent-last so FKs into pages are still valid through the move)
--   DROP SCHEMA wiki;   -- last step; fails if any objects remain in wiki schema
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- creates: wiki.pages
-- creates: wiki.page_sections
-- creates: wiki.page_links
-- creates: wiki.page_aliases
-- creates: wiki.unresolved_mentions
-- creates: wiki.section_sources
-- creates: wiki.compile_jobs
-- creates: wiki.compile_cursors
-- creates: wiki.places
-- creates: wiki.uq_pages_tenant_owner_type_slug
-- creates: wiki.idx_pages_tenant_owner_type_status
-- creates: wiki.idx_pages_owner
-- creates: wiki.idx_pages_last_compiled
-- creates: wiki.idx_pages_entity_subtype
-- creates: wiki.idx_pages_search_tsv
-- creates: wiki.idx_pages_parent
-- creates: wiki.idx_pages_place_id
-- creates: wiki.idx_pages_title_trgm
-- creates: wiki.uq_page_sections_page_slug
-- creates: wiki.idx_page_sections_page_position
-- creates: wiki.uq_page_links_from_to_kind
-- creates: wiki.idx_page_links_to
-- creates: wiki.idx_page_links_kind
-- creates: wiki.uq_page_aliases_page_alias
-- creates: wiki.idx_page_aliases_alias
-- creates: wiki.idx_page_aliases_alias_trgm
-- creates: wiki.uq_unresolved_mentions_scope_alias_status
-- creates: wiki.idx_unresolved_mentions_tenant_owner_status
-- creates: wiki.idx_unresolved_mentions_status_last_seen
-- creates: wiki.uq_section_sources_section_kind_ref
-- creates: wiki.idx_section_sources_kind_ref
-- creates: wiki.idx_compile_jobs_scope_status_created
-- creates: wiki.idx_compile_jobs_status_created
-- creates: wiki.idx_places_tenant_owner
-- creates: wiki.idx_places_parent
-- creates: wiki.uq_places_scope_google_place_id
-- creates-constraint: wiki.compile_cursors.compile_cursors_pkey
-- creates-constraint: wiki.unresolved_mentions.unresolved_mentions_entity_subtype_allowed
-- creates: wiki.compile_jobs_dedupe_key_unique
-- creates: public.wiki_pages
-- creates: public.wiki_page_sections
-- creates: public.wiki_page_links
-- creates: public.wiki_page_aliases
-- creates: public.wiki_unresolved_mentions
-- creates: public.wiki_section_sources
-- creates: public.wiki_compile_jobs
-- creates: public.wiki_compile_cursors
-- creates: public.wiki_places

\set ON_ERROR_STOP on

BEGIN;

-- Set timeouts BEFORE acquiring the advisory lock so the lock acquisition
-- itself is bounded. Without this ordering, a concurrent transaction holding
-- the same advisory lock would cause this migration to block indefinitely.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

-- Serialize concurrent application attempts (two operators racing, automation
-- + operator overlap). Without the advisory lock, two transactions can both
-- pass the pre-flight invariants before either commits.
SELECT pg_advisory_xact_lock(hashtext('wiki_schema_extraction'));

-- Refuse to apply against an unexpected DB. Hand-rolled migrations are
-- applied by an operator and a stale DATABASE_URL pointing at a non-dev
-- target would create the schema in the wrong place.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight invariants: refuse to re-apply over a partially-completed
-- previous run. For each table, assert old name exists AND new name does
-- not. Symmetric checks across all 9 tables convert any partial-state
-- scenario into a clear pre-flight error rather than an opaque
-- mid-migration DDL crash.
DO $$
BEGIN
  IF to_regclass('public.wiki_pages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_pages does not exist';
  END IF;
  IF to_regclass('wiki.pages') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.pages already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_page_sections') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_page_sections does not exist';
  END IF;
  IF to_regclass('wiki.page_sections') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.page_sections already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_page_links') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_page_links does not exist';
  END IF;
  IF to_regclass('wiki.page_links') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.page_links already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_page_aliases') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_page_aliases does not exist';
  END IF;
  IF to_regclass('wiki.page_aliases') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.page_aliases already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_unresolved_mentions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_unresolved_mentions does not exist';
  END IF;
  IF to_regclass('wiki.unresolved_mentions') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.unresolved_mentions already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_section_sources') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_section_sources does not exist';
  END IF;
  IF to_regclass('wiki.section_sources') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.section_sources already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_compile_jobs') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_compile_jobs does not exist';
  END IF;
  IF to_regclass('wiki.compile_jobs') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.compile_jobs already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_compile_cursors') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_compile_cursors does not exist';
  END IF;
  IF to_regclass('wiki.compile_cursors') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.compile_cursors already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.wiki_places') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.wiki_places does not exist';
  END IF;
  IF to_regclass('wiki.places') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.places already exists — refusing to re-apply';
  END IF;
END $$;

-- Schema creation.
CREATE SCHEMA IF NOT EXISTS wiki;
COMMENT ON SCHEMA wiki IS 'Compounding-memory wiki tables. Compiled pages, sections, links, aliases, places, and the compile-job ledger. Extracted from public.* on 2026-05-16.';

-- ── Move and rename tables ─────────────────────────────────────────────
-- FK-leaf-first ordering. Postgres preserves FKs across SET SCHEMA
-- automatically; ordering matters only for operator mental model.

ALTER TABLE public.wiki_compile_cursors SET SCHEMA wiki;
ALTER TABLE wiki.wiki_compile_cursors RENAME TO compile_cursors;

ALTER TABLE public.wiki_compile_jobs SET SCHEMA wiki;
ALTER TABLE wiki.wiki_compile_jobs RENAME TO compile_jobs;

ALTER TABLE public.wiki_section_sources SET SCHEMA wiki;
ALTER TABLE wiki.wiki_section_sources RENAME TO section_sources;

ALTER TABLE public.wiki_page_links SET SCHEMA wiki;
ALTER TABLE wiki.wiki_page_links RENAME TO page_links;

ALTER TABLE public.wiki_page_aliases SET SCHEMA wiki;
ALTER TABLE wiki.wiki_page_aliases RENAME TO page_aliases;

ALTER TABLE public.wiki_page_sections SET SCHEMA wiki;
ALTER TABLE wiki.wiki_page_sections RENAME TO page_sections;

ALTER TABLE public.wiki_unresolved_mentions SET SCHEMA wiki;
ALTER TABLE wiki.wiki_unresolved_mentions RENAME TO unresolved_mentions;

ALTER TABLE public.wiki_places SET SCHEMA wiki;
ALTER TABLE wiki.wiki_places RENAME TO places;

-- wiki_pages depends on wiki_places (FK place_id) and is depended on by
-- everything else; move it after its sibling-FK target (places) and before
-- its dependents are no longer needed.
ALTER TABLE public.wiki_pages SET SCHEMA wiki;
ALTER TABLE wiki.wiki_pages RENAME TO pages;

-- ── Rename indexes to drop wiki_ prefix ────────────────────────────────
-- Indexes move with their parent table via SET SCHEMA; only the names need
-- updating to match the new Drizzle source.

ALTER INDEX wiki.uq_wiki_pages_tenant_owner_type_slug RENAME TO uq_pages_tenant_owner_type_slug;
ALTER INDEX wiki.idx_wiki_pages_tenant_owner_type_status RENAME TO idx_pages_tenant_owner_type_status;
ALTER INDEX wiki.idx_wiki_pages_owner RENAME TO idx_pages_owner;
ALTER INDEX wiki.idx_wiki_pages_last_compiled RENAME TO idx_pages_last_compiled;
ALTER INDEX wiki.idx_wiki_pages_entity_subtype RENAME TO idx_pages_entity_subtype;
ALTER INDEX wiki.idx_wiki_pages_search_tsv RENAME TO idx_pages_search_tsv;
ALTER INDEX wiki.idx_wiki_pages_parent RENAME TO idx_pages_parent;
ALTER INDEX wiki.idx_wiki_pages_place_id RENAME TO idx_pages_place_id;
ALTER INDEX wiki.idx_wiki_pages_title_trgm RENAME TO idx_pages_title_trgm;

ALTER INDEX wiki.uq_wiki_page_sections_page_slug RENAME TO uq_page_sections_page_slug;
ALTER INDEX wiki.idx_wiki_page_sections_page_position RENAME TO idx_page_sections_page_position;

ALTER INDEX wiki.uq_wiki_page_links_from_to_kind RENAME TO uq_page_links_from_to_kind;
ALTER INDEX wiki.idx_wiki_page_links_to RENAME TO idx_page_links_to;
ALTER INDEX wiki.idx_wiki_page_links_kind RENAME TO idx_page_links_kind;

ALTER INDEX wiki.uq_wiki_page_aliases_page_alias RENAME TO uq_page_aliases_page_alias;
ALTER INDEX wiki.idx_wiki_page_aliases_alias RENAME TO idx_page_aliases_alias;
ALTER INDEX wiki.idx_wiki_page_aliases_alias_trgm RENAME TO idx_page_aliases_alias_trgm;

ALTER INDEX wiki.uq_wiki_unresolved_mentions_scope_alias_status RENAME TO uq_unresolved_mentions_scope_alias_status;
ALTER INDEX wiki.idx_wiki_unresolved_mentions_tenant_owner_status RENAME TO idx_unresolved_mentions_tenant_owner_status;
ALTER INDEX wiki.idx_wiki_unresolved_mentions_status_last_seen RENAME TO idx_unresolved_mentions_status_last_seen;

ALTER INDEX wiki.uq_wiki_section_sources_section_kind_ref RENAME TO uq_section_sources_section_kind_ref;
ALTER INDEX wiki.idx_wiki_section_sources_kind_ref RENAME TO idx_section_sources_kind_ref;

ALTER INDEX wiki.idx_wiki_compile_jobs_scope_status_created RENAME TO idx_compile_jobs_scope_status_created;
ALTER INDEX wiki.idx_wiki_compile_jobs_status_created RENAME TO idx_compile_jobs_status_created;

ALTER INDEX wiki.idx_wiki_places_tenant_owner RENAME TO idx_places_tenant_owner;
ALTER INDEX wiki.idx_wiki_places_parent RENAME TO idx_places_parent;
ALTER INDEX wiki.uq_wiki_places_scope_google_place_id RENAME TO uq_places_scope_google_place_id;

-- ── Rename named constraints to drop wiki_ prefix ──────────────────────

ALTER TABLE wiki.compile_cursors RENAME CONSTRAINT wiki_compile_cursors_pkey TO compile_cursors_pkey;
ALTER TABLE wiki.unresolved_mentions RENAME CONSTRAINT wiki_unresolved_mentions_entity_subtype_allowed TO unresolved_mentions_entity_subtype_allowed;

-- The auto-generated UNIQUE constraint on compile_jobs.dedupe_key. Drizzle
-- names this `<table>_<column>_unique` — the SET SCHEMA preserved its index
-- (named after the constraint), but the index name still has the wiki_
-- prefix. Rename to match the new naming.
ALTER INDEX wiki.wiki_compile_jobs_dedupe_key_unique RENAME TO compile_jobs_dedupe_key_unique;

-- ── Compat views in public.* ────────────────────────────────────────────
-- Old bundled Lambda code references public.wiki_*. The views resolve to
-- the new schema-qualified tables, keeping the deploy bridge window safe.
-- Postgres simple views are auto-updatable (writes pass through to the
-- underlying table), so any write paths via the old name continue to work
-- as well. PR 3 drops these.

-- wiki.pages has a `search_tsv` GENERATED ALWAYS column. A SELECT * compat
-- view exposes that column, which causes any old INSERT that explicitly
-- names it in the column list to fail with `column search_tsv is a
-- generated column`. Enumerating columns and omitting search_tsv makes the
-- view auto-update-safe: Postgres regenerates search_tsv from the
-- GENERATED ALWAYS expression on write through the view. Other 8 tables
-- have no generated columns and SELECT * is fine.
CREATE VIEW public.wiki_pages AS
  SELECT id, tenant_id, owner_id, type, entity_subtype, slug, title,
         summary, body_md, status, parent_page_id, place_id,
         hubness_score, tags, last_compiled_at, created_at, updated_at
  FROM wiki.pages;
CREATE VIEW public.wiki_page_sections AS SELECT * FROM wiki.page_sections;
CREATE VIEW public.wiki_page_links AS SELECT * FROM wiki.page_links;
CREATE VIEW public.wiki_page_aliases AS SELECT * FROM wiki.page_aliases;
CREATE VIEW public.wiki_unresolved_mentions AS SELECT * FROM wiki.unresolved_mentions;
CREATE VIEW public.wiki_section_sources AS SELECT * FROM wiki.section_sources;
CREATE VIEW public.wiki_compile_jobs AS SELECT * FROM wiki.compile_jobs;
CREATE VIEW public.wiki_compile_cursors AS SELECT * FROM wiki.compile_cursors;
CREATE VIEW public.wiki_places AS SELECT * FROM wiki.places;

COMMIT;
