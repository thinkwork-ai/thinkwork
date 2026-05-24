---
date: 2026-05-23
status: ready-for-implementation
type: refactor
origin: docs/brainstorms/2026-05-23-remove-legacy-s3-hitl-substrate-requirements.md
parent_plan: docs/plans/2026-05-23-006-refactor-remove-legacy-s3-hitl-substrate-plan.md
---

# refactor: Remove admin `/workspace-reviews` redirect-stub route (HITL U2)

## Summary

Delete the leftover admin `/workspace-reviews` redirect-stub route and the retired-comment block in `apps/admin/src/lib/graphql-queries.ts`. Most of the surface was already retired in PR 2026-04-28-004; what remains is mechanical cleanup. Extracted as a focused per-PR slice from U2 of the parent HITL substrate-removal plan.

## Problem Frame

The admin app once shipped a `/workspace-reviews` queue page that listed every `awaiting_review` workspace run for the tenant. That page was retired and replaced with a redirect to `/inbox`. The stub route file (`apps/admin/src/routes/_authed/_tenant/workspace-reviews/index.tsx`) is now a 10-line `createFileRoute(...).beforeLoad: () => redirect({ to: "/inbox" })` placeholder. Alongside it, `apps/admin/src/lib/graphql-queries.ts` carries a retired-comment block (around lines 478-486) referencing the GraphQL operations the old page consumed. Both belong with the rest of the substrate removal; this PR closes them.

## Implementation Units

### U1. Delete the admin `/workspace-reviews` redirect stub + retired GraphQL helpers + regen routeTree

**Goal:** Delete the redirect-stub route file, remove the retired-comment block from `graphql-queries.ts`, and let TanStack Router's `routeTree.gen.ts` regen wipe the corresponding entries.

**Requirements:** R14 (origin) — "The `/workspace-reviews` route, its sidebar entry, and its page component MUST be removed once the new surfaces achieve parity in dev."

**Dependencies:** None. The route is already a no-op redirect (no live GraphQL queries, no page component, no sidebar entry). Deletion is safe today.

**Files:**
- Delete `apps/admin/src/routes/_authed/_tenant/workspace-reviews/index.tsx` (the 10-line redirect stub)
- Modify `apps/admin/src/lib/graphql-queries.ts` to remove the retired-comment block (~lines 486-492, between the `enqueueComputerTask` mutation body above and the `ModelCatalogQuery` export below; plus any flanking blank lines)
- Regenerate `apps/admin/src/routeTree.gen.ts` via TanStack Router codegen (handled automatically by `pnpm --filter @thinkwork/admin dev` or the project's codegen target)

**Approach:** The stub is self-contained — delete the file and let the route-tree generator drop its entry. Open `graphql-queries.ts`, locate the retired-comment block referencing the workspace-review queries, and delete it cleanly (the surrounding live exports stay). After deletion, run typecheck + lint and confirm `rg "workspace-reviews|workspaceReviews" apps/admin/src` returns zero hits outside the regenerated `routeTree.gen.ts` (which the regen wipes).

**Patterns to follow:** Recent admin route deletions; the existing `graphql-queries.ts` module structure (named export per query, retired-comment blocks marked as such).

**Test scenarios:**
- `pnpm --filter @thinkwork/admin lint typecheck` passes.
- `pnpm --filter @thinkwork/admin test` passes; no test references the deleted route.
- After TanStack Router codegen runs, a grep `rg "workspace-reviews|workspaceReviews" apps/admin/src` returns zero hits (routeTree.gen.ts gets rewritten clean by the regen; the misnamed `mobile-workspace-review-*.test.ts` files do not match this pattern because their filenames use singular "workspace-review", and stay scoped to parent plan U1).
- Manual: after deploy, navigating to `/workspace-reviews` returns 404 (rather than redirecting to `/inbox`).

**Verification:**
- Admin package green on lint, typecheck, test.
- `routeTree.gen.ts` has no `workspace-reviews` entries.
- The retired-comment block in `graphql-queries.ts` is gone; the rest of the module is untouched.

## Scope Boundaries

- No changes to mobile, API, Python runtime, database, or Terraform. Those land in their own per-PR slices of the parent plan.
- No changes to the inbox UI or inbox mutations — only the `workspace-reviews` redirect stub.
- No sidebar config edits (the sidebar is auto-derived from `routeTree.gen.ts`).
- No removal of `apps/admin/src/lib/__tests__/mobile-workspace-review-*.test.ts` — those misnamed admin-harness tests are moved to the mobile-UI slice (parent plan U1), since they import from the mobile package and break U1's typecheck if left where they are.

## Key Technical Decisions

- **Single-unit plan.** The work is one logical commit (stub + retired comment block + auto-regen). Extracting it into multiple units would add ceremony without value.
- **Trust the routeTree regen.** TanStack Router derives `routeTree.gen.ts` from the route directory contents; deleting the route directory and re-running the generator is sufficient — no manual edit of the generated file is needed.
- **Defer misnamed admin tests to U1.** The `mobile-workspace-review-*.test.ts` files under `apps/admin/src/lib/__tests__/` import from `apps/mobile/lib/workspace-review-state` and conceptually belong with the mobile-state deletion. Moved out of this PR's scope per the parent plan.
