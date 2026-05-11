---
id: 2026-05-10-005
type: feat
title: "feat: apps/computer UI updates — loading style, input focus, dropdowns, sort, favorites"
status: active
created: 2026-05-10
depth: standard
---

# feat: apps/computer UI updates — loading style, input focus, dropdowns, sort, favorites

## Summary

Six UI polish changes to `apps/computer`:

1. Main app-shell "Loading" surface gets the existing monospace+shimmer treatment (parity with page-level loaders).
2. The empty-thread composer's focused/dark background goes away.
3. Thread Detail gains a `...` overflow menu with Archive / Delete; deleting offers cascade-delete of attached artifacts.
4. Artifacts list gains a Sort dropdown (Name | Generated date — date sort uses full timestamp).
5. Artifact Detail gains a `...` overflow menu with Favorite / Delete.
6. Sidebar gains a collapsible **Favorites** section (default collapsed) listing favorited artifacts. Section is hidden when there are zero favorites.

Schema scope: add `favorited_at` to `artifacts` so Favorites persist server-side. No archive field on artifacts — Delete is hard delete (per user decision).

---

## Problem Frame

These are pure UX polish items the user surfaced after using the new Computer UI day-to-day. None of them block other product work, but the friction is real:

- The boot-time `Loading…` plaintext at `apps/computer/src/routes/_authed/_shell.tsx:22` doesn't match the polished shimmer affordance the rest of the app already uses (`LoadingShimmer` / `PageSkeleton`).
- The empty-thread composer (`ComputerComposer.tsx`) carries a `bg-background/40 ... dark:bg-input/30` wrapper plus the shared `InputGroup` focus ring, which combine to a visible darker "well" when focused. The user wants the input to be borderless-feeling — no background shift on focus.
- The Thread Detail page has no destructive controls. Threads accumulate; today they can only be archived/deleted via list-level bulk actions or admin tooling.
- Artifacts list sorts alphabetically by title with no UI control. "Most recent first" is the more useful default ordering — but the sort needs to use the full `generatedAt` timestamp, not the date string the column displays.
- Artifact Detail has no destructive controls and no way to favorite an item.
- There's no surface for "the four artifacts I keep opening" — favorites need a sidebar home that doesn't push the existing nav around when empty.

The shipped change should feel like every other dropdown/modal/section in `apps/computer` — uses `@thinkwork/ui` primitives (DropdownMenu, AlertDialog, Collapsible), Sonner toasts for success, urql mutations.

---

## Scope Boundaries

**In scope:**
- App-shell tenant-loading surface uses `<PageSkeleton />` (already wraps `<LoadingShimmer />`).
- `ComputerComposer` focused-bg fix (the empty-thread composer in `src/components/computer/ComputerComposer.tsx`).
- Thread Detail `...` overflow menu: Archive thread, Delete thread. Cascade-delete-confirm dialog when deleting a thread that has attached artifacts.
- Artifact Detail `...` overflow menu: Favorite/Unfavorite, Delete.
- Artifacts list sort dropdown (Name asc | Generated desc — Generated default).
- `favoritedAt: AWSDateTime` column added to artifacts (drizzle hand-rolled migration + schema + GraphQL type + `UpdateArtifactInput`), exposed through the `Applet` GraphQL preview path so the list and sidebar can read it without a second query.
- Sidebar Favorites section: collapsible, default closed, hidden when zero favorites, lists favorited artifacts only.
- Sonner toast on each mutation; urql cache invalidation so list/sidebar reflect changes without manual reload.
- Vitest coverage on the new components and helpers.

**Out of scope:**
- Restyling other "Loading…" surfaces (`memory.pages.tsx`, `memory.kbs.tsx`, `TaskDashboard.tsx` subtitle, `automations.index.tsx`). These are inline indicators, not the main app-boot loader the user named. Sweeping them is scope creep.
- Adding archive semantics to artifacts (no `archived_at` column). User chose hard delete.
- Favoriting threads, memory items, or any non-artifact entity. The phrasing ("only artifacts right now") leaves it open, but the implementation in this plan only wires artifacts. The schema change is per-entity, not a generic favorites table — extending to threads later means adding the same column there, no rework of this work.
- Bulk operations from the sidebar or list (multi-select archive/delete).
- "Undo" on delete. Toast is informational only.
- Reorder of favorites (favorites are sorted by `favoritedAt DESC`, fixed).
- Empty-thread composer focus styling for other surfaces — `TaskThreadView`'s in-thread composer keeps its current styling (the user only flagged the homepage one). Don't touch `PromptInput`/`InputGroup` defaults — fix at the consumer.

### Deferred to Follow-Up Work
- If favorites extend to threads or memory entities, mirror the `favorited_at` column pattern there. A generic `user_favorites` join table can wait until at least three entity kinds need it.
- A `/favorites` route showing all favorites in a full page (vs the sidebar peek).

