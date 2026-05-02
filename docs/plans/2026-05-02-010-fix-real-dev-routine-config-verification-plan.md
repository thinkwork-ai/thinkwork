---
title: Real Dev Routine Config Verification
status: completed
created: 2026-05-02
owner: codex
---

# Real Dev Routine Config Verification

## Purpose

Verify the merged routine recipe graph/config editor against the real deployed dev stack, then fix any blockers that prevent an operator from creating, editing, saving, and testing a routine through the product UI without local GraphQL mocks.

## Context

PR #766 merged the routine graph editor and catalog-owned config metadata. Local browser smoke used a branch-local GraphQL mock because the deployed dev GraphQL API did not yet expose the new config metadata fields during development. The next step is to prove the merged code against real dev once `main` deploys, using the normal admin dev server configuration and real GraphQL/API endpoints.

The repo has no local-only mode. End-to-end routine proof depends on the deployed AWS dev stack, Cognito auth, GraphQL HTTP Lambda, Aurora, and Step Functions.

## Requirements

- R1. Use `main` as the source of truth; do not test stale worktree code.
- R2. Confirm the deployed dev GraphQL schema accepts the new routine config metadata fields.
- R3. Confirm the admin dev server uses the current menu/editor code from `main`.
- R4. Create or edit a real dev routine without local GraphQL mocks.
- R5. Confirm catalog-driven validation works against real API responses.
- R6. Click **Test Routine** on a real routine and confirm a routine execution is created.
- R7. If dev deploy lag or schema/API skew breaks the UI, fix the product path or add a narrowly scoped compatibility fallback.

## Scope

In scope:

- Admin routine create/detail pages.
- Routine recipe catalog and routine definition GraphQL queries.
- Browser-facing validation behavior for routine config fields.
- Minimal API/admin compatibility fixes required for real dev verification.

Out of scope:

- New recipe types or broader workflow-builder redesign.
- Scheduling and webhook trigger authoring beyond confirming routines remain triggerable elsewhere.
- Changing deployed AWS infrastructure outside the normal PR/deploy path.

## Existing Patterns

- `apps/admin/src/lib/graphql-queries.ts` owns admin GraphQL documents and generated code lives under `apps/admin/src/gql/`.
- `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx` already hides the definition panel for older schema errors on initial rollout.
- `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx` uses `routineRecipeCatalog` and `planRoutineDraft` for authoring.
- `packages/api/src/lib/routines/recipe-catalog.ts` owns recipe config metadata; UI should not hardcode Austin-weather-specific behavior.
- `docs/solutions/runtime-errors/stale-agentcore-runtime-image-entrypoint-not-found-2026-04-25.md` documents that deployed proof should validate the actual product path, not a stale/source-only assumption.

## Implementation Units

### U1. Deploy and schema readiness check

Goal: Determine whether dev has deployed the merged routine metadata schema and whether admin dev is pointed at it.

Files:

- Inspect: `.github/workflows/deploy.yml`
- Inspect: `apps/admin/.env`
- Inspect: `apps/admin/src/lib/graphql-queries.ts`

Approach:

- Check the latest `main` deploy status through GitHub Actions.
- Query the real dev GraphQL endpoint through the authenticated admin/browser path or CLI-accessible equivalent.
- Record the exact failure mode if the schema is stale.

Verification:

- The real dev endpoint either accepts routine metadata fields or the blocker is identified concretely.

### U2. Fix real-dev compatibility blockers

Goal: Fix only issues that block the real dev routine config path.

Files:

- Modify as needed: `terraform/modules/app/lambda-api/handlers.tf`
- Modify as needed: `apps/admin/src/components/routines/RoutineDefinitionPanel.tsx`
- Modify as needed: `apps/admin/src/routes/_authed/_tenant/automations/routines/new.tsx`
- Modify as needed: `apps/admin/src/lib/graphql-queries.ts`
- Modify as needed: `packages/api/src/graphql/resolvers/routines/*.ts`
- Modify as needed: `packages/api/src/lib/routines/*.ts`
- Modify as needed: `packages/api/src/lib/system-workflows/*.ts`
- Test as needed: `packages/api/src/__tests__/routines-publish-flow.test.ts`
- Test as needed: `packages/api/src/lib/routines/*.test.ts`

Approach:

- If the `main` deploy is blocked before admin/schema rollout, fix the deploy blocker first so the real dev routine path can become testable.
- Prefer fixing the deployed contract path if the schema should be live.
- If the issue is deploy-version skew that users can hit during rollout, add a narrow fallback that preserves the catalog-owned metadata model and does not duplicate routine-specific UI.
- Keep validation conservative and driven by `configFields`.

Verification:

- Targeted API tests for any API-side change.
- `pnpm --filter @thinkwork/admin codegen` if any GraphQL document changes.
- `pnpm --filter @thinkwork/admin build`.

### U3. Real browser routine smoke

Goal: Prove the UI path against real dev endpoints.

Files:

- No code files expected unless U2 uncovers a fix.

Approach:

- Run `pnpm --filter @thinkwork/admin dev` from this worktree after copying/confirming ignored env configuration.
- Use browser automation against the real dev API, not a mock.
- Exercise:
  - new routine page loads with recipe catalog visible
  - invalid email config blocks publish/save
  - valid config clears validation
  - existing routine detail definition loads metadata-driven fields
  - **Test Routine** creates a real execution row

Verification:

- Browser snapshot or command output confirms the execution appears in the run list or the GraphQL mutation returns a run id.

### U4. Cleanup and PR hygiene

Goal: Leave a durable fix or verification artifact ready to merge.

Files:

- Modify: this plan status when complete.
- Modify: PR body/checklist if a PR is opened.

Approach:

- Stop temporary dev servers.
- Run focused tests and `git diff --check`.
- Commit and open a PR only if code/doc changes are needed beyond this plan.

Verification:

- Working tree is clean after commit.
- PR checks are green.

## Risks

- Main deploy may still be running; browser proof should wait for deploy or identify deploy lag explicitly.
- Real routine tests may send email if the recipe is configured with a live recipient. Use an obvious test recipient or existing safe routine where possible, and avoid changing user-owned production-like routines unnecessarily.
- Generated GraphQL drift can break multiple consumers when schema/documents change; regenerate all affected consumers if schema changes.

## Outcome

- Identified the blocker in the latest `main` deploy: `graphql-http` exceeded AWS Lambda's 4KB environment variable limit while Terraform applied PR #766.
- Removed the bulky system workflow ARN JSON map from the shared Lambda environment and taught `packages/api` to derive the standard system workflow Step Function ARNs from `STAGE`, `AWS_ACCOUNT_ID`, and `AWS_REGION`.
- Verified the current admin UI against the real dev backend on `localhost:5175`.
- Clicked **Test Routine** for `Check Austin Weather E2E 1244`; execution `e0c9567c` appeared in the run list and completed with `Succeeded` in 9.5s.
