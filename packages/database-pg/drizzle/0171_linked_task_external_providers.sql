-- Purpose: allow Twenty task-event server-contract smoke without native Twenty app install.
-- Plan: THNK-33 Twenty Server Contract Verification (server_contract_verified only)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0171_linked_task_external_providers.sql
-- creates-constraint: public.linked_tasks.linked_tasks_provider_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_provider_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_type_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.linked_tasks
  DROP CONSTRAINT IF EXISTS linked_tasks_provider_allowed,
  ADD CONSTRAINT linked_tasks_provider_allowed
    CHECK (provider IN ('lastmile', 'thinkwork', 'twenty'));

ALTER TABLE public.linked_task_events
  DROP CONSTRAINT IF EXISTS linked_task_events_provider_allowed,
  ADD CONSTRAINT linked_task_events_provider_allowed
    CHECK (provider IN ('lastmile', 'thinkwork', 'twenty'));

ALTER TABLE public.linked_task_events
  DROP CONSTRAINT IF EXISTS linked_task_events_type_allowed,
  ADD CONSTRAINT linked_task_events_type_allowed
    CHECK (event_type IN ('created', 'status_changed', 'completed', 'blocked', 'reassigned', 'due_date_changed', 'comment_added', 'sync_failed', 'writeback_posted'));

COMMIT;
