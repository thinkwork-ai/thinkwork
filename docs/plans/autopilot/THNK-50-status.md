---
title: THNK-50 n8n Plugin Autopilot Status
linear: THNK-50
status: active
started: 2026-06-19
marker: dispatcher:THNK-50:Ready to Work:Codex
---

# THNK-50 n8n Plugin Autopilot Status

## Source Context

- Linear issue: THNK-50, "n8n Plugin"
- Current implementation marker: `dispatcher:THNK-50:Ready to Work:Codex`
- Attached requirements document: `Requirements: n8n Application Plugin`
- Attached plan document: `Plan: Add n8n application plugin`
- Repo-local requirements on main:
  `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md`
- Repo-local plan:
  `docs/plans/2026-06-19-003-feat-n8n-application-plugin-plan.md`

Context discovery found no child Linear issues or additional Linear documents
beyond the issue, comments, requirements document, plan document, and
`homecareintel/n8n` attachment. The Linear-attached plan names the repo-local
plan above as the detailed source of truth, but that plan file was not present
on `origin/main` when U1 started, so this branch includes it as an artifact
before implementation code lands.

## Implementation Units

1. U1: Create the n8n first-party package scaffold.
2. U2: Add the n8n managed-app adapter and greenfield desired-config contract.
3. U3: Build the n8n Terraform runtime module.
4. U4: Implement pinned package validation and controlled package image builds.
5. U5: Add tenant service credential MCP support for plugin MCP servers.
6. U6: Add n8n Plugin Detail package settings.
7. U7: Publish the final manifest, smokes, docs, and agent instructions.
8. U8: Run end-to-end deployed ThinkWork verification and Linear handoff.

Dependency order follows the approved plan: U1 before U2/U4/U5; U2 before U3;
U3/U4/U5/U6 before U7; U7 before U8.

## State Changes

| Time (UTC)       | State Change                                        | Evidence                                                          |
| ---------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| 2026-06-19 14:57 | THNK-50 moved from `Ready to Work` to `In Progress` | Linear update plus comment `fdd24632-1250-4681-8f93-95f001832cd2` |

## Unit Log

### U1: n8n First-Party Package Scaffold

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u1-n8n-scaffold`
- Git branch: `codex/thnk-50-u1-n8n-scaffold`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2691
- Merge commit: `3a5ef6cb4169bf4483b5df076fd233287a7da0b5`
- Objective: add `plugins/n8n/` package metadata, draft manifest constants,
  package descriptor, README, package-local tests, and source-boundary
  registration without publishing a final catalog-visible n8n manifest.
- Status: merged.
- Verification:
  - `pnpm --filter @thinkwork/plugin-n8n test` passed.
  - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-n8n build` passed.
  - `pnpm --filter @thinkwork/plugin-catalog test -- plugin-registry` passed.
  - `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins` passed.
  - `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`
    passed.
  - `node scripts/verify-plugin-source-boundary.mjs` passed.
  - `pnpm dlx prettier@latest --check <touched files>` passed.

### U2: n8n Managed-App Adapter and Desired Config Contract

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u2-n8n-managed-app`
- Git branch: `codex/thnk-50-u2-n8n-managed-app`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2694
- Merge commit: `f751fa509c14452f402171d02eda06f37ac003ec`
- Objective: add a real package-owned `n8nAdapter`, register it in the
  deployment-runner managed-app registry, define conservative desired-config
  inputs/defaults, and add runner/API tests for plan/apply summaries and
  greenfield plan job creation without publishing the final catalog manifest.
- Status: merged.
- Local implementation summary:
  - Added package-owned `n8nAdapter` under `plugins/n8n/src/deployment/` with
    queue-mode plan variables, required secret/public URL inputs, destroy data
    impact, pre-destroy steps, smoke contract, and Terraform status output
    extraction.
  - Registered `n8n` in the deployment-runner managed-app registry and runner
    input parser, including release-manifest image hydration keys.
  - Added API desired-config defaults for net-new n8n plugin infra plan jobs:
    `thinkwork_n8n`, default storage prefix, queue service counts, public URL
    derivation, secret/image/storage/certificate env inputs, and package spec
    env parsing.
  - Added API managed-application status projection for n8n with queue-mode
    service/log defaults, retained database/storage metadata, and native MCP
    readiness messaging.
  - Widened the managed-app settings row helper so n8n and Plane route to their
    own Plugin Detail pages instead of being coerced to Company Brain.
- Verification:
  - `pnpm --filter @thinkwork/plugin-n8n test` passed.
  - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-n8n build` passed.
  - `pnpm --filter @thinkwork/deployment-runner test -- deployment-runner-managed-apps`
    passed.
  - `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
  - `pnpm --filter @thinkwork/api test -- managedApplications infra` passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `node scripts/verify-plugin-source-boundary.mjs` passed.
  - `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`
    passed.
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins` passed.
  - `pnpm --filter @thinkwork/plugin-catalog test -- plugin-registry` passed.
  - `prettier --check <touched files>` passed via the lockfile-resolved
    Prettier 3.8.2 CLI.

