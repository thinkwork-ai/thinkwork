-- 0090_brain_schema_extraction.sql
--
-- Phase B of the wiki + brain schema extraction (PR 2 of 3-PR arc).
-- Moves 6 brain tables from public.* into the new `brain.*` Postgres schema,
-- drops the redundant `tenant_entity_` prefix from internal table names,
-- renames indexes/constraints to match, and creates compat views in public.*
-- so old bundled Lambda code keeps reading during the deploy bridge window.
--
-- Tables moved:
--   public.tenant_entity_pages           → brain.pages
--   public.tenant_entity_page_sections   → brain.page_sections
--   public.tenant_entity_page_links      → brain.page_links
--   public.tenant_entity_page_aliases    → brain.page_aliases
--   public.tenant_entity_section_sources → brain.section_sources
--   public.tenant_entity_external_refs   → brain.external_refs
--
-- FK constraints follow their parent tables automatically (Postgres preserves
-- them across SET SCHEMA). Cross-schema FKs to public.tenants continue to
-- work — see Key Technical Decisions in the wiki+brain plan for the rationale.
-- FK constraint names retain their original tenant_entity_* prefix — a
-- cosmetic cleanup can come later. No FK-rename markers below.
--
-- Compat views: each table also gets a view in public.* aliasing the new
-- location. Old bundled Lambdas continue reading via public.tenant_entity_*
-- during the deploy bridge window; new Lambdas read brain.* directly. PR 3
-- (cleanup) drops the views once deploys stabilize. The brain.pages compat
-- view enumerates columns explicitly, omitting the GENERATED ALWAYS
-- search_tsv (mirror of 0089's wiki.pages view fix from PR 1 review).
--
-- Note on external_refs_kind_allowed_v2: the constraint name retains the
-- _v2 suffix from the public-schema days (0088 renamed it; 0087 is queued
-- to rename it back and tighten the value set). This migration only moves
-- the constraint with the table — no name/definition changes. The follow-up
-- cleanup migration can rename and tighten in lock step with 0087.
--
-- Plan reference:    docs/plans/2026-05-16-001-refactor-wiki-brain-schema-extraction-plan.md
-- Origin brainstorm: docs/brainstorms/2026-05-16-wiki-brain-schema-extraction-requirements.md
-- Pattern doc:       docs/solutions/database-issues/feature-schema-extraction-pattern.md
-- Prior PR:          0089_wiki_schema_extraction.sql (wiki side, PR 1 of 3)
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0090_brain_schema_extraction.sql
-- Then verify:
--   pnpm db:migrate-manual
--   psql -c "\dt brain.*"           -- 6 tables expected
--   psql -c "\dv public.tenant_entity_*"  -- 6 compat views expected
--   psql -c "\dt public.tenant_entity_*"  -- 0 tables expected
--
-- Inverse runbook (rollback): drop the views, then SET SCHEMA back, then
-- RENAME back. Indexes and constraints follow their parent table's schema
-- automatically. After SET SCHEMA moves the table to public, its indexes
-- live in public — so ALTER INDEX statements must qualify with `public.`,
-- not `brain.`.
--   DROP VIEW IF EXISTS public.tenant_entity_pages, public.tenant_entity_page_sections, ...;
--   ALTER TABLE brain.pages SET SCHEMA public;   -- indexes move to public too
--   ALTER TABLE public.pages RENAME TO tenant_entity_pages;
--   ALTER INDEX public.idx_pages_tenant_type_status RENAME TO idx_tenant_entity_pages_tenant_type_status;  -- × 19 indexes
--   ... (× 6 tables, parent-last)
--   DROP SCHEMA brain;
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- creates: brain.pages
-- creates: brain.page_sections
-- creates: brain.page_links
-- creates: brain.page_aliases
-- creates: brain.section_sources
-- creates: brain.external_refs
-- creates: brain.uq_pages_tenant_type_subtype_slug
-- creates: brain.idx_pages_tenant_type_status
-- creates: brain.idx_pages_subtype
-- creates: brain.idx_pages_last_compiled
-- creates: brain.idx_pages_search_tsv
-- creates: brain.idx_pages_parent
-- creates: brain.idx_pages_title_trgm
-- creates: brain.uq_page_sections_page_slug
-- creates: brain.idx_page_sections_page_position
-- creates: brain.uq_page_links_from_to_kind
-- creates: brain.idx_page_links_to
-- creates: brain.idx_page_links_kind
-- creates: brain.uq_page_aliases_page_alias
-- creates: brain.idx_page_aliases_alias
-- creates: brain.idx_page_aliases_alias_trgm
-- creates: brain.uq_section_sources_section_kind_ref
-- creates: brain.idx_section_sources_tenant_kind_ref
-- creates: brain.uq_external_refs_source
-- creates: brain.idx_external_refs_tenant_source
-- creates-constraint: brain.pages.pages_type_allowed
-- creates-constraint: brain.pages.pages_entity_subtype_allowed
-- creates-constraint: brain.page_sections.page_sections_facet_type_allowed
-- creates-constraint: brain.external_refs.external_refs_kind_allowed
-- creates-constraint: brain.external_refs.external_refs_ttl_positive
-- creates: public.tenant_entity_pages
-- creates: public.tenant_entity_page_sections
-- creates: public.tenant_entity_page_links
-- creates: public.tenant_entity_page_aliases
-- creates: public.tenant_entity_section_sources
-- creates: public.tenant_entity_external_refs

\set ON_ERROR_STOP on

BEGIN;

-- Set timeouts BEFORE acquiring the advisory lock so the lock acquisition
-- itself is bounded. Mirror of 0089's pattern.
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

-- Serialize concurrent application attempts.
SELECT pg_advisory_xact_lock(hashtext('brain_schema_extraction'));

-- Refuse to apply against an unexpected DB.
DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Dev-state-verification: 0090 depends on 0089's state. If dev was reseeded
-- after 0089 but before 0090, refuse to proceed — re-apply 0089 first.
DO $$
BEGIN
  IF to_regclass('wiki.pages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: wiki.pages does not exist — 0089 (wiki schema extraction) must be applied first';
  END IF;
END $$;

-- Pre-flight invariants: symmetric checks for all 6 tables.
DO $$
BEGIN
  IF to_regclass('public.tenant_entity_pages') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_pages does not exist';
  END IF;
  IF to_regclass('brain.pages') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.pages already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.tenant_entity_page_sections') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_page_sections does not exist';
  END IF;
  IF to_regclass('brain.page_sections') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.page_sections already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.tenant_entity_page_links') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_page_links does not exist';
  END IF;
  IF to_regclass('brain.page_links') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.page_links already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.tenant_entity_page_aliases') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_page_aliases does not exist';
  END IF;
  IF to_regclass('brain.page_aliases') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.page_aliases already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.tenant_entity_section_sources') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_section_sources does not exist';
  END IF;
  IF to_regclass('brain.section_sources') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.section_sources already exists — refusing to re-apply';
  END IF;
  IF to_regclass('public.tenant_entity_external_refs') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.tenant_entity_external_refs does not exist';
  END IF;
  IF to_regclass('brain.external_refs') IS NOT NULL THEN
    RAISE EXCEPTION 'pre-flight: brain.external_refs already exists — refusing to re-apply';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS brain;
COMMENT ON SCHEMA brain IS 'Tenant-shared structured-knowledge entity pages (Customer/Opportunity/Order/Person) and their provenance. Extracted from public.* on 2026-05-16 as PR 2 of the wiki+brain schema extraction arc.';

-- ── Move and rename tables ─────────────────────────────────────────────
-- FK-leaf-first ordering. Postgres preserves FKs across SET SCHEMA
-- automatically; ordering matters only for operator mental model.

ALTER TABLE public.tenant_entity_external_refs SET SCHEMA brain;
ALTER TABLE brain.tenant_entity_external_refs RENAME TO external_refs;

ALTER TABLE public.tenant_entity_section_sources SET SCHEMA brain;
ALTER TABLE brain.tenant_entity_section_sources RENAME TO section_sources;

ALTER TABLE public.tenant_entity_page_links SET SCHEMA brain;
ALTER TABLE brain.tenant_entity_page_links RENAME TO page_links;

ALTER TABLE public.tenant_entity_page_aliases SET SCHEMA brain;
ALTER TABLE brain.tenant_entity_page_aliases RENAME TO page_aliases;

ALTER TABLE public.tenant_entity_page_sections SET SCHEMA brain;
ALTER TABLE brain.tenant_entity_page_sections RENAME TO page_sections;

ALTER TABLE public.tenant_entity_pages SET SCHEMA brain;
ALTER TABLE brain.tenant_entity_pages RENAME TO pages;

-- ── Rename indexes to drop tenant_entity_ prefix ───────────────────────

ALTER INDEX brain.uq_tenant_entity_pages_tenant_type_subtype_slug RENAME TO uq_pages_tenant_type_subtype_slug;
ALTER INDEX brain.idx_tenant_entity_pages_tenant_type_status RENAME TO idx_pages_tenant_type_status;
ALTER INDEX brain.idx_tenant_entity_pages_subtype RENAME TO idx_pages_subtype;
ALTER INDEX brain.idx_tenant_entity_pages_last_compiled RENAME TO idx_pages_last_compiled;
ALTER INDEX brain.idx_tenant_entity_pages_search_tsv RENAME TO idx_pages_search_tsv;
ALTER INDEX brain.idx_tenant_entity_pages_parent RENAME TO idx_pages_parent;
ALTER INDEX brain.idx_tenant_entity_pages_title_trgm RENAME TO idx_pages_title_trgm;

ALTER INDEX brain.uq_tenant_entity_page_sections_page_slug RENAME TO uq_page_sections_page_slug;
ALTER INDEX brain.idx_tenant_entity_page_sections_page_position RENAME TO idx_page_sections_page_position;

ALTER INDEX brain.uq_tenant_entity_page_links_from_to_kind RENAME TO uq_page_links_from_to_kind;
ALTER INDEX brain.idx_tenant_entity_page_links_to RENAME TO idx_page_links_to;
ALTER INDEX brain.idx_tenant_entity_page_links_kind RENAME TO idx_page_links_kind;

ALTER INDEX brain.uq_tenant_entity_page_aliases_page_alias RENAME TO uq_page_aliases_page_alias;
ALTER INDEX brain.idx_tenant_entity_page_aliases_alias RENAME TO idx_page_aliases_alias;
ALTER INDEX brain.idx_tenant_entity_page_aliases_alias_trgm RENAME TO idx_page_aliases_alias_trgm;

ALTER INDEX brain.uq_tenant_entity_section_sources_section_kind_ref RENAME TO uq_section_sources_section_kind_ref;
ALTER INDEX brain.idx_tenant_entity_section_sources_tenant_kind_ref RENAME TO idx_section_sources_tenant_kind_ref;

ALTER INDEX brain.uq_tenant_entity_external_refs_source RENAME TO uq_external_refs_source;
ALTER INDEX brain.idx_tenant_entity_external_refs_tenant_source RENAME TO idx_external_refs_tenant_source;

-- ── Rename named CHECK constraints to drop tenant_entity_ prefix ───────

ALTER TABLE brain.pages RENAME CONSTRAINT tenant_entity_pages_type_allowed TO pages_type_allowed;
ALTER TABLE brain.pages RENAME CONSTRAINT tenant_entity_pages_entity_subtype_allowed TO pages_entity_subtype_allowed;
ALTER TABLE brain.page_sections RENAME CONSTRAINT tenant_entity_page_sections_facet_type_allowed TO page_sections_facet_type_allowed;

-- external_refs constraint: absorb 0087's tracker cleanup. Whatever the
-- existing constraint name is (_v2 or _kind_allowed — depends on whether
-- 0087 has applied yet), delete tracker rows and replace with the final
-- constraint named external_refs_kind_allowed (no _v2) excluding tracker_*.
-- This matches what brain.ts declares as the canonical Drizzle source.
DELETE FROM brain.external_refs
 WHERE source_kind IN ('tracker_issue', 'tracker_ticket');

ALTER TABLE brain.external_refs
  DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed_v2;
ALTER TABLE brain.external_refs
  DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed;

ALTER TABLE brain.external_refs
  ADD CONSTRAINT external_refs_kind_allowed CHECK (
    source_kind IN (
      'erp_customer',
      'crm_opportunity',
      'erp_order',
      'crm_person',
      'support_case',
      'bedrock_kb'
    )
  );

ALTER TABLE brain.external_refs RENAME CONSTRAINT tenant_entity_external_refs_ttl_positive TO external_refs_ttl_positive;

-- ── Compat views in public.* ────────────────────────────────────────────
-- Old bundled Lambda code references public.tenant_entity_*. The views
-- resolve to the new schema-qualified tables. brain.pages has a
-- GENERATED ALWAYS search_tsv column, so its compat view enumerates
-- columns explicitly to allow INSERTs that don't name search_tsv to
-- succeed (Postgres regenerates search_tsv on write through the view).
-- The remaining 5 tables have no generated columns; SELECT * is fine.

CREATE VIEW public.tenant_entity_pages AS
  SELECT id, tenant_id, type, entity_subtype, slug, title, summary,
         body_md, status, parent_page_id, hubness_score, tags,
         last_compiled_at, created_at, updated_at
  FROM brain.pages;
CREATE VIEW public.tenant_entity_page_sections AS SELECT * FROM brain.page_sections;
CREATE VIEW public.tenant_entity_page_links AS SELECT * FROM brain.page_links;
CREATE VIEW public.tenant_entity_page_aliases AS SELECT * FROM brain.page_aliases;
CREATE VIEW public.tenant_entity_section_sources AS SELECT * FROM brain.section_sources;
CREATE VIEW public.tenant_entity_external_refs AS SELECT * FROM brain.external_refs;

COMMIT;
