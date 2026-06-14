# THNK-18 Autopilot Status

Linear issue: THNK-18 - U2: Add tenant-scoped Cognee Brain provisioning contract
Parent: THNK-6 - ThinkWork Brain
Milestone: Company Brain dogfood proof
Branch: `codex/thnk-18-brain-provisioning-contract`
Target branch: `main`
Plan: `docs/plans/2026-06-14-003-feat-brain-provisioning-contract-plan.md`

## Current Status

- THNK-15 is Done and unblocks the Company Brain plugin shell dependency.
- THNK-17, THNK-19, and THNK-20 are Done on `main`.
- THNK-18 moved from `Ready to Work` to `In Progress` on 2026-06-14 when implementation began.
- Implementation is complete locally on one PR-sized unit; PR/CI/merge steps are pending.

## Discovery

- Read `AGENTS.md`.
- Read Compound Engineering `lfg`, `ce-plan`, `ce-work`, and Linear skill instructions.
- Fetched THNK-18 with relations, labels, project, milestone, state history, customer needs, releases, documents, and attachments.
- Fetched THNK-18 comments. Only the dispatcher/setup comment existed at discovery.
- Fetched parent THNK-6, blocker THNK-15, and sibling child issues THNK-17, THNK-19, and THNK-20.
- Fetched comments for THNK-6, THNK-15, THNK-17, THNK-19, and THNK-20.
- Fetched Linear documents:
  - Implementation plan: Company Brain physical substrate
  - Company Brain physical substrate requirements
  - OKF considered and deferred for Company Brain
  - Plan: Company Brain Premium Plugin
  - Brainstorm: Company Brain Premium Plugin
- Searched the repo for THNK-18, THNK-6, THNK-15, Company Brain, Brain substrate, Cognee, `desiredConfig`, Neptune Analytics, deployment runner, and related plan/status docs.
- Read prior autopilot ledgers for THNK-17, THNK-19, and THNK-20.

## Important Context

- Company Brain is the customer-facing premium product. Cognee remains internal substrate machinery and may appear only in operator evidence, Terraform, runner details, logs, and implementation docs.
- The current Cognee Terraform module is stage-wide by default: names derive from `thinkwork-${stage}-cognee` and ALB/target group names use `tw-${stage}-cognee`.
- THNK-17 added Brain substrate status/evidence fields consumed by this unit: tier, backend mode, graph/vector providers, endpoint, S3 roots, Neptune graph id/endpoint, EFS id, and deployment job ids.
- THNK-19 added canonical Brain S3 artifact bucket/roots and manifest contract.
- THNK-20 reads through Context Engine and depends on provider/capability status not silently falling back.

## Decisions

- Treat THNK-18 as one cohesive PR because it has no child issues.
- Reuse the existing `cognee` managed-app adapter and Terraform module; do not add a new customer-visible managed app key.
- Add tenant-scoped Brain instance identity through `desiredConfig` and Terraform variables rather than exposing raw Cognee environment variables to product UI.
- Keep default tier local and bounded; production tier uses Neptune Analytics graph/vector providers and does not introduce OpenSearch vector storage.
- Preserve the existing managed-app Step Functions payload contract and make its Brain-specific desiredConfig/state strategy explicit.

## Progress Log

- 2026-06-14: Created branch `codex/thnk-18-brain-provisioning-contract`.
- 2026-06-14: Moved THNK-18 to `In Progress`.
- 2026-06-14: Added this status ledger and the THNK-18 implementation plan.
- 2026-06-14: Added runner mapping for tenant-scoped Company Brain desiredConfig, default/production Brain tiers, explicit private-substrate security posture, canonical S3 roots, Neptune Analytics production fields, scoped S3/Neptune IAM inputs, and richer status evidence outputs.
- 2026-06-14: Seeded net-new Company Brain Cognee provisioning jobs with tenant-derived `brainTenantId`, stable `brainInstanceKey`, default tier, and private-substrate mode while preserving existing/adopted desired config for no-change evidence.
- 2026-06-14: Updated Cognee Terraform module and composite/greenfield wiring for tenant-derived resource names, tenant-scoped log/secret paths, default local stores, production Neptune endpoint handling, and evidence outputs.
- 2026-06-14: Documented the deployment-runner payload/state strategy and tier/security contracts in `terraform/modules/app/cognee/README.md`.

## Verification

- 2026-06-14: `pnpm install` completed workspace linking; `canvas@2.11.2` reported a native optional build failure under Node 25 because `pkg-config` is unavailable, but the targeted non-UI tests below ran successfully.
- 2026-06-14: `pnpm --filter @thinkwork/deployment-runner test -- deployment-runner-managed-apps.test.ts` passed.
- 2026-06-14: `pnpm --filter thinkwork-cli test -- __tests__/terraform-cognee-fixture.test.ts` passed.
- 2026-06-14: `pnpm --filter @thinkwork/api test -- src/lib/plugins/handlers/infra.test.ts` passed.
- 2026-06-14: `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
- 2026-06-14: `pnpm --filter @thinkwork/api typecheck` passed.
- 2026-06-14: `pnpm --filter thinkwork-cli typecheck` passed.
- 2026-06-14: `terraform fmt terraform/modules/app/cognee terraform/modules/thinkwork terraform/examples/greenfield` passed.
- 2026-06-14: `terraform -chdir=terraform/modules/app/cognee init -backend=false && terraform -chdir=terraform/modules/app/cognee validate` passed with existing AWS provider deprecation warnings for `data.aws_region.current.name`; generated `.terraform` files were removed.
- 2026-06-14: `terraform -chdir=terraform/examples/greenfield init -backend=false && terraform -chdir=terraform/examples/greenfield validate` passed; generated `.terraform` files were removed.
- 2026-06-14: `git diff --check` passed.
- 2026-06-14: `pnpm exec prettier --write ...` could not run because the workspace format script references `prettier` but the root workspace does not declare a Prettier dependency.

## Linear State Changes

- 2026-06-14: Moved THNK-18 from `Ready to Work` to `In Progress`.

## Blockers

- None currently.
