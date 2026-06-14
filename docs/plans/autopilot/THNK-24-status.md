# THNK-24 Autopilot Status

Linear: https://linear.app/thinkworkai/issue/THNK-24/make-settings-release-upgrades-safe-for-external-customer-environments

## Current State

- Started: 2026-06-14
- Active branch: `codex/thnk-24-u1-runner-metadata`
- Active unit: U1, release manifest runner metadata
- Linear state: Verification

## Context Discovery

- Read `AGENTS.md`.
- Fetched THNK-24 issue description, comments, attached Linear requirements,
  attached Linear plan, labels, status list, and child issues.
- Child issues: none found.
- Attachments: none found.
- Relevant local files found:
  - `packages/release-manifest/src/index.ts`
  - `scripts/release/build-release-manifest.ts`
  - `.github/workflows/release.yml`
  - `packages/api/src/graphql/resolvers/deployments/deploymentReleases.query.ts`
  - `packages/api/src/graphql/resolvers/deployments/startDeploymentReleaseUpdate.mutation.ts`
  - `apps/web/src/components/settings/SettingsGeneral.tsx`
  - `docs/solutions/integration-issues/customer-control-plane-frozen-bootstrap-incompatibility.md`
  - `docs/solutions/architecture-patterns/github-free-customer-deployments-aws-control-plane-pattern-2026-06-06.md`
  - `docs/solutions/architecture-patterns/release-manifest-deployment-status-contract-2026-06-11.md`
- The repo-local THNK-24 requirements and plan named in Linear were not present
  on `origin/main`; this branch recreates the plan from the attached Linear
  source of truth.

## Decisions

- U1 ships first because API preflight/remediation needs immutable runner
  metadata in release manifests.
- IAM drift remediation remains detect-and-block for v1; Settings must not
  mutate live IAM in this issue unless a later approved unit changes that
  posture.
- No production deploys or manual AWS mutations will be run during
  implementation.

## Progress Log

- 2026-06-14: Moved THNK-24 to In Progress.
- 2026-06-14: Created U1 branch from `origin/main`.
- 2026-06-14: Added local implementation plan and autopilot status ledger.
- 2026-06-14: Implemented U1 release manifest runner script metadata and
  release bundle staging.
- 2026-06-14: Opened U1 PR and moved THNK-24 to Verification.

## Implementation Units

- U1. Extend release manifest runner metadata: PR open; pending CI/review.
- U2. Add release update job substrate: pending.
- U3. Implement release preflight service: pending.
- U4. Add safe runner refresh remediation: pending.
- U5. Dispatch and monitor reviewed release updates: pending.
- U6. Build Settings release safety workflow: pending.
- U7. Update docs, runbooks, and verification coverage: pending.

## PRs

- U1: https://github.com/thinkwork-ai/thinkwork/pull/2473

## CI / Verification

- `pnpm --filter @thinkwork/release-manifest test`: passed.
- `pnpm exec tsx --test scripts/release/__tests__/build-release-manifest.test.ts`:
  passed.
- `pnpm --filter @thinkwork/release-manifest typecheck`: passed.
- `pnpm dlx prettier@3.5.3 --check ...`: passed for supported touched files.
- `scripts/release/package-platform-artifacts.sh` smoke with a temporary release
  root: passed; tarball includes `lambdas/`, `static/`, and
  `runner/thinkwork-runner.py`.
- `pnpm prettier --write ...`: unavailable locally because this checkout's
  workspace scripts reference `prettier`, but no installed workspace package
  exposes the binary. Used `pnpm dlx prettier@3.5.3` for formatting instead.
- `pnpm install`: completed; optional `canvas` native build emitted the known
  Node 25/pkg-config warning while installation still exited successfully.

## Blockers

- None.