---

## Key Technical Decisions

### KD1. Single hand-rolled drizzle migration for `favorited_at`
Use a hand-rolled `.sql` file under `packages/database-pg/drizzle/` with the `-- creates: public.artifacts.favorited_at` marker, not a drizzle-kit generated migration. Rationale: matches the established pattern for column-level additions on existing high-traffic tables where we want explicit control over column ordering and indexes. Apply to dev via `psql -f` after merge (`feedback_handrolled_migrations_apply_to_dev`). The `db:migrate-manual` reporter will gate the next deploy if it isn't applied.

### KD2. `favoritedAt: AWSDateTime` rather than `isFavorite: Boolean`
Mirrors the `archivedAt` / `closedAt` / `cancelledAt` pattern already established on `threads`. Lets us sort favorites by recency in the sidebar without an additional column. Setting to `null` un-favorites.

### KD3. Sidebar favorites query is a dedicated GraphQL operation, not a filter on the existing `applets` query
Add a new `favoriteArtifacts(tenantId: ID!): [Artifact!]!` query (or extend the existing `artifacts(...)` query with a `favoritedOnly: Boolean` arg — pick whichever resolver shape is cheapest). Rationale: the sidebar runs on every authed page; we don't want it joined to the main applets list response. Cache-and-network with a small `limit` (20). Cache eviction on `updateArtifact` keeps it fresh.

### KD4. Cascade-delete UI is a single AlertDialog with two checkboxes — but only for delete
When the user clicks Delete on a thread that has ≥1 attached artifact, the AlertDialog body contains a `Checkbox` "Also delete the N attached artifact(s)." The dialog issues `deleteThread` (always) and `deleteArtifact` for each attached artifact (when checkbox is set). When archiving a thread, do **not** show a cascade option — artifacts have no archive semantics, so the choice is moot. Rationale: matches the user's "one dialog, two checkboxes" preference without inventing fictional artifact-archive semantics.

### KD5. PromptInput focus-bg fix at the consumer, not the primitive
`ComputerComposer.tsx:47` is the consumer; remove `bg-background/40 ... dark:bg-input/30` and override the `InputGroup` focus-ring classes by passing className that resets `has-[[data-slot=input-group-control]:focus-visible]:ring-0` (or similar). Do **not** touch `packages/ui/src/components/ui/input-group.tsx` or `apps/computer/src/components/ai-elements/prompt-input.tsx` — those are shared primitives consumed by other PromptInput sites (in-thread `FollowUpComposer` keeps the current look).

### KD6. Sidebar Favorites uses shadcn `Collapsible` (already in @thinkwork/ui)
Wrap a new `SidebarGroup` with `Collapsible defaultOpen={false}`. Hide the entire section when the query returns zero items — no empty-state row. Matches the user's "if there are any favorites, we need to show a Favorites section" constraint.

### KD7. Sort UI mirrors customize-filtering pattern
Extend `artifacts-filtering.ts` with a `sortArtifactItems({ items, sortBy, sortDir })` helper. `sortBy` is `"title" | "generatedAt"`, `sortDir` is `"asc" | "desc"`. Default: `generatedAt` desc. Sort UI is a `Select` added to `ArtifactsToolbar`. Client-side only — no GraphQL change. Aligns with the existing client-side filter helpers and `2026-05-09-009-refactor-artifacts-datatable-plan.md` precedent.

---

## High-Level Technical Design

*This sketch is directional, not implementation specification.*

```
┌────────────────────────────────────────────────────────────────────┐
│ ComputerSidebar                                                    │
│ ├ Header (logo)                                                    │
│ ├ Nav: New, Threads (253), Artifacts, Automations, Memory, Custom. │
│ └ NEW: Collapsible "Favorites" (defaultOpen=false, hidden if empty)│
│         └ FavoriteArtifactsQuery → list of <Link to=artifact/$id> │
└────────────────────────────────────────────────────────────────────┘

Thread Detail header (AppTopBar.actions.action slot):
  ┌─────────────────────────────────────────────┐
  │ ← Map runbook smoke              [•••]      │
  └─────────────────────────────────────────────┘
                                      │
                  ┌───────────────────┴──────────┐
                  │ DropdownMenu                 │
                  │  Archive thread              │
                  │  Delete thread               │
                  └──────────────────────────────┘
                  Delete → AlertDialog:
                    "Delete thread?"
                    [ ] Also delete N attached artifact(s)
                                       (only shown when N > 0)

Artifact Detail header (usePageHeaderActions.action slot):
  ┌─────────────────────────────────────────────┐
  │ ← Pipeline risk dashboard       [•••]       │
  └─────────────────────────────────────────────┘
                                      │
                  ┌───────────────────┴──────────┐
                  │ DropdownMenu                 │
                  │  ★ Favorite / Unfavorite     │
                  │  Delete                      │
                  └──────────────────────────────┘
```

