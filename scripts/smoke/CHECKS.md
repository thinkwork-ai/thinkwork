# skill_runs smoke-test checks

Operator runbook for the four skill-run invocation paths. Each
script exits `0` on PASS, `1` on FAIL, and prints exactly one
`PASS …` or `FAIL:<reason>` line so `run-all.sh` can aggregate them.

## What "passing" means today

Each smoke PASSes when `skill_runs.status` transitions out of
`running` within the timeout — whether to `complete` (dispatch
finished, artifact delivered) or to `failed` with a `failure_reason`
that names the specific reason (missing connector, unsupported kind,
etc.). Both outcomes prove the full dispatch → runtime → DB loop
works end-to-end.

Post plan §U6 every `kind=run_skill` envelope currently terminates as
`failed` with the canonical "kind=run_skill is unsupported in this
runtime" reason — the composition runner was deleted and a replacement
out-of-band dispatcher has not landed yet. The smokes therefore
validate the **row lifecycle** (POST → insert → container → writeback),
not runtime execution:

- `/api/skills/start` inserts a `running` row, invokes the agentcore
  Lambda, and returns a `runId`.
- The container branches on `kind="run_skill"`, logs the unsupported
  envelope, and POSTs `status=failed` to `/api/skills/complete`.
- `/api/skills/complete` (service-auth) validates the transition and
  updates `skill_runs.status` + `failure_reason` + `finished_at`.

**What the smokes prove end-to-end:**

- Schema + migrations applied correctly (pre-flight `to_regclass` probe).
- `POST /api/skills/start` accepts the service envelope, inserts a
  `skill_runs` row, and invokes the agentcore Lambda.
- The agentcore container branches on `kind="run_skill"` and POSTs
  terminal state back to `/api/skills/complete`.
- `/api/skills/complete` (service-auth) validates the transition and
  updates `skill_runs.status` + `failure_reason` + `finished_at`.
- `job-trigger` Lambda reads a `scheduled_jobs` row, resolves input
  bindings, inserts a `skill_runs` row with `invocation_source=
  'scheduled'`, and the same lifecycle runs.
- All three paths deduplicate correctly via the partial unique index.

A script FAILs when:

- `skill_runs` or related tables are missing on the target stage
  (`FAIL:schema_missing`).
- The dispatch endpoint returns non-200 (`FAIL:dispatch_http_<code>`)
  or the Lambda invoke fails (`FAIL:lambda_invoke_rc_<code>`).
- The inserted `skill_runs` row is still `status='running'` after the
  timeout — the container hung, crashed, or the completion callback
  never arrived (`FAIL:timeout_still_running …`).
- The scheduled path couldn't insert the fixture `scheduled_jobs` row
  or the job-trigger Lambda didn't produce a matching `skill_runs`
  row within 10s (`FAIL:insert_scheduled_job` / `FAIL:no_skill_run_row`).

## Path coverage

| Path | Script | CI subset | Mutates |
|------|--------|-----------|---------|
| chat | `chat-smoke.sh` | ✅ | `skill_runs` insert |
| catalog | `catalog-smoke.sh` | ✅ | `skill_runs` insert |
| scheduled | `scheduled-smoke.sh --force` | no (manual) | `scheduled_jobs` + `skill_runs`; best-effort cleanup of the `scheduled_jobs` row on exit |
| webhook | `webhook-smoke.sh` (from Unit 8 kit) | partial (bad-sig only) | `skill_runs` insert when signed correctly |

`run-all.sh` runs chat + catalog + scheduled by default; `--ci` drops
scheduled so the remaining suite is safe to run from GitHub Actions
against the deployed stage.

## Shared contract

- **Input:** `--tenant-id`, `--invoker-user-id`. Both resolvable from
  psql against dev:
  ```sql
  SELECT t.id AS tenant_id, u.id AS user_id, u.email
  FROM tenants t JOIN users u ON u.tenant_id = t.id
  ORDER BY t.created_at LIMIT 5;
  ```
- **Output:** exactly one line on stdout — either
  `PASS <path> run_id=<uuid> status=<final> reason=<text>` or
  `FAIL:<reason> <optional context>`.
- **Env resolution:** `_env.sh` reads `terraform/examples/greenfield`
  outputs + Secrets Manager + `terraform.tfvars` to set
  `API_URL`, `API_AUTH_SECRET`, `DATABASE_URL`. Override any of them
  via env var to skip the lookup.

## Running a single path

```sh
# chat
scripts/smoke/chat-smoke.sh \
  --tenant-id <tenant-uuid> \
  --invoker-user-id <user-uuid>

# catalog (same endpoint, invocationSource=catalog)
scripts/smoke/catalog-smoke.sh \
  --tenant-id <tenant-uuid> \
  --invoker-user-id <user-uuid>

# scheduled (REQUIRES --force; mutates scheduled_jobs)
scripts/smoke/scheduled-smoke.sh --force \
  --tenant-id <tenant-uuid> \
  --invoker-user-id <user-uuid>
```

## Running the full aggregate

```sh
scripts/smoke/run-all.sh \
  --tenant-id <tenant-uuid> \
  --invoker-user-id <user-uuid>

# CI subset (no scheduled, no webhook happy-path):
scripts/smoke/run-all.sh --ci \
  --tenant-id <tenant-uuid> \
  --invoker-user-id <user-uuid>
```

## Manual verification of rows

After a run, confirm the row looks sane:

```sql
SELECT id, invocation_source, status, failure_reason,
       (finished_at - started_at) AS duration
FROM skill_runs
WHERE tenant_id = '<tenant-uuid>'
ORDER BY started_at DESC
LIMIT 5;
```

All four `invocation_source` values (`chat`, `catalog`, `scheduled`,
`webhook`) should be present after running the full suite + a
webhook-smoke happy-path call.

## Known gaps

- **Runtime execution is offline** — per plan §U6 the `kind=run_skill`
  path fails fast with the canonical unsupported-runtime reason. A
  replacement out-of-band dispatcher will land after U6.
- The catalog path uses the **service endpoint** `/api/skills/start`,
  not the admin GraphQL `startSkillRun` mutation — the mutation
  requires a Cognito JWT we don't have programmatic access to. The
  GraphQL auth leg is still covered by the manual "admin Run now"
  click-through.
- `scheduled-smoke` invokes the job-trigger Lambda directly and
  bypasses EventBridge Scheduler. The `rate()` / `cron()` → fire-time
  wiring is tested separately in the scheduler integration tests.
- Webhook happy-path is not included in `run-all.sh` because it
  requires a per-tenant signing secret in Secrets Manager (see
  `webhook-secret-put.sh`). Run it standalone from `webhook-smoke.sh`.
