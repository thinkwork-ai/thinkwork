-- 0128_drop_eval_test_cases_agent_id.sql
--
-- Drops the per-case Agent override column on eval_test_cases. Under the
-- one-platform-agent model, evals always run against the tenant's
-- is_platform_default=true row; a per-test-case agent target has no
-- meaning. The matching GraphQL fields (EvalTestCase.agentId,
-- CreateEvalTestCaseInput.agentId, UpdateEvalTestCaseInput.agentId) were
-- removed in the same PR set; this drops the underlying column once the
-- resolver no longer reads or writes it.
--
-- Plan: docs/plans/2026-05-23-006-refactor-evaluations-tenant-platform-agent-plan.md (U3)
-- Dependencies:
--   - U1 merged: every eval call site resolves through resolveTenantPlatformAgent.
--   - U2 merged: GraphQL surface no longer exposes per-case agentId; resolver
--     no longer reads or writes the column.
--
-- Apply manually:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0128_drop_eval_test_cases_agent_id.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0128_drop_eval_test_cases_agent_id.sql
--
-- drops-column: public.eval_test_cases.agent_id
-- drops-constraint: public.eval_test_cases.eval_test_cases_agent_id_agents_id_fk

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '60s';

SELECT pg_advisory_xact_lock(hashtext('drop_eval_test_cases_agent_id'));

ALTER TABLE public.eval_test_cases
  DROP COLUMN IF EXISTS agent_id;

COMMIT;
