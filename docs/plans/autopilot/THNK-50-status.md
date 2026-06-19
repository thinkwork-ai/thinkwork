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
- Objective: add package-owned pinned public npm package validation,
  deterministic package config normalization/digesting, controlled n8n wrapper
  image build contracts, runtime Dockerfile/task-runner templates, and
  deployment-runner plan/apply safeguards so package config changes produce
  reviewed digest-pinned images before Terraform apply.
- Status: in progress.
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

## Blockers

- None currently.
