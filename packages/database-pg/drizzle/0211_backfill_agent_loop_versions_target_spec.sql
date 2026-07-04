-- Purpose: backfill agent_loop_versions.target_spec on every existing row
-- (THINK-137 Automations U3, plan 2026-07-03-006). target_spec becomes the
-- authoritative version spec; this migration derives it from the legacy
-- goal/worker/routineActions blobs using the SAME mapping as
-- targetSpecFromLegacy() in @thinkwork/agent-loops-core, expressed in SQL.
--
-- Mapping (identical to targetSpecFromLegacy):
--   * routine_actions_spec present, its `actions` a non-empty array, AND
--     agentTurn === false  → kind 'routine'. The first action becomes
--     {routineId, input?, label?}; any remaining actions are preserved under
--     routine.additionalActions so the mapping is lossless and dispatch
--     reconstructs the exact original action list.
--   * everything else (agent-turn, or mixed agentTurn:true) → kind
--     'agent_thread' from goal_spec.objective + goal_spec.completionCriteria +
--     worker_spec.id/type, threadMode 'new_per_run'. A mixed Automation's
--     bolt-on routine actions stay in routine_actions_spec (they are pre-steps
--     of the agent-thread target, not the target) and are read from there at
--     dispatch.
--
-- Data-only migration: the target_spec COLUMN already exists (added additively
-- in 0210). This file writes data, not schema. Following the 0202 data-backfill
-- precedent, it publishes a drift-marker VIEW whose presence proves the whole
-- transaction committed; the `-- creates:` marker below is what the drift
-- reporter (scripts/db-migrate-manual.sh) probes.
--
-- Idempotent: only rows WHERE target_spec IS NULL are updated; the marker view
-- is CREATE OR REPLACE. Safe to re-run. dev has ~7 version rows; customer
-- stages have 0.
--
-- Apply manually (verification pass before merge):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f packages/database-pg/drizzle/0211_backfill_agent_loop_versions_target_spec.sql
--
-- creates: public.view_agent_loop_versions_target_spec_backfilled

\set ON_ERROR_STOP on

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('agent_loop_versions_target_spec_backfill_0211'));

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF to_regclass('public.agent_loop_versions') IS NULL THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'agent_loop_versions'
      AND column_name = 'target_spec'
  ) THEN
    RAISE EXCEPTION 'pre-flight: public.agent_loop_versions.target_spec column missing (apply 0210 first)';
  END IF;
END $$;

UPDATE public.agent_loop_versions v
SET target_spec = CASE
  WHEN v.routine_actions_spec IS NOT NULL
   AND jsonb_typeof(v.routine_actions_spec -> 'actions') = 'array'
   AND jsonb_array_length(v.routine_actions_spec -> 'actions') >= 1
   AND (v.routine_actions_spec -> 'agentTurn') = to_jsonb(false)
  THEN jsonb_strip_nulls(jsonb_build_object(
    'kind', 'routine',
    'routine', jsonb_strip_nulls(jsonb_build_object(
      'routineId', v.routine_actions_spec -> 'actions' -> 0 ->> 'routineId',
      'input', v.routine_actions_spec -> 'actions' -> 0 -> 'input',
      'label', v.routine_actions_spec -> 'actions' -> 0 -> 'label',
      'additionalActions', CASE
        WHEN jsonb_array_length(v.routine_actions_spec -> 'actions') > 1
        THEN (
          SELECT jsonb_agg(a.elem ORDER BY a.ord)
          FROM jsonb_array_elements(v.routine_actions_spec -> 'actions')
               WITH ORDINALITY AS a(elem, ord)
          WHERE a.ord > 1
        )
        ELSE NULL
      END
    ))
  ))
  ELSE jsonb_strip_nulls(jsonb_build_object(
    'kind', 'agent_thread',
    'agentThread', jsonb_strip_nulls(jsonb_build_object(
      'instructions', COALESCE(v.goal_spec ->> 'objective', ''),
      'completionCriteria', CASE
        WHEN jsonb_typeof(v.goal_spec -> 'completionCriteria') = 'array'
         AND jsonb_array_length(v.goal_spec -> 'completionCriteria') >= 1
        THEN v.goal_spec -> 'completionCriteria'
        ELSE NULL
      END,
      'workerId', v.worker_spec ->> 'id',
      'workerType', CASE
        WHEN v.worker_spec ->> 'type' IN ('agent', 'agent_profile')
        THEN v.worker_spec ->> 'type'
        ELSE NULL
      END,
      'threadMode', 'new_per_run'
    ))
  ))
END
WHERE v.target_spec IS NULL;

-- Drift marker + summary. Presence proves the backfill transaction committed.
CREATE OR REPLACE VIEW public.view_agent_loop_versions_target_spec_backfilled AS
SELECT
  COUNT(*)::int AS total_versions,
  COUNT(*) FILTER (WHERE target_spec IS NOT NULL)::int AS with_target_spec,
  COUNT(*) FILTER (WHERE target_spec IS NULL)::int AS missing_target_spec,
  COUNT(*) FILTER (WHERE target_spec ->> 'kind' = 'agent_thread')::int AS agent_thread_targets,
  COUNT(*) FILTER (WHERE target_spec ->> 'kind' = 'routine')::int AS routine_targets,
  now() AS checked_at
FROM public.agent_loop_versions;

COMMENT ON VIEW public.view_agent_loop_versions_target_spec_backfilled IS
  'Drift marker and summary for 0211_backfill_agent_loop_versions_target_spec.sql.';

COMMIT;
