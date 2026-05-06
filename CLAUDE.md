# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository at a glance

Thinkwork is an AWS-native agent harness: a TypeScript monorepo plus a Python agent runtime, deployed by the repo's own CLI via Terraform. There is **no local-only mode** — end-to-end work requires a deployed AWS stack. "Thinkwork supersedes maniflow" — ignore the old `maniflow*` names you may see on stale resources.

- `apps/admin` — React 19 + Vite + TanStack Router operator SPA (dev port **5174**)
- `apps/mobile` — Expo + React Native + NativeWind (iOS via TestFlight)
- `apps/cli` — `thinkwork-cli` (commander.js), published to npm, bundles Terraform modules
- `packages/database-pg` — Drizzle schema + migrations + canonical GraphQL source (`graphql/types/*.graphql`)
- `packages/api` — GraphQL (Yoga) resolvers, Lambda handlers, AppSync subscription bridge
- `packages/lambda` — additional Lambda handlers (job-schedule-manager, job-trigger, agentcore-admin, github-workspace)
- `packages/agentcore-strands/agent-container` — **Python** Strands runtime (Bedrock models, MCP tools, Docker image)
- `packages/agentcore` — tenant-router + auth-agent (separate AgentCore image)
- `packages/skill-catalog` — script-based skills loaded by the Strands runtime
- `packages/system-workspace` — canonical workspace defaults (CAPABILITIES/GUARDRAILS/PLATFORM/MEMORY_GUIDE)
- `terraform/modules/{foundation,data,app,thinkwork}` — three-tier Terraform Registry modules (`thinkwork-ai/thinkwork/aws`)
- `docs/` — Astro Starlight docs site; also holds `plans/`, `brainstorms/`, `solutions/` — prior-session institutional knowledge worth grepping before starting non-trivial work

## Tooling ground rules

- **pnpm ≥ 9, Node ≥ 20. Never use `npm` inside this workspace** — scripts assume pnpm's workspace protocol. `npx` is fine for one-off CLI tools.
- **Python ≥ 3.11 with `uv`** for the Strands runtime (`pyproject.toml` declares `packages/agentcore-strands` as a uv workspace member). Ruff is the linter (line-length 100, target `py311`).
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
- **Python (pytest)** — from repo root: `uv run pytest packages/agentcore-strands/agent-container/test_<name>.py::test_<case>`. `pyproject.toml` limits `testpaths` to `packages/`.

### Database / GraphQL schema

Canonical GraphQL lives under `packages/database-pg/graphql/types/*.graphql`. Two schemas are derived from it:

```bash
pnpm schema:build       # regenerates terraform/schema.graphql (AppSync subscription-only schema)
pnpm --filter @thinkwork/database-pg db:generate   # new Drizzle migration from schema changes
pnpm db:push -- --stage dev                         # push Drizzle schema to Aurora (resolves via terraform outputs + Secrets Manager)
pnpm db:migrate-manual                              # drift reporter for hand-rolled .sql files in drizzle/ that aren't in meta/_journal.json
```

Some `drizzle/*.sql` files are **hand-rolled** (partial indices, CHECK constraints, precise FK ordering) and not registered in `meta/_journal.json`. They're outside `db:push`'s scope — apply via `psql "$DATABASE_URL" -f <file>`. `pnpm db:migrate-manual` reports which of their declared objects are present in the target DB; every such file must declare `-- creates: public.X` (or `-- creates-column: public.T.C`) markers in its header so the reporter can check. The `deploy.yml` workflow runs the reporter as a gate after `terraform-apply` — missing objects fail the deploy so unapplied migrations can't ship silently. Background: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.

After editing GraphQL types, **regenerate codegen** in every consumer that has a `codegen` script: `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api`. Run `pnpm --filter @thinkwork/<name> codegen`.

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

### Admin dev server

```bash
pnpm --filter @thinkwork/admin dev     # port 5174 by default
```

Concurrent admin vite instances (worktrees) must bind to 5175+. **Each port must be listed in the Cognito `ThinkworkAdmin` CallbackURLs** or Google OAuth fails with a generic-looking `redirect_mismatch` page — add the new port in Terraform/Cognito before starting the second server.

## Architecture: the end-to-end data flow

