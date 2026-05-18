---
title: "refactor: Computer Detail cleanup + shared Threads table"
type: refactor
status: active
date: 2026-05-13
---

# refactor: Computer Detail cleanup + shared Threads table

## Summary

The Computer Detail page (`apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx`) has accreted four sub-panels that don't earn their pixels in day-to-day operator use, the tab order doesn't match how the page is actually used, the Archive button lives in a destructive-action-in-the-header position the operator wants buried, and there is no view of the threads belonging to a given Computer. This refactor strips the dead panels, re-orders the tabs (Dashboard | Workspace | Terminal | Config), moves Archive into the Config → Computer Status card, and surfaces a paginated Threads table on the Dashboard tab that is **the exact same component** the `/threads` route already renders — refactored into a shared component so the `/threads` page and Computer Dashboard render the same UI from the same code.

The shared Threads table is the only non-mechanical piece of this plan. Everything else is removal, reordering, or moving an existing component to a new slot.

## Problem Frame

User feedback (verbatim from the request, paraphrased for the plan):

- Recent Activity on Dashboard is noise.
- Live Runtime panel on Dashboard is noise.
- Runtime Events on Config is noise.
- Migration Provenance on Config is noise.
- Tab order should be **Dashboard | Workspace | Terminal | Config**.
- Archive should not be in the page header (where it sits next to the title and reads as a top-level destructive action). Move into Config → Computer Status.
- Dashboard needs a Threads table scoped to this Computer.
- That table must be the **same component** the `/threads` page renders today — both pages should converge on one source of truth so future polish lands in both places at once.

The work spans removals (5 components / panel usages), one tab reorder, one component relocation, one shared-component extraction, one GraphQL filter extension, and one Dashboard composition change.

## Requirements

| R-ID | Requirement | Source |
|---|---|---|
| R1 | Recent Activity panel removed from Dashboard tab | User #1 |
| R2 | Live Runtime panel removed from Dashboard tab | User #2 |
| R3 | Runtime Events panel removed from Config tab | User #3 |
| R4 | Migration Provenance panel removed from Config tab | User #4 |
| R5 | Tab order is Dashboard \| Workspace \| Terminal \| Config | User #5 |
| R6 | Archive control lives inside the Config → Computer Status card; the page-header Archive button is removed | User #6 |
| R7 | Dashboard tab renders a paginated Threads table scoped to the current Computer | User #7 |
| R8 | The Threads table component is shared between `/threads` and Computer Detail — same DataTable shape, columns, status indicators, assignee picker, and pagination behavior | User #7 |
| R9 | The shared component preserves the `/threads` page's existing behavior (search, sort, archived toggle, pagination, status updates, assignee changes) without regression | Implicit from R8 |
| R10 | The Computer Threads view honors the same status/archive/sort semantics, plus a fixed `computerId` filter | Implicit from R7 + R8 |
| R11 | Workspace tab does not produce a page-level scrollbar; the editor handles its own overflow with a small bottom gap (~10px) | User 2026-05-13 follow-up |

## Scope Boundaries

### In scope

- Delete the four sub-panel components and their wiring.
- Reorder tabs.
- Move the Archive action into `ComputerStatusPanel`.
- Extract `threadColumns` + table-rendering + handlers into a shared `ThreadsTable` component.
- Extend the `threadsPaged` GraphQL query to accept an optional `computerId` filter (server-side resolver + client query update).
- Render `ThreadsTable` on the Computer Dashboard with `computerId` bound to the current Computer.

### Deferred to Follow-Up Work

