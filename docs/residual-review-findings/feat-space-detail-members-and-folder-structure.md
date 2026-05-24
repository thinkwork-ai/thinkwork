---
branch: feat/space-detail-members-and-folder-structure
review_run_id: 20260524-123001-b6f42630
created: 2026-05-24
---

# Residual Review Findings

Compound-engineering pipeline (LFG / `mode:autofix`) ran on `feat/space-detail-members-and-folder-structure` against `b6f6cd8ff313733b1a87cda150a008d41cbb0cf2`. All `safe_auto` fixes were applied in commit `fix(review): apply autofix feedback`. The following residual findings remain unresolved because they require a deliberate design decision, behavior-changing semantics, pre-existing scope, or schema migrations beyond the autofix safety profile. No issue tracker (`linear`, etc.) is configured for this checkout — recorded inline here as the durable handoff.

## Residual Review Findings

- **[P2] Silent ok:true when WORKSPACE_BUCKET unset (gated_auto)** — `packages/api/src/lib/workspace-map-generator.ts:1236-1238`. Both agent and Space paths return `null` from the loader and the Lambda handler responds `200 ok:true` even though nothing was written. Pre-existing on agent path; extended to Space path. Fix changes API contract — should be a deliberate change with monitoring/alerting set up.
- **[P3] Latent read-replica race in addSpaceMember post-insert re-SELECT (gated_auto)** — `packages/api/src/graphql/resolvers/spaces/addSpaceMember.mutation.ts:57-68`. Currently latent (db routes writes-then-reads to the same endpoint). Construct return value inline or wrap insert+select in a transaction; minor optimization, deferred to keep autofix scope tight.
- **[P2] TOCTOU on accessMode flip — stale space_members survive PUBLIC↔PRIVATE transitions (gated_auto)** — `packages/api/src/graphql/resolvers/spaces/addSpaceMember.mutation.ts` + `updateSpace.mutation.ts`. Two paths: SELECT FOR UPDATE on spaces row, or cascade-clear space_members on PRIVATE→PUBLIC in updateSpace, or DB trigger/CHECK rejecting INSERT into space_members for non-private parent. Significant semantics decision; defer.
- **[P3] No partial unique index on `role = 'owner'` — multi-owner state structurally permitted (advisory)** — `packages/database-pg/src/schema/spaces.ts`. Today only `createSpace` inserts an owner, so the risk is latent. Add `CREATE UNIQUE INDEX uq_space_members_one_owner ON space_members (tenant_id, space_id) WHERE role = 'owner'` when a `transferSpaceOwnership` mutation lands.
- **[P1] `regenerateWorkspaceMap` duplicates ~180 lines of loading logic with `loadWorkspaceMapRenderContext` (manual)** — `packages/api/src/lib/workspace-map-generator.ts`. Pre-existing duplication; not introduced by this PR. Refactor in a separate cleanup ticket so the helper has four callers instead of three.
- **[P2] `loadSpaceFolderStructureContext` has a single caller — abstraction not yet earned (manual)** — `packages/api/src/lib/workspace-map-generator.ts:1318-1367`. Kept symmetric with agent-side helper for future callers. Inline if no second caller materializes.
- **[P2] Pre-existing: `tenantMembers` resolver doesn't verify caller is in target tenant (manual)** — `packages/api/src/graphql/resolvers/core/tenantMembers.query.ts:8-23`. Pre-existing across multiple consumers (ComputerAccessUsersTable, Users page, AddSpaceMemberDialog). Out of scope for this PR; needs a dedicated security pass.
- **[P3] `SpaceMembersPanel` and `AddSpaceMemberDialog` have no component-render tests (advisory)** — Source-introspection in `-spaces-admin-route.test.ts` covers the structural contract. Component-render tests would need urql Provider + dialog rendering infra; cost-benefit doesn't justify for v1. Mirror the `SpaceEmailTriggersToggle.test.tsx` pattern in a follow-up.
- **[P1] Pre-existing dead code: `EmptyPanel` function never called (advisory)** — `apps/admin/src/components/spaces/SpaceDetailChrome.tsx:815`. Pre-existing (`6464c1e2e` from 2026-05-21). Not introduced by this PR; cleanup is out of scope.

## Source

Run artifact: `/tmp/compound-engineering/ce-code-review/20260524-123001-b6f42630/run-artifact.json` (local; not committed)
Reviewers: ce-correctness-reviewer, ce-security-reviewer, ce-maintainability-reviewer, ce-api-contract-reviewer, ce-testing-reviewer, ce-kieran-typescript-reviewer, ce-project-standards-reviewer, ce-adversarial-reviewer