### U3: n8n Terraform Runtime Module

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u3-n8n-terraform`
- Git branch: `codex/thnk-50-u3-n8n-terraform`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2696
- Merge commit: `0780b93acd800de5dfe61b46718502ace949a76c`
- Objective: add the package-owned n8n Terraform runtime module, wire it
  through the composite ThinkWork module, greenfield example, DNS module, and
  structural fixture tests, while preserving retained-substrate parking
  semantics and queue-mode defaults.
- Additional user-requested tweak folded into this unit: rename catalog entries
  `Resend Channel` -> `Resend Email` and `SendGrid` -> `SendGrid Email`, and
  sort plugin catalog rows alphabetically by display name.
- Status: merged.
- Local implementation summary:
  - Added the package-owned `plugins/n8n/terraform/n8n` module with an HTTPS ALB,
    Fargate main/worker services, managed Valkey queue substrate, S3 artifact
    bucket support, CloudWatch logs, IAM, security groups, Aurora ingress, and
    queue-mode n8n runtime defaults.
  - Wired n8n into the composite ThinkWork Terraform module, greenfield example,
    Cloudflare DNS module, and structural CLI fixture tests.
  - Preserved OSS-safe storage defaults (`database` execution/binary data modes)
    while documenting the enterprise-gated S3 binary-data path.
  - Validated pinned n8n package specs at the Terraform boundary and derived the
    package-name allow list used by `NODE_FUNCTION_ALLOW_EXTERNAL`.
  - Updated Resend/SendGrid catalog naming and sorted catalog/web plugin rows by
    display name.
- Verification:
  - `terraform fmt plugins/n8n/terraform/n8n terraform/modules/thinkwork terraform/modules/app/www-dns terraform/examples/greenfield`
    passed.
  - `terraform fmt -check plugins/n8n/terraform/n8n terraform/modules/thinkwork terraform/modules/app/www-dns terraform/examples/greenfield`
    passed.
  - `terraform -chdir=plugins/n8n/terraform/n8n init -backend=false && terraform -chdir=plugins/n8n/terraform/n8n validate`
    passed.
  - `terraform -chdir=terraform/examples/greenfield init -backend=false && terraform -chdir=terraform/examples/greenfield validate`
    passed.
  - `pnpm --filter @thinkwork/plugin-n8n test && pnpm --filter @thinkwork/plugin-n8n typecheck && pnpm --filter @thinkwork/plugin-n8n build`
    passed.
  - `pnpm --filter thinkwork-cli test -- terraform-n8n-fixture` passed.
  - `pnpm --filter @thinkwork/plugin-catalog test -- catalog` passed.
  - `pnpm --filter @thinkwork/plugin-catalog test -- plugin-registry contracts`
    passed.
  - `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins` passed.
  - `pnpm --filter @thinkwork/web test -- PluginsPage` passed.
  - `pnpm --filter @thinkwork/web test -- PluginDetail` passed.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-email-channel test -- manifest` passed.
  - `pnpm --filter @thinkwork/plugin-sendgrid test -- manifest` passed.
  - `pnpm --filter @thinkwork/plugin-email-channel typecheck && pnpm --filter @thinkwork/plugin-sendgrid typecheck`
    passed.
  - `node scripts/verify-plugin-source-boundary.mjs` passed.
  - `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`
    passed.
  - `prettier --check <touched non-HCL files>` passed via the
    lockfile-resolved Prettier 3.8.2 CLI.
  - `git diff --check` passed.
