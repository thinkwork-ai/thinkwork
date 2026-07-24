-- External S3 KB source U1: a Knowledge Base holds N data sources instead of
-- one implied upload prefix.
-- Contents:
--   * public.knowledge_base_sources — one row per Bedrock data source of a
--     KB. kind 'managed-upload' is the platform upload prefix (backfilled as
--     source #0 from the KB's implied prefix + aws_data_source_id);
--     's3-connect' points at an existing customer bucket/prefix read in
--     place; 'snapshot' is a reserved enum value only. `bucket` is NULL for
--     managed-upload (workspace bucket resolved at runtime).
--   * uq_kb_sources_managed_upload — one managed-upload source per KB.
--   * public.knowledge_base_documents.source_id — nullable FK to the source
--     row (data_source_id keeps the AWS identity; this is the row reference),
--     backfilled to the managed-upload source.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0277_knowledge_base_sources.sql
-- creates: public.knowledge_base_sources
-- creates: public.idx_kb_sources_kb
-- creates: public.idx_kb_sources_tenant
-- creates: public.uq_kb_sources_managed_upload
-- creates: public.idx_kb_documents_source
-- creates-column: public.knowledge_base_documents.source_id
-- creates-constraint: public.knowledge_base_sources.knowledge_base_sources_kind_check
-- creates-constraint: public.knowledge_base_sources.knowledge_base_sources_access_status_check
-- creates-constraint: public.knowledge_base_sources.knowledge_base_sources_s3_connect_location_check

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.knowledge_base_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  kind text NOT NULL,
  bucket text,
  prefix text,
  filter_patterns jsonb,
  bucket_owner_account_id text,
  parsing_strategy text NOT NULL DEFAULT 'DEFAULT',
  aws_data_source_id text,
  access_status text NOT NULL DEFAULT 'pending',
  last_sync_at timestamptz,
  last_sync_status text,
  document_count integer DEFAULT 0,
  error_message text,
  sentinel_document_key text,
  sentinel_phrase text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_base_sources_kind_check
    CHECK (kind IN ('managed-upload', 's3-connect', 'snapshot')),
  CONSTRAINT knowledge_base_sources_access_status_check
    CHECK (access_status IN ('pending', 'healthy', 'degraded', 'access_revoked', 'failed')),
  CONSTRAINT knowledge_base_sources_s3_connect_location_check
    CHECK (kind <> 's3-connect' OR (bucket IS NOT NULL AND prefix IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_kb_sources_kb
  ON public.knowledge_base_sources (knowledge_base_id);

CREATE INDEX IF NOT EXISTS idx_kb_sources_tenant
  ON public.knowledge_base_sources (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_sources_managed_upload
  ON public.knowledge_base_sources (knowledge_base_id)
  WHERE kind = 'managed-upload';

ALTER TABLE public.knowledge_base_documents
  ADD COLUMN IF NOT EXISTS source_id uuid
    REFERENCES public.knowledge_base_sources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kb_documents_source
  ON public.knowledge_base_documents (source_id);

-- Backfill source #0: one managed-upload row per existing KB, carrying the
-- KB's implied upload prefix and its current Bedrock data-source identity.
-- Backfilled sources are the platform's own bucket — access is 'healthy'.
INSERT INTO public.knowledge_base_sources
  (tenant_id, knowledge_base_id, kind, prefix, aws_data_source_id,
   access_status, last_sync_at, last_sync_status, document_count)
SELECT
  kb.tenant_id,
  kb.id,
  'managed-upload',
  'tenants/' || t.slug || '/knowledge-bases/' || kb.slug || '/documents/',
  kb.aws_data_source_id,
  'healthy',
  kb.last_sync_at,
  kb.last_sync_status,
  kb.document_count
FROM public.knowledge_bases kb
JOIN public.tenants t ON t.id = kb.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.knowledge_base_sources s
  WHERE s.knowledge_base_id = kb.id AND s.kind = 'managed-upload'
);

-- Attribute existing manifest rows to their KB's managed-upload source.
UPDATE public.knowledge_base_documents d
SET source_id = s.id
FROM public.knowledge_base_sources s
WHERE d.source_id IS NULL
  AND s.knowledge_base_id = d.knowledge_base_id
  AND s.kind = 'managed-upload';

COMMIT;
