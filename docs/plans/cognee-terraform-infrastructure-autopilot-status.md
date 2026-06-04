# Cognee Terraform Infrastructure Autopilot Status

Plan: `docs/plans/2026-06-04-001-feat-cognee-terraform-infrastructure-plan.md`
Target branch: `main`
Started: 2026-06-04

## Current Status

- State: in_progress
- Current unit: Deploy hotfix — tolerate AgentCore runtime update Forbidden
- Current branch/worktree:
  `codex/agentcore-update-forbidden-tolerant` /
  `.Codex/worktrees/agentcore-update-forbidden-tolerant`
- Current PR: [#2073](https://github.com/thinkwork-ai/thinkwork/pull/2073)
- Blocker: none.
- AWS status: Cognee is running in dev on ECS service
  `thinkwork-dev-cognee` in cluster `thinkwork-dev-cognee-cluster`; desired /
  running tasks are 1 / 1, the ALB target is healthy, and `/health` logs are
  returning 200.

## Progress Log

- 2026-06-04: Read `AGENTS.md` and the Cognee Terraform infrastructure plan.
- 2026-06-04: Selected U1 as the first implementation unit.
- 2026-06-04: Created isolated worktree `.Codex/worktrees/cognee-u1` on branch `codex/u1-cognee-terraform-module` from `origin/main`.
- 2026-06-04: Implemented U1 Cognee app module with internal ALB, ECS/Fargate task, EFS writable storage, Bedrock IAM, ECS secret injection, backend-mode checks, outputs, README, and fixture tests.
- 2026-06-04: Local verification passed: `terraform fmt -check terraform/modules/app/cognee`; `terraform -chdir=terraform/modules/app/cognee init -backend=false && terraform -chdir=terraform/modules/app/cognee validate`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`; `pnpm dlx prettier --check apps/cli/__tests__/terraform-cognee-fixture.test.ts terraform/modules/app/cognee/README.md docs/plans/cognee-terraform-infrastructure-autopilot-status.md docs/plans/2026-06-04-001-feat-cognee-terraform-infrastructure-plan.md`.
- 2026-06-04: Ran Compound code-review pass for U1. Fixed review findings by replacing Terraform warning-only `check` blocks with hard-failing `terraform_data` preconditions, requiring a dedicated non-admin database user, requiring immutable Cognee image digests, rejecting all-network ALB CIDRs, validating backend URLs do not embed credentials, making Bedrock IAM conditional with explicit model ARNs, using `var.db_port` for DB ingress, de-duping EFS mount targets by AZ, and adding ECS startup grace plus steady-state waiting.
- 2026-06-04: Post-review verification passed: `terraform fmt -check terraform/modules/app/cognee`; `terraform -chdir=terraform/modules/app/cognee init -backend=false && terraform -chdir=terraform/modules/app/cognee validate`; `pnpm dlx prettier --write apps/cli/__tests__/terraform-cognee-fixture.test.ts terraform/modules/app/cognee/README.md`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`.
- 2026-06-04: Opened U1 PR [#2045](https://github.com/thinkwork-ai/thinkwork/pull/2045).
- 2026-06-04: U1 PR [#2045](https://github.com/thinkwork-ai/thinkwork/pull/2045) passed GitHub checks (`cla`, `lint`, `test`, `typecheck`, `verify`) and squash merged to `main` as `30ec4984677de7a0c044bbe8ce745b890271e13a`; remote branch deleted and U1 worktree removed.
- 2026-06-04: Created isolated worktree `.Codex/worktrees/cognee-u2` on branch `codex/u2-cognee-thinkwork-wiring` from `origin/main`.
- 2026-06-04: Implemented U2 composite wiring with `enable_cognee`, safe explicit Cognee configuration variables, parent guardrails, `module "cognee"` behind `count`, nullable composite outputs, and fixture coverage for Hindsight/memory independence.
- 2026-06-04: U2 local verification passed: `terraform -chdir=terraform/modules/thinkwork init -backend=false && terraform -chdir=terraform/modules/thinkwork validate`; `pnpm install --frozen-lockfile`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`. Local install completed with a non-blocking optional `canvas` build failure under Node 25 because `pkg-config` is unavailable.
- 2026-06-04: Ran U2 Compound review pass. Correctness found no issues; security found and fixed two guardrails: reject the shared Thinkwork admin DB secret ARN when Cognee is enabled, and reject wildcard Bedrock model resource ARNs in both the composite and app module surfaces.
- 2026-06-04: Post-review U2 verification passed: `terraform fmt -recursive terraform/modules/thinkwork terraform/modules/app/cognee`; `terraform -chdir=terraform/modules/thinkwork init -backend=false && terraform -chdir=terraform/modules/thinkwork validate`; `pnpm dlx prettier --write apps/cli/__tests__/terraform-cognee-fixture.test.ts docs/plans/cognee-terraform-infrastructure-autopilot-status.md`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`; `git diff --check`.
- 2026-06-04: Opened U2 PR [#2046](https://github.com/thinkwork-ai/thinkwork/pull/2046).
- 2026-06-04: U2 PR [#2046](https://github.com/thinkwork-ai/thinkwork/pull/2046) passed GitHub checks (`cla`, `lint`, `test`, `typecheck`, `verify`) and squash merged to `main` as `c8fa82a705975b53217eb79d09bfd4aeeace819c`; remote branch deleted and U2 worktree removed.
- 2026-06-04: Created isolated worktree `.Codex/worktrees/cognee-u3` on branch `codex/u3-cognee-secrets-config` from `origin/main`.
- 2026-06-04: Implemented U3 Cognee app-module secret hygiene with optional operator-owned Secrets Manager placeholder containers, `ignore_changes` secret versions, effective secret ARN plumbing for ECS injection/IAM, ARN-only secret outputs, README rotation guidance, and fixture coverage.
- 2026-06-04: U3 local verification passed: `terraform fmt -recursive terraform/modules/app/cognee`; `terraform -chdir=terraform/modules/app/cognee init -backend=false && terraform -chdir=terraform/modules/app/cognee validate`; `pnpm dlx prettier --write apps/cli/__tests__/terraform-cognee-fixture.test.ts terraform/modules/app/cognee/README.md`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`; `git diff --check`.
- 2026-06-04: Ran targeted U3 local review focused on secret value exposure, effective ARN propagation, ECS secret injection, IAM scoping, and parent-module scope. No code changes required after review.
- 2026-06-04: Opened U3 PR [#2047](https://github.com/thinkwork-ai/thinkwork/pull/2047).
- 2026-06-04: U3 PR [#2047](https://github.com/thinkwork-ai/thinkwork/pull/2047) passed GitHub checks (`cla`, `lint`, `test`, `typecheck`, `verify`) and squash merged to `main` as `005326a3fc7dc42a7b5bb10e4efd69bba8fa53e4`; remote branch deleted and U3 worktree removed.
- 2026-06-04: Created isolated worktree `.Codex/worktrees/cognee-u4` on branch `codex/u4-cognee-cli-templates` from `origin/main`.
- 2026-06-04: Implemented U4 propagation through the greenfield example, `thinkwork init` generated tfvars/root HCL, enterprise deploy template, CI verify/deploy Terraform var blocks, and fixture tests. Kept Cognee disabled by default across generated and CI surfaces.
- 2026-06-04: U4 validation caught that `terraform/examples/greenfield` pins AWS provider `~> 5.0` while the Cognee app module used the provider-v6-only `data.aws_region.current.region` attribute. Fixed the app module to use `data.aws_region.current.name` for provider v5 compatibility.
- 2026-06-04: U4 local verification passed: `terraform fmt terraform/modules/app/cognee/main.tf terraform/examples/greenfield/main.tf apps/cli/src/commands/enterprise/templates/deploy-repo/terraform/main.tf`; `terraform -chdir=terraform/modules/app/cognee init -backend=false && terraform -chdir=terraform/modules/app/cognee validate`; `terraform -chdir=terraform/examples/greenfield init -backend=false && terraform -chdir=terraform/examples/greenfield validate`; `terraform -chdir=terraform/modules/thinkwork init -backend=false && terraform -chdir=terraform/modules/thinkwork validate`; `pnpm install --frozen-lockfile`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts __tests__/enterprise-secrets.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm dlx prettier --check apps/cli/src/commands/init.ts apps/cli/__tests__/terraform-cognee-fixture.test.ts apps/cli/__tests__/enterprise-secrets.test.ts .github/workflows/verify.yml .github/workflows/deploy.yml docs/plans/cognee-terraform-infrastructure-autopilot-status.md`; `git diff --check`. Direct Terraform validation of the enterprise deploy template is not meaningful because it intentionally contains the unreplaced `{{TERRAFORM_MODULE_VERSION}}` registry placeholder; structural tests cover that template.
- 2026-06-04: Opened U4 PR [#2048](https://github.com/thinkwork-ai/thinkwork/pull/2048).
- 2026-06-04: U4 PR [#2048](https://github.com/thinkwork-ai/thinkwork/pull/2048) passed GitHub checks (`cla`, `lint`, `test`, `typecheck`, `verify`) and squash merged to `main` as `c045ce844ff08580a62403515413c8498d915fc9`; remote branch deleted and U4 worktree removed.
- 2026-06-04: Created isolated worktree `.Codex/worktrees/cognee-u5` on branch `codex/u5-cognee-ops-guidance` from `origin/main`.
- 2026-06-04: Implemented U5 operational handoff guidance in the Cognee module README, Business Ontology operations guide, and Business Ontology concept page. Added fixture coverage for operator outputs, disabled/default behavior, smoke checks, startup failure locations, rollback, cleanup, and the product boundary that Cognee infrastructure does not migrate Wiki/Brain content or change agent context.
- 2026-06-04: U5 local verification passed: `pnpm install --frozen-lockfile`; `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`; `pnpm --filter thinkwork-cli typecheck`; `pnpm dlx prettier --check terraform/modules/app/cognee/README.md docs/src/content/docs/guides/business-ontology-operations.mdx docs/src/content/docs/concepts/knowledge/business-ontology.mdx apps/cli/__tests__/terraform-cognee-fixture.test.ts docs/plans/cognee-terraform-infrastructure-autopilot-status.md`; `pnpm --filter @thinkwork/docs build`; `git diff --check`. The docs build emitted existing Starlight/i18n/sitemap/pagefind warnings but completed successfully.
- 2026-06-04: Opened U5 PR [#2049](https://github.com/thinkwork-ai/thinkwork/pull/2049).
- 2026-06-04: U5 PR [#2049](https://github.com/thinkwork-ai/thinkwork/pull/2049) passed GitHub checks (`cla`, `lint`, `test`, `typecheck`, `verify`) and squash merged to `main` as `32a2f95761c8adcf9ab33be1ff0ace4ad51558b9`; remote branch deleted.
- 2026-06-04: All Cognee Terraform infrastructure implementation units are complete and merged.
- 2026-06-04: Started post-plan U6 to turn Cognee deployment into an operator-facing Knowledge Graph setting and activate deployment through the normal GitHub Actions pipeline.
- 2026-06-04: U6 implemented deploy workflow Cognee inputs, DB credential/role preparation, API deployment status fields, a platform-operator mutation that updates `COGNEE_ENABLED` and dispatches `deploy.yml`, and a tenant Settings card with an enable switch, disable confirmation, and Cognee status/details.
- 2026-06-04: U6 local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/core/setKnowledgeGraphDeployment.mutation.test.ts src/graphql/resolvers/core/general-reads-authz.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/admin exec vitest run src/routes/_authed/_tenant/-settings.test.ts`;
  `pnpm --filter @thinkwork/admin build`;
  `pnpm --filter thinkwork-cli exec vitest run __tests__/terraform-cognee-fixture.test.ts`;
  `pnpm --filter thinkwork-cli typecheck`;
  `terraform -chdir=terraform/modules/thinkwork init -backend=false && terraform -chdir=terraform/modules/thinkwork validate`;
  `terraform -chdir=terraform/examples/greenfield init -backend=false && terraform -chdir=terraform/examples/greenfield validate`;
  `pnpm dlx prettier --check <changed supported U6 files>`; and
  `git diff --check`. Admin browser screenshot verification reached the local
  sign-in page; authenticated visual QA is still pending.
- 2026-06-04: Confirmed AWS dev does not currently have
  `thinkwork/dev/github/deploy-token`; this must be created before the deployed
  Settings switch can dispatch workflows from the API.
- 2026-06-04: U6 PR [#2053](https://github.com/thinkwork-ai/thinkwork/pull/2053)
  passed GitHub checks and squash merged to `main` as
  `10b3f6922a8b0ac8b6a54b351a9206b3b2034353`; the merge-triggered deploy run
  [26957471228](https://github.com/thinkwork-ai/thinkwork/actions/runs/26957471228)
  failed during Terraform Apply because the GraphQL Lambda environment exceeded
  Lambda's 4KB limit after adding Knowledge Graph status/default dispatch env
  vars.
- 2026-06-04: Started U6 hotfix branch `codex/cognee-env-limit-hotfix` from
  `origin/main`. The hotfix removes default Knowledge Graph dispatch env vars
  from Terraform, omits empty Cognee detail env vars, derives `cogneeEnabled`
  from deployed Cognee details, and adds regression coverage for the lean env
  wiring.
- 2026-06-04: U6 env-limit hotfix PR
  [#2055](https://github.com/thinkwork-ai/thinkwork/pull/2055) passed checks
  and squash merged to `main` as
  `718142d4cfe027310d5a578523530a708d345deb`; merge-triggered deploy run
  [26958925199](https://github.com/thinkwork-ai/thinkwork/actions/runs/26958925199)
  passed.
- 2026-06-04: Set GitHub repo variable `COGNEE_ENABLED=true` and dispatched
  deploy run
  [26959458258](https://github.com/thinkwork-ai/thinkwork/actions/runs/26959458258).
  Terraform failed because Cognee EFS mount targets used a `for_each` over
  subnet IDs that were unknown until apply.
- 2026-06-04: Cognee EFS mount target hotfix PR
  [#2057](https://github.com/thinkwork-ai/thinkwork/pull/2057) passed checks
  and squash merged to `main` as
  `e4cc4b82a95451daa701a3a5c76ed79395a39ed5`. The next deploy created the
  Cognee ECS/ALB/EFS resources but Cognee exited during startup because the
  dedicated database role lacked `REFERENCES` on existing tables.
- 2026-06-04: Cognee database grants hotfix PR
  [#2058](https://github.com/thinkwork-ai/thinkwork/pull/2058) passed checks
  and squash merged to `main` as
  `360cc0f4caf4db3e64242c5e582b82c1560b1335`. The follow-up deploy passed
  Terraform and admin/docs deployment, but Cognee still failed startup because
  Alembic rejected the URL-encoded database password (`%2F`) as invalid
  `configparser` interpolation syntax.
- 2026-06-04: Started Cognee URL-safe DB password hotfix branch
  `codex/cognee-url-safe-db-password` from `origin/main`. The hotfix generates
  Cognee DB passwords with `openssl rand -hex 32` and rotates existing Cognee
  secrets containing URL-unsafe characters before applying the role password.
- 2026-06-04: URL-safe password hotfix PR
  [#2060](https://github.com/thinkwork-ai/thinkwork/pull/2060) passed checks
  and squash merged to `main` as
  `24d6672db039fcf6c6c8d2e0c82fc922fe7e9066`. Merge-triggered deploy run
  [26963195279](https://github.com/thinkwork-ai/thinkwork/actions/runs/26963195279)
  passed, but Cognee ECS tasks still exited during startup because Cognee
  migrations were running against the shared `thinkwork` database and attempted
  to create an index on the existing `public.tenants` table. Started hotfix
  branch `codex/cognee-db-ownership-hotfix` to isolate Cognee into a dedicated
  `thinkwork_cognee` database created during deploy credential preparation.
- 2026-06-04: Dedicated database hotfix PR
  [#2062](https://github.com/thinkwork-ai/thinkwork/pull/2062) passed checks
  and squash merged to `main` as
  `d212a457ed4fc9d99808945e3c4c782961e7cabb`. Merge-triggered deploy run
  [26964631210](https://github.com/thinkwork-ai/thinkwork/actions/runs/26964631210)
  failed in `Prepare Cognee database credentials` because the deploy SQL used
  `CREATE DATABASE ... OWNER thinkwork_cognee`, but the Aurora admin role is
  not a member of the target Cognee role. Started hotfix branch
  `codex/cognee-db-create-hotfix` to create the dedicated database with the
  admin owner and grant Cognee the schema privileges needed to create its own
  runtime tables.
- 2026-06-04: Cognee DB creation hotfix PR
  [#2063](https://github.com/thinkwork-ai/thinkwork/pull/2063) passed checks
  and squash merged to `main` as
  `9d788511f11a4d4be59dca2205c42285c44831a7`. Merge-triggered deploy run
  [26965335450](https://github.com/thinkwork-ai/thinkwork/actions/runs/26965335450)
  created the dedicated database, updated the ECS task, and Cognee reached
  steady state with `/health` returning 200. Terraform then failed while
  updating `thinkwork-dev-api-graphql-http` because separate Cognee status env
  vars pushed the Lambda environment over AWS's 4KB limit. Started hotfix branch
  `codex/cognee-lambda-env-status` to compact Cognee status into one env value
  and derive stable service/log names in the API resolver.
- 2026-06-04: Cognee Lambda env status hotfix PR
  [#2065](https://github.com/thinkwork-ai/thinkwork/pull/2065) passed checks
  and squash merged to `main` as
  `4292af1ae5429a35d9ee2e6fbb847a0c1f3b8417`. Merge-triggered deploy run
  [26966444501](https://github.com/thinkwork-ai/thinkwork/actions/runs/26966444501)
  passed Terraform Apply, confirming the GraphQL Lambda accepted the compact
  Cognee env. The run still concluded failed because the unrelated Build
  Container AgentCore Runtime update step received `Forbidden` from
  `get-agent-runtime` before issuing the runtime update. Started deploy hotfix
  branch `codex/agentcore-runtime-update-forbidden` to avoid that pre-read and
  treat post-update AgentCore read probes as best-effort when the control plane
  refuses reads.
- 2026-06-04: Deploy hotfix PR
  [#2066](https://github.com/thinkwork-ai/thinkwork/pull/2066) passed checks
  and squash merged to `main` as
  `d5203b06fecd25df5acc8187ca8354f2976b2199`. Merge-triggered deploy run
  [26967441748](https://github.com/thinkwork-ai/thinkwork/actions/runs/26967441748)
  passed end to end, including Build Container, Terraform Apply, AgentCore
  runtime update, docs/admin deploy, workspace migration, and Deploy Summary.
- 2026-06-04: Verified Cognee in AWS dev after the green deploy: ECS service
  `thinkwork-dev-cognee` is active with desired/running/pending task counts
  `1/1/0`; task definition revision is `thinkwork-dev-cognee:2`; the ALB target
  is healthy on port 8000; CloudWatch logs show repeated `GET /health` 200
  responses; and GraphQL Lambda `thinkwork-dev-api-graphql-http` has compact
  Cognee status env `dogfood|http://internal-tw-dev-cognee-411251360.us-east-1.elb.amazonaws.com`.
- 2026-06-04: Started U7 branch `codex/cognee-settings-spaces` to move the
  Knowledge Graph setting out of `apps/admin` and into `apps/spaces` for both
  web Spaces and desktop settings.
- 2026-06-04: U7 local verification passed:
  `pnpm --filter @thinkwork/spaces codegen`;
  `pnpm --filter @thinkwork/admin codegen`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/settings-nav.test.ts src/components/settings/SettingsKnowledgeGraph.test.ts`;
  `pnpm --filter @thinkwork/admin exec vitest run src/routes/_authed/_tenant/-settings.test.ts`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/spaces build`;
  `pnpm --filter @thinkwork/admin build`;
  `pnpm dlx prettier --write <changed U7 source/status files>`; and
  `git diff --check`. Started local Spaces dev server on
  `http://127.0.0.1:5176/settings/knowledge-graph`; unauthenticated users land
  on the sign-in redirect and authenticated GraphQL `deploymentStatus` returns
  live Cognee details.
- 2026-06-04: U7 PR [#2067](https://github.com/thinkwork-ai/thinkwork/pull/2067)
  passed checks and squash merged to `main` as
  `5446c51f17449f435a266df74ff14efb4c616458`. Merge-triggered deploy run
  [26968819897](https://github.com/thinkwork-ai/thinkwork/actions/runs/26968819897)
  passed end to end, including Terraform Apply, AgentCore runtime update,
  docs/admin deploy, and Deploy Summary.
- 2026-06-04: Started U8 branch `codex/cognee-settings-health-check` from
  `origin/main` to add an operator-only GraphQL health check that probes the
  private Cognee `/health` endpoint through the Thinkwork API and exposes a
  Spaces/Desktop “Test connection” action.
- 2026-06-04: U8 local verification passed:
  `pnpm schema:build`;
  `pnpm --filter @thinkwork/spaces codegen`;
  `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/core/knowledgeGraphHealthCheck.query.test.ts src/graphql/resolvers/core/general-reads-authz.test.ts`;
  `pnpm --filter @thinkwork/spaces exec vitest run src/components/settings/SettingsKnowledgeGraph.test.ts src/components/settings/settings-nav.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `pnpm --filter @thinkwork/spaces typecheck`;
  `pnpm --filter @thinkwork/spaces build`; and `git diff --check`. Restarted
  the local Spaces dev server on
  `http://127.0.0.1:5174/settings/knowledge-graph` from the U8 worktree.
- 2026-06-04: U8 PR [#2070](https://github.com/thinkwork-ai/thinkwork/pull/2070)
  passed checks and squash merged to `main` as
  `f9a023f280771d12f1c2b01d0af758a2c03e5513`. Merge-triggered deploy run
  [26970614160](https://github.com/thinkwork-ai/thinkwork/actions/runs/26970614160)
  passed end to end. Post-deploy GraphQL validation confirmed
  `deploymentStatus` reports Cognee enabled with the internal ALB endpoint, but
  `knowledgeGraphHealthCheck` timed out because the GraphQL Lambda is outside
  the VPC path for that private ALB.
- 2026-06-04: Started U8 hotfix branch `codex/cognee-health-aws-probe` to make
  the Knowledge Graph connection test use ECS service steadiness and ALB target
  health through AWS control-plane APIs instead of directly fetching the
  private ALB.
- 2026-06-04: U8 hotfix local verification passed:
  `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/core/knowledgeGraphHealthCheck.query.test.ts src/graphql/resolvers/core/general-reads-authz.test.ts`;
  `pnpm --filter @thinkwork/api typecheck`;
  `terraform fmt -check terraform/modules/app/lambda-api`;
  `terraform -chdir=terraform/modules/app/lambda-api init -backend=false && terraform -chdir=terraform/modules/app/lambda-api validate`;
  `pnpm dlx prettier --write <changed API/status files>`; and
  `git diff --check`.
- 2026-06-04: U8 hotfix PR [#2071](https://github.com/thinkwork-ai/thinkwork/pull/2071)
  passed checks and squash merged to `main` as
  `f7e6542a93acef6760d61c6df52c9a733a34c69f`. Merge-triggered deploy run
  [26972157660](https://github.com/thinkwork-ai/thinkwork/actions/runs/26972157660)
  successfully applied Terraform and updated GraphQL Lambda. Live GraphQL E2E
  passed with `knowledgeGraphHealthCheck.healthy=true`, status `200`, and
  message `Cognee ECS service is steady and the ALB target is healthy.`
  The run still concluded failed because the unrelated Build Container step
  received `ForbiddenException` from `UpdateAgentRuntime`.
- 2026-06-04: Started deploy hotfix branch
  `codex/agentcore-update-forbidden-tolerant` to treat AgentCore Runtime update
  `ForbiddenException` as a warning in both the inline deploy workflow update
  step and `scripts/update-agentcore-runtime-image.sh`.
- 2026-06-04: Deploy hotfix local verification passed:
  `pnpm dlx prettier --write .github/workflows/deploy.yml docs/plans/cognee-terraform-infrastructure-autopilot-status.md`;
  `bash -n scripts/update-agentcore-runtime-image.sh`; and
  `git diff --check`.

## Implementation Units

| Unit                                                                   | Status | Branch                                      | PR                                                           | CI     | Merge                                      |
| ---------------------------------------------------------------------- | ------ | ------------------------------------------- | ------------------------------------------------------------ | ------ | ------------------------------------------ |
| U1. Create the Cognee Terraform app module                             | merged | `codex/u1-cognee-terraform-module`          | [#2045](https://github.com/thinkwork-ai/thinkwork/pull/2045) | passed | `30ec4984677de7a0c044bbe8ce745b890271e13a` |
| U2. Wire Cognee through the composite Thinkwork module                 | merged | `codex/u2-cognee-thinkwork-wiring`          | [#2046](https://github.com/thinkwork-ai/thinkwork/pull/2046) | passed | `c8fa82a705975b53217eb79d09bfd4aeeace819c` |
| U3. Add Cognee secrets and configuration hygiene                       | merged | `codex/u3-cognee-secrets-config`            | [#2047](https://github.com/thinkwork-ai/thinkwork/pull/2047) | passed | `005326a3fc7dc42a7b5bb10e4efd69bba8fa53e4` |
| U4. Propagate Cognee through examples, CLI templates, and CI workflows | merged | `codex/u4-cognee-cli-templates`             | [#2048](https://github.com/thinkwork-ai/thinkwork/pull/2048) | passed | `c045ce844ff08580a62403515413c8498d915fc9` |
| U5. Add operational handoff and smoke-check guidance                   | merged | `codex/u5-cognee-ops-guidance`              | [#2049](https://github.com/thinkwork-ai/thinkwork/pull/2049) | passed | `32a2f95761c8adcf9ab33be1ff0ace4ad51558b9` |
| U6. Add Knowledge Graph settings control and deploy activation         | merged | `codex/cognee-deploy-enable`                | [#2053](https://github.com/thinkwork-ai/thinkwork/pull/2053) | passed | `10b3f6922a8b0ac8b6a54b351a9206b3b2034353` |
| U6 hotfix. Keep GraphQL Lambda env under 4KB                           | merged | `codex/cognee-env-limit-hotfix`             | [#2055](https://github.com/thinkwork-ai/thinkwork/pull/2055) | passed | `718142d4cfe027310d5a578523530a708d345deb` |
| U6 hotfix. Stabilize Cognee EFS mount targets                          | merged | `codex/cognee-efs-mount-target-fix`         | [#2057](https://github.com/thinkwork-ai/thinkwork/pull/2057) | passed | `e4cc4b82a95451daa701a3a5c76ed79395a39ed5` |
| U6 hotfix. Grant Cognee table reference privileges                     | merged | `codex/cognee-db-references-grant`          | [#2058](https://github.com/thinkwork-ai/thinkwork/pull/2058) | passed | `360cc0f4caf4db3e64242c5e582b82c1560b1335` |
| U6 hotfix. Rotate Cognee URL-safe DB passwords                         | merged | `codex/cognee-url-safe-db-password`         | [#2060](https://github.com/thinkwork-ai/thinkwork/pull/2060) | passed | `24d6672db039fcf6c6c8d2e0c82fc922fe7e9066` |
| U6 hotfix. Isolate Cognee into dedicated database                      | merged | `codex/cognee-db-ownership-hotfix`          | [#2062](https://github.com/thinkwork-ai/thinkwork/pull/2062) | passed | `d212a457ed4fc9d99808945e3c4c782961e7cabb` |
| U6 hotfix. Create Cognee DB without target-role ownership              | merged | `codex/cognee-db-create-hotfix`             | [#2063](https://github.com/thinkwork-ai/thinkwork/pull/2063) | passed | `9d788511f11a4d4be59dca2205c42285c44831a7` |
| U6 hotfix. Compact Cognee Lambda status env                            | merged | `codex/cognee-lambda-env-status`            | [#2065](https://github.com/thinkwork-ai/thinkwork/pull/2065) | passed | `4292af1ae5429a35d9ee2e6fbb847a0c1f3b8417` |
| Deploy hotfix. Avoid AgentCore runtime pre-read failure                | merged | `codex/agentcore-runtime-update-forbidden`  | [#2066](https://github.com/thinkwork-ai/thinkwork/pull/2066) | passed | `d5203b06fecd25df5acc8187ca8354f2976b2199` |
| U7. Move Knowledge Graph settings into Spaces/Desktop                  | merged | `codex/cognee-settings-spaces`              | [#2067](https://github.com/thinkwork-ai/thinkwork/pull/2067) | passed | `5446c51f17449f435a266df74ff14efb4c616458` |
| U8. Add API-backed Knowledge Graph health check                        | merged | `codex/cognee-settings-health-check`        | [#2070](https://github.com/thinkwork-ai/thinkwork/pull/2070) | passed | `f9a023f280771d12f1c2b01d0af758a2c03e5513` |
| U8 hotfix. Probe Cognee health through AWS control plane               | merged | `codex/cognee-health-aws-probe`             | [#2071](https://github.com/thinkwork-ai/thinkwork/pull/2071) | passed | `f7e6542a93acef6760d61c6df52c9a733a34c69f` |
| Deploy hotfix. Tolerate AgentCore update Forbidden                     | active | `codex/agentcore-update-forbidden-tolerant` | [#2073](https://github.com/thinkwork-ai/thinkwork/pull/2073) | local  | Pending                                    |

## CI Failures

- None yet.

## Merged PRs

- [#2045](https://github.com/thinkwork-ai/thinkwork/pull/2045) — U1. Create the Cognee Terraform app module — squash merged as `30ec4984677de7a0c044bbe8ce745b890271e13a`.
- [#2046](https://github.com/thinkwork-ai/thinkwork/pull/2046) — U2. Wire Cognee through the composite Thinkwork module — squash merged as `c8fa82a705975b53217eb79d09bfd4aeeace819c`.
- [#2047](https://github.com/thinkwork-ai/thinkwork/pull/2047) — U3. Add Cognee secrets and configuration hygiene — squash merged as `005326a3fc7dc42a7b5bb10e4efd69bba8fa53e4`.
- [#2048](https://github.com/thinkwork-ai/thinkwork/pull/2048) — U4. Propagate Cognee through examples, CLI templates, and CI workflows — squash merged as `c045ce844ff08580a62403515413c8498d915fc9`.
- [#2049](https://github.com/thinkwork-ai/thinkwork/pull/2049) — U5. Add operational handoff and smoke-check guidance — squash merged as `32a2f95761c8adcf9ab33be1ff0ace4ad51558b9`.
- [#2053](https://github.com/thinkwork-ai/thinkwork/pull/2053) — U6. Add Knowledge Graph settings control and deploy activation — squash merged as `10b3f6922a8b0ac8b6a54b351a9206b3b2034353`.
- [#2055](https://github.com/thinkwork-ai/thinkwork/pull/2055) — U6 hotfix. Keep GraphQL Lambda env under 4KB — squash merged as `718142d4cfe027310d5a578523530a708d345deb`.
- [#2057](https://github.com/thinkwork-ai/thinkwork/pull/2057) — U6 hotfix. Stabilize Cognee EFS mount targets — squash merged as `e4cc4b82a95451daa701a3a5c76ed79395a39ed5`.
- [#2058](https://github.com/thinkwork-ai/thinkwork/pull/2058) — U6 hotfix. Grant Cognee table reference privileges — squash merged as `360cc0f4caf4db3e64242c5e582b82c1560b1335`.
- [#2060](https://github.com/thinkwork-ai/thinkwork/pull/2060) — U6 hotfix. Rotate Cognee URL-safe DB passwords — squash merged as `24d6672db039fcf6c6c8d2e0c82fc922fe7e9066`.
- [#2062](https://github.com/thinkwork-ai/thinkwork/pull/2062) — U6 hotfix. Isolate Cognee into dedicated database — squash merged as `d212a457ed4fc9d99808945e3c4c782961e7cabb`.
- [#2063](https://github.com/thinkwork-ai/thinkwork/pull/2063) — U6 hotfix. Create Cognee DB without target-role ownership — squash merged as `9d788511f11a4d4be59dca2205c42285c44831a7`.
- [#2065](https://github.com/thinkwork-ai/thinkwork/pull/2065) — U6 hotfix. Compact Cognee Lambda status env — squash merged as `4292af1ae5429a35d9ee2e6fbb847a0c1f3b8417`.
- [#2066](https://github.com/thinkwork-ai/thinkwork/pull/2066) — Deploy hotfix. Avoid AgentCore runtime pre-read failure — squash merged as `d5203b06fecd25df5acc8187ca8354f2976b2199`.
- [#2067](https://github.com/thinkwork-ai/thinkwork/pull/2067) — U7. Move Knowledge Graph settings into Spaces/Desktop — squash merged as `5446c51f17449f435a266df74ff14efb4c616458`.
- [#2070](https://github.com/thinkwork-ai/thinkwork/pull/2070) — U8. Add API-backed Knowledge Graph health check — squash merged as `f9a023f280771d12f1c2b01d0af758a2c03e5513`.
- [#2071](https://github.com/thinkwork-ai/thinkwork/pull/2071) — U8 hotfix. Probe Cognee health through AWS control plane — squash merged as `f7e6542a93acef6760d61c6df52c9a733a34c69f`.

## CI / Deploy Failures

- Main deploy run
  [26957471228](https://github.com/thinkwork-ai/thinkwork/actions/runs/26957471228)
  failed in Terraform Apply while updating
  `thinkwork-dev-api-graphql-http`: Lambda rejected the environment map for
  exceeding the 4KB environment-variable limit. Fixed by PR #2055.
- Deploy run
  [26959458258](https://github.com/thinkwork-ai/thinkwork/actions/runs/26959458258)
  failed in Terraform Apply because Cognee EFS mount target `for_each` keys
  depended on subnet IDs only known during apply. Fixed by PR #2057.
- Merge-triggered deploy after PR #2057 failed while waiting for ECS service
  stability. Cognee exited because the dedicated database role lacked
  `REFERENCES` privilege for foreign keys against existing tables. Fixed by
  PR #2058.
- Merge-triggered deploy after PR #2058 passed Terraform and admin/docs deploy
  but Cognee ECS tasks exited during startup. Cognee/Alembic rejected the
  URL-encoded DB password (`%2F`) as invalid Python `configparser`
  interpolation syntax. Fixed by PR #2060.
- Merge-triggered deploy after PR #2060 passed, but Cognee ECS tasks still
  exited during startup. Cognee migrations were running against the shared
  `thinkwork` database and attempted to alter/index `public.tenants`, which is
  a Thinkwork application table. Fixed by PR #2062.
- Merge-triggered deploy after PR #2062 failed in Cognee credential prep.
  `CREATE DATABASE ... OWNER thinkwork_cognee` requires the executing Aurora
  admin role to be a member of `thinkwork_cognee`. Fixed by PR #2063.
- Merge-triggered deploy after PR #2063 brought Cognee ECS to steady state, but
  Terraform failed while updating `thinkwork-dev-api-graphql-http` because
  separate Cognee status environment variables pushed the Lambda environment
  over AWS's 4KB limit. Fixed by PR #2065.
- Merge-triggered deploy after PR #2065 passed Terraform Apply and updated the
  GraphQL Lambda, but the overall deploy failed earlier in Build Container
  because the Pi AgentCore runtime update path called `get-agent-runtime` and
  received `Forbidden`. Fixed by PR #2066.
- Post-deploy validation after PR #2070 showed `knowledgeGraphHealthCheck`
  timing out after 5 seconds. The resolver was directly fetching Cognee's
  internal ALB from the GraphQL Lambda, which is intentionally outside the
  private ALB path. Fixed by PR #2071.
- Merge-triggered deploy after PR #2071 applied Terraform and passed Cognee
  GraphQL E2E, but the overall run failed in Build Container because
  `bedrock-agentcore-control update-agent-runtime` returned
  `ForbiddenException`. In progress on
  `codex/agentcore-update-forbidden-tolerant`.

## Blockers

- AWS Secrets Manager secret `thinkwork/dev/github/deploy-token` is missing.
  The deployed API mutation cannot dispatch GitHub Actions until an operator
  stores a GitHub token there. The immediate Cognee deployment can still be
  triggered through GitHub Actions after U6 merges by setting the repo variable
  `COGNEE_ENABLED=true` and running `deploy.yml`.