- CI:
  - PR #2696 initial `Validate signed catalog build` failed because
    `plugins/catalog/src/__tests__/plugin-package.test.ts` still expected
    aggregate manifests in plugin-key order. Fixed the assertion to match the
    new display-name order used by `allPluginManifests`.
  - PR #2696 final checks passed: signed catalog build, lint, test, typecheck,
    verify, and CLA.

### U4: Pinned Package Validation and Controlled Image Builds

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u4-n8n-package-builds`
- Git branch: `codex/thnk-50-u4-n8n-package-builds`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2702
- Merge commit: `7fe3a3b4ac00d4c398a04ec513b229ca5c382295`
- Objective: add package-owned pinned public npm package validation,
  deterministic package config normalization/digesting, controlled n8n wrapper
  image build contracts, runtime Dockerfile/task-runner templates, and
  deployment-runner plan/apply safeguards so package config changes produce
  reviewed digest-pinned images before Terraform apply.
- Status: merged.
- Linear status:
  - PR/evidence comment posted with marker
    `dispatcher:THNK-50:Ready to Work:Codex`.
  - Attempted to move THNK-50 to `Review` and `In Review` after PR open, but
    Linear returned the issue still in `In Progress`; leaving it there until PR
    merge because no accepted review state was exposed through the Linear tool.
- Local implementation summary:
  - Added `plugins/n8n/src/package-config.ts` to accept only exact public npm
    package specs, reject ranges/tags/URLs/paths/workspace aliases, collapse
    duplicate same-version specs, reject conflicting versions, sort packages
    deterministically, and compute a stable sha256 package config digest.
  - Added `plugins/n8n/src/deployment/image-build.ts` to describe the
    controlled package image build contract: idempotency key inputs, base image
    digest, normalized package digest, digest-pinned output image, task-runner
    allow-list value, evidence artifacts, and a no-runtime-secrets security
    boundary.
  - Added `plugins/n8n/runtime/Dockerfile` and
    `plugins/n8n/runtime/n8n-task-runners.json.template` so controlled wrapper
    builds install generated package-lock dependencies into n8n's module tree
    and register the `NODE_FUNCTION_ALLOW_EXTERNAL` allow-list for external
    task runners.
  - Extended the n8n managed-app adapter so `imageUri` remains the pinned base
    image, non-empty custom package specs require a digest-pinned
    `packageImageUri`, package digests are recomputed and verified before plan
    or apply, and Terraform receives normalized package specs plus the approved
    package image URI.
  - Extended deployment-runner summaries with optional `imageBuild` evidence and
    passed tenant/release context into adapters so package image changes alter
    the managed-app plan digest.
  - Added API desired-config handoff fields for
    `THINKWORK_N8N_PACKAGE_IMAGE_URI` and
    `THINKWORK_N8N_PACKAGE_IMAGE_CONFIG_DIGEST`.
- Local verification:
  - `pnpm install` completed; optional `canvas@2.11.2` native fallback reported
    missing local `pkg-config`, but package installation completed and the
    touched packages do not depend on that native module.
  - `pnpm --filter @thinkwork/plugin-n8n test` passed.
  - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
  - `pnpm --filter @thinkwork/deployment-runner test` passed.
  - `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
  - `pnpm --filter @thinkwork/api test -- src/lib/plugins/handlers/infra.test.ts`
    passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm lint:plugin-source` passed.
  - `git diff --check` passed.
- CI:
  - PR #2702 passed signed catalog build, lint, test, typecheck, verify, and
    CLA after rebase/fix cycles, then squash-merged to `main`.

### U5: Tenant Service Credential MCP Support

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u5-n8n-service-credential`
- Git branch: `codex/thnk-50-u5-n8n-service-credential`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2706
- Merge commit: `af1e003f30dc69b09c821f4cc03a79e0a55d8e60`
- Objective: add a generic plugin MCP `tenant-service-credential` manifest
  contract, provision plugin-owned `service_credential` MCP rows from
  managed-app desired config, resolve credentials server-side during dispatch,
  and make n8n's native MCP endpoint path/secret key ready for final catalog
  publication without requiring per-user activation.
