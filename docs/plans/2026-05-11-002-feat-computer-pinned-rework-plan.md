---
title: "feat: Rework Computer sidebar Favorites as Pinned + inline pin affordance"
created: 2026-05-11
status: completed
type: feat
depth: lightweight
---

# Rework Computer sidebar Favorites as Pinned + inline pin affordance

## Summary

Rework the existing Favorites section in the Computer app sidebar:

1. Rename "Favorites" → "Pinned" (UI label only — keep the underlying `favoritedAt` column and `FavoriteArtifactsQuery` to minimize blast radius).
2. Move the Pinned section so it renders **below** the main nav menu items (Threads / Artifacts / Automations / Memory / Customize), not above them.
3. Show a filled pin icon on each row in the Pinned list; clicking it unpins the artifact (without navigating away).
4. Add a pin/unpin icon to the right of the artifact title in the artifact detail page header — a direct, single-click affordance instead of going through the `MoreHorizontal` dropdown.

## Problem Frame

The current "Favorites" section is functional but:
- It sits at the top of the sidebar, ahead of primary navigation — pinning is a secondary affordance, not a destination, so it should follow the nav menu.
- The label "Favorites" is colloquially weaker than "Pinned" for the action this represents (Pinned items are the user's working set).
- There is no inline unpin affordance — users have to navigate to the artifact and use the `MoreHorizontal` dropdown to unpin.
- Pinning an artifact while viewing it requires opening a dropdown menu. The action deserves a direct, visible toggle.

## Scope

### In scope

- UI relabel in the sidebar and any user-visible string.
- Sidebar layout reorder (Pinned moves below nav menu).
- New inline unpin button on each Pinned sidebar row.
- New inline pin/unpin button on the artifact detail page header.
- Removing the now-redundant "Add to favorites / Remove from favorites" item from the `MoreHorizontal` dropdown (the inline button supersedes it; the dropdown will continue to host Delete).
- A new `titleTrailing` slot on the page-header context so the inline pin button can render adjacent to the title.

### Out of scope

- Renaming the GraphQL operation `FavoriteArtifactsQuery`, the `favoritedAt` column, the mutation field, or any backend identifier. These keep their existing names; only user-visible strings change.
- Reordering or restyling any other sidebar group.
- Drag-to-reorder Pinned items, multi-select unpin, or pin from a list view — not requested.
- Changing what counts as "pinnable" — still artifacts only.

### Deferred to Follow-Up Work

- Renaming the underlying data model (`favoritedAt`, `FavoriteArtifactsQuery`, etc.) to use "pinned" terminology. Would require coordinated schema migration, codegen refresh in every consumer, and resolver updates — out of proportion for a UI relabel.

---

## Key Technical Decisions

### D1. UI-only relabel; keep `favoritedAt` and `FavoriteArtifactsQuery` as-is

The user's instruction ("Rename to Pinned") clearly targets the UI surface, not the data model. Renaming `favoritedAt` would cascade into the Drizzle schema, GraphQL types, every consumer's codegen, and the `setArtifactFavorite`-shaped mutation surface. That work is disproportionate for a UX rename and adds migration risk. We change strings + icons; the wire stays `favoritedAt`.

### D2. New `titleTrailing` slot on `PageHeaderActions`

The existing `action` prop renders on the **far right** of the top bar (where the dropdown sits today). The user explicitly asked for the pin icon "to the right of the artifact header title" — adjacent to the title, not next to the dropdown. The cleanest seam is a new `titleTrailing?: ReactNode` field on `PageHeaderActions` rendered right after the `<h1>` in `AppTopBar`. The existing `action` slot is untouched.

### D3. Remove pin/unpin from the dropdown (no duplicate affordance)

Once the inline pin button is on the artifact header, the dropdown's "Add to favorites / Remove from favorites" item is a duplicate path. Keeping both creates an "A-capable, B-default" tension. The inline button is more discoverable and the dropdown becomes a Delete-only menu — which is appropriate, since Delete is the only remaining destructive action.

### D4. Extract a reusable `<PinToggleButton />`

Both the sidebar row and the page header need the same toggle: filled icon when pinned, click → run `UpdateArtifactMutation` with `favoritedAt: nextValue`, toast on success/error. Extract once in `apps/computer/src/components/artifacts/PinToggleButton.tsx` and consume in both places. The sidebar row variant needs to stop click propagation so the row's `<Link>` doesn't fire on unpin.

### D5. Sidebar row unpin without navigation

Sidebar rows are `<SidebarMenuButton asChild><Link>...</Link></SidebarMenuButton>`. To attach an inline button inside the row without breaking nav, render the `<PinToggleButton />` as a sibling of (not nested in) the `<Link>` content. Use the `SidebarMenuAction` slot from `@thinkwork/ui` (the `Sidebar` primitives already expose this — verify in U2). Fall back to absolutely-positioning a button against the `<SidebarMenuItem>` if `SidebarMenuAction` is unavailable, with `stopPropagation` on the click handler.

---

## Implementation Units

### U1. Rename Favorites → Pinned and reorder below nav menu

**Goal:** Relabel the section, swap the icon, and move it below the primary nav group in `ComputerSidebar`.

**Dependencies:** none.

**Files:**
- `apps/computer/src/components/sidebar/FavoritesSection.tsx`
- `apps/computer/src/components/ComputerSidebar.tsx`
- `apps/computer/src/components/sidebar/FavoritesSection.test.tsx`

**Approach:**
- In `FavoritesSection.tsx`: swap `Star` import for `Pin` from `lucide-react`. Replace the visible "Favorites" label with "Pinned". Update `aria-label="Toggle Favorites"` → `"Toggle Pinned"`. Update the `defaultOpen` from `false` to `true` if discovery suggests Pinned should default open after moving below nav (defer this micro-decision to the implementer based on what feels right in the live app — current behavior of collapsed-by-default is acceptable).
- Update component-internal `data-testid` values from `sidebar-favorites-group` / `-trigger` / `-list` → `sidebar-pinned-group` / `-trigger` / `-list` so test selectors track UI intent. The exported component name (`FavoritesSection`) and file path can stay — they reference the underlying data column, not the label, so renaming the file would be a tangential cleanup. (File rename routed to Deferred to Follow-Up Work if desired later.)
- In `ComputerSidebar.tsx`: move `<FavoritesSection />` from line 131 (currently before the nav `SidebarGroup`) to **after** the nav `SidebarGroup` (after the `navItems.map` block closes inside `SidebarContent`).
- Update `FavoritesSection.test.tsx`: rename the test-id assertions and the aria-label expectation.

**Patterns to follow:**
- Lucide icon import + rendering — see existing `Brain`, `Repeat`, etc. usage in `ComputerSidebar.tsx`.
- `data-testid` naming convention — already uses kebab-cased `sidebar-<area>-<element>` form.

**Test scenarios:**
- Renders nothing when there are zero pinned artifacts (existing test; just verify still passes with new test-ids).
- Renders the section with the label "Pinned" and aria-label "Toggle Pinned" when there are items.
- Clicking the trigger expands the list and shows the artifact titles.
- Each item links to `/artifacts/<id>`.
- Visual placement is verified manually in the dev server: the Pinned section appears **below** the main nav items, not above them. No unit test needed for ordering — DOM order is asserted indirectly by the structure of `ComputerSidebar.tsx`.

**Verification:**
- `pnpm --filter @thinkwork/computer test` passes the `FavoritesSection` suite.
- `pnpm --filter @thinkwork/computer dev` (on a registered Cognito port — :5174 or :5175) shows the renamed section below the nav menu.

---

### U2. Extract `<PinToggleButton />` and add inline unpin to each Pinned row

**Goal:** Build a reusable pin/unpin button and wire it onto each row in the Pinned sidebar list so a user can unpin without navigating.

**Dependencies:** U1 (the sidebar label change should land first to avoid two simultaneous edits to the same file).

**Files:**
- `apps/computer/src/components/artifacts/PinToggleButton.tsx` (new)
- `apps/computer/src/components/artifacts/PinToggleButton.test.tsx` (new)
- `apps/computer/src/components/sidebar/FavoritesSection.tsx`
- `apps/computer/src/components/sidebar/FavoritesSection.test.tsx`

**Approach:**
- Build `PinToggleButton`:
  - Props: `artifactId: string`, `favoritedAt: string | null`, `variant?: "default" | "sidebar"` (controls size/spacing).
  - Uses `useMutation(UpdateArtifactMutation)` exactly like `ArtifactDetailActions.tsx:58–87` (lift the existing handler shape; do not change the mutation contract).
  - Renders `Pin` (filled) when `favoritedAt !== null`, `Pin` (outline) when null. Use Lucide's `Pin` / `PinOff` pair, or one icon with conditional `fill` styling — pick whichever reads cleaner in U3's visual test.
  - On click: `stopPropagation()` + run the mutation with `favoritedAt: isPinned ? null : new Date().toISOString()`. Toast on success ("Pinned." / "Unpinned.") and on error.
  - `aria-label` of the button: "Pin artifact" / "Unpin artifact" based on state.
  - `data-testid`: `pin-toggle-<artifactId>` (caller-supplied id is fine to keep tests scoped).
- In `FavoritesSection.tsx`:
  - Inside each `<SidebarMenuItem key={favorite.id}>`, render `<PinToggleButton artifactId={favorite.id} favoritedAt={favorite.favoritedAt ?? null} variant="sidebar" />` as a sibling of the `<SidebarMenuButton>`. Prefer the `SidebarMenuAction` slot from `@thinkwork/ui` if it exists; otherwise position the button absolutely inside the item with appropriate spacing so it doesn't overlap the title truncation. Discover the available primitives by reading the `@thinkwork/ui` `Sidebar` exports.
  - Verify the `<Link>` still navigates when the user clicks the row outside the pin button (the button's `stopPropagation` is what isolates the click).
- Update `FavoritesSection.test.tsx`:
  - Add a test that clicking the inline pin button fires the mutation (mock `useMutation` from urql to capture variables).
  - Verify the row's `<Link>` is NOT followed when the pin button is clicked.

**Patterns to follow:**
- `ArtifactDetailActions.tsx:53–87` — exact pattern for `useMutation`, toast on success/error, `working` state guard.
- Existing urql mutation mocks in `apps/computer/src/components/artifacts/ArtifactDetailActions.test.tsx` for how to assert mutation variables.

**Test scenarios:**
- `PinToggleButton`:
  - Renders filled-pin icon and aria-label "Unpin artifact" when `favoritedAt` is a string.
  - Renders empty-pin icon and aria-label "Pin artifact" when `favoritedAt` is null.
  - Clicking when pinned fires `UpdateArtifactMutation` with `{ id, input: { favoritedAt: null } }`.
  - Clicking when unpinned fires `UpdateArtifactMutation` with `{ id, input: { favoritedAt: <some ISO string> } }`.
  - On mutation error result, calls `toast.error` and does not throw.
  - Clicking dispatches `stopPropagation` so parent click handlers don't fire (asserted by attaching a parent click spy in a wrapper).
- `FavoritesSection` (new tests):
  - Each pinned row renders a `<PinToggleButton />` with the row's artifact id.
  - Clicking the inline pin button on a row fires the mutation with that row's `id` and `favoritedAt: null`.
  - Clicking elsewhere on the row navigates (existing link test still passes).

**Verification:**
- `pnpm --filter @thinkwork/computer test` passes new + updated suites.
- In dev: expanding the Pinned section, clicking the pin icon on a row removes the row (live query refetches after the mutation; no manual refresh needed). Clicking the row title still navigates to the artifact.

---

### U3. Inline pin button on the artifact detail page header

**Goal:** Render `<PinToggleButton />` to the right of the artifact title in the page header. Remove the now-redundant pin/unpin menu item from the artifact actions dropdown so the affordance is non-duplicated.

**Dependencies:** U2 (consumes `PinToggleButton`).

**Files:**
- `apps/computer/src/context/PageHeaderContext.tsx`
- `apps/computer/src/components/AppTopBar.tsx`
- `apps/computer/src/routes/_authed/_shell/artifacts.$id.tsx`
- `apps/computer/src/components/artifacts/ArtifactDetailActions.tsx`
- `apps/computer/src/components/artifacts/ArtifactDetailActions.test.tsx`

**Approach:**
- Add `titleTrailing?: ReactNode` to the `PageHeaderActions` interface in `PageHeaderContext.tsx`. Include it in the `key` string used by `usePageHeaderActions` so changes propagate when the trailing slot's identity-shape changes (key it on `actionKey` continuing to capture state, plus a new boolean `titleTrailing ? "1" : "0"` segment).
- In `AppTopBar.tsx`: after the `<h1 className="truncate text-sm font-medium">{actions.title}</h1>` element (currently line 65), conditionally render `{actions.titleTrailing}`. Keep the existing subtitle rendering after that. The block sits inside the `flex min-w-0 items-center gap-2` container so spacing is consistent with the title/subtitle treatment.
- In `artifacts.$id.tsx`:
  - Import `PinToggleButton`.
  - When `artifactId` is known, pass `titleTrailing={<PinToggleButton artifactId={artifactId} favoritedAt={favoritedAt} />}` into the `usePageHeaderActions` call.
  - Extend the existing `actionKey` to include the favorited state, OR — since the existing `actionKey` already encodes `favoritedAt` — leave it untouched and rely on `titleTrailing` ReactNode identity changing each render (the existing key already changes on `favoritedAt`, so the header refreshes).
- In `ArtifactDetailActions.tsx`:
  - Remove the `DropdownMenuItem` block at lines 103–120 (the favorite/unfavorite item) **and** the separator at line 121.
  - Remove the now-unused `Star`, `StarOff` imports.
  - Keep the `favoritedAt` prop on the component for now (callers still pass it); annotate that it is unused after this change. Alternatively, drop the prop entirely and update callers — implementer's choice based on what minimizes the diff churn. Prefer dropping the prop since `artifacts.$id.tsx` still has the value handy for the inline button.
  - The dropdown now contains only the Delete item — the surrounding `<DropdownMenu>` chrome may be kept for future actions, or simplified to a direct Delete button. Implementer's call; keeping the dropdown is the safer minimal change.
- Update `ArtifactDetailActions.test.tsx`:
  - Remove tests asserting the "Add to favorites" / "Remove from favorites" menu items (they no longer exist there).
  - Keep the Delete-related tests intact.

**Patterns to follow:**
- `PageHeaderActions` extension pattern — `subtitle` and `tabs` are the precedent for optional header-content props.
- `AppTopBar.tsx` already conditionally renders subtitle next to title; the trailing slot mirrors that pattern.

**Test scenarios:**
- `artifacts.$id.tsx` (manual + visual verification):
  - On a non-pinned artifact: header shows the pin (outline) icon next to the title; clicking pins the artifact (toast + row appears in sidebar Pinned section after refetch).
  - On a pinned artifact: header shows the pin (filled) icon; clicking unpins (toast + row disappears from Pinned).
- `ArtifactDetailActions.test.tsx`:
  - Dropdown still opens and shows the Delete item.
  - Dropdown no longer renders any "favorite" / "pin" menu item (assert by `queryByTestId("artifact-actions-favorite")` returning null).
  - Delete flow still works end-to-end (existing tests carry forward).
- `PageHeaderContext` / `AppTopBar`: no dedicated unit test — the slot is plumbing verified by the artifact-detail visual checks. If it feels worth a guard, add a small `AppTopBar.test.tsx` rendering an actions object with `titleTrailing` set and asserting it appears in the document.

**Verification:**
- `pnpm --filter @thinkwork/computer test` passes the updated `ArtifactDetailActions` suite.
- `pnpm --filter @thinkwork/computer typecheck` succeeds (the `PageHeaderActions` extension is type-checked at every call site).
- In dev: open an artifact, click the inline pin icon → toast + sidebar updates. Click again → unpins. Open the dropdown — no pin/unpin entry, only Delete.

---

## System-Wide Impact

- **Sidebar layout shift.** The Pinned section moves below the primary nav. Users who currently rely on the section being at the top will see it lower. This is intentional; pinning is a secondary affordance.
- **Dropdown surface narrows.** The artifact actions dropdown loses its pin/unpin item. Users who learned that path will need to find the inline button. The inline button is on the same page and more visible, so the learning cost is small.
- **No backend / GraphQL / migration impact.** `favoritedAt` and `FavoriteArtifactsQuery` are untouched.
- **No mobile impact.** This is `apps/computer` only; mobile (`apps/mobile`) and admin (`apps/admin`) are not affected.

---

## Risks

- **`SidebarMenuAction` may not exist as expected.** If `@thinkwork/ui`'s `Sidebar` primitives don't expose a clean per-row action slot, U2 falls back to absolute positioning. Either path works; this is an implementation detail, not a blocker.
- **Optimistic vs cache-only refetch.** The mutation already updates the artifact row; whether the Pinned sidebar list refetches automatically depends on urql's `cache-and-network` policy on `FavoriteArtifactsQuery`. If the row doesn't disappear after unpin in dev, the implementer should add a manual `reexecuteQuery` on the favorites query after the mutation resolves (or invalidate via urql exchanges already configured in `main.tsx`). Verify in dev before declaring U2 done.
- **Truncation behavior.** Adding a pin button to each sidebar row reduces space for the title. Verify with long titles ("Pipeline risk dashboard with quarterly comparison overlay") that the title still truncates cleanly and the pin button stays visible.

---

## Deferred Implementation-Time Questions

- The exact icon choice (`Pin` vs `Pin` + `PinOff` vs `Pin` with `fill` styling) — decide visually in U2 once the button is rendered against real data.
- Whether `FavoritesSection.tsx` should be renamed to `PinnedSection.tsx`. Defer; the file path is internal and the rename is mechanical, but each rename means coordinating with imports. Skip unless it gets in the way.
- Whether to default `Collapsible defaultOpen` to `true` once the section moves below the nav (since it's now lower in the visual hierarchy). Implementer's call after seeing the result.
