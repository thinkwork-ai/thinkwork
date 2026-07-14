-- 0252_drop_kg_and_straggler_compat_views.sql
--
-- Phase C of the THINK-290 arc. Drops the 8 compatibility views in
-- `public.*` that 0250 (kg extraction) and 0251 (brain stragglers) created
-- as a deploy bridge. The views protected old bundled Lambda READ paths
-- during the window between psql apply and Lambda redeploy; once every
-- deployed stage has recorded 0250 + 0251 as applied AND redeployed its
-- Lambdas, no consumer reads through these names and the views come down.
--
-- Views dropped:
--   public.knowledge_graph_ingest_runs, public.knowledge_graph_entities,
--   public.knowledge_graph_relationships, public.knowledge_graph_evidence,
--   public.knowledge_graph_observation_cursors,
--   public.brain_dream_runs, public.brain_dream_actions,
--   public.memory_retain_attempts
--
-- Merge gate (recorded in the PR body): per-stage scoped
-- `db:migrate-manual` output showing 0250/0251 applied on every deployed
-- stage, plus a pg_stat_statements (or short-window statement-log) check
-- that no statements reference the old names. Views do not appear in
-- pg_stat_user_tables, so table-stat checks are not usable here.
--
-- Plan reference: docs/plans/2026-07-14-001-refactor-kg-schema-extraction-and-brain-cleanup-plan.md
-- Pattern doc:    docs/solutions/database-issues/feature-schema-extraction-pattern.md
-- kg PR (merged): #3757
-- Stragglers PR:  #3760
--
-- Apply manually:
--   psql "$DATABASE_URL" -f packages/database-pg/drizzle/0252_drop_kg_and_straggler_compat_views.sql
-- Then verify:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0252_drop_kg_and_straggler_compat_views.sql
--   psql -c "\dv public.knowledge_graph_*"   -- 0 views expected
--   psql -c "\dv public.brain_dream_*"       -- 0 views expected
--   psql -c "\dv public.memory_retain_*"     -- 0 views expected
--   psql -c "\dt kg.*"                       -- 5 tables still present
--
-- Inverse runbook (rollback): re-create each view — mirror of the CREATE
-- VIEW statements in 0250/0251 (column-enumerated; see those files).
--
-- Markers (consumed by scripts/db-migrate-manual.sh):
--
-- drops: public.knowledge_graph_ingest_runs
-- drops: public.knowledge_graph_entities
-- drops: public.knowledge_graph_relationships
-- drops: public.knowledge_graph_evidence
-- drops: public.knowledge_graph_observation_cursors
-- drops: public.brain_dream_runs
-- drops: public.brain_dream_actions
-- drops: public.memory_retain_attempts

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '300s';

SELECT pg_advisory_xact_lock(hashtext('drop_kg_and_straggler_compat_views'));

DO $$
BEGIN
  IF current_database() != 'thinkwork' THEN
    RAISE EXCEPTION 'wrong database: %, expected thinkwork', current_database();
  END IF;
END $$;

-- Pre-flight: refuse to run if any old name still resolves to a TABLE
-- (i.e., 0250/0251 were never applied here) — dropping would then be data
-- loss, not view cleanup. A missing view (already dropped) is fine.
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'knowledge_graph_ingest_runs', 'knowledge_graph_entities',
    'knowledge_graph_relationships', 'knowledge_graph_evidence',
    'knowledge_graph_observation_cursors', 'brain_dream_runs',
    'brain_dream_actions', 'memory_retain_attempts'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = name AND c.relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'pre-flight: public.% is still a TABLE — apply 0250/0251 first', name;
    END IF;
  END LOOP;
END $$;

DROP VIEW IF EXISTS
  public.knowledge_graph_ingest_runs,
  public.knowledge_graph_entities,
  public.knowledge_graph_relationships,
  public.knowledge_graph_evidence,
  public.knowledge_graph_observation_cursors,
  public.brain_dream_runs,
  public.brain_dream_actions,
  public.memory_retain_attempts;

COMMIT;
