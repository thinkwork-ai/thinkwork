-- Purpose: cache the latest skill trust report on the per-tenant S3 catalog
--   index so the Skill Detail trust sheet can render the last report without
--   rerunning SkillSpector on every open.
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0184_skill_catalog_trust_cache.sql
-- Pre-flight:
--   SELECT to_regclass('public.skill_catalog');
-- creates-column: public.skill_catalog.trust_report
-- creates-column: public.skill_catalog.trust_report_content_sha
-- creates-column: public.skill_catalog.trust_report_pipeline_version
-- creates-column: public.skill_catalog.trust_report_updated_at
-- creates-column: public.skill_catalog.signature_status
-- creates-column: public.skill_catalog.signature_payload
-- creates-column: public.skill_catalog.signed_content_sha
-- creates-column: public.skill_catalog.signed_payload_hash
-- creates-column: public.skill_catalog.signed_at
-- creates-column: public.skill_catalog.signed_by_user_id

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('migration:0184_skill_catalog_trust_cache'));

ALTER TABLE public.skill_catalog
  ADD COLUMN IF NOT EXISTS trust_report jsonb,
  ADD COLUMN IF NOT EXISTS trust_report_content_sha text,
  ADD COLUMN IF NOT EXISTS trust_report_pipeline_version text,
  ADD COLUMN IF NOT EXISTS trust_report_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS signature_status text,
  ADD COLUMN IF NOT EXISTS signature_payload jsonb,
  ADD COLUMN IF NOT EXISTS signed_content_sha text,
  ADD COLUMN IF NOT EXISTS signed_payload_hash text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

COMMIT;
