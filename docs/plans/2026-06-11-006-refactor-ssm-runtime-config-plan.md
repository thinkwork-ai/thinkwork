---
title: "refactor: SSM runtime-config — retire the Lambda env ceiling"
type: refactor
status: active
date: 2026-06-11
origin: "#2375 / #2377 / #2378 / #2379 — the 2026-06-11 quota-ceiling incident chain"
---

# refactor: SSM runtime-config — retire the Lambda env ceiling

## Summary

Move all non-identity configuration out of Lambda environment variables into a single
terraform-owned SSM parameter per stage (`/thinkwork/<stage>/runtime-config`, one JSON
document), read once per container through the AWS Parameters and Secrets Lambda
Extension and exposed to code via accessor functions with an env-wins override layer.
Secrets leave plaintext env entirely (Secrets Manager via the same extension). Lambda
env shrinks from ~60 keys to a handful of identity values, and the 4KB ceiling stops
being a class of production incident. The same effort consolidates the api role's
inline IAM policies into grouped managed policies — the same disease one quota over.

---

## Problem Frame

`graphql-http` carries a `common_env` shared by ~50 handlers plus per-function extras.
On 2026-06-11 it measured **4068–4073 of Lambda's hard 4096-byte limit** on dev and
**4207 attempted** on TEI:

