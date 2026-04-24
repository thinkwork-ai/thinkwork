# skill_runs smoke-test kit

Operator tooling for the cheapest viable end-to-end test of the four
skill-run invocation paths — chat, catalog, scheduled, webhook. Part of
`run-all.sh` is designed to run in CI against the just-deployed stage
(see `CHECKS.md` for which subset); the rest is for manual verification.

Context: the V1 agent-architecture plan shipped its persistence + ingress
tooling with zero real end-to-end tests. The "integration tests" under
`packages/api/test/integration/skill-runs/` are harness-backed mocks.
This kit fills the gap.

## Files

| File | Role |
|------|------|
| `_env.sh` | Sourced helper: resolves `API_URL`, `API_AUTH_SECRET`, `DATABASE_URL`; provides `preflight_skill_runs_schema` + `wait_for_terminal_status`. |
| `chat-smoke.sh` | POST `/api/skills/start` with `invocationSource=chat`; asserts `skill_runs` row transitions out of `running`. |
| `catalog-smoke.sh` | POST `/api/skills/start` with `invocationSource=catalog`; same assertion. |
| `scheduled-smoke.sh` | Insert `scheduled_jobs` + invoke `job-trigger` Lambda; asserts a scheduled `skill_runs` row. `--force` required (mutates DB). |
| `run-all.sh` | Aggregator — runs chat + catalog + scheduled (or `--ci` subset) and prints a PASS/FAIL line per path. |
| `webhook-secret-put.sh` | Create or rotate a per-(tenant, integration) signing secret in Secrets Manager. |
| `webhook-smoke.sh` | HMAC-sign + POST a payload to the deployed webhook Lambda. |
| `CHECKS.md` | Definition-of-passing + the full runbook per path. Read this first if a smoke fails. |
| `fixtures/sales-prep-chat.json` | Inputs for `chat-smoke.sh` (distinct customer so dedup hash differs from catalog). |
| `fixtures/sales-prep-catalog.json` | Inputs for `catalog-smoke.sh`. |
| `fixtures/crm-opportunity-won.json` | Valid CRM close-won event. Triggers `customer-onboarding-reconciler`. |
| `fixtures/task-completed.json` | Task completion event with a `triggeredByRunId` hook. Edit before using. |
| `fixtures/task-completed-no-trigger.json` | Task completion without metadata — verifies the "skip, don't re-tick" branch. |

## Quick start — run the full smoke suite

```sh
# Find a tenant + user on the target stage
psql "$DATABASE_URL" -c "
  SELECT t.id AS tenant_id, u.id AS user_id, u.email
  FROM tenants t JOIN users u ON u.tenant_id = t.id
  ORDER BY t.created_at LIMIT 5;
"

# Run all four paths (chat + catalog + scheduled)
scripts/smoke/run-all.sh \
  --tenant-id <tenant-uuid> \
  --invoker-user-id <user-uuid>
```

See [`CHECKS.md`](CHECKS.md) for what each PASS/FAIL means, expected
failure modes under "no connectors wired", and single-path invocations.

All shell scripts are `bash` (tested on macOS 3.x / Linux 5.x). Require
`aws`, `openssl`, `curl`, and `terraform` on `PATH`. The webhook-smoke
script resolves the API URL via `terraform output -raw api_endpoint`
from `terraform/examples/greenfield`, so `terraform init` must have
been run there first (usually the deploy workflow handles this).

## One-time setup per tenant

```sh
# Generate + store a secret. The second argument is the integration
# slug — must match the Lambda's `integration` config:
#   crm-opportunity | task-event
scripts/smoke/webhook-secret-put.sh <tenant-id> crm-opportunity
scripts/smoke/webhook-secret-put.sh <tenant-id> task-event
```

Both commands print the generated secret to stdout so you can capture
it for vendor-side configuration. The webhook Lambdas fetch from
Secrets Manager on every request, so no redeploy is needed after
rotation.

## Smoke test 1 — CRM opportunity-won → reconciler tick 1

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration crm-opportunity \
  --payload scripts/smoke/fixtures/crm-opportunity-won.json
