---
title: "feat: Make Settings Release Upgrades Safe"
type: feat
status: active
date: 2026-06-14
origin: docs/brainstorms/2026-06-14-settings-release-upgrade-safety-requirements.md
linear: THNK-24
---

# feat: Make Settings Release Upgrades Safe

## Overview

Settings -> General -> Releases should become the normal operator path for
upgrading external customer-owned AWS environments. The current surface lists
release manifests and starts the deployment controller, but it skips
pre-dispatch safety checks that TEI and McPherson needed on 2026-06-14:
runner compatibility, frozen-control-plane IAM drift, preserved customer
configuration, and visible evidence/progress.

The implementation turns the direct deploy button into a preflight,
remediation, review, dispatch, and monitor workflow. The customer-owned AWS
deployment controller remains the authority. The agent/manual runbook remains
the escape hatch.

## Requirements Trace

- R1. Show current and target release posture, manifest digest, signature/trust
  posture, and compatibility requirements.
- R2. Compare deployed runner state against the target release compatibility
  floor and runner script metadata before dispatch.
- R3. Detect known frozen-control-plane IAM drift, starting with CodeBuild role
  Route53 action gaps for customer-domain releases.
- R4. Fail closed when manifest trust, digest resolution, runner compatibility,
  IAM preflight, or preserved config cannot be evaluated.
- R5. Support safe runner remediation with backup, selected-release upload, and
  evidence.
- R6. For v1, block on live IAM drift with exact missing actions and runbook
  fallback rather than mutating IAM from Settings.
- R7. Resolve preserved customer configuration: customer domain, delegation
  flags, SES sender settings, platform operator emails, identity/OAuth
  settings, and optional app flags.
- R8. Show a concise preserved-config summary and material diff before
  dispatch.
- R9. Dispatch with a complete preserved-config payload where non-secret values
  are known, and rely on deterministic runner/Secrets Manager recovery only for
  values the API cannot safely materialize.
- R10. Treat missing or conflicting preserved configuration as a blocking
  preflight result.
- R11. Show Step Functions execution, CodeBuild build, evidence bucket/prefix,
  final status pointer, and selected release status after dispatch.
- R12. Surface human-readable failure causes and recovery actions.
- R13. Preserve the manual runbook as the escape hatch, not the happy path.

## Scope Boundaries

- Do not create a local-only deployment mode.
- Do not replace the customer deployment controller with a hosted SaaS control
  plane.
- Do not remove the agent/manual runbook escape hatch.
- Do not solve arbitrary IAM drift in v1. Detect known release-safety drift and
  block with precise recovery actions.
- Do not turn Settings into a general AWS console.

## Key Decisions

- Add release-specific job/event tables rather than overloading managed-app
  deployment jobs.
- Extend the release manifest/publisher contract with immutable runner script
  metadata so Settings can verify and refresh the S3 runner.
- Make preflight GraphQL-backed; the API owns AWS reads, manifest verification,
  config source precedence, and failure classification.
- Allow Settings runner remediation in v1, but do not add IAM mutation from
  Settings.
- Preserve config with explicit precedence and redacted secret handling.

## Implementation Units

### U1. Extend Release Manifest Runner Metadata

Goal: Make selected releases expose immutable runner script metadata that the
API can verify, compare, and use for safe runner refresh.

Files:

- Modify: `packages/release-manifest/src/index.ts`
- Modify: `packages/release-manifest/test/manifest.test.ts`
- Modify: `scripts/release/build-release-manifest.ts`
- Modify: `scripts/release/__tests__/build-release-manifest.test.ts`
- Modify: `.github/workflows/release.yml`
- Modify: `docs/src/content/docs/deploy/release-manifests.mdx`

Test scenarios:

- A manifest with runner version, script URL/path, and SHA-256 validates.
- Missing runner script URL/path or invalid SHA-256 rejects with a field-specific
  release-manifest error.
- `assertManifestCompatible` still enforces `compatibility.minRunnerVersion`.
- The release publisher output includes runner metadata in
  `thinkwork-release.json`.

