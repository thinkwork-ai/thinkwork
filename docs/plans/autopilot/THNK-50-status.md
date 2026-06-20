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
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2713
    - Merge commit: `cbf273867a56efc80811bddbddbd69ae57ced77d`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
- Post-PR #2713 deploy:
  - Main deploy workflow run `27850615026` failed in Terraform Apply.
  - The route import logic now found the live route deterministically, but the
    existing Terraform state entry for
    `module.thinkwork.module.api.aws_apigatewayv2_route.handler["POST /api/auth/workos/logout"]`
    did not expose parseable `api_id` or `route_key` fields to the guard, so
    the workflow fail-closed with `unknown/unknown`.
- Malformed route-state repair branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/fix-workos-route-state-reimport`
  - Git branch: `codex/fix-workos-route-state-reimport`
  - Objective: make the WorkOS route import repair idempotent when Terraform
    state contains a malformed or partial route entry by removing and
    re-importing that exact route address from the live API Gateway route.
  - Started: 2026-06-19 22:16 UTC.
  - Implementation summary:
    - Replaced the fail-only route state assertion with `check_route_state`.
    - If state is present and matches the live API id plus route key, skip
      import as before.
    - If state is present and has parseable but wrong `api_id` or `route_key`,
      still fail-close.
    - If state is present but missing either route field, remove only that
      Terraform state address and continue to import the live AWS route.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2714
    - Merge commit: `2cb830be1d9d9388a29fe308396e014d4666dc45`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
- Post-PR #2714 deploy:
  - Main deploy workflow run `27851084870` failed in Terraform Apply.
  - The workflow removed the malformed WorkOS route state and attempted the
    import path, but the post-import `terraform state show` parser still treated
    the route as missing `api_id` or `route_key` because Terraform aligns
    attributes with variable whitespace.
- WorkOS route state parser branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/fix-workos-state-parser`
  - Git branch: `codex/fix-workos-state-parser`
  - Objective: make the route-state guard parse Terraform `state show` output
    with variable key alignment while preserving spaces inside route keys.
  - Started: 2026-06-19 22:31 UTC.
  - Implementation summary:
    - Changed `api_id` parsing to split on `=` and trim whitespace/quotes from
      the value.
    - Changed `route_key` parsing to split on `=` and trim only leading/trailing
      whitespace/quotes so route keys like `POST /api/auth/workos/logout`
      remain intact.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2716
    - Merge commit: `bc8c6d4f2df43fb7d43b2372c7930b8fc9a97185`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
  - Post-merge deploy:
    - Main deploy workflow run `27851550169` passed after importing the existing
      WorkOS logout routes and applying the n8n runner variable fixes.
