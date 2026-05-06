-- Connector framework data foundation.
--
-- Ships inert: no Lambda or background process reads these rows until the
-- connector chassis lands in a follow-up PR.
--
-- Plan:
--   docs/plans/2026-05-05-001-feat-thinkwork-connector-data-model-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0065_connector_tables.sql
--
-- creates: public.connectors
-- creates: public.connector_executions
-- creates: public.uq_connectors_tenant_name
-- creates: public.idx_connectors_tenant_status
-- creates: public.idx_connectors_tenant_type
-- creates: public.idx_connectors_enabled
-- creates: public.uq_connector_executions_active_external_ref
-- creates: public.idx_connector_executions_tenant_state
-- creates: public.idx_connector_executions_connector_started
-- creates: public.idx_connector_executions_state_machine_arn
-- creates: public.idx_connector_executions_external_ref

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type text NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  connection_id uuid REFERENCES public.connections(id) ON DELETE SET NULL,
  config jsonb,
  dispatch_target_type text NOT NULL,
  dispatch_target_id uuid NOT NULL,
  last_poll_at timestamp with time zone,
  last_poll_cursor text,
  next_poll_at timestamp with time zone,
  eb_schedule_name text,
  enabled boolean NOT NULL DEFAULT true,
  created_by_type text,
  created_by_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT connectors_status_enum CHECK (
    status IN ('active', 'paused', 'unhealthy', 'archived')
  ),
  CONSTRAINT connectors_dispatch_target_type_enum CHECK (
    dispatch_target_type IN ('agent', 'routine', 'hybrid_routine')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connectors_tenant_name
  ON public.connectors (tenant_id, name);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant_status
  ON public.connectors (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant_type
  ON public.connectors (tenant_id, type);

CREATE INDEX IF NOT EXISTS idx_connectors_enabled
  ON public.connectors (tenant_id, enabled);

CREATE TABLE IF NOT EXISTS public.connector_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  connector_id uuid NOT NULL REFERENCES public.connectors(id) ON DELETE RESTRICT,
  external_ref text NOT NULL,
  current_state text NOT NULL DEFAULT 'pending',
  spend_envelope_usd_cents bigint,
  state_machine_arn text,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_class text,
  outcome_payload jsonb,
  cost_finalized_at timestamp with time zone,
  last_usage_event_at timestamp with time zone,
  kill_target text,
  kill_target_at timestamp with time zone,
  retry_attempt integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT connector_executions_current_state_enum CHECK (
    current_state IN (
      'pending',
      'dispatching',
      'invoking',
      'recording_result',
      'terminal',
      'failed',
      'cancelled'
    )
  ),
  CONSTRAINT connector_executions_kill_target_enum CHECK (
    kill_target IS NULL OR kill_target IN ('cooperative', 'hard')
  ),
  CONSTRAINT connector_executions_spend_envelope_nonnegative CHECK (
    spend_envelope_usd_cents IS NULL OR spend_envelope_usd_cents >= 0
  ),
  CONSTRAINT connector_executions_retry_attempt_nonnegative CHECK (
    retry_attempt >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_executions_active_external_ref
  ON public.connector_executions (connector_id, external_ref)
  WHERE current_state IN (
    'pending',
    'dispatching',
    'invoking',
    'recording_result'
  );

CREATE INDEX IF NOT EXISTS idx_connector_executions_tenant_state
  ON public.connector_executions (tenant_id, current_state);

CREATE INDEX IF NOT EXISTS idx_connector_executions_connector_started
  ON public.connector_executions (connector_id, started_at);

CREATE INDEX IF NOT EXISTS idx_connector_executions_state_machine_arn
  ON public.connector_executions (state_machine_arn);

CREATE INDEX IF NOT EXISTS idx_connector_executions_external_ref
  ON public.connector_executions (tenant_id, external_ref);

COMMIT;