### U2. Add Release Update Job Substrate

Goal: Persist release upgrade preflight, remediation, dispatch, progress, and
failure state without overloading managed-app deployment rows.

Files:

- Modify: `packages/database-pg/src/schema/deployments.ts`
- Create: `packages/database-pg/drizzle/0168_release_update_jobs.sql`
- Modify: `packages/database-pg/graphql/types/deployments.graphql`
- Modify: `packages/api/src/graphql/resolvers/deployments/index.ts`
- Create: `packages/api/src/graphql/resolvers/deployments/releaseUpdateJob.query.ts`
- Create: `packages/api/src/graphql/resolvers/deployments/release-update-jobs.test.ts`

### U3. Implement Release Preflight Service

Goal: Resolve release posture, runner compatibility, IAM drift, preserved
customer config, and blockers before dispatch.

Files:

- Create: `packages/api/src/graphql/resolvers/deployments/startReleaseUpdatePreflight.mutation.ts`
- Create: `packages/api/src/lib/deployments/release-preflight.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/deploymentReleases.query.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/shared.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/index.ts`
- Modify: `terraform/modules/app/lambda-api/iam-grouped.tf`

### U4. Add Safe Runner Refresh Remediation

Goal: Let Settings refresh a stale S3 runner only when the selected release
provides trusted runner metadata, with backup and evidence.

Files:

- Create: `packages/api/src/graphql/resolvers/deployments/remediateReleaseRunner.mutation.ts`
- Modify: `packages/api/src/lib/deployments/release-preflight.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/index.ts`
- Modify: `terraform/modules/app/lambda-api/iam-grouped.tf`

### U5. Dispatch and Monitor Reviewed Release Updates

Goal: Replace the direct release update path with reviewed dispatch that uses
preserved config and exposes progress/failure recovery.

Files:

- Modify: `packages/api/src/graphql/resolvers/deployments/startDeploymentReleaseUpdate.mutation.ts`
- Create: `packages/api/src/lib/deployments/release-update-payload.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/releaseUpdateJob.query.ts`
- Modify: `packages/api/src/graphql/resolvers/deployments/shared.ts`
- Modify: `terraform/modules/app/deployment-control-plane/runner.py`

### U6. Build the Settings Release Safety Workflow

Goal: Replace the single confirmation dialog with an operator workflow for
preflight, remediation, config review, dispatch, progress, and recovery.

Files:

- Modify: `apps/web/src/components/settings/SettingsGeneral.tsx`
- Modify: `apps/web/src/lib/settings-queries.ts`
- Modify: `apps/web/src/components/settings/SettingsGeneral.test.tsx`
- Modify: `apps/web/src/gql/graphql.ts`
- Modify: `apps/web/src/gql/gql.ts`

### U7. Update Documentation, Runbooks, and Verification Coverage

Goal: Make the new Settings path operationally clear and prove the v187 TEI and
McPherson failure modes are covered.

Files:

- Modify: `docs/src/content/docs/deploy/github-free-customer-deployments.mdx`
- Modify: `docs/src/content/docs/deploy/release-manifests.mdx`
- Modify: `docs/runbooks/customer-domain-claim-runbook.md`
- Modify: `docs/solutions/integration-issues/customer-control-plane-frozen-bootstrap-incompatibility.md`
- Create: `docs/verification/settings-release-upgrade-safety.md`

## Verification

Run focused package tests for each unit, then affected package typecheck/lint.
Before merging UI work, run component tests and browser verification for the
Settings release flow. Do not run production deploys or manual AWS mutations as
part of implementation.

## Sources

- Linear issue THNK-24
- Linear document "Requirements: Settings Release Upgrade Safety"
- Linear document "Plan: Make Settings Release Upgrades Safe"
- `docs/solutions/integration-issues/customer-control-plane-frozen-bootstrap-incompatibility.md`
- `docs/solutions/architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md`
- `docs/solutions/architecture-patterns/release-manifest-deployment-status-contract-2026-06-11.md`
