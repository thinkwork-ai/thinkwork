-- THINK-193 U7: Bedrock Knowledge Base document-projection manifest.
-- Contents:
--   * public.knowledge_base_documents — ONE row per (knowledge_base_id,
--     data_source_id, document_key). The row id is the document's stable
--     manifest identity across editions; `edition` increments on etag/content
--     change; effective_to closes only at verified deletion
--     (ingest_status 'absent_verified'). Edition history lives in
--     memory_evidence_items.source_version (edition + content hash).
--   * uq_kb_documents_identity — the manifest key.
--   * idx_kb_documents_kb_updated — the bedrock_kb adapter's acquisition
--     cursor (changed editions since (updated_at, id)).
--   * idx_kb_documents_kb_ingest_status — settlement scan for 'deleting'.
--
-- Hand-rolled (drizzle meta journal is not in use for this change);
-- apply with: psql "$DATABASE_URL" -f drizzle/0241_knowledge_base_document_manifest.sql
-- creates: public.knowledge_base_documents
-- creates: public.uq_kb_documents_identity
-- creates: public.idx_kb_documents_tenant
-- creates: public.idx_kb_documents_kb_updated
-- creates: public.idx_kb_documents_kb_ingest_status
-- creates-constraint: public.knowledge_base_documents.knowledge_base_documents_ingest_status_check
-- creates-constraint: public.knowledge_base_documents.knowledge_base_documents_projection_status_check
-- creates-constraint: public.knowledge_base_documents.knowledge_base_documents_edition_positive

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE IF NOT EXISTS public.knowledge_base_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  knowledge_base_id uuid NOT NULL REFERENCES public.knowledge_bases(id) ON DELETE CASCADE,
  data_source_id text NOT NULL,
  document_key text NOT NULL,
  s3_version_id text,
  etag text,
  content_hash text,
  edition integer NOT NULL DEFAULT 1,
  effective_from timestamptz,
  effective_to timestamptz,
  ingest_status text NOT NULL DEFAULT 'pending',
  projection_status text NOT NULL DEFAULT 'pending',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_base_documents_ingest_status_check CHECK (
    ingest_status IN ('pending', 'ingesting', 'indexed', 'failed', 'deleting', 'absent_verified')
  ),
  CONSTRAINT knowledge_base_documents_projection_status_check CHECK (
    projection_status IN ('pending', 'projected', 'skipped', 'failed', 'retracting', 'retracted')
  ),
  CONSTRAINT knowledge_base_documents_edition_positive CHECK (edition >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kb_documents_identity
  ON public.knowledge_base_documents (knowledge_base_id, data_source_id, document_key);

CREATE INDEX IF NOT EXISTS idx_kb_documents_tenant
  ON public.knowledge_base_documents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_kb_documents_kb_updated
  ON public.knowledge_base_documents (knowledge_base_id, updated_at, id);

CREATE INDEX IF NOT EXISTS idx_kb_documents_kb_ingest_status
  ON public.knowledge_base_documents (knowledge_base_id, ingest_status);

COMMIT;
