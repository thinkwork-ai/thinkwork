-- Purpose: add requester idle memory learning orchestration state and run history.
-- Plan: docs/plans/2026-05-18-001-feat-requester-idle-memory-learning-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0099_thread_idle_learning.sql
-- creates: public.thread_idle_learning_state
-- creates: public.uq_thread_idle_learning_state_thread
-- creates: public.idx_thread_idle_learning_state_tenant_requester
-- creates: public.idx_thread_idle_learning_state_tenant_status_scheduled
-- creates: public.idx_thread_idle_learning_state_scheduled_job
-- creates: public.thread_idle_learning_runs
-- creates: public.idx_thread_idle_learning_runs_thread_created
-- creates: public.idx_thread_idle_learning_runs_requester_created
-- creates: public.idx_thread_idle_learning_runs_status
-- creates: public.idx_thread_idle_learning_runs_scheduled_job
-- creates: public.uq_scheduled_jobs_thread_idle_learning_thread
-- creates-constraint: public.thread_idle_learning_state.thread_idle_learning_state_tenant_id_tenants_id_fk
-- creates-constraint: public.thread_idle_learning_state.thread_idle_learning_state_thread_id_threads_id_fk
-- creates-constraint: public.thread_idle_learning_state.thread_idle_learning_state_computer_id_computers_id_fk
-- creates-constraint: public.thread_idle_learning_state.thread_idle_learning_state_requester_user_id_users_id_fk
-- creates-constraint: public.thread_idle_learning_state.thread_idle_learning_state_scheduled_job_id_scheduled_jobs_id_fk
-- creates-constraint: public.thread_idle_learning_state.thread_idle_learning_state_status_allowed
-- creates-constraint: public.thread_idle_learning_runs.thread_idle_learning_runs_tenant_id_tenants_id_fk
-- creates-constraint: public.thread_idle_learning_runs.thread_idle_learning_runs_thread_id_threads_id_fk
-- creates-constraint: public.thread_idle_learning_runs.thread_idle_learning_runs_computer_id_computers_id_fk
-- creates-constraint: public.thread_idle_learning_runs.thread_idle_learning_runs_requester_user_id_users_id_fk
-- creates-constraint: public.thread_idle_learning_runs.thread_idle_learning_runs_scheduled_job_id_scheduled_jobs_id_fk
-- creates-constraint: public.thread_idle_learning_runs.thread_idle_learning_runs_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.thread_idle_learning_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  computer_id uuid,
  requester_user_id uuid,
  activity_sequence integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL,
  scheduled_for timestamptz,
  scheduled_job_id uuid,
  status text NOT NULL DEFAULT 'idle_scheduled',
  last_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_idle_learning_state_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_idle_learning_state_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_idle_learning_state_computer_id_computers_id_fk
    FOREIGN KEY (computer_id)
    REFERENCES public.computers(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_idle_learning_state_requester_user_id_users_id_fk
    FOREIGN KEY (requester_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_idle_learning_state_scheduled_job_id_scheduled_jobs_id_fk
    FOREIGN KEY (scheduled_job_id)
    REFERENCES public.scheduled_jobs(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_idle_learning_state_status_allowed
    CHECK (status IN ('idle_scheduled','running','stale','changed','no_change','failed','disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_idle_learning_state_thread
  ON public.thread_idle_learning_state (thread_id);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_state_tenant_requester
  ON public.thread_idle_learning_state (tenant_id, requester_user_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_state_tenant_status_scheduled
  ON public.thread_idle_learning_state (tenant_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_state_scheduled_job
  ON public.thread_idle_learning_state (scheduled_job_id);

CREATE TABLE IF NOT EXISTS public.thread_idle_learning_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  computer_id uuid,
  requester_user_id uuid,
  scheduled_job_id uuid,
  activity_sequence integer NOT NULL,
  scheduled_for timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  changed_files jsonb,
  candidate_summary jsonb,
  report_s3_key text,
  error text,
  budget jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_idle_learning_runs_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_idle_learning_runs_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_idle_learning_runs_computer_id_computers_id_fk
    FOREIGN KEY (computer_id)
    REFERENCES public.computers(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_idle_learning_runs_requester_user_id_users_id_fk
    FOREIGN KEY (requester_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_idle_learning_runs_scheduled_job_id_scheduled_jobs_id_fk
    FOREIGN KEY (scheduled_job_id)
    REFERENCES public.scheduled_jobs(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_idle_learning_runs_status_allowed
    CHECK (status IN ('running','stale_noop','changed','no_change','failed','rolled_back'))
);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_runs_thread_created
  ON public.thread_idle_learning_runs (tenant_id, thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_runs_requester_created
  ON public.thread_idle_learning_runs (tenant_id, requester_user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_runs_status
  ON public.thread_idle_learning_runs (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_thread_idle_learning_runs_scheduled_job
  ON public.thread_idle_learning_runs (scheduled_job_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_jobs_thread_idle_learning_thread
  ON public.scheduled_jobs (tenant_id, (config->>'threadId'))
  WHERE trigger_type = 'thread_idle_memory_learning';

COMMIT;