- Managed-app uninstall retry hardening branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/fix-n8n-uninstall-retry`
  - Git branch: `codex/fix-n8n-uninstall-retry`
  - Objective: let failed managed-app uninstall components retry through the
    normal deployment-runner path instead of staying trapped in failed state
    after an operator-visible error.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2715
    - Merge commit: `90dfc70181f6ffbba7560521c1d292a2f1c8fac8`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
  - Release/deploy:
    - Canary release `v0.1.0-canary.216` published from commit
      `90dfc70181f6ffbba7560521c1d292a2f1c8fac8`.
    - Release workflow run `27851919847` passed.
    - Deploy workflow run `27851891617` passed.
    - Live deployment status pointer now records active release
      `v0.1.0-canary.216`, manifest digest
      `febc6ee124838b5d78abccf63f1b8bb019ad1d92341c910150b7e1ab25210e08`,
      and commit `90dfc70181f6ffbba7560521c1d292a2f1c8fac8`.
- n8n teardown retry after canary 216:
  - Existing stuck install id:
    `b984678a-30a5-4cb7-9a9c-3d215055dce2`.
  - Retry job:
    `c9d98655-2a14-483e-a057-d40d69a443cb`.
  - Plan phase used release `v0.1.0-canary.216` and the matching manifest
    digest above.
  - Plan reached `awaiting_approval` with digest
    `885629fadcbb7853d71d7c59e8ac3775de36591cc298e6ab5235c8fad805ceb4`.
  - Plan summary: 9 resource changes, all `no-op`.
  - Approved the DESTROY apply with destructive confirmation `DESTROY`.
  - Apply failed after the targeted/no-op n8n apply while refreshing broader
    Terraform outputs:
    `terraform apply -refresh-only -auto-approve -no-color` exited non-zero.
  - CodeBuild apply build:
    `thinkwork-dev-deployment-runner:8f485b8f-701c-4873-8ab5-f0c2bffdc129`.
  - Failure detail from CloudWatch: Terraform hit an unrelated full-root
    evaluation error in
    `terraform/modules/app/agentcore-memory/main.tf`, line 115, where
    `aws_iam_role.memory_execution[0].arn` is invalid because
    `aws_iam_role.memory_execution` is an empty tuple.
  - Interpretation: the n8n targeted plan/apply path was no-op and isolated,
    but managed-app jobs still failed because post-apply output refresh was
    treated as a hard apply failure.
- Managed-app output refresh isolation branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/fix-managed-app-release-defaults`
  - Git branch: `codex/fix-managed-app-release-defaults`
  - First PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2717
    - Merge commit: `ebcf84fdbf01a4b1295766b9c6410e7ce1d98591`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
    - Scope: made post-targeted managed-app `terraform apply -refresh-only`
      non-fatal after the real targeted apply succeeds.
  - Supplemental PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2718
    - Merge commit: `f4f9d51d5283d851ebce84afa88b9c830419ad4a`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
    - Objective: keep real targeted managed-app apply failures fatal while
      recording output refresh status in evidence and preserving managed-app job
      success if `terraform output -json` also cannot evaluate the broader root.
  - Implementation summary:
    - `refresh_outputs_after_targeted_apply` now records refresh status in
      Terraform evidence and returns a non-fatal failure detail for managed-app
      refresh-only errors.
    - Added managed-app output collection fallback to read existing Terraform
      outputs from S3 state if `terraform output -json` also cannot evaluate
      the broader root after a successful targeted apply.
    - Full platform deploy output collection still raises on Terraform output
      failures; the relaxed behavior is limited to managed-app operations.
  - Local verification:
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py -k "managed_app_success_refreshes_root_outputs or managed_app_output_refresh_failure_is_non_fatal or managed_app_outputs_fall_back_to_state_after_output_failure"`
      passed: 3 tests.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed: 77 tests.
    - `uv run --with ruff ruff check terraform/modules/app/deployment-control-plane/runner.py terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed.
  - Rebase verification after PR #2717 landed:
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed: 77 tests.
    - `uv run --with ruff ruff check terraform/modules/app/deployment-control-plane/runner.py terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed.
- Post-PR #2718 release/deploy:
  - Main deploy workflow run `27853161203` passed.
  - Canary release `v0.1.0-canary.218` published from commit
    `f4f9d51d5283d851ebce84afa88b9c830419ad4a`.
  - Release workflow run `27853482541` passed.
  - Live deployment status pointer recorded active release
    `v0.1.0-canary.218`, manifest digest
    `88d1935c340dc956c92a4c3b267c96e5e503cf9d3a8309f975b2bc8519f958c8`,
    and commit `f4f9d51d5283d851ebce84afa88b9c830419ad4a`.
- n8n install retry after canary 218 pointer:
  - Install id: `f5264c0f-613b-473f-b7d3-b409807c17d0`.
  - Runtime retry job:
    `f442a3a3-2db2-4dab-9133-dbfe90218b3f`.
  - The plugin runtime component still selected release
    `v0.1.0-canary.217` because the existing `managed_applications` row was
    pinned to that release; retry correctly preserved the operator-selected
    release instead of defaulting to the newly active release.
  - The plan failed before approval with
    `n8n managed app operation is missing required desired-state field: imageUri.`
  - Root cause found during follow-up: release manifest `218` did not include a
    baseline `n8n-runtime` image, and the release workflow did not build or
    publish the ThinkWork n8n wrapper image expected by the approved plan.
- n8n release manifest/runtime image branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/n8n-release-manifest-fix`
  - Objective: publish the baseline n8n wrapper runtime image in the release
    workflow and require `n8n-runtime` in the release manifest so the managed
    app runner can hydrate `imageUri` from the verified release manifest.
  - Implementation summary:
    - Added release workflow output and Docker build step for
      `ghcr.io/<owner>/thinkwork-n8n:<release>-n8n-amd64`.
    - Added the release-manifest runtime image entry `n8n-runtime`.
    - Added n8n to default managed-app release descriptors with its managed-app
      smoke contract and plugin Terraform module path.
    - Added deterministic empty package context files for
      `plugins/n8n/runtime/Dockerfile`, keeping the same Dockerfile usable for
      both baseline wrapper builds and later custom-package image builds.
    - Updated the managed-app controller readiness smoke default app list and
      module-source suffix handling for plugin-owned n8n.
  - Local verification:
    - `pnpm exec tsx --test scripts/release/__tests__/build-release-manifest.test.ts`
      passed: 10 tests.
    - `pnpm --filter @thinkwork/plugin-n8n test` passed: 14 tests.
    - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
    - `pnpm test:release` passed: 14 tests.
    - `node scripts/smoke/managed-app-controller-readiness-smoke.mjs` passed
      its dry-run readiness contract.
    - Local Docker build was attempted with `docker buildx build`, but the
      Docker daemon was not running on this machine:
      `failed to connect to the docker API at unix:///Users/ericodom/.docker/run/docker.sock`.
    - Local `pnpm format:check` could not run because the root package references
      `prettier` but does not expose it as an installed workspace executable in
      this checkout.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2720
    - Merge commit: `cd9abff86ec559a26108167cf1f266d4377803a2`
    - Status: merged after CLA, lint, verify, typecheck, test, and plugin
      catalog validation passed.
  - Canary release attempt:
    - Tag `v0.1.0-canary.220` was pushed from merge commit
      `cd9abff86ec559a26108167cf1f266d4377803a2`.
    - Release workflow run `27854608012` failed in build-deploy-artifacts at
      `Build and push n8n runtime amd64`.
    - Root cause: the workflow passed
      `N8N_BASE_IMAGE=${{ env.N8N_BASE_IMAGE_URI }}`, but
      `N8N_BASE_IMAGE_URI` was scoped only to the later manifest step, so
      Docker received a blank `N8N_BASE_IMAGE` build arg and failed with
      `base name (${N8N_BASE_IMAGE}) should not be blank`.
- n8n release build-arg follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-release-build-arg`
  - Objective: pass the pinned `n8nio/n8n:1.98.2` base image directly to the
    n8n runtime Docker build step so the release workflow can publish
    `n8n-runtime`.
  - Implementation summary:
    - Inlined the pinned base image digest in the n8n Docker build step.
    - Removed the unused step-scoped `N8N_BASE_IMAGE_URI` environment entry from
      the manifest step.
  - Local verification:
    - `pnpm exec tsx --test scripts/release/__tests__/build-release-manifest.test.ts`
      passed: 10 tests.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2721
    - Merge commit: `42cb776b8f322d1c84c9a1cabbaf4b456dce4000`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
  - Canary release attempt:
    - Tag `v0.1.0-canary.221` was pushed from merge commit
      `42cb776b8f322d1c84c9a1cabbaf4b456dce4000`.
    - Release workflow run `27855162563` failed in build-deploy-artifacts at
      `Build and push n8n runtime amd64`.
    - Root cause: the Dockerfile copied `n8n-task-runners.json`, but the runtime
      build context only contained `n8n-task-runners.json.template`; Docker
      failed with `"/n8n-task-runners.json": not found`.
- n8n runtime task-runner config follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-runtime-task-runner-config`
  - Objective: ship the concrete baseline task-runner config expected by the n8n
    runtime Dockerfile while keeping the template available for custom package
    image builds.
  - Implementation summary:
    - Added `plugins/n8n/runtime/n8n-task-runners.json` with an empty
      JavaScript external package allow-list for the baseline release image.
    - Updated the image-build unit test to read the concrete config as well as
      the custom-package template.
  - Local verification:
    - `pnpm --filter @thinkwork/plugin-n8n test -- --run image-build.test.ts`
      passed: 5 tests.
    - Local Docker build was attempted, but the Docker daemon was not running on
      this machine:
      `failed to connect to the docker API at unix:///Users/ericodom/.docker/run/docker.sock`.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2723
    - Merge commit: `498e9b4914ed135e6ba362e9ce62e4282f52869d`
    - Status: merged after CLA, lint, verify, typecheck, test, and plugin
      catalog validation passed.
  - Canary release attempt:
    - Tag `v0.1.0-canary.222` was pushed from merge commit
      `498e9b4914ed135e6ba362e9ce62e4282f52869d`.
    - Release workflow run `27855739574` failed in build-deploy-artifacts at
      `Build and push n8n runtime amd64`.
    - Root cause: the baseline release package context contains zero custom
      packages, so `npm ci` succeeds without creating `node_modules`; the
      Dockerfile then failed with
      `cp: can't stat 'node_modules/.': No such file or directory`.
