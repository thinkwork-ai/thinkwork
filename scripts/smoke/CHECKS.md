# skill_runs smoke-test checks

Operator runbook for the four composition invocation paths. Each
script exits `0` on PASS, `1` on FAIL, and prints exactly one
`PASS …` or `FAIL:<reason>` line so `run-all.sh` can aggregate them.

## What "passing" means today

**Today's expected state:** chat, catalog, and scheduled smokes all
return `FAIL:timeout_still_running`. That is **not** a defect in these
scripts — it's a correctly-reported runtime gap. The deployed
agentcore container (`packages/agentcore-strands/agent-container/
server.py`) doesn't yet branch on `kind="run_skill"` envelopes, so
rows inserted by the dispatch layer never transition out of `running`.
Wiring `run_skill` dispatch into the container is a separate
follow-up; once it lands, these scripts should PASS (probably with
`status=failed, reason=<missing connector>` — that failure IS a pass,
per the composable-skills plan, since no real connectors are wired
either).

**What this PR's smokes DO prove right now:**

- Schema + migrations are applied correctly on the target stage
  (pre-flight `to_regclass` probe).
- `POST /api/skills/start` accepts the service envelope and inserts a
  `skill_runs` row — the fix for the `ON CONFLICT … WHERE
  status='running'` partial-index bug lands with this kit.
- `job-trigger` Lambda reads a `scheduled_jobs` row, resolves input
  bindings, and inserts a `skill_runs` row with
  `invocation_source='scheduled'`.
- All three paths deduplicate correctly via the partial unique index.

A script FAILs when:

- `skill_runs` or related tables are missing on the target stage
  (`FAIL:schema_missing`).
- The dispatch endpoint returns non-200 (`FAIL:dispatch_http_<code>`)
  or the lambda invoke fails (`FAIL:lambda_invoke_rc_<code>`).
- The inserted `skill_runs` row is still `status='running'` after the
  timeout — today this is the expected state (see above); after
  `run_skill` dispatch lands in the container this becomes a genuine
  failure signal (`FAIL:timeout_still_running …`).
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

- **`run_skill` dispatch in the agentcore container** (blocker). The
  deployed `server.py` doesn't branch on `kind="run_skill"` envelopes
  today, so rows stay `status=running`. Tracked as a follow-up —
  once it lands, all three strict smokes should PASS.
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
