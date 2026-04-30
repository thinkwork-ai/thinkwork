-- Brain v0 operational snapshot cache for tenant entities.
--
-- Plan:
--   docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0052_brain_v0_external_refs.sql
--
-- creates: public.tenant_entity_external_refs

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.tenant_entity_external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  external_id text,
  source_payload jsonb,
  as_of timestamp with time zone NOT NULL,
  ttl_seconds integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT tenant_entity_external_refs_kind_allowed
    CHECK (source_kind IN ('erp_customer','crm_opportunity','erp_order','crm_person','support_case','bedrock_kb')),
  CONSTRAINT tenant_entity_external_refs_ttl_positive CHECK (ttl_seconds > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_entity_external_refs_source
  ON public.tenant_entity_external_refs (tenant_id, source_kind, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_entity_external_refs_tenant_source
  ON public.tenant_entity_external_refs (tenant_id, source_kind);

COMMENT ON TABLE public.tenant_entity_external_refs IS 'brain-v0: docs/plans/2026-04-29-004-feat-company-brain-v0-plan.md';

COMMIT;