- Status: merged.
- Linear status:
  - PR/evidence comment posted with marker
    `dispatcher:THNK-50:Ready to Work:Codex` (`2ae1d740-b8f5-48a6-a125-a489651627f8`).
  - Attempted to move THNK-50 to `Review` after opening PR #2706, but Linear
    returned the issue still in `In Progress`; leaving it there until PR merge
    because no accepted review state was exposed through the Linear tool.
- Local implementation summary:
  - Extended the plugin catalog MCP auth contract with
    `tenant-service-credential`, including validation that manifests carry only
    non-secret metadata: credential kind, managed-app secret-ref config key,
    and header bindings sourced from secret JSON keys.
  - Added plugin MCP provisioning support for `auth_type:
"service_credential"` rows, resolving the tenant secret ref from the
    managed application's `desired_config` and storing no raw credential value.
  - Added runtime dispatch support that fetches the tenant service credential
    from Secrets Manager and maps Bearer-shaped Authorization bindings into
    the Pi bearer-handle path rather than raw extra headers.
  - Recorded the verified n8n instance-level MCP path
    `/mcp-server/http` plus the planned service credential kind/key in the
    n8n draft manifest scaffold while keeping the plugin unpublished.
- Local verification:
  - `pnpm install` completed; optional `canvas@2.11.2` native build fallback
    still reports missing local `pkg-config`, but installation completed and
    the touched packages do not depend on that native module.
  - `pnpm --filter @thinkwork/plugin-catalog test -- contracts` passed.
  - `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins` passed.
  - `pnpm --filter @thinkwork/plugin-n8n test -- manifest` passed.
  - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
  - `pnpm --filter @thinkwork/api test -- src/lib/plugins/handlers/mcp.test.ts src/lib/__tests__/mcp-configs-plugin-auth.test.ts`
    passed.
  - `pnpm --filter @thinkwork/api test -- src/lib/__tests__/mcp-configs-approved-filter.test.ts`
    passed.
  - `pnpm --filter @thinkwork/api test -- src/lib/plugins/dispatch-parity.test.ts`
    passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm lint:plugin-source` passed.
  - `pnpm dlx prettier@latest --check <touched files>` passed.
  - `git diff --check` passed.
- CI:
  - PR #2706 passed signed catalog build, CLA, lint, test, typecheck, and
    verify after rebase/fix cycles, then squash-merged to `main`.

### U6: n8n Plugin Detail Package Settings

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u6-n8n-settings`
- Git branch: `codex/thnk-50-u6-n8n-settings`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2708
- Merge commit: `352dd54ce20bc9dd281fa0d790ceb39fecbc1727`
- Objective: add an operator-only n8n Plugin Detail settings surface for pinned
  custom Code node packages, backed by package-owned package validation and a
  GraphQL mutation that updates managed-app desired config by creating a
  reviewable `UPGRADE` plan job.
- Status: merged.
- Local implementation summary:
  - Added `n8nPluginSettings` and `updateN8nPluginPackageSettings` GraphQL
    operations, operator-gated against the installed n8n plugin and tenant
    managed-application row.
  - Reused the package-owned `plugins/n8n/src/package-config.ts` validator in
    both API and web, swapping its digest implementation to a browser-safe
    `@noble/hashes` sha256 helper.
  - Added an n8n Plugin Detail settings panel for package rows, comma/newline
    paste, normalized digest preview, duplicate collapse messaging,
    validation errors, latest job review, and plan-job creation.
  - Regenerated GraphQL client types for web, CLI, and mobile consumers after
    extending the shared GraphQL schema.
  - Documented the shared API/UI n8n settings files in the plugin source
    boundary allowlist while keeping package-specific validation and runtime
    policy under `plugins/n8n/`.
  - CE code review found and fixed one idempotency edge case: reusing a package
    settings idempotency key for a different package digest now returns
    `CONFLICT` instead of echoing a misleading settings payload.