1. **Clients** — React admin + Expo mobile + CLI. All three auth through **Cognito** (Google OAuth federation supported; Eric signs in via Google, not a password — session-restore must go through the OAuth refresh-token path, not `restoreWithCredentials`).
2. **Edge** — AppSync (subscriptions) + HTTP API Gateway fronting `graphql-http` Lambda. The AppSync schema is *subscription-only* and is generated from the same GraphQL source as the HTTP API by `scripts/schema-build.sh`.
3. **GraphQL server** — Yoga in `packages/api/src/graphql`. `ctx.auth.tenantId` is **null for Google-federated users** until the Cognito pre-token trigger lands; resolvers must use `resolveCallerTenantId(ctx)` as a fallback.
4. **Persistence** — Aurora Postgres via Drizzle (`packages/database-pg`). Schema changes flow: edit `src/schema/*` → `db:generate` → PR the new `drizzle/NNNN_*.sql` → `db:push` after deploy. `agent_skills` is **derived** from composed AGENTS.md routing rows: `packages/api/src/lib/derive-agent-skills.ts` runs on every `AGENTS.md` put inside `packages/api/workspace-files.ts`. The legacy `setAgentSkills` GraphQL mutation continues to work but logs a deprecation warning — Plan §008 U21 retires it.
5. **Agent runtime** — Bedrock AgentCore hosts the **Strands** Python container (`packages/agentcore-strands/agent-container/server.py`). The runtime loads skills from `packages/skill-catalog` (script-based) and MCP tool servers (streamable HTTP). Memory engine is either **AgentCore managed** or **Hindsight**, selected in Terraform by `enable_hindsight` / `memory_engine`. Hindsight's `recall`/`reflect` tool wrappers must stay `async def` (with `arecall`/`areflect`, fresh client, `aclose`, retry) — see `feedback_hindsight_async_tools`.
6. **Scheduling / background work** — `scheduled_jobs` rows → `job-schedule-manager` Lambda → AWS Scheduler (`rate()` is *creation-time + interval*, not wall-clock) → `job-trigger` Lambda → agent wakeups. User-initiated create/update Lambda invokes must use **`RequestResponse`** and surface errors — never fire-and-forget.
7. **Connectors** — Slack, GitHub, Google Workspace. Per-user OAuth and MCP tokens live on the **mobile** client; tenant-wide infra config stays in admin (don't add end-user-facing toggles to the admin SPA).
8. **Evaluations** — AWS Bedrock AgentCore Evaluations is the backing store (16 built-in evaluators); the UI adds test-case authoring on top. Don't reintroduce Mastra/promptfoo.
9. **Compounding Memory (Wiki)** — `wiki-compile` Lambda distills scattered memories into Entity/Topic/Decision pages; admin + mobile both render the graph. `thinkwork wiki {compile,rebuild,status}` are admin-only CLI entry points.

## PR / branch workflow

- **PRs target `main`, never another PR's branch.** Squash-merge + branch deletion orphans stacked PRs — rebase onto main instead.
- **Use worktrees for parallel work** — never branch/stash in the main checkout when other sessions may have in-flight work. Create under `.claude/worktrees/<name>` off `origin/main`. After a worktree's PR merges, remove the worktree **and** delete the branch without being asked.
- Before patching uncommitted main-tree changes forward, **`git fetch` then diff each file against `origin/main`** — another session may have already merged it.
- Pre-commit checks run `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; fix real failures rather than bypassing hooks.

## Secrets + config

- Stage config lives in `~/.thinkwork/config.json` (per-stage sessions + Cognito token cache) and in `terraform/examples/greenfield/terraform.tfvars` (currently plaintext; SSM migration pending — don't paste tfvars secrets into PRs).
- Deployed stack secrets live in Secrets Manager / SSM Parameter Store under `/thinkwork/<stage>/...`. The Strands runtime resolves Nova Act and similar keys from there at boot (see `_load_nova_act_key` in `server.py`).
- **Never commit** `terraform.tfvars`, `.env`, or Cognito/GitHub App secrets.

## Scope guardrails

- This is an **AWS-only** platform. Feature work that assumes Kubernetes, Docker Compose, GCP, or Azure is explicitly out of scope (`CONTRIBUTING.md`).
- Size for enterprise scale — planning docs should assume on the order of **4 enterprises × 100+ agents × ~5 templates** (400+ agents); "n=4 simplification" reasoning is obsolete.
- Prefer AWS-native services (AgentCore, Cognito, Bedrock) when comparable to SaaS alternatives; frame external SaaS as contingency, not default.
