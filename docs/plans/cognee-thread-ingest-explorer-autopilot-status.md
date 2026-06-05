# Cognee Thread Ingest Explorer Autopilot Status

Plan: `docs/plans/2026-06-04-003-feat-cognee-thread-ingest-explorer-plan.md`
Target branch: `main`
Started: 2026-06-04

## Current Status

- State: in_progress
- Current unit: U13 - Cognee system Python dependency install hotfix
- Current branch/worktree:
  `codex/cognee-bedrock-system-python` /
  `.Codex/worktrees/cognee-bedrock-system-python`
- Current PR: [#2090](https://github.com/thinkwork-ai/thinkwork/pull/2090)
- Blocker: none. U12 merged and its deploy proved the target site-packages
  approach is right, but Cognee's `PATH` resolves bare `python` to the no-pip
  venv interpreter. U13 calls `/usr/local/bin/python` explicitly while still
  installing `boto3` into the Cognee venv import path.

## Progress Log

- 2026-06-04: Read `AGENTS.md`, the referenced Phase II Cognee plan, and the
  related solution notes for ontology governance, graph filter stability, graph
  camera persistence, and deployed smoke validation.
- 2026-06-04: Selected U1 as the first implementation unit.
- 2026-06-04: Created isolated worktree
  `.Codex/worktrees/cognee-kg-u1-contract` on branch
  `codex/cognee-kg-u1-contract` from `origin/main`.
- 2026-06-04: Implemented U1 persistence and GraphQL contract with
  `knowledge_graph_ingest_runs`, `knowledge_graph_entities`,
  `knowledge_graph_relationships`, and `knowledge_graph_evidence`; added
  GraphQL SDL for Explorer read queries and manual ingest mutation shape;
  registered a Knowledge Graph resolver namespace; regenerated client code for
  CLI, admin, mobile, and Spaces.
- 2026-06-04: U1 local verification passed:
  `pnpm --filter @thinkwork/database-pg test`;
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/graphql-contract.test.ts src/__tests__/knowledge-graph-schema.test.ts`;
  `pnpm --filter @thinkwork/database-pg typecheck`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter thinkwork-cli typecheck`;
  `pnpm --filter @thinkwork/spaces typecheck`; and `git diff --check`.
- 2026-06-04: U1 focused review found a database hardening gap: child graph
  rows had tenant/thread columns but no raw-SQL guard proving referenced runs,
  entities, relationships, ontology definitions, and messages belonged to the
  same scope. Added migration trigger guards and test coverage for the
  invariant.
- 2026-06-04: Post-review U1 verification passed:
  `pnpm --filter @thinkwork/database-pg test`;
  `pnpm --filter @thinkwork/api test`;
  `pnpm --filter @thinkwork/database-pg typecheck`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter thinkwork-cli typecheck`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/admin build`; and `git diff --check`. Admin build
  completed with existing sourcemap/chunk-size warnings only.
- 2026-06-04: Opened U1 PR
  [#2077](https://github.com/thinkwork-ai/thinkwork/pull/2077).
- 2026-06-04: U1 PR
  [#2077](https://github.com/thinkwork-ai/thinkwork/pull/2077) initially
  failed CI `Migration Drift Precheck (dev)` because the new hand-rolled
  migration `0145_knowledge_graph_thread_ingest.sql` had not yet been applied
  to the dev database. Lint, typecheck, verify, and CLA were green while test
  was still pending.
- 2026-06-04: Applied only
  `packages/database-pg/drizzle/0145_knowledge_graph_thread_ingest.sql` to the
  dev Aurora database via `psql` using `sslmode=require`; first local attempt
  failed before mutation with missing AWS region, second applied successfully,
  and a follow-up `scripts/db-migrate-manual.sh` scoped to `0145` passed with
  every table, index, constraint, function, and trigger present.
- 2026-06-04: Rebasing U1 after main moved completed cleanly; all required CI
  checks passed on the fresh head. Squash-merged U1 PR
  [#2077](https://github.com/thinkwork-ai/thinkwork/pull/2077) into `main` at
  `a333f8f29a1383d1ca0b713a748cbf74195dacdb`, deleted the remote branch, then
  removed local U1 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U2 worktree
  `.Codex/worktrees/cognee-kg-u2-read-resolvers` on branch
  `codex/cognee-kg-u2-read-resolvers` from `origin/main`.
- 2026-06-04: Implemented U2 Knowledge Graph read resolvers for thread
  candidates, ingest runs, entity table reads, graph payloads, and entity
  details. Added shared tenant-operator auth, Cognito caller thread visibility,
  row serialization, search/status/type filters, and resolver tests for
  successful reads plus forbidden/cross-tenant behavior.
- 2026-06-04: U2 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-resolvers.test.ts src/__tests__/knowledge-graph-tenant-scoping.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`; `git diff --check`; and
  `pnpm --filter @thinkwork/api test` (398 files passed, 3 skipped; 3523 tests
  passed, 9 skipped). API lint is a no-op because `@thinkwork/api` has no
  `lint` script.
- 2026-06-04: Opened U2 PR
  [#2078](https://github.com/thinkwork-ai/thinkwork/pull/2078).
- 2026-06-04: U2 PR
  [#2078](https://github.com/thinkwork-ai/thinkwork/pull/2078) passed required
  CI and was squash-merged into `main` at
  `e77c4ea83ad83c95e8f8979692d65f6ce692ca6b`; deleted the remote branch and
  removed the local U2 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U3 worktree
  `.Codex/worktrees/cognee-kg-u3-ingest-enqueue` on branch
  `codex/cognee-kg-u3-ingest-enqueue` from `origin/main`.
- 2026-06-04: Implemented U3 manual ingest enqueue path: added the
  `startKnowledgeGraphThreadIngest` mutation resolver, durable queued-run
  creation/deduplication, RequestResponse Lambda invocation with failure
  marking, the `knowledge-graph-thread-ingest` Lambda build/terraform wiring,
  and an acceptance worker stub. The stub validates the run payload and returns
  success; U4 owns replacing that stub with Cognee extraction, entity merge, and
  evidence persistence.
- 2026-06-04: U3 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-start-ingest.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  `bash scripts/build-lambdas.sh graphql-http`;
  `terraform -chdir=terraform/examples/greenfield validate`;
  `terraform fmt -check terraform/modules/app/lambda-api/handlers.tf terraform/modules/app/lambda-api/main.tf`;
  `pnpm --filter @thinkwork/api test` (399 files passed, 3 skipped; 3529 tests
  passed, 9 skipped); targeted Prettier check; and `git diff --check`.
- 2026-06-04: Opened U3 PR
  [#2079](https://github.com/thinkwork-ai/thinkwork/pull/2079).
- 2026-06-04: U3 PR
  [#2079](https://github.com/thinkwork-ai/thinkwork/pull/2079) passed required
  CI and was squash-merged into `main` at
  `ff5fd1b802ba43549605f3b292962950af36d614`; deleted the remote branch and
  removed the local U3 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U4 worktree
  `.Codex/worktrees/cognee-kg-u4-worker` on branch
  `codex/cognee-kg-u4-worker` from `origin/main`.
- 2026-06-04: Implemented U4 worker processing: replaced the acceptance stub
  with run loading/running/failure/success orchestration; added transcript
  rendering from complete thread messages; added approved ontology export as a
  custom Cognee prompt; isolated Cognee `remember` plus `add`/`cognify`
  fallback and dataset graph retrieval in a client adapter; normalized Cognee
  nodes/edges into grounded/diagnostic entities, relationships, and
  message-level evidence; and added snapshot replacement that preserves run
  history while replacing the current thread graph rows.
- 2026-06-04: U4 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/cognee-client.test.ts src/lib/knowledge-graph/thread-transcript.test.ts src/lib/knowledge-graph/normalizer.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts src/__tests__/knowledge-graph-start-ingest.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  `pnpm --filter @thinkwork/api test` (403 files passed, 3 skipped; 3535 tests
  passed, 9 skipped); targeted Prettier check; and `git diff --check`.
- 2026-06-04: Opened U4 PR
  [#2080](https://github.com/thinkwork-ai/thinkwork/pull/2080).
- 2026-06-04: U4 PR
  [#2080](https://github.com/thinkwork-ai/thinkwork/pull/2080) passed required
  CI and was squash-merged into `main` at
  `78393d45fbbffede73d2d87418a904c7e6f41da8`; deleted the remote branch and
  removed the local U4 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U5 worktree
  `.Codex/worktrees/cognee-kg-u5-infra` on branch
  `codex/cognee-kg-u5-infra` from `origin/main`.
- 2026-06-04: Implemented U5 worker infrastructure: added
  worker-only `COGNEE_ENDPOINT`/mode env vars, VPC attachment inputs for the
  `knowledge-graph-thread-ingest` Lambda, Lambda VPC access IAM, composite
  worker security group, Aurora ingress from the worker security group, Cognee
  ALB ingress from the worker security group, and outputs for the worker Lambda
  and security group.
- 2026-06-04: U5 local verification passed:
  `terraform -chdir=terraform/examples/greenfield validate`;
  `terraform fmt -check terraform/modules/app/lambda-api/main.tf terraform/modules/app/lambda-api/handlers.tf terraform/modules/thinkwork/main.tf terraform/modules/thinkwork/outputs.tf terraform/modules/app/lambda-api/variables.tf terraform/modules/app/lambda-api/outputs.tf`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/core/setKnowledgeGraphDeployment.mutation.test.ts src/__tests__/knowledge-graph-start-ingest.test.ts`;
  and `git diff --check`.
- 2026-06-04: Opened U5 PR
  [#2081](https://github.com/thinkwork-ai/thinkwork/pull/2081).
- 2026-06-04: U5 PR
  [#2081](https://github.com/thinkwork-ai/thinkwork/pull/2081) passed required
  CI and was squash-merged into `main` at
  `63ba6841c04d6f31cc3e888839b1b854d45f2d1c`; deleted the remote branch and
  removed the local U5 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U6 worktree
  `.Codex/worktrees/cognee-kg-u6-graph` on branch
  `codex/cognee-kg-u6-graph` from `origin/main`.
- 2026-06-04: Implemented U6 generic Knowledge Graph renderer in
  `@thinkwork/graph`: added the `KnowledgeGraph` ForceGraph component, the
  `KnowledgeGraphQuery` document, graph utility helpers, trust/provenance
  styling for trusted/diagnostic/weak graph output, local visual filtering that
  preserves graph data identity, connected-edge extraction for entity sheets,
  loading/empty/error states, and public API exports.
- 2026-06-04: U6 local verification passed:
  `pnpm --filter @thinkwork/graph test`;
  `pnpm --filter @thinkwork/graph typecheck`; targeted Prettier check via
  `pnpm dlx prettier --check ...`; and `git diff --check`.
- 2026-06-04: Opened U6 PR
  [#2082](https://github.com/thinkwork-ai/thinkwork/pull/2082).
- 2026-06-04: U6 PR
  [#2082](https://github.com/thinkwork-ai/thinkwork/pull/2082) passed required
  CI and was squash-merged into `main` at
  `3bff54ef3f4b86948461d7c9366ee94b094fb0c9`; deleted the remote branch and
  removed the local U6 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U7 worktree
  `.Codex/worktrees/cognee-kg-u7-spaces` on branch
  `codex/cognee-kg-u7-spaces` from `origin/main`.
- 2026-06-04: Implemented U7 Spaces Explorer UI: moved the existing Cognee
  deployment controls into a configuration panel, made the Knowledge Graph
  Explorer the default settings view, added thread search/selection and manual
  ingest controls, added latest/prior ingest run status, wired table and graph
  views to the same entity filters, added entity detail sheet drill-in with
  relationship/evidence context, added GraphQL operations/codegen, and added
  source-level coverage for the shell, query wiring, filters, ingest controls,
  and entity sheet behavior.
- 2026-06-04: U7 local verification passed:
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/SettingsKnowledgeGraph.test.ts src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`;
  `pnpm --filter @thinkwork/spaces test`;
  `pnpm --filter @thinkwork/spaces build`;
  targeted Prettier check via `pnpm dlx prettier --check ...`;
  `git diff --check`; and a dev-server smoke check with
  `curl -I http://localhost:5174/`. The in-app browser connector was not
  exposed in this compacted tool context, so no screenshot was captured; the
  production build completed with existing workspace sourcemap/chunk-size
  warnings only.
- 2026-06-04: Opened U7 PR
  [#2083](https://github.com/thinkwork-ai/thinkwork/pull/2083).
- 2026-06-04: U7 PR
  [#2083](https://github.com/thinkwork-ai/thinkwork/pull/2083) passed required
  CI and was squash-merged into `main` at
  `e647c7e87aeb16439e188f9ca452584878586314`; deleted the remote branch and
  removed the local U7 worktree/branch.
- 2026-06-04: Synced `origin/main` and created isolated U8 worktree
  `.Codex/worktrees/cognee-kg-u8-smoke` on branch
  `codex/cognee-kg-u8-smoke` from `origin/main`.
- 2026-06-04: Implemented U8 smoke/docs validation path: added
  `scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs`, documented it in
  `scripts/smoke/README.md`, and added the solution note
  `docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md`
  covering live-mode semantics, empty graph diagnostics, and browser validation
  expectations.
- 2026-06-04: U8 local verification passed:
  `node --check scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs`;
  `node scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs` dry-run;
  `pnpm --filter @thinkwork/database-pg test`;
  `pnpm --filter @thinkwork/api test`;
  `pnpm --filter @thinkwork/graph test`;
  `pnpm --filter @thinkwork/spaces test`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  targeted Prettier check via `pnpm dlx prettier --check ...`;
  `git diff --check`; and a Spaces dev-server smoke on
  `http://127.0.0.1:5177/` plus
  `http://127.0.0.1:5177/settings/knowledge-graph`.
- 2026-06-04: U8 live deployed smoke did not mutate anything because the local
  environment lacks an operator identity. The live command exited before
  GraphQL calls with: `Missing operator identity. Set SMOKE_TENANT_ID and
SMOKE_USER_ID, or provide DATABASE_URL for fallback.` The copied
  `apps/spaces/.env` has GraphQL endpoint/key values but no
  `SMOKE_TENANT_ID`, `SMOKE_USER_ID`, or `DATABASE_URL`;
  `~/.thinkwork/config.json` only records default stage `dev`.
- 2026-06-04: Opened U8 PR
  [#2084](https://github.com/thinkwork-ai/thinkwork/pull/2084).
- 2026-06-04: U8 PR
  [#2084](https://github.com/thinkwork-ai/thinkwork/pull/2084) passed required
  CI and was squash-merged into `main` at
  `4cc4b032bc50d003705e1984fa11d3487dafa089`; deleted the remote branch and
  removed the local U8 worktree/branch.
- 2026-06-04: All implementation units U1-U8 are merged. Remaining validation
  blocker is live deployed smoke execution: the local `apps/spaces/.env` has
  GraphQL endpoint/key values but no operator identity, no `DATABASE_URL`
  fallback, and `~/.thinkwork/config.json` only records default stage `dev`.
- 2026-06-04: Completion audit after U8 found `main` deployed successfully, but
  the live smoke script's documented API-key/operator path entered the
  admin-skill impersonation gate without an `x-agent-id`, causing
  `Agent identity required for admin-skill operations` before mutation.
  Started U9 hotfix branch `codex/cognee-kg-smoke-service-auth`.
- 2026-06-04: U9 updated the smoke script to default live GraphQL calls to
  tenant-scoped bearer/API-key service auth and reserve admin-skill
  impersonation for explicit `SMOKE_USER_ID` + `SMOKE_KG_AGENT_ID`.
- 2026-06-04: U9 live smoke then reached the deployed worker against dev thread
  `81e6f391-a2d1-45be-98e1-d4fbb7d78878` and failed with Cognee
  `/api/v1/remember` returning `401 Unauthorized`. Cognee's current
  self-hosted docs require both `REQUIRE_AUTHENTICATION=false` and
  `ENABLE_BACKEND_ACCESS_CONTROL=false`; Terraform had only set the former.
  U9 now sets both on the private Cognee ECS service.
- 2026-06-04: U9 local verification passed:
  `node --check scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs`;
  `node scripts/smoke/knowledge-graph-thread-ingest-smoke.mjs` dry-run;
  `pnpm dlx prettier --check ...`;
  `terraform fmt -check terraform/modules/app/cognee/main.tf`;
  `terraform -chdir=terraform/examples/greenfield validate`;
  and `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`.
- 2026-06-04: Opened U9 hotfix PR
  [#2086](https://github.com/thinkwork-ai/thinkwork/pull/2086).
- 2026-06-05: U9 PR
  [#2086](https://github.com/thinkwork-ai/thinkwork/pull/2086) passed required
  CI and was squash-merged into `main` at
  `2d342970e253a299b662b8dc9266bfacd9e46996`; the merge-triggered dev deploy
  completed successfully.
- 2026-06-05: Post-U9 live deployed smoke against dev thread
  `81e6f391-a2d1-45be-98e1-d4fbb7d78878` reached Cognee and failed with
  `/api/v1/remember` returning `409 Invalid request data for remember
operation`. ECS logs showed the precise cause:
  `ValueError: Unsupported remember content_type. Supported values: 'skills'.`
  Started U10 hotfix branch `codex/cognee-kg-remember-content-type`.
- 2026-06-05: User clarified that thread ingest should follow Cognee best
  practices rather than mirror the Wiki ingest process exactly, and that
  ThinkWork ontology tables should still be leveraged. U10 scope expanded from
  a narrow `content_type` fix to an ontology-guided Cognee ingest rework.
- 2026-06-05: U10 now exports approved ThinkWork ontology entity and
  relationship rows to a deterministic RDF/OWL document, hashes it into a stable
  Cognee `ontology_key`, uploads it when missing via `/api/v1/ontologies`,
  sends that `ontology_key` to `remember`, and tags thread data with
  `thinkwork_threads`, tenant, and thread NodeSets. It also keeps the
  conservative custom prompt as supplemental guidance and removes the invalid
  top-level `content_type=text/markdown` field.
- 2026-06-05: U10 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/ontology-export.test.ts src/lib/knowledge-graph/cognee-client.test.ts src/lib/knowledge-graph/normalizer.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`; targeted
  Prettier check; and `git diff --check`.
- 2026-06-05: Opened U10 PR
  [#2087](https://github.com/thinkwork-ai/thinkwork/pull/2087).
- 2026-06-05: U10 PR
  [#2087](https://github.com/thinkwork-ai/thinkwork/pull/2087) passed required
  CI and was squash-merged into `main` at
  `88fd71c85398d85ee65b5dff8ca5bcf9a35cfe72`; the merge-triggered dev deploy
  completed successfully.
- 2026-06-05: Post-U10 live deployed smoke against dev thread
  `81e6f391-a2d1-45be-98e1-d4fbb7d78878` reached Cognee extraction and failed
  run `146b01c7-d27b-42ea-8245-cf0b0341cd96` with `/api/v1/remember`
  returning `409 An error occurred during remember`. ECS logs showed the root
  cause from LiteLLM's Bedrock Converse adapter:
  `ModuleNotFoundError: No module named 'boto3'`.
- 2026-06-05: Started U11 hotfix branch
  `codex/cognee-bedrock-boto3-image` from `origin/main`.
- 2026-06-05: U11 adds `packages/cognee/Dockerfile` based on the reviewed
  pinned Cognee digest and installs `boto3` into `/app/.venv`; deploy now builds
  and pushes that Cognee Bedrock image to ECR when Cognee is enabled and no
  explicit `COGNEE_IMAGE_URI` override is set, then passes the built digest to
  Terraform.
- 2026-06-05: U11 local verification passed:
  `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`;
  targeted Prettier check; and `git diff --check`. Local Docker is unavailable
  in this desktop environment, so the Cognee image build will be verified by the
  deploy workflow.
- 2026-06-05: Opened U11 PR
  [#2088](https://github.com/thinkwork-ai/thinkwork/pull/2088).
- 2026-06-05: U11 PR
  [#2088](https://github.com/thinkwork-ai/thinkwork/pull/2088) passed required
  CI and was squash-merged into `main` at
  `bdfad95e6530c20d0df2801e0a816b7f5e3c2b93`; the remote branch was deleted.
- 2026-06-05: U11 merge-triggered deploy run
  [26988785205](https://github.com/thinkwork-ai/thinkwork/actions/runs/26988785205)
  failed in `Terraform Apply` while building the Cognee image before Terraform
  mutations. Docker build logs showed that `/app/.venv/bin/python` has no
  `pip` module, because Cognee's uv-built runtime venv omits pip.
- 2026-06-05: Started U12 hotfix branch `codex/cognee-bedrock-uv-boto3` from
  `origin/main`.
- 2026-06-05: U12 updates `packages/cognee/Dockerfile` to install `boto3` with
  the final image's system Python pip into
  `/app/.venv/lib/python3.12/site-packages`, preserving Cognee's uv-managed venv
  while satisfying LiteLLM's Bedrock import.
- 2026-06-05: U12 local verification passed:
  `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`;
  targeted Prettier check; and `git diff --check`. Local Docker remains
  unavailable, so the image layer will be verified by the deploy workflow.
- 2026-06-05: Opened U12 PR
  [#2089](https://github.com/thinkwork-ai/thinkwork/pull/2089).
- 2026-06-05: U12 PR
  [#2089](https://github.com/thinkwork-ai/thinkwork/pull/2089) passed required
  CI and was squash-merged into `main` at
  `d71396276d211a99bfa83aad6a698812eb7fd880`; the remote branch was deleted.
- 2026-06-05: U12 merge-triggered deploy run
  [26989206584](https://github.com/thinkwork-ai/thinkwork/actions/runs/26989206584)
  failed in `Terraform Apply` while building the Cognee image before Terraform
  mutations. Docker build logs showed that the bare `python -m pip` command
  still resolved to `/app/.venv/bin/python`, whose venv intentionally omits
  `pip`.
- 2026-06-05: Started U13 hotfix branch
  `codex/cognee-bedrock-system-python` from `origin/main`.
- 2026-06-05: U13 updates `packages/cognee/Dockerfile` to call
  `/usr/local/bin/python -m pip` explicitly, avoiding Cognee's venv-first
  `PATH` while still targeting `/app/.venv/lib/python3.12/site-packages`.
- 2026-06-05: U13 local verification passed:
  `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`;
  targeted Prettier check; and `git diff --check`. Local Docker remains
  unavailable, so the image layer will be verified by the deploy workflow.
- 2026-06-05: Opened U13 PR
  [#2090](https://github.com/thinkwork-ai/thinkwork/pull/2090).