- Local verification:
  - `pnpm --filter @thinkwork/plugin-n8n test -- package-config` passed.
  - `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/plugins/n8n-settings.test.ts`
    passed.
  - `pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginDetail.test.tsx`
    passed.
  - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
  - `pnpm --filter @thinkwork/api typecheck` passed.
  - `pnpm --filter @thinkwork/web typecheck` passed.
  - `pnpm schema:build` passed and produced no `terraform/schema.graphql`
    diff.
  - `pnpm --filter thinkwork-cli typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-n8n build` passed.
  - `pnpm lint:plugin-source` passed.
  - `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`
    passed.
  - `pnpm --filter @thinkwork/web build` passed. It emitted existing
    route/sourcemap/chunk-size warnings but no build failure.
  - `git diff --check` passed.
  - `pnpm dlx prettier@latest --check <touched files>` passed.
  - CE code review artifact:
    `.context/compound-engineering/ce-code-review/20260619-184234-549a8794/summary.md`;
    residual actionable work: none.
- CI:
  - PR #2708 passed signed catalog build, CLA, lint, test, typecheck, and
    verify after rebase/fix cycles, then squash-merged to `main`.

### U7: Publish Manifest, Smokes, Docs, and Agent Instructions

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u7-n8n-publish`
- Git branch: `codex/thnk-50-u7-n8n-publish`
- PR: https://github.com/thinkwork-ai/thinkwork/pull/2709
- Merge commit: `ededec8828cd4415c8ae2c7209ed2a31c0652d6d`
- Objective: publish the final n8n catalog manifest, remove the deferred
  publication gate, regenerate the first-party plugin registry, add package
  smokes and bundled workflow-operator instructions, and document the
  operator install/MCP/custom-package/teardown paths.
- Status: merged.
- Local implementation summary:
  - Replaced the n8n draft scaffold with a published `n8nManifest` and
    `n8nPluginPackage`.
  - Declared the n8n runtime infrastructure component, native
    tenant-service-credential MCP component, Plugin Detail custom package UI
    surface, and `n8n--workflow-operator` skill.
  - Removed `thinkworkPlugin.catalogPublication = "deferred"` from
    `plugins/n8n/package.json`.
  - Added `@thinkwork/plugin-n8n` to the plugin catalog package dependency set
    and regenerated `plugins/catalog/src/registry/generated-first-party.ts`.
  - Added dry-run/live smoke scripts for managed-app deployment evidence and
    native n8n MCP verification through the ThinkWork proxy path.
  - Updated the n8n README plus admin/deploy docs for queue-mode runtime,
    tenant service credential MCP, custom package image plans, shared native
    operator account, activation guardrails, and teardown.
  - Started the web dev server from this worktree on
    `http://localhost:5175/settings/plugins`; in-app browser automation was
    blocked by enterprise localhost policy, but the generated signed catalog
    now contains nine plugins ordered
    `company-brain,lakehouse,lastmile,n8n,plane,email-channel,sendgrid,twenty,workos-auth`.
- Local verification:
  - `pnpm install` completed; optional `canvas@2.11.2` native fallback reported
    missing local `pkg-config`, but package installation completed and the
    touched packages do not depend on that native module.
  - `pnpm --filter @thinkwork/plugin-n8n test` passed.
  - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-n8n build` passed.
  - `pnpm --filter @thinkwork/plugin-catalog test` passed.
  - `pnpm --filter @thinkwork/plugin-catalog typecheck` passed.
  - `pnpm --filter @thinkwork/plugin-catalog build` passed.
  - `pnpm --filter @thinkwork/plugin-catalog check:plugins` passed.
  - `pnpm --filter @thinkwork/plugin-catalog build:catalog -- --key /tmp/thnk-50-plugin-catalog-test-key.pem --out /tmp/thnk-50-plugin-catalog.json`
    passed with a throwaway local Ed25519 key and wrote a signed 9-plugin
    catalog.
  - `pnpm --filter @thinkwork/web test -- src/components/settings/plugins/PluginsPage.test.tsx`
    passed.
  - `pnpm lint:plugin-source` passed.
  - `node --test scripts/__tests__/verify-plugin-source-boundary.test.mjs`
    passed.
  - `node plugins/n8n/smoke/n8n-managed-app-smoke.mjs` passed dry-run mode.
  - `node plugins/n8n/smoke/n8n-mcp-smoke.mjs` passed dry-run mode.
- CI:
  - PR #2709 initial `Validate signed catalog build` failed because
    `plugins/catalog/src/__tests__/plugin-registry.test.ts` still expected the
    previous discovered package list. Fixed the assertion to include n8n.
  - PR #2709 final checks passed: signed catalog build, CLA, lint, test,
    typecheck, and verify, then squash-merged to `main`.

### U8: End-to-End Verification and Linear Handoff

- Branch/worktree:
  `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-50-u8-n8n-verification`
- Git branch: `codex/thnk-50-u8-n8n-verification`
- Objective: prove the n8n plugin through the deployed ThinkWork
  application-plugin path: install from Settings -> Plugins, approve/apply the
  managed-app plan, verify the public n8n runtime and deployment evidence,
  exercise valid and invalid custom package configuration, verify native n8n
  MCP through ThinkWork with the tenant service credential and agent
  instructions, then park and destroy through the managed-application lifecycle
  with teardown evidence.
- Status: in progress.
- Local setup:
  - U8 started from fresh `origin/main` at
    `ededec8828cd4415c8ae2c7209ed2a31c0652d6d`.
  - Copied the local web `.env` from the main checkout and started
    `http://localhost:5180/settings/plugins` from this worktree for operator
    catalog inspection.
  - `pnpm install` completed; optional `canvas@2.11.2` native build fallback
    reported missing local `pkg-config`, but installation completed and the web
    dev server started successfully.
