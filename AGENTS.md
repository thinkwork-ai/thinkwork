# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository at a glance

Thinkwork is an AWS-native agent harness: a TypeScript monorepo plus a Pi AgentCore runtime, deployed by the repo's own CLI via Terraform. There is **no local-only mode** — end-to-end work requires a deployed AWS stack. "Thinkwork supersedes maniflow" — ignore the old `maniflow*` names you may see on stale resources.

- `apps/web` — React 19 + Vite + TanStack Router unified web/operator app (dev port **5174** by default; **5180** is the Cognito callback-friendly worktree port)
- `apps/mobile` — Expo + React Native + NativeWind (iOS via TestFlight)
- `apps/cli` — `thinkwork-cli` (commander.js), published to npm, bundles Terraform modules
- `packages/database-pg` — Drizzle schema + migrations + canonical GraphQL source (`graphql/types/*.graphql`)
- `packages/api` — GraphQL (Yoga) resolvers, Lambda handlers, AppSync subscription bridge
- `packages/lambda` — additional Lambda handlers (job-schedule-manager, job-trigger, agentcore-admin, github-workspace)
- `packages/agentcore-pi` — active AgentCore Pi runtime (Bedrock models, MCP tools, Docker image)
- `packages/agentcore` — tenant-router + auth-agent (separate AgentCore image)
- Tenant S3 skill catalogs — per-tenant folders at `tenants/<tenant-slug>/skill-catalog/<skill-slug>/`; installed skills materialize into workspace `skills/<slug>/` folders
- `packages/system-workspace` — canonical workspace defaults (CAPABILITIES/GUARDRAILS/PLATFORM/MEMORY_GUIDE)
- `terraform/modules/{foundation,data,app,thinkwork}` — three-tier Terraform Registry modules (`thinkwork-ai/thinkwork/aws`)
- `docs/` — Astro Starlight docs site; also holds `plans/`, `brainstorms/`, and `solutions/`; `docs/solutions/` contains documented bugs, patterns, workflow issues, and decisions organized by category with YAML frontmatter (`module`, `problem_type`, `tags`), relevant when implementing or debugging in documented areas
- `CONCEPTS.md` — shared domain vocabulary (entities, named processes, status concepts); relevant when orienting to the codebase or discussing domain terms

## Tooling ground rules

- **pnpm ≥ 9, Node ≥ 20. Never use `npm` inside this workspace** — scripts assume pnpm's workspace protocol. `npx` is fine for one-off CLI tools.
- **Python ≥ 3.11 with `uv`** only for remaining Python helpers/tests. Ruff is the linter (line-length 100, target `py311`). The active AgentCore runtime is TypeScript under `packages/agentcore-pi`.
- **Terraform ≥ 1.5 (or OpenTofu ≥ 1.6)**. Modules are registry-shaped; most real changes happen under `terraform/modules/`.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- CI runs against Apache-2.0-licensed code; new contributors must sign the CLA on their first PR (CLA Assistant bot).

## Common commands

Run from the repo root unless noted.

### Install / formatting / type / lint (monorepo-wide)

```bash
pnpm install
pnpm -r --if-present build       # or: pnpm build
pnpm -r --if-present typecheck
pnpm -r --if-present lint
pnpm -r --if-present test
pnpm format        # prettier write
pnpm format:check  # prettier check
```

Per-workspace scripts are in each `package.json`. CLI's "lint" is a no-op stub — don't expect ESLint there.

### Running a single test

- **TypeScript (vitest)** — from a package dir: `npx vitest run path/to/file.test.ts` or `npx vitest run -t "test name"`. Suite locations vary: `packages/api` uses `src/**/*.test.ts` **and** `test/integration/**/*.test.ts`; `apps/cli` uses `__tests__/**/*.test.ts`.
- **Python (pytest)** — from repo root: `uv run --with pytest pytest packages/agentcore/agent-container/test_<name>.py::test_<case>` or the specific Python helper test path. `pyproject.toml` limits `testpaths` to `packages/`.

### Database / GraphQL schema

Canonical GraphQL lives under `packages/database-pg/graphql/types/*.graphql`. Two schemas are derived from it:

```bash
pnpm schema:build       # regenerates terraform/schema.graphql (AppSync subscription-only schema)
pnpm --filter @thinkwork/database-pg db:generate   # new Drizzle migration from schema changes
pnpm db:push -- --stage dev                         # push Drizzle schema to Aurora (resolves via terraform outputs + Secrets Manager)
pnpm db:migrate-manual                              # drift reporter for hand-rolled .sql files in drizzle/ that aren't in meta/_journal.json
```