- n8n runtime empty package context follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-runtime-empty-package-context`
  - Objective: let the baseline n8n runtime image build when no custom packages
    are configured while preserving node module injection for custom package
    image builds.
  - Implementation summary:
    - Guarded the runtime Dockerfile package-copy step with
      `if [ -d node_modules ]` so empty package contexts still build.
    - Updated the image-build unit test to assert the zero-package guard remains
      in the shipped Dockerfile.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2724
    - Merge commit: `31cd5a0148515005335c22e0a32d9cb2eba3f38a`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
  - Canary release attempt:
    - Tag `v0.1.0-canary.223` was pushed from merge commit
      `31cd5a0148515005335c22e0a32d9cb2eba3f38a`.
    - Release workflow run `27856317407` succeeded and published
      `thinkwork-release.json` with SHA-256
      `64d7a2a69edcb63080d7dfdaa1596d6af198b4a56fdc746d175d8c21024291b6`.
    - The manifest included `n8n-runtime` at
      `ghcr.io/thinkwork-ai/thinkwork-n8n:v0.1.0-canary.223-n8n-amd64@sha256:6eed6ac741015d48aeaf272a8192834777c8bb7433174a0eb4cf86d5e5cd65cc`.
  - Deployed install verification attempt:
    - The normal plugin retry path still selected stale release
      `v0.1.0-canary.217` and failed with
      `n8n managed app operation is missing required desired-state field: imageUri.`
    - A direct managed-app plan was started for canary `223` with the release
      manifest URL, digest, and `n8n-runtime` image map. The plan reached
      `awaiting_approval`, was approved, and started Step Function execution
      `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-deployment-orchestrator:tw-apply-04565dcb3d9a4445b9b2-75de76bb0114`.
    - ECS task startup then failed pulling the GHCR image with
      `CannotPullContainerError` / `failed to authorize ... ghcr.io/token ... 401 Unauthorized`.
- n8n release ECR image and manifest hydration follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-release-ecr-image`
  - Objective: make the release-manifest n8n image URI pullable by ECS and make
    plugin-created deployment jobs hydrate `manifestImages` from the selected
    release manifest instead of starting the runner with an empty image map.
  - Implementation summary:
    - Added AWS/ECR login to the release deployable-artifacts job.
    - Added ECR tags for the n8n runtime image while preserving the GHCR tags.
    - Changed the `n8n-runtime` release-manifest image repository to the
      configured `N8N_RUNTIME_IMAGE_REPOSITORY` repo, defaulting to the dev ECR
      agentcore repository that ECS can pull.
    - Added API-side release-manifest image hydration so n8n managed-app plan
      jobs fill `n8n-runtime` from the verified release manifest when
      `manifestImages` is omitted.
  - Local verification:
    - `pnpm --filter @thinkwork/api test -- --run src/lib/deployments/release-manifest-images.test.ts src/graphql/resolvers/deployments/managed-applications.test.ts src/lib/plugins/handlers/infra.test.ts`
      passed: 38 tests.
    - `pnpm --filter @thinkwork/api typecheck` passed.
    - `pnpm exec tsx --test scripts/release/__tests__/build-release-manifest.test.ts`
      passed: 10 tests.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2725
    - Merge commit: `21cac2c3c8be85f8e5757c08746c2235463ce828`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
  - Canary release:
    - Tag `v0.1.0-canary.225` was pushed from merge commit
      `21cac2c3c8be85f8e5757c08746c2235463ce828`.
    - Release workflow run `27857603374` succeeded and published an ECR-backed
      `n8n-runtime` image:
      `487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.225-n8n-amd64@sha256:e7e87c4410ce9662f9f03b5a85e0a43e1c0b366c4463c5cbfb8a5e8b44e3c4d8`.
  - Deployed install verification attempt:
    - Failed install row `f5264c0f-613b-473f-b7d3-b409807c17d0` was destroyed
      through the managed plugin flow. Destroy job
      `d15fec9c-7c5a-4d09-b8ac-a0e0de5d9755` applied successfully, and ECS
      n8n services were left inactive with desired/running/pending counts at 0.
    - Fresh plugin install id `b936aea0-4be4-4041-9915-3f579cb78db4` still
      failed at plan time with
      `n8n managed app operation is missing required desired-state field: imageUri.`
    - Root cause: the API GraphQL Lambda cached the S3
      `deployment/status/current.json` pointer for the warm container lifetime,
      so one resolver instance kept selecting `v0.1.0-canary.224` with an empty
      manifest image map after canary `225` was active.