- Catalog proof:
  - The deployed dev API `pluginCatalogMetadata` returned source
    `github-release` for repository `thinkwork-ai/thinkwork`, ref `main`,
    commit `ededec8828cd4415c8ae2c7209ed2a31c0652d6d`, release tag
    `plugin-catalog-main`, and `lastRefreshStatus: fresh`.
  - The deployed dev API `pluginCatalog` returned nine entries in display-name
    order including `n8n` between `lastmile` and `plane`.
  - Main branch Test workflow for `ededec8828cd4415c8ae2c7209ed2a31c0652d6d`
    passed; the Deploy workflow was still in Terraform Apply when catalog proof
    was captured, so managed-app install verification waited for the platform
    deploy to finish to avoid Terraform state-lock contention.
- Install attempt:
  - After the Deploy workflow for
    `ededec8828cd4415c8ae2c7209ed2a31c0652d6d` completed successfully, the
    deployed dev GraphQL `installPlugin(pluginKey: "n8n")` mutation created
    plugin install `b984678a-30a5-4cb7-9a9c-3d215055dce2` and managed-app
    deployment plan job `15a5f4d9-2127-4ac3-b3e0-15d2ad92e694`.
  - The runtime component entered `awaiting_approval` with handler ref
    `managedAppKey: n8n`, operation `ENABLE`, managed application
    `105d8192-ffbf-4eda-9ebe-d018ea1c2b43`, and desired config version `v1`.
  - Plan evidence bucket/prefix:
    `thinkwork-dev-487219502366-deploy-evidence/0015953e-aa13-4cab-8398-2e70f73dda63/n8n/15a5f4d9-2127-4ac3-b3e0-15d2ad92e694/plan`.
  - The plan job failed before Terraform plan summary generation with latest
    event `plan_evidence_failed`; CodeBuild build ARN
    `arn:aws:codebuild:us-east-1:487219502366:build/thinkwork-dev-deployment-runner:259525c1-6c97-4d65-881b-7834c2024396`.
- Runner regression found during install:
  - `redacted-terraform-vars.json` for the failed n8n plan contained no
    `n8n_*` desired variables because the generated Terraform wrapper had not
    declared or passed n8n variables through to `module.thinkwork`.
  - The live install payload intentionally contained only the plugin-level
    desired config (`databaseName`, `storagePrefix`, `mainDesiredCount`,
    `workerDesiredCount`) and expected the deployment layer to fill in release
    image, shared database-admin secret, generated runtime secret placeholders,
    public URL, and certificate defaults.
  - The same generated tfvars preserved `plane_provisioned = true` and
    `plane_runtime_enabled = true` from current Terraform outputs while
    clearing Plane's required image/secret/storage/public URL/certificate
    values to empty strings. Terraform therefore failed Plane configuration
    preconditions during the unrelated n8n plan.
  - Root cause: `terraform/modules/app/deployment-control-plane/runner.py`
    preserved Cognee and Twenty guardrails but not Plane guardrails, and it had
    no Python-side n8n override generation for managed-app plan payloads.
