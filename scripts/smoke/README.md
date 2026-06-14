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

| File                                         | Role                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_env.sh`                                    | Sourced helper: resolves `API_URL`, `API_AUTH_SECRET`, `DATABASE_URL`; provides `preflight_skill_runs_schema` + `wait_for_terminal_status`.                                                                                                                                                                                        |
| `chat-smoke.sh`                              | POST `/api/skills/start` with `invocationSource=chat`; asserts `skill_runs` row transitions out of `running`.                                                                                                                                                                                                                      |
| `catalog-smoke.sh`                           | POST `/api/skills/start` with `invocationSource=catalog`; same assertion.                                                                                                                                                                                                                                                          |
| `scheduled-smoke.sh`                         | Insert `scheduled_jobs` + invoke `job-trigger` Lambda; asserts a scheduled `skill_runs` row. `--force` required (mutates DB).                                                                                                                                                                                                      |
| `run-all.sh`                                 | Aggregator — runs chat + catalog + scheduled (or `--ci` subset) and prints a PASS/FAIL line per path.                                                                                                                                                                                                                              |
| `webhook-secret-put.sh`                      | Create or rotate a per-(tenant, integration) signing secret in Secrets Manager.                                                                                                                                                                                                                                                    |
| `webhook-smoke.sh`                           | HMAC-sign + POST a payload to the deployed webhook Lambda.                                                                                                                                                                                                                                                                         |
| `CHECKS.md`                                  | Definition-of-passing + the full runbook per path. Read this first if a smoke fails.                                                                                                                                                                                                                                               |
| `fixtures/sales-prep-chat.json`              | Inputs for `chat-smoke.sh` (distinct customer so dedup hash differs from catalog).                                                                                                                                                                                                                                                 |
| `fixtures/sales-prep-catalog.json`           | Inputs for `catalog-smoke.sh`.                                                                                                                                                                                                                                                                                                     |
| `fixtures/crm-opportunity-won.json`          | Valid CRM close-won event. Starts or returns a Customer Onboarding Space Thread and mirrors checklist tasks.                                                                                                                                                                                                                       |
| `fixtures/task-completed.json`               | Task completion event with a `triggeredByRunId` hook. Edit before using.                                                                                                                                                                                                                                                           |
| `fixtures/task-completed-no-trigger.json`    | Task completion without metadata — verifies the "skip, don't re-tick" branch.                                                                                                                                                                                                                                                      |
| `spaces-runbook-smoke.mjs`                   | Computer runbook smoke. Dry-run reports expected prompts/runbooks without catalog validation; live mode checks tenant S3 catalog-backed runbooks, auto-selected confirmation, explicit Queue creation, cancellation, and no-match fallback.                                                                                        |
| `foundation-bootstrap-smoke.mjs`             | GitHub-free foundation bootstrap smoke. Dry-run reports required endpoint/evidence inputs; live mode verifies generated Spaces/API/Auth/profile/control-plane outputs and emits a support evidence envelope.                                                                                                                       |
| `deployment-profile-binding-smoke.mjs`       | Deployment profile binding smoke. Dry-run reports profile requirements; live mode validates runtime-config-backed web, desktop, and mobile profile binding without recording credential material.                                                                                                                                  |
| `deployment-evidence.mjs`                    | Shared JSON evidence envelope writer/uploader for foundation and managed-app smokes. Writes locally or uploads to S3 only when explicitly configured.                                                                                                                                                                              |
| `knowledge-graph-thread-ingest-smoke.mjs`    | Cognee Knowledge Graph smoke. Dry-run reports required live-mode configuration; live mode starts a manual thread ingest, polls the run, and verifies table/graph/detail GraphQL reads from the normalized snapshot.                                                                                                                |
| `twenty-managed-app-smoke.mjs`               | Twenty CRM managed-app smoke. Dry-run reports live-mode requirements; live mode reads Terraform/API status, skips parked or unprovisioned stages clearly, and probes the public `/healthz` endpoint when CRM is running.                                                                                                           |
| `managed-app-controller-readiness-smoke.mjs` | Read-only managed-app controller readiness smoke. Verifies selected release manifest descriptors, smoke contracts, and required runtime images for Cognee/Twenty without starting any managed-app job.                                                                                                                             |
| `deployment-teardown-readiness-smoke.mjs`    | Read-only teardown readiness smoke. Verifies the selected release pins, customer controller, Terraform backend, lock table, and evidence bucket needed for a later destroy run without starting destroy.                                                                                                                           |
| `lastmile-plugin-smoke.mjs`                  | LastMile plugin smoke. Dry-run by default. Phase 1: live OAuth discovery drift guard + `installPlugin` + prints the `activatePlugin` authorize URL; a manual browser OAuth consent sits in between; phase 2 (`--post-activation`): per-user activation status plus MCP tool-surface inclusion/exclusion via `/api/mcp/tools/list`. |
| `company-brain-plugin-smoke.mjs`             | Company Brain premium plugin smoke. Dry-run by default. Live mode proves catalog visibility, premium key-gating, optional generated/backdoor key redemption through `installPlugin`, persistent entitlement state, Brain substrate deployment evidence, and the Memory / Ontology route contract.                                  |
| `company-brain-context-engine-smoke.mjs`     | Read-only Company Brain Context Engine smoke. Dry-run by default. Live mode calls `/mcp/context-engine` with service auth, checks `query_brain_context` provider status/provenance/source-boundary metadata, and compares the named workflow with `query_memory_context`.                                                          |

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

## Computer runbook smoke

The Computer runbook smoke covers published runbooks rather than skill runs:

```sh
node scripts/smoke/spaces-runbook-smoke.mjs
SMOKE_ENABLE_COMPUTER_RUNBOOKS=1 node scripts/smoke/spaces-runbook-smoke.mjs
```

Dry-run is informational only because runbook definitions now live in each tenant's S3 skill catalog. Live mode requires a deployed Computer stack and GraphQL/database credentials. It checks:

- auto-selected `map-artifact` creates `data-runbook-confirmation` before execution
- explicit `crm-dashboard` creates `data-runbook-queue` without confirmation
- explicit `research-dashboard` creates a Queue and can be cancelled
- a no-match prompt does not create a published runbook run

All shell scripts are `bash` (tested on macOS 3.x / Linux 5.x). Require
`aws`, `openssl`, `curl`, and `terraform` on `PATH`. The webhook-smoke
script resolves the API URL via `terraform output -raw api_endpoint`
from `terraform/examples/greenfield`, so `terraform init` must have
been run there first (usually the deploy workflow handles this).

## Twenty managed-app smoke

The Twenty CRM smoke is read-only and dry-run by default:

```sh
node scripts/smoke/twenty-managed-app-smoke.mjs