Some `drizzle/*.sql` files are **hand-rolled** (partial indices, CHECK constraints, precise FK ordering) and not registered in `meta/_journal.json`. They're outside `db:push`'s scope — apply via `psql "$DATABASE_URL" -f <file>`. `pnpm db:migrate-manual` reports which of their declared objects are present in the target DB; every such file must declare `-- creates: public.X` (or `-- creates-column: public.T.C`) markers in its header so the reporter can check. The `deploy.yml` workflow runs the reporter as a gate after `terraform-apply` — missing objects fail the deploy so unapplied migrations can't ship silently. Background: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.

After editing GraphQL types, **regenerate codegen** in every consumer that has a `codegen` script: `apps/cli`, `apps/web`, `apps/mobile`, `packages/api`. Run `pnpm --filter @thinkwork/<name> codegen`.

### Lambda build

```bash
pnpm build:lambdas              # all handlers
bash scripts/build-lambdas.sh graphql-http   # single handler
```

Handlers bundle via esbuild to `dist/lambdas/<name>/index.mjs`. Most externalize `@aws-sdk/*`, but `graphql-http`, `memory-retain`, `eval-runner`, `wiki-compile`, and `wiki-bootstrap-import` inline newer Bedrock/AgentCore SDKs — see the `BUNDLED_AGENTCORE_ESBUILD_FLAGS` list in `scripts/build-lambdas.sh` before adding a handler that needs those clients. **Prefer shipping GraphQL Lambda changes through a PR to `main`** rather than `aws lambda update-function-code` — the merge pipeline deploys.

### Deploy / operate

```bash
cd apps/cli && pnpm dev -- <cmd>   # run CLI locally against source
thinkwork doctor -s <stage>        # prereq check
thinkwork plan|deploy|bootstrap|destroy -s <stage>
thinkwork login --stage <stage>    # OAuth to the deployed Cognito pool
thinkwork me                       # identity + tenant sanity check
```

### Verification / review workflow

When a Linear issue is in scope, keep the Linear issue updated at every material
gate: requirements read, PR state, plan inspected, apply started, blocker found,
fix pushed, verification passed, teardown started, teardown verified, and final
evidence. If work is blocked or a required PR/artifact is unmerged, leave the
issue in Verification/Review and comment with the exact state.

For application-plugin verification, prove the user-facing ThinkWork install
path. Do not substitute a local Docker Compose run, a vendor cloud login, or a
manual Terraform-only shortcut for the plugin install flow. Use the deployed
ThinkWork app/runner to install, inspect the generated deployment evidence, then
verify the deployed application and its MCP integration through a ThinkWork
agent. Teardown must also go through the ThinkWork managed-application flow, and
verification is not complete until teardown is observed.

### Plane application plugin

Plane is self-hosted by ThinkWork. Do not use Plane Cloud, and do not run Plane
locally for THNK-27 verification. The accepted install target is the deployed
ThinkWork environment provisioning Plane into AWS through the application-plugin
runner.

Plane's v1 topology is intentionally compact, but Plane AIO is not
dependency-free. The only accepted runtime shape is one ECS service and one ECS
task definition containing these containers:

- `plane-app` for the Plane all-in-one runtime
- `plane-mcp` for the separate ThinkWork MCP server
- `plane-redis` as a task-local loopback Redis sidecar
- `plane-rabbitmq` as a task-local loopback RabbitMQ sidecar

Do not add per-service Plane ECS services. Do not add Amazon MQ/RabbitMQ,
ElastiCache/Redis/Valkey, Elasticsearch/OpenSearch, or any other separately
managed Plane runtime dependency speculatively. `REDIS_URL` and `AMQP_URL` must
stay on the Plane AIO container and point to the task-local sidecars by default.
If runtime evidence proves the compact task-local shape cannot work, a managed
dependency is allowed as an explicit exception: first comment on the Linear
issue with the evidence, rationale, resource impact, and revised plan, then
inspect the Terraform plan before applying. If a Plane plan includes
`aws_mq_broker`, `aws_elasticache_*`, `aws_opensearch*`, separately managed
Redis/RabbitMQ/Valkey resources, or more than one Plane ECS service without that
evidence trail, stop before apply and fix the module first.

### Web dev server

```bash
pnpm --filter @thinkwork/web dev     # port 5174 by default
```

