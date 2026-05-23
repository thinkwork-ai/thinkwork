-- Runtime observability for thread turns and usage/cost events.
--
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0127_runtime_type_observability.sql
-- creates-column: public.thread_turns.runtime_type
-- creates: public.idx_thread_turns_runtime
-- creates-column: public.cost_events.runtime_type
-- creates: public.idx_cost_events_runtime

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.thread_turns
  ADD COLUMN IF NOT EXISTS runtime_type text;

CREATE INDEX IF NOT EXISTS idx_thread_turns_runtime
  ON public.thread_turns (tenant_id, runtime_type);

ALTER TABLE public.cost_events
  ADD COLUMN IF NOT EXISTS runtime_type text;

CREATE INDEX IF NOT EXISTS idx_cost_events_runtime
  ON public.cost_events (tenant_id, runtime_type);

COMMIT;
