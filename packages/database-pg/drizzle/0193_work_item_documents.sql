-- Work Item Documents: tenant-scoped S3-backed document metadata.
-- creates: public.work_item_documents
-- creates: public.idx_work_item_documents_item_active
-- creates: public.idx_work_item_documents_tenant_kind
-- creates-constraint: public.work_item_documents.work_item_documents_kind_allowed

CREATE TABLE IF NOT EXISTS work_item_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'note',
  title text NOT NULL,
  content_type text NOT NULL DEFAULT 'text/markdown',
  s3_key text NOT NULL,
  size_bytes integer NOT NULL DEFAULT 0,
  checksum_sha256 text,
  metadata jsonb,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT work_item_documents_kind_allowed
    CHECK (kind IN ('plan','progress','spec','evidence','handoff','note','other'))
);

CREATE INDEX IF NOT EXISTS idx_work_item_documents_item_active
  ON work_item_documents (tenant_id, work_item_id, archived_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_work_item_documents_tenant_kind
  ON work_item_documents (tenant_id, kind, archived_at);
