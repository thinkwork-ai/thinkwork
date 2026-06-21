-- Backfill first-class Workflow projections for existing Step Functions routines.
-- Plan: docs/plans/2026-06-20-001-feat-first-class-workflow-control-plane-plan.md (U10).
--
-- Apply manually after 0177_workflow_control_plane.sql and after application
-- code that reads/writes the workflow control plane has been reviewed:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0178_workflow_backfill_existing_routines.sql
--
-- Drift detection:
--   bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0178_workflow_backfill_existing_routines.sql
--
-- Pre-flight:
--   SELECT to_regclass('public.routines') AS routines;
--   SELECT to_regclass('public.routine_asl_versions') AS routine_asl_versions;
--   SELECT to_regclass('public.scheduled_jobs') AS scheduled_jobs;
--   SELECT to_regclass('public.workflows') AS workflows;
--   SELECT to_regclass('public.workflow_versions') AS workflow_versions;
--   SELECT to_regclass('public.workflow_triggers') AS workflow_triggers;
--   SELECT to_regclass('public.workflow_engine_bindings') AS workflow_engine_bindings;
--
-- Backfill policy:
--   - Only routines.engine = 'step_functions' is projected.
--   - legacy_python routines are skipped; they remain compatibility/internal substrate only.
--   - Re-running is idempotent through workflows_tenant_slug_uidx,
--     workflow_versions_workflow_version_uidx, workflow_engine_bindings_step_routine_uidx,
--     and NOT EXISTS trigger guards.
--
-- creates: public.view_workflow_backfill_existing_routines_status

DO $$
BEGIN
  IF to_regclass('public.routines') IS NULL THEN
    RAISE EXCEPTION 'routines not found; apply routine substrate migrations first';
  END IF;
  IF to_regclass('public.routine_asl_versions') IS NULL THEN
    RAISE EXCEPTION 'routine_asl_versions not found; apply Step Functions routine migrations first';
  END IF;
  IF to_regclass('public.scheduled_jobs') IS NULL THEN
    RAISE EXCEPTION 'scheduled_jobs not found; apply trigger/scheduling migrations first';
  END IF;
  IF to_regclass('public.workflows') IS NULL
    OR to_regclass('public.workflow_versions') IS NULL
    OR to_regclass('public.workflow_triggers') IS NULL
    OR to_regclass('public.workflow_engine_bindings') IS NULL
  THEN
    RAISE EXCEPTION 'workflow control-plane tables missing; apply 0177_workflow_control_plane.sql first';
  END IF;
END $$;