SMOKE_ENABLE_TWENTY_MANAGED_APP=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  node scripts/smoke/twenty-managed-app-smoke.mjs
```

Live mode reads `terraform/examples/greenfield` outputs unless
`SMOKE_TERRAFORM_DIR` points elsewhere. `SMOKE_TWENTY_URL` can supply the
public URL directly when Terraform outputs are unavailable. GraphQL deployment
status and managed-app health are checked when API credentials are available
from `apps/web/.env` or equivalent `VITE_GRAPHQL_HTTP_URL` plus
`API_AUTH_SECRET`/`THINKWORK_API_SECRET` or an API key.

Passing live mode means:

- unprovisioned Twenty stages skip with an explicit message;
- parked Twenty stages skip with an explicit retained-runtime message;
- running Twenty stages expose an HTTPS URL;
- the public `https://.../healthz` endpoint returns a successful response.

## Company Brain premium plugin smoke

The Company Brain plugin smoke is dry-run by default and never starts a live
install unless `SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1` is set:

```sh
node scripts/smoke/company-brain-plugin-smoke.mjs

SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_ADMIN_USER_ID=<tenant-admin-user-id> \
  SMOKE_COMPANY_BRAIN_INSTALL_KEY=<issued-or-dev-backdoor-key> \
  node scripts/smoke/company-brain-plugin-smoke.mjs
```

