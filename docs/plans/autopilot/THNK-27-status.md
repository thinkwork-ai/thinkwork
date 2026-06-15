# THNK-27 Autopilot Status

Issue: THNK-27 Add Plane Plugin

## Current State

- Linear state: `In Progress`.
- Labels: `Codex`, `Feature`.
- Active branch: `codex/thnk-27-plane-smoke`.
- Active unit: U7 Plane Seed and End-to-End Smoke.
- U6 merged via PR #2493.

## Context Discovered

- Linear issue has no child issues, blockers, related issues, attachments, or
  customer needs.
- Linear documents point to repo-local requirements and plan files that were not
  present on `origin/main`; this branch restores concise repo-local copies from
  Linear context.
- Plane docs confirm Docker self-hosting, external Postgres/Redis/S3 support,
  RabbitMQ variables, and an official MCP server.
- Plane MCP HTTP PAT mode requires `x-api-key` and `x-workspace-slug` request
  headers. U5 adds a user-provided header auth mode that stores those values in
  per-user plugin activation secrets and emits them only for the active
  requester.

## Implementation Units

- [x] U1 Plane Contract Proof
- [x] U2 Plugin Manifest and Catalog Entry
- [x] U3 Plane Managed-App Adapter
- [x] U4 Plane Terraform Runtime Module
- [x] U5 Per-User Plane MCP Activation
- [x] U6 Plane Issue-Loop Skill
- [x] U7 Plane Seed and End-to-End Smoke
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
  `https://github.com/thinkwork-ai/thinkwork/pull/2491` merged at
  `88263e18d13746f2838001df15aa9ec9f998f189`.
- U5 Per-User Plane MCP Activation:
  `https://github.com/thinkwork-ai/thinkwork/pull/2492` merged at
  `5920aa8b1fc9273a27ef978439783b096176884f`.
- U6 Plane Issue-Loop Skill:
  `https://github.com/thinkwork-ai/thinkwork/pull/2493` merged at
  `393f257c1a1546d5eabc843f08c4c19af8c2ee88`.
- Pending: U7 branch `codex/thnk-27-plane-smoke`.

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
- U5: `pnpm --filter @thinkwork/plugin-catalog test -- contracts.test.ts
plane-manifest.test.ts` passed.
- U5: `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- U5: `pnpm --filter @thinkwork/api test -- activation.test.ts mcp.test.ts
mcp-configs-plugin-auth.test.ts mcp-client-call.test.ts
plane-manifest-parity.test.ts plugins-resolvers.test.ts` passed with 87 tests,
  including shared-endpoint header secret merge coverage.
- U5: `pnpm --filter @thinkwork/api typecheck` passed.
- U5: `pnpm --filter @thinkwork/agentcore-pi test -- mcp.test.ts
server.test.ts` passed.
- U5: `pnpm --filter @thinkwork/agentcore-pi typecheck` passed.
- U5: `pnpm --filter @thinkwork/web typecheck` passed.
- U5: `pnpm --filter @thinkwork/mobile typecheck` reported no matching
  `typecheck` script.
- U5: `pnpm --filter thinkwork-cli typecheck` passed.
- U5: `pnpm schema:build` passed; `pnpm --filter @thinkwork/web codegen`,
  `pnpm --filter @thinkwork/mobile codegen`, and
  `pnpm --filter thinkwork-cli codegen` passed. `@thinkwork/api` has no
  selected `codegen` script.
- U5: `git diff --check` passed.
- U5: Browser verification not applicable; this unit is backend/runtime
  activation plumbing with no new local UI surface.
- U5: PR #2492 CI passed (`cla`, `lint`, `verify`, `typecheck`, `test`) and
  was squash-merged.
- U6: `pnpm --filter @thinkwork/plugin-catalog test --
plane-manifest.test.ts` passed.
- U6: `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
- U6: `git diff --check` passed.
- U6: Browser verification not applicable; this unit only updates bundled
  plugin skill prompt content.
- U6: PR #2493 CI passed (`cla`, `lint`, `verify`, `typecheck`, `test`) and
  was squash-merged.
- U7: `node --check scripts/smoke/plane-managed-app-smoke.mjs && node --check
scripts/smoke/plane-mcp-smoke.mjs` passed.
- U7: `COMPUTER_ENV_FILE=none node scripts/smoke/plane-managed-app-smoke.mjs &&
COMPUTER_ENV_FILE=none node scripts/smoke/plane-mcp-smoke.mjs` passed dry-run
  mode.
- U7: `COMPUTER_ENV_FILE=none SMOKE_ENABLE_PLANE_MANAGED_APP=1
SMOKE_PLANE_URL=http://example.com node scripts/smoke/plane-managed-app-smoke.mjs`
  failed as expected with the HTTPS guard.
- U7: `COMPUTER_ENV_FILE=none SMOKE_ENABLE_PLANE_MCP=1 node
scripts/smoke/plane-mcp-smoke.mjs` failed as expected with the missing Plane MCP
  credential/env guard.
- U7: `pnpm --filter @thinkwork/deployment-runner test --
deployment-runner-managed-apps.test.ts` passed.
- U7: `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
- U7: `git diff --check` passed.

## Decisions

- Do not register Plane in the published plugin catalog until release packaging
  and controller wiring are ready.
- Start with the adapter contract and proof tests so later Terraform/catalog
  units have a stable shape.
- Plane is registered in the deployment runner for contract proofing, but is
  hidden from the operator managed-app catalog with `catalogVisible: false`
  until the runtime module and release/controller wiring are ready.
- Plane manifest is exported for tests and later units, but is not added to
  `allPluginManifests` until release packaging/controller wiring and smoke
  coverage are ready.
- Plane's MCP component now uses `auth.mode: user-provided-headers`; user
  activations store PAT/workspace values per requester in
  `user_plugin_activation_tokens` secrets, while `tenant_mcp_servers.auth_config`
  stores only non-secret header binding metadata.
- U5 groups user-provided header credentials by normalized MCP resource before
  writing secrets so multiple components sharing one endpoint retain the full
  header set.
- U6 expands the bundled `plane--issue-loop` skill in the Plane manifest rather
  than creating a second skill source path; plugin skills currently seed from
  manifest `skillMd` strings.
- U7 adds two live-gated smoke scripts: a read-only Plane managed-app health
  smoke for deployment controller evidence and a Plane MCP seed/write smoke
  with direct Plane MCP and optional ThinkWork proxy modes. The MCP write path
  requires `SMOKE_PLANE_MCP_WRITE=1` so dry-run and read checks cannot mutate
  Plane accidentally.
