# Workflow Control Plane Migration Runbook

This runbook covers the first-class Workflow control-plane SQL rollout for
ThinkWork, TEI, and McPherson environments. It is intentionally operations-first:
do the same preflight, migration, postflight, and rollback-readiness record for
each environment before moving to the next.

Do not paste database URLs, Secrets Manager payloads, tenant IDs, or tfvars
values into commits, PRs, Linear, or chat. Record only command names, row counts,
timestamps, operator initials, and pass/fail outcomes.

## Scope

Included:

- Apply the additive workflow control-plane schema:
  `packages/database-pg/drizzle/0177_workflow_control_plane.sql`.
- Backfill first-class Workflow projections for existing Step Functions-backed
  Routine rows:
  `packages/database-pg/drizzle/0178_workflow_backfill_existing_routines.sql`.
- Verify marker drift with `scripts/db-migrate-manual.sh`.
- Verify Step Functions routine, scheduled routine, n8n, and Twenty workflow
  visibility/readiness invariants after deploy.

Not included:

- Destructive Routine table renames or table drops.
- Manual production mutation outside the normal reviewed migration execution.
- Importing or activating arbitrary n8n workflows.
- Backfilling legacy Python routines as startable workflows. They remain
  compatibility/internal substrate unless a later migration explicitly retires
  or converts them.

## Environment Ledger

Fill this table during execution. `DATABASE_URL` should come from the normal
stage secret resolution path for the environment; never write the value here.

| Environment | Stage / stack | Tenant check | Preflight | 0177 apply | 0178 apply | Drift check | Postflight | Rollback ready | Operator / time |
| ----------- | ------------- | ------------ | --------- | ---------- | ---------- | ----------- | ---------- | -------------- | --------------- |
| ThinkWork   |               |              |           |            |            |             |            |                |                 |
| TEI         |               |              |           |            |            |             |            |                |                 |
| McPherson   |               |              |           |            |            |             |            |                |                 |

## Preflight

1. Confirm the environment and tenant set.

```bash
thinkwork me --stage <stage>
```

2. Resolve the environment database URL through the existing stage secret flow
   into a local-only shell variable. Do not echo it.

```bash
export DATABASE_URL='<resolved locally from Secrets Manager or stage config>'
```

3. Confirm prerequisite tables exist.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  to_regclass('public.tenants') AS tenants,
  to_regclass('public.routines') AS routines,
  to_regclass('public.routine_asl_versions') AS routine_asl_versions,
  to_regclass('public.routine_executions') AS routine_executions,
  to_regclass('public.scheduled_jobs') AS scheduled_jobs,
  to_regclass('public.managed_applications') AS managed_applications,
  to_regclass('public.plugin_installs') AS plugin_installs,
  to_regclass('public.tenant_credentials') AS tenant_credentials;
SQL
```

4. Capture source counts before any writes.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT slug, name, id FROM tenants ORDER BY created_at;

SELECT
  engine,
  status,
  count(*) AS routines
FROM routines
GROUP BY engine, status
ORDER BY engine, status;

SELECT
  count(*) FILTER (WHERE r.engine = 'step_functions') AS step_function_routines,
  count(*) FILTER (
    WHERE r.engine = 'step_functions'
      AND r.state_machine_arn IS NOT NULL
      AND r.state_machine_alias_arn IS NOT NULL
      AND av.id IS NOT NULL
  ) AS ready_step_function_routines,
  count(*) FILTER (WHERE r.engine = 'legacy_python') AS skipped_legacy_python_routines
FROM routines r
LEFT JOIN routine_asl_versions av
  ON av.routine_id = r.id
 AND av.version_number = r.current_version;

SELECT
  sj.trigger_type,
  sj.enabled,
  count(*) AS scheduled_jobs
FROM scheduled_jobs sj
WHERE sj.routine_id IS NOT NULL
GROUP BY sj.trigger_type, sj.enabled
ORDER BY sj.trigger_type, sj.enabled;
SQL
```

5. Run dry-run marker inspection for the migration files.

```bash
bash scripts/db-migrate-manual.sh --dry-run \
  packages/database-pg/drizzle/0177_workflow_control_plane.sql \
  packages/database-pg/drizzle/0178_workflow_backfill_existing_routines.sql
```

Stop if any prerequisite relation is missing or if source counts do not match
the expected environment inventory.

## Apply

Apply 0177 first. It is additive DDL only.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/database-pg/drizzle/0177_workflow_control_plane.sql
```

Run drift detection for 0177 before applying the data backfill.

```bash
bash scripts/db-migrate-manual.sh \
  packages/database-pg/drizzle/0177_workflow_control_plane.sql
```

Apply 0178. It is idempotent and can be rerun. It projects existing
`engine='step_functions'` routines into `workflows`, `workflow_versions`,
`workflow_engine_bindings`, and routine-backed workflow triggers.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/database-pg/drizzle/0178_workflow_backfill_existing_routines.sql
```

Run drift detection for 0178. The marker object is a status view because this
is a data migration.

