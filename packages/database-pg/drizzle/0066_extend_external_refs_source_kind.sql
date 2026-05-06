-- Extend tenant_entity_external_refs.source_kind for tracker work-item mirrors.
--
-- Plan:
--   docs/plans/2026-05-05-001-feat-thinkwork-connector-data-model-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0066_extend_external_refs_source_kind.sql
--
-- creates-constraint: public.tenant_entity_external_refs.tenant_entity_external_refs_kind_allowed_v2

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.tenant_entity_external_refs
  DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed;

ALTER TABLE public.tenant_entity_external_refs
  ADD CONSTRAINT tenant_entity_external_refs_kind_allowed_v2 CHECK (
    source_kind IN (
      'erp_customer',
      'crm_opportunity',
      'erp_order',
      'crm_person',
      'support_case',
      'bedrock_kb',
      'tracker_issue',
      'tracker_ticket'
    )
  );

COMMIT;
