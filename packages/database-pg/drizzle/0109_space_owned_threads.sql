-- Purpose: make Spaces the required parent container for every Thread.
-- Plan: docs/plans/2026-05-19-003-feat-spaces-customer-onboarding-v1-plan.md (U13 follow-up)
-- Apply manually: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0109_space_owned_threads.sql
-- creates-constraint: public.threads.threads_space_id_required
-- creates-constraint: public.thread_participants.thread_participants_space_id_required

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

INSERT INTO public.spaces (
  tenant_id,
  slug,
  name,
  description,
  prompt,
  status,
  kind,
  template_key,
  config
)
SELECT
  t.id,
  'general',
  'General',
  'Default Space for conversations that are not part of a configured workflow.',
  'Use this Space for general collaboration, ad hoc questions, and Threads that do not belong to a specialized workflow.',
  'active',
  'custom',
  'general',
  '{"workflow":"general","version":1,"source":"space_owned_threads_migration"}'::jsonb
FROM public.tenants t
ON CONFLICT (tenant_id, slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  prompt = EXCLUDED.prompt,
  status = 'active',
  kind = EXCLUDED.kind,
  template_key = EXCLUDED.template_key,
  config = EXCLUDED.config,
  updated_at = now();

INSERT INTO public.spaces (
  tenant_id,
  slug,
  name,
  description,
  prompt,
  status,
  kind,
  template_key,
  config
)
SELECT
  t.id,
  'customer-onboarding',
  'Customer Onboarding',
  'Closed-won customer onboarding cases, checklist coordination, and LastMile task links.',
  'Coordinate customer onboarding after a closed-won opportunity. Keep the Thread factual, ask humans for missing source information, and keep required checklist tasks moving.',
  'active',
  'customer_onboarding',
  'customer_onboarding',
  '{"workflow":"customer_onboarding","version":1,"source":"space_owned_threads_migration"}'::jsonb
FROM public.tenants t
ON CONFLICT (tenant_id, slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  prompt = COALESCE(public.spaces.prompt, EXCLUDED.prompt),
  status = 'active',
  kind = EXCLUDED.kind,
  template_key = EXCLUDED.template_key,
  config = COALESCE(public.spaces.config, EXCLUDED.config),
  updated_at = now();

INSERT INTO public.space_members (
  tenant_id,
  space_id,
  user_id,
  role,
  notification_preference
)
SELECT
  u.tenant_id,
  s.id,
  u.id,
  'member',
  'subscribed'
FROM public.users u
JOIN public.spaces s
  ON s.tenant_id = u.tenant_id
WHERE u.tenant_id IS NOT NULL
  AND s.slug IN ('general', 'customer-onboarding')
ON CONFLICT (tenant_id, space_id, user_id)
DO NOTHING;

UPDATE public.threads t
SET
  space_id = CASE
    WHEN t.metadata ? 'customerOnboarding' THEN onboarding.id
    ELSE general.id
  END,
  updated_at = now()
FROM public.spaces general
JOIN public.spaces onboarding
  ON onboarding.tenant_id = general.tenant_id
 AND onboarding.slug = 'customer-onboarding'
WHERE general.tenant_id = t.tenant_id
  AND general.slug = 'general'
  AND t.space_id IS NULL;

UPDATE public.thread_participants tp
SET
  space_id = t.space_id,
  updated_at = now()
FROM public.threads t
WHERE tp.thread_id = t.id
  AND tp.space_id IS NULL
  AND t.space_id IS NOT NULL;

INSERT INTO public.thread_participants (
  tenant_id,
  thread_id,
  space_id,
  participant_type,
  user_id,
  role,
  source,
  notification_preference
)
SELECT
  t.tenant_id,
  t.id,
  t.space_id,
  'user',
  t.user_id,
  CASE WHEN t.created_by_id = t.user_id::text THEN 'requester' ELSE 'member' END,
  'space_owned_threads_backfill',
  'subscribed'
FROM public.threads t
WHERE t.space_id IS NOT NULL
  AND t.user_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.thread_participants (
  tenant_id,
  thread_id,
  space_id,
  participant_type,
  agent_id,
  role,
  source,
  notification_preference
)
SELECT
  t.tenant_id,
  t.id,
  t.space_id,
  'agent',
  t.agent_id,
  'agent',
  'space_owned_threads_backfill',
  'mentions'
FROM public.threads t
WHERE t.space_id IS NOT NULL
  AND t.agent_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.threads
  DROP CONSTRAINT IF EXISTS threads_space_id_spaces_id_fk;

ALTER TABLE public.threads
  DROP CONSTRAINT IF EXISTS threads_space_id_required;

ALTER TABLE public.threads
  ALTER COLUMN space_id SET NOT NULL;

ALTER TABLE public.threads
  ADD CONSTRAINT threads_space_id_spaces_id_fk
  FOREIGN KEY (space_id)
  REFERENCES public.spaces(id)
  ON DELETE RESTRICT;

ALTER TABLE public.threads
  ADD CONSTRAINT threads_space_id_required
  CHECK (space_id IS NOT NULL) NOT VALID;

ALTER TABLE public.threads
  VALIDATE CONSTRAINT threads_space_id_required;

ALTER TABLE public.thread_participants
  DROP CONSTRAINT IF EXISTS thread_participants_space_id_spaces_id_fk;

ALTER TABLE public.thread_participants
  DROP CONSTRAINT IF EXISTS thread_participants_space_id_required;

ALTER TABLE public.thread_participants
  ALTER COLUMN space_id SET NOT NULL;

ALTER TABLE public.thread_participants
  ADD CONSTRAINT thread_participants_space_id_spaces_id_fk
  FOREIGN KEY (space_id)
  REFERENCES public.spaces(id)
  ON DELETE RESTRICT;

ALTER TABLE public.thread_participants
  ADD CONSTRAINT thread_participants_space_id_required
  CHECK (space_id IS NOT NULL) NOT VALID;

ALTER TABLE public.thread_participants
  VALIDATE CONSTRAINT thread_participants_space_id_required;

COMMIT;
