---
title: "fix: Computer memory page header layout"
type: fix
status: active
created: 2026-05-09
target_repo: thinkwork
---

## Summary

Move the Brain/Pages/KBs strip out of the global `AppTopBar` into each Memory sub-route's own toolbar (centered between the search input and the right-side controls), swap that strip from `ToggleGroup` to the Radix `Tabs` primitive already exported by `@thinkwork/ui`, shrink the search input from `w-80` to a placeholder-fitted width across all three sub-routes, and rename the "Brain" trigger label to "Memories" without changing the route path.

## Problem Frame

The Memory page in `apps/computer` (introduced on `main` at commit 50ed1a15) currently:

1. Reserves an oversized `w-80` (320 px) search input on each sub-route, even when the longest placeholder ("Search knowledge bases…") fits in roughly 240 px.
2. Pushes the `Brain | Pages | KBs` switcher up into the global `AppTopBar` via `usePageHeaderActions({ tabs })`, which forces the user's eye to jump out of the page chrome to switch sub-views.
3. Renders that switcher as a `ToggleGroup`, which is semantically wrong — these are navigation tabs (each links to a route), not a single-select toggle.
4. Labels the first tab "Brain", which is internal-mental-model jargon rather than user-facing language.

The target shape: a single-row in-page toolbar per sub-route with `[Search] … [Tabs centered] … [right-side controls]`, using the Radix `Tabs` primitive, with the first tab labelled "Memories".

## Requirements

- **R1**: Search input on `memory.brain.tsx`, `memory.pages.tsx`, `memory.kbs.tsx` is sized to fit its placeholder (no fixed `w-80`); icon padding (`pl-9`) and clear-button buffer (`pr-8` when active) preserved.
- **R2**: The Brain/Pages/KBs strip is rendered inside each sub-route's toolbar, horizontally centered between left (search) and right (page-specific controls) slots.
- **R3**: That strip is a Radix `Tabs` (from `@thinkwork/ui`), not a `ToggleGroup`.
- **R4**: The first tab is labelled **Memories**. The route path stays `/memory/brain`, the file name stays `memory.brain.tsx`, the search-param key stays `view`.
- **R5**: The parent `memory.tsx` layout no longer pushes `tabs` to `AppTopBar` — only `title: "Memory"`. `AppTopBar`'s tab-rendering branch is left intact for any future caller.
- **R6**: `/memory/kbs/$kbId` continues to highlight the **KBs** tab as active (prefix match, mirroring the existing `AppTopBar` behavior).

## Key Technical Decisions

- **Each child renders its own `<Tabs>` Root** (instead of the parent owning a Root that portals `TabsList` into children). Rationale: routing already coordinates which child mounts; per-child Roots are self-contained, avoid an extra context, and mirror the existing `AppTopBar` shape (which similarly recomputes the active value from pathname). The 3-line trigger array cost of duplication is lower than the cost of a portal+context plumbing layer for a tiny layout.
- **Shared `MEMORY_TABS` data constant** lives in `apps/computer/src/routes/_authed/_shell/memory.tsx` and is exported. Each child imports it. This is data, not a component, so it does not violate the out-of-scope "no shared `<MemoryToolbar>`" rule — it just keeps the three triggers in sync. (Parent already declares `TABS` for the now-removed `usePageHeaderActions({ tabs })` call; the rename + export is a 2-line change.)
- **Active-tab detection** uses `useRouterState({ select: s => s.location.pathname })` and the same prefix-match pattern as `AppTopBar.tsx` lines 24–28: the deepest tab whose `to` is a prefix of pathname wins, so `/memory/kbs/$kbId` still highlights KBs.
- **Search width**: drop `w-80`, use `w-fit` with `min-w-56` floor (224 px). `w-fit` lets the input's natural width adjust to the placeholder (or current value); the floor keeps the clear button visible on the shortest placeholder ("Search pages…"). Implementer may tune the floor up to `min-w-60` if "Search knowledge bases…" looks cramped on KBs at default font scale.
- **Toolbar layout shape**: replace each child's current `flex items-center justify-between gap-3` two-slot row with a three-slot row: `flex items-center gap-3` on the outer container; left slot is the search wrapper at intrinsic width; middle slot is `flex-1 flex justify-center` containing the Tabs; right slot is the page-specific control at intrinsic width. Mirrors `AppTopBar.tsx` line 51's `flex flex-1 justify-center` centering pattern.
- **No `TabsContent`**: the Tabs primitive is used only for the navigation header. Route content is rendered by TanStack Router's `<Outlet>` from the parent `memory.tsx`. Each `TabsTrigger` uses the `asChild` prop wrapping a `<Link>`, mirroring the existing `ToggleGroupItem asChild` pattern in `AppTopBar.tsx`.
- **Commit prefix**: `fix(computer):` — these are user-visible header layout corrections, not behavior change or pure refactor.

