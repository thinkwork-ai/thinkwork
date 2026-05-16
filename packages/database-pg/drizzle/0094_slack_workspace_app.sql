-- Purpose: add Slack workspace app persistence for installs, user links, and Slack thread mapping.
-- Plan: docs/plans/2026-05-16-004-feat-thinkwork-computer-slack-workspace-app-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0094_slack_workspace_app.sql
-- creates: public.slack_workspaces
-- creates: public.slack_user_links
-- creates: public.slack_threads
-- creates: public.uq_slack_workspaces_team
-- creates: public.uq_slack_workspaces_tenant_team
-- creates: public.idx_slack_workspaces_tenant_status
-- creates: public.uq_slack_user_links_team_user
-- creates: public.idx_slack_user_links_tenant_user
-- creates: public.idx_slack_user_links_user
-- creates: public.uq_slack_threads_team_channel_root
-- creates: public.idx_slack_threads_thread
-- creates: public.idx_slack_threads_tenant_team
-- creates-constraint: public.slack_workspaces.slack_workspaces_tenant_id_tenants_id_fk
-- creates-constraint: public.slack_workspaces.slack_workspaces_installed_by_user_id_users_id_fk
-- creates-constraint: public.slack_workspaces.slack_workspaces_status_allowed
-- creates-constraint: public.slack_user_links.slack_user_links_tenant_id_tenants_id_fk
-- creates-constraint: public.slack_user_links.slack_user_links_slack_team_id_slack_workspaces_slack_team_id_fk
-- creates-constraint: public.slack_user_links.slack_user_links_user_id_users_id_fk
-- creates-constraint: public.slack_user_links.slack_user_links_status_allowed
-- creates-constraint: public.slack_threads.slack_threads_tenant_id_tenants_id_fk
-- creates-constraint: public.slack_threads.slack_threads_slack_team_id_slack_workspaces_slack_team_id_fk
-- creates-constraint: public.slack_threads.slack_threads_thread_id_threads_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.slack_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slack_team_id text NOT NULL,
  slack_team_name text,
  bot_user_id text NOT NULL,
  bot_token_secret_path text NOT NULL,
  app_id text NOT NULL,
  installed_by_user_id uuid,
  status text NOT NULL DEFAULT 'active',
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slack_workspaces_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT slack_workspaces_installed_by_user_id_users_id_fk
    FOREIGN KEY (installed_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT slack_workspaces_status_allowed
    CHECK (status IN ('active','uninstalled','revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_workspaces_team
  ON public.slack_workspaces (slack_team_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_workspaces_tenant_team
  ON public.slack_workspaces (tenant_id, slack_team_id);

CREATE INDEX IF NOT EXISTS idx_slack_workspaces_tenant_status
  ON public.slack_workspaces (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.slack_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  user_id uuid NOT NULL,
  slack_user_name text,
  slack_user_email text,
  status text NOT NULL DEFAULT 'active',
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slack_user_links_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT slack_user_links_slack_team_id_slack_workspaces_slack_team_id_fk
    FOREIGN KEY (slack_team_id)
    REFERENCES public.slack_workspaces(slack_team_id)
    ON DELETE RESTRICT,
  CONSTRAINT slack_user_links_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE RESTRICT,
  CONSTRAINT slack_user_links_status_allowed
    CHECK (status IN ('active','unlinked','orphaned','suspended'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_user_links_team_user
  ON public.slack_user_links (slack_team_id, slack_user_id);

CREATE INDEX IF NOT EXISTS idx_slack_user_links_tenant_user
  ON public.slack_user_links (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_slack_user_links_user
  ON public.slack_user_links (user_id);

CREATE TABLE IF NOT EXISTS public.slack_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  slack_team_id text NOT NULL,
  channel_id text NOT NULL,
  root_thread_ts text,
  thread_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slack_threads_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT slack_threads_slack_team_id_slack_workspaces_slack_team_id_fk
    FOREIGN KEY (slack_team_id)
    REFERENCES public.slack_workspaces(slack_team_id)
    ON DELETE RESTRICT,
  CONSTRAINT slack_threads_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_slack_threads_team_channel_root
  ON public.slack_threads (slack_team_id, channel_id, root_thread_ts)
  NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS idx_slack_threads_thread
  ON public.slack_threads (thread_id);

CREATE INDEX IF NOT EXISTS idx_slack_threads_tenant_team
  ON public.slack_threads (tenant_id, slack_team_id);

COMMIT;