- n8n deployment status pointer cache follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-release-pointer-cache`
  - Objective: make managed-app plan jobs refresh the active deployment status
    pointer between reads so fresh canary release pointers are not hidden by a
    warm Lambda container.
  - Local verification:
    - `pnpm --filter @thinkwork/api test -- --run src/graphql/resolvers/core/general-reads-authz.test.ts src/graphql/resolvers/deployments/managed-applications.test.ts src/lib/deployments/release-manifest-images.test.ts`
      passed: 29 tests.
    - `pnpm --filter @thinkwork/api typecheck` passed.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2726
    - Merge commit: `42c97ac512a450f6ad70a1ed0aeeca32dea58418`
    - Status: merged after required checks passed.
  - Canary release:
    - Tag `v0.1.0-canary.226` was pushed from merge commit
      `42c97ac512a450f6ad70a1ed0aeeca32dea58418`.
    - Release workflow run `27858476911` succeeded and updated the dev status
      pointer to `v0.1.0-canary.226`.
  - Reset attempt:
    - Retrying the failed install teardown through `uninstallPlugin` failed with
      `Release manifest digest mismatch for n8n: expected 1e9a6065e89e8b5f49291afbc4d53951e038176606a80bc718edc27cb2429ce4, got a8fd43ade8267c8976d1d91a7b90b57b15e9bf1426eed1bffb7b4fc9e2d4a0be.`
    - Root cause: the release workflow wrote the raw
      `thinkwork-release.json` file hash into the deployment status pointer,
      while the API verifier compares against the canonical
      `releaseManifestSha256(validateReleaseManifest(manifest))` digest.
- n8n release pointer canonical digest follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-release-pointer-canonical-digest`
  - Objective: make the release workflow publish the canonical manifest digest
    consumed by the API verifier so managed-app teardown and install use the
    same integrity contract.
  - Local verification:
    - `pnpm exec tsx --test scripts/release/__tests__/manifest-sha256.test.ts scripts/release/__tests__/build-release-manifest.test.ts scripts/release/__tests__/write-deployment-status.test.ts`
      passed: 12 tests.
    - `pnpm test:release` passed: 15 tests.
    - `git diff --check` passed.
    - `pnpm exec prettier --check <touched files>` could not run because
      `prettier` is not installed as a workspace executable in this checkout.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2728
    - Merge commit: `a91fc936cfcd39d8d269df51ba2437f389b12276`
    - Status: merged after CLA, lint, verify, typecheck, and test passed.
  - Canary release:
    - Tag `v0.1.0-canary.228` was pushed from merge commit
      `a91fc936cfcd39d8d269df51ba2437f389b12276`.
    - Release workflow run `27859246632` succeeded.
    - Dev status pointer now records canonical manifest digest
      `1a2d9d0e9d11c867fdb581acac910c809cca17079aa2e82cf2602817cfc312db`;
      the raw release asset hash is
      `37d5f4498bd68409ece9ecc841be73ed959cdd3170e0eea247e31fc6327f2b0b`,
      proving the pointer writes the API verifier digest.
    - The manifest includes ECR n8n image
      `487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.228-n8n-amd64@sha256:966bbfdbe918570d4676fcf9d1399e01f5c6f5794983bf65d58b73dffb32bdfd`.
  - Reset attempt:
    - Retried `uninstallPlugin` for install
      `b936aea0-4be4-4041-9915-3f579cb78db4`.
    - Destroy job `0be43527-ee3f-4044-bb76-d56718d0959c` used canary `228`
      and the correct canonical manifest digest, but failed during runner plan
      evidence with
      `Release manifest digest mismatch: expected 1a2d9d0e9d11c867fdb581acac910c809cca17079aa2e82cf2602817cfc312db, got 37d5f4498bd68409ece9ecc841be73ed959cdd3170e0eea247e31fc6327f2b0b`.
    - Root cause: the API and release pointer use the canonical manifest
      digest, but the deployment runner still verifies downloaded manifest
      files with the raw file hash before parsing the manifest.
- n8n deployment runner canonical digest follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-runner-canonical-manifest-digest`
  - Objective: make the deployment runner verify release manifests using the
    same canonical digest as the API and release workflow.
  - Local verification:
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py -k "ensure_release_manifest_available or sync_release_artifacts"`
      passed: 8 tests.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed: 82 tests.
    - `uv run --with ruff ruff check terraform/modules/app/deployment-control-plane/runner.py terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed.
    - `git diff --check` passed.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2729
    - Merge commit: `b1816404ca1b35503c21bd2eeb123e629a7b042f`
    - Status: merged after required checks passed.
  - Main deploy:
    - GitHub Actions deploy run `27859960496` succeeded.
  - Canary release:
    - Tag `v0.1.0-canary.229` was pushed from merge commit
      `b1816404ca1b35503c21bd2eeb123e629a7b042f`.
    - Release workflow run `27860218109` succeeded.
    - Dev status pointer selected canonical manifest digest
      `684bf9ea55241f256017efcc57709e10a37258fad42a623a5012cf4099ed2773`
      with ECR-backed n8n image
      `487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.229-n8n-amd64@sha256:966bbfdbe918570d4676fcf9d1399e01f5c6f5794983bf65d58b73dffb32bdfd`.
  - Reset attempt:
    - Retried teardown for failed install
      `b936aea0-4be4-4041-9915-3f579cb78db4`.
    - Destroy job `947a0cfc-0ae0-4f82-be2c-c49333bd27f7` reached
      `awaiting_approval`, was approved with destructive confirmation
      `DESTROY`, and applied successfully through Step Functions execution
      `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-deployment-orchestrator:tw-apply-947a0cfc0ae04f82be2cc49333bd27f7`.
    - A final `uninstallPlugin` re-drive returned `Plugin install not found`;
      follow-up plugin query showed no n8n install rows. ECS showed the n8n
      main service inactive with desired/running/pending counts at 0.
  - Fresh deployed install attempt:
    - Fresh plugin install id `60b7d5c3-8b3d-45f0-8c31-04e71caaaa4e`
      created runtime deployment job
      `58b2fdb0-6331-4fb8-963f-bbad8f6f0c35`.
    - The plan selected canary `229` and the correct canonical digest, but
      failed before approval with
      `n8n managed app operation is missing required desired-state field: imageUri.`
    - Job plan summary had `releaseManifestUrl: ""` and `manifestImages: {}`
      even though the selected release manifest contains `n8n-runtime`.
    - Root cause: the fresh plugin install adopted an existing
      `managed_applications` row with `selected_release_version` and
      `selected_manifest_digest` populated but no stored manifest URL/image
      map. `startManagedApplicationPlanJob` skipped default release lookup
      whenever version and digest were present, so the n8n image hydration
      helper never received a release manifest URL.
- n8n adopted release manifest hydration follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-adopted-release-hydration`
  - Objective: let plugin-created plan jobs for adopted managed-app rows keep
    their pinned release version/digest while hydrating the missing release
    manifest URL and `n8n-runtime` image from the active deployment defaults.
  - Local verification:
    - `pnpm --filter @thinkwork/api test -- --run src/graphql/resolvers/deployments/managed-applications.test.ts src/lib/deployments/release-manifest-images.test.ts src/lib/plugins/handlers/infra.test.ts`
      passed: 39 tests.
    - `pnpm --filter @thinkwork/api typecheck` passed.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2730
    - Merge commit: `6313bb7875f0eff8b9a00743ae7c220edaa4e283`
    - Status: merged after CLA, lint, verify, test, and typecheck passed.
  - Main deploy:
    - GitHub Actions deploy run `27861025602` succeeded.
  - Reset attempt:
    - `retryPluginComponent` for install
      `60b7d5c3-8b3d-45f0-8c31-04e71caaaa4e` returned the old failed runtime
      handler ref, so the stale component could not be repaired in place.
    - `uninstallPlugin` with confirmation `n8n` failed before creating a
      destroy job with
      `Release manifest digest mismatch for n8n: expected 5933a29e35f80de68a1c1447790f4d2231153f5442e7f695ce53b6294d465ea4, got 1fe34f28bea9a03c99dacd9ea7467c1400720b70783978dd3503e692e48e226b.`
    - Root cause: the #2730 main deploy overwrote
      `deployment/status/current.json` with an `activeRelease` containing only
      `version: v0.1.0-canary.229+1` and `commitSha`, no manifest URL or
      manifest SHA. Release default selection then mixed that partial pointer
      with stale SSM profile metadata (`v0.1.0-canary.189`) and stale selected
      release metadata (`v0.1.0-canary.203`), producing mismatched release
      URL/digest pairs.
