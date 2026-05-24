-- 0129_drop_symphony_schema.sql
--
-- Drops the orphan `symphony.*` schema and all 17 of its tables.
--
-- Origin: docs/brainstorms/2026-05-24-codebase-and-database-simplification-cleanup-requirements.md
-- Plan:   docs/plans/2026-05-24-002-refactor-p0-zombie-sweep-cleanup-plan.md (U5)
--
-- Context: The symphony.* schema holds residual state from the abandoned OSS
-- Symphony connector experiments (Linear-eligibility claims, GitHub work-item
-- mirrors, Step Functions run history). The OSS connector framework was retired
-- 2026-05-14 (docs/plans/2026-05-14-001-refactor-retire-oss-symphony-connectors-plan.md)
-- but that work removed only the connector code paths, not the underlying
-- Postgres schema. Brainstorm reconnaissance confirms zero code references to
-- the `symphony.` schema anywhere in apps/, packages/, terraform/, or scripts/.
-- All 89 rows across the 7 non-empty tables are test fixtures (project_slug
-- prefixes "mark-1777...", "dup-1777...", "valid-1777..." from synthetic
-- workflow seed runs in 2026-05-03..05).
--
-- FK graph: all 17 FK constraints are internal-to-schema (confirmed via
-- pg_constraint query). No public.* tables reference symphony.*. CASCADE on
-- DROP TABLE handles the internal FK chain; drop order below is alphabetical
-- since CASCADE makes leaf-first ordering academic.
--
-- Apply manually after merge:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0129_drop_symphony_schema.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0129_drop_symphony_schema.sql
--
-- drops: symphony.claims
-- drops: symphony.claims_v2
-- drops: symphony.cost_totals
-- drops: symphony.github_installations
-- drops: symphony.hitl_questions
-- drops: symphony.nonce_log
-- drops: symphony.orchestrator_flags
-- drops: symphony.repositories
-- drops: symphony.run_events
-- drops: symphony.runs
-- drops: symphony.runs_v2
-- drops: symphony.service_health
-- drops: symphony.service_leases
-- drops: symphony.spend_actuals
-- drops: symphony.spend_reservations
-- drops: symphony.work_items
-- drops: symphony.workflow_versions

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_symphony_schema'));

DROP TABLE IF EXISTS symphony.claims CASCADE;
DROP TABLE IF EXISTS symphony.claims_v2 CASCADE;
DROP TABLE IF EXISTS symphony.cost_totals CASCADE;
DROP TABLE IF EXISTS symphony.github_installations CASCADE;
DROP TABLE IF EXISTS symphony.hitl_questions CASCADE;
DROP TABLE IF EXISTS symphony.nonce_log CASCADE;
DROP TABLE IF EXISTS symphony.orchestrator_flags CASCADE;
DROP TABLE IF EXISTS symphony.repositories CASCADE;
DROP TABLE IF EXISTS symphony.run_events CASCADE;
DROP TABLE IF EXISTS symphony.runs CASCADE;
DROP TABLE IF EXISTS symphony.runs_v2 CASCADE;
DROP TABLE IF EXISTS symphony.service_health CASCADE;
DROP TABLE IF EXISTS symphony.service_leases CASCADE;
DROP TABLE IF EXISTS symphony.spend_actuals CASCADE;
DROP TABLE IF EXISTS symphony.spend_reservations CASCADE;
DROP TABLE IF EXISTS symphony.work_items CASCADE;
DROP TABLE IF EXISTS symphony.workflow_versions CASCADE;

DROP FUNCTION IF EXISTS symphony.set_updated_at();

DROP SCHEMA IF EXISTS symphony;

COMMIT;