## Implementation Units

### U1. Render in-page Memory tabs across all three sub-routes

**Goal**: Replace each Memory sub-route's existing `[Search] [Toggle]` two-slot toolbar with a three-slot `[Search] [Tabs centered] [right control]` toolbar, shrink the search input to fit placeholder width, and stop pushing tabs to the global `AppTopBar`. The "Brain" tab label becomes "Memories".

**Requirements**: R1, R2, R3, R4, R5, R6.

**Dependencies**: none.

**Files**:
- `apps/computer/src/routes/_authed/_shell/memory.tsx` — drop `tabs` from `usePageHeaderActions`; rename the local `TABS` constant to `MEMORY_TABS` and export it; relabel the first entry from `Brain` → `Memories` (`{ to: "/memory/brain", label: "Memories" }`); leave route path/component wiring unchanged.
- `apps/computer/src/routes/_authed/_shell/memory.brain.tsx` — restructure the toolbar `<div>` from two-slot to three-slot; left slot = existing search input wrapper but with `w-fit min-w-56 max-w-full` instead of `w-80 max-w-full`; middle slot = `<Tabs value={activePath}><TabsList>` of three `TabsTrigger asChild` wrapping `<Link>` entries from `MEMORY_TABS`; right slot = the existing Table/Graph `ToggleGroup` (unchanged).
- `apps/computer/src/routes/_authed/_shell/memory.pages.tsx` — same toolbar restructure as Brain; right slot = the existing Table/Graph `ToggleGroup` (unchanged).
- `apps/computer/src/routes/_authed/_shell/memory.kbs.tsx` — same toolbar restructure; left slot's `Input` (currently `w-80 max-w-full`) becomes `w-fit min-w-56 max-w-full`; right slot retains the existing `<p className="text-xs text-muted-foreground hidden md:block">Knowledge bases are managed by your operator.</p>`.

**Approach**:
- Compute `activePath` in each child via `useRouterState({ select: s => s.location.pathname })`, then find the deepest entry of `MEMORY_TABS` whose `to` is a prefix of pathname (mirrors `AppTopBar.tsx:24–28`). Pass that value to `<Tabs value={...}>`. Tabs is a controlled component for read-only display; navigation happens via the `<Link>` inside each trigger.
- Each `TabsTrigger` mirrors the existing `ToggleGroupItem` shape in `AppTopBar.tsx` lines 54–63: `asChild` prop, `value={tab.to}`, `className="px-3 text-xs"`, child is `<Link to={tab.to}>{tab.label}</Link>`.
- Do not introduce a `TabsContent` — content for each route is mounted by TanStack Router's `<Outlet>`, not by Radix.
- Keep all other markup in each sub-route untouched — no changes to `MemoryGraph`, `DataTable`, the detail Sheets, or any data-fetching code.
- The parent `memory.tsx` ends at `usePageHeaderActions({ title: "Memory" })` (no `tabs` field). The component body is otherwise unchanged: still renders `<Outlet />`.