- Runner fix in this U8 branch:
  - Added Python n8n managed-app override generation for `ENABLE`, `PARK`,
    `UPGRADE`, and `DESTROY`, including queue-mode defaults, the separate
    `thinkwork_n8n` database default, `managed-apps/n8n` storage prefix,
    tenant service credential/operator/encryption/database secret ARN inputs,
    digest-pinned base/package image handling, and custom-package digest
    validation.
  - Preserved Plane guardrail values from
    `terraform_data.plane_configuration_guardrails` during non-Plane managed
    app plans so an unrelated n8n plan cannot blank an existing Plane runtime.
  - Preserved n8n guardrail values during unrelated managed-app plans, and
    expanded `terraform_data.n8n_configuration_guardrails` to record package,
    runtime count, container port, storage mode, cache, CIDR, and KMS settings
    needed for future preservation.
  - Added generated-runner Terraform declarations, module pass-throughs, and
    root outputs for n8n so `terraform.auto.tfvars.json` values are consumed
    during plan/apply and refreshed after apply.
  - Added n8n targeted Terraform plan/apply scope
    (`module.thinkwork.terraform_data.n8n_configuration_guardrails` and
    `module.thinkwork.module.n8n`) plus scope validation to keep the retry
    isolated to the n8n managed-app substrate.
  - Taught the runner to complete sparse n8n install payloads from the release
    manifest/runtime image, current `db_secret_arn`, generated secret
    placeholders, sibling app public URL/certificate guardrails, and safe n8n
    storage/runtime defaults.
- Local verification for the runner fix:
  - `python3 -m py_compile terraform/modules/app/deployment-control-plane/runner.py`
    passed.
  - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
    passed: 74 tests.
  - `terraform fmt -check terraform/modules/thinkwork` passed.
  - `pnpm --filter thinkwork-cli test -- terraform-n8n-fixture` passed: 9
    tests.
  - `pnpm --filter @thinkwork/deployment-runner test -- deployment-runner-managed-apps`
    passed: 23 tests.
  - `pnpm --filter @thinkwork/deployment-runner typecheck` passed.
  - `pnpm dlx prettier@latest --check docs/plans/autopilot/THNK-50-status.md`
    passed.
  - `git diff --check` passed.
- Runner fix PR:
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2711
  - Merge commit: `86f735ad8ef7d1cc02eafc757eb0dff713dec404`
  - Status: merged.
  - Cleanup: remote branch `codex/thnk-50-u8-n8n-verification`, local branch,
    and local U8 worktree removed after merge.
- Post-merge deploy:
  - Main deploy workflow run `27847037891` failed in Terraform Apply after
    updating the deployment-runner S3 script object, so the n8n runner fix
    landed in AWS but the platform deploy is not yet green.
  - Failure: API Gateway v2 routes
    `POST /api/auth/workos/logout` and
    `OPTIONS /api/auth/workos/logout` already exist in AWS for API
    `thinkwork-dev-api` (`ho7oyksms0`) but are missing from Terraform state,
    causing Terraform create conflicts.
  - Live route evidence:
    `POST /api/auth/workos/logout` route id `5b1m09k` and
    `OPTIONS /api/auth/workos/logout` route id `k6h15ii`, both targeting
    integration `uc8te9d`.