```

**What should happen:**

1. HTTP 200 with `{"runId":"<uuid>","deduped":false}` in the body.
2. New row in `skill_runs` with:
   - `invocation_source = 'webhook'`
   - `skill_id = 'customer-onboarding-reconciler'`
   - `invoker_user_id` = the tenant's system-user uuid (first ever
     webhook call for the tenant also inserts a row into
     `tenant_system_users`)
   - `status` transitions `running` → `complete` (the agent ran the
     reconciler tick end-to-end and the deliverable landed on the row)
     OR `running` → `failed` with a specific reason (missing
     connector, agent loop error, config-fetch failure, etc.). Both
     prove the webhook path reaches the container and the completion
     callback updates the row.
3. `failure_reason` names the specific cause, not an auth or dispatch
   error.

**Verify with:**

```sql
SELECT id, status, invocation_source, invoker_user_id, failure_reason, started_at
FROM skill_runs
WHERE skill_id = 'customer-onboarding-reconciler'
ORDER BY started_at DESC
LIMIT 5;
```

Also check the `tenant_system_users` table got a row for the tenant:

```sql
SELECT id, tenant_id, created_at FROM tenant_system_users;
```

## Smoke test 2 — task completion → reconciler tick 2

Edit `fixtures/task-completed.json`, replacing `triggeredByRunId` with
the `id` from the tick-1 run (from the SQL query above). Then:

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-completed.json
```

**What should happen:**

1. HTTP 200 with a new `runId` (assuming the prior run is no longer
   `running` — if it is, you get `{"deduped":true}` instead).
2. New `skill_runs` row with:
   - `invocation_source = 'webhook'`
   - `triggered_by_run_id` = the tick-1 run's id
   - Same `skill_id` and `resolved_inputs` as tick 1.
3. Same failure mode at the connector layer — again, acceptable.

The "skip, don't re-tick" branch — when a task.completed event has no
`triggeredByRunId` — can be smoke-tested with:

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-completed-no-trigger.json
```

Expected: HTTP 200 with `{"skipped":true,"reason":"..."}` — no new
`skill_runs` row.

## Smoke test 3 — 401 on bad signature

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration crm-opportunity \
  --payload scripts/smoke/fixtures/crm-opportunity-won.json \
  --secret wrong-secret
```

Expected: HTTP 401, no response body enumerating the tenant id, no
new `skill_runs` row.

## Smoke test 4 — rate limit

Fire `webhook-smoke.sh` 61 times in under a minute for the same
tenant+integration. The 61st should return HTTP 429. The in-memory
rate window resets on Lambda cold start, so if the Lambda cycles
between attempts the count restarts — real production testing wants
a loop tight enough to keep warm:

```sh
for i in $(seq 1 61); do
  scripts/smoke/webhook-smoke.sh --tenant-id <tenant-id> \
    --integration crm-opportunity \
    --payload scripts/smoke/fixtures/crm-opportunity-won.json \
  2>/dev/null | head -1
done | tail -5
```

Last output line should include `HTTP/2 429` (or `HTTP/1.1 429`).

## Smoke test 5 — admin "Run now" on sales-prep

The only catalog-path test; needs a human click. No script here.

1. Sign in to admin at dev.
2. Navigate to an agent that has `sales-prep` in its skill list.
3. Click **Run now** with a real customer + meeting_date.
4. Verify a `skill_runs` row appears with `invocation_source = 'catalog'`
   and the invoker = your Cognito user id.

Same connector-layer failure is expected. Passing = the row exists and
the invoker is you, not a system user.

## What passes vs fails

Given no real connectors are wired, "pass" means the entire ingress
path runs cleanly up to the point where real data lookup would happen:

- ✅ Signature verification works
- ✅ `tenant_system_users` bootstrap works
- ✅ `skill_runs` inserts under the correct actor
- ✅ `agentcore-invoke` gets called with the right envelope
- ✅ the container branches on `kind=run_skill`, fetches the agent
  runtime config, runs the headless agent turn, and POSTs
  `/api/skills/complete` — the terminal state can be `complete` or
  `failed` with a specific reason; either proves the full loop works
- ✅ `triggered_by_run_id` populates on tick 2

Anything failing before the connector layer is a real bug and blocks
the R13 adoption criterion.

## Related

- `packages/api/src/handlers/webhooks/README.md` — pattern doc.
- `docs/plans/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` — Unit 8 spec.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — related operator-tooling gap this kit also backfills.
