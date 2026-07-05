-- Purpose: drop the NOT NULL constraint on
-- agent_loop_versions.judge_spec and agent_loop_versions.evidence_policy
-- (THINK-137 U10, PR A — code removal + nullability).
--
-- The judge / evidence / ROI feature was removed in this PR: finalize no longer
-- records judgments/evidence, saveAgentLoop no longer writes judge_spec /
-- evidence_policy, and the GraphQL + web readers are gone. Both columns were
-- NOT NULL, so saveAgentLoop can only legally stop writing them once they are
-- nullable. This migration makes that write-stop legal. The COLUMNS themselves
-- (and the agent_loop_judgments / agent_loop_evidence tables and the ROI
-- counters) are DROPPED in the follow-up PR B, after this deploys and
-- saveAgentLoop is observed creating Automations live.
--
-- Schema-only migration on an existing column. Following the 0202/0211
-- precedent for hand-rolled DDL that Drizzle's generator does not track, it
-- publishes a drift-marker VIEW whose columns reflect the resulting nullability
-- so the drift reporter (scripts/db-migrate-manual.sh) can prove the ALTER
-- committed; the `-- creates:` marker below is what the reporter probes.
--
-- Idempotent: ALTER COLUMN ... DROP NOT NULL is a no-op when the constraint is
-- already gone; the marker view is CREATE OR REPLACE. Safe to re-run.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0213_agent_loop_versions_judge_evidence_nullable.sql
--
-- creates: public.view_agent_loop_versions_judge_evidence_nullable

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('agent_loop_versions_judge_evidence_nullable_0213'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
END $$;

ALTER TABLE public.agent_loop_versions ALTER COLUMN judge_spec DROP NOT NULL;
ALTER TABLE public.agent_loop_versions ALTER COLUMN evidence_policy DROP NOT NULL;

-- Drift marker. Its boolean columns reflect the resulting nullability so the
-- reporter can prove both constraints were dropped.
CREATE OR REPLACE VIEW public.view_agent_loop_versions_judge_evidence_nullable AS
SELECT
  bool_or(column_name = 'judge_spec' AND is_nullable = 'YES') AS judge_spec_nullable,
  bool_or(column_name = 'evidence_policy' AND is_nullable = 'YES') AS evidence_policy_nullable,
  now() AS checked_at
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'agent_loop_versions'
  AND column_name IN ('judge_spec', 'evidence_policy');

COMMENT ON VIEW public.view_agent_loop_versions_judge_evidence_nullable IS
  'Drift marker for 0213_agent_loop_versions_judge_evidence_nullable.sql.';

COMMIT;
