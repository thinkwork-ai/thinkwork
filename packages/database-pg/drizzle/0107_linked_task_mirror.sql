-- Purpose: add ThinkWork-side linked task mirror tables for Space Threads.
-- Plan: docs/plans/2026-05-19-003-feat-spaces-customer-onboarding-v1-plan.md (U4)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0107_linked_task_mirror.sql
-- creates: public.linked_tasks
-- creates: public.linked_task_events
-- creates: public.uq_linked_tasks_external
-- creates: public.uq_linked_tasks_checklist_item
-- creates: public.idx_linked_tasks_thread
-- creates: public.idx_linked_tasks_space
-- creates: public.uq_linked_task_events_external
-- creates: public.idx_linked_task_events_task
-- creates: public.idx_linked_task_events_thread
-- creates-function: public.enforce_linked_task_tenant
-- creates-function: public.enforce_linked_task_event_tenant
-- creates-trigger: public.linked_tasks.linked_tasks_tenant_guard
-- creates-trigger: public.linked_task_events.linked_task_events_tenant_guard
-- creates-constraint: public.linked_tasks.linked_tasks_tenant_id_tenants_id_fk
-- creates-constraint: public.linked_tasks.linked_tasks_space_id_spaces_id_fk
-- creates-constraint: public.linked_tasks.linked_tasks_thread_id_threads_id_fk
-- creates-constraint: public.linked_tasks.linked_tasks_checklist_item_id_space_checklist_items_id_fk
-- creates-constraint: public.linked_tasks.linked_tasks_provider_allowed
-- creates-constraint: public.linked_tasks.linked_tasks_status_allowed
-- creates-constraint: public.linked_tasks.linked_tasks_sync_status_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_tenant_id_tenants_id_fk
-- creates-constraint: public.linked_task_events.linked_task_events_linked_task_id_linked_tasks_id_fk
-- creates-constraint: public.linked_task_events.linked_task_events_space_id_spaces_id_fk
-- creates-constraint: public.linked_task_events.linked_task_events_thread_id_threads_id_fk
-- creates-constraint: public.linked_task_events.linked_task_events_provider_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_type_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_previous_status_allowed
-- creates-constraint: public.linked_task_events.linked_task_events_new_status_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.linked_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  space_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  checklist_item_id uuid,
  provider text NOT NULL DEFAULT 'lastmile',
  external_task_id text NOT NULL,
  external_task_url text,
  title text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  role_key text,
  assignee_display text,
  assignee_external_id text,
  status text NOT NULL DEFAULT 'unknown',
  blocked boolean NOT NULL DEFAULT false,
  sync_status text NOT NULL DEFAULT 'pending',
  last_synced_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linked_tasks_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_tasks_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_tasks_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_tasks_checklist_item_id_space_checklist_items_id_fk
    FOREIGN KEY (checklist_item_id)
    REFERENCES public.space_checklist_items(id)
    ON DELETE SET NULL,
  CONSTRAINT linked_tasks_provider_allowed
    CHECK (provider IN ('lastmile')),
  CONSTRAINT linked_tasks_status_allowed
    CHECK (status IN ('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled')),
  CONSTRAINT linked_tasks_sync_status_allowed
    CHECK (sync_status IN ('pending', 'synced', 'warning', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_linked_tasks_external
  ON public.linked_tasks (tenant_id, provider, external_task_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_linked_tasks_checklist_item
  ON public.linked_tasks (tenant_id, thread_id, checklist_item_id)
  WHERE checklist_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_linked_tasks_thread
  ON public.linked_tasks (tenant_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_linked_tasks_space
  ON public.linked_tasks (tenant_id, space_id);

CREATE TABLE IF NOT EXISTS public.linked_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  linked_task_id uuid NOT NULL,
  space_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'lastmile',
  event_type text NOT NULL,
  external_event_id text,
  previous_status text,
  new_status text,
  message text,
  metadata jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linked_task_events_tenant_id_tenants_id_fk
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_task_events_linked_task_id_linked_tasks_id_fk
    FOREIGN KEY (linked_task_id)
    REFERENCES public.linked_tasks(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_task_events_space_id_spaces_id_fk
    FOREIGN KEY (space_id)
    REFERENCES public.spaces(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_task_events_thread_id_threads_id_fk
    FOREIGN KEY (thread_id)
    REFERENCES public.threads(id)
    ON DELETE CASCADE,
  CONSTRAINT linked_task_events_provider_allowed
    CHECK (provider IN ('lastmile')),
  CONSTRAINT linked_task_events_type_allowed
    CHECK (event_type IN ('created', 'completed', 'blocked', 'reassigned', 'due_date_changed', 'sync_failed', 'writeback_posted')),
  CONSTRAINT linked_task_events_previous_status_allowed
    CHECK (previous_status IS NULL OR previous_status IN ('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled')),
  CONSTRAINT linked_task_events_new_status_allowed
    CHECK (new_status IS NULL OR new_status IN ('unknown', 'todo', 'in_progress', 'completed', 'blocked', 'cancelled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_linked_task_events_external
  ON public.linked_task_events (tenant_id, provider, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_linked_task_events_task
  ON public.linked_task_events (linked_task_id);

CREATE INDEX IF NOT EXISTS idx_linked_task_events_thread
  ON public.linked_task_events (tenant_id, thread_id);

CREATE OR REPLACE FUNCTION public.enforce_linked_task_tenant()
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
    RAISE EXCEPTION 'linked task tenant mismatch for thread %', NEW.thread_id
      USING ERRCODE = '23514';
  END IF;

  IF target_space_id IS NULL OR target_space_id <> NEW.space_id THEN
    RAISE EXCEPTION 'linked task space mismatch for thread %', NEW.thread_id
      USING ERRCODE = '23514';
  END IF;

  SELECT tenant_id INTO target_tenant_id
  FROM public.spaces
  WHERE id = NEW.space_id;

  IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'linked task tenant mismatch for space %', NEW.space_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.checklist_item_id IS NOT NULL THEN
    SELECT tenant_id, space_id INTO target_tenant_id, target_space_id
    FROM public.space_checklist_items
    WHERE id = NEW.checklist_item_id;

    IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'linked task tenant mismatch for checklist item %', NEW.checklist_item_id
        USING ERRCODE = '23514';
    END IF;

    IF target_space_id <> NEW.space_id THEN
      RAISE EXCEPTION 'linked task space mismatch for checklist item %', NEW.checklist_item_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS linked_tasks_tenant_guard
  ON public.linked_tasks;

CREATE TRIGGER linked_tasks_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.linked_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_linked_task_tenant();

CREATE OR REPLACE FUNCTION public.enforce_linked_task_event_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_tenant_id uuid;
  target_space_id uuid;
  target_thread_id uuid;
BEGIN
  SELECT tenant_id, space_id, thread_id INTO target_tenant_id, target_space_id, target_thread_id
  FROM public.linked_tasks
  WHERE id = NEW.linked_task_id;

  IF target_tenant_id IS NULL OR target_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'linked task event tenant mismatch for linked task %', NEW.linked_task_id
      USING ERRCODE = '23514';
  END IF;

  IF target_space_id <> NEW.space_id OR target_thread_id <> NEW.thread_id THEN
    RAISE EXCEPTION 'linked task event parent mismatch for linked task %', NEW.linked_task_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS linked_task_events_tenant_guard
  ON public.linked_task_events;

CREATE TRIGGER linked_task_events_tenant_guard
  BEFORE INSERT OR UPDATE
  ON public.linked_task_events
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_linked_task_event_tenant();

COMMIT;