- Deploy repair branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/fix-workos-logout-route-import`
  - Git branch: `codex/fix-workos-logout-route-import`
  - Objective: import the existing WorkOS logout API Gateway routes into
    Terraform state during the deploy workflow before apply retries, then wait
    for a green main deploy before retrying the n8n managed-app install.
  - Started: 2026-06-19 20:41 UTC.
  - Implementation summary:
    - Refactored the Terraform Apply step to build one shared non-secret
      `TF_VAR_ARGS` array for import and apply while moving sensitive values
      (`db_password`, `api_auth_secret`, `google_oauth_client_secret`, and
      `mapbox_public_token`) into `TF_VAR_*` environment variables so they are
      not expanded onto Terraform command lines.
    - Added pre-apply import for the existing WorkOS logout API Gateway routes
      with the same `-lock-timeout=10m` state-lock tolerance as apply.
    - Resolve the live `thinkwork-${STAGE}-api` API id by AWS API name, verify
      any existing Terraform state entry belongs to that live API and exact
      route key, import missing route state, and re-check imported state before
      apply continues.
  - Review:
    - CE code review run
      `.context/compound-engineering/ce-code-review/20260619-204337-4ecfd2d6`
      reported three actionable issues; all were fixed in this branch:
      import state lock timeout, command-line exposure of sensitive Terraform
      variables, and stale/partial route state hardening.
    - Residual review risk: the final proof requires the real GitHub Actions
      deploy against the dev Terraform backend and API Gateway state.
  - Local verification:
    - `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy.yml")'`
      passed.
    - Extracted the `Terraform Apply` `run: |` shell block from
      `.github/workflows/deploy.yml`, substituted GitHub expressions with
      placeholders, and `bash -n /tmp/thnk-50-terraform-apply.sh` passed.
    - `pnpm dlx prettier@latest --check .github/workflows/deploy.yml docs/plans/autopilot/THNK-50-status.md`
      passed.
    - `git diff --check` passed.
    - `actionlint` was not available locally; `pnpm dlx actionlint@latest` did
      not expose a binary and `go` was not installed, so workflow validation is
      limited to YAML parsing, extracted shell syntax, formatting, and the
      GitHub workflow run after merge.
  - CI:
    - PR #2712 initial `test` failed in
      `apps/cli/__tests__/terraform-sandbox-host-fixture.test.ts` because the
      Mapbox fixture still expected the older Terraform command-line
      `-var mapbox_public_token=...` wiring. Updated the assertion to require
      the safer `TF_VAR_mapbox_public_token` workflow env wiring.
    - After the fixture update,
      `pnpm --filter thinkwork-cli test -- terraform-sandbox-host-fixture`
      passed: 34 tests.
    - `pnpm dlx prettier@latest --check apps/cli/__tests__/terraform-sandbox-host-fixture.test.ts .github/workflows/deploy.yml docs/plans/autopilot/THNK-50-status.md`
      passed.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2712
    - Merge commit: `25e7ca3d0bc3bd1e37f1bf7ba5687f34b242aa26`
    - Status: merged.
- Post-PR #2712 deploy:
  - Main deploy workflow run `27848846146` failed in Terraform Apply.
  - Failure 1: the WorkOS route import lookup used AWS CLI text output for a
    route key containing spaces, producing a multi-line import id like
    `ho7oyksms0/None ... 5b1m09k ...` instead of the single live route id.
  - Failure 2: Terraform import evaluates the full greenfield configuration,
    and the n8n/Plane Cloudflare ACM validation records used `for_each` keys
    derived from `aws_acm_certificate.*.domain_validation_options`, which are
    unknown until apply.
- Follow-up deploy repair branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/fix-deploy-route-import-acm`
  - Git branch: `codex/fix-deploy-route-import-acm`
  - Objective: make WorkOS route import deterministic and remove unknown
    `for_each` keys from the n8n/Plane ACM validation records so Terraform can
    import route state before the targeted apply.
  - Started: 2026-06-19 21:31 UTC.
  - Implementation summary:
    - Changed the API Gateway route lookup to parse `get-routes --output json`
      with `jq --arg route_key`, selecting the exact `RouteKey` and taking the
      first matching `RouteId`.
    - Replaced the n8n and Plane ACM validation Cloudflare record `for_each`
      maps with static domain-name sets; apply-time validation record names,
      values, and types remain in resource values instead of instance keys.
  - Local verification:
    - `terraform fmt -check terraform/examples/greenfield/main.tf` passed.
    - `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/deploy.yml")'`
      passed.
    - Extracted the `Terraform Apply` `run: |` shell block from
      `.github/workflows/deploy.yml`, substituted GitHub expressions with
      placeholders, and `bash -n /tmp/thnk-50-terraform-apply-2.sh` passed.
    - `terraform -chdir=terraform/examples/greenfield init -backend=false -input=false`
      passed without touching remote state.
    - `terraform -chdir=terraform/examples/greenfield validate -no-color`
      passed.

## Blockers

- Active fix in progress: the n8n runner fix PR and first deploy repair PR are
  merged, but the main deploy is now blocked by deterministic route import and
  ACM validation `for_each` issues addressed by
  `codex/fix-deploy-route-import-acm`. After this follow-up deploy repair PR
  merges and the main deploy is green, retry the n8n plugin install through the
  deployed ThinkWork managed-application path.
