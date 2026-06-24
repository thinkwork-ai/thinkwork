-- 0187_native_work_items.sql
--
-- Purpose: create the native Work Item substrate for ThinkWork-owned task state.
-- Plan: THNK-69 Native work item tracking capability.
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0187_native_work_items.sql
--
-- creates: public.work_item_statuses
-- creates: public.work_items
-- creates: public.work_item_thread_links
-- creates: public.work_item_events
-- creates: public.work_item_saved_views
-- creates: public.work_item_external_refs
-- creates: public.uq_work_item_statuses_space_name
-- creates: public.uq_work_item_statuses_space_default
-- creates: public.idx_work_item_statuses_space_order
-- creates: public.idx_work_items_space_status
-- creates: public.idx_work_items_space_due
-- creates: public.idx_work_items_owner_user
-- creates: public.idx_work_items_owner_agent
-- creates: public.idx_work_items_template_source
-- creates: public.uq_work_item_thread_links_pair
-- creates: public.idx_work_item_thread_links_thread
-- creates: public.idx_work_item_thread_links_space
-- creates: public.idx_work_item_events_item_created
-- creates: public.idx_work_item_events_thread
-- creates: public.uq_work_item_saved_views_user_name
-- creates: public.uq_work_item_saved_views_user_default
-- creates: public.idx_work_item_saved_views_user
-- creates: public.idx_work_item_saved_views_space
-- creates: public.uq_work_item_external_refs_provider
-- creates: public.idx_work_item_external_refs_item
-- creates-constraint: public.work_item_statuses.work_item_statuses_category_allowed
-- creates-constraint: public.work_items.work_items_priority_allowed
-- creates-constraint: public.work_item_thread_links.work_item_thread_links_relationship_allowed
-- creates-constraint: public.work_item_events.work_item_events_type_allowed
-- creates-constraint: public.work_item_saved_views.work_item_saved_views_type_allowed
-- creates-constraint: public.work_item_saved_views.work_item_saved_views_owner_required
-- creates-constraint: public.work_item_external_refs.work_item_external_refs_provider_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.work_item_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  color text,
  icon text,
  category text NOT NULL DEFAULT 'todo',
  is_active boolean NOT NULL DEFAULT true,
  is_final boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_statuses_category_allowed
    CHECK (category IN ('todo', 'active', 'blocked', 'done', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_statuses_space_name
  ON public.work_item_statuses (tenant_id, space_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_statuses_space_default
  ON public.work_item_statuses (tenant_id, space_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_work_item_statuses_space_order
  ON public.work_item_statuses (tenant_id, space_id, display_order);

CREATE TABLE IF NOT EXISTS public.work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  status_id uuid REFERENCES public.work_item_statuses(id) ON DELETE RESTRICT,
  title text NOT NULL,
  notes text,
  priority text NOT NULL DEFAULT 'normal',
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  due_at timestamptz,
  required boolean NOT NULL DEFAULT true,
  applicable boolean NOT NULL DEFAULT true,
  blocked boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  completed_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  template_source_id uuid REFERENCES public.space_checklist_items(id) ON DELETE SET NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT work_items_priority_allowed
    CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);

CREATE INDEX IF NOT EXISTS idx_work_items_space_status
  ON public.work_items (tenant_id, space_id, status_id);

CREATE INDEX IF NOT EXISTS idx_work_items_space_due
  ON public.work_items (tenant_id, space_id, due_at);

CREATE INDEX IF NOT EXISTS idx_work_items_owner_user
  ON public.work_items (tenant_id, owner_user_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_work_items_owner_agent
  ON public.work_items (tenant_id, owner_agent_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_work_items_template_source
  ON public.work_items (tenant_id, template_source_id);

CREATE TABLE IF NOT EXISTS public.work_item_thread_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'primary',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_thread_links_relationship_allowed
    CHECK (relationship IN ('primary', 'mentioned', 'evidence', 'follow_up'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_thread_links_pair
  ON public.work_item_thread_links (tenant_id, work_item_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_work_item_thread_links_thread
  ON public.work_item_thread_links (tenant_id, thread_id);

CREATE INDEX IF NOT EXISTS idx_work_item_thread_links_space
  ON public.work_item_thread_links (tenant_id, space_id);

CREATE TABLE IF NOT EXISTS public.work_item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  previous_status_id uuid REFERENCES public.work_item_statuses(id) ON DELETE SET NULL,
  new_status_id uuid REFERENCES public.work_item_statuses(id) ON DELETE SET NULL,
  message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_events_type_allowed
    CHECK (event_type IN ('created', 'updated', 'status_changed', 'completed', 'blocked', 'unblocked', 'assigned', 'due_date_changed', 'applicability_changed', 'linked_thread', 'agent_action'))
);

CREATE INDEX IF NOT EXISTS idx_work_item_events_item_created
  ON public.work_item_events (tenant_id, work_item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_work_item_events_thread
  ON public.work_item_events (tenant_id, thread_id);

CREATE TABLE IF NOT EXISTS public.work_item_saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  view_type text NOT NULL DEFAULT 'list',
  filters jsonb,
  grouping jsonb,
  sorting jsonb,
  view_config jsonb,
  is_private boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  is_favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_saved_views_type_allowed
    CHECK (view_type IN ('list', 'board')),
  CONSTRAINT work_item_saved_views_owner_required
    CHECK (user_id IS NOT NULL OR is_private = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_saved_views_user_name
  ON public.work_item_saved_views (tenant_id, user_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_saved_views_user_default
  ON public.work_item_saved_views (tenant_id, user_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_work_item_saved_views_user
  ON public.work_item_saved_views (tenant_id, user_id, is_favorite);

CREATE INDEX IF NOT EXISTS idx_work_item_saved_views_space
  ON public.work_item_saved_views (tenant_id, space_id);

CREATE TABLE IF NOT EXISTS public.work_item_external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  work_item_id uuid NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  external_url text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_external_refs_provider_allowed
    CHECK (provider IN ('thinkwork', 'lastmile', 'linear', 'plane', 'twenty'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_item_external_refs_provider
  ON public.work_item_external_refs (tenant_id, provider, external_id);

CREATE INDEX IF NOT EXISTS idx_work_item_external_refs_item
  ON public.work_item_external_refs (tenant_id, work_item_id);

COMMIT;
