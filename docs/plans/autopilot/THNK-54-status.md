---
linear: THNK-54
title: n8n to ThinkWork Agent
status: active
started: 2026-06-20
target_branch: main
---

# THNK-54 Autopilot Status

## Dispatcher Marker

`dispatcher:THNK-54:ReadyToWork:Codex`

## Context Discovery

- Read `AGENTS.md`.
- Read Linear issue `THNK-54`, including description, state history, labels,
  project, cycle, related issues, attached documents, and relation metadata.
- Read Linear comments for `THNK-54`.
- Read attached Linear document `Requirements: n8n to ThinkWork Agent-Step Bridge`.
- Read attached Linear document `Plan: Add n8n agent-step bridge`.
- Confirmed Linear reports no child issues for `THNK-54`.
- Confirmed `THNK-54` has no blockers and is related to `THNK-50`.
- Read related Linear issue `THNK-50`, including relation metadata and attached
  docs.
- Read `THNK-50` comments for current n8n plugin deployment state and MCP
  version evidence.
- Read `docs/brainstorms/2026-06-20-n8n-thinkwork-agent-step-bridge-requirements.md`.
- Read `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md`.
- Read `docs/plans/2026-06-19-003-feat-n8n-application-plugin-plan.md`.
- Read required solution context:
  - `docs/solutions/architecture-patterns/plugin-source-boundaries-package-owned-deploy-verified-2026-06-17.md`
  - `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Repo search found the THNK-54 requirements doc on `main`; the referenced
  local plan file was missing and has been materialized at
  `docs/plans/2026-06-20-001-feat-n8n-agent-step-bridge-plan.md` from the
  approved Linear plan.

## Plan Source and Conflict Resolution

Primary plan:
`docs/plans/2026-06-20-001-feat-n8n-agent-step-bridge-plan.md`

The newest attached Linear implementation plan is authoritative. It is
consistent with the repo-local requirements document and THNK-50 n8n managed
application direction. No product-scope conflict was found during discovery.

## Implementation Units

1. U1 - Add bridge-run data model and contract types.
2. U2 - Implement bridge credentialing and the start endpoint.
3. U3 - Wire finalization and human-hold behavior.
4. U4 - Deliver n8n resume callbacks with retry and expiry.
5. U5 - Expose bridge telemetry in API and web surfaces.
6. U6 - Document the n8n workflow recipe and operator runbook.
7. U7 - Add end-to-end bridge smoke coverage.

## Dependency Order

U1 -> U2 -> U3 -> U4 -> U5 -> U6 -> U7.

## Linear State Changes

- 2026-06-20: moved `THNK-54` from `Ready to Work` to `In Progress` when U1
  implementation began.

## Active Unit

### U1 - Add bridge-run data model and contract types

Objective: create the durable bridge-run ledger and shared contract helpers for
n8n agent-step runs, including timeout bounds, idempotency key derivation, and
safe audit metadata redaction.

Branch: `codex/thnk-54-u1-n8n-agent-step-contract`

Planned files:

- `packages/database-pg/src/schema/n8n-agent-step-runs.ts`
- `packages/database-pg/src/schema/index.ts`
- `packages/database-pg/drizzle/NNNN_n8n_agent_step_runs.sql`
- `packages/database-pg/graphql/types/n8n-agent-step-runs.graphql`
- `packages/api/src/lib/n8n-agent-step/types.ts`
- `packages/api/src/lib/n8n-agent-step/contract.test.ts`

## Progress Log

### 2026-06-20

- Created unit branch `codex/thnk-54-u1-n8n-agent-step-contract` from
  `origin/main`.
- Materialized the approved THNK-54 plan into `docs/plans/`.
- Created this autopilot status document before starting implementation.
- Moved Linear issue `THNK-54` to `In Progress` and posted the implementation
  start comment with discovery summary and U1 objective.
- Implemented U1 contract/data model:
  - added `n8n_agent_step_runs` Drizzle schema, manual migration, GraphQL type
    definitions, and migration fixture test;
  - added `packages/api/src/lib/n8n-agent-step/types.ts` with timeout,
    idempotency, preview, and metadata redaction helpers;
  - added U1 contract tests for stable idempotency, timeout bounds/defaults,
    metadata redaction, and bounded previews.
- Verification passed:
  - `pnpm --filter @thinkwork/api exec vitest run src/lib/n8n-agent-step/contract.test.ts`
  - `pnpm --filter @thinkwork/api typecheck`
  - `pnpm --filter @thinkwork/database-pg typecheck`
  - `pnpm --filter @thinkwork/database-pg exec vitest run __tests__/migration-0176-n8n-agent-step-runs.test.ts`
  - `pnpm --filter @thinkwork/database-pg test`
  - `pnpm schema:build`
  - `pnpm dlx prettier@latest --check` on touched Markdown/TypeScript/GraphQL
    files
  - `git diff --check`
- Compound review completed with local artifact
  `.context/compound-engineering/ce-code-review/20260620-204942-thnk54-u1/summary.md`.
  One safe redaction-helper autofix was applied before commit; no residual
  actionable findings remain.
- Browser testing reviewed via `ce-test-browser` scope. U1 changes only
  backend schema, GraphQL contract definitions, migration SQL, and API contract
  helpers, so no web route or browser-testable surface changed in this unit.
