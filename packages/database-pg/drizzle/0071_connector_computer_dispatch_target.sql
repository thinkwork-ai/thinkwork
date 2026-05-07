-- Extend connector dispatch targets to allow Computer-owned pickup.
--
-- Plan:
--   docs/plans/2026-05-07-003-feat-computer-first-connector-routing-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0071_connector_computer_dispatch_target.sql
--
-- creates-constraint: public.connectors.connectors_dispatch_target_type_enum_v2

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.connectors
  DROP CONSTRAINT IF EXISTS connectors_dispatch_target_type_enum;

ALTER TABLE public.connectors
  ADD CONSTRAINT connectors_dispatch_target_type_enum_v2 CHECK (
    dispatch_target_type IN ('agent', 'routine', 'hybrid_routine', 'computer')
  );

COMMIT;