- The canary.171 customer deploy **failed outright** when the deployment-controller
  wiring added +138 bytes (#2375). Any release that grows the env breaks every
  customer update.
- Dev silently ran **without** `DEPLOYMENT_EVIDENCE_BUCKET` /
  `DEPLOYMENT_STATE_MACHINE_ARN` (they didn't fit), which is why web and desktop
  showed "unknown" for the deployed release.
- The emergency fix (#2377) was the **third** dedupe scar in `handlers.tf` — the
  APP_URL/WEB_URL comment and the `KESTRA = "1|0"` compact encoding are earlier
  rounds of the same fight. Dedupe buys bytes; it does not remove the ceiling.
  Post-diet headroom on dev is ~194 bytes — a few additions from the next incident.
- The sibling quota fired the **same day**: the api lambda role's inline policies sit
  at IAM's 10,240-byte aggregate cap (#2378 failed the dev apply; #2379 shipped the
  workaround as a managed policy).
- `DATABASE_URL` embeds the Aurora master password in plaintext env, visible in every
  console view and CodeBuild log.

The root pathology is shared: a single flat resource (env map, role inline-policy set)
that every feature appends to, with a hard AWS quota nobody watches until an apply
fails in a customer account.

---

## Requirements

- R1. Lambda env carries **identity only**: `STAGE`, `AWS_ACCOUNT_ID`, `NODE_OPTIONS`,
  `FUNCTION_NAME`, and the per-function extras that gate handler behavior. Target
  ≤ 1KB serialized for every handler.
- R2. All other config lives in **one terraform-owned SSM parameter per stage**:
  `/thinkwork/<stage>/runtime-config`, JSON, written from the same locals that build
  `common_env` today. Advanced tier (8KB); terraform `validation` fails the plan if the
  rendered JSON exceeds 7KB so growth surfaces at plan time, not at runtime.
- R3. Code reads config through **accessor functions** (never module-load
  `const X = process.env.Y` captures — the vitest env-timing rule already requires
  this). Resolution order: `process.env` override → cached SSM document → default.
  Env-wins keeps tests, local dev, and emergency operational overrides working.
- R4. **Secrets never appear in plaintext env or in the SSM String document.**
  `API_AUTH_SECRET`, the Aurora password (today inside `DATABASE_URL`), and
  `APPSYNC_API_KEY` resolve from Secrets Manager at cold start. ARNs are derived by
  convention, not configured.
- R5. Reads go through the **AWS Parameters and Secrets Lambda Extension**
  (localhost:2773, container-lifetime cache with TTL), with a plain SDK fallback when
  the extension is absent (local dev, vitest). Cold-start budget: ≤ 100ms added,
  amortized to ~0 across a container's lifetime.
- R6. Works identically on **both deploy paths**: the SSM parameter and extension layer
  are provisioned inside `terraform/modules/app/lambda-api`, so dev (GHA root) and
  customer environments (controller runner) get them from the same apply with no
  runner changes.
- R7. **Derive-by-convention beats configuration**: anything shaped
  `thinkwork-<stage>-api-<name>` (the seven remaining `*_FUNCTION_NAME` vars,
  cross-function ARNs) is computed from `STAGE`/`AWS_ACCOUNT_ID`/`AWS_REGION`, not
  stored anywhere. (#2377 established the pattern with `CHAT_AGENT_INVOKE_FN_ARN`.)
- R8. **No flag-day**: every migrated reader keeps its env fallback until the final
  unit removes the env keys, so mixed deploy order (code before terraform, or a
  customer environment one release behind) never breaks. Customer environments need
  the standard two-release transition (release N ships loader + param; release N+1
  may drop env keys).
- R9. IAM: the api role's inline policies consolidate into **grouped managed
  policies** (data-plane, invoke/orchestration, ai/bedrock, observability). Standing
  rule going forward (already proven by #2379): new grants are managed policies, never
  inline.
- R10. A **fixture test guards the ceiling**: apps/cli terraform fixtures assert the
  rendered `common_env` keyset stays within the identity allowlist, so a PR that adds
  an env key fails CI with an explanation instead of failing a customer apply.

---

## Key Technical Decisions

- **SSM Parameter Store over AppConfig.** AppConfig adds deployment strategies,
  validators, and a session protocol we don't need for static per-stage config; SSM is
  already load-bearing in this stack (runner outputs, controller profile, agentcore
  runtime ids) and the extension caches both identically. AppConfig remains the right
  tool if we later want runtime-mutable flags — out of scope here.
- **One advanced-tier parameter, not many standard ones.** Standard tier (4KB) would
  rebuild the exact ceiling we're escaping. One 8KB advanced parameter costs ~$0.05/mo
  per stage; the 7KB terraform validation leaves visible headroom. Split by concern
  only if validation ever trips — that decision is deferred deliberately.
- **Extension layer with SDK fallback, not Powertools.** The Parameters and Secrets
  Extension is an AWS-managed layer (per-region ARN, pinned version in terraform),
  gives an HTTP cache shared across handlers in the container, and needs no new npm
  dependency in the bundle. The loader hits `http://localhost:2773` when
  `AWS_SESSION_TOKEN` + the extension port are present, else falls back to one
  `GetParameter`/`GetSecretValue` SDK call (local dev, tests, the rare layer outage).
- **A tiny shared package, `@thinkwork/runtime-config`.** Both `packages/api` and
  `packages/lambda` need the loader; neither should import the other. The package is
  dependency-light (extension HTTP + `@aws-sdk/client-ssm` fallback) and exports
  `getConfig(key)` / `getSecret(name)` accessors plus a `primeRuntimeConfig()` for
  cold-start warming. esbuild bundles it like any workspace dep — no
  `BUNDLED_AGENTCORE_ESBUILD_FLAGS` interaction.
- **Env-wins merge order.** `process.env.X` (if set) always beats the SSM document.
  This preserves vitest setups that stub env, lets operators hot-patch a single
  function in an incident, and makes the migration mechanical: a reader switched to
  `getConfig("X")` behaves identically wherever the env key still exists.
- **DATABASE_URL is rebuilt at cold start, not stored.** `db.ts` composes the URL from
  `DATABASE_HOST`/`DATABASE_NAME` (config) plus credentials fetched from the existing
  `thinkwork-<stage>-db-credentials` secret (derived name). The plaintext password
  leaves env, CodeBuild logs, and console views. Connection setup already dominates
  cold start; one cached secret fetch is noise.
- **The terraform locals stay the source of truth.** `handlers.tf`'s `common_env`
  splits into `identity_env` (stays on functions) and `runtime_config` (becomes the
  SSM document body). No values move out of terraform — only out of the function
  definition. The runner, `redacted-terraform-vars` evidence, and drift detection are
  unaffected.

---

## High-Level Technical Design

```
                     terraform (modules/app/lambda-api)
                       ├─ identity_env  ──────────────► Lambda env (~6 keys)
                       ├─ runtime_config (JSON) ──────► SSM /thinkwork/<stage>/runtime-config
                       └─ extension layer + managed policy (ssm:GetParameter, secrets read)

  handler cold start
    └─ primeRuntimeConfig()
         ├─ extension present?  GET localhost:2773/systemsmanager/...   (cached, TTL 5m)
         │                      GET localhost:2773/secretsmanager/...
         └─ else                SDK GetParameter / GetSecretValue (one-shot, cached)

  read sites
    └─ getConfig("APPSYNC_ENDPOINT")  =  process.env.APPSYNC_ENDPOINT ?? ssmDoc.APPSYNC_ENDPOINT ?? default
       getSecret("api-auth")          =  Secrets Manager (never env)
       deriveFunctionName("email-send") = `thinkwork-${STAGE}-api-email-send`   (no storage at all)
```

Disposition of today's ~60 `common_env` keys:

| Class                | Examples                                                                                | Destination            |
| -------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
| Identity (stays env) | `STAGE`, `AWS_ACCOUNT_ID`, `NODE_OPTIONS`, `FUNCTION_NAME`                              | Lambda env             |
| Config               | `APPSYNC_ENDPOINT`, `COGNITO_*`, `*_URL`, `MEMORY_ENGINE`, `DEPLOYMENT_*`, bucket names | SSM runtime-config     |
| Secrets              | `API_AUTH_SECRET`, Aurora password (via `DATABASE_URL`), `APPSYNC_API_KEY`              | Secrets Manager        |
| Derivable (deleted)  | `*_FUNCTION_NAME` (7), `WORKSPACE_RENDERER_FUNCTION_NAME`, cross-function ARNs          | computed from identity |

---

## Implementation Units

### U1. `@thinkwork/runtime-config` loader

New workspace package: extension-HTTP client with SDK fallback, container-lifetime
cache with TTL, env-wins merge, `getConfig`/`getSecret`/`deriveFunctionName`/
`primeRuntimeConfig` exports. Vitest coverage: merge order, cache behavior, fallback
selection, missing-document degradation (returns env/defaults, logs once). Ships
inert — nothing imports it yet (ship-inert convention).

### U2. Terraform: parameter, layer, IAM

`aws_ssm_parameter` (advanced tier, 7KB validation) rendered from the new
`runtime_config` local; Parameters-and-Secrets extension layer added to api handler
functions; one managed policy for `ssm:GetParameter` on the param path +
`secretsmanager:GetSecretValue` on the stage's derived secret names. `common_env`
unchanged this unit — the document coexists with env (R8).

### U3. Migrate `packages/api` readers

Mechanical sweep: `process.env.X` → `getConfig("X")` for config-class keys (env
fallback is inherent in the merge order). Module-load captures become function-scope
reads (R3). `db.ts` gains the rebuild-from-secret path behind `DATABASE_URL`-absent
detection. Full api suite green.

### U4. Migrate `packages/lambda` handlers

Same sweep for the standalone handlers (job-schedule-manager, job-trigger,
compliance-\*, admin-ops-mcp, kestra-control-mcp). Full suite green.

### U5. Secrets out of env

`API_AUTH_SECRET`/`APPSYNC_API_KEY` readers move to `getSecret()`; terraform stops
injecting them once both packages read from Secrets Manager;
`DATABASE_URL` dropped from env after `db.ts` rebuild path soaks one release on dev.
The 14-file `THINKWORK_API_SECRET ||` fallback chains from #2377 collapse to one
accessor.

### U6. Shrink env + guardrails

`common_env` reduced to `identity_env`; derivable `*_FUNCTION_NAME` keys deleted with
`deriveFunctionName` call sites; apps/cli fixture test asserts the identity-allowlist
keyset (R10); inline IAM policies consolidated into grouped managed policies (R9).
Customer environments get the change as a normal release; env fallbacks for the
removed keys stay in code for one further release, then are deleted.

---

## Acceptance Examples

- A new feature needs a config value: it adds one key to the `runtime_config` local.
  No env growth, no apply risk, no fixture-test change. The 7KB plan-time validation
  is the only ceiling, with 4KB+ of headroom.
- `aws lambda get-function-configuration` on graphql-http shows < 1KB of env on dev
  and customer stacks; no credential material appears in env, console, or CodeBuild
  logs.
- A vitest file stubs `process.env.APPSYNC_ENDPOINT` and the accessor returns the
  stub without any SSM/extension interaction.
- TEI controller deploy of the first post-U6 release succeeds with no runner changes,
  and `deploymentReleases`/status resolvers read identically through `getConfig`.

## Scope Boundaries

- **Not** AppConfig / feature flags / runtime-mutable config — static per-stage config
  only.
- **Not** per-handler IAM roles (least-privilege splitting is a separate effort; R9
  consolidates within the existing shared role).
- **Not** the Pi runtime container or agentcore packages — their config path
  (handler env + SSM wiring) is already separate and unaffected.
- **Not** mobile/desktop/web clients — `thinkwork-runtime-config.json` (the S3/CDN
  client config) is a different artifact that happens to share the name.

## System-Wide Impact

- Cold start: +1 extension init (~10ms) + one cached parameter/secret fetch per
  container. Hot path unchanged.
- Customer environments: standard two-release transition (R8); the ledger/self-update
  runner machinery from #2371/#2374 delivers it with no manual steps.
- Ops: single place to inspect effective config (`aws ssm get-parameter`), and
  env-wins gives a per-function escape hatch in incidents.
- The #2375-class incident (deploy fails on env growth) becomes structurally
  impossible; the residual ceiling (7KB validation) fails at plan time in CI instead.

## Risks & Dependencies

- **Extension layer pinning**: per-region AWS-managed layer ARN must be pinned and
  occasionally bumped; SDK fallback covers absence. Mitigation: version in one
  terraform local with a comment.
- **SSM throttling**: the extension cache makes steady-state QPS ≈ container churn;
  standard-tier GetParameter quotas are far above that. Advanced tier param adds
  per-call pricing — negligible at this scale.
- **Mixed-version windows**: covered by env fallbacks until the final removal unit;
  the only hard order is U2 (param exists) before U3/U4 readers ship — same-release
  is fine since readers fall back to env.
- **Param size creep**: 7KB plan-time validation + R10 fixture test. If the document
  ever needs to split, the loader's document-merge seam is the extension point.

## Sources / Research

- Incident chain: #2375 (4KB env ceiling, TEI canary.171 deploy failure), #2377
  (dedupe diet + projected sizes), #2378/#2379 (IAM inline 10,240B aggregate cap →
  managed-policy rule), `docs/solutions/`-grade detail in the PR bodies.
- Prior scars in `terraform/modules/app/lambda-api/handlers.tf`: APP_URL/WEB_URL
  dedupe comment, `KESTRA = "1|0"` compact encoding, `deployment-sessions` env note.
- AWS: Parameters and Secrets Lambda Extension (caching sidecar), SSM advanced-tier
  parameters (8KB), Lambda env quota (4KB, not raisable), IAM inline-policy aggregate
  quota (10,240B, not raisable).