**Patterns to follow**:
- `apps/computer/src/components/AppTopBar.tsx` lines 22–66 — the existing prefix-match active-tab logic + `ToggleGroup`/`ToggleGroupItem asChild` shape. The new in-page Tabs is the same idea, swapping `ToggleGroup` → `Tabs` and `ToggleGroupItem` → `TabsTrigger`.
- `apps/computer/src/routes/_authed/_shell/memory.brain.tsx` lines 226–262 — current two-slot toolbar with the `relative w-80 max-w-full` search wrapper and `justify-between gap-3`. The new shape replaces `justify-between` with explicit three-slot composition.

**Test scenarios**: Covered in U2.

**Verification**:
- Visual: on `/memory/brain`, `/memory/pages`, `/memory/kbs`, the toolbar shows search on the left (no longer reserving 320 px), the three-tab strip centered, and the right-side control (Table/Graph toggle on Brain/Pages, helper text on KBs) on the right. The first tab reads "Memories".
- The global `AppTopBar` shows only `Memory` as the title — no centered tab strip pushed up to the header.
- Navigating between the three tabs updates the URL and the active tab indicator. Drilling into `/memory/kbs/<id>` keeps **KBs** highlighted.
- `pnpm --filter @thinkwork/computer typecheck` passes; `pnpm format:check` passes.

### U2. Cover the in-page tab placement with a regression test

**Goal**: Add an RTL test that pins the in-page tab placement so a future refactor cannot accidentally re-push the tab strip into `AppTopBar` or rename "Memories" back to "Brain".

**Requirements**: R4, R5.

**Dependencies**: U1.

**Files**:
- `apps/computer/src/routes/_authed/_shell/memory.test.tsx` — new file. Renders a minimal `MemoryLayout` (parent) + one child route under a TanStack Router test memory history, plus a `PageHeaderProvider`, plus a stub `AppTopBar` consumer that reads the context. Asserts:
  1. The `PageHeaderActions` value supplied by `MemoryLayout` has `title === "Memory"` and `tabs === undefined` (no longer pushed to header).
  2. The rendered child page (e.g., `/memory/brain`) contains a single `Memories` accessible-name node (case-insensitive) inside the in-page toolbar — not in the `AppTopBar` consumer.
  3. The rendered child page does **not** contain a `Brain` text node (the rename is permanent).

**Approach**:
- Use the existing testing-library setup that powers `apps/computer/src/components/memory/MemoryPanel.test.tsx`. Wrap the render in the same urql/router/page-header providers that the existing memory panel test uses (steal the harness; do not invent a new one).
- For assertion 1, render a tiny test consumer that reads `usePageHeader()` and renders the JSON. Assert the consumer's text shape, or use a spy on `setActions`. Implementer's call which mechanism — both produce the same guarantee.
- For assertions 2 and 3, query by accessible role/name on the rendered child route output.
- Mock urql data fetches so `BrainPage` mounts without network. Use a no-op responder; the test only inspects toolbar markup, not data rows.

**Patterns to follow**:
- `apps/computer/src/components/memory/MemoryPanel.test.tsx` — provider stack, urql mocking shape, RTL conventions.
- `apps/computer/src/components/computer/ComputerThreadDetailRoute.test.tsx` — TanStack Router `createMemoryHistory` test pattern (used elsewhere in `apps/computer`).

**Test scenarios**:
- **Happy path**: Mounting `/memory/brain` under the layout pushes `{ title: "Memory" }` (no `tabs` key) to `PageHeaderContext`. The toolbar contains a `Memories` tab trigger. The toolbar does not contain a `Brain` tab trigger.
- **Active-tab edge**: Mounting `/memory/kbs/some-id` highlights the **KBs** tab (regression guard for the prefix-match logic).
- **Negative regression**: A snapshot or text query confirms `Brain` is absent anywhere in the rendered output. (Guards against partial label rename.)

