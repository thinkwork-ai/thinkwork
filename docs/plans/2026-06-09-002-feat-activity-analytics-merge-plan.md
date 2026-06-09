---
title: "feat: Merge Analytics into Activity as tabbed settings page"
type: feat
status: completed
date: 2026-06-09
depth: standard
---

# feat: Merge Analytics into Activity as tabbed settings page

## Summary

Combine the two operator settings sections **Activity** and **Analytics** into a single tabbed **Activity** page, mirroring the Memory settings pattern (parent component owns a tabbed header; each facet renders embedded). The side nav loses its standalone **Analytics** entry. The new page exposes two header tabs — **Analytics** (default, at `/settings/activity`) and **Threads** (the existing Activity thread list, at `/settings/activity/threads`). The old `/settings/analytics` URL redirects to `/settings/activity` to preserve bookmarks.

This is a frontend-only change in `apps/web`. No GraphQL, schema, or backend work.

---

## Problem Frame

Activity (recent thread list with a 30-day bar chart and day filtering) and Analytics (cost/usage dashboard) are two separate operator-only settings sections, each with its own side-nav entry and route. They are conceptually adjacent — both are read-only "what's happening in this workspace" views — and the side nav is growing. Folding Analytics into Activity as a tab reduces nav clutter and groups the two observability surfaces, matching the established Memory pattern (Memory / KBs / Ontology / Wiki tabs under one section).

---

## Requirements

Traced directly from the request:

- **R1** — A single **Activity** section in the settings side nav; the standalone **Analytics** nav entry is removed.
- **R2** — The Activity page renders header tabs in the same style as the Memory settings page (the shared `usePageHeaderActions({ tabs })` → `SettingsHeaderBar`/`AppTopBar` mechanism).
- **R3** — The **default** tab (at the section root `/settings/activity`) is **Analytics**.
- **R4** — The second tab is the current Activity thread-list view, labeled **Threads**.
- **R5** (decided) — The old `/settings/analytics` URL redirects to `/settings/activity`.
- **R6** (decided) — The Activity header refresh button relocates into the Threads body toolbar (the parent header now owns title + tabs, leaving no clean home for a per-tab header action).

---

## Key Technical Decisions

**KTD1 — Follow the Memory parent-owns-header pattern, not duplicated per-component headers.**
A new `SettingsActivityHome` parent component owns the header (title `"Activity"`, breadcrumb, and the Analytics/Threads tabs) and renders the active facet by pathname via a `tabForPath()` helper — exactly mirroring `SettingsMemoryHome` (`apps/web/src/components/settings/SettingsMemoryHome.tsx`). Rationale: keeps the header (and thus the tab strip) mounted and stable across tab switches, avoiding flicker; the user explicitly pointed at the Memory page as the reference. The alternative — each facet publishing its own identical `tabs` array — duplicates the tab definition and remounts the header publisher on every switch.

**KTD2 — Both facets gain an `embedded` prop using the existing null-publisher pattern.**
`SettingsActivity` and `SettingsAnalytics` each take `embedded?: boolean`. When embedded, the facet suppresses its own header publisher (the `usePageHeaderActions` call) but still renders its in-body `SettingsPageTitle`/`<h1>`. This is the exact pattern already used by `SettingsMemory`, `SettingsWiki`, and `SettingsTablePane` (see `apps/web/src/components/settings/SettingsContent.tsx:12` `TablePaneHeader` and `:136`). A hook cannot be called conditionally, so the publisher must live in a separate null-rendering child component that the parent simply doesn't render when embedded.

**KTD3 — Threads list moves to `/settings/activity/threads`; thread detail stays at `/settings/activity/$threadId`.**
`/settings/activity` becomes the Analytics tab. The thread list moves under `/settings/activity/threads`. The thread-detail route stays at its current non-nested path (`settings.activity_.$threadId.tsx` → URL `/settings/activity/<threadId>`). TanStack Router prioritizes the static `threads` segment over the `$threadId` param, so there is no routing conflict. Because the detail route is non-nested (`activity_`), it does **not** mount `SettingsActivityHome` and therefore shows no tab strip — only its own breadcrumb header, which is correct for a drill-in view.

