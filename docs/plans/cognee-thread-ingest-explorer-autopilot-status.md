# Cognee Thread Ingest Explorer Autopilot Status

Plan: `docs/plans/2026-06-04-003-feat-cognee-thread-ingest-explorer-plan.md`
Target branch: `main`
Started: 2026-06-04

## Current Status

- State: follow_up_in_progress
- Current unit: background Cognee source indexing plus ontology definitions
  visibility
- Current branch/worktree: `codex/kg-cognee-background-ingest` in
  `.Codex/worktrees/kg-cognee-background-ingest`
- Current PR: none
- Blocker: none.

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
- 2026-06-05: Follow-up source ingest unit merged as PR
  [#2103](https://github.com/thinkwork-ai/thinkwork/pull/2103), squash commit
  `9965e8eb2ec6275995acb7b489aa1831ac32fcb5`. The merge deployed
  successfully via GitHub Actions run
  `27019379209`.
- 2026-06-05: Post-deploy dry-run wiki and brain smokes passed. Forced live
  wiki smokes against tenant `0015953e-aa13-4cab-8398-2e70f73dda63`, owner
  `0488f468-4071-70b0-e0a4-a639373999a0`, created runs
  `569fd3e9-23bf-4693-af99-fb1f9dd919d7` and
  `d5a6f4c7-a772-4d47-b9fb-0ed7c40acbe5`; both failed because Cognee
  `/api/v1/remember` returned `504 Gateway Time-out`. Cognee service logs
  showed raw graph extraction started (including one run with 61 nodes and 188
  edges) before Bedrock embedding throttling caused the pipeline to fail.
- 2026-06-05: Started follow-up branch
  `codex/kg-cognee-background-ingest` to stop relying on synchronous Cognee
  graph builds. Implemented `run_in_background=true` for Cognee graph indexing,
  dataset-status polling, persisted indexing status metrics, and a cleaner
  Knowledge Graph UI split between `Data` and `Definitions`.
- 2026-06-05: Added Knowledge Graph `Definitions` mode that exposes approved
  ontology entities, relationships, and external mappings from the same
  `ontologyDefinitions` contract used by Admin Ontology. Mappings are shown as
  reference vocabulary alignment, not as observed customer graph relationships.
- 2026-06-05: Follow-up local verification passed:
  `pnpm --filter @thinkwork/spaces codegen`;
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/cognee-client.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx src/components/settings/SettingsKnowledgeGraph.test.ts`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/spaces build`; and `git diff --check`.
  The Spaces build completed with existing sourcemap and chunk-size warnings.
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
- 2026-06-05: U13 PR
  [#2090](https://github.com/thinkwork-ai/thinkwork/pull/2090) passed required
  CI and was squash-merged into `main` at
  `3f32708e0aef89d6576062c1592111be580d8a7f`; the remote branch was deleted.
- 2026-06-05: U13 merge-triggered deploy run
  [26989630000](https://github.com/thinkwork-ai/thinkwork/actions/runs/26989630000)
  passed end to end. The deploy workflow built and pushed the custom Cognee
  Bedrock image, applied Terraform, deployed admin/docs, and completed the
  deploy summary checks.
- 2026-06-05: Post-U13 live deployed smoke against dev thread
  `81e6f391-a2d1-45be-98e1-d4fbb7d78878` proved the Cognee path is healthy:
  Cognee uploaded/loaded the ThinkWork ontology, `/api/v1/remember` returned
  200, and Cognee logs showed `6 nodes and 8 edges`. The smoke then failed on
  GraphQL `knowledgeGraphGraph` with `cannot cast type record to uuid[]`,
  exposing a relationship filter SQL bug in the read resolver.
- 2026-06-05: Started U14 hotfix branch
  `codex/kg-graph-uuid-filter-fix` from `origin/main`.
- 2026-06-05: U14 replaces the graph resolver's `ANY(${ids}::uuid[])`
  relationship filters with parameterized UUID `IN (...)` lists and adds a
  regression assertion that renders the Drizzle SQL and rejects the invalid
  `::uuid[]` array cast.
- 2026-06-05: U14 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-resolvers.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api lint`
  (no lint script present); and targeted Prettier check via
  `pnpm dlx prettier@3.8.2 --check ...`. The fresh worktree dependency install
  logged a local optional `canvas` native build failure under Node 25 because
  `pkg-config` is unavailable, but pnpm completed and the targeted API tests
  and typecheck ran successfully.
- 2026-06-05: Opened U14 PR
  [#2091](https://github.com/thinkwork-ai/thinkwork/pull/2091).
- 2026-06-05: U14 PR
  [#2091](https://github.com/thinkwork-ai/thinkwork/pull/2091) passed required
  CI and was squash-merged into `main` at
  `44a191536459f0819555b41e48b09ab30d429973`; the remote branch was deleted.
- 2026-06-05: U14 merge-triggered deploy run
  [26990538027](https://github.com/thinkwork-ai/thinkwork/actions/runs/26990538027)
  passed end to end, including Terraform, admin/docs deploys, workspace layout
  migration, and deploy summary checks.
- 2026-06-05: Post-U14 live deployed smoke against dev thread
  `81e6f391-a2d1-45be-98e1-d4fbb7d78878` progressed through forced ingest and
  `knowledgeGraphGraph`, then failed on GraphQL `knowledgeGraphEntity` with
  `cannot cast type record to uuid[]`, exposing the remaining relationship
  evidence filter SQL bug in the entity detail resolver.
- 2026-06-05: Started U15 hotfix branch
  `codex/kg-entity-uuid-filter-fix` from `origin/main`.
- 2026-06-05: U15 replaces the entity detail resolver's
  `ANY(${relationshipIds}::uuid[])` evidence filter with a parameterized UUID
  `IN (...)` list and omits the relationship evidence clause when no
  relationships are present.
- 2026-06-05: U15 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-resolvers.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`; `pnpm --filter @thinkwork/api lint`
  (no lint script present); targeted Prettier check; and `git diff --check`.
  The fresh worktree dependency install again logged the local optional
  `canvas` native build failure under Node 25 because `pkg-config` is
  unavailable, but pnpm completed and the targeted API tests and typecheck ran
  successfully.
- 2026-06-05: Opened U15 PR
  [#2092](https://github.com/thinkwork-ai/thinkwork/pull/2092).
- 2026-06-05: U15 PR
  [#2092](https://github.com/thinkwork-ai/thinkwork/pull/2092) passed required
  CI and was squash-merged into `main` at
  `9347a42d39a7a4ad5360c9c753733eb27c6a35d0`; the remote branch was deleted.
- 2026-06-05: U15 merge-triggered deploy run
  [26991098610](https://github.com/thinkwork-ai/thinkwork/actions/runs/26991098610)
  passed end to end. The workflow rebuilt and deployed the Pi container,
  rebuilt and pushed the custom Cognee Bedrock image, applied Terraform,
  deployed admin/docs, updated AgentCore runtimes, and completed deploy summary
  checks.
- 2026-06-05: Final live deployed smoke against dev thread
  `81e6f391-a2d1-45be-98e1-d4fbb7d78878` passed with forced ingest run
  `d5b47869-102b-46a0-95f7-c77d37ce99f2`: Cognee returned dataset
  `thinkwork:0015953e-aa13-4cab-8398-2e70f73dda63:thread:81e6f391-a2d1-45be-98e1-d4fbb7d78878`,
  `6` entities, `8` relationships, graph node/edge reads, and a successful
  entity detail read.
- 2026-06-05: Autopilot implementation is complete. All implementation units
  and follow-up hotfix units are merged to `main`; required PR CI and
  merge-triggered deploys passed; live deployed smoke passed; no blockers
  remain.
- 2026-06-05: Started post-release local follow-up from `origin/main` at
  `.Codex/worktrees/kg-local-latest` after browser validation showed Cognee
  structural nodes and the ingest drawer still used the old horizontal thread
  card layout. Root-cause review found Cognee's raw graph includes pipeline
  artifacts (`DocumentChunk`, `NodeSet`, `TextDocument`) and that the product
  graph should only expose approved ontology entity and relationship triples.
- 2026-06-05: Implemented ontology-only read behavior and a run-scoped UX
  pivot: entity and graph resolvers now support tenant-wide reads when
  `threadId` is omitted and run-scoped reads via `runId`, while hard-filtering
  the main graph/table to rows with approved ontology type IDs/slugs and
  grounded relationships. The main Knowledge Graph now queries all tenant
  known ontology entities; the thread ingest controls live in a side sheet
  behind the header messages icon; the sheet uses a no-horizontal-scroll data
  table; ingest status is a clickable badge that opens per-run results; and the
  run result view shows both a result entity table and graph scoped to that
  ingest run.
- 2026-06-05: Local follow-up verification passed:
  `pnpm schema:build`;
  `pnpm --filter @thinkwork/spaces codegen`;
  `pnpm --filter @thinkwork/mobile codegen`;
  `pnpm --dir apps/cli codegen`;
  `pnpm --filter @thinkwork/admin codegen`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`;
  `pnpm --filter @thinkwork/graph exec vitest run src/KnowledgeGraph.test.tsx`;
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-schema.test.ts src/__tests__/knowledge-graph-resolvers.test.ts src/lib/knowledge-graph/runs.test.ts src/lib/knowledge-graph/normalizer.test.ts src/lib/knowledge-graph/cognee-client.test.ts`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/graph typecheck`;
  `pnpm --filter @thinkwork/api typecheck`;
  `bash scripts/build-lambdas.sh graphql-http`;
  `pnpm --filter thinkwork-cli typecheck`;
  `pnpm --filter @thinkwork/spaces build`;
  and `curl -I http://127.0.0.1:5174/settings/knowledge-graph` returned
  `200 OK`. The in-app browser connector was not exposed in this tool context,
  so final authenticated visual validation remains in the user's browser.
  Admin and mobile package filters do not currently expose `typecheck` scripts.
- 2026-06-05: Opened follow-up PR
  [#2097](https://github.com/thinkwork-ai/thinkwork/pull/2097). Initial CI
  passed CLA, lint, verify, and typecheck, then failed the full test workflow
  because `SettingsKnowledgeGraph.test.ts` still asserted the old
  self-closing `<KnowledgeGraphExplorer />` source shape. Updated the test to
  assert the new thread-ingest sheet props and header action wiring; local
  verification passed:
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/SettingsKnowledgeGraph.test.ts src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`;
  `pnpm --filter @thinkwork/spaces typecheck`.
- 2026-06-05: Started follow-up branch
  `codex/kg-thread-sheet-detail` after browser validation showed the side
  sheet thread table was unreadable and the main graph was still empty after
  successful ingests. Root-cause review found the normalizer kept only
  ontology-approved entities that participated in approved relationships, so a
  successful Cognee run could persist zero visible product rows when it found
  entity candidates but no relationship edge that matched the approved
  ontology. Implemented a compact no-pagination thread table with only title
  and icon status; row click opens thread detail; the detail sheet owns the
  ingest action; and grounded approved entities now persist even when isolated.
  Focused local verification passed:
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`;
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/normalizer.test.ts`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/api typecheck`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  `pnpm --filter @thinkwork/spaces build`;
  targeted Prettier check;
  `git diff --check`;
  `curl -I http://127.0.0.1:5174/settings/knowledge-graph`; and
  `pnpm --filter @thinkwork/api exec vitest run src/handlers/knowledge-graph-thread-ingest.test.ts src/lib/knowledge-graph/normalizer.test.ts`.
  The Spaces production build completed with the existing sourcemap and large
  chunk warnings only.
- 2026-06-05: Opened follow-up PR
  [#2098](https://github.com/thinkwork-ai/thinkwork/pull/2098).
- 2026-06-05: Started follow-up branch `codex/kg-raw-drop-diagnostics` after
  the deployed Bunkhouse smoke showed Cognee returning a raw graph
  (`39` nodes, `116` edges) while the approved ThinkWork ontology graph stayed
  empty. Root-cause signal: normalization correctly preserved the
  ontology-only gate, but every non-structural Cognee node had an unapproved
  type, so all relationships became orphaned after node filtering.
- 2026-06-05: Implemented bounded raw-drop diagnostics in normalizer metrics:
  sampled dropped Cognee nodes now include label, raw type, drop reason, and
  property keys; sampled dropped Cognee edges now include relationship label,
  raw type, endpoint labels/ids, drop reason, and property keys. Updated
  Spaces GraphQL operations/codegen to request run `metrics`, and added a
  thread detail diagnostics panel that explains empty approved graph output
  and shows compact dropped-node/link samples without horizontal scroll.
- 2026-06-05: Local diagnostics follow-up verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/normalizer.test.ts`;
  `pnpm --filter @thinkwork/api exec vitest run src/handlers/knowledge-graph-thread-ingest.test.ts src/lib/knowledge-graph/normalizer.test.ts`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  `pnpm --filter @thinkwork/spaces build`;
  targeted Prettier check; and `git diff --check`. Spaces build completed
  with the existing sourcemap and large chunk warnings only.
- 2026-06-05: Opened diagnostics follow-up PR
  [#2100](https://github.com/thinkwork-ai/thinkwork/pull/2100).
- 2026-06-05: Started source-ingest follow-up branch
  `codex/kg-wiki-brain-ingest` in isolated worktree
  `.Codex/worktrees/kg-wiki-brain-ingest` from `origin/main` after planning
  a wiki/company-brain validation path for Cognee. The goal is to preserve the
  ontology-only graph gate while feeding Cognee ontology-shaped data from
  already structured wiki and brain pages.
- 2026-06-05: Implemented source-aware Knowledge Graph runs and snapshots:
  runs, entities, relationships, and evidence now carry `source_kind` and
  `source_ref`, with thread ids nullable for non-thread sources. Added the
  forward migration
  `packages/database-pg/drizzle/0146_knowledge_graph_source_scope.sql`,
  the `startKnowledgeGraphIngest` GraphQL mutation, source-scoped run/table/
  graph filters, and preserved the existing thread ingest mutation.
- 2026-06-05: Added wiki and brain source adapters that render bounded
  ontology-shaped packets from active compiled wiki pages and tenant brain
  pages, including aliases, subtype hints, sections/facets, links, citations,
  and source evidence metadata. The worker now loads thread/wiki/brain bundles,
  calls Cognee v1 `remember`, normalizes through the existing ontology gate,
  and records source packet counts plus Cognee/normalizer diagnostics.
- 2026-06-05: Updated Spaces Knowledge Graph with Wiki and Brain source-ingest
  actions, source-aware run handling, and entity evidence display. Local
  browser validation against the currently deployed API initially exposed a
  schema-version error because the page sent new `sourceKind/sourceRef` query
  args before the backend deploy existed; fixed the default page path to remain
  compatible with the deployed schema and added introspection gating so Wiki
  and Brain buttons enable only after the API schema supports source ingest.
- 2026-06-05: Added dry-run-safe deployed smoke entrypoints
  `scripts/smoke/knowledge-graph-wiki-ingest-smoke.mjs` and
  `scripts/smoke/knowledge-graph-brain-ingest-smoke.mjs`, backed by a shared
  source-smoke helper. Live mode starts a source-aware ingest, polls
  source-scoped run history, reads table/graph/detail output, and fails on an
  empty approved graph unless `SMOKE_KG_ALLOW_EMPTY=1` is set for diagnostics.
- 2026-06-05: Source-ingest local verification so far passed:
  `node scripts/smoke/knowledge-graph-wiki-ingest-smoke.mjs`;
  `node scripts/smoke/knowledge-graph-brain-ingest-smoke.mjs`;
  `pnpm --filter @thinkwork/spaces codegen`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/graph typecheck`;
  and
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx src/components/settings/SettingsKnowledgeGraph.test.ts`.
  The local dev server remains available at
  `http://localhost:5174/settings/knowledge-graph`; authenticated browser
  validation should hard-refresh the tab after the schema-compatibility fix.
- 2026-06-05: Completed source-ingest local verification before PR:
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/database-pg typecheck`;
  `pnpm --filter @thinkwork/graph typecheck`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter thinkwork-cli typecheck`;
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/wiki-source.test.ts src/lib/knowledge-graph/brain-source.test.ts src/__tests__/knowledge-graph-start-ingest.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts src/lib/knowledge-graph/runs.test.ts src/lib/knowledge-graph/normalizer.test.ts src/lib/knowledge-graph/cognee-client.test.ts`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx src/components/settings/SettingsKnowledgeGraph.test.ts`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  `bash scripts/build-lambdas.sh graphql-http`;
  `pnpm schema:build`;
  `pnpm --filter @thinkwork/admin codegen`;
  `pnpm --filter @thinkwork/mobile codegen`;
  `pnpm --dir apps/cli codegen`;
  `pnpm --filter @thinkwork/spaces codegen`;
  `pnpm --filter @thinkwork/spaces build`;
  source smoke dry-runs;
  targeted Prettier check for hand-authored files;
  `git diff --check`;
  and `curl -I http://localhost:5174/settings/knowledge-graph` returned
  `200 OK`. Spaces build completed with existing sourcemap and chunk warnings
  only; admin/mobile package filters still do not expose typecheck scripts.
- 2026-06-05: Opened source-ingest follow-up PR
  [#2103](https://github.com/thinkwork-ai/thinkwork/pull/2103).
- 2026-06-05: PR [#2103](https://github.com/thinkwork-ai/thinkwork/pull/2103)
  first CI attempt failed the `test` workflow in
  `packages/database-pg/__tests__/knowledge-graph-schema.test.ts` because the
  schema assertions still expected non-null thread-only rows and the old
  evidence `source_kind` semantics. Updated the schema test to assert nullable
  `thread_id`, graph `source_kind/source_ref`, evidence
  `evidence_source_kind/evidence_source_ref`, and migration `0146` markers.
  Local fix verification passed:
  `pnpm --filter @thinkwork/database-pg exec vitest run __tests__/knowledge-graph-schema.test.ts`
  and `pnpm --filter @thinkwork/database-pg test`.
- 2026-06-05: PR [#2103](https://github.com/thinkwork-ai/thinkwork/pull/2103)
  second CI attempt failed the dev migration drift precheck because the new
  hand-rolled migration `0146_knowledge_graph_source_scope.sql` was not yet
  applied to the dev database. First local apply attempt failed before mutation
  because AWS CLI had no region configured. Re-ran with
  `AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1`, applied
  `packages/database-pg/drizzle/0146_knowledge_graph_source_scope.sql` to dev,
  and verified with
  `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0146_knowledge_graph_source_scope.sql`.
- 2026-06-05: PR [#2103](https://github.com/thinkwork-ai/thinkwork/pull/2103)
  third CI attempt failed the monorepo `test` workflow in
  `packages/api/src/__tests__/knowledge-graph-resolvers.test.ts` because the
  resolver fixtures still used the pre-source-scope row shape. Updated those
  fixtures to include graph `source_kind/source_ref/source_label` and the new
  evidence `evidence_source_kind/evidence_source_ref` fields. Local fix
  verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-resolvers.test.ts`;
  `pnpm --filter @thinkwork/api exec vitest run src/__tests__/knowledge-graph-resolvers.test.ts src/lib/knowledge-graph/wiki-source.test.ts src/lib/knowledge-graph/brain-source.test.ts src/__tests__/knowledge-graph-start-ingest.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts src/lib/knowledge-graph/runs.test.ts src/lib/knowledge-graph/normalizer.test.ts src/lib/knowledge-graph/cognee-client.test.ts`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx src/components/settings/SettingsKnowledgeGraph.test.ts`;
  and `git diff --check`.
- 2026-06-05: PR [#2103](https://github.com/thinkwork-ai/thinkwork/pull/2103)
  passed required CI and was squash-merged into `main` at
  `9965e8eb2ec6275995acb7b489aa1831ac32fcb5`. The branch was deleted and
  `origin/main` was synced before the next follow-up.
- 2026-06-05: Post-merge source smoke found the source-aware API deployed but
  live Cognee indexing remained unreliable under synchronous request timing:
  wiki/brain dry-runs passed, and live Bunkhouse-style source attempts showed
  Cognee beginning graph extraction before returning timeout/throttling
  failures. This established the next follow-up: use Cognee's background
  indexing status endpoint before fetching dataset graphs, and make ontology
  definitions visible separately from graph data.
- 2026-06-05: Started follow-up branch
  `codex/kg-cognee-background-ingest` in isolated worktree
  `.Codex/worktrees/kg-cognee-background-ingest`. Implemented background
  Cognee indexing for `remember`/`cognify`, captured pipeline/indexing status
  metrics on runs, added ontology Definitions mode in Settings > Knowledge
  Graph, and moved the `Data`/`Definitions` mode toggle to the upper-right
  page-title action area after browser feedback.
- 2026-06-05: Background-indexing follow-up local verification passed after
  rebasing onto `origin/main` (`5ca22f6a`):
  `pnpm --filter @thinkwork/api exec vitest run src/lib/knowledge-graph/cognee-client.test.ts src/handlers/knowledge-graph-thread-ingest.test.ts`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/knowledge-graph/KnowledgeGraphExplorer.test.tsx src/components/settings/SettingsKnowledgeGraph.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `bash scripts/build-lambdas.sh knowledge-graph-thread-ingest`;
  targeted Prettier check;
  `git diff --check`;
  and `curl -I http://localhost:5174/settings/knowledge-graph` returned
  `200 OK`.
- 2026-06-05: Opened follow-up PR
  [#2105](https://github.com/thinkwork-ai/thinkwork/pull/2105). Initial CI
  passed Supply Chain, Lint, Typecheck, and Test on head
  `45984ce2a39b3916fe71969f3d77572b3a472b63`.
- 2026-06-05: User browser validation showed the data view still looked like
  an operator diagnostics screen and source actions were unclear. Simplified
  the primary data toolbar to search, Table/Graph, and explicit `Ingest Wiki`
  / `Ingest Brain` actions; removed the visible Type, Grounding, and
  Provenance filters for now.
- 2026-06-05: Pre-deploy live wiki and brain source smokes against current
  `main` confirmed the data blocker this follow-up is meant to fix: both
  deployed source runs reached the worker and then failed in Cognee
  `/api/v1/remember` with `504 Gateway Time-out` before graph fetch. Example
  run ids: wiki `1b09e78b-bd04-43a4-ad22-5db35e627249`, brain
  `b499dd6f-7366-4e97-a0f5-1969a2e05f31`. The next live smoke must run after
  #2105 deploys so the worker uses background indexing.
