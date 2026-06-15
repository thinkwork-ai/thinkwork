# THNK-27 Autopilot Status

Issue: THNK-27 Add Plane Plugin

## Current State

- Linear state: `In Progress`.
- Labels: `Codex`, `Feature`.
- Active branch: `codex/thnk-27-plane-terraform`.
- Active unit: U4 Plane Terraform Runtime Module.
- U4 local verification complete; PR open for CI/review.

## Context Discovered

- Linear issue has no child issues, blockers, related issues, attachments, or
  customer needs.
- Linear documents point to repo-local requirements and plan files that were not
  present on `origin/main`; this branch restores concise repo-local copies from
  Linear context.
- Plane docs confirm Docker self-hosting, external Postgres/Redis/S3 support,
  RabbitMQ variables, and an official MCP server.
- Plane MCP HTTP PAT mode requires `x-api-key` and `x-workspace-slug` request
  headers. Current ThinkWork plugin MCP dispatch supports OAuth/bearer and
  `auth: none`, so Plane MCP activation is a later unit before publishing the
  MCP component.

## Implementation Units

- [x] U1 Plane Contract Proof
- [x] U2 Plugin Manifest and Catalog Entry
- [x] U3 Plane Managed-App Adapter
- [x] U4 Plane Terraform Runtime Module
- [ ] U5 Per-User Plane MCP Activation
- [ ] U6 Plane Issue-Loop Skill
- [ ] U7 Plane Seed and End-to-End Smoke
- [ ] U8 Release Packaging and Controller Wiring
- [ ] U9 Docs, Rollout, and Operator Copy

## PRs

- U1 Plane Contract Proof:
  `https://github.com/thinkwork-ai/thinkwork/pull/2488` merged at
  `d4614c5f78f325c8bde77e4e4be3147d640cc7bd`.
- U2 Plugin Manifest and Catalog Entry:
  `https://github.com/thinkwork-ai/thinkwork/pull/2489` merged at
  `5d0ed19b39f40d15764c3a1463c9829d8989fd62`.
- U3 Plane Managed-App Adapter:
  `https://github.com/thinkwork-ai/thinkwork/pull/2490` merged at
  `eee5b4d6df6221dfb69df89606f0603e63dcdb07`.
- U4 Plane Terraform Runtime Module:
  `https://github.com/thinkwork-ai/thinkwork/pull/2491` opened from
  `codex/thnk-27-plane-terraform`.

## Verification Log

- `pnpm --filter @thinkwork/deployment-runner test` passed.
- `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
- `pnpm --filter @thinkwork/api test -- managed-applications.test.ts` passed.
- `pnpm --filter @thinkwork/api typecheck` passed.
- `pnpm format:check` currently fails because the root `format:check` script
  invokes `prettier`, but Prettier is not installed or declared in this
  workspace. Touched files were formatted with
  `pnpm dlx prettier@3.6.2 --write ...`.
- U2: `pnpm --filter @thinkwork/plugin-catalog test -- plane-manifest.test.ts`
  passed.
- U2: `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- U2: `pnpm --filter @thinkwork/plugin-catalog test` passed.
- U3: `pnpm --filter @thinkwork/api test -- plane-manifest-parity.test.ts`
  passed.
- U3: `pnpm --filter @thinkwork/api typecheck` passed.
- U3: `pnpm --filter @thinkwork/plugin-catalog test -- plane-manifest.test.ts`
  passed.
- U4: `pnpm --filter thinkwork-cli test -- terraform-plane-fixture.test.ts`
  passed.
- U4: `pnpm --filter thinkwork-cli typecheck` passed.
- U4: `terraform -chdir=terraform/modules/app/plane init -backend=false &&
  terraform -chdir=terraform/modules/app/plane validate` passed; generated
  `.terraform/` and `.terraform.lock.hcl` artifacts were removed.
- U4: `terraform -chdir=terraform/modules/thinkwork init -backend=false`
  passed, but direct `terraform validate` of the composite module reports the
  existing standalone validation limitation: the module requires callers to pass
  the aliased provider `aws.us_east_1`. Generated Terraform artifacts were
  removed.
- U4: `terraform -chdir=terraform/examples/greenfield init -backend=false &&
  terraform -chdir=terraform/examples/greenfield validate` passed; generated
  `.terraform/` and `.terraform.lock.hcl` artifacts were removed.

## Decisions

- Do not register Plane in the published plugin catalog until the Terraform
  module and per-user MCP activation path are executable.
- Start with the adapter contract and proof tests so later Terraform/catalog
  units have a stable shape.
- Plane is registered in the deployment runner for contract proofing, but is
  hidden from the operator managed-app catalog with `catalogVisible: false`
  until the runtime module and release/controller wiring are ready.
- Plane manifest is exported for tests and later units, but is not added to
  `allPluginManifests` until the Terraform runtime and per-user MCP activation
  path are executable.