- deployment status pointer preservation follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-deploy-status-preserve-release`
  - Objective: prevent source deploys from erasing complete active release
    metadata when no release manifest URL/SHA is available, so managed-app
    install/teardown defaults keep selecting a coherent release triple.
  - Local verification:
    - `pnpm exec tsx --test scripts/release/__tests__/write-deployment-status.test.ts`
      passed: 2 tests.
    - `pnpm exec tsx --test scripts/release/__tests__/write-deployment-status.test.ts scripts/release/__tests__/manifest-sha256.test.ts`
      passed before PR.
    - `git diff --check` passed before PR.
    - `pnpm dlx prettier@3.8.2 --check scripts/release/__tests__/write-deployment-status.test.ts docs/plans/autopilot/THNK-50-status.md`
      passed before PR.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2731
    - Merge commit: `b0eed18a67e20db1cd643fd45c401d568558f83c`
    - Status: merged after required checks passed.
  - Main deploy:
    - GitHub Actions deploy run `27861759511` succeeded.
  - Canary release:
    - Tag `v0.1.0-canary.230` was pushed from merge commit
      `b0eed18a67e20db1cd643fd45c401d568558f83c`.
    - Release workflow run `27862061021` succeeded.
    - Dev status pointer selected manifest URL
      `https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.230/thinkwork-release.json`
      with canonical digest
      `c02194a50dca372bcee73a2be3bc65246c43424f8f1a1195d6b1cb2f3f559166`
      and ECR n8n image
      `487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.230-n8n-amd64@sha256:966bbfdbe918570d4676fcf9d1399e01f5c6f5794983bf65d58b73dffb32bdfd`.
  - Reset and fresh deployed install attempt:
    - Retried teardown for failed install
      `60b7d5c3-8b3d-45f0-8c31-04e71caaaa4e`; destroy job
      `e561ce96-84ef-436b-92b6-3268ed302f30` selected canary `230`, reached
      `awaiting_approval`, was approved with destructive confirmation
      `DESTROY`, and applied successfully through Step Functions execution
      `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-deployment-orchestrator:tw-apply-e561ce9684ef436b92b63268ed302f30`.
    - A final `uninstallPlugin` re-drive returned `Plugin install not found`;
      follow-up plugin query showed no n8n install rows.
    - Fresh install id `c11e3e32-4b23-4e6c-ad70-a0dfb859bb40` created
      runtime deployment job `3f987250-9676-4af6-a647-3f9e2f585881`.
    - The job selected canary `230`, hydrated the `n8n-runtime` image from the
      release manifest, reached `awaiting_approval`, and was approved.
    - Apply execution
      `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-deployment-orchestrator:tw-apply-3f98725096764af6a6473f9e2f585881`
      failed in CodeBuild build
      `thinkwork-dev-deployment-runner:ae8759a7-0054-4a3d-91d6-49fa9519afcb`.
    - CodeBuild logs showed Terraform had created real n8n substrate resources
      including ALB
      `arn:aws:elasticloadbalancing:us-east-1:487219502366:loadbalancer/app/tw-dev-n8n/6e959075e69b9ab4`
      and ElastiCache replication group `tw-dev-n8n`, then failed creating
      placeholder Secrets Manager secrets because the fixed names
      `thinkwork/dev/n8n/{database-url,encryption-key,service-credential,operator}`
      were still scheduled for deletion from the prior teardown.
- n8n placeholder secret reinstall follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-secret-reinstall`
  - Objective: make generated n8n placeholder secrets reliable under immediate
    install/teardown/reinstall loops by using unique `name_prefix` secret names
    and immediate deletion for generated placeholders.
  - PR:
    - PR: https://github.com/thinkwork-ai/thinkwork/pull/2732
    - Merge commit: `9c8b4fed9a3376ccc34d9c74dd711e2905d000c2`
    - Status: merged after required checks passed.
  - Main deploy:
    - GitHub Actions deploy run `27863119433` succeeded.
  - Canary release:
    - Tag `v0.1.0-canary.231` was pushed from merge commit
      `9c8b4fed9a3376ccc34d9c74dd711e2905d000c2`.
    - Release workflow run `27863400675` succeeded.
    - Dev status pointer selected manifest URL
      `https://github.com/thinkwork-ai/thinkwork/releases/download/v0.1.0-canary.231/thinkwork-release.json`
      with canonical digest
      `d86bcef017e1e6670d244ea72b219737352114767d6b81e432022180659be5fd`
      and ECR n8n image
      `487219502366.dkr.ecr.us-east-1.amazonaws.com/thinkwork-dev-agentcore:v0.1.0-canary.231-n8n-amd64@sha256:966bbfdbe918570d4676fcf9d1399e01f5c6f5794983bf65d58b73dffb32bdfd`.
  - Reset and fresh deployed install attempt:
    - Retried teardown for failed install
      `c11e3e32-4b23-4e6c-ad70-a0dfb859bb40`; destroy job
      `614713f2-27b6-41d9-a39f-8a94f4b36e38` selected canary `231`,
      reached `awaiting_approval`, was approved with destructive confirmation
      `DESTROY`, and applied successfully through Step Functions execution
      `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-deployment-orchestrator:tw-apply-614713f227b641d9a39f8a94f4b36e38`.
    - Follow-up plugin queries showed no n8n install rows, and AWS
      `elasticache describe-replication-groups tw-dev-n8n` returned not found.
    - Fresh install id `c040ec95-15f7-4e72-88fc-4407410b1e45` created
      runtime deployment job `f31baf85-6051-484e-b245-299e636175ce`.
    - The job selected canary `231`, hydrated the `n8n-runtime` image from the
      release manifest, reached `awaiting_approval`, and was approved.
    - Apply execution
      `arn:aws:states:us-east-1:487219502366:execution:thinkwork-dev-deployment-orchestrator:tw-apply-f31baf856051484eb245299e636175ce`
      created the n8n ALB, Valkey cache, ECS task definitions, and suffixed
      generated Secrets Manager placeholders such as
      `thinkwork/dev/n8n/operator-20260620072900584600000006-9Fw525`, proving
      the fixed-name secret collision is resolved.
    - ECS then repeatedly started and drained the n8n main task. CloudWatch logs
      for `/thinkwork/dev/n8n/main` showed n8n process startup followed by
      `There was an error initializing DB` and
      `unable to get local issuer certificate`.
    - Root cause: the n8n task enables Postgres SSL for Aurora but the runtime
      image does not include or configure the AWS RDS CA bundle, while n8n's
      PostgreSQL SSL verification defaults to rejecting unauthorized
      certificates.
    - After evidence reconciliation, the deployment job marked `succeeded`, but
      the plugin install remained `partially_installed`: the
      `workflow-management` MCP component failed because the n8n managed
      application row's `desired_config` had no `publicUrl` value. The shared
      plan-job default layer derived `publicUrl` for Twenty from the deployment
      controller customer domain but did not do the same for n8n.
    - The same live row also lacked `serviceCredentialSecretArn`; Terraform
      output evidence contained `n8n_service_credential_secret_arn`, but the
      API reconciler only recorded output artifact metadata and did not merge
      generated n8n runtime outputs back into the managed application
      `desired_config` used by plugin MCP provisioning.