When running the web dev server from a worktree, first copy the ignored env file from the main checkout:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/web/.env apps/web/.env
```

Do this before opening the browser for local verification; without it the web shell may load but tenant/API-backed pages such as Threads will sit on loading placeholders.

Concurrent web Vite instances (worktrees) must bind to a Cognito-allowlisted port such as 5180. **Each port must be listed in the Cognito web app client CallbackURLs** (the app client may still be legacy-named `ThinkworkAdmin`) or Google OAuth fails with a generic-looking `redirect_mismatch` page — add the new port in Terraform/Cognito before starting the second server.

### Mobile dev server

When running the mobile app from a worktree, first copy the ignored env file from the main checkout:

```bash
cp /Users/ericodom/Projects/thinkwork/apps/mobile/.env apps/mobile/.env
```

Do this before starting Expo or mobile web verification; otherwise API/auth-backed mobile screens may load with missing deployed-stage configuration.

Expo resolves the workspace `@thinkwork/react-native-sdk` package through `apps/mobile/node_modules`, whose `package.json` points at `dist/index.js`. In a fresh worktree, build it before mobile verification:

```bash
pnpm --filter @thinkwork/react-native-sdk build
```

If Expo reports that `@thinkwork/react-native-sdk/dist/index.js` is missing, this is the fix.

## Architecture: the end-to-end data flow

1. **Clients** — React web/operator app + Expo mobile + CLI. All three auth through **Cognito** (Google OAuth federation supported; Eric signs in via Google, not a password — session-restore must go through the OAuth refresh-token path, not `restoreWithCredentials`).
2. **Edge** — AppSync (subscriptions) + HTTP API Gateway fronting `graphql-http` Lambda. The AppSync schema is _subscription-only_ and is generated from the same GraphQL source as the HTTP API by `scripts/schema-build.sh`.
3. **GraphQL server** — Yoga in `packages/api/src/graphql`. `ctx.auth.tenantId` is **null for Google-federated users** until the Cognito pre-token trigger lands; resolvers must use `resolveCallerTenantId(ctx)` as a fallback.
4. **Persistence** — Aurora Postgres via Drizzle (`packages/database-pg`). Schema changes flow: edit `src/schema/*` → `db:generate` → PR the new `drizzle/NNNN_*.sql` → `db:push` after deploy.
5. **Agent runtime** — Bedrock AgentCore hosts the **Pi** runtime (`packages/agentcore-pi`). The runtime loads installed skills from materialized workspace `skills/<slug>/` folders and keeps tenant catalog source files in S3 under `tenants/<tenant-slug>/skill-catalog/<skill-slug>/`; MCP tool servers use streamable HTTP. Memory engine is either **AgentCore managed** or **Hindsight**, selected in Terraform by `enable_hindsight` / `memory_engine`.
6. **Scheduling / background work** — `scheduled_jobs` rows → `job-schedule-manager` Lambda → AWS Scheduler (`rate()` is _creation-time + interval_, not wall-clock) → `job-trigger` Lambda → agent wakeups. User-initiated create/update Lambda invokes must use **`RequestResponse`** and surface errors — never fire-and-forget.
7. **Connectors** — Slack, GitHub, Google Workspace. Per-user OAuth and MCP tokens live on the **mobile** client; tenant-wide infra config stays in operator-only Settings surfaces in `apps/web` (don't add end-user-facing toggles to general user flows).
8. **Evaluations** — AWS Bedrock AgentCore Evaluations is the backing store (16 built-in evaluators); the UI adds test-case authoring on top. Don't reintroduce Mastra/promptfoo.
9. **Compounding Memory (Wiki)** — `wiki-compile` Lambda distills scattered memories into Entity/Topic/Decision pages; web + mobile both render the graph. `thinkwork wiki {compile,rebuild,status}` are operator-only CLI entry points.

## PR / branch workflow

- **PRs target `main`, never another PR's branch.** Squash-merge + branch deletion orphans stacked PRs — rebase onto main instead.
- **Use worktrees for parallel work** — never branch/stash in the main checkout when other sessions may have in-flight work. Create under `.Codex/worktrees/<name>` off `origin/main`. After a worktree's PR merges, remove the worktree **and** delete the branch without being asked.
- Before patching uncommitted main-tree changes forward, **`git fetch` then diff each file against `origin/main`** — another session may have already merged it.
- Pre-commit checks run `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; fix real failures rather than bypassing hooks.

## Secrets + config

- Stage config lives in `~/.thinkwork/config.json` (per-stage sessions + Cognito token cache) and in `terraform/examples/greenfield/terraform.tfvars` (currently plaintext; SSM migration pending — don't paste tfvars secrets into PRs).
- Deployed stack secrets live in Secrets Manager / SSM Parameter Store under `/thinkwork/<stage>/...`. The Pi runtime resolves runtime secrets from the deployed handler environment and SSM/Secrets Manager wiring.
- **Never commit** `terraform.tfvars`, `.env`, or Cognito/GitHub App secrets.

## Scope guardrails

- This is an **AWS-only** platform. Feature work that assumes Kubernetes, Docker Compose, GCP, or Azure is explicitly out of scope (`CONTRIBUTING.md`).
- Plane-specific deployment rules live above in **Plane application plugin**. Treat them as stop-the-line verification gates, not preferences.
- Size for enterprise scale — planning docs should assume on the order of **4 enterprises × 100+ agents × ~5 templates** (400+ agents); "n=4 simplification" reasoning is obsolete.
- Prefer AWS-native services (AgentCore, Cognito, Bedrock) when comparable to SaaS alternatives; frame external SaaS as contingency, not default.