- Removing the four sub-component **files** if grep confirms zero non-Computer-Detail usages (the grep already showed they're only referenced by `$computerId.tsx` and the source-grep test — see U2). Deletion is in-scope; this entry is here to note the cleanup will be visible in the diff.
- Polish of the new Dashboard layout — KPI strip placement relative to the Threads table, empty-state messaging when a Computer has zero threads. Plan unit U7 lands a working version; visual polish is its own iteration.
- A "New thread for this Computer" CTA on the Dashboard's Threads table. Defer until the operator workflow asks for it.
- Sortable/filterable controls inside the Computer Dashboard's Threads table beyond what the shared component already provides. Same shape as `/threads` is the explicit ask.

### Out of scope (not this product's identity)

- Changing the thread data model or schema.
- Replacing TanStack Table or the `DataTable` primitive.
- Building a unified "activity feed" for Computers — Recent Activity is being removed, not rebuilt under a different name.

## Key Technical Decisions

### D1. Extract `ThreadsTable` as a presentational component, leave queries in the route

The shared component takes its data via props (`items`, `totalCount`, `pageIndex`, `pageSize`, etc.) and emits handlers (`onPageChange`, `onSortChange`, `onUpdateThread`, etc.). The GraphQL fetch stays in the route — `/threads` uses `ThreadsPagedQuery` with `tenantId` only; Computer Dashboard uses the same query with `tenantId + computerId`. This keeps the abstraction line at the rendering boundary, not the data boundary, which matches how the existing route already separates `useQuery` (data) from `<DataTable />` (rendering). It also avoids the trap of an over-abstracted hook that hides whether the consumer should call into the cache, paginate locally, or refetch on a filter change.

### D2. Extend `threadsPaged` with an optional `computerId` filter rather than using the older `threads(...)` query

`threadsPaged` already supports the full feature set the Computer Dashboard wants (search, sort, archive toggle, pagination, total count). The older `threads(...)` query — currently used by the unrelated `ComputerThreadsQuery` — does NOT support pagination or `totalCount`. Adding `computerId` as an optional argument to `threadsPaged` keeps one paginated query path for both consumers and avoids forking the Dashboard onto an inferior query. The existing `ComputerThreadsQuery` consumer (`ComputerLiveTasksPanel.tsx`) is being deleted in U2, so retiring `threads(computerId: ...)` from production usage is a side effect, not a separate task — the resolver stays, but no admin code references it post-cleanup.

### D3. Archive replaces the run/stop toggle's `CardAction` slot in `ComputerStatusPanel`

The run/stop toggle moves into the panel body as an inline secondary control. Archive is the more important destructive action — when an operator opens the Status panel, Archive is what they want to find. The run/stop toggle continues to exist (operators do occasionally need to stop a Computer) but as a less prominent affordance. This matches the user's wording ("probably replace the inactive Stopped button") with a concrete UX choice: the `CardAction` is high-contrast destructive (Archive); the run/stop pair is informational/inline (alongside the Desired/Observed badges).

### D4. Page-header Archive disappears entirely, no fallback CTA in the header row

The user's intent is "Archive should not be top-of-page." A header-level shortcut to Archive would defeat the move. The header keeps title + tabs + status badges; Archive lives only in Config → Computer Status.

### D5. Source-grep test in `-computers-route.test.ts` updates rather than splits

The existing test references the four panels being removed and the current tab order. It gets updated in-place (not split into a new test file). Source-grep tests are inexpensive to evolve and the cohesion is worth preserving.

## High-Level Technical Design

The current `$computerId.tsx` layout:

```
PageLayout
  header
    title row: [Marco]              [Dashboard|Workspace|Config|Terminal]   [slug]
    status row: [owner][template][runtime][cost]  [ArchiveAction]
  body
    tab === "dashboard" → ComputerDashboardMetrics + ComputerDashboardActivity + ComputerLiveTasksPanel
    tab === "workspace" → ComputerWorkspaceTab (unchanged)
    tab === "config"    → ComputerStatusPanel + ComputerIdentityEditPanel + ComputerRuntimePanel + ComputerEventsPanel + ComputerMigrationPanel
    tab === "terminal"  → ComputerTerminalTab (unchanged)
```

Post-refactor layout:

```
PageLayout
  header
    title row: [Marco]              [Dashboard|Workspace|Terminal|Config]   [slug]
    status row: [owner][template][runtime][cost]    (Archive removed here)
  body
    tab === "dashboard" → ComputerDashboardMetrics + ThreadsTable(computerId)
    tab === "workspace" → ComputerWorkspaceTab (unchanged)
    tab === "terminal"  → ComputerTerminalTab (unchanged)
    tab === "config"    → ComputerStatusPanel (now with Archive in CardAction)
                          + ComputerIdentityEditPanel + ComputerRuntimePanel
```

Shared `ThreadsTable` shape (directional pseudo-prop sketch — not implementation specification):

```ts
interface ThreadsTableProps {
  items: ThreadItem[];
  totalCount: number;
  loading: boolean;
  pageIndex: number;
  pageSize: number;
  search: string;
  showArchived: boolean;
  sortField: string;
  sortDir: "asc" | "desc";
  onPageChange(pageIndex: number): void;
  onSearchChange(value: string): void;
  onShowArchivedChange(value: boolean): void;
  onSortChange(field: string, dir: "asc" | "desc"): void;
  onUpdateThread(threadId: string, patch: UpdateThreadPatch): void;
  onRowClick(threadId: string): void;
  /** Hide UI affordances that don't apply when scoped to a single Computer. */
  scope?: "tenant" | "computer";
}
```

The `/threads` route renders it with `scope="tenant"` (default) and passes its own state + handlers. The Computer Dashboard renders it with `scope="computer"`, omitting controls that don't make sense (e.g., per-row Computer link if every row belongs to the current Computer). The `scope` prop is a single explicit toggle — it does not branch into separate components.

This is directional guidance for review, not implementation specification. The implementer should treat it as context, not code to reproduce.

---

## Implementation Units

### U1. Extend `threadsPaged` GraphQL with optional `computerId` filter

**Goal:** Add `computerId: ID` argument to `threadsPaged` so a single paginated query path serves both `/threads` and Computer Dashboard.

**Requirements:** R8, R10.

**Dependencies:** none.

**Files:**
- `packages/database-pg/graphql/types/threads.graphql` (extend `threadsPaged(...)` signature)
- `packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts` (or wherever the resolver lives — locate via grep for `threadsPaged` in `packages/api/src/graphql/resolvers/`)
- `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts` (or equivalent — add or extend the test for the new filter)
- `apps/admin/src/lib/graphql-queries.ts` (`ThreadsPagedQuery` — add `$computerId: ID` variable and pass it through to the field)
- `terraform/schema.graphql` (regenerated via `pnpm schema:build`)
- `apps/admin/src/gql/graphql.ts` (regenerated via `pnpm --filter @thinkwork/admin codegen`)
- `packages/api/src/gql/` (regenerated via `pnpm --filter @thinkwork/api codegen` if applicable)

**Approach:**
- GraphQL field: `threadsPaged(tenantId: ID!, computerId: ID, ...)`. When `computerId` is null/undefined, behavior is unchanged from today. When set, the resolver adds `eq(threads.computer_id, $computerId)` to the WHERE clause.
- Update the client query in `graphql-queries.ts` to accept `$computerId: ID` and pass it to the field. Both consumers can use the same exported query constant; `/threads` simply doesn't supply the variable.
- Regenerate codegen for all consumers that have a `codegen` script (per CLAUDE.md): `apps/admin`, `apps/mobile` (only if it imports `ThreadsPagedQuery` — verify with grep), `packages/api`.

**Patterns to follow:**
- Existing optional filters on the older `threads(...)` query in the same `threads.graphql` (line ~177) — `computerId: ID`, `agentId: ID`, `assigneeId: ID` are already wired there. Mirror that pattern.
- Existing resolver structure under `packages/api/src/graphql/resolvers/threads/` — match the same file naming and test style.

**Test scenarios:**
- Resolver test: `threadsPaged` without `computerId` returns all tenant threads (no regression).
- Resolver test: `threadsPaged` with `computerId` returns only threads whose `computer_id` matches; totalCount reflects the filtered set.
- Resolver test: `threadsPaged` with a `computerId` that belongs to a different tenant returns empty (tenant scoping not bypassed by the new filter).
- Resolver test: combination filter (`computerId` + `search` + `showArchived: false`) — all three predicates apply.

**Verification:** Codegen regenerates cleanly; `pnpm --filter @thinkwork/api test` passes the new resolver coverage; admin still typechecks against the new query shape.

---

### U2. Delete dead Dashboard/Config sub-panel components

**Goal:** Remove the four sub-panels the user flagged as noise, and clean up their imports + usages.

**Requirements:** R1, R2, R3, R4.

**Dependencies:** none. (Independent of U1 — these deletions and the GraphQL extension don't touch the same files.)

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerDashboardActivity.tsx` — DELETE
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerLiveTasksPanel.tsx` — DELETE
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerEventsPanel.tsx` — DELETE
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerMigrationPanel.tsx` — DELETE
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` — drop imports + JSX usages
- `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts` — drop source-grep assertions that reference any of the four

**Approach:**
- Confirm no non-Computer-Detail usages before deleting. The pre-flight grep (`grep -rln <ComponentName>` across `apps/admin/src`) showed all four are only referenced by `$computerId.tsx` and the source-grep test. If a follow-on grep at implementation time surfaces a hit elsewhere (e.g., a route file added since planning), stop and decide whether that consumer should also be cleaned up — don't silently leave a dead import.
- Delete the four files outright. Don't leave them as "deprecated but kept" — the user's word was "stupid"; nothing here is salvageable.
- Drop the corresponding GraphQL queries that ONLY these components consumed (e.g., `ComputerThreadsQuery`, `ComputerEventsQuery`) IF no other consumer remains. Verify with grep. Leave the queries' schema definitions alone — only remove the client-side query constants in `graphql-queries.ts`.
- Update the source-grep test (`-computers-route.test.ts`) to drop assertions for the deleted components and tab content.

**Patterns to follow:**
- File deletions in `git rm` style; don't replace with empty stubs.
- The existing `-computers-route.test.ts` already has the assertions to remove — keep the test cohesive; don't fragment.

**Test scenarios:**
- `pnpm exec vitest run apps/admin/src/routes/_authed/_tenant/computers/` passes after removing the relevant assertions.
- `pnpm exec tsc --noEmit -p apps/admin/tsconfig.json` is clean (no dangling imports).
- Manual check: a Computer's Dashboard tab renders only the KPI strip (and, after U7, the Threads table); Config tab renders only Status + Identity + Runtime.

**Verification:** Files removed via git; admin builds; tests pass; manual smoke on a Computer's Dashboard and Config shows the intended trimmed layout.

---

### U3. Reorder tabs to Dashboard | Workspace | Terminal | Config

**Goal:** Move Terminal between Workspace and Config in the tab list and the type/parser.

**Requirements:** R5.

**Dependencies:** none.

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` — `ComputerDetailTab` type ordering, `parseComputerTab` function, the `<TabsList>` JSX ordering
- `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts` — update the assertion that pins the `ComputerDetailTab` type string

**Approach:**
- Change the type from `"dashboard" | "workspace" | "config" | "terminal"` to `"dashboard" | "workspace" | "terminal" | "config"`.
- Reorder the three `<TabsTrigger>` blocks in the JSX to match.
- Update the source-grep test's expected type string to the new order.

**Patterns to follow:** The existing tab JSX in `$computerId.tsx` — no new patterns introduced.

**Test scenarios:**
- Source-grep test asserts the new type ordering.
- Manual check: tab strip reads Dashboard, Workspace, Terminal, Config left-to-right.
- Manual check: clicking each tab routes correctly (existing TanStack search-param logic already handles each value; ordering doesn't affect routing).

**Verification:** `vitest run` for the source-grep test passes; manual click-through.

---

### U4. Move Archive into Config → Computer Status

**Goal:** Delete the page-header `ArchiveAction` block and add an Archive control inside `ComputerStatusPanel`'s `CardAction` slot. Move the existing run/stop toggle into the panel body as a secondary inline control.

**Requirements:** R6.

**Dependencies:** none. (Independent of U2/U3 in source-file terms — `$computerId.tsx` is touched by all three units but in non-overlapping regions.)

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` — remove the `<ArchiveAction>` JSX from the header's status row; remove the inline `function ArchiveAction(...)` definition; the function itself moves with U4 (see below)
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerStatusPanel.tsx` — host the Archive action in the `CardAction` slot; relocate the run/stop toggle into the panel body
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerStatusPanel.test.ts` (or `.test.tsx` — create if it doesn't exist) — cover the Archive flow in its new home

**Approach:**
- Lift the existing `ArchiveAction` function out of `$computerId.tsx` into `ComputerStatusPanel.tsx` (either as a local component or inline within the panel JSX). It already takes `computerId` + `computerName` + `onArchived` as props, so the move is mechanical.
- Replace the `CardAction` slot's run/stop Button with the Archive button. The Archive button is destructive — use the existing `text-destructive` styling and the `AlertDialog` confirmation flow already in `ArchiveAction`.
- Move the run/stop toggle into the panel body. A reasonable placement: a small inline button next to the "Runtime" dt/dd row (the one rendering Desired/Observed badges). Keep the existing `controlComputerRuntime` mutation handler unchanged — only its anchor in the DOM moves.
- When the Computer is already archived, the Archive button shows as disabled with text "Archived" (mirror the current header logic at `$computerId.tsx` line ~222 that renders an `Archived` badge in place of `ArchiveAction`). The current logic isn't deleted — it just moves into the panel.
- After-archive callback (`onArchived={() => navigate({ to: "/computers" })}`) is preserved.

**Patterns to follow:**
- `ArchiveAction` already exists; the move is a pure relocation. Don't redesign the AlertDialog flow.
- Other panels in `-components/` that use `CardAction` for primary controls — `ComputerStatusPanel` already uses it for the run/stop button, so the slot is established.

**Test scenarios:**
- Render `ComputerStatusPanel` with an active Computer. Confirm Archive button is visible in the CardAction slot and the run/stop toggle is in the panel body.
- Click Archive → confirm the AlertDialog opens with the expected copy.
- Submit the Archive dialog → `updateComputer` mutation is called with `status: Archived` and the parent's `onArchived` callback fires.
- Render with an already-archived Computer → Archive control shows disabled/labeled "Archived" with no AlertDialog.
- Run/stop toggle: clicking it still flips `desiredRuntimeStatus` between `Running` and `Stopped` — no regression.

**Verification:** Panel test passes; manual smoke on an active Computer → Archive flow works from Config; header no longer shows Archive.

---

### U5. Extract `ThreadsTable` shared component

**Goal:** Lift the `threadColumns` definition, the table-rendering JSX, the assignee-picker popover, the status indicator, and the action handlers out of `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` into a new shared component.

**Requirements:** R8, R9.

**Dependencies:** none. (Pure refactor of the existing `/threads` page.)

**Files:**
- `apps/admin/src/components/threads/ThreadsTable.tsx` — NEW shared component (presentational; data + handlers via props)
- `apps/admin/src/components/threads/ThreadsTable.test.tsx` — NEW; render tests for column shapes, row click, action handlers
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` — refactor to import + render `<ThreadsTable />`, retaining the route's own query and state management
- `apps/admin/src/routes/_authed/_tenant/threads/-thread-grouping.ts` (only if some of the helper logic should move alongside — `threadColumns` references it; the helper can stay where it is and the new component imports it)

**Approach:**
- Identify the boundary between data and rendering in the current `ThreadsPage`. State lives in the route (`viewState`, `pageIndex`, `issueSearch`, debounced search, `assigneePickerIssueId`). Data lives in `useQuery(ThreadsPagedQuery, ...)`. Rendering lives in the JSX block that returns `<DataTable columns={threadColumns} data={...} />`.
- The new `ThreadsTable` takes already-fetched data (`items`, `totalCount`, `loading`) plus a flat set of state values and handlers. It does NOT call `useQuery` itself; the consuming route owns the query.
- Move `threadColumns` and the assignee-picker popover into `ThreadsTable.tsx`. If the column definitions reference handlers (e.g., `onUpdateThread` for the per-row status select), pass those handlers as props.
- Add the `scope?: "tenant" | "computer"` prop (D1). Use it to gate UI affordances that don't apply in Computer scope (e.g., a per-row Computer link, or breadcrumb-style "this row belongs to Computer X" badges — review the current `threadColumns` rendering for any cells that should hide when `scope === "computer"`).
- Keep `ThreadsPage` as a thin shell: own the search/sort/pagination state, run `useQuery`, transform the data, pass everything to `<ThreadsTable />`.

**Patterns to follow:**
- The existing `WorkspaceEditor` component shows the same "route owns target, component owns rendering" split — its data is fetched in the component, but the route owns the `target` prop. For Threads we go the other way (route owns query, component owns rendering) because the table is more presentational than the workspace editor; either direction works as long as the boundary is consistent.
- The `DataTable` primitive in `apps/admin/src/components/ui/data-table.tsx` — no API change here; the new component is just a wrapper that opinionates the columns.

**Test scenarios:**
- Render `<ThreadsTable items={...} ... />` with three thread fixtures. Confirm all three rows render with status indicators, identifiers, and titles.
- Click a row → `onRowClick` is called with the correct thread id.
- Change a row's status via the per-row select → `onUpdateThread` is called with `{ status: "..." }`.
- With `scope="computer"`, any column or cell that the `scope` prop is meant to hide is in fact hidden; with `scope="tenant"` (default) the column is shown. (Specific columns hidden in `computer` scope are an execution-time judgment call when the implementer looks at the existing JSX.)
- Pagination: click "next page" → `onPageChange(1)` is called.
- Sort: click a sortable column header → `onSortChange(field, "asc" | "desc")` is called.
- `loading: true` shows a loading state; `items: []` shows the empty state already used by the `/threads` page.

**Verification:** `vitest run apps/admin/src/components/threads/` passes; `/threads` route renders identically to before (manual smoke); no behavioral regression.

---

### U6. Refactor `/threads` route to consume `ThreadsTable`

**Goal:** Replace the `/threads` page's inline `threadColumns` + DataTable JSX with `<ThreadsTable />`, leaving the route as a thin data + state shell.

**Requirements:** R8, R9.

**Dependencies:** U5.

**Files:**
- `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` — replace inline column/table block with `<ThreadsTable />`; drop the now-moved imports
- `apps/admin/src/routes/_authed/_tenant/threads/-thread-grouping.test.ts` — verify no assertions break (the helper itself isn't moving)

**Approach:**
- Keep `useQuery`, `useState`, debounced search, `viewState` persistence, and the `handleUpdateThread` mutation in the route.
- Pass the result data + state + handlers into `<ThreadsTable />`.
- Render the unread/archived/grouped sections the route currently produces — if the existing grouping (e.g., "running threads above the fold") is presentational, fold it into `ThreadsTable`'s `items` prop; if it's structural (separate DataTables for separate sections), keep that in the route and render two `<ThreadsTable />` instances. The existing route renders two `DataTable` blocks (line 618 and line 665) — preserve that structure with two `<ThreadsTable />` instances if they represent distinct sections.
- Delete `threadColumns` from the route after the move.

**Patterns to follow:** the same data-/render-boundary the existing route already uses; this unit just enforces the boundary by extraction.

**Test scenarios:**
- Source-grep test (or new): `threads/index.tsx` no longer defines `threadColumns`.
- Manual smoke on `/threads`: list renders, search filters, sort reorders, pagination paginates, status select updates, archived toggle works — no regression.

**Verification:** `/threads` page is visually and behaviorally identical to before; admin tests pass; tsc clean.

---

### U7. Render `ThreadsTable` on Computer Dashboard

**Goal:** Add a Threads section to the Computer Dashboard tab, rendering `<ThreadsTable scope="computer" />` against `ThreadsPagedQuery` with `computerId` set to the current Computer.

**Requirements:** R7, R8, R10.

**Dependencies:** U1 (computerId filter on `threadsPaged`), U2 (Dashboard tab cleaned up so there's room), U5 (`ThreadsTable` exists), U6 (`/threads` route validates the shared component before the second consumer lands).

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` — update `ComputerDashboardTab` to fetch threads scoped to `computer.id` and render `<ThreadsTable />`
- `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts` — add a source-grep assertion that the Computer Dashboard wires `ThreadsTable` with `computerId`

**Approach:**
- In `ComputerDashboardTab` (currently renders `ComputerDashboardMetrics + ComputerDashboardActivity + ComputerLiveTasksPanel` — after U2, just `ComputerDashboardMetrics`), add a `useQuery(ThreadsPagedQuery, { variables: { tenantId, computerId, ... } })` call.
- State for search/sort/pagination is owned in the `ComputerDashboardTab` component (local to that tab). If the operator switches tabs and comes back, state can reset — preserving it is out of scope for v1.
- Render `<ThreadsTable scope="computer" items={...} ... onRowClick={(id) => navigate({ to: "/threads/$threadId", params: { threadId: id } })} />` below `ComputerDashboardMetrics`.
- Don't hide the KPI strip; the order is **Metrics first, Threads below**.
- Empty state: when this Computer has zero threads, `ThreadsTable` already handles `items: []` (from U5). No new code needed.

**Patterns to follow:**
- The existing `ComputerDashboardTab` shape — local component owning its own query.
- `useTenant()` for the tenantId; computerId comes from the parent `ComputerDetailPage` via the `computer.id` prop already in scope.

**Test scenarios:**
- Source-grep test: `$computerId.tsx` imports `ThreadsTable` from `@/components/threads/ThreadsTable`.
- Source-grep test: `$computerId.tsx` passes `computerId` (not just `tenantId`) into `ThreadsPagedQuery`.
- Source-grep test: `ComputerDashboardTab` references `<ThreadsTable` with `scope="computer"`.
- Manual smoke on Marco's Dashboard tab: KPI strip renders, then a Threads table below it scoped to Marco's threads.
- Manual smoke on a Computer with zero threads: KPI strip renders + Threads table shows the empty state (no error, no spinner-stuck).

**Verification:** Computer Dashboard renders both Metrics and the scoped Threads table; clicking a row navigates to `/threads/$threadId`; admin tests + tsc clean.

---

### U8. Fix Workspace tab double-scroll (cap editor height to viewport-minus-header)

**Goal:** Workspace tab currently lets the page scroll AND the editor scroll (double scrollbars). The editor should be pinned to the viewport with ~10px bottom gap; the editor's internal scrollback handles overflow, not the outer page. Same pattern as the recently-shipped Computer Terminal scroll fix (PR #1212).

**Requirements:** Implicit — user request 2026-05-13: "on the Workspace tab the editor needs to be fixed to the bottom, no double scroll. Bottom: 10px or something."

**Dependencies:** none. (Self-contained CSS change.)

**Files:**
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` — `ComputerWorkspaceTab`: swap `className="min-h-[650px]"` for a viewport-clamped height
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` — verify the inner editor pane (file tree + Monaco/CodeMirror) constrains correctly with the new outer height; adjust any `overflow-*` or `min-h-*` that conflicts

**Approach:**
- Mirror the Terminal fix: replace `min-h-[650px]` with `h-[calc(100vh-220px)] min-h-[420px]` on `ComputerWorkspaceTab`. The "~10px bottom gap" is achieved by tuning the offset (220px reserves header + tab strip + status badges + ~10px breathing room at the bottom).
- Inside `WorkspaceEditor`, the file-tree + editor split currently composes via flex. Confirm the editor pane uses `flex-1 overflow-hidden` so the Monaco/CodeMirror viewport scrolls internally. If the editor pane has its own `min-h-*` floor that fights the new cap, adjust.
- The fix is **layout-only** — no behavior change to the editor itself.

**Patterns to follow:**
- Computer Terminal fix shipped 2026-05-13 in `ComputerTerminalTab` (`$computerId.tsx`): `h-[calc(100vh-220px)] min-h-[420px]` is the exact pattern.

**Test scenarios:**
- Manual: open any Computer → Workspace. Confirm exactly ONE scrollbar appears (the editor's), and the page does not scroll.
- Manual: open a long file (e.g., 500+ lines). Confirm scrolling stays inside the editor pane, doesn't leak to the page.
- Manual: open a Computer with many files in the tree (e.g., Marco's "90 files"). Confirm the file-tree sidebar scrolls independently of the editor pane.
- Manual: resize the browser window down. Confirm the editor shrinks to fit; the page scrollbar still does not appear until the window is smaller than `min-h-[420px] + header`.
- Source-grep test (extend `-computers-route.test.ts`): `$computerId.tsx` no longer contains `min-h-[650px]` for `ComputerWorkspaceTab`; uses the viewport-clamped pattern instead.

**Verification:** Visual smoke confirms no double scroll; existing Workspace tests pass; admin tsc clean.

---

## System-Wide Impact

- **Admin SPA** — `$computerId.tsx` body shrinks meaningfully (~125 LOC of deleted panel composition); `/threads` route also shrinks (column definitions move out). One new shared component (`components/threads/ThreadsTable.tsx`).
- **GraphQL** — `threadsPaged` gains an optional `computerId` argument. Backward compatible. Codegen regenerates for all `codegen`-script consumers per CLAUDE.md.
- **Resolver** — `threadsPaged` resolver adds one optional WHERE clause. No new DB indices needed (`threads.computer_id` already has `idx_threads_tenant_computer` per the existing schema; verify at implementation time and add only if absent).
- **Tests** — `-computers-route.test.ts` evolves to reflect the new structure; new `ThreadsTable.test.tsx` covers the shared component; existing `/threads` page tests should continue to pass without modification.
- **Mobile** — only affected if `apps/mobile` imports `ThreadsPagedQuery` directly. Confirm via grep at implementation time; if it does, run its codegen and accept the trivial new variable.

## Risks and Mitigations

- **R: Regression on `/threads` page after extracting `ThreadsTable`.** The page is the highest-traffic admin surface; subtle changes to row rendering, action handlers, or pagination state would be immediately noticed. **Mitigation:** U5 → U6 sequencing means the shared component is exercised first by the original consumer; visual smoke before U7 ships catches any extraction-time regression.
- **R: GraphQL codegen drift across consumers.** Forgetting to run codegen in `apps/mobile` (if it imports `ThreadsPagedQuery`) or `packages/api` produces a typecheck mismatch on next deploy. **Mitigation:** U1's verification step explicitly enumerates the codegen runs; CLAUDE.md's "regenerate codegen in every consumer that has a `codegen` script" rule is the source of truth.
- **R: Archive UX feels worse in the panel than the header.** Operators might expect Archive at the top. **Mitigation:** The user's explicit ask is to move it out of the header; if this feels wrong after testing, the fix is a separate UX iteration, not a re-add of the header button (per D4).
- **R: Run/stop toggle becomes harder to find after being relocated to the panel body.** Operators use it occasionally; placing it inline next to the Runtime badges should keep it discoverable, but exact pixel placement is execution-time. **Mitigation:** Place the toggle adjacent to the Desired/Observed badges so it reads as a clear control over those values.

## Verification Strategy

End-to-end verification, post-merge + post-deploy:

1. Computer Detail header: title + tabs + status badges only. No Archive button.
2. Tab order reads Dashboard | Workspace | Terminal | Config.
3. Dashboard tab: KPI strip on top, Threads table below. Threads table shows only threads belonging to the current Computer. Search/sort/pagination/status-update work.
4. Workspace tab unchanged.
5. Terminal tab unchanged (recently shipped; this plan doesn't touch it).
6. Config tab: Status panel (with Archive in CardAction + run/stop toggle inline) + Identity + Runtime. No Events, no Migration.
7. `/threads` route renders identically to pre-refactor.
8. Archive flow from Config → Computer Status archives the Computer and navigates back to `/computers`.
9. Workspace tab shows a single scrollbar (the editor's), not two. Page does not scroll.