- n8n Aurora DB SSL verification follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-db-ssl`
  - Objective: keep the n8n Aurora connection encrypted while letting the
    container start reliably without a bundled RDS CA file, and ensure the
    plugin MCP component can resolve the n8n endpoint from the managed app row.
  - Implementation summary:
    - Added `DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED=false` next to the existing
      `DB_POSTGRESDB_SSL_ENABLED=true` n8n ECS environment setting.
    - Extended shared managed-app plan-job defaults to derive
      `domain: n8n.<customerDomain>` and
      `publicUrl: https://n8n.<customerDomain>` for n8n, mirroring the existing
      Twenty `crm.<customerDomain>` defaulting path.
    - Extended managed-application deployment evidence reconciliation so n8n
      apply output artifacts merge `n8n_url`, the generated database secret
      ARN, generated service credential secret ARN, storage bucket, storage
      prefix, and package digest back into the managed application
      `desired_config` without replacing operator package settings.
    - Expanded the structural Terraform fixture test so the SSL env contract is
      covered.
    - Expanded the n8n managed-app deployment test so sparse plugin-created
      plan jobs must persist the derived n8n `publicUrl` in the managed
      application row and controller payload.
    - Documented the encrypted-but-unverified Aurora SSL tradeoff in the n8n
      Terraform module README.
  - Local verification:
    - `terraform fmt plugins/n8n/terraform/n8n` passed.
    - `pnpm --filter thinkwork-cli test -- terraform-n8n-fixture` passed.
    - `pnpm --filter @thinkwork/plugin-n8n test` passed.
    - `terraform -chdir=plugins/n8n/terraform/n8n init -backend=false && terraform -chdir=plugins/n8n/terraform/n8n validate`
      passed.
    - `pnpm --filter thinkwork-cli typecheck` passed.
    - `pnpm --filter @thinkwork/plugin-n8n typecheck` passed.
    - `pnpm --filter @thinkwork/api test -- --run src/graphql/resolvers/deployments/managed-applications.test.ts`
      passed.
    - `pnpm --filter @thinkwork/api test -- --run src/graphql/resolvers/deployments/managed-application-deployment.test.ts`
      passed.
    - `pnpm --filter @thinkwork/api typecheck` passed.
    - `pnpm dlx prettier@3.8.2 --check apps/cli/__tests__/terraform-n8n-fixture.test.ts plugins/n8n/terraform/n8n/README.md`
      passed.
    - `git diff --check` passed.
  - Status: active.

- n8n Aurora SSL/public URL fix branch:
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2733
  - Merge commit: `19e105b86e13dd58a040902c7a8f3ae146db4534`
  - Status: merged after required checks passed.
  - Main deploy run `27865381097` succeeded.
  - Released canary `v0.1.0-canary.232`.
  - Post-merge live validation found the release status pointer still stored the
    canonical manifest digest, while GitHub-hosted release artifact consumers
    fetch and verify the raw manifest file bytes.