---

## Implementation Units

### U1. Replace app-shell tenant-loading shell with PageSkeleton

**Goal:** The main Loading surface (visible on every authed-page first paint while tenant resolves) uses the monospace+shimmer `LoadingShimmer` style via `PageSkeleton`.

**Requirements:** Request item #1.

**Dependencies:** none.

**Files:**
- `apps/computer/src/routes/_authed/_shell.tsx` (modify)
- `apps/computer/src/routes/_authed/_shell.test.tsx` (new — if no existing test file; otherwise extend)

**Approach:**
- Replace the inline `<div className="...">Loading…</div>` block (currently `_authed/_shell.tsx:19-25`) with `<PageSkeleton />` from `@/components/PageSkeleton`.
- `PageSkeleton` already centers `<LoadingShimmer />` in a full-height container with `bg-background` — exactly the style the user asked for.
- No new components needed. Import `PageSkeleton`, render in the `isLoading` branch.
- Leave the `NoTenantAssigned` branch unchanged.

**Patterns to follow:**
- `automations.index.tsx:329` and `automations.$scheduledJobId.tsx:253` already use `<PageSkeleton />` for the same purpose.

**Test scenarios:**
- Renders `<PageSkeleton />` (and its `data-testid` / role marker) when `useTenant()` returns `{ isLoading: true, noTenantAssigned: false }`.
- Renders `<NoTenantAssigned />` when `noTenantAssigned: true` (regression).
- Renders `<Outlet />` (or wrapping shell) when `{ isLoading: false, noTenantAssigned: false }` (regression).

**Verification:** Loading the app with a slow tenant query shows the shimmer "Loading..." in monospace, not the plain "Loading…" text. Visual parity with `<PageSkeleton />` on the Automations page.

---

### U2. Remove focused background on ComputerComposer

**Goal:** The empty-thread composer no longer shows a darker "well" when focused — no visible background shift, no ring that fills the rounded rectangle.

**Requirements:** Request item #2.

**Dependencies:** none.

**Files:**
- `apps/computer/src/components/computer/ComputerComposer.tsx` (modify)
- `apps/computer/src/components/computer/ComputerComposer.test.tsx` (extend)

**Approach:**
- Strip `bg-background/40 shadow-sm dark:bg-input/30` from the `<PromptInput className=...>` at `ComputerComposer.tsx:47`. Keep `rounded-2xl border border-border/80`.
- The underlying `InputGroup` (in `packages/ui/src/components/ui/input-group.tsx:17`) also applies `dark:bg-input/30` and `has-[[data-slot=input-group-control]:focus-visible]:ring-3 ring-ring/50 border-ring`. We can't strip those at the primitive without breaking other consumers. Solution: append override classes to `PromptInput`'s className that neutralize the focus-state visuals via `has-[...]:` selectors (`has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:border-border/80 dark:bg-transparent`).
- Verify the textarea is still visibly focused (caret + cursor), just without the wrapper darkening. The border stays at `border-border/80` regardless of focus state.
- Do NOT modify `packages/ui/src/components/ui/input-group.tsx` or `apps/computer/src/components/ai-elements/prompt-input.tsx` — those are shared primitives. The fix lives at the consumer.

**Patterns to follow:**
- Tailwind `has-[...]:` arbitrary-selector overrides for state styles — already used in `prompt-input.tsx`.

**Test scenarios:**
- (visual) Manual: focus the textarea on `/new` — wrapper background does not change, no ring fills the rectangle, border stays the same.
- (unit) Snapshot or className assertion: the `PromptInput` wrapper className does not contain `bg-background/40` or `dark:bg-input/30`; the override `has-[...]:ring-0` class is present.
- (regression) The textarea still focuses on mount via `autoFocus` (existing behavior).
- (regression) The in-thread composer (`FollowUpComposer` in `TaskThreadView.tsx`) is untouched.

**Verification:** Visiting `/new`, clicking into the textarea — no darker fill, no ring inside the rounded border. Compared to the user's screenshot, the focused state matches the unfocused state except for the textarea cursor.

---

### U3. Add `favorited_at` to artifacts schema (migration + GraphQL + codegen)

**Goal:** Backend foundation for artifact favorites. Adds a `favorited_at` timestamptz column to `artifacts`, exposes it on the `Artifact` and `Applet` GraphQL types, accepts it in `UpdateArtifactInput`. Regenerates codegen in all consumers.

**Requirements:** Backbone for items #5 and #6.

**Dependencies:** none.

