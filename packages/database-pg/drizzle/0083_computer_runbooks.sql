-- Computer runbook catalog and execution state.
-- creates: public.tenant_runbook_catalog
-- creates: public.computer_runbook_runs
-- creates: public.computer_runbook_tasks

CREATE TABLE IF NOT EXISTS public.tenant_runbook_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  source_version text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  enabled boolean NOT NULL DEFAULT true,
  definition jsonb NOT NULL,
  operator_overrides jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_runbook_catalog_status_allowed
    CHECK (status IN ('active','unavailable','archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_runbook_catalog_tenant_slug_uq
  ON public.tenant_runbook_catalog (tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_tenant_runbook_catalog_tenant_status
  ON public.tenant_runbook_catalog (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.computer_runbook_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  computer_id uuid NOT NULL REFERENCES public.computers(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  catalog_id uuid REFERENCES public.tenant_runbook_catalog(id) ON DELETE SET NULL,
  runbook_slug text NOT NULL,
  runbook_version text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_confirmation',
  invocation_mode text NOT NULL DEFAULT 'auto',
  selected_by_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  cancelled_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  definition_snapshot jsonb NOT NULL,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error jsonb,
  idempotency_key text,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT computer_runbook_runs_status_allowed
    CHECK (status IN ('awaiting_confirmation','queued','running','completed','failed','cancelled','rejected')),
  CONSTRAINT computer_runbook_runs_invocation_mode_allowed
    CHECK (invocation_mode IN ('auto','explicit','ad_hoc'))
);

CREATE INDEX IF NOT EXISTS idx_computer_runbook_runs_tenant_status
  ON public.computer_runbook_runs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_computer_runbook_runs_computer_created
  ON public.computer_runbook_runs (computer_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS computer_runbook_runs_tenant_computer_idempotency_uq
  ON public.computer_runbook_runs (tenant_id, computer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.computer_runbook_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.computer_runbook_runs(id) ON DELETE CASCADE,
  phase_id text NOT NULL,
  phase_title text NOT NULL,
  task_key text NOT NULL,
  title text NOT NULL,
  summary text,
  status text NOT NULL DEFAULT 'pending',
  depends_on jsonb NOT NULL DEFAULT '[]'::jsonb,
  capability_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL,
  details jsonb,
  output jsonb,
  error jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT computer_runbook_tasks_status_allowed
    CHECK (status IN ('pending','running','completed','failed','skipped','cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS computer_runbook_tasks_run_task_key_uq
  ON public.computer_runbook_tasks (run_id, task_key);

CREATE INDEX IF NOT EXISTS idx_computer_runbook_tasks_run_order
  ON public.computer_runbook_tasks (run_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_computer_runbook_tasks_tenant_status
  ON public.computer_runbook_tasks (tenant_id, status);
