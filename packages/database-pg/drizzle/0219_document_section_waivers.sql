-- THINK-183 U5: per-document section waivers (suitability waivers).
-- A plate's section manifest can require sections; when the model cannot
-- back one with data it waives explicitly, and the waiver is recorded here
-- so counts and reasons are queryable per document and per plate (the
-- THINK-189 conformance seam). Rows are rewritten per emission head
-- (delete + reinsert). Additive — safe to apply ahead of code deploy.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0219_document_section_waivers.sql
-- creates: public.document_section_waivers

CREATE TABLE IF NOT EXISTS public.document_section_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  artifact_id uuid NOT NULL REFERENCES public.artifacts(id) ON DELETE CASCADE,
  plate_slug text NOT NULL,
  section_id text NOT NULL,
  tier text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_section_waivers_tier_check
    CHECK (tier IN ('required', 'required-if-material'))
);

CREATE UNIQUE INDEX IF NOT EXISTS document_section_waivers_artifact_section_uidx
  ON public.document_section_waivers (artifact_id, section_id);

CREATE INDEX IF NOT EXISTS document_section_waivers_tenant_plate_idx
  ON public.document_section_waivers (tenant_id, plate_slug);
