# THNK-17 Autopilot Status

Issue: THNK-17 - U1: Define Company Brain substrate contract and storage-tier model
Parent: THNK-6 - ThinkWork Brain
Branch: codex/thnk-17-brain-substrate-contract
Worktree: /Users/ericodom/Projects/thinkwork/.Codex/worktrees/thnk-17-brain-substrate-contract
Target branch: main

## Context Discovery

- Read repository AGENTS.md in the main checkout and in the worktree.
- Fetched Linear issue THNK-17 with relations, releases, customer needs, labels, milestone, project, and state history.
- Fetched THNK-6 parent issue, comments, child issue list, attached documents, and attached gzipped Markdown plan.
- Fetched related/blocking context: THNK-15, THNK-18, THNK-19, and THNK-20.
- Fetched Linear documents:
  - Implementation plan: Company Brain physical substrate
  - Company Brain physical substrate requirements
  - OKF considered and deferred for Company Brain
  - Plan: Company Brain Premium Plugin
  - Brainstorm: Company Brain Premium Plugin
- Read repo-local planning/requirements docs from the main checkout:
  - docs/plans/2026-06-13-003-feat-company-brain-physical-substrate-plan.md
  - docs/brainstorms/2026-06-13-company-brain-physical-substrate-requirements.md
- Read relevant prior solution notes:
  - docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md
  - docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md
  - docs/solutions/best-practices/cognee-thread-ingest-explorer-2026-06-04.md
  - docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md
- Searched the repository for THNK-17, THNK-6, THNK-15, Company Brain, Brain substrate, storage tier, redaction, Cognee status, and related filenames.

## Scope Decision

THNK-17 is the first child implementation unit for THNK-6. The parent plan defines U1 as the contract and storage-tier model. THNK-18, THNK-19, and THNK-20 are separate child issues and remain out of scope except for preserving the fields they will consume.

U1 objective: add the durable API/data contract for Company Brain substrate status, storage tier, migration state, operational counters, and Cognee capability posture, with tenant-safe redaction and operator evidence boundaries.

## Implementation Units

1. Database substrate contract
   - Add Brain substrate state, migration, event, and artifact-manifest schema linked to tenants and managed applications/jobs.
   - Represent storage tier as default or production.
   - Preserve explicit migration phase/state and optional capability posture.

2. GraphQL contract and resolvers
   - Add tenant-scoped Brain status query.
   - Split tenant-safe status from admin/operator evidence.
   - Ensure legacy env-derived Cognee status cannot override explicit Brain substrate rows.

3. Tests and generated schema
   - Add resolver tests for default tier, production evidence, redaction, and legacy compatibility.
   - Regenerate GraphQL/AppSync/codegen outputs required by the repo.

## Linear State Changes

- 2026-06-14: Moved THNK-17 from Todo to In Progress before implementation work began.
- 2026-06-14: Moved THNK-17 from In Progress to Review after implementation, verification, and CE review.

## Progress Log

- 2026-06-14: Created isolated worktree from origin/main.
- 2026-06-14: Created autopilot status doc.
- 2026-06-14: Started U1 implementation.
- 2026-06-14: Added Drizzle schema for Brain substrate state, migrations, events, and artifact manifests.
- 2026-06-14: Added GraphQL `companyBrainStatus` contract, resolver, settings query, and focused resolver tests.
- 2026-06-14: Ran `pnpm --filter @thinkwork/database-pg db:generate`; drizzle-kit reached an interactive schema-conflict prompt in the non-TTY shell, so added manual migration `0166_company_brain_substrate_contract.sql` with drift markers.
- 2026-06-14: Regenerated GraphQL codegen for `apps/cli`, `apps/web`, and `apps/mobile`.
- 2026-06-14: Added database migration regression test for the `0166` substrate contract SQL and Drizzle metadata.
- 2026-06-14: Verification passed:
  - `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/brain/companyBrainStatus.query.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/api test`
  - `pnpm --filter @thinkwork/database-pg typecheck`
  - `pnpm --filter @thinkwork/database-pg test`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter thinkwork-cli typecheck`
  - `pnpm schema:build`
  - `bash scripts/db-migrate-manual.sh --dry-run packages/database-pg/drizzle/0166_company_brain_substrate_contract.sql`
  - `pnpm dlx prettier --check apps/web/src/lib/settings-queries.ts packages/api/src/graphql/resolvers/index.ts 'packages/api/src/graphql/resolvers/brain/*.ts' packages/database-pg/src/schema/brain.ts packages/database-pg/graphql/types/brain.graphql docs/plans/autopilot/THNK-17-status.md`
- 2026-06-14: Direct mobile TypeScript invocation (`pnpm --filter @thinkwork/mobile exec tsc --noEmit`) failed on existing app-wide type errors and missing `@react-navigation/native` declarations; mobile GraphQL codegen itself passed.
- 2026-06-14: Ran main-thread CE code review pass against `origin/main`; applied one safe consistency fix so Brain AWSJSON fields always stringify non-null JSON values like existing resolvers.
- 2026-06-14: Moved Linear issue to Review for PR publication.

## Decisions

- Use the Linear-attached Company Brain physical substrate plan as the primary plan. The repo-local plan in the main checkout matches the referenced plan and contains the detailed U1 implementation guidance.
- Keep this branch scoped to THNK-17/U1. Do not include THNK-18 provisioning, THNK-19 S3 manifest writing, THNK-20 Context Engine retrieval routing, or Brain operations UI beyond stable schema/API fields needed by later units.
- Treat the existing `packages/database-pg/src/schema/brain.ts` as the entity-pages schema. New substrate contract tables can live in the same `brain` schema but must not disturb existing page exports.

## Blockers

- None currently.
