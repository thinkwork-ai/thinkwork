-- Activation Agent bundle-apply outbox for non-transactional fan-out.
--
-- Plan:
--   docs/plans/2026-04-26-001-feat-agent-activation-operating-model-plan.md
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0039_activation_apply_outbox.sql
--
-- creates: public.activation_apply_outbox
-- creates-index: public.idx_activation_apply_outbox_status_created

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.activation_sessions') IS NULL THEN
    RAISE EXCEPTION 'public.activation_sessions does not exist; apply 0038_activation_sessions.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.activation_apply_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.activation_sessions(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT activation_apply_outbox_status_allowed CHECK (status IN ('pending','processing','completed','failed')),
  CONSTRAINT activation_apply_outbox_item_type_allowed CHECK (item_type IN ('user_md','memory_seed','wiki_seed'))
);

CREATE INDEX IF NOT EXISTS idx_activation_apply_outbox_status_created
  ON public.activation_apply_outbox (status, created_at);

CREATE INDEX IF NOT EXISTS idx_activation_apply_outbox_session
  ON public.activation_apply_outbox (session_id);

COMMIT;