**Verification**:
- `pnpm --filter @thinkwork/computer test apps/computer/src/routes/_authed/_shell/memory.test.tsx` passes.
- The full `pnpm test` run for the workspace stays green.

## Scope Boundaries

### In scope
- Toolbar layout restructuring on `memory.brain.tsx`, `memory.pages.tsx`, `memory.kbs.tsx`, plus the parent `memory.tsx` layout.
- Search input width change on the same three children.
- Tab primitive swap (`ToggleGroup` → `Tabs`) for the Brain/Pages/KBs strip — in-page only.
- Label rename "Brain" → "Memories" (label only).
- One new test file pinning the placement.

### Out of scope (true non-goals)
- Visual redesign beyond these four asks — no spacing, typography, colour, or icon changes elsewhere.
- Routing changes (paths, search-param contracts, validateSearch shapes) on any Memory route.
- Internals of `MemoryGraph`, `DataTable`, `MemoryDetailSheet`, `MemoryGraphNodeSheet`.
- The admin app's equivalent Memory UI (`apps/admin`).
- Other `apps/computer` pages — only the `/memory/*` tree.

### Deferred to Follow-Up Work
- Extracting a shared `<MemoryToolbar>` wrapper component. Three call sites is below the abstraction threshold; revisit if a fourth Memory sub-route is added or if the toolbar grows additional controls.
- Removing the (now-unused) `tabs` field from `PageHeaderActions` in `apps/computer/src/context/PageHeaderContext.tsx`. The `AppTopBar` rendering branch and the type field stay because they are inexpensive and the contract may have other consumers in flight on parallel branches.
- Backporting onto the active `codex/computer-v1-m2-streaming-buffer-ui` branch — this PR branches off `origin/main` and lands independently; rebase coordination handled at merge time.

## Risks

- **Visual regression on narrow viewports**: a centered three-slot toolbar with the search at intrinsic width and the helper text on KBs at intrinsic width could overflow on small widths. Mitigation: keep `flex-wrap` (already on the existing toolbar via `flex-wrap items-center`), and the KBs helper text already has `hidden md:block`; the centered tabs flex slot reflows naturally.
- **Tabs vs ToggleGroup keyboard semantics**: Radix `Tabs` arrow-key behavior differs from `ToggleGroup` (Tabs treats arrows as roving tabindex; ToggleGroup treats Tab as the only focus key). Because each `TabsTrigger` is `asChild` over a `<Link>`, focus and Enter activate the link normally — Radix's roving-tabindex enhancement for arrow keys is a feature gain, not a regression. No mitigation needed; surface in the PR description.
- **`MEMORY_TABS` import cycle**: importing `MEMORY_TABS` from `memory.tsx` into the three children creates a parent-imported-by-children edge. TanStack Router's file-route layer handles this fine (it's just data, no runtime mounting dependency), but verify no Vite HMR warnings in `pnpm dev` after the change.

## Verification Strategy

- `pnpm install` (if needed) → `pnpm --filter @thinkwork/computer typecheck` clean.
- `pnpm --filter @thinkwork/computer lint` clean.
- `pnpm --filter @thinkwork/computer test` includes the new `memory.test.tsx` and stays green.
- `pnpm format:check` clean.
- Manual visual check on `/memory/brain`, `/memory/pages`, `/memory/kbs`, `/memory/kbs/<some-id>` in `pnpm --filter @thinkwork/computer dev`. Confirm the four user-stated behaviors from the synthesis (shorter search, in-page centered tabs, Tab-Group not ToggleGroup, "Memories" label).

## Branch & PR Posture

- Worktree created off `origin/main` under `.claude/worktrees/computer-memory-header-layout/` per the global worktree rule.
- Single PR off the worktree branch, base `main`. Commit messages use `fix(computer):` prefix.
- Pre-commit gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` (project default; do not bypass with `--no-verify`).
- After merge, the worktree and branch are deleted automatically per the global cleanup rule.
