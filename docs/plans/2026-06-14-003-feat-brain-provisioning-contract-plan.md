---
title: "feat: Brain provisioning contract"
type: feat
status: active
date: 2026-06-14
origin: Linear THNK-18 / THNK-6 ThinkWork Brain physical substrate plan
linear: THNK-18
---

# feat: Brain provisioning contract

## Summary

Extend the existing internal the retired graph substrate managed-app path so ThinkWork Brain can plan
tenant-scoped Brain substrate instances. ThinkWork Brain remains the product
surface; the retired graph substrate is the internal runner/Terraform implementation detail.

THNK-18 covers U2 from the THNK-6 physical substrate plan: tenant-scoped Brain
instance identity, default/production tier config, explicit private-substrate
security posture, Neptune Analytics production settings, runner payload/state
contract evidence, and Terraform outputs needed by status, migration, and
operations surfaces.

## Requirements Trace

- R1. Default tier maps to Postgres metadata plus local LanceDB/Kuzu-style
  graph/vector persistence and is bounded to a single-task default posture.
- R2. Production tier maps graph/vector to Neptune Analytics and does not add
  direct OpenSearch vector storage.
- R3. Tenant Brain instances cannot collide on stage-wide resource names.
- R4. Runner contract is explicit for `phase`, `appKey`, `tenantId`, `jobId`,
  `desiredConfig`, evidence prefixes, and Terraform state strategy.
- R5. Data-impact and operator evidence distinguish canonical S3 artifacts,
  default local stores, production Neptune resources, EFS, and backend mode.
- R6. Raw the retired graph substrate environment variables remain internal; product/plugin copy
  says ThinkWork Brain or Brain substrate.

## Scope Boundaries

- No U4 migration orchestration or cutover.
- No U6 Brain operations UI.
- No direct OpenSearch vector storage.
- No external Brain MCP expansion.
- No manual deploys or production mutations.

## Implementation Units

### U1. Runner tier contract and evidence

Add typed config normalization in `packages/deployment-runner/src/apps/retired_graph_substrate.ts`
for `brainTenantId`, `brainInstanceKey`, `brainStorageTier`, canonical Brain S3
roots, private-substrate posture, and production Neptune graph/vector settings.
Keep defaults safe: `default` tier uses local LanceDB/Kuzu providers and
`production` uses Neptune Analytics providers. Add tests for tenant-scoped
Terraform variables, default/production mappings, data-impact text, and output
extraction.

Primary files:

- `packages/deployment-runner/src/apps/retired_graph_substrate.ts`
- `packages/deployment-runner/test/deployment-runner-managed-apps.test.ts`

### U2. Terraform module tenant identity and tier guardrails

Extend `terraform/modules/app/retired_graph_substrate` with tenant/instance variables, name
derivation, tier validation, security posture variables, canonical Brain S3
root variables, Neptune Analytics variables, and outputs for U1/U6 evidence.
Names must include a normalized instance identity so two tenants do not target
the same ALB, target group, ECS family, log group, EFS creation token, or secret
paths.

Primary files:

- `terraform/modules/app/retired_graph_substrate/variables.tf`
- `terraform/modules/app/retired_graph_substrate/main.tf`
- `terraform/modules/app/retired_graph_substrate/outputs.tf`
- `apps/cli/__tests__/terraform-retired_graph_substrate-fixture.test.ts`

### U3. Deployed runner contract documentation

Document the Step Functions payload and state strategy in the status ledger and
module docs, preserving the existing managed-app controller contract:
`schemaVersion`, `contract`, `phase`, `appKey`, `tenantId`, `jobId`,
`desiredConfig`, `evidence`, and tenant/job scoped evidence/state paths.

Primary files:

- `docs/plans/autopilot/THNK-18-status.md`
- `terraform/modules/app/retired_graph_substrate/README.md`

## Verification Plan

- `pnpm --filter @thinkwork/deployment-runner test`
- `pnpm --filter thinkwork-cli test -- __tests__/terraform-retired_graph_substrate-fixture.test.ts`
- `terraform -chdir=terraform/modules/app/retired_graph_substrate init -backend=false`
- `terraform -chdir=terraform/modules/app/retired_graph_substrate validate`
- `git diff --check`
