-- Purpose: allow ThinkWork-native checklist rows in linked task compatibility storage.
-- Plan: docs/plans/2026-05-25-004-feat-customer-onboarding-native-checklist-plan.md (U2)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0135_native_checklist_linked_tasks.sql
-- creates-constraint: public.linked_tasks.linked_tasks_provider_allowed
-- creates-constraint: public.linked_tasks.linked_tasks_status_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_provider_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_type_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_previous_status_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_new_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.linked_tasks
  DROP CONSTRAINT IF EXISTS linked_tasks_provider_allowed,
  ADD CONSTRAINT linked_tasks_provider_allowed
    CHECK (provider IN ('lastmile', 'thinkwork'));

ALTER TABLE public.linked_tasks
  DROP CONSTRAINT IF EXISTS linked_tasks_status_allowed,
  ADD CONSTRAINT linked_tasks_status_allowed
    CHECK (status IN ('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled', 'not_applicable'));

ALTER TABLE public.linked_task_events
  DROP CONSTRAINT IF EXISTS linked_task_events_provider_allowed,
  ADD CONSTRAINT linked_task_events_provider_allowed
    CHECK (provider IN ('lastmile', 'thinkwork'));

ALTER TABLE public.linked_task_events
  DROP CONSTRAINT IF EXISTS linked_task_events_type_allowed,
  ADD CONSTRAINT linked_task_events_type_allowed
    CHECK (event_type IN ('created', 'status_changed', 'completed', 'blocked', 'reassigned', 'due_date_changed', 'sync_failed', 'writeback_posted'));

ALTER TABLE public.linked_task_events
  DROP CONSTRAINT IF EXISTS linked_task_events_previous_status_allowed,
  ADD CONSTRAINT linked_task_events_previous_status_allowed
    CHECK (previous_status IS NULL OR previous_status IN ('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled', 'not_applicable'));

ALTER TABLE public.linked_task_events
  DROP CONSTRAINT IF EXISTS linked_task_events_new_status_allowed,
  ADD CONSTRAINT linked_task_events_new_status_allowed
    CHECK (new_status IS NULL OR new_status IN ('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled', 'not_applicable'));

COMMIT;
