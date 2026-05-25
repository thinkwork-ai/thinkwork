-- 0131_drop_skill_catalog_and_tenant_skills.sql
--
-- Drops the retired database-backed skill catalog tables.
--
-- Origin: docs/plans/2026-05-24-003-feat-pi-skill-catalog-and-workspace-install-plan.md
--
-- Context: skills are now cataloged in S3 under
-- tenants/<tenant_slug>/skill-catalog/<skill_slug>/ and installed by copying
-- skill folders into agent/Space workspace `skills/` directories. U15 retired
-- the GraphQL customize skill surface and U16a retired the remaining REST,
-- runtime, plugin-install, bootstrap, and tenant-inventory table consumers.
--
-- Apply manually after merge:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0131_drop_skill_catalog_and_tenant_skills.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0131_drop_skill_catalog_and_tenant_skills.sql
--
-- drops: public.tenant_skills
-- drops: public.skill_catalog

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_skill_catalog_and_tenant_skills'));

DROP TABLE IF EXISTS public.tenant_skills CASCADE;
DROP TABLE IF EXISTS public.skill_catalog CASCADE;

COMMIT;
