-- 0129_drop_code_factory_tables.sql
--
-- Drops the three code_factory_* tables and their indexes.
--
-- Origin: docs/brainstorms/2026-05-24-codebase-and-database-simplification-cleanup-requirements.md
-- Plan:   docs/plans/2026-05-24-002-refactor-p0-zombie-sweep-cleanup-plan.md (T8 — Code Factory)
--
-- Context: code_factory was an OSS feature shipped alongside the retired
-- Symphony connectors. The Lambda handlers (code-factory.ts, github-repos.ts),
-- mobile settings screen (code-factory-repos.tsx), agent-detail UI blocks, and
-- create-hosted-agent-modal "code_factory" runtime profile are removed in the
-- same PR as this migration. github-app-webhook.ts retains its workspace-sync
-- skeleton but the tenant-slug lookup that depended on code_factory_repos now
-- always returns null until a replacement mapping is wired.
--
-- All three tables are 0 rows in dev. No inbound FKs from non-code_factory
-- tables (verified via pg_constraint query). CASCADE handles internal FK
-- ordering between code_factory_runs → code_factory_jobs → code_factory_repos.
--
-- Apply manually after merge:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0129_drop_code_factory_tables.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0129_drop_code_factory_tables.sql
--
-- drops: public.code_factory_jobs
-- drops: public.code_factory_repos
-- drops: public.code_factory_runs
-- drops: public.uq_code_factory_repos_owner_repo

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_code_factory_tables'));

DROP TABLE IF EXISTS public.code_factory_runs CASCADE;
DROP TABLE IF EXISTS public.code_factory_jobs CASCADE;
DROP TABLE IF EXISTS public.code_factory_repos CASCADE;

COMMIT;