```bash
bash scripts/db-migrate-manual.sh \
  packages/database-pg/drizzle/0178_workflow_backfill_existing_routines.sql
```

## Postflight

1. The status view should report zero missing bindings and zero enabled
   scheduled routines without a pinned workflow version.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT * FROM public.view_workflow_backfill_existing_routines_status;
SQL
```

Expected:

- `eligible_step_functions_routines = backfilled_step_functions_bindings`.
- `missing_step_functions_bindings = 0`.
- `enabled_scheduled_routines_without_version_pin = 0`.
- `skipped_legacy_python_routines` is recorded but does not block the rollout.

2. Confirm one binding per Step Functions routine.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  r.tenant_id,
  count(*) AS step_function_routines,
  count(b.id) AS workflow_bindings
FROM routines r
LEFT JOIN workflow_engine_bindings b
  ON b.tenant_id = r.tenant_id
 AND b.routine_id = r.id
 AND b.binding_type = 'step_functions_routine'
WHERE r.engine = 'step_functions'
GROUP BY r.tenant_id
ORDER BY r.tenant_id;
SQL
```

3. Confirm current ASL version projection.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  r.id AS routine_id,
  r.current_version,
  w.id AS workflow_id,
  w.current_version_number,
  b.routine_asl_version_id,
  b.readiness_state,
  b.binding_status
FROM routines r
JOIN workflow_engine_bindings b
  ON b.tenant_id = r.tenant_id
 AND b.routine_id = r.id
 AND b.binding_type = 'step_functions_routine'
JOIN workflows w
  ON w.id = b.workflow_id
WHERE r.engine = 'step_functions'
  AND (
    r.current_version IS DISTINCT FROM w.current_version_number
    OR (r.status = 'active' AND b.readiness_state = 'ready' AND b.routine_asl_version_id IS NULL)
  );
SQL
```

Expected: zero rows. Rows for incomplete or disabled routines should be
`blocked_not_ready` or `disabled`, not silently absent.

4. Confirm scheduled Routine-backed workflows can resolve a pinned version.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  sj.id AS scheduled_job_id,
  sj.name,
  sj.enabled,
  r.id AS routine_id,
  w.id AS workflow_id,
  b.workflow_version_id,
  b.routine_asl_version_id
FROM scheduled_jobs sj
JOIN routines r
  ON r.id = sj.routine_id
LEFT JOIN workflow_engine_bindings b
  ON b.tenant_id = r.tenant_id
 AND b.routine_id = r.id
 AND b.binding_type = 'step_functions_routine'
LEFT JOIN workflows w
  ON w.id = b.workflow_id
WHERE r.engine = 'step_functions'
  AND sj.trigger_type IN ('routine_schedule', 'routine_one_time')
  AND sj.enabled = true
  AND (b.workflow_version_id IS NULL OR b.routine_asl_version_id IS NULL);
SQL
```

Expected: zero rows.

5. Confirm connected-app workflow bindings remain visible but do not block the
   Step Functions backfill. This query is informational.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  binding_type,
  binding_status,
  readiness_state,
  count(*) AS bindings
FROM workflow_engine_bindings
GROUP BY binding_type, binding_status, readiness_state
ORDER BY binding_type, binding_status, readiness_state;
SQL
```

6. In the web app, spot-check:

- `Settings -> Workflows` lists Step Functions-backed workflows.
- A Step Functions-backed row opens detail with engine evidence.
- The old Routine deep link redirects or renders through Workflow-facing copy.
- `/settings/plugins/n8n` still shows Workflows and Settings tabs.
- Twenty CRM workflow bindings show readiness rather than disappearing.

## Rollback Posture

Primary rollback is disable-new-writes plus compatibility reads:

1. Keep the 0177 tables in place.
2. Disable workflow-triggering feature flags if the issue is runtime behavior.
3. Use Routine compatibility paths (`triggerRoutineRun`, Routine detail deep
   links, and Step Functions evidence) while investigating.

Schema/table rollback:

- `0177_workflow_control_plane_rollback.sql` drops the control-plane tables and
  should only be used before application code depends on them or after a
  database restore decision.
- Do not run the 0177 rollback in an environment with workflow runs unless the
  incident owner has approved data loss or restore from backup.

Backfill rollback:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f packages/database-pg/drizzle/0178_workflow_backfill_existing_routines_rollback.sql
```

The 0178 rollback drops the status view and deletes only backfilled workflow
projections that have no `workflow_runs`. If a workflow has run evidence, keep
the projection and use disable-new-writes rollback instead.

## Completion Criteria

For each of ThinkWork, TEI, and McPherson:

- Preflight table checks passed.
- Source counts were recorded.
- 0177 applied or was already present.
- 0178 applied or was already present.
- `db-migrate-manual.sh` passed for both files.
- Status view shows zero missing Step Functions bindings.
- Enabled scheduled Step Functions routines have pinned workflow versions.
- Rollback posture was recorded in the environment ledger.