- Release status manifest digest fix branch:
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2734
  - Merge commit: `980d99bac3587ed06fd13a5fa62d3260d25a0ca8`
  - Status: merged after required checks passed.
  - Released canary `v0.1.0-canary.233`.
  - Verified active dev status pointer manifest SHA
    `d9ee9e930fc8f0107e997aac79fc195c56927b7b5825d8a541b8738a5aabc920`
    matches the downloaded GitHub release manifest bytes.
- API release-manifest image digest fix branch:
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2735
  - Merge commit: `c63091612ce53ee79b69ed5e1bc57e3edd31e55f`
  - Status: merged after required checks passed.
  - Main deploy run `27867070210` succeeded.
  - Retried n8n uninstall for partial install
    `c040ec95-15f7-4e72-88fc-4407410b1e45`; the API now accepts the active
    release pointer and created destroy deployment job
    `7a1532de-4e6e-473f-8a67-994bc694c0d7`.
  - Destroy job failed inside the deployment runner before Terraform because
    bundled `runner.py` still compared the selected release manifest SHA against
    the canonical parsed JSON digest
    `936d0e357c6e2ce6335a4841aab0f5e30db5be3a7d6e91e4d71d600b4555b3cd`
    instead of the selected manifest byte digest
    `d9ee9e930fc8f0107e997aac79fc195c56927b7b5825d8a541b8738a5aabc920`.
- Deployment runner release-manifest byte digest follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-runner-manifest-byte-digest`
  - Objective: make the deployment runner validate the same downloaded
    manifest byte digest selected by deployment status, while keeping canonical
    JSON digest verification for signed release manifest trust.
  - Implementation summary:
    - `verify_release_manifest_digest` now hashes the manifest file bytes with
      `sha256_file` before parsing.
    - Release artifact evidence now records `manifestSha256` as the byte digest
      and `manifestCanonicalSha256` as the canonical JSON digest.
    - Runner bundle tests now cover byte-digest acceptance and canonical-digest
      rejection for release selection, while preserving signature trust against
      the canonical digest.
  - Local verification:
    - `python3 -m py_compile terraform/modules/app/deployment-control-plane/runner.py`
      passed.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py -k 'release_manifest_available or sync_release_artifacts'`
      passed.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed.
    - `git diff --check` passed.
  - Status: active.
- Deployment runner release-manifest byte digest follow-up branch result:
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2736
  - Merge commit: `6087a6e768fbdf52ed0b11ca7e373e06e5078229`
  - Status: merged after required checks passed.
  - Released canary `v0.1.0-canary.234`.
  - Verified active dev release pointer selected manifest byte SHA
    `63d2ddf08051b6369e521e3230d4a675986889504ed155ac8a1fa71fd016c6c5`,
    matching the downloaded GitHub release manifest bytes.
  - Retried deployed n8n teardown for partial install
    `c040ec95-15f7-4e72-88fc-4407410b1e45`; destroy job
    `1fba892a-bcd4-499c-9c58-c3f422c9325e` selected canary `234`, reached
    `awaiting_approval`, was approved with destructive confirmation
    `DESTROY`, and applied successfully.
  - Fresh deployed install id `dfb2b0d7-65c4-4df8-8d31-3bff061344d8`
    created runtime deployment job `5c30be1b-f0c6-4a27-8330-008ff041eddf`.
    The job selected canary `234`, reached `awaiting_approval`, was approved,
    and the Terraform apply completed successfully.
  - Live ECS verification after the apply showed the plugin row marked
    `installed`, but the n8n runtime was not healthy:
    `thinkwork-dev-n8n-main` desired count `1` with `0` running tasks and
    CloudWatch `/thinkwork/dev/n8n/main` reporting
    `password authentication failed for user "thinkwork_n8n"`.
  - Worker task logs showed `Error: command n8n not found`, traced to the ECS
    command overriding the n8n base-image entrypoint with
    `["n8n", "worker", ...]` instead of passing `["worker", ...]`.
  - `curl https://n8n.thinkwork.ai/healthz` failed DNS resolution while the
    public n8n ALB existed, proving the targeted managed-app n8n apply did not
    create the Cloudflare `n8n.thinkwork.ai` CNAME.
