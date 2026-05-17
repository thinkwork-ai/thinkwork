-- Purpose: reframe Computers as shared tenant-managed capabilities with direct user and Team assignments.
-- Plan: docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md (U1)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0097_shared_computers.sql
-- creates-column: public.computers.scope
-- creates: public.idx_computers_tenant_scope_status
-- creates: public.computer_assignments
-- creates: public.uq_computer_assignments_user
-- creates: public.uq_computer_assignments_team
-- creates: public.idx_computer_assignments_computer
-- creates: public.idx_computer_assignments_tenant_user
-- creates: public.idx_computer_assignments_tenant_team
-- creates-function: public.enforce_computer_assignment_tenant
-- creates-trigger: public.computer_assignments.computer_assignments_tenant_guard
-- creates-constraint: public.computers.computers_owner_user_id_users_id_fk
-- creates-constraint: public.computers.computers_scope_allowed
-- creates-constraint: public.computer_assignments.computer_assignments_tenant_id_tenants_id_fk
-- creates-constraint: public.computer_assignments.computer_assignments_computer_id_computers_id_fk
-- creates-constraint: public.computer_assignments.computer_assignments_user_id_users_id_fk
-- creates-constraint: public.computer_assignments.computer_assignments_team_id_teams_id_fk
-- creates-constraint: public.computer_assignments.computer_assignments_assigned_by_user_id_users_id_fk
-- creates-constraint: public.computer_assignments.computer_assignments_subject_type_allowed
-- creates-constraint: public.computer_assignments.computer_assignments_subject_matches_target

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.computers
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'historical_personal';

ALTER TABLE public.computers
  ALTER COLUMN scope SET DEFAULT 'shared';

ALTER TABLE public.computers
  ALTER COLUMN owner_user_id DROP NOT NULL;

DO $$
DECLARE
  owner_fk_name text;
BEGIN
  SELECT constraint_name
    INTO owner_fk_name
  FROM information_schema.key_column_usage
  WHERE table_schema = 'public'
    AND table_name = 'computers'
    AND column_name = 'owner_user_id'
    AND constraint_name IN (
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'computers'
        AND constraint_type = 'FOREIGN KEY'
    )
  LIMIT 1;

  IF owner_fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.computers DROP CONSTRAINT %I', owner_fk_name);
  END IF;
END $$;

ALTER TABLE public.computers
  ADD CONSTRAINT computers_owner_user_id_users_id_fk
  FOREIGN KEY (owner_user_id)
  REFERENCES public.users(id)
  ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.computers
    ADD CONSTRAINT computers_scope_allowed
    CHECK (scope IN ('shared', 'historical_personal'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DROP INDEX IF EXISTS public.uq_computers_active_owner;

CREATE INDEX IF NOT EXISTS idx_computers_tenant_scope_status
  ON public.computers (tenant_id, scope, status);

CREATE TABLE IF NOT EXISTS public.computer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  computer_id uuid NOT NULL,
  subject_type text NOT NULL,
  user_id uuid,
  team_id uuid,
  role text NOT NULL DEFAULT 'member',
  assigned_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT computer_assignments_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT computer_assignments_computer_id_computers_id_fk
    FOREIGN KEY (computer_id)
    REFERENCES public.computers(id)
    ON DELETE CASCADE,
  CONSTRAINT computer_assignments_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE,
  CONSTRAINT computer_assignments_team_id_teams_id_fk
    FOREIGN KEY (team_id)
    REFERENCES public.teams(id)
    ON DELETE CASCADE,
  CONSTRAINT computer_assignments_assigned_by_user_id_users_id_fk
    FOREIGN KEY (assigned_by_user_id)
    REFERENCES public.users(id)
    ON DELETE SET NULL,
  CONSTRAINT computer_assignments_subject_type_allowed
    CHECK (subject_type IN ('user', 'team')),
  CONSTRAINT computer_assignments_subject_matches_target
    CHECK (
      (subject_type = 'user' AND user_id IS NOT NULL AND team_id IS NULL)
      OR
      (subject_type = 'team' AND team_id IS NOT NULL AND user_id IS NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_computer_assignments_user
  ON public.computer_assignments (tenant_id, computer_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_computer_assignments_team
  ON public.computer_assignments (tenant_id, computer_id, team_id)
  WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_computer_assignments_computer
  ON public.computer_assignments (computer_id);

CREATE INDEX IF NOT EXISTS idx_computer_assignments_tenant_user
  ON public.computer_assignments (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_computer_assignments_tenant_team
  ON public.computer_assignments (tenant_id, team_id);

CREATE OR REPLACE FUNCTION public.enforce_computer_assignment_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO target_tenant_id
  FROM public.computers
  WHERE id = NEW.computer_id;

  IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'computer assignment tenant mismatch for computer %', NEW.computer_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.subject_type = 'user' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.users
    WHERE id = NEW.user_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'computer assignment tenant mismatch for user %', NEW.user_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.subject_type = 'team' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.teams
    WHERE id = NEW.team_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'computer assignment tenant mismatch for team %', NEW.team_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS computer_assignments_tenant_guard
  ON public.computer_assignments;

CREATE TRIGGER computer_assignments_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.computer_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_computer_assignment_tenant();

COMMIT;
