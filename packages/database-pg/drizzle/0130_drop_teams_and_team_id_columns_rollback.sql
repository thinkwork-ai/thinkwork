-- Rollback for 0130_drop_teams_and_team_id_columns.sql.
--
-- Recreates the three teams tables and the four dropped team_id columns
-- on routines/scheduled_jobs/workflow_configs/cost_events. Schema-only;
-- the 4 rows of team data + any non-null team_id values in the alive
-- tables are NOT restored.
--
-- creates: public.teams
-- creates: public.team_users
-- creates: public.team_agents
-- creates-column: public.routines.team_id
-- creates-column: public.scheduled_jobs.team_id
-- creates-column: public.workflow_configs.team_id
-- creates-column: public.cost_events.team_id
-- creates: public.workflow_configs_tenant_team_idx

\set ON_ERROR_STOP on

BEGIN;

-- Restore team_id columns
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE public.scheduled_jobs ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE public.workflow_configs ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE public.cost_events ADD COLUMN IF NOT EXISTS team_id uuid;

CREATE INDEX IF NOT EXISTS workflow_configs_tenant_team_idx
  ON public.workflow_configs (tenant_id, team_id);

-- Recreate teams (per pg_dump shapes captured 2026-05-24)
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  slug text,
  description text,
  type text NOT NULL DEFAULT 'standard',
  status text NOT NULL DEFAULT 'active',
  budget_monthly_cents integer,
  metadata jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  role text NOT NULL DEFAULT 'member',
  joined_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  team_id uuid NOT NULL REFERENCES public.teams(id),
  agent_id uuid NOT NULL REFERENCES public.agents(id),
  role text NOT NULL DEFAULT 'member',
  joined_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMIT;
