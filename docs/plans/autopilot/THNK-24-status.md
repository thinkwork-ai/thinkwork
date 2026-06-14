# THNK-24 Autopilot Status

Linear: https://linear.app/thinkworkai/issue/THNK-24/make-settings-release-upgrades-safe-for-external-customer-environments

## Current State

- Started: 2026-06-14
- Active branch: `codex/thnk-24-u3-release-preflight`
- Active unit: U3, release preflight service
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
- 2026-06-14: U1 PR passed required CI, was rebased onto current `main`,
  passed refreshed CI, squash-merged, and had its remote/local branch cleaned
  up.
- 2026-06-14: Moved THNK-24 back to In Progress for U2 and created branch
  `codex/thnk-24-u2-release-update-jobs`.
- 2026-06-14: Implemented U2 release update job/event schema, GraphQL query,
  generated client types, and focused resolver coverage.
- 2026-06-14: Opened U2 PR and moved THNK-24 to Verification.
- 2026-06-14: U2 CI `Migration Drift Precheck (dev)` failed because the new
  hand-rolled migration objects were not yet present in the dev database.
- 2026-06-14: Applied the scoped U2 dev migration
  `packages/database-pg/drizzle/0169_release_update_jobs.sql` through `psql`
  using the deployed dev database secret, then reran the scoped drift reporter
  and confirmed all declared objects are present.
- 2026-06-14: U2 PR passed refreshed CI after rebasing onto `main`,
  squash-merged, and had its remote/local branch cleaned up.
- 2026-06-14: Moved THNK-24 back to In Progress for U3 and created branch
  `codex/thnk-24-u3-release-preflight`.
- 2026-06-14: Implemented U3 release preflight substrate: additive GraphQL
  mutation, manifest validation, runner hash compatibility, preserved config
  summary, Route53 IAM drift detection, release-update job/event persistence,
  generated client types, and read-only Terraform IAM grants.
- 2026-06-14: Opened U3 PR and moved THNK-24 to Verification.

## Implementation Units

- U1. Extend release manifest runner metadata: merged in PR #2473.
- U2. Add release update job substrate: merged in PR #2475.
- U3. Implement release preflight service: PR open; pending CI/review.
- U4. Add safe runner refresh remediation: pending.
- U5. Dispatch and monitor reviewed release updates: pending.
- U6. Build Settings release safety workflow: pending.
- U7. Update docs, runbooks, and verification coverage: pending.

## PRs

- U1: https://github.com/thinkwork-ai/thinkwork/pull/2473 merged
- U2: https://github.com/thinkwork-ai/thinkwork/pull/2475 merged
- U3: https://github.com/thinkwork-ai/thinkwork/pull/2476

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
- U1 PR CI after rebase: `cla`, `lint`, `test`, `typecheck`, and `verify`
  passed.
- U2 `pnpm schema:build`: passed; AppSync subscription schema unchanged.
- U2 `pnpm --filter thinkwork-cli codegen`: passed.
- U2 `pnpm --filter @thinkwork/web codegen`: passed.
- U2 `pnpm --filter @thinkwork/mobile codegen`: passed.
- U2 `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/deployments/release-update-jobs.test.ts src/graphql/resolvers/deployments/managed-application-deployment.test.ts`:
  passed.
- U2 `pnpm --filter @thinkwork/api typecheck`: passed.
- U2 `pnpm --filter @thinkwork/database-pg typecheck`: passed.
- U2 `pnpm dlx prettier@3.5.3 --check ...`: passed for hand-authored touched
  files. Generated GraphQL bundles were left in native codegen format.
- U2 PR CI first pass: `cla`, `lint`, `typecheck`, and `verify` passed;
  `Migration Drift Precheck (dev)` failed before the dev hand-rolled migration
  was applied; `test` was still running when the failure was triaged.
- U2 scoped dev migration application:
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/database-pg/drizzle/0169_release_update_jobs.sql`:
  passed.
- U2 scoped drift reporter:
  `bash scripts/db-migrate-manual.sh packages/database-pg/drizzle/0169_release_update_jobs.sql`:
  passed after migration application.
- U2 PR CI after rebase: `cla`, `lint`, `test`, `typecheck`,
  `Migration Drift Precheck (dev)`, and `verify` passed.
- U3 `pnpm install`: passed and updated the lockfile for API AWS SDK and
  release-manifest dependencies.
- U3 `pnpm schema:build`: passed; AppSync subscription schema unchanged.
- U3 `pnpm --filter thinkwork-cli codegen`: passed.
- U3 `pnpm --filter @thinkwork/web codegen`: passed.
- U3 `pnpm --filter @thinkwork/mobile codegen`: passed.
- U3 `pnpm --filter @thinkwork/api codegen`: no-op; package has no codegen
  script.
- U3 `pnpm --filter @thinkwork/api exec vitest run src/lib/deployments/release-preflight.test.ts src/graphql/resolvers/deployments/release-update-jobs.test.ts`:
  passed.
- U3 `pnpm --filter @thinkwork/api typecheck`: passed.
- U3 `pnpm --filter @thinkwork/database-pg typecheck`: passed.
- U3 `pnpm --filter @thinkwork/web typecheck`: passed.
- U3 `pnpm --filter thinkwork-cli typecheck`: passed.
- U3 `pnpm --filter @thinkwork/mobile typecheck`: no-op; package has no
  typecheck script.
- U3 `pnpm dlx prettier@3.5.3 --check ...`: passed for hand-authored touched
  files.
- U3 `terraform fmt terraform/modules/app/lambda-api/iam-grouped.tf`: passed.

## Blockers

- None.