To mint a one-time key during the smoke instead of passing an existing key,
use a ThinkWork platform-operator principal:

```sh
SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_ADMIN_USER_ID=<tenant-admin-user-id> \
  SMOKE_COMPANY_BRAIN_ISSUE_KEY=1 \
  SMOKE_PLATFORM_OPERATOR_USER_ID=<platform-operator-user-id> \
  node scripts/smoke/company-brain-plugin-smoke.mjs
```

Live mode requires deployed GraphQL credentials from `apps/web/.env` or
equivalent `VITE_GRAPHQL_HTTP_URL`/`GRAPHQL_HTTP_URL` plus
`API_AUTH_SECRET`/`THINKWORK_API_SECRET`. Passing live mode means:

- Company Brain appears in `pluginCatalog` with premium/key-gated metadata.
- unentitled installs without a key and with an invalid key fail closed without
  creating an install or entitlement.
- a generated, issued, or configured dev/test backdoor key grants the same
  persistent entitlement path used by normal install.
- the Brain substrate infrastructure component exposes managed-app deployment
  evidence; existing-Cognee adoption reports the no-change marker when that path
  is active.
- Company Brain plugin detail remains `/settings/plugins/company-brain`, and
  Memory / Ontology remains `/settings/memory/knowledge-graph`.

## Company Brain Context Engine smoke

The Company Brain Context Engine smoke is read-only and dry-run by default:

```sh
node scripts/smoke/company-brain-context-engine-smoke.mjs

SMOKE_ENABLE_COMPANY_BRAIN_CONTEXT=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_USER_ID=<tenant-user-id> \
  SMOKE_COMPANY_BRAIN_CONTEXT_QUERY="Acme renewal risk" \
  SMOKE_COMPANY_BRAIN_EXPECTED_TERM="procurement" \
  node scripts/smoke/company-brain-context-engine-smoke.mjs
```

Live mode requires `/mcp/context-engine` service credentials from `apps/web/.env`
or equivalent `CONTEXT_ENGINE_MCP_URL` plus `API_AUTH_SECRET`/`THINKWORK_API_SECRET`.
Passing live mode means:

- `query_brain_context` returns Company Brain hits through Context Engine.
- Brain provider status exposes the active backend/provenance posture.
- Brain hits carry untrusted source-data boundary metadata.
- the named workflow is better than memory-only by hit count or an expected-term
  match in the Brain response.
- `query_memory_context` remains separate Hindsight retrieval, not a hidden
  fallback for Brain-only calls.

## GitHub-free foundation smoke

The foundation bootstrap smoke is read-only and dry-run by default:

```sh
node scripts/smoke/foundation-bootstrap-smoke.mjs

SMOKE_ENABLE_FOUNDATION_BOOTSTRAP=1 \
  SMOKE_TERRAFORM_DIR=terraform/examples/greenfield \
  SMOKE_EVIDENCE_FILE=deploy-artifacts/foundation-smoke.json \
  node scripts/smoke/foundation-bootstrap-smoke.mjs
```

Live mode reads Terraform outputs unless endpoint overrides are provided. It
verifies generated Spaces, GraphQL/AppSync, Cognito, deployment profile, and
deployment control-plane outputs. Set `SMOKE_EVIDENCE_S3_URI=s3://bucket/prefix`
to upload the evidence envelope with `aws s3 cp`.

For controller-managed environments where the runtime config is already
published, live mode can validate the deployment profile and control plane from
environment values instead of local Terraform state:

```sh
SMOKE_ENABLE_FOUNDATION_BOOTSTRAP=1 \
  SMOKE_TERRAFORM_DIR=/tmp/no-local-terraform-root \
  SMOKE_SPACES_URL=https://customer.example.com \
  SMOKE_GRAPHQL_URL=https://example.appsync-api.us-east-1.amazonaws.com/graphql \
  SMOKE_GRAPHQL_WS_URL=wss://example.appsync-realtime-api.us-east-1.amazonaws.com/graphql \
  SMOKE_COGNITO_DOMAIN=https://customer.auth.us-east-1.amazoncognito.com \
  SMOKE_DEPLOYMENT_PROFILE_JSON='{"schemaVersion":1,...}' \
  SMOKE_REQUIRE_CONTROL_PLANE=1 \
  SMOKE_STEP_FUNCTIONS_STATE_MACHINE_ARN=arn:aws:states:... \
  SMOKE_CODEBUILD_PROJECT=thinkwork-customer-deployment-runner \
  SMOKE_EVIDENCE_BUCKET=thinkwork-customer-deploy-evidence \
  SMOKE_EVIDENCE_FILE=/tmp/foundation-smoke.json \
  node scripts/smoke/foundation-bootstrap-smoke.mjs
```

## Deployment profile binding smoke

The deployment profile binding smoke is read-only and dry-run by default:

```sh
node scripts/smoke/deployment-profile-binding-smoke.mjs

pnpm --filter @thinkwork/deployment-profile build
SMOKE_ENABLE_DEPLOYMENT_PROFILE_BINDING=1 \
  SMOKE_SPACES_URL=https://customer.example.com \
  SMOKE_EVIDENCE_FILE=/tmp/deployment-profile-binding-smoke.json \
  node scripts/smoke/deployment-profile-binding-smoke.mjs
```

Live mode reads `thinkwork-runtime-config.json`, builds the canonical v1
deployment profile through `@thinkwork/deployment-profile`, validates it, and
checks that web, desktop, and mobile binding snapshots all target the same
deployment id, stage, region, Auth, API, and AppSync endpoints. The smoke fails
if the generated profile or evidence contains API keys, passwords, AWS keys,
tokens, credential material, or secret payload fields.

Use this smoke after authority transfer or release update to prove that a
universal client can bind to the selected environment by profile. It does not
replace a human desktop/mobile launch test; it proves the profile contract that
those clients consume.

## Deployment teardown readiness smoke

The deployment teardown readiness smoke is read-only and dry-run by default:

```sh
node scripts/smoke/deployment-teardown-readiness-smoke.mjs

SMOKE_ENABLE_DEPLOYMENT_TEARDOWN_READINESS=1 \
  AWS_PROFILE=tei \
  AWS_REGION=us-east-1 \
  SMOKE_STAGE=tei-e2e \
  SMOKE_EVIDENCE_FILE=/tmp/deployment-teardown-readiness.json \
  node scripts/smoke/deployment-teardown-readiness-smoke.mjs
```

Live mode reads the customer deployment SSM prefix, selected release pins,
runtime profile, Step Functions state machine, CodeBuild project, Terraform
state bucket, DynamoDB lock table, release artifact bucket, and evidence bucket.
It then emits a redacted `action=destroy` input preview with
`destroyExecutionStarted:false`.

Passing live mode means a later explicit teardown has the customer-owned
controller, backend, lock, and evidence pointers it needs. It is not a teardown
completion proof: the script never starts Step Functions, CodeBuild, Terraform,
or any destructive API.

## Managed-app controller readiness smoke

The managed-app controller readiness smoke is read-only and dry-run by default:

```sh
node scripts/smoke/managed-app-controller-readiness-smoke.mjs

SMOKE_ENABLE_MANAGED_APP_CONTROLLER_READINESS=1 \
  AWS_PROFILE=tei \
  AWS_REGION=us-east-1 \
  SMOKE_STAGE=tei-e2e \
  SMOKE_EVIDENCE_FILE=/tmp/managed-app-controller-readiness.json \
  node scripts/smoke/managed-app-controller-readiness-smoke.mjs
```

Live mode reads the selected release manifest URL/digest from the customer
deployment SSM prefix, downloads the manifest, verifies its SHA-256, and checks
the Cognee/Twenty managed-app descriptors. It verifies module source/version,
smoke command paths, and required runtime images without starting a plan or
approval job.