**Files:**
- `packages/database-pg/src/schema/artifacts.ts` (modify — add column + index)
- `packages/database-pg/drizzle/NNNN_artifacts_favorited_at.sql` (new — hand-rolled, with `-- creates: public.artifacts.favorited_at` marker and a rollback file `NNNN_artifacts_favorited_at_rollback.sql`)
- `packages/database-pg/graphql/types/artifacts.graphql` (modify — add `favoritedAt: AWSDateTime` to `Artifact`, add `favoritedAt: AWSDateTime` to `UpdateArtifactInput`, expose on `Applet` preview if Applet returns Artifact subset)
- `packages/api/src/graphql/resolvers/artifacts.ts` (or wherever Artifact resolvers live — modify to surface and accept the column)
- `apps/computer/codegen.ts` / `apps/admin/codegen.ts` / `apps/mobile/codegen.ts` / `apps/cli/codegen.ts` / `packages/api/codegen.ts` — re-run codegen
- `packages/database-pg/src/schema/__tests__/artifacts.test.ts` (extend — if exists; otherwise skip)
- `packages/api/src/graphql/resolvers/__tests__/artifacts.test.ts` (extend)

**Approach:**
- Drizzle schema: add `favorited_at: timestamp("favorited_at", { withTimezone: true })` (nullable). Add `index("idx_artifacts_favorited_at").on(table.tenant_id, table.favorited_at)` so the sidebar query stays fast.
- Hand-rolled migration:
  ```sql
  -- creates: public.artifacts.favorited_at
  ALTER TABLE public.artifacts ADD COLUMN favorited_at timestamptz;
  CREATE INDEX IF NOT EXISTS idx_artifacts_favorited_at
    ON public.artifacts (tenant_id, favorited_at)
    WHERE favorited_at IS NOT NULL;
  ```
- Rollback: `ALTER TABLE public.artifacts DROP COLUMN favorited_at;` + `DROP INDEX IF EXISTS idx_artifacts_favorited_at;`
- GraphQL: add `favoritedAt: AWSDateTime` to `Artifact`, `UpdateArtifactInput`, and either extend `applets` to include `favoritedAt` on the preview or expose it via the existing `applet(appId)` query so the artifact detail page can read it. If `AppletQuery` already returns the underlying `Artifact`, this is a one-line add; if it returns a flattened preview type, add the field to the preview too.
- Resolver: pass-through. `updateArtifact` should accept `favoritedAt: null` to un-favorite (the `||` vs `??` distinction matters — use `??` so explicit null wins).
- Schema-build: `pnpm schema:build` after the GraphQL change to regenerate `terraform/schema.graphql`.
- Apply migration to dev: after merge, `psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_artifacts_favorited_at.sql`. Resolve DB credentials via the documented `aws secretsmanager` lookup pattern.

**Patterns to follow:**
- `2026-04-21-bundled-cli-skills...plan.md` and other recent column-addition plans.
- `threads.archivedAt` is the model for nullable-timestamp-as-flag.
- Hand-rolled migration convention: `feedback_handrolled_migrations_apply_to_dev`.

**Execution note:** Backend-only unit. Ship inert (per `feedback_ship_inert_pattern`) — no UI references this column until U5/U7 land. Schema-build + codegen are required before U5/U7 can typecheck.

**Test scenarios:**
- DB migration: applying `NNNN_artifacts_favorited_at.sql` to a fresh dev db adds the column with `IS NULL` default and creates the partial index. `db:migrate-manual` reports it as present.
- GraphQL: `updateArtifact(id, { favoritedAt: "2026-05-10T..." })` returns the updated artifact with the timestamp. `updateArtifact(id, { favoritedAt: null })` clears it. Other fields untouched.
- GraphQL: `artifact(id)` returns `favoritedAt` in the response.
- Codegen: `pnpm --filter @thinkwork/computer codegen` (and admin, mobile, cli, api) succeed with no type errors.

**Verification:** `pnpm -r --if-present build && pnpm -r --if-present typecheck && pnpm -r --if-present test` green from the repo root. Dev-deployed GraphQL endpoint accepts `favoritedAt` in `updateArtifact` mutation when smoke-tested.

---

### U4. Artifacts list sort UI (Name / Generated date)

**Goal:** Artifacts list lets the user sort by Name (asc) or Generated date (desc using full timestamp). Default: Generated desc.

**Requirements:** Request item #4.

**Dependencies:** none. (No schema change — uses existing `generatedAt`.)

**Files:**
- `apps/computer/src/components/artifacts/artifacts-filtering.ts` (modify — add sort helper, ALL_SORT constants)
- `apps/computer/src/components/artifacts/ArtifactsToolbar.tsx` (modify — add Sort `Select`)
- `apps/computer/src/components/artifacts/ArtifactsListBody.tsx` (modify — pass sort state, use helper)
- `apps/computer/src/components/artifacts/artifacts-filtering.test.ts` (new or extend)
- `apps/computer/src/components/artifacts/ArtifactsToolbar.test.tsx` (extend if exists)

