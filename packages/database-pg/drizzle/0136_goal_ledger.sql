-- Purpose: add explicit Goal ledger rows for promoted Thread workflows.
-- Plan: docs/plans/2026-05-27-003-feat-folder-native-goals-plan.md
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0136_goal_ledger.sql
-- Pre-flight:
--   SELECT to_regclass('public.goals');
--   SELECT to_regclass('public.uq_goals_thread_non_terminal');
-- creates: public.goals
-- creates: public.idx_goals_tenant_thread
-- creates: public.idx_goals_tenant_space_status
-- creates: public.idx_goals_folder_s3_prefix
-- creates: public.uq_goals_thread_non_terminal
-- creates-constraint: public.goals.goals_mode_allowed
-- creates-constraint: public.goals.goals_status_allowed

CREATE TABLE IF NOT EXISTS goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  template_key text,
  outcome text NOT NULL,
  owner_type text,
  owner_id text,
  mode text NOT NULL DEFAULT 'collaborate',
  status text NOT NULL DEFAULT 'active',
  progress_model text NOT NULL DEFAULT 'linked_tasks',
  completion_rule jsonb,
  review_policy jsonb,
  folder_s3_prefix text NOT NULL,
  reviewer_type text,
  reviewer_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goals_mode_allowed CHECK (mode IN ('delegate','collaborate')),
  CONSTRAINT goals_status_allowed CHECK (status IN ('active','in_review','completed','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_goals_tenant_thread
  ON goals (tenant_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_goals_tenant_space_status
  ON goals (tenant_id, space_id, status);

CREATE INDEX IF NOT EXISTS idx_goals_folder_s3_prefix
  ON goals (folder_s3_prefix);

CREATE UNIQUE INDEX IF NOT EXISTS uq_goals_thread_non_terminal
  ON goals (tenant_id, thread_id)
  WHERE status IN ('active','in_review');
