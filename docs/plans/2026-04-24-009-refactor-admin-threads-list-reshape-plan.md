---
title: Admin threads list view — drop status-filter / status-sort / status-group cleanup (U7)
type: refactor
status: active
date: 2026-04-24
origin: docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md
---

# Admin threads list view — drop status-filter / status-sort / status-group cleanup (U7)

## Overview

Carves Unit **U7** out of the pre-launch thread-detail cleanup plan (`docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`, lines 563–593) into a standalone, executable slice. U3d (drop status/priority fields, already merged) and U4 (derived `lifecycleStatus` resolver, merged as #546) leave the admin threads **list** view still referencing task-era filter/sort/group options that no longer have a coherent product meaning. This plan removes those references from `apps/admin/src/routes/_authed/_tenant/threads/index.tsx`, drops the `statuses` argument from the admin's `ThreadsPagedQuery`, and adds a defensive rehydrate for stale `localStorage` view state so users with prior sessions don't crash on load.

Scope is strictly admin-client. The `threadsPaged` GraphQL resolver keeps its `statuses` arg — other callers may still use it and removing it is outside this slice.

---

## Problem Frame

The admin threads list view (`apps/admin/src/routes/_authed/_tenant/threads/index.tsx`) was built in the task-era when threads had a writable `status` enum driving filters, sort keys, group-by buckets, and quick-filter presets. U3d/U4 collapsed that behavior: runtime health lives on the derived `lifecycleStatus`, and manual-status mutations are handled via the GraphQL `updateThread` mutation rather than an operator-facing UI axis. What remains in the list view is inert UI: filter chips that filter by values the product doesn't expose, a sort option that sorts by a value that no longer carries meaning, a group-by branch that clusters by the same value, and localStorage state that persists those selections across reloads.

Leaving these in place is low-severity but has real downsides: (1) operators see chips and sort keys that imply status is an operational lever when it isn't; (2) a prior session's localStorage (`thinkwork:threads-view:<tenantId>`) can still hold `statuses: ["todo", "in_progress"]` or `sortField: "status"` and rehydrate into the new view, producing an empty list or undefined sort behavior; (3) the admin continues to send a `statuses` GraphQL argument that the admin itself no longer composes meaningfully.

The parent plan also called for deleting `apps/admin/src/components/threads/KanbanBoard.tsx` and dropping `viewMode: "board"` and `priorities` — but a survey at plan-writing time shows **all three are already gone** from `origin/main`. This plan does not touch them.

---

## Requirements Trace

- R1. After this slice lands, `rg "statuses"` and `rg 'sortField: "status"'` in `apps/admin/src` return zero hits. `rg 'groupBy: "status"'` returns zero hits in the list route. (Parent plan R9 acceptance check; origin verification line 591.)
- R2. The admin no longer sends the `statuses` GraphQL argument from `ThreadsPagedQuery` — neither in the query document nor in the `useQuery` variables object.
- R3. On first load with **fresh** localStorage, the list view renders defaults (updated-desc sort, no group, no status filter).
- R4. On load with a **stale** localStorage blob containing legacy keys (`statuses: [...]`, `sortField: "status"`, `groupBy: "status"`), the view silently strips unknown/unsafe values and renders defaults instead of crashing or rendering an empty list.
- R5. Sort by `Updated`, `Created`, and `Title` continues to work. Group by `Assignee` or `None` continues to work.
- R6. Search and show-archived behavior unchanged.

---

## Scope Boundaries

- **Out of scope — `threadsPaged` resolver arg.** The server-side `threadsPaged(... statuses: [String!] ...)` GraphQL schema arg and resolver implementation stay as-is. Mobile, CLI, or future surfaces may still use them. Removing the schema arg is a separate, coordinated change.
- **Out of scope — `thread.status` column in the row rendering.** The list rows may still display a `StatusBadge` or similar. U7 touches view state and filtering only, not display. Display cleanup belongs to U8 / U9 style reshape units if and when they run.
- **Out of scope — `KanbanBoard.tsx`.** The file is already absent from `origin/main`. Parent plan U7 called for deletion; nothing to delete.
- **Out of scope — `priorities` filter state.** Already absent from `origin/main`.
- **Out of scope — `viewMode: "board"` persistence.** Already absent from `origin/main`.
- **Out of scope — backfill/migration of existing users' localStorage.** The defensive rehydrate in R4 is the migration; we do not write a one-shot migration script.
- **Out of scope — adding a filter/sort by `lifecycleStatus`.** That is a product feature (likely U11+), not a pre-launch cleanup.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` — the sole file with list-view state and filter logic. Current state as surveyed at plan-writing time:
  - `interface ViewState` declares `statuses: string[]`, `sortField: "status" | "title" | "created" | "updated"`, `groupBy: "status" | "assignee" | "none"`.
  - `DEFAULT_VIEW` sets `statuses: []`, `sortField: "updated"`, `groupBy: "none"`.
  - `QUICK_FILTERS` (around lines 82–85) has four presets — All / Active / Backlog / Done — three of which hard-code status lists.
  - Client-side filtering block at lines 185–186 filters by `t.status.toLowerCase()` when `state.statuses.length > 0`.
  - Sort branch at line 204 switches on `state.sortField` with a `"status"` case.
  - Active-filter count at line 225 increments when `state.statuses.length > 0`.
  - `VIEW_STATE_KEY = "thinkwork:threads-view"` at line 241 — per-tenant localStorage key.
  - `useQuery` variables (line ~288) send `statuses: viewState.statuses.length > 0 ? viewState.statuses : undefined` and `sortField: viewState.sortField`.
  - Group-by render branch at lines 356–377 has a `viewState.groupBy === "status"` arm.
- `apps/admin/src/lib/graphql-queries.ts:418–448` — `ThreadsPagedQuery` takes `$statuses: [String!]` and passes it to `threadsPaged(... statuses: $statuses ...)`. This is where the admin-client query string needs pruning.
- `packages/database-pg/graphql/types/threads.graphql:183–192` — schema-side `threadsPaged` definition. **Intentionally unchanged** by this slice.
- Parent plan U7 block: lines 563–593 of `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md`.

### Institutional Learnings

- `docs/solutions/build-errors/worktree-stale-tsbuildinfo-drizzle-implicit-any-2026-04-24.md` — in any fresh worktree, run `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` before `typecheck` to avoid spurious TS7006 noise from codegen types. Memory note: `feedback_worktree_tsbuildinfo_bootstrap`.
- Feedback — `feedback_merge_prs_as_ci_passes`: pre-launch default is squash-merge + delete branch + clean worktree as soon as the 4 CI checks go green.
- Feedback — `feedback_worktree_isolation`: this slice runs on `.claude/worktrees/u7-admin-threads-list-reshape` off `origin/main`. Do not branch/stash in the main checkout.
- Feedback — `feedback_pr_target_main`: PR targets `main`, never another feature branch.

### External References

None — the work is purely a localized view-state cleanup with no new frameworks, APIs, or patterns.

---

## Key Technical Decisions

- **Decision 1: Strip, don't migrate.** On rehydrate, silently drop unknown keys (`statuses`, `priorities`, `viewMode`) and coerce `sortField === "status" | "priority"` to `"updated"`, `groupBy === "status"` to `"none"`. Rationale: the localStorage surface is per-user and per-tenant; any coherent "migration" would require knowing what users meant to select, which we can't. Falling back to defaults is safer than trying to translate stale state.
- **Decision 2: Keep the server resolver arg.** The `statuses` arg on the GraphQL `threadsPaged` query remains. Rationale: mobile and CLI may still use it; no pre-launch benefit to a coordinated schema change; drop from admin-client only.
- **Decision 3: Keep `QUICK_FILTERS` array shape; just shrink it.** Rather than delete the concept, leave a single `{ label: "All", search: "" }`-style preset (or an empty array if no meaningful presets remain) so the UI affordance still exists for a later product decision. If the array naturally collapses to one entry with no filter effect, delete the preset row from the UI too rather than showing a single inert chip. Final choice deferred to implementation based on what reads better.
- **Decision 4: No codegen regen required** if `ThreadsPagedQuery` is changed in a way that only drops variables — codegen will pick up the narrower variable type. If the edit happens to widen or rename other fields, regen via `pnpm --filter @thinkwork/admin codegen`. Verify at implementation time.
- **Decision 5: No tests added.** `apps/admin` has no test harness at `origin/main` (confirmed across U4/U6 review cycles). The parent plan explicitly defers to manual smoke. Test scenarios below are manual verification steps.

---

## Open Questions

### Resolved During Planning

- **Q:** Is `KanbanBoard.tsx` still present? **A:** No — already absent from `origin/main`. Parent plan scope shrinks.
- **Q:** Does view state still have `priorities` or `viewMode`? **A:** No — already absent. Parent plan scope shrinks.
- **Q:** Does the admin query still send `statuses`? **A:** Yes — `ThreadsPagedQuery` at `apps/admin/src/lib/graphql-queries.ts:418–448` still declares `$statuses: [String!]` and passes it. In scope.
- **Q:** Does the schema-side resolver drop its `statuses` arg? **A:** No — out of scope (see Decision 2).
- **Q:** What does the `QUICK_FILTERS` array look like after the status-preset prune? **A:** Deferred to implementation (Decision 3).

### Deferred to Implementation

- **Codegen regen needed?** Implementer runs `pnpm --filter @thinkwork/admin codegen` after editing `graphql-queries.ts`; commits any generated diff. No up-front decision required.
- **Should the `QUICK_FILTERS` array and its chip row be deleted entirely if only one trivial entry remains?** Decide based on what reads cleaner in the diff.
- **Does removing `sortField: "status"` from the union require widening fallback branches elsewhere in the file?** Discover during implementation; the TypeScript narrowing should make this mechanical.

---

## Implementation Units

- U1. **Admin threads list view cleanup + query prune + defensive rehydrate**

**Goal:** Remove all task-era status-based filter/sort/group references from the admin threads list view and its GraphQL query, and add a defensive rehydrate for stale localStorage.

**Requirements:** R1, R2, R3, R4, R5, R6.

**Dependencies:** None beyond `origin/main`. U3d and U4 are already merged.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/threads/index.tsx`
- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Modify: `apps/admin/src/gql/gql.ts` (codegen regen; only if the query edit produces a diff)
- Modify: `apps/admin/src/gql/graphql.ts` (codegen regen; only if the query edit produces a diff)
- Test: none — `apps/admin` has no test infrastructure at `origin/main`; manual smoke only.

**Approach:**

- **ViewState type:** remove the `statuses: string[]` field; narrow `sortField` to `"title" | "created" | "updated"`; narrow `groupBy` to `"assignee" | "none"`.
- **DEFAULT_VIEW:** drop the `statuses: []` entry; `sortField` stays `"updated"`; `groupBy` stays `"none"`.
- **QUICK_FILTERS:** remove the three status-based presets (Active / Backlog / Done). If a single non-filter "All" preset remains, evaluate whether the chip row still earns its screen space (Decision 3).
- **Client-side filter block:** remove the `if (state.statuses.length > 0) { result = result.filter(...) }` chunk.
- **Sort switch:** drop the `case "status":` arm.
- **Active-filter count:** drop the `if (state.statuses.length > 0) count++` line.
- **`useQuery` variables:** drop `statuses` from the variables object passed into `ThreadsPagedQuery`; drop any conditional that sets it. `sortField` is still passed as a string.
- **Group-by render branch:** drop the `viewState.groupBy === "status"` arm. The default render path handles the remaining cases (`"assignee"` and `"none"`).
- **Defensive rehydrate:** in the `useState` initializer that reads `localStorage.getItem(VIEW_STATE_KEY + ":" + tenantId)`, parse the blob and then filter to a whitelist of known-safe keys before merging with `DEFAULT_VIEW`. Explicitly coerce `sortField === "status" || sortField === "priority"` to `"updated"`, and `groupBy === "status"` to `"none"`. Drop unknown top-level keys (`statuses`, `priorities`, `viewMode`, or anything else). Write-back on update already uses the new view shape, so stale keys self-expire on the next save.
- **`ThreadsPagedQuery`:** drop the `$statuses: [String!]` variable declaration and the `statuses: $statuses` call argument. Keep all other args (`search`, `showArchived`, `sortField`, `sortDir`, `limit`, `offset`).
- **Codegen:** run `pnpm --filter @thinkwork/admin codegen` after the query edit; commit any generated diff.

**Execution note:** This is mechanical refactor work on a well-contained file. Standard posture — no test-first required.

**Patterns to follow:**

- The existing `QUICK_FILTERS` array, `ViewState` interface, and `DEFAULT_VIEW` constant shape are the canonical model — edit in place rather than restructuring.
- The rehydrate logic in `U1` should follow the same pattern used elsewhere in the admin for persisted state: parse inside a try/catch, fall back to `DEFAULT_VIEW` on any error or shape mismatch.
- `ThreadLifecycleStatus` from codegen (used in U6 at `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx`) is **not** imported here — this slice does not introduce a lifecycle-based filter; it only removes the old status axis.

**Test scenarios:** all manual, covering R3–R6.

- *Happy path, fresh session.* Clear localStorage for the admin origin, navigate to `/threads`. Verify: default sort is `Updated` descending, no group-by applied, no status filter chips, list renders successfully.
- *Edge case, stale localStorage with legacy keys.* In the browser console: `localStorage.setItem("thinkwork:threads-view:<tenantId>", JSON.stringify({ statuses: ["todo", "in_progress"], priorities: ["high"], sortField: "status", groupBy: "status", viewMode: "board" }))`. Reload `/threads`. Verify: view loads without runtime error, sort is `Updated` (coerced from `"status"`), no group-by (coerced from `"status"`), list renders defaults.
- *Happy path, sort variants.* Change sort to `Created` ascending, reload, verify persistence. Repeat for `Title`.
- *Happy path, group-by.* Change group-by to `Assignee`, verify threads cluster by agent name; change back to `None`, verify single flat list.
- *Happy path, search.* Type a search query, verify filtering works and results reflect the search term.
- *Happy path, show-archived toggle.* Toggle archived filter, verify behavior unchanged.
- *Verification greps.* After the PR lands and codegen is regen'd, `rg "statuses" apps/admin/src/routes/_authed/_tenant/threads/index.tsx` returns zero hits; `rg 'sortField: "status"' apps/admin/src` returns zero hits; `rg 'groupBy: "status"' apps/admin/src/routes` returns zero hits; `rg '\$statuses' apps/admin/src/lib/graphql-queries.ts` returns zero hits.

**Verification:**

- `pnpm --filter @thinkwork/admin codegen` is a no-op (or produces the expected narrower-variable diff).
- `cd apps/admin && pnpm exec tsc --noEmit` shows the same or fewer errors than `origin/main` baseline (no **new** errors introduced). As of 2026-04-24, origin/main's admin tsc baseline is 30 pre-existing errors in unrelated files.
- `pnpm exec prettier --write <touched files>` leaves the tree clean.
- All verification greps above pass.
- Manual smoke scenarios above run cleanly on the dev deploy after merge (per `feedback_merge_prs_as_ci_passes`).

---

## System-Wide Impact

- **Interaction graph:** None. The admin threads list view is a leaf consumer; no callbacks, no cross-surface wiring, no background jobs.
- **Error propagation:** The rehydrate `try/catch` already handles malformed JSON; the added whitelist logic runs inside that same guard.
- **State lifecycle risks:** Stale localStorage is the only pre-existing state concern, and the defensive rehydrate explicitly handles it. Write-back on update uses the new narrower shape, so the stale blob self-heals on the user's next filter/sort/group change.
- **API surface parity:** Mobile (`apps/mobile`) uses its own separate `Thread` query, not `ThreadsPagedQuery`. CLI (`apps/cli`) does not query `threadsPaged`. No parity work needed.
- **Integration coverage:** None — no new cross-layer behavior. Manual smoke against the dev deploy is the integration signal.
- **Unchanged invariants:** (1) The GraphQL schema's `threadsPaged(statuses: [String!], ...)` arg stays. (2) Server-side filter behavior is unchanged. (3) `thread.status` as a Thread field is not touched by this slice — display, mutation, and other consumers are unaffected. (4) Tenant scoping, auth, and show-archived semantics are unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| A downstream component (e.g., a shared status-chip helper) imports a `QUICK_FILTERS` entry or `ViewState.statuses` and typechecks off of it. | TypeScript's narrowing will surface this at `tsc`. If caught, delete/narrow the downstream type reference as part of the same commit; do not widen state back to accommodate legacy callers. |
| Rehydrate coercion misses an edge case (e.g., `sortField: "priority"` that's already stripped at U3d time but hypothetically reappears). | The whitelist approach treats anything not in `{"title", "created", "updated"}` as invalid and falls back to `"updated"`. Unknown values fail closed. |
| A stray `statuses:` reference in non-obvious code (e.g., a dashboard summary card) still relies on the query variable. | Global `rg "statuses"` sweep across `apps/admin/src` is part of the verification greps; any hit is treated as in-scope. |
| Admin tsc baseline regresses. | Compare `tsc` output count before and after; report any new errors and fix in the same PR. |
| The `statuses` arg drop from the query silently breaks because `threadsPaged` resolver treats missing-arg and empty-array differently. | This slice only drops the admin from *sending* the arg; the resolver's default behavior on `statuses = null` or `statuses = undefined` is the production behavior for mobile/CLI already, which is the behavior we want. |

---

## Documentation / Operational Notes

- No docs updates required. The admin threads list is unsurfaced in external docs.
- No runbook or monitoring changes.
- Post-merge validation: manual smoke on the dev deploy covers the happy-path scenarios above; stale-localStorage scenario is easiest to test with a browser console `localStorage.setItem` hack.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-04-24-002-refactor-thread-detail-pre-launch-cleanup-plan.md` (U7 block: lines 563–593; Decision #7 at line 142; Requirement R9; verification line 591; PR sequencing note at line 896).
- **Predecessors on `origin/main`:** U3d (status/priority schema drop, #539 series) and U4 (`thread.lifecycleStatus` resolver, #546).
- **Related active work:** U6 (admin thread detail right-rail reshape, #549 in review; does not touch the list view).
- **Files touched by this slice:**
  - `apps/admin/src/routes/_authed/_tenant/threads/index.tsx`
  - `apps/admin/src/lib/graphql-queries.ts`
  - `apps/admin/src/gql/gql.ts`
  - `apps/admin/src/gql/graphql.ts`