**KTD4 — Tab active-state matching already handles the prefix overlap.**
`AppTopBar` and `SettingsHeaderBar` compute the active tab with `[...tabs].reverse().find(t => pathname === t.to || pathname.startsWith(\`${t.to}/\`))`. On `/settings/activity/threads`, both `/settings/activity` (Analytics) and `/settings/activity/threads` (Threads) match by prefix; the `reverse()` ensures the deepest (Threads) wins. No changes needed to the matching logic.

**KTD5 — `/settings/analytics` becomes a redirect route.**
Convert the existing `settings.analytics.tsx` route into a `beforeLoad`-throwing redirect to `/settings/activity`, mirroring the retired-route redirects already used for the old Memory sub-routes (`/settings/wiki`, `/settings/knowledge-bases`, `/settings/knowledge-graph`). Keeping the file means the generated route tree continues to register the path.

---

## High-Level Technical Design

Route → component → tab mapping after the change:

| URL | Route file | Renders | Active tab | Notes |
|-----|-----------|---------|-----------|-------|
| `/settings/activity` | `settings.activity.tsx` | `SettingsActivityHome` → `SettingsAnalytics embedded` | **Analytics** | Default tab |
| `/settings/activity/threads` | `settings.activity.threads.tsx` (new) | `SettingsActivityHome` → `SettingsActivity embedded` | **Threads** | `?day=` filter lives here |
| `/settings/activity/<threadId>` | `settings.activity_.$threadId.tsx` | `SettingsActivityThreadDetail` | none (drill-in) | Non-nested; no tab strip |
| `/settings/analytics` | `settings.analytics.tsx` | redirect → `/settings/activity` | — | Bookmark preservation |

Tab resolution inside the parent (mirrors `SettingsMemoryHome.tabForPath`):

```
SettingsActivityHome (rendered by both /settings/activity and .../threads)
  pathname.startsWith("/settings/activity/threads")  → render <SettingsActivity embedded />   (Threads tab)
  else                                                → render <SettingsAnalytics embedded />  (Analytics tab, default)

  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
    tabs: [
      { to: "/settings/activity",         label: "Analytics" },
      { to: "/settings/activity/threads", label: "Threads"   },
    ],
  })
```

*Directional guidance, not implementation specification.*

The `day` search param (used by the Threads chart/filter and carried into thread detail) is read in the parent via `useSearch({ strict: false })` and updated via a route-agnostic `useNavigate()` targeting `/settings/activity/threads`. Only the threads route declares the `day` `validateSearch`.

---

## Implementation Units

### U1. Add `embedded` support to `SettingsAnalytics`

**Goal:** Let the Analytics dashboard render inside the tabbed parent without publishing its own page header.
**Requirements:** R2, R3.
**Dependencies:** none.
**Files:**
- `apps/web/src/components/settings/SettingsAnalytics.tsx`
- `apps/web/src/components/settings/SettingsAnalytics.test.tsx`

**Approach:**
- Add `embedded?: boolean` to the component signature (default-less optional, matching `SettingsMemory`).
- Replace the two `<SettingsHeader title="Analytics" ... />` usages (loading branch at `:108`-ish and the main `SettingsHeader` at `:108`) so that:
  - the header publisher (`usePageHeaderActions`) is gated behind `{embedded ? null : <AnalyticsHeader />}`, where `AnalyticsHeader` is a small null-rendering child calling `usePageHeaderActions({ title: "Analytics", breadcrumbs: [{ label: "Analytics" }] })` — same shape as `TablePaneHeader` in `SettingsContent.tsx:12`;
  - the in-body title always renders via `<SettingsPageTitle title="Analytics" description="Usage cost over the last 30 days." />`.
- Apply the same gate in both the loading return and the main return so embedded mode never double-publishes.

**Patterns to follow:** `SettingsContent.tsx` `TablePaneHeader` (`:12`) + `SettingsPageTitle` (`:48`); `SettingsWiki.tsx` `WikiHeader` null-publisher gate.

