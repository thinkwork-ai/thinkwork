-- Purpose: attach threads to Spaces and add human/agent thread participants.
-- Plan: docs/plans/2026-05-19-003-feat-spaces-customer-onboarding-v1-plan.md (U3)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0106_space_threads_participants.sql
-- creates-column: public.threads.space_id
-- creates: public.idx_threads_tenant_space_updated
-- creates: public.thread_participants
-- creates: public.uq_thread_participants_user
-- creates: public.uq_thread_participants_agent
-- creates: public.idx_thread_participants_thread
-- creates: public.idx_thread_participants_space
-- creates-function: public.enforce_thread_participant_tenant
-- creates-function: public.enforce_thread_space_tenant
-- creates-trigger: public.thread_participants.thread_participants_tenant_guard
-- creates-trigger: public.threads.threads_space_tenant_guard
-- creates-constraint: public.threads.threads_space_id_spaces_id_fk
-- creates-constraint: public.thread_participants.thread_participants_tenant_id_tenants_id_fk
-- creates-constraint: public.thread_participants.thread_participants_thread_id_threads_id_fk
-- creates-constraint: public.thread_participants.thread_participants_space_id_spaces_id_fk
-- creates-constraint: public.thread_participants.thread_participants_user_id_users_id_fk
-- creates-constraint: public.thread_participants.thread_participants_agent_id_agents_id_fk
-- creates-constraint: public.thread_participants.thread_participants_type_allowed
-- creates-constraint: public.thread_participants.thread_participants_target_matches_type
-- creates-constraint: public.thread_participants.thread_participants_notification_preference_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.threads
  ADD COLUMN IF NOT EXISTS space_id uuid;

DO $$
BEGIN
  ALTER TABLE public.threads
    ADD CONSTRAINT threads_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_threads_tenant_space_updated
  ON public.threads (tenant_id, space_id, updated_at DESC)
  WHERE space_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_thread_space_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
BEGIN
  IF NEW.space_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO target_tenant_id
  FROM public.spaces
  WHERE id = NEW.space_id;

  IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'thread space tenant mismatch for space %', NEW.space_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS threads_space_tenant_guard
  ON public.threads;

CREATE TRIGGER threads_space_tenant_guard
  BEFORE INSERT OR UPDATE OF tenant_id, space_id
  ON public.threads
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_thread_space_tenant();

CREATE TABLE IF NOT EXISTS public.thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  space_id uuid,
  participant_type text NOT NULL,
  user_id uuid,
  agent_id uuid,
  role text NOT NULL DEFAULT 'member',
  source text NOT NULL DEFAULT 'manual',
  notification_preference text NOT NULL DEFAULT 'subscribed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_participants_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_participants_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_participants_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE SET NULL,
  CONSTRAINT thread_participants_user_id_users_id_fk
    FOREIGN KEY (user_id)
    REFERENCES public.users(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_participants_agent_id_agents_id_fk
    FOREIGN KEY (agent_id)
    REFERENCES public.agents(id)
    ON DELETE CASCADE,
  CONSTRAINT thread_participants_type_allowed
    CHECK (participant_type IN ('user', 'agent')),
  CONSTRAINT thread_participants_target_matches_type
    CHECK (
      (participant_type = 'user' AND user_id IS NOT NULL AND agent_id IS NULL)
      OR
      (participant_type = 'agent' AND agent_id IS NOT NULL AND user_id IS NULL)
    ),
  CONSTRAINT thread_participants_notification_preference_allowed
    CHECK (notification_preference IN ('subscribed', 'mentions', 'muted'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_participants_user
  ON public.thread_participants (tenant_id, thread_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_thread_participants_agent
  ON public.thread_participants (tenant_id, thread_id, agent_id)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_thread_participants_thread
  ON public.thread_participants (thread_id);

CREATE INDEX IF NOT EXISTS idx_thread_participants_space
  ON public.thread_participants (tenant_id, space_id);

CREATE OR REPLACE FUNCTION public.enforce_thread_participant_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
  target_space_id uuid;
BEGIN
  SELECT tenant_id, space_id INTO target_tenant_id, target_space_id
  FROM public.threads
  WHERE id = NEW.thread_id;

  IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'thread participant tenant mismatch for thread %', NEW.thread_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.space_id IS DISTINCT FROM target_space_id THEN
    RAISE EXCEPTION 'thread participant space mismatch for thread %', NEW.thread_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.participant_type = 'user' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.users
    WHERE id = NEW.user_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'thread participant tenant mismatch for user %', NEW.user_id
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.participant_type = 'agent' THEN
    SELECT tenant_id INTO target_tenant_id
    FROM public.agents
    WHERE id = NEW.agent_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'thread participant tenant mismatch for agent %', NEW.agent_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS thread_participants_tenant_guard
  ON public.thread_participants;

CREATE TRIGGER thread_participants_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.thread_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_thread_participant_tenant();

COMMIT;