**Approach:**
- Add to `artifacts-filtering.ts`:
  ```ts
  export const SORT_NAME = "name" as const;
  export const SORT_GENERATED = "generatedAt" as const;
  export type ArtifactSortBy = typeof SORT_NAME | typeof SORT_GENERATED;
  export function sortArtifactItems(
    items: ArtifactItem[],
    sortBy: ArtifactSortBy,
  ): ArtifactItem[] { ... }
  ```
  - `SORT_NAME`: `title.localeCompare(otherTitle)` ascending.
  - `SORT_GENERATED`: ISO string compare on `generatedAt`, **descending** (most recent first). Empty `generatedAt` strings sort last regardless of direction (stable null handling).
- `ArtifactsToolbar`: add a small `Select` (placement: after the search input, before the kind filter, OR after the kind filter — pick whichever reads best at the existing widths). Trigger label: `Sort: Generated` or `Sort: Name`. Options labeled `Generated (newest)` and `Name (A–Z)`.
- `ArtifactsListBody`: replace the hardcoded `sort((a, b) => a.title.localeCompare(b.title))` at `ArtifactsListBody.tsx:90` with `sortArtifactItems(items, sortBy)`. Add `sortBy` state, default `SORT_GENERATED`. Pass `sortBy` and `onSortByChange` to `ArtifactsToolbar`.
- Sort runs **before** filter (so search/kind/tab filter the sorted list — order is preserved).

**Patterns to follow:**
- Mirror the customize-filtering helper pattern referenced by `2026-05-09-009-refactor-artifacts-datatable-plan.md`.
- `Select` styling: match existing `ArtifactsToolbar` kind selector (`h-8 min-w-[10rem]`).

