-- Purpose: add structured message mentions for collaborative Space Threads.
-- Plan: docs/plans/2026-05-19-003-feat-spaces-customer-onboarding-v1-plan.md (U10)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0108_message_mentions.sql
-- creates: public.message_mentions
-- creates: public.uq_message_mentions_target
-- creates: public.idx_message_mentions_thread
-- creates: public.idx_message_mentions_target
-- creates-function: public.enforce_message_mention_tenant
-- creates-trigger: public.message_mentions.message_mentions_tenant_guard
-- creates-constraint: public.message_mentions.message_mentions_tenant_id_tenants_id_fk
-- creates-constraint: public.message_mentions.message_mentions_thread_id_threads_id_fk
-- creates-constraint: public.message_mentions.message_mentions_message_id_messages_id_fk
-- creates-constraint: public.message_mentions.message_mentions_target_type_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.message_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  message_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  display_name text NOT NULL,
  raw_text text,
  start_offset integer,
  end_offset integer,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_mentions_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT message_mentions_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT message_mentions_message_id_messages_id_fk
    FOREIGN KEY (message_id)
    REFERENCES public.messages(id)
    ON DELETE CASCADE,
  CONSTRAINT message_mentions_target_type_allowed
    CHECK (target_type IN ('user', 'agent'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_mentions_target
  ON public.message_mentions (message_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_message_mentions_thread
  ON public.message_mentions (tenant_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_message_mentions_target
  ON public.message_mentions (tenant_id, target_type, target_id);

CREATE OR REPLACE FUNCTION public.enforce_message_mention_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  message_tenant uuid;
  message_thread uuid;
BEGIN
  SELECT tenant_id, thread_id
  INTO message_tenant, message_thread
  FROM public.messages
  WHERE id = NEW.message_id;

  IF message_tenant IS NULL THEN
    RAISE EXCEPTION 'message_mentions.message_id % does not reference an existing message', NEW.message_id;
  END IF;

  IF message_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'message_mentions tenant mismatch: mention %, message %', NEW.tenant_id, message_tenant;
  END IF;

  IF message_thread <> NEW.thread_id THEN
    RAISE EXCEPTION 'message_mentions thread mismatch: mention %, message %', NEW.thread_id, message_thread;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_mentions_tenant_guard ON public.message_mentions;
CREATE TRIGGER message_mentions_tenant_guard
  BEFORE INSERT OR UPDATE ON public.message_mentions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_message_mention_tenant();

COMMIT;
