---
title: "Branch deploys to the continuous-CD dev stage are ephemeral — validate post-merge"
date: 2026-06-14
category: workflow-issues
module: deploy
problem_type: workflow_issue
component: development_workflow
severity: high
applies_when:
  - "Validating an unmerged feature branch against the shared AWS dev stage"
  - "A branch deploy via gh workflow run deploy.yml --ref <branch> reports green but behavior looks stale"
  - "New GraphQL query/mutation fields appear missing on dev after a deploy"
  - "Tempted to run a local thinkwork deploy -s dev to make a branch stick"
symptoms:
  - "Branch deploy looks successful: Terraform Apply green, graphql-http CodeSha256 matches the branch build"
  - "Minutes later the deployed GraphQL schema is stale, missing the branch's new query/mutation fields"
  - "New fields look missing when introspecting the AppSync subscription-only endpoint"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
related_components:
  - tooling
  - documentation
tags:
  - dev-stage
  - continuous-cd
  - branch-deploy
  - graphql-http
  - appsync
  - terraform-apply
  - validation
---

# Branch deploys to the continuous-CD dev stage are ephemeral — validate post-merge

## Context

The shared AWS `dev` stage is **continuously deployed from `main`**. `.github/workflows/deploy.yml` runs on `push: branches:[main]` with `STAGE: dev` and runs `terraform apply` (in `terraform/examples/greenfield`, terraform workspace `dev`), rebuilding **all** `dist/lambdas/*` from `main` HEAD on every push to main — which happens every few minutes.

A branch deploy via `gh workflow run deploy.yml --ref <branch>` does land, but the **next push to `main` reverts it**: terraform recomputes each function's `source_code_hash` from main's build and rolls `graphql-http` (and every other lambda) back to main's code. **Branch deploys to the shared dev stage are ephemeral.**

This bites hardest during GraphQL schema validation, where two separate endpoints carry two separate schemas:

- **Queries + mutations** live **only** on the HTTP API — `VITE_GRAPHQL_HTTP_URL` → the `graphql-http` Yoga Lambda. Wired in `apps/web/src/lib/graphql-client.ts`; the schema is assembled at runtime from the `.graphql` files in `packages/api/src/graphql/server.ts`.
- **Subscriptions** live on AppSync — `VITE_GRAPHQL_URL`, whose schema is the subscription-only `terraform/schema.graphql`.

### Symptoms / timeline (so you recognize it)

- `gh workflow run deploy.yml --ref <branch>` → Terraform Apply **green**. `aws lambda get-function-configuration` for `thinkwork-dev-api-graphql-http` showed `CodeSha256` matching the **branch** build (`Su3c…`) at 12:49 — looked deployed.
- ~11 min later, introspecting the live dev HTTP GraphQL endpoint returned the **old** schema (~156 Query fields instead of the expected ~159; new fields `skillEvalScore` / `skillEvalGate` absent). `CodeSha256` had flipped to main's build (`b9X1…`) at 13:00.
- `gh run list --workflow=deploy.yml` showed main-push deploys at 12:22 / 12:48 / 12:55 / 13:06. The **12:48 main deploy's** terraform-apply (~13:00) reverted graphql-http to main's code.

The trap: a green deploy plus a point-in-time hash match read as "shipped," a second validator a few minutes later sees a stale schema, and the natural next move (a local `thinkwork deploy -s dev`) would corrupt the shared stage for everyone.

## Guidance

1. **Treat the shared `dev` stage as continuously deployed from `main`. A branch deploy to it is ephemeral.** For a stable signal, validate the live data path **post-merge**, after main's CD has settled on your code.

2. **Never run a local `thinkwork deploy -s dev` to validate a branch — it corrupts dev.** The canonical apply needs ~40 inputs that exist only as GitHub Actions secrets/vars (`db_password`, `api_auth_secret`, `google_oauth_client_id`/`secret`, the Cognee/Twenty image URIs + secret ARNs, `tenant_slugs`, domains, Stripe/AgentCore/MCP config). The local `terraform.tfvars` has only a handful, so a local apply runs with empty values → it blanks the OAuth secrets, disables Cognee/Twenty, and resets the tenant list. Deploy this stage **only via CI** (push-to-main, or `gh workflow run deploy.yml --ref <branch>` for an ephemeral branch deploy you understand to be ephemeral).

3. **For a controlled-window backend proof, transiently push just the function and probe it immediately** — knowing main's CD will auto-revert it. This is a deliberate, auto-reverted validation exception, **not a way to ship**:

   ```bash
   bash scripts/build-lambdas.sh graphql-http
   aws lambda update-function-code \
     --function-name thinkwork-<stage>-api-graphql-http \
     --zip-file fileb://dist/lambdas/graphql-http.zip
   ```

   The dev Cognito token in `~/.thinkwork/config.json` is usually expired — refresh it via the OAuth refresh-token grant:

   ```bash
   curl -s -X POST "<VITE_COGNITO_DOMAIN>/oauth2/token" \
     -d grant_type=refresh_token \
     -d client_id=<VITE_COGNITO_CLIENT_ID> \
     -d refresh_token=<sessions.dev.refreshToken from ~/.thinkwork/config.json>
   # → use the returned id_token below
   ```

   Then introspect/query the **HTTP API** with that token:

   ```bash
   curl -s "$VITE_GRAPHQL_HTTP_URL" \
     -H "Authorization: <id_token>" \
     -H 'content-type: application/json' \
     -d '{"query":"{ __schema { queryType { fields { name } } } }"}'
   ```