**Test scenarios:**
- `sortArtifactItems` with `SORT_NAME` on `["Beta", "alpha", "Charlie"]` returns `["alpha", "Beta", "Charlie"]` (case-insensitive via localeCompare).
- `sortArtifactItems` with `SORT_GENERATED` returns most-recent-first, **including time-of-day distinction** when two items share a date — verify that `2026-05-10T10:00:00Z` sorts after `2026-05-10T08:00:00Z`. (Directly covers item #4's "including the time in the sort even though time isn't displayed".)
- `sortArtifactItems` is stable for items with empty `generatedAt` — they sort last in both directions.
- `ArtifactsListBody` default state shows generated-desc order on first render.
- Changing the Sort `Select` updates the visible order without changing filter state (search/kind/tab preserved).
- (regression) Search + sort: searching "report" while sorted by Name returns matching items in name order; switching sort to Generated re-orders them.

**Verification:** With ≥3 artifacts created across different days/times, the default view shows the newest first. Switching to Name reorders alphabetically. Sort survives filter changes.

---

### U5. Artifact Detail overflow menu (Favorite, Delete)

**Goal:** A `...` button in the Artifact Detail header opens a DropdownMenu with "Favorite" / "Unfavorite" and "Delete". Delete confirms via AlertDialog and navigates back to `/artifacts`. Favorite toggles `favoritedAt` and shows a Sonner toast.

**Requirements:** Request item #5.

**Dependencies:** U3 (column + mutation must exist).

**Files:**
- `apps/computer/src/components/artifacts/ArtifactDetailActions.tsx` (new — encapsulates the dropdown + dialog)
- `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx` (modify — render `<ArtifactDetailActions />` into the `headerAction` slot)
- `apps/computer/src/lib/graphql-queries.ts` (modify — add `UpdateArtifactMutation` and `DeleteArtifactMutation` if not already present; check `AppletQuery` includes `favoritedAt`)
- `apps/computer/src/components/artifacts/__tests__/ArtifactDetailActions.test.tsx` (new)

**Approach:**
- New `ArtifactDetailActions` component takes `{ artifactId, favoritedAt }` props and returns:
  - `<DropdownMenu>` with trigger `<Button variant="ghost" size="icon-sm"><MoreHorizontal /></Button>` (lucide `MoreHorizontal` or `Ellipsis`).
  - Menu items:
    - "Add to favorites" / "Remove from favorites" — calls `updateArtifact(id, { favoritedAt: new Date().toISOString() | null })`. Optimistic urql cache update + Sonner toast. Use `cache-and-network`'s default invalidation; `updateArtifact` response will refresh the artifact's `favoritedAt` field automatically.
    - "Delete" — opens `<AlertDialog>` (controlled state). On confirm: `deleteArtifact(id)`, navigate to `/artifacts`, Sonner toast.
- `artifacts.$id.tsx`: pass the artifact's `favoritedAt` and id into `<ArtifactDetailActions />`, then `setHeaderAction(<ArtifactDetailActions ... />)` via `handleHeaderActionChange` or a local effect (mirror the existing `headerAction` mechanism at `artifacts.$id.tsx:72-83`).
- Update `AppletQuery` (or the underlying `applet` resolver consumer) to include `artifact.favoritedAt`.

**Patterns to follow:**
- `MemoryDetailSheet.tsx:152-196` for AlertDialog usage on destructive actions.
- `@thinkwork/ui` `DropdownMenu*` import path.
- Sonner toast pattern used elsewhere (`import { toast } from "sonner"`).

**Test scenarios:**
- Renders dropdown with two items when `favoritedAt` is `null` ("Add to favorites" + "Delete").
- Renders "Remove from favorites" when `favoritedAt` is set.
- Clicking "Add to favorites" fires `UpdateArtifactMutation` with `{ favoritedAt: <ISO string> }`. Stub the mutation, assert call.
- Clicking "Remove from favorites" fires `UpdateArtifactMutation` with `{ favoritedAt: null }`.
- Clicking "Delete" opens `AlertDialog`; clicking the dialog's Cancel closes it without mutation.
- Clicking the dialog's "Delete" button fires `DeleteArtifactMutation` and navigates to `/artifacts` on success.
- Sonner toast assertions (success path) for each of the three actions.
- (regression) Header action slot still clears when the artifact navigates away (existing `useEffect` at `artifacts.$id.tsx:92-104` continues to work).

**Verification:** Open an artifact detail page → `...` button visible top-right. Favorite/unfavorite, refresh page — state survives. Delete confirms, navigates back, item is gone from the list.

---

### U6. Thread Detail overflow menu (Archive, Delete + cascade)

**Goal:** A `...` button in the Thread Detail header opens a DropdownMenu with "Archive thread" and "Delete thread". Archive calls `updateThread(archivedAt: now)`; Delete opens an AlertDialog that shows a cascade-delete checkbox when the thread has attached artifacts.

**Requirements:** Request item #3.

**Dependencies:** none. (Uses existing `updateThread` + `deleteThread` + `deleteArtifact` mutations.)

**Files:**
- `apps/computer/src/components/computer/ThreadDetailActions.tsx` (new)
- `apps/computer/src/components/computer/ComputerThreadDetailRoute.tsx` (modify — render `<ThreadDetailActions />` into the page header via `usePageHeaderActions({ action: ... })`)
- `apps/computer/src/lib/graphql-queries.ts` (modify — add `UpdateThreadMutation`, `DeleteThreadMutation` if not present; add a `ThreadAttachedArtifactsQuery` to count attached artifacts, OR include `attachedArtifacts { id title }` in `ComputerThreadQuery`)
- `apps/computer/src/components/computer/__tests__/ThreadDetailActions.test.tsx` (new)

**Approach:**
- New `ThreadDetailActions` takes `{ threadId, attachedArtifacts: { id, title }[] }` props.
- DropdownMenu trigger: ghost icon button with `MoreHorizontal`.
- Menu items:
  - "Archive thread" — calls `updateThread(id, { archivedAt: new Date().toISOString() })`. Sonner toast. Navigate to `/threads` on success. **No cascade prompt** (artifacts have no archive — KD4).
  - "Delete thread" — opens AlertDialog.
- Delete AlertDialog:
  - Title: "Delete this thread?"
  - Description: short warning about permanence.
  - When `attachedArtifacts.length > 0`: render a `<Checkbox>` (`shadcn-ui` / `@thinkwork/ui`) labeled `Also delete the ${count} attached artifact${count === 1 ? "" : "s"}.` Default unchecked. Use a `useState` local boolean.
  - Footer: AlertDialogCancel + AlertDialogAction "Delete".
  - On confirm:
    - If checkbox set, iterate `attachedArtifacts` and call `deleteArtifact(id)` for each (fire in parallel via `Promise.all`).
    - Then call `deleteThread(id)`.
    - Navigate to `/threads`. Sonner toast: "Thread deleted." If cascade ran: "Thread and N artifact(s) deleted."
- `ComputerThreadDetailRoute.tsx`:
  - Extend `ComputerThreadQuery` or add a sibling query to fetch the artifacts where `threadId = id`. Reuse the existing `artifacts(tenantId, threadId)` query.
  - Wire `<ThreadDetailActions />` into the header via the existing `usePageHeaderActions({ action: ... })` call at line 96 — add an `action: <ThreadDetailActions ... />` field.

**Patterns to follow:**
- `MemoryDetailSheet.tsx:83-196` (AlertDialog with a controlled-checkbox body is a slight extension of this pattern; the checkbox state stays local to the dialog).
- `@thinkwork/ui` `Checkbox` primitive.
- `usePageHeaderActions` slot at `AppTopBar.tsx:92-94`.

**Test scenarios:**
- Renders dropdown with "Archive thread" and "Delete thread".
- Clicking "Archive thread" fires `UpdateThreadMutation` with `{ archivedAt: <ISO string> }`, navigates to `/threads`.
- Clicking "Delete thread" opens AlertDialog. With **zero** attached artifacts, no checkbox is rendered.
- With **one** attached artifact, checkbox renders with singular wording "Also delete the 1 attached artifact."
- With **three** attached artifacts, checkbox renders with plural wording "Also delete the 3 attached artifacts."
- Confirming delete with checkbox unset: only `DeleteThreadMutation` fires; no `deleteArtifact` calls.
- Confirming delete with checkbox set: `deleteArtifact` fires once per artifact, then `deleteThread`. Assert ordering or at least that all fire.
- Cancel closes the dialog without mutations.
- (edge) Cascade delete where one artifact's delete fails: thread delete still proceeds; toast surfaces a partial-failure message ("Thread deleted, 1 of 3 artifacts could not be deleted."). Implementer chooses Promise.allSettled.
- (regression) `usePageHeaderActions` continues to receive title + backHref; documentTitle prefix preserved.

**Verification:** Open a thread that has ≥1 artifact attached, click `...`, Delete → dialog shows checkbox. Confirm with checkbox on → both thread and artifacts gone from their lists. Archive → thread disappears from default list (showArchived=false), still visible when toggling archived view.

---

### U7. Sidebar Favorites collapsible section

**Goal:** A new collapsible "Favorites" section appears in the sidebar below the main nav. Default state: collapsed. Hidden entirely when zero favorites exist. Lists favorited artifacts (sorted by `favoritedAt` desc), each as a clickable link to its detail page.

**Requirements:** Request item #6.

**Dependencies:** U3 (column + GraphQL must exist), U5 (so users have a way to favorite something).

**Files:**
- `apps/computer/src/components/ComputerSidebar.tsx` (modify — add Favorites group)
- `apps/computer/src/components/sidebar/FavoritesSection.tsx` (new — encapsulate the query + collapsible)
- `apps/computer/src/lib/graphql-queries.ts` (modify — add `FavoriteArtifactsQuery`)
- `apps/computer/src/components/sidebar/__tests__/FavoritesSection.test.tsx` (new)
- `packages/api/src/graphql/resolvers/artifacts.ts` (modify — if going the `favoritedOnly: Boolean` arg route, add the filter; or add a new `favoriteArtifacts` resolver)
- `packages/database-pg/graphql/types/artifacts.graphql` (modify — extend query with the arg or new field)

**Approach:**
- Backend resolver: extend the existing `artifacts(tenantId, ...)` query with `favoritedOnly: Boolean` (preferred — fewer new endpoints), or add a `favoriteArtifacts(tenantId: ID!, limit: Int): [Artifact!]!` query. Filter `WHERE favorited_at IS NOT NULL ORDER BY favorited_at DESC LIMIT <limit>`. Default limit 20.
- New `FavoritesSection` component:
  ```tsx
  <Collapsible defaultOpen={false}>
    <SidebarGroup>
      <CollapsibleTrigger asChild>
        <SidebarGroupLabel>
          <Star className="..." /> Favorites <ChevronDown className="..."/>
        </SidebarGroupLabel>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SidebarGroupContent>
          <SidebarMenu>
            {favorites.map(f => (
              <SidebarMenuItem key={f.id}>
                <SidebarMenuButton asChild>
                  <Link to={computerArtifactRoute(f.id)}>{f.title}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </CollapsibleContent>
    </SidebarGroup>
  </Collapsible>
  ```
- If query returns zero items → return `null` from the component. **No empty section, no header.**
- urql `cache-and-network` so favorite/unfavorite mutations elsewhere refresh the sidebar.
- Section sits after the main nav `SidebarGroup` in `ComputerSidebar.tsx` (after line 176).
- When sidebar is collapsed (`group-data-[collapsible=icon]`), hide the favorites section entirely or collapse to just the star icon. Match the main nav's collapse behavior (mostly handled by `Sidebar` primitive).

**Patterns to follow:**
- `ComputerSidebar.tsx` structure (Sidebar / SidebarContent / SidebarGroup).
- `Collapsible` from `@thinkwork/ui`.
- `useQuery` w/ tenant from `useTenant()`, paused until tenant ready (mirror `ThreadsPagedQuery` usage in the file).

**Test scenarios:**
- Query returns zero items → component renders `null` (no empty section shell).
- Query returns three items → section is rendered, collapsed by default. The three artifact titles are NOT visible until the trigger is clicked.
- Clicking the trigger expands the section, revealing the artifact links in `favoritedAt` desc order.
- Each link navigates to `computerArtifactRoute(id)`.
- After favoriting an artifact (U5), `cache-and-network` refresh adds it to the list (integration-ish — assert query is re-fetched on cache key invalidation).
- (regression) Other sidebar nav items still render in the same order.
- (responsive) When sidebar collapses to icon-only, the favorites section doesn't break the layout (the section header collapses or hides — chosen behavior is documented in the test).

**Verification:** Log in fresh user with zero favorites → no Favorites section in sidebar. Favorite an artifact via U5 → section appears, collapsed. Click to expand → artifact link visible. Click link → navigates to artifact detail. Unfavorite → list updates; if it was the last one, section disappears.

---

## System-Wide Impact

- **GraphQL schema**: one new column (`Artifact.favoritedAt`), one input field (`UpdateArtifactInput.favoritedAt`), optionally one query arg or new query (favorites lookup). Codegen consumers: `apps/computer`, `apps/admin`, `apps/mobile`, `apps/cli`, `packages/api` — each will need `pnpm --filter <name> codegen` after the GraphQL edit. Run `pnpm schema:build` so `terraform/schema.graphql` (AppSync subscription schema) regenerates if any subscription type referenced Artifact (unlikely but cheap to verify).
- **Database migration**: hand-rolled `.sql`, gated by the `db:migrate-manual` deploy reporter. Apply to dev before the next deploy or the deploy fails (`feedback_handrolled_migrations_apply_to_dev`).
- **GraphQL Lambda**: `packages/api` resolver changes ship via PR to `main` (`feedback_graphql_deploy_via_pr`). Do not `aws lambda update-function-code` directly.
- **Mobile**: the schema change is non-breaking (additive). Mobile codegen will need to refresh on next mobile build. No mobile UI work is required by this plan.
- **Admin**: same — additive only. No admin UI work required.
- **Sidebar query load**: one extra cache-and-network query per page load. Index makes it cheap; payload is small (≤20 items). Acceptable.
- **Plan reviewers**: this is a polish PR cluster, not architectural. Standard squash-merge-when-green flow applies.

---

## Risks & Mitigations

- **Risk:** Migration not applied to dev before deploy → next deploy fails the `db:migrate-manual` gate.
  - **Mitigation:** Apply to dev with `psql -f` immediately after merging U3.
- **Risk:** Cascade-delete on threads with many artifacts is slow.
  - **Mitigation:** `Promise.allSettled` so partial failure doesn't block the thread delete. Cap practical attached-artifact counts (already small in practice). If users complain, batch into a single backend mutation later.
- **Risk:** Stripping the focus-ring on `ComputerComposer` makes the input look unfocused in dev, hurting accessibility.
  - **Mitigation:** Keep the textarea's caret + cursor focus indicators (the textarea ring is at the textarea level, not the wrapper). Verify with keyboard-only navigation.
- **Risk:** Codegen drift across the four apps after the GraphQL change — easy to forget one.
  - **Mitigation:** Pre-commit hooks run `typecheck` repo-wide; mismatched generated types will surface there. Run `pnpm -r --if-present codegen` (or the equivalent filter loop) before pushing.

---

## Dependencies / Sequencing

```
U1 ──┐
U2 ──┤ (independent — can ship in parallel PRs or one)
U4 ──┤
U3 ──┴──> U5 ──┐
         U6 ──┤
         U7 ──┘ (U7 depends on U3 + U5)
```

- U1, U2, U4 are independent and small; could be one PR or three. Recommended: one PR per item to keep diffs reviewable.
- U3 must merge and the migration must be applied before U5 and U7 typecheck cleanly.
- U6 is independent of U3 (uses existing thread + artifact mutations) but shares the dropdown + AlertDialog pattern with U5 — order doesn't matter.
- U7 must come after U5 (otherwise there's no UI to favorite anything, and the section will be empty in dev).

---

## Success Criteria

- All six numbered requests render and behave as specified.
- No regressions in: empty-thread composer submit, thread list, artifact list, sidebar nav, page header layout.
- `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, and `pnpm format:check` green.
- Migration applied to dev and reported as present by `db:migrate-manual`.
- Manual smoke on dev: favorite an artifact → it appears in the sidebar's collapsed Favorites section → expanding shows it → unfavoriting removes it → section disappears when zero favorites remain.

---

## Verification Strategy

- **Unit (vitest)**: per-unit test scenarios above.
- **Manual**: each unit has a Verification step naming the user-visible outcome.
- **Pre-merge**: `pnpm install && pnpm -r --if-present build && pnpm -r --if-present typecheck && pnpm -r --if-present test && pnpm format:check`.
- **Post-merge**: deploy to dev, apply migration, click through the smoke checklist above.
