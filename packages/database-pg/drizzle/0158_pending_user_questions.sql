-- Purpose: add pending_user_questions for the ask_user_question HITL flow —
--   one row per question batch the parent agent asks; answer state lives on
--   this row (never mutated into the message's parts payload). The partial
--   unique index enforces one `pending` batch per thread (R8) so the intake
--   endpoint can return 409 on conflict.
-- Plan: docs/plans/2026-06-09-005-feat-ask-user-question-plan.md U1
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0158_pending_user_questions.sql
-- creates: public.pending_user_questions
-- creates: public.pending_user_questions_one_pending_per_thread
-- creates: public.idx_pending_user_questions_tenant
-- creates: public.idx_pending_user_questions_thread_status
-- creates-constraint: public.pending_user_questions.pending_user_questions_tenant_id_tenants_id_fk
-- creates-constraint: public.pending_user_questions.pending_user_questions_thread_id_threads_id_fk
-- creates-constraint: public.pending_user_questions.pending_user_questions_message_id_messages_id_fk
-- creates-constraint: public.pending_user_questions.pending_user_questions_thread_turn_id_thread_turns_id_fk
-- creates-constraint: public.pending_user_questions.pending_user_questions_status_allowed
-- creates-constraint: public.pending_user_questions.pending_user_questions_answered_via_allowed

\set ON_ERROR_STOP on

SET lock_timeout = '5s';
SET statement_timeout = '15min';

SELECT pg_advisory_lock(hashtext('migration:0158_pending_user_questions'));

CREATE TABLE IF NOT EXISTS public.pending_user_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  thread_turn_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  questions jsonb NOT NULL,
  answers jsonb,
  answered_via text,
  answered_by text,
  answered_at timestamptz,
  delegation_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_user_questions_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT pending_user_questions_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT pending_user_questions_message_id_messages_id_fk
    FOREIGN KEY (message_id)
    REFERENCES public.messages(id)
    ON DELETE CASCADE,
  CONSTRAINT pending_user_questions_thread_turn_id_thread_turns_id_fk
    FOREIGN KEY (thread_turn_id)
    REFERENCES public.thread_turns(id),
  CONSTRAINT pending_user_questions_status_allowed
    CHECK (status IN ('pending', 'answered', 'cancelled')),
  CONSTRAINT pending_user_questions_answered_via_allowed
    CHECK (answered_via IS NULL OR answered_via IN ('card', 'reply'))
);

-- R8: at most one pending question batch per thread; the intake endpoint
-- surfaces violations as 409.
CREATE UNIQUE INDEX IF NOT EXISTS pending_user_questions_one_pending_per_thread
  ON public.pending_user_questions (thread_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_user_questions_tenant
  ON public.pending_user_questions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_pending_user_questions_thread_status
  ON public.pending_user_questions (thread_id, status);

SELECT pg_advisory_unlock(hashtext('migration:0158_pending_user_questions'));
