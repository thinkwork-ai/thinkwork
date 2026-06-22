-- Skill Creator publish lifecycle status.
-- Plan: docs/plans/2026-06-21-003-feat-skill-creator-system-plan.md (U5).
-- Apply manually (no CI migration runner):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0181_skill_draft_publish_status.sql
--
-- creates-constraint: public.skill_drafts.skill_drafts_status_check
-- creates-constraint: public.skill_draft_events.skill_draft_events_type_check

ALTER TABLE public.skill_drafts
  DROP CONSTRAINT IF EXISTS skill_drafts_status_check;

ALTER TABLE public.skill_drafts
  ADD CONSTRAINT skill_drafts_status_check
  CHECK (status IN ('draft','submitted','rejected','failed','published'));

ALTER TABLE public.skill_draft_events
  DROP CONSTRAINT IF EXISTS skill_draft_events_type_check;

ALTER TABLE public.skill_draft_events
  ADD CONSTRAINT skill_draft_events_type_check
  CHECK (event_type IN ('created','updated','submitted','rejected','failed','published'));
