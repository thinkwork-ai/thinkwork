-- 0280_work_item_external_refs_drop_plane_provider.sql
--
-- Purpose: drop 'plane' from the work_item_external_refs provider allowlist.
-- Plane is retired — its deployment, DNS, S3 bucket, database, credentials and
-- MCP registration are all gone, so the provider can never be written again.
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0280_work_item_external_refs_drop_plane_provider.sql
--
-- Recreates an existing constraint rather than adding a new object, so the
-- drift reporter is given the constraint it should find afterwards.
--
-- creates-constraint: public.work_item_external_refs.work_item_external_refs_provider_allowed

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Fail loudly rather than silently dropping rows the narrowed CHECK would
-- reject. dev had zero 'plane' rows when this was written; another stage
-- carrying them is a signal to migrate that data first, not to force through.
DO $$
DECLARE
  offending bigint;
BEGIN
  SELECT count(*) INTO offending
  FROM public.work_item_external_refs
  WHERE provider = 'plane';

  IF offending > 0 THEN
    RAISE EXCEPTION
      'work_item_external_refs still has % row(s) with provider=''plane''; migrate or delete them before narrowing the constraint',
      offending;
  END IF;
END
$$;

ALTER TABLE public.work_item_external_refs
  DROP CONSTRAINT IF EXISTS work_item_external_refs_provider_allowed;

ALTER TABLE public.work_item_external_refs
  ADD CONSTRAINT work_item_external_refs_provider_allowed
  CHECK (provider IN ('thinkwork', 'lastmile', 'linear', 'twenty'));

COMMIT;
