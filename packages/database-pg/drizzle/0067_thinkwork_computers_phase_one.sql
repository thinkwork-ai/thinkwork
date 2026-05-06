-- ThinkWork Computer phase-one data foundation.
--
-- Plan:
--   docs/plans/2026-05-06-005-feat-thinkwork-computer-phase-one-foundation-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0067_thinkwork_computers_phase_one.sql
--
-- creates-column: public.agent_templates.template_kind
-- creates: public.agent_templates_kind_allowed
-- creates: public.idx_agent_templates_kind
-- creates: public.computers
-- creates: public.computer_tasks
-- creates: public.computer_events
-- creates: public.computer_snapshots
-- creates: public.computer_delegations
-- creates: public.uq_computers_tenant_slug
-- creates: public.uq_computers_active_owner
-- creates: public.idx_computers_tenant_status
-- creates: public.idx_computers_owner
-- creates: public.idx_computers_template
-- creates: public.idx_computers_migrated_agent
-- creates: public.uq_computer_tasks_idempotency
-- creates: public.idx_computer_tasks_computer_status
-- creates: public.idx_computer_tasks_tenant_status
-- creates: public.idx_computer_events_computer_created
-- creates: public.idx_computer_events_task
-- creates: public.idx_computer_snapshots_computer_created
-- creates: public.idx_computer_delegations_computer_status
-- creates: public.idx_computer_delegations_agent

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.agent_templates
  ADD COLUMN IF NOT EXISTS template_kind text NOT NULL DEFAULT 'agent';

ALTER TABLE public.agent_templates
  DROP CONSTRAINT IF EXISTS agent_templates_kind_allowed;

ALTER TABLE public.agent_templates
  ADD CONSTRAINT agent_templates_kind_allowed CHECK (
    template_kind IN ('agent', 'computer')
  );

CREATE INDEX IF NOT EXISTS idx_agent_templates_kind
  ON public.agent_templates (template_kind);

CREATE TABLE IF NOT EXISTS public.computers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.agent_templates(id),
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  desired_runtime_status text NOT NULL DEFAULT 'running',
  runtime_status text NOT NULL DEFAULT 'pending',
  runtime_config jsonb,
  live_workspace_root text,
  efs_access_point_id text,
  ecs_service_name text,
  last_heartbeat_at timestamp with time zone,
  last_active_at timestamp with time zone,
  budget_monthly_cents integer,
  spent_monthly_cents integer DEFAULT 0,
  budget_paused_at timestamp with time zone,
  budget_paused_reason text,
  migrated_from_agent_id uuid REFERENCES public.agents(id),
  migration_metadata jsonb,
  created_by uuid REFERENCES public.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT computers_status_allowed CHECK (
    status IN ('active', 'provisioning', 'failed', 'archived')
  ),
  CONSTRAINT computers_desired_runtime_status_allowed CHECK (
    desired_runtime_status IN ('running', 'stopped')
  ),
  CONSTRAINT computers_runtime_status_allowed CHECK (
    runtime_status IN ('pending', 'starting', 'running', 'stopped', 'failed', 'unknown')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_computers_tenant_slug
  ON public.computers (tenant_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS uq_computers_active_owner
  ON public.computers (tenant_id, owner_user_id)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_computers_tenant_status
  ON public.computers (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_computers_owner
  ON public.computers (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_computers_template
  ON public.computers (template_id);

CREATE INDEX IF NOT EXISTS idx_computers_migrated_agent
  ON public.computers (migrated_from_agent_id);

CREATE TABLE IF NOT EXISTS public.computer_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  computer_id uuid NOT NULL REFERENCES public.computers(id) ON DELETE CASCADE,
  task_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input jsonb,
  output jsonb,
  error jsonb,
  idempotency_key text,
  claimed_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_by_user_id uuid REFERENCES public.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT computer_tasks_status_allowed CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_computer_tasks_idempotency
  ON public.computer_tasks (tenant_id, computer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_computer_tasks_computer_status
  ON public.computer_tasks (computer_id, status);

CREATE INDEX IF NOT EXISTS idx_computer_tasks_tenant_status
  ON public.computer_tasks (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.computer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  computer_id uuid NOT NULL REFERENCES public.computers(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.computer_tasks(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  payload jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT computer_events_level_allowed CHECK (
    level IN ('debug', 'info', 'warn', 'error')
  )
);

CREATE INDEX IF NOT EXISTS idx_computer_events_computer_created
  ON public.computer_events (computer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_computer_events_task
  ON public.computer_events (task_id);

CREATE TABLE IF NOT EXISTS public.computer_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  computer_id uuid NOT NULL REFERENCES public.computers(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.computer_tasks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  s3_prefix text NOT NULL,
  manifest jsonb,
  error jsonb,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT computer_snapshots_status_allowed CHECK (
    status IN ('pending', 'completed', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_computer_snapshots_computer_created
  ON public.computer_snapshots (computer_id, created_at);

CREATE TABLE IF NOT EXISTS public.computer_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  computer_id uuid NOT NULL REFERENCES public.computers(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  task_id uuid REFERENCES public.computer_tasks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  input_artifacts jsonb,
  output_artifacts jsonb,
  result jsonb,
  error jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT computer_delegations_status_allowed CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_computer_delegations_computer_status
  ON public.computer_delegations (computer_id, status);

CREATE INDEX IF NOT EXISTS idx_computer_delegations_agent
  ON public.computer_delegations (agent_id);

COMMIT;