WITH eligible_routines AS (
  SELECT
    r.*,
    av.id AS current_asl_version_id,
    av.version_number AS current_asl_version_number,
    CASE
      WHEN EXISTS (
        SELECT 1
          FROM public.scheduled_jobs sj
         WHERE sj.routine_id = r.id
           AND sj.trigger_type IN ('routine_schedule', 'routine_one_time')
      )
      THEN 'schedule'
      ELSE 'manual'
    END AS primary_family,
    CASE
      WHEN r.status IS NOT NULL AND r.status <> 'active' THEN 'disabled'
      WHEN r.state_machine_arn IS NULL OR r.state_machine_alias_arn IS NULL THEN 'blocked_not_ready'
      WHEN av.id IS NULL THEN 'blocked_not_ready'
      ELSE 'ready'
    END AS readiness_state,
    CASE
      WHEN r.status IS NOT NULL AND r.status <> 'active' THEN 'disabled'
      WHEN r.state_machine_arn IS NULL OR r.state_machine_alias_arn IS NULL THEN 'blocked_not_ready'
      WHEN av.id IS NULL THEN 'blocked_not_ready'
      ELSE 'ready'
    END AS binding_status,
    CASE
      WHEN r.status = 'archived' THEN 'archived'
      WHEN av.id IS NULL THEN 'deprecated'
      ELSE 'active'
    END AS lifecycle_status,
    CASE
      WHEN r.status IS NOT NULL AND r.status <> 'active' THEN
        jsonb_build_array(jsonb_build_object('code', 'routine_inactive', 'message', 'Routine is inactive'))
      WHEN r.state_machine_arn IS NULL OR r.state_machine_alias_arn IS NULL THEN
        jsonb_build_array(jsonb_build_object('code', 'missing_state_machine', 'message', 'Routine is missing Step Functions ARNs'))
      WHEN av.id IS NULL THEN
        jsonb_build_array(jsonb_build_object('code', 'missing_current_asl_version', 'message', 'Routine current ASL version was not found'))
      ELSE '[]'::jsonb
    END AS readiness_reasons
  FROM public.routines r
  LEFT JOIN public.routine_asl_versions av
    ON av.routine_id = r.id
   AND av.version_number = r.current_version
  WHERE r.engine = 'step_functions'
)
INSERT INTO public.workflows (
  tenant_id,
  name,
  slug,
  description,
  lifecycle_status,
  visibility,
  owner_agent_id,
  primary_trigger_family,
  capability_flags,
  readiness_state,
  readiness_reasons,
  created_at,
  updated_at
)
SELECT
  er.tenant_id,
  COALESCE(er.name, 'Untitled routine'),
  'routine-' || er.id::text,
  er.description,
  er.lifecycle_status,
  CASE WHEN er.visibility = 'tenant_shared' THEN 'tenant_shared' ELSE 'agent_private' END,
  COALESCE(er.owning_agent_id, er.agent_id),
  er.primary_family,
  '{"start":true,"monitor":true,"cancel":true,"retry":false,"replay":false,"evidence":true}'::jsonb,
  er.readiness_state,
  er.readiness_reasons,
  COALESCE(er.created_at, now()),
  now()