4. **Hash-verify the deployed function against your build — but treat the match as point-in-time on a CD stage:**

   ```bash
   aws lambda get-function-configuration \
     --function-name thinkwork-<stage>-api-graphql-http --query CodeSha256
   openssl dgst -sha256 -binary dist/lambdas/graphql-http.zip | openssl base64
   ```

   A match means your code is live **right now**; the next main push can revert it within minutes.

5. **For GraphQL field-presence checks on dev, introspect the HTTP API (`VITE_GRAPHQL_HTTP_URL`), not AppSync.** AppSync (`VITE_GRAPHQL_URL`) carries the subscription-only schema (`terraform/schema.graphql`); new query/mutation fields will legitimately appear "missing" there — that's expected, not a deploy failure.

**The standard ship rule still holds:** ship via CI (push-to-main, or `gh workflow run deploy.yml --ref <branch>` for a non-main stage you own), never via a manual `aws lambda update-function-code` or a local `thinkwork deploy`. Step 3 is a probe, not a deploy.

## Why This Matters

This pattern silently wastes hours. The failure mode is insidious because every individual signal looks like success: the deploy job is green, the `CodeSha256` matches your build, and the function genuinely runs your code — for about ten minutes. Then the next push to `main` (every few minutes) recomputes the source hash from main's build and reverts your function. A second validator, or you a few minutes later, introspects the endpoint and sees a stale schema, with no obvious cause and a green deploy in the history.

Worse, the instinctive recovery — "let me just deploy it properly with `thinkwork deploy -s dev`" — actively corrupts the shared stage for everyone, because the local apply runs with most of its ~40 required inputs empty, blanking OAuth secrets and disabling whole subsystems. Knowing that dev is CD-from-main, that branch deploys there are ephemeral, and that a local apply is destructive turns a multi-hour false-signal chase into a one-line decision: validate post-merge, or use the transient-probe-then-discard pattern with eyes open.

## When to Apply

- Validating a feature branch against the shared AWS `dev` stage **before merge**.
- A deploy is green and the lambda `CodeSha256` matches, but live behavior (schema, response) looks stale or inconsistent between checks.
- Two validators disagree about whether a change is "deployed" to dev.
- Checking GraphQL query/mutation field presence on a deployed stage.
- Tempted to run `thinkwork deploy -s <shared-stage>` locally, or `aws lambda update-function-code`, to make a branch "stick" on dev.

## Examples

**False signal — point-in-time hash match read as "deployed":**

```bash
gh workflow run deploy.yml --ref feat/skill-evals     # Terraform Apply: green
aws lambda get-function-configuration \
  --function-name thinkwork-dev-api-graphql-http --query CodeSha256
# → "Su3c…"  (matches branch build at 12:49 — looks shipped)

# ~11 min later, after the 12:48 main-push deploy's apply (~13:00):
aws lambda get-function-configuration \
  --function-name thinkwork-dev-api-graphql-http --query CodeSha256
# → "b9X1…"  (main's build — branch code reverted)
```

**Wrong endpoint — concluding query fields are "missing" by introspecting AppSync:**

```bash
# WRONG: VITE_GRAPHQL_URL is AppSync (subscription-only schema).
# New queries/mutations are SUPPOSED to be absent here.
curl -s "$VITE_GRAPHQL_URL" -H "Authorization: <token>" \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}'
# → 156 fields, skillEvalScore/skillEvalGate absent — a red herring

# RIGHT: queries/mutations live on the HTTP API.
curl -s "$VITE_GRAPHQL_HTTP_URL" -H "Authorization: <id_token>" \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}'
# → ~159 fields, including skillEvalScore/skillEvalGate
```

**Correct controlled-window backend proof (transient, auto-reverted):**

```bash
bash scripts/build-lambdas.sh graphql-http
aws lambda update-function-code \
  --function-name thinkwork-dev-api-graphql-http \
  --zip-file fileb://dist/lambdas/graphql-http.zip
# refresh dev token, then introspect HTTP API immediately:
curl -s "$VITE_GRAPHQL_HTTP_URL" -H "Authorization: <id_token>" \
  -d '{"query":"{ __schema { queryType { fields { name } } } }"}'
# probe NOW — the next main push reverts this function. Do not treat as shipped.
```

## Related

- [`env-gated-feature-dead-without-terraform-wiring.md`](./env-gated-feature-dead-without-terraform-wiring.md) — Same parent theme (a merged/green change isn't live until the deployed resource actually carries it); the validation-mechanics sibling of this doc.
- [`deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`](./deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md) — Green-on-dev while dev served stale state; pipeline vantage points all "lied." Shares the "validate against the actual deployed surface" rule.
- [`agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`](./agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md) — A pushed artifact lands but the running surface keeps serving the old one; "the artifact you pushed isn't necessarily what's running" rhymes with the non-durable `CodeSha256` point.

**Key files:** `.github/workflows/deploy.yml` (on: push main; `STAGE: dev`; the terraform-apply job + its ~40-var apply step), `terraform/examples/greenfield` (terraform workspace `dev`), `apps/web/src/lib/graphql-client.ts` (queries → `VITE_GRAPHQL_HTTP_URL`), `packages/api/src/graphql/server.ts` (HTTP schema assembled from `.graphql` files), `apps/web/.env` (`VITE_GRAPHQL_HTTP_URL` vs `VITE_GRAPHQL_URL`), `~/.thinkwork/config.json` (`sessions.dev.refreshToken`).
