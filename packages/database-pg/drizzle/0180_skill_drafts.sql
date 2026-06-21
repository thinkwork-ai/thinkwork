-- Skill Creator draft lifecycle schema.
-- Plan: docs/plans/2026-06-21-003-feat-skill-creator-system-plan.md (U1).
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0180_skill_drafts.sql
--
-- Pre-flight:
--   SELECT to_regclass('public.tenants') AS tenants;
--   SELECT to_regclass('public.users') AS users;
--   SELECT to_regclass('public.threads') AS threads;
--   SELECT to_regclass('public.messages') AS messages;
--
-- creates: public.skill_drafts
-- creates: public.skill_draft_events
-- creates: public.idx_skill_drafts_tenant_status_updated
-- creates: public.idx_skill_drafts_tenant_requester
-- creates: public.uq_skill_drafts_tenant_id
-- creates: public.idx_skill_draft_events_draft_created
-- creates: public.idx_skill_draft_events_tenant_type
-- creates-constraint: public.skill_drafts.skill_drafts_status_check
-- creates-constraint: public.skill_drafts.skill_drafts_source_kind_check
-- creates-constraint: public.skill_draft_events.skill_draft_events_type_check

DO $$
BEGIN
  IF to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'tenants not found; apply core tenant migrations first';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'users not found; apply core user migrations first';
  END IF;
  IF to_regclass('public.threads') IS NULL THEN
    RAISE EXCEPTION 'threads not found; apply thread migrations first';
  END IF;
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'messages not found; apply message migrations first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.skill_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by_user_id uuid NOT NULL REFERENCES public.users(id),
  source_thread_id uuid REFERENCES public.threads(id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  inbox_item_id uuid,
  slug text NOT NULL,
  title text NOT NULL,
  display_name text,
  summary text,
  source_kind text NOT NULL DEFAULT 'thread',
  status text NOT NULL DEFAULT 'draft',
  current_content_hash text,
  draft_s3_prefix text NOT NULL,
  failure_message text,
  rejected_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  rejected_at timestamp with time zone,
  published_catalog_slug text,
  published_content_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  submitted_at timestamp with time zone,
  CONSTRAINT skill_drafts_status_check CHECK (status IN ('draft','submitted','rejected','failed')),
  CONSTRAINT skill_drafts_source_kind_check CHECK (source_kind IN ('thread','archive','manual','existing_skill'))
);

CREATE INDEX IF NOT EXISTS idx_skill_drafts_tenant_status_updated
  ON public.skill_drafts (tenant_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_skill_drafts_tenant_requester
  ON public.skill_drafts (tenant_id, requested_by_user_id, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_skill_drafts_tenant_id
  ON public.skill_drafts (tenant_id, id);

CREATE TABLE IF NOT EXISTS public.skill_draft_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.skill_drafts(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT skill_draft_events_type_check CHECK (event_type IN ('created','updated','submitted','rejected','failed'))
);

CREATE INDEX IF NOT EXISTS idx_skill_draft_events_draft_created
  ON public.skill_draft_events (draft_id, created_at);
CREATE INDEX IF NOT EXISTS idx_skill_draft_events_tenant_type
  ON public.skill_draft_events (tenant_id, event_type);
