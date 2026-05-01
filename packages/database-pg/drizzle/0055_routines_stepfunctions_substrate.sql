-- Routines Step Functions substrate.
--
-- Adds the four new tables that back the Step Functions Routines runtime:
--   * routine_executions       — execution-level state, mirrors SFN
--   * routine_step_events      — per-step events (high-volume append)
--   * routine_asl_versions     — published ASL snapshots for query/audit
--   * routine_approval_tokens  — HITL task tokens with consume-once flag
--
-- And extends `routines` with the engine partition + Step-Functions-specific
-- columns (state_machine_arn, alias_arn, documentation_md, current_version).
-- Existing routine rows default to engine='legacy_python' so the new query
-- paths can filter without a join.
--
-- Plan:
--   docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0055_routines_stepfunctions_substrate.sql
--
-- creates: public.routine_executions
-- creates: public.routine_step_events
-- creates: public.routine_asl_versions
-- creates: public.routine_approval_tokens
-- creates-column: public.routines.engine
-- creates-column: public.routines.state_machine_arn
-- creates-column: public.routines.state_machine_alias_arn
-- creates-column: public.routines.documentation_md
-- creates-column: public.routines.current_version
-- creates: public.idx_routine_executions_sfn_arn
-- creates: public.idx_routine_executions_tenant_status
-- creates: public.idx_routine_executions_routine_started
-- creates: public.idx_routine_executions_tenant_started
-- creates: public.idx_routine_step_events_execution
-- creates: public.idx_routine_step_events_tenant_recipe
-- creates: public.idx_routine_step_events_python_dashboard
-- creates: public.idx_routine_asl_versions_routine_version
-- creates: public.idx_routine_asl_versions_tenant_routine
-- creates: public.idx_routine_approval_tokens_inbox
-- creates: public.idx_routine_approval_tokens_pending
-- creates: public.idx_routine_approval_tokens_tenant_consumed
-- creates: public.idx_routines_engine

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- routines: engine partition + Step Functions resource columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS engine text NOT NULL DEFAULT 'legacy_python',
  ADD COLUMN IF NOT EXISTS state_machine_arn text,
  ADD COLUMN IF NOT EXISTS state_machine_alias_arn text,
  ADD COLUMN IF NOT EXISTS documentation_md text,
  ADD COLUMN IF NOT EXISTS current_version integer;

ALTER TABLE public.routines
  DROP CONSTRAINT IF EXISTS routines_engine_enum;

ALTER TABLE public.routines
  ADD CONSTRAINT routines_engine_enum
  CHECK (engine IN ('legacy_python', 'step_functions'));

CREATE INDEX IF NOT EXISTS idx_routines_engine
  ON public.routines (engine);

-- ---------------------------------------------------------------------------
-- routine_executions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routine_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  routine_id uuid NOT NULL REFERENCES public.routines(id),
  state_machine_arn text NOT NULL,
  alias_arn text,
  version_arn text,
  sfn_execution_arn text NOT NULL,
  trigger_id uuid REFERENCES public.scheduled_jobs(id),
  trigger_source text NOT NULL,
  input_json jsonb,
  output_json jsonb,
  status text NOT NULL DEFAULT 'running',
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_code text,
  error_message text,
  total_llm_cost_usd_cents bigint,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_executions_sfn_arn
  ON public.routine_executions (sfn_execution_arn);
CREATE INDEX IF NOT EXISTS idx_routine_executions_tenant_status
  ON public.routine_executions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_routine_executions_routine_started
  ON public.routine_executions (routine_id, started_at);
CREATE INDEX IF NOT EXISTS idx_routine_executions_tenant_started
  ON public.routine_executions (tenant_id, started_at);

-- ---------------------------------------------------------------------------
-- routine_step_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routine_step_events (
  id bigserial PRIMARY KEY NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  execution_id uuid NOT NULL REFERENCES public.routine_executions(id),
  node_id text NOT NULL,
  recipe_type text NOT NULL,
  status text NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  input_json jsonb,
  output_json jsonb,
  error_json jsonb,
  llm_cost_usd_cents bigint,
  retry_count integer NOT NULL DEFAULT 0,
  stdout_s3_uri text,
  stderr_s3_uri text,
  stdout_preview text,
  truncated boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_routine_step_events_execution
  ON public.routine_step_events (execution_id, started_at);
CREATE INDEX IF NOT EXISTS idx_routine_step_events_tenant_recipe
  ON public.routine_step_events (tenant_id, recipe_type);
CREATE INDEX IF NOT EXISTS idx_routine_step_events_python_dashboard
  ON public.routine_step_events (tenant_id, recipe_type, created_at);

-- ---------------------------------------------------------------------------
-- routine_asl_versions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routine_asl_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  routine_id uuid NOT NULL REFERENCES public.routines(id),
  version_number integer NOT NULL,
  state_machine_arn text NOT NULL,
  version_arn text NOT NULL,
  alias_was_pointing text,
  asl_json jsonb NOT NULL,
  markdown_summary text NOT NULL,
  step_manifest_json jsonb NOT NULL,
  validation_warnings_json jsonb,
  published_by_actor_id uuid,
  published_by_actor_type text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_asl_versions_routine_version
  ON public.routine_asl_versions (routine_id, version_number);
CREATE INDEX IF NOT EXISTS idx_routine_asl_versions_tenant_routine
  ON public.routine_asl_versions (tenant_id, routine_id);

-- ---------------------------------------------------------------------------
-- routine_approval_tokens
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.routine_approval_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  execution_id uuid NOT NULL REFERENCES public.routine_executions(id),
  inbox_item_id uuid NOT NULL REFERENCES public.inbox_items(id),
  node_id text NOT NULL,
  task_token text NOT NULL,
  heartbeat_seconds integer,
  consumed boolean NOT NULL DEFAULT false,
  decided_by_user_id uuid,
  decision_value_json jsonb,
  decided_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_approval_tokens_inbox
  ON public.routine_approval_tokens (inbox_item_id);

-- Partial unique index: at most one pending decision per (execution, node).
-- Past decisions retain their rows for audit (consumed=true) without
-- conflicting with new pending decisions on the same node.
CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_approval_tokens_pending
  ON public.routine_approval_tokens (execution_id, node_id)
  WHERE consumed = false;

CREATE INDEX IF NOT EXISTS idx_routine_approval_tokens_tenant_consumed
  ON public.routine_approval_tokens (tenant_id, consumed);

COMMENT ON TABLE public.routine_executions IS 'routines-phase-a: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md';
COMMENT ON TABLE public.routine_step_events IS 'routines-phase-a: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md';
COMMENT ON TABLE public.routine_asl_versions IS 'routines-phase-a: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md';
COMMENT ON TABLE public.routine_approval_tokens IS 'routines-phase-a: docs/plans/2026-05-01-004-feat-routines-phase-a-substrate-plan.md';

COMMIT;
