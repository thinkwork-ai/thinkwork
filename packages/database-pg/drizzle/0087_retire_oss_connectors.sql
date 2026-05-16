-- Retire the OSS connector framework.
--
-- ⚠️  SUPERSEDED by 0090 + 0092. Do NOT apply this file directly anymore —
-- the ALTER TABLE public.tenant_entity_external_refs statements below
-- will fail because 0090 (brain schema extraction) moved that table to
-- brain.external_refs. 0090 absorbed this migration's tracker DELETE +
-- constraint work, and 0092_finish_oss_connector_retirement.sql does
-- the DROP TABLE portion. The markers below have been updated to point
-- at the post-0090 location so the drift reporter resolves cleanly.
--
-- Removes the connector data model now that the private extension runtime
-- is moving out of OSS Thinkwork. Workflow Customize catalog, OAuth
-- credentials, MCP state, Computers, and Threads remain.
--
-- Plan:
--   docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md
--
-- Apply manually: DO NOT APPLY DIRECTLY — see superseded note above.
--   Original command (now broken):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0087_retire_oss_connectors.sql
--
-- drops: public.computer_delegations
-- drops: public.connector_executions
-- drops: public.connectors
-- drops: public.tenant_connector_catalog
-- drops: public.uq_connector_executions_active_external_ref
-- drops: public.idx_connector_executions_tenant_state
-- drops: public.idx_connector_executions_connector_started
-- drops: public.idx_connector_executions_state_machine_arn
-- drops: public.idx_connector_executions_external_ref
-- drops: public.uq_connectors_tenant_name
-- drops: public.idx_connectors_tenant_status
-- drops: public.idx_connectors_tenant_type
-- drops: public.idx_connectors_enabled
-- drops: public.uq_connectors_catalog_slug_per_computer
-- drops: public.uq_tenant_connector_catalog_slug
-- drops: public.idx_tenant_connector_catalog_tenant_status
-- drops: public.idx_computer_delegations_computer_status
-- drops: public.idx_computer_delegations_agent
-- Constraint location updated post-0090 (brain schema extraction moved the
-- table to brain.external_refs and renamed the constraint).
-- creates-constraint: brain.external_refs.external_refs_kind_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DELETE FROM public.tenant_entity_external_refs
 WHERE source_kind IN ('tracker_issue', 'tracker_ticket');

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

DROP TABLE IF EXISTS public.computer_delegations CASCADE;
DROP TABLE IF EXISTS public.connector_executions CASCADE;
DROP TABLE IF EXISTS public.connectors CASCADE;
DROP TABLE IF EXISTS public.tenant_connector_catalog CASCADE;

COMMIT;