**Test scenarios:**
- Renders the cost metrics, "Cost by User", and "Cost by Model" cards as before (regression guard on existing assertions).
- When rendered with `embedded`, the in-body `Analytics` heading still appears (query the `<h1>`), and no second header breadcrumb is published (assert the page-header context is not driven by this component — e.g. via the existing test harness's header spy if present, otherwise assert the `AnalyticsHeader` child is absent).
- When rendered without `embedded`, header publish behavior is unchanged.

---

### U2. Add `embedded` support + toolbar refresh to `SettingsActivity`

**Goal:** Let the thread-list view render inside the tabbed parent, relabel it "Threads", and relocate its refresh control into the body toolbar.
**Requirements:** R4, R6.
**Dependencies:** none.
**Files:**
- `apps/web/src/components/settings/SettingsActivity.tsx`
- `apps/web/src/components/settings/SettingsActivity.test.tsx`

**Approach:**
- Add `embedded?: boolean` to `SettingsActivityProps`.
- Gate the `usePageHeaderActions({ ..., action: <refresh button>, actionKey })` call (currently at `:206`) behind a null-rendering child component (e.g. `ActivityHeader`) that is only rendered when not embedded — same null-publisher pattern. The current top-level `usePageHeaderActions` must move into that child so it can be conditionally mounted without a conditional hook call.
- Move the refresh `<Button>` (currently the header `action`, `:209`-`:224`) into `ActivityToolbar` (`:287`), placed alongside the search input and item count. Pass `onRefresh` and `fetching` into `ActivityToolbar`. Preserve the spinning icon (`animate-spin` while fetching), `aria-label`/`title`, and disabled-while-fetching behavior.
- Update the in-body `<h1>` (`:231`) from "Activity" to **"Threads"** and adjust the description if desired (e.g. keep "Recent thread activity across this workspace."). The non-embedded header breadcrumb (in `ActivityHeader`) should remain `"Activity"` for the standalone case — but note that after U4 this component is always rendered embedded, so the in-body title "Threads" is what users see under the tab.
- Leave `handleRowClick` navigation (`to: "/settings/activity/$threadId"`, `:191`) unchanged — the detail URL is unchanged (KTD3).

**Patterns to follow:** null-publisher gate as in U1; existing `ActivityToolbar` layout for placing controls in a flex row.

**Test scenarios:**
- Day filtering, chart rendering, and search filtering behave as before (regression guard).
- Clicking a row still navigates to `/settings/activity/$threadId` with the `day` search param preserved.
- The refresh button now renders inside the toolbar (`data-testid="activity-toolbar"` region), spins while fetching, is disabled while fetching, and triggers a network-only refetch on click.
- Subscription updates (`onThreadUpdated`, `onThreadTurnUpdated`) still trigger a refresh.
- When `embedded`, no header `action`/breadcrumb is published; the in-body heading reads "Threads".

---

### U3. Create `SettingsActivityHome` parent component

**Goal:** Own the tabbed header and render the active facet, mirroring `SettingsMemoryHome`.
**Requirements:** R2, R3, R4.
**Dependencies:** U1, U2.
**Files:**
- `apps/web/src/components/settings/SettingsActivityHome.tsx` (new)
- `apps/web/src/components/settings/SettingsActivityHome.test.tsx` (new — see U5)

**Approach:**
- Define route constants `ACTIVITY = "/settings/activity"` and `THREADS = "/settings/activity/threads"`.
- `tabForPath(pathname)` → `"threads"` when `pathname.startsWith(THREADS)`, else `"analytics"`.
- Read pathname via `useLocation({ select: (l) => l.pathname })`.
- Publish the header:
  ```
  usePageHeaderActions({
    title: "Activity",
    breadcrumbs: [{ label: "Activity" }],
    tabs: [
      { to: ACTIVITY, label: "Analytics" },
      { to: THREADS,  label: "Threads"   },
    ],
  })
  ```
- Read the `day` search param via `useSearch({ strict: false })` and build an `onSelectedDayChange` handler with a route-agnostic `useNavigate()` that navigates `{ to: THREADS, search: nextDay ? { day: nextDay } : {} }`.
- Render: `activeTab === "threads" ? <SettingsActivity embedded selectedDay={day ?? null} onSelectedDayChange={...} /> : <SettingsAnalytics embedded />`.
- Wrap in the same `flex h-full min-h-0 w-full flex-col` container as `SettingsMemoryHome`.

**Patterns to follow:** `SettingsMemoryHome.tsx` in full — the `tabForPath`, `usePageHeaderActions({ tabs })`, and embedded-facet rendering are a direct analogue (minus the Cognee gating, which has no equivalent here).

**Test scenarios:** covered in U5.

---

### U4. Rewire routes, redirect, breadcrumbs, and side nav

**Goal:** Point the routes at the new parent, add the Threads route, redirect the old Analytics URL, fix thread-detail back-navigation, and remove the Analytics nav entry.
**Requirements:** R1, R3, R4, R5.
**Dependencies:** U3.
**Files:**
- `apps/web/src/routes/_authed/settings.activity.tsx` (modify)
- `apps/web/src/routes/_authed/settings.activity.threads.tsx` (new)
- `apps/web/src/routes/_authed/settings.analytics.tsx` (modify → redirect)
- `apps/web/src/routes/_authed/settings.activity_.$threadId.tsx` (modify breadcrumb targets)
- `apps/web/src/components/settings/settings-nav.tsx` (remove Analytics entry)
- `apps/web/src/routeTree.gen.ts` (auto-regenerated by the TanStack Router Vite plugin — do not hand-edit)

**Approach:**
- **`settings.activity.tsx`:** render `<OperatorGuard><SettingsActivityHome /></OperatorGuard>`. Remove the `day` `validateSearch` and the `ActivityRouteContent` wrapper from this route (the base path is now the Analytics tab and has no `day` param).
- **`settings.activity.threads.tsx` (new):** `createFileRoute("/_authed/settings/activity/threads")` with the `day` `validateSearch` (moved from the old base route, using `isActivityDay`), rendering `<OperatorGuard><SettingsActivityHome /></OperatorGuard>`. The parent reads `day` loosely (U3), so this route only needs to declare the param schema.
- **`settings.analytics.tsx`:** replace the component with a `beforeLoad: () => { throw redirect({ to: "/settings/activity" }) }`. Mirror the existing retired-route redirect pattern used for the old Memory sub-routes (grep `throw redirect` under `apps/web/src/routes/_authed/settings.*` to find the exact shape, e.g. the `/settings/wiki` redirect).
- **`settings.activity_.$threadId.tsx`:** update `breadcrumbParents` so the "Activity" crumb `href` points to `/settings/activity/threads` (the Threads list, where the thread came from), and the day-filtered crumb's `href` + `search` likewise target `/settings/activity/threads`. The `validateSearch` for `day` is unchanged.
- **`settings-nav.tsx`:** delete the `Analytics` entry from `RAW_SETTINGS_NAV_ITEMS` (`:110`-`:115`). Drop the now-unused `IconChartBar` import if nothing else uses it. The `Activity` entry stays unchanged.

**Patterns to follow:** existing retired-route redirects under `apps/web/src/routes/_authed/`; `settings.memory.knowledge-bases.tsx` as the template for a sibling route that renders the shared parent.

**Test scenarios:** covered in U5 (routing/redirect/nav) plus the existing `-settings.activity-routing.test.ts` still passing (detail route remains non-nested).

---

### U5. Tests

**Goal:** Cover the new structure and update assertions invalidated by the merge.
**Requirements:** R1–R5.
**Dependencies:** U3, U4.
**Files:**
- `apps/web/src/components/settings/settings-nav.test.ts` (modify)
- `apps/web/src/components/settings/SettingsActivityHome.test.tsx` (new)
- `apps/web/src/routes/_authed/-settings.activity-routing.test.ts` (verify still green; extend if it enumerates routes)

**Approach & test scenarios:**
- **`settings-nav.test.ts`:** add an assertion that `Analytics` is no longer present in `visibleSettingsNavItems(...)` / `SETTINGS_NAV_ITEMS`; confirm `Activity` is still present and operator-gated; confirm `settingsCrumbForPath("/settings/activity/threads")` resolves to the `Activity` label (longest-prefix match still works).
- **`SettingsActivityHome.test.tsx` (new, mirror `SettingsMemoryHome.test.tsx`):**
  - At `/settings/activity`, publishes tabs `["Analytics", "Threads"]` with title "Activity" and renders the Analytics facet (assert a Analytics-only element, e.g. "Cost by User", is present).
  - At `/settings/activity/threads`, renders the Threads facet (assert the activity toolbar / thread table is present) and the Threads tab is the active one.
  - `tabForPath` resolves `/settings/activity/threads` and `/settings/activity/threads?day=...` to `"threads"`, and `/settings/activity` to `"analytics"`.
  - `/settings/analytics` redirects to `/settings/activity` (assert via router navigation, mirroring how `SettingsMemoryHome.test.tsx` asserts the retired-route redirects).
- **`-settings.activity-routing.test.ts`:** confirm it still passes (thread detail remains `settings.activity_.$threadId.tsx`, non-nested). If it asserts the full set of activity routes, add `settings.activity.threads.tsx`.

**Patterns to follow:** `SettingsMemoryHome.test.tsx` for tab-publish + redirect assertions; existing `SettingsActivity.test.tsx`/`SettingsAnalytics.test.tsx` harness setup (urql mock client, router stub).

---

## Scope Boundaries

In scope: the route/component restructure, tab header, redirect, refresh relocation, nav removal, and test updates described above — all within `apps/web`.

### Deferred to Follow-Up Work
- None required. (No backend, GraphQL, or schema changes are involved.)

Out of scope (true non-goals):
- Any change to the Analytics data queries or the Activity thread queries/subscriptions.
- Restyling either dashboard's body content beyond the in-body title relabel and toolbar refresh button.
- Changes to the thread-detail view content (only its back-navigation breadcrumb target changes).

---

## Risks & Dependencies

- **Header double-publish flicker.** If a facet's header publisher is not fully gated behind the embedded check, both the parent and child will write to the page-header context and the tab strip may flicker or the breadcrumb may clobber. Mitigation: follow the null-publisher-child pattern exactly (KTD2); U1/U2 test scenarios assert no header publish when embedded.
- **Route-tree regeneration.** `routeTree.gen.ts` is generated by the Vite plugin on dev/build; the new `settings.activity.threads.tsx` and the redirect must appear after a dev server restart / build. Verify the dev server picks up the new route file (restart if the watcher misses it).
- **`day` search param continuity.** The `day` filter must keep working after moving from `/settings/activity` to `/settings/activity/threads` (chart selection, toolbar clear, and carry-into-detail). Covered by U2/U3 scenarios.
- **Stale bookmarks to `/settings/analytics`.** Mitigated by the redirect (R5/KTD5).

---

## Open Questions

- **Nav icon for the merged section.** The `Activity` side-nav entry keeps its `History` icon (`settings-nav.tsx:82`), but the section now *defaults* to the Analytics cost dashboard — a user clicking a History-icon "Activity" entry lands on cost charts. Recommendation: **keep `History`** — the section identity is "Activity" (observability across threads + cost), and History reads as "what's been happening" rather than committing the icon to either tab. Removing the Analytics entry frees `IconChartBar`, so swapping is cheap if preferred; this is a judgment call left to the operator. Not a blocker — does not change any implementation unit.

---

## Verification

- `pnpm --filter @thinkwork/web test` passes (full suite, not just the new/changed files — per repo convention when flipping enumerated nav/route surfaces).
- `pnpm --filter @thinkwork/web typecheck` and `lint` pass.
- Manual (dev server, operator login): side nav shows **Activity** and no **Analytics**; `/settings/activity` shows the Analytics dashboard under an "Analytics" tab with a sibling "Threads" tab; clicking "Threads" shows the thread list with the refresh button in the toolbar and a working day filter; clicking a thread opens the detail and its "Activity" breadcrumb returns to the Threads list; visiting `/settings/analytics` redirects to `/settings/activity`.

---

## Sources & Research

Codebase patterns referenced (no external research needed — strong local patterns exist):
- `apps/web/src/components/settings/SettingsMemoryHome.tsx` — the parent-owns-tabbed-header pattern this plan mirrors.
- `apps/web/src/components/settings/SettingsContent.tsx` — `SettingsHeader`, `SettingsPageTitle`, `TablePaneHeader`, and the `embedded` null-publisher pattern.
- `apps/web/src/components/AppTopBar.tsx` & `SettingsHeaderBar.tsx` — tab active-state matching (deepest-prefix wins).
- `apps/web/src/components/settings/settings-nav.tsx` — nav item registry and operator gating.
- `apps/web/src/routes/_authed/settings.activity_.$threadId.tsx` — thread-detail breadcrumb wiring.
