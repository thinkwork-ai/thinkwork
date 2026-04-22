# AgentCore Code Sandbox — end-to-end test harness

Lives in `packages/api/test/integration/sandbox/`. Validates the 13-unit
sandbox substrate (`docs/plans/2026-04-22-006-feat-agentcore-code-sandbox-plan.md`)
against a live stage — creates a disposable tenant, runs the pilot demo,
asserts every signal from the operator runbook (`docs/guides/sandbox-environments.md`),
tears down.

These tests **do not run in default CI** because they hit live infra. Run
them deliberately after a deploy.

## Run

```
pnpm --filter @thinkwork/api sandbox:e2e
```

One-off scenario:

```
pnpm --filter @thinkwork/api sandbox:e2e -- sandbox-pilot
pnpm --filter @thinkwork/api sandbox:e2e -- sandbox-cap-breach
pnpm --filter @thinkwork/api sandbox:e2e -- sandbox-cross-tenant
```

Cleanup stale `sandbox-e2e-*` fixtures from aborted prior runs:

```
pnpm --filter @thinkwork/api sandbox:e2e -- --cleanup-only
```

## Required env

All pulled from terraform outputs on the target stage (`thinkwork me`
prints most of them). Typically sourced from `.env.sandbox-e2e` or the
operator's shell before invoking.

| Variable | What |
|---|---|
| `THINKWORK_API_URL` | HTTP API Gateway base URL (e.g. `https://abc123.execute-api.us-east-1.amazonaws.com`) |
| `API_AUTH_SECRET` | Service-endpoint Bearer; same value the Strands container and admin surfaces use |
| `DATABASE_URL` | Postgres connection string with `sslmode=require` — the harness reads `sandbox_invocations` + `tenants` directly for assertions |
| `AWS_REGION` | `us-east-1` |
| `STAGE` | `dev` / `prod` / etc. — used in SM path namespacing |
| `AGENTCORE_RUNTIME_LOG_GROUP` | e.g. `/aws/bedrock-agentcore/runtimes/thinkwork-dev-xxxxx` — token-leak assertion greps this |
| `THINKWORK_E2E_OPERATOR_EMAIL` | Must appear in `THINKWORK_PLATFORM_OPERATOR_EMAILS` on the deployed `graphql-http` Lambda so `updateTenantPolicy` succeeds |

AWS credentials come from the usual chain — the harness uses SDK defaults.

## What's tested

| File | Requirements covered |
|---|---|
| `sandbox-pilot.e2e.test.ts` | R1 (template self-serve), R2 (agent executes code), R3 (audit row), R5 (no token leak) |
| `sandbox-cap-breach.e2e.test.ts` | R6 (cost-cap circuit breaker) |
| `sandbox-cross-tenant.e2e.test.ts` | R4 (tenant isolation) |

Each test `beforeAll`-creates a `sandbox-e2e-{runId}` tenant, exercises
the scenario, then `afterAll`-deletes the tenant even on assertion
failure.

## Common failure modes

| Symptom | Runbook section |
|---|---|
| `SandboxProvisioning` error surfaces in the pilot response | `docs/guides/sandbox-environments.md` → "SandboxProvisioning" |
| `SandboxCapExceeded` on the first call in a non-cap-breach test | runbook "SandboxCapExceeded"; likely stale counters from a prior aborted run |
| `updateTenantPolicy` rejects the setup caller | Runner's email not in `THINKWORK_PLATFORM_OPERATOR_EMAILS` |
| Token-leak assertion fails with `ghp_*` match | **Regression in the Unit 4 sitecustomize wrapper.** Page platform security. |

## Deploy dependencies

The harness requires these to be deployed on the target stage:

- `sandbox_invocations`, `sandbox_tenant_daily_counters`, `sandbox_agent_hourly_counters`, `tenant_policy_events` tables (Unit 1, migration 0019)
- `sandbox-quota-check` + `sandbox-invocation-log` Lambdas (Units 10 + 11, PR #442)
- `agentcore-admin` Lambda **or** manual provisioning compensation (Unit 5 — see Unit 2 of this plan for the fallback path)
- Sandbox base image pushed to ECR (Unit 4 — optional; without it the default AgentCore image is used but the stdio redactor won't run → token-leak test will fail)
- `/api/sandbox/quota/check-and-increment` and `/api/sandbox/invocations` routes present in API Gateway

If any is missing, the harness fails setup with a clear diagnostic.
