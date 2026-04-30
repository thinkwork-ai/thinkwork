-- Brain v0 tenant-shared entity pages.
--
-- Plan:
--   docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0051_brain_v0_tenant_entity_pages.sql
--
-- creates: public.tenant_entity_pages
-- creates: public.tenant_entity_page_sections
-- creates: public.tenant_entity_page_links
-- creates: public.tenant_entity_page_aliases
-- creates: public.tenant_entity_section_sources
-- creates: public.uq_tenant_entity_pages_tenant_type_subtype_slug
-- creates: public.idx_tenant_entity_pages_search_tsv
-- creates: public.uq_tenant_entity_section_sources_section_kind_ref
-- creates: public.enforce_tenant_entity_section_source_tenant
-- creates: public.trg_tenant_entity_section_sources_tenant

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.tenant_entity_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  entity_subtype text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  summary text,
  body_md text,
  search_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'english'::regconfig,
      regexp_replace(coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_md, ''), '[^[:alnum:]]+', ' ', 'g')
    )
  ) STORED,
  status text DEFAULT 'active' NOT NULL,
  parent_page_id uuid REFERENCES public.tenant_entity_pages(id) ON DELETE SET NULL,
  hubness_score integer DEFAULT 0 NOT NULL,
  tags text[] DEFAULT ARRAY[]::text[] NOT NULL,
  last_compiled_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tenant_entity_pages_type_allowed CHECK (type IN ('entity','topic','decision')),
  CONSTRAINT tenant_entity_pages_entity_subtype_allowed CHECK (entity_subtype IN ('customer','opportunity','order','person'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_entity_pages_tenant_type_subtype_slug
  ON public.tenant_entity_pages (tenant_id, type, entity_subtype, slug);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_pages_tenant_type_status
  ON public.tenant_entity_pages (tenant_id, type, status);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_pages_subtype
  ON public.tenant_entity_pages (entity_subtype);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_pages_last_compiled
  ON public.tenant_entity_pages (last_compiled_at);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_pages_search_tsv
  ON public.tenant_entity_pages USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_pages_parent
  ON public.tenant_entity_pages (parent_page_id);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_pages_title_trgm
  ON public.tenant_entity_pages USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.tenant_entity_page_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  page_id uuid NOT NULL REFERENCES public.tenant_entity_pages(id) ON DELETE CASCADE,
  section_slug text NOT NULL,
  heading text NOT NULL,
  body_md text NOT NULL,
  position integer NOT NULL,
  last_source_at timestamp with time zone,
  aggregation jsonb,
  status text DEFAULT 'active' NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tenant_entity_page_sections_facet_type_allowed
    CHECK (aggregation->>'facet_type' IS NULL OR aggregation->>'facet_type' IN ('operational','relationship','activity','compiled','kb_sourced','external'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_entity_page_sections_page_slug
  ON public.tenant_entity_page_sections (page_id, section_slug);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_page_sections_page_position
  ON public.tenant_entity_page_sections (page_id, position);

CREATE TABLE IF NOT EXISTS public.tenant_entity_page_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  from_page_id uuid NOT NULL REFERENCES public.tenant_entity_pages(id) ON DELETE CASCADE,
  to_page_id uuid NOT NULL REFERENCES public.tenant_entity_pages(id) ON DELETE CASCADE,
  kind text DEFAULT 'reference' NOT NULL,
  context text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_entity_page_links_from_to_kind
  ON public.tenant_entity_page_links (from_page_id, to_page_id, kind);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_page_links_to
  ON public.tenant_entity_page_links (to_page_id);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_page_links_kind
  ON public.tenant_entity_page_links (kind);

CREATE TABLE IF NOT EXISTS public.tenant_entity_page_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  page_id uuid NOT NULL REFERENCES public.tenant_entity_pages(id) ON DELETE CASCADE,
  alias text NOT NULL,
  source text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_entity_page_aliases_page_alias
  ON public.tenant_entity_page_aliases (page_id, alias);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_page_aliases_alias
  ON public.tenant_entity_page_aliases (alias);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_page_aliases_alias_trgm
  ON public.tenant_entity_page_aliases USING gin (alias gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.tenant_entity_section_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.tenant_entity_page_sections(id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  first_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_entity_section_sources_section_kind_ref
  ON public.tenant_entity_section_sources (section_id, source_kind, source_ref);
CREATE INDEX IF NOT EXISTS idx_tenant_entity_section_sources_tenant_kind_ref
  ON public.tenant_entity_section_sources (tenant_id, source_kind, source_ref);

CREATE OR REPLACE FUNCTION public.enforce_tenant_entity_section_source_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_tenant_id uuid;
BEGIN
  SELECT p.tenant_id
  INTO parent_tenant_id
  FROM public.tenant_entity_page_sections s
  INNER JOIN public.tenant_entity_pages p ON p.id = s.page_id
  WHERE s.id = NEW.section_id;

  IF parent_tenant_id IS NULL OR parent_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'tenant_entity_section_sources tenant_id must match parent page tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_entity_section_sources_tenant
  ON public.tenant_entity_section_sources;
CREATE TRIGGER trg_tenant_entity_section_sources_tenant
  BEFORE INSERT OR UPDATE ON public.tenant_entity_section_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_entity_section_source_tenant();

COMMENT ON TABLE public.tenant_entity_pages IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';
COMMENT ON TABLE public.tenant_entity_page_sections IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';
COMMENT ON TABLE public.tenant_entity_page_links IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';
COMMENT ON TABLE public.tenant_entity_page_aliases IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';
COMMENT ON TABLE public.tenant_entity_section_sources IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';

COMMIT;