- n8n runtime install lifecycle follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-install-runtime`
  - PR: https://github.com/thinkwork-ai/thinkwork/pull/2737
  - Objective: make the deployed app.thinkwork.ai n8n install path reliably
    produce a healthy runtime by fixing the remaining install-time runtime
    blockers found during canary `234` verification.
  - Implementation summary:
    - Added an idempotent n8n database lifecycle hook to the package Terraform
      module. The hook reads the generated/runtime database secret, creates the
      dedicated database/role when missing, and always rotates
      `thinkwork_n8n` to the runtime secret password before ECS task
      definitions are created.
    - Added the inverse destroy hook so uninstall terminates n8n sessions and
      drops the dedicated n8n database/role after services are removed.
    - Fixed the worker ECS command to pass `worker --concurrency=...` through
      the n8n base image entrypoint instead of invoking `n8n n8n worker`.
    - Added n8n Cloudflare DNS wiring to the generated managed-app runner root,
      including `cloudflare_record.n8n` target args and plan-scope allowlist.
    - Updated n8n Terraform documentation and structural/runner tests for the
      database lifecycle, worker command, and managed DNS resource.
  - Local verification:
    - `python3 -m py_compile terraform/modules/app/deployment-control-plane/runner.py plugins/n8n/terraform/n8n/scripts/sync-database.py`
      passed.
    - `terraform fmt plugins/n8n/terraform/n8n` passed.
    - `terraform -chdir=plugins/n8n/terraform/n8n init -backend=false && terraform -chdir=plugins/n8n/terraform/n8n validate -no-color`
      passed.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed: 84 tests.
    - `pnpm --filter thinkwork-cli test -- terraform-n8n-fixture` passed.
    - `pnpm --filter @thinkwork/plugin-n8n test` passed.
    - `pnpm --filter @thinkwork/deployment-runner test` passed.
    - `git diff --check` passed.
  - Status: merged in PR #2737 at
    `bb22456b862121d552ea605556de42ca4fe8253e` after required checks passed.
  - Released canary `v0.1.0-canary.235`; verified GitHub release assets
    `thinkwork-release.json` and `platform-artifacts.tar.gz`. Downloaded
    manifest byte SHA:
    `ee84908a4a7c7ec4a84f1c75ba6cad74360c8b924d964582639ba7269c6d1559`.
  - Main deploy run `27869167398` failed while destroying legacy n8n state:
    Terraform evaluated the new database lifecycle destroy provisioner against
    an existing `terraform_data.database_lifecycle` object whose stored input
    did not include the new sync metadata (`sync_script_path`, database host,
    or port). The run destroyed most n8n infra before failing on unsupported
    `self.input` attributes.
- n8n legacy destroy compatibility follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-legacy-destroy-hook`
  - Objective: unblock the live reset by making the n8n database lifecycle
    destroy hook backward-compatible with Terraform state created before the
    sync metadata existed.
  - Implementation summary:
    - Changed the destroy `local-exec` to read new metadata through `try(...)`.
    - If the legacy state object lacks the sync script path, the provisioner
      logs a skip message instead of failing. Future n8n installs still carry
      the sync metadata and will run the drop-database/drop-role cleanup.
    - Updated the n8n Terraform fixture test to assert the compatibility path.
  - Local verification:
    - `pnpm --filter thinkwork-cli test -- terraform-n8n-fixture` passed.
    - `terraform fmt -check plugins/n8n/terraform/n8n && terraform -chdir=plugins/n8n/terraform/n8n validate -no-color`
      passed.
    - `pnpm dlx prettier@3.8.2 --check apps/cli/__tests__/terraform-n8n-fixture.test.ts`
      passed.
    - `git diff --check` passed.
  - Status: merged in PR #2738 at
    `f0ddbbf91732113d37d528aab3acdecfb5bf7806` after required checks passed.
  - Released canary `v0.1.0-canary.236`; verified GitHub release assets
    `thinkwork-release.json` and `platform-artifacts.tar.gz`. Downloaded
    manifest byte SHA:
    `eb36b815bebe3a160e9e694c271ea6c50f8683ebbdce29a5ea0ab48f7d63a4f0`.
  - Main deploy run `27869825424` succeeded. The failed legacy n8n destroy
    state was reconciled.
  - Re-drove deployed n8n uninstall for install
    `dfb2b0d7-65c4-4df8-8d31-3bff061344d8`; destroy job
    `5fcb46b5-db96-4675-8e13-0c0a77319a3d` selected canary `236`, reached
    `awaiting_approval`, was approved with destructive confirmation
    `DESTROY`, and applied successfully.
  - Verified stale n8n plugin row deletion after re-driving uninstall; ECS
    services remained inactive and the n8n ALB was absent before reinstall.
  - Fresh deployed n8n install `138db5b7-0e47-4480-87b2-2117e2087587`
    created runtime job `2bfcfc11-324d-470f-a143-0cf949546e14`. The plan
    selected canary `236`, reached `awaiting_approval`, and was approved.
  - Fresh install apply failed in CodeBuild build
    `thinkwork-dev-deployment-runner:278a8e1a-f2c4-4f0d-8dfa-effe6d12c2ba`.
    Root cause: the new install reused an old generated
    `databaseUrlSecretArn` from the surviving n8n managed-application desired
    config/guardrails. That secret had been deleted during teardown, so
    `sync-database.py up` failed with `ResourceNotFoundException` while reading
    the stale database URL secret.
- n8n reinstall generated-secret refresh follow-up branch:
  - Branch/worktree:
    `/Users/ericodom/Projects/thinkwork/.Codex/worktrees/n8n-release-manifest-fix`
  - Git branch: `codex/fix-n8n-reinstall-secret-refresh`
  - Objective: make a fresh n8n plugin install after managed uninstall
    regenerate Terraform-owned runtime secrets instead of reusing deleted
    generated secret ARNs from prior desired config or Terraform guardrail
    state.
  - Implementation summary:
    - API infra provisioning drops n8n generated runtime secret refs
      (`databaseUrlSecretArn`, `encryptionKeySecretArn`, `operatorSecretArn`,
      `serviceCredentialSecretArn`) when enabling an existing disabled n8n
      managed application row, while preserving operator-facing config such as
      URL, counts, storage, and package settings.
    - Deployment runner ignores generated n8n secret refs from guardrail state
      on ENABLE so Terraform can recreate placeholder secrets; UPGRADE retains
      the guardrail fallback behavior.
    - Added API and runner tests for stale generated secret refs during n8n
      reinstall.
  - Local verification:
    - `pnpm --filter @thinkwork/api test -- handlers/infra.test.ts` passed.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py -k 'n8n_managed_app_overrides_complete_sparse_live_install_payload or unrelated_managed_app_overrides_preserve_existing_n8n_guardrails'`
      passed.
    - `uv run --with pytest pytest terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed: 84 tests.
    - `python3 -m py_compile terraform/modules/app/deployment-control-plane/runner.py`
      passed.
    - `pnpm dlx prettier@3.8.2 --check packages/api/src/lib/plugins/handlers/infra.ts packages/api/src/lib/plugins/handlers/infra.test.ts`
      passed.
    - `uv run --with ruff ruff check terraform/modules/app/deployment-control-plane/runner.py terraform/modules/app/deployment-control-plane/test_runner_bundle.py`
      passed.
    - `git diff --check` passed.
  - Status: active; preparing PR.

## Blockers

- Active blocker: fresh n8n install after a successful destroy reused deleted
  generated n8n secret ARNs from prior desired config/guardrails. A follow-up
  reinstall secret-refresh fix is in progress.
- Active fix in progress: merge and release the reinstall secret-refresh fix,
  clean up the failed partial install, then reinstall through app.thinkwork.ai
  until the n8n ECS main/worker services, `https://n8n.thinkwork.ai`, and all
  plugin components verify successfully end to end.