FROM eligible_routines er
ON CONFLICT (tenant_id, slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  lifecycle_status = EXCLUDED.lifecycle_status,
  visibility = EXCLUDED.visibility,
  owner_agent_id = EXCLUDED.owner_agent_id,
  primary_trigger_family = EXCLUDED.primary_trigger_family,
  capability_flags = EXCLUDED.capability_flags,
  readiness_state = EXCLUDED.readiness_state,
  readiness_reasons = EXCLUDED.readiness_reasons,
  updated_at = now();

WITH routine_workflows AS (
  SELECT
    r.*,
    w.id AS workflow_id
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  WHERE r.engine = 'step_functions'
)
INSERT INTO public.workflow_versions (
  tenant_id,
  workflow_id,
  version_number,
  version_status,
  source_kind,
  source_metadata,
  definition_snapshot,
  capability_snapshot,
  routine_asl_version_id,
  created_by_actor_type,
  created_by_actor_id,
  published_at,
  created_at
)
SELECT
  rw.tenant_id,
  rw.workflow_id,
  av.version_number,
  CASE WHEN av.version_number = rw.current_version THEN 'active' ELSE 'superseded' END,
  'step_functions_routine',
  jsonb_build_object(
    'routineId', rw.id,
    'stateMachineArn', av.state_machine_arn,
    'versionArn', av.version_arn,
    'backfillMigration', '0178_workflow_backfill_existing_routines'
  ),
  jsonb_build_object(
    'routineId', rw.id,
    'routineName', rw.name,
    'asl', av.asl_json,
    'markdownSummary', av.markdown_summary,
    'stepManifest', av.step_manifest_json
  ),
  '{"start":true,"monitor":true,"cancel":true,"retry":false,"replay":false,"evidence":true}'::jsonb,
  av.id,
  av.published_by_actor_type,
  av.published_by_actor_id,
  COALESCE(av.created_at, now()),
  COALESCE(av.created_at, now())
FROM routine_workflows rw
JOIN public.routine_asl_versions av
  ON av.routine_id = rw.id
ON CONFLICT (workflow_id, version_number)
DO UPDATE SET
  version_status = EXCLUDED.version_status,
  source_kind = EXCLUDED.source_kind,
  source_metadata = EXCLUDED.source_metadata,
  definition_snapshot = EXCLUDED.definition_snapshot,
  capability_snapshot = EXCLUDED.capability_snapshot,
  routine_asl_version_id = EXCLUDED.routine_asl_version_id,
  created_by_actor_type = EXCLUDED.created_by_actor_type,
  created_by_actor_id = EXCLUDED.created_by_actor_id,
  published_at = EXCLUDED.published_at;

WITH current_versions AS (
  SELECT
    r.id AS routine_id,
    w.id AS workflow_id,
    wv.id AS workflow_version_id,
    av.version_number
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  LEFT JOIN public.routine_asl_versions av
    ON av.routine_id = r.id
   AND av.version_number = r.current_version
  LEFT JOIN public.workflow_versions wv
    ON wv.workflow_id = w.id
   AND wv.routine_asl_version_id = av.id
  WHERE r.engine = 'step_functions'
)
UPDATE public.workflows w
SET
  current_version_id = cv.workflow_version_id,
  current_version_number = cv.version_number,
  updated_at = now()
FROM current_versions cv
WHERE w.id = cv.workflow_id;

WITH routine_workflows AS (
  SELECT
    r.*,
    w.id AS workflow_id,
    w.current_version_id AS workflow_version_id,
    av.id AS current_asl_version_id,
    av.version_number AS current_asl_version_number,
    CASE
      WHEN r.status IS NOT NULL AND r.status <> 'active' THEN 'disabled'
      WHEN r.state_machine_arn IS NULL OR r.state_machine_alias_arn IS NULL THEN 'blocked_not_ready'
      WHEN av.id IS NULL THEN 'blocked_not_ready'
      ELSE 'ready'
    END AS readiness_state,
    CASE
      WHEN r.status IS NOT NULL AND r.status <> 'active' THEN 'disabled'
      WHEN r.state_machine_arn IS NULL OR r.state_machine_alias_arn IS NULL THEN 'blocked_not_ready'
      WHEN av.id IS NULL THEN 'blocked_not_ready'
      ELSE 'ready'
    END AS binding_status,
    CASE
      WHEN r.status IS NOT NULL AND r.status <> 'active' THEN
        jsonb_build_array(jsonb_build_object('code', 'routine_inactive', 'message', 'Routine is inactive'))
      WHEN r.state_machine_arn IS NULL OR r.state_machine_alias_arn IS NULL THEN
        jsonb_build_array(jsonb_build_object('code', 'missing_state_machine', 'message', 'Routine is missing Step Functions ARNs'))
      WHEN av.id IS NULL THEN
        jsonb_build_array(jsonb_build_object('code', 'missing_current_asl_version', 'message', 'Routine current ASL version was not found'))
      ELSE '[]'::jsonb
    END AS readiness_reasons
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  LEFT JOIN public.routine_asl_versions av
    ON av.routine_id = r.id
   AND av.version_number = r.current_version
  WHERE r.engine = 'step_functions'
)
INSERT INTO public.workflow_engine_bindings (
  tenant_id,
  workflow_id,
  workflow_version_id,
  binding_type,
  binding_status,
  routine_id,
  routine_asl_version_id,
  external_workflow_id,
  external_workflow_name,
  external_version_id,
  connection_ref,
  capability_flags,
  readiness_state,
  readiness_reasons,
  created_at,
  updated_at
)
SELECT
  rw.tenant_id,
  rw.workflow_id,
  rw.workflow_version_id,
  'step_functions_routine',
  rw.binding_status,
  rw.id,
  rw.current_asl_version_id,
  rw.id::text,
  rw.name,
  CASE WHEN rw.current_asl_version_number IS NOT NULL THEN rw.current_asl_version_number::text ELSE NULL END,
  jsonb_build_object(
    'stateMachineArn', rw.state_machine_arn,
    'aliasArn', rw.state_machine_alias_arn,
    'backfillMigration', '0178_workflow_backfill_existing_routines'
  ),
  '{"start":true,"monitor":true,"cancel":true,"retry":false,"replay":false,"evidence":true}'::jsonb,
  rw.readiness_state,
  rw.readiness_reasons,
  now(),
  now()
FROM routine_workflows rw
ON CONFLICT (tenant_id, routine_id) WHERE routine_id IS NOT NULL
DO UPDATE SET
  workflow_id = EXCLUDED.workflow_id,
  workflow_version_id = EXCLUDED.workflow_version_id,
  binding_type = EXCLUDED.binding_type,
  binding_status = EXCLUDED.binding_status,
  routine_asl_version_id = EXCLUDED.routine_asl_version_id,
  external_workflow_id = EXCLUDED.external_workflow_id,
  external_workflow_name = EXCLUDED.external_workflow_name,
  external_version_id = EXCLUDED.external_version_id,
  connection_ref = EXCLUDED.connection_ref,
  capability_flags = EXCLUDED.capability_flags,
  readiness_state = EXCLUDED.readiness_state,
  readiness_reasons = EXCLUDED.readiness_reasons,
  updated_at = now();

WITH routine_workflows AS (
  SELECT
    r.*,
    w.id AS workflow_id,
    w.current_version_id AS workflow_version_id,
    w.readiness_state,
    w.readiness_reasons
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  WHERE r.engine = 'step_functions'
)
UPDATE public.workflow_triggers wt
SET
  workflow_version_id = rw.workflow_version_id,
  enabled = (rw.readiness_state = 'ready'),
  trigger_config = jsonb_build_object('routineId', rw.id),
  actor_contract = jsonb_build_object('agentVisible', rw.visibility = 'tenant_shared'),
  readiness_state = rw.readiness_state,
  readiness_reasons = rw.readiness_reasons,
  updated_at = now()
FROM routine_workflows rw
WHERE wt.workflow_id = rw.workflow_id
  AND wt.trigger_family = 'manual'
  AND wt.source_system = 'routine';

WITH routine_workflows AS (
  SELECT
    r.*,
    w.id AS workflow_id,
    w.current_version_id AS workflow_version_id,
    w.readiness_state,
    w.readiness_reasons
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  WHERE r.engine = 'step_functions'
)
INSERT INTO public.workflow_triggers (
  tenant_id,
  workflow_id,
  workflow_version_id,
  trigger_family,
  source_system,
  enabled,
  idempotency_required,
  trigger_config,
  actor_contract,
  readiness_state,
  readiness_reasons,
  created_at,
  updated_at
)
SELECT
  rw.tenant_id,
  rw.workflow_id,
  rw.workflow_version_id,
  'manual',
  'routine',
  (rw.readiness_state = 'ready'),
  false,
  jsonb_build_object('routineId', rw.id),
  jsonb_build_object('agentVisible', rw.visibility = 'tenant_shared'),
  rw.readiness_state,
  rw.readiness_reasons,
  now(),
  now()
FROM routine_workflows rw
WHERE NOT EXISTS (
  SELECT 1
    FROM public.workflow_triggers wt
   WHERE wt.workflow_id = rw.workflow_id
     AND wt.trigger_family = 'manual'
);

WITH scheduled_routine_workflows AS (
  SELECT
    r.*,
    w.id AS workflow_id,
    w.current_version_id AS workflow_version_id,
    w.readiness_state,
    w.readiness_reasons
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  WHERE r.engine = 'step_functions'
    AND EXISTS (
      SELECT 1
        FROM public.scheduled_jobs sj
       WHERE sj.routine_id = r.id
         AND sj.trigger_type IN ('routine_schedule', 'routine_one_time')
    )
)
UPDATE public.workflow_triggers wt
SET
  workflow_version_id = srw.workflow_version_id,
  enabled = (srw.readiness_state = 'ready'),
  trigger_config = jsonb_build_object('routineId', srw.id),
  actor_contract = jsonb_build_object('agentVisible', srw.visibility = 'tenant_shared'),
  readiness_state = srw.readiness_state,
  readiness_reasons = srw.readiness_reasons,
  updated_at = now()
FROM scheduled_routine_workflows srw
WHERE wt.workflow_id = srw.workflow_id
  AND wt.trigger_family = 'schedule'
  AND wt.source_system = 'routine';

WITH scheduled_routine_workflows AS (
  SELECT
    r.*,
    w.id AS workflow_id,
    w.current_version_id AS workflow_version_id,
    w.readiness_state,
    w.readiness_reasons
  FROM public.routines r
  JOIN public.workflows w
    ON w.tenant_id = r.tenant_id
   AND w.slug = 'routine-' || r.id::text
  WHERE r.engine = 'step_functions'
    AND EXISTS (
      SELECT 1
        FROM public.scheduled_jobs sj
       WHERE sj.routine_id = r.id
         AND sj.trigger_type IN ('routine_schedule', 'routine_one_time')
    )
)
INSERT INTO public.workflow_triggers (
  tenant_id,
  workflow_id,
  workflow_version_id,
  trigger_family,
  source_system,
  enabled,
  idempotency_required,
  trigger_config,
  actor_contract,
  readiness_state,
  readiness_reasons,
  created_at,
  updated_at
)
SELECT
  srw.tenant_id,
  srw.workflow_id,
  srw.workflow_version_id,
  'schedule',
  'routine',
  (srw.readiness_state = 'ready'),
  true,
  jsonb_build_object('routineId', srw.id),
  jsonb_build_object('agentVisible', srw.visibility = 'tenant_shared'),
  srw.readiness_state,
  srw.readiness_reasons,
  now(),
  now()
FROM scheduled_routine_workflows srw
WHERE NOT EXISTS (
  SELECT 1
    FROM public.workflow_triggers wt
   WHERE wt.workflow_id = srw.workflow_id
     AND wt.trigger_family = 'schedule'
);

CREATE OR REPLACE VIEW public.view_workflow_backfill_existing_routines_status AS
SELECT
  (SELECT count(*) FROM public.routines WHERE engine = 'step_functions') AS eligible_step_functions_routines,
  (
    SELECT count(*)
      FROM public.routines r
      JOIN public.workflow_engine_bindings b
        ON b.tenant_id = r.tenant_id
       AND b.routine_id = r.id
       AND b.binding_type = 'step_functions_routine'
     WHERE r.engine = 'step_functions'
  ) AS backfilled_step_functions_bindings,
  (
    SELECT count(*)
      FROM public.routines r
      LEFT JOIN public.workflow_engine_bindings b
        ON b.tenant_id = r.tenant_id
       AND b.routine_id = r.id
       AND b.binding_type = 'step_functions_routine'
     WHERE r.engine = 'step_functions'
       AND b.id IS NULL
  ) AS missing_step_functions_bindings,
  (SELECT count(*) FROM public.routines WHERE engine = 'legacy_python') AS skipped_legacy_python_routines,
  (
    SELECT count(*)
      FROM public.scheduled_jobs sj
      JOIN public.routines r
        ON r.id = sj.routine_id
      LEFT JOIN public.workflow_engine_bindings b
        ON b.tenant_id = r.tenant_id
       AND b.routine_id = r.id
       AND b.binding_type = 'step_functions_routine'
     WHERE r.engine = 'step_functions'
       AND sj.trigger_type IN ('routine_schedule', 'routine_one_time')
       AND sj.enabled = true
       AND (b.workflow_version_id IS NULL OR b.routine_asl_version_id IS NULL)
  ) AS enabled_scheduled_routines_without_version_pin;
