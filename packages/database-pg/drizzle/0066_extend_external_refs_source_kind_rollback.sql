-- Rollback for 0066_extend_external_refs_source_kind.sql.
--
-- Rollback after tracker rows exist requires manual cleanup first:
--   DELETE FROM public.tenant_entity_external_refs
--    WHERE source_kind IN ('tracker_issue', 'tracker_ticket');
--
-- Without that cleanup, restoring the prior six-value CHECK will fail.

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.tenant_entity_external_refs
  DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed_v2;

ALTER TABLE public.tenant_entity_external_refs
  DROP CONSTRAINT IF EXISTS tenant_entity_external_refs_kind_allowed;

ALTER TABLE public.tenant_entity_external_refs
  ADD CONSTRAINT tenant_entity_external_refs_kind_allowed CHECK (
    source_kind IN (
      'erp_customer',
      'crm_opportunity',
      'erp_order',
      'crm_person',
      'support_case',
      'bedrock_kb'
    )
  );

COMMIT;