By default the smoke exits successfully with `deployReady:false` when
descriptors are present but runtime images are missing; this makes it useful for
diagnosing the next gap without breaking read-only demo validation. Set
`SMOKE_REQUIRE_MANAGED_APP_DEPLOY_READY=1` for the final optional-app gate. In
strict mode, missing managed-app images or smoke contracts fail closed.

## Knowledge Graph thread ingest smoke

The Knowledge Graph smoke covers Phase II Cognee thread ingest and Explorer
reads:

```sh
node scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs
SMOKE_ENABLE_KNOWLEDGE_GRAPH=1 \
  SMOKE_TENANT_ID=<tenant-id> \
  SMOKE_KG_THREAD_ID=<thread-id> \
  node scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs
```

Live mode requires deployed GraphQL credentials from `apps/web/.env` or
equivalent `VITE_GRAPHQL_HTTP_URL`/`GRAPHQL_HTTP_URL` plus
`API_AUTH_SECRET`/`THINKWORK_API_SECRET` or an API key. The default live path
uses bearer/API-key service auth scoped by `SMOKE_TENANT_ID`; alternatively,
provide `DATABASE_URL` and the script resolves a tenant from an active
owner/admin membership row. If `SMOKE_KG_THREAD_ID` is omitted, the smoke uses
`knowledgeGraphThreadCandidates` and optional `SMOKE_KG_THREAD_QUERY` to pick a
thread with messages. Set `SMOKE_KG_FORCE=1` to request a fresh ingest.

To exercise the stricter admin-skill impersonation path instead of service
auth, also set `SMOKE_USER_ID` and `SMOKE_KG_AGENT_ID` for an agent whose
`thinkwork-admin` assignment allows the Knowledge Graph operation.

Passing live mode means:

- `startKnowledgeGraphThreadIngest` returns a run.
- The run reaches `SUCCEEDED` before `SMOKE_TIMEOUT_MS`.
- `knowledgeGraphEntities` and `knowledgeGraphGraph` read the same normalized
  thread snapshot through ThinkWork GraphQL.
- When entities exist, `knowledgeGraphEntity` can load the first detail sheet
  payload. If Cognee returns no graph nodes, the script exits successfully with
  an explicit `emptyGraphDiagnostic` object instead of hiding the empty output.

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

## Smoke test 1 — CRM opportunity-won → Customer Onboarding Thread

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration crm-opportunity \
  --payload scripts/smoke/fixtures/crm-opportunity-won.json
```

**What should happen:**

1. HTTP 200 with a body shaped like `{"threadId":"<uuid>","idempotent":false,"linkedTaskCount":5,"missingFields":[]}`.
2. New or reused `threads` row with:
   - `channel = 'webhook'`
   - `space_id` pointing at the seeded Customer Onboarding Space
   - `metadata->'customerOnboarding'->>'opportunityId' = 'smoke-opp-0001'`
3. `linked_tasks` rows exist for the Space checklist. If LastMile Tasks is not fully configured yet, the rows should have `sync_status = 'error'` and a provider error in metadata rather than failing the webhook path.
4. The coordinator agent receives a wakeup request when the Space has an active coordinator assignment.

**Verify with:**

```sql
SELECT id, identifier, title, space_id, metadata
FROM threads
WHERE tenant_id = '<tenant-id>'
  AND metadata->'customerOnboarding'->>'opportunityId' = 'smoke-opp-0001'
ORDER BY created_at DESC
LIMIT 5;

SELECT title, status, sync_status, external_task_id, external_task_url
FROM linked_tasks
WHERE tenant_id = '<tenant-id>' AND thread_id = '<thread-id>'
ORDER BY created_at;
```

Rerunning the same fixture should be idempotent:

```json
{ "threadId": "<same uuid>", "idempotent": true, "linkedTaskCount": 0 }
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
- `docs/plans/archived/2026-04-21-003-feat-composable-skills-with-learnings-plan.md` — Unit 8 spec.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — related operator-tooling gap this kit also backfills.
