-- Activation Agent in-flight session state.
--
-- Plan:
--   docs/plans/2026-04-26-001-feat-agent-activation-operating-model-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0038_activation_sessions.sql
--
-- creates: public.activation_sessions
-- creates: public.activation_session_turns
-- creates-index: public.idx_activation_sessions_user_status
-- creates-index: public.uq_activation_sessions_user_in_progress
-- creates-index: public.idx_activation_session_turns_session_order

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'public.users does not exist';
  END IF;
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'public.tenants does not exist';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.activation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'full',
  focus_layer text,
  current_layer text NOT NULL DEFAULT 'rhythms',
  layer_states jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'in_progress',
  last_agent_message text,
  last_apply_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT activation_session_mode_allowed CHECK (mode IN ('full','refresh')),
  CONSTRAINT activation_session_status_allowed CHECK (status IN ('in_progress','ready_for_review','applied','abandoned')),
  CONSTRAINT activation_refresh_requires_focus_layer CHECK (mode <> 'refresh' OR focus_layer IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_activation_sessions_user_status
  ON public.activation_sessions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_activation_sessions_tenant
  ON public.activation_sessions (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_sessions_user_in_progress
  ON public.activation_sessions (user_id)
  WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS public.activation_session_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.activation_sessions(id) ON DELETE CASCADE,
  layer_id text NOT NULL,
  turn_index integer NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activation_turn_role_allowed CHECK (role IN ('user','agent')),
  CONSTRAINT uq_activation_session_turns_order UNIQUE (session_id, turn_index)
);

CREATE INDEX IF NOT EXISTS idx_activation_session_turns_session_order
  ON public.activation_session_turns (session_id, turn_index);

COMMIT;
