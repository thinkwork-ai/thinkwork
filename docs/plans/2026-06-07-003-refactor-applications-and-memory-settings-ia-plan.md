---
title: "refactor: Applications + Memory settings IA cleanup"
status: active
date: 2026-06-07
type: refactor
area: apps/web settings
---

# refactor: Applications + Memory settings IA cleanup

## Summary

A settings-navigation and information-architecture cleanup in `apps/web`. Three threads:

1. **Applications surface** — rename "Managed Applications" → "Applications", swap its icon to `IconApps`, and turn its header Refresh into an icon-only spinning button matching other header icons.
2. **Managed-app drill-in** — make the Applications page the single entry point for the two managed apps. Cognee's deployment/config view (today the Knowledge Graph "Info" toggle) becomes a standalone **Cognee Application** page; Twenty's view is the existing CRM page. Both are reached by drilling in from Applications, with breadcrumbs `Applications > Cognee` and `Applications > Twenty CRM`. Their standalone sidebar entries are removed.
3. **Memory consolidation** — collapse the four memory-family pages (Memory, Knowledge Bases, Wiki, Knowledge Graph **explorer**) into one tabbed **Memory** page; old routes redirect in; the sidebar shows a single Memory entry.

Plus two standalone nav removals: the **Managed Applications** section in General Settings, and the **Billing** nav entry (route kept, hidden from nav).

All work is in `apps/web` (React 19 + TanStack Router + urql). No GraphQL/schema/backend changes — this is pure client IA. Tabs come from the shared `@thinkwork/ui` package (`Tabs/TabsList/TabsTrigger/TabsContent`); `@tabler/icons-react` (v3.41.x) is already a dependency and exports `IconApps`.

---

## Problem Frame

The settings sidebar has grown to ~22 operator items, several of which are facets of the same concept. "Managed Applications" lists Cognee and Twenty, yet each also has its own separate sidebar item (Knowledge Graph, CRM), and Cognee's deployment info is buried behind an "Info" toggle on the Knowledge Graph page rather than presented as the application it is. Separately, four memory-adjacent inspectors (Memory, Knowledge Bases, Wiki, Knowledge Graph) each occupy a sidebar row despite being a single conceptual area. General Settings also duplicates managed-app status that now lives on the Applications page, and Billing is in the nav but unimplemented.

The goal is a sidebar where each top-level concept appears once: **Applications** is the home for managed apps (drill in for detail), and **Memory** is the home for the memory family (tab across facets).

### Reconciliation note (user request vs. current code)

The original request described "remove CRM and the info tab from Knowledge Graph." In the current code there is **no CRM tab** inside Knowledge Graph — Twenty CRM is already a separate route (`/settings/crm`), and Knowledge Graph has a `showConfig` toggle (the "Info" button) that swaps between a **graph/data explorer** and a **deployment config panel**. This plan maps the intent onto reality:

- "Remove the info tab from Knowledge Graph" → remove the `showConfig` toggle; the config panel moves to the new Cognee Application page.
- "CRM reachable from Applications → Twenty" → drill-in + breadcrumb change; the CRM page itself is unchanged.
- "Knowledge Graph → Info becomes Cognee Application under Applications → Cognee" → the `KnowledgeGraphConfigPanel` becomes the body of the Cognee Application page.
- The Knowledge Graph **explorer** survives as a tab in the combined Memory page.

---

## Requirements

| ID | Requirement | Source |
|----|-------------|--------|
| R1 | Sidebar + page label "Managed Applications" reads "Applications" | Req #1 |
| R2 | Applications nav icon is `IconApps` (tabler) | Req #2 |
| R3 | Applications page Refresh is an icon-only button (matching other header icon buttons) that spins while refreshing | Req #3 |
| R4 | Cognee's config/info view is a standalone "Cognee Application" page reached from Applications; breadcrumb `Applications > Cognee` | Req #4 |
| R5 | Twenty CRM is reached from Applications; breadcrumb `Applications > Twenty CRM` | Req #4 |
| R6 | The Knowledge Graph `showConfig`/Info toggle is removed (explorer-only); config lives only on the Cognee Application page | Req #4 |
| R7 | Standalone CRM and Knowledge Graph sidebar entries are removed (drill-in / tab only) | Req #4 + scoping Q1/Q2 |
| R8 | The "Managed Applications" section is removed from General Settings | Req #5 |
| R9 | Memory, Knowledge Bases, Wiki, and Knowledge Graph explorer are unified into one tabbed Memory page; old routes redirect in; one sidebar entry | Req #6 + scoping Q3 |
| R10 | Billing is removed from the settings navigation (route/component left intact) | Req #7 (follow-up message) |

### Confirmed scoping decisions

- **Q1 — Sidebar treatment:** Remove standalone CRM / Cognee-config entries; drill-in only.
- **Q2 — Knowledge Graph split:** Config/Info panel → Cognee Application page; graph/data explorer → Memory tab.
- **Q3 — Memory combine:** All four into one page; old routes redirect (tab state is local, not deep-linked).

---

## Key Technical Decisions

**KTD-1 — Keep existing route paths; change labels and breadcrumbs, not URLs.**
The Applications route stays `/settings/managed-applications` and CRM stays `/settings/crm`. Only the *display label* (nav + header) and *breadcrumbs* change. Rationale: renaming routes churns the file-based route tree and every `<Link>`, with no user-visible benefit since the sidebar label is what's read. The breadcrumb label is derived from the nav item label (`settingsCrumbForPath`), so renaming the nav label to "Applications" automatically yields `Applications` as the crumb root. Detail pages publish their own nested crumbs via `usePageHeaderActions`.

**KTD-2 — Cognee Application is a new thin wrapper around the existing `KnowledgeGraphConfigPanel`.**
The config panel (`knowledge-graph/KnowledgeGraphConfigPanel.tsx`) is already a self-contained component. The new `SettingsCogneeApplication` page wraps it, publishes the `Applications > Cognee` breadcrumb, and is guarded by `ManagedApplicationRouteGuard appKey="cognee"`. No logic moves into a new place — only composition changes. New route path: `/settings/applications/cognee` (nested under the Applications concept, even though the Applications list route keeps its legacy `managed-applications` path).

**KTD-3 — The Knowledge Graph page is decomposed, not relocated wholesale.**
`SettingsKnowledgeGraph.tsx` (the wrapper with the `showConfig` toggle) is dismantled: its config branch → Cognee Application page (KTD-2), its explorer branch → Memory tab (R9). The reusable children (`KnowledgeGraphExplorer`, `KnowledgeGraphConfigPanel`) are untouched internally and consumed in their new homes. The old `/settings/knowledge-graph` route redirects to `/settings/memory`.

**KTD-4 — Combined Memory page owns the page header; tab bodies render chrome-free.**
Today each of the four pages calls `usePageHeaderActions({ title, breadcrumbs })` and renders its own `SettingsPageTitle`. If hosted naively in tabs, four `usePageHeaderActions` calls would race for the single page header. The combined page publishes one header (`Memory` breadcrumb) and renders the active tab's **body**. Each source component is refactored to split its header-publishing shell from its body: the parent renders the body, and any per-tab title/toolbar (e.g., the Knowledge Graph Data/Definitions toggle, the Memory table/graph toggle) renders inside the tab content area, not via the global page header. Tab selection is local React state (per Q3, not URL-synced).

**KTD-5 — Redirects use the TanStack `beforeLoad` + `throw redirect` pattern** already established in `settings.index.tsx`. Each retired route file is reduced to a redirect to `/settings/memory`.

**KTD-6 — Nav removals are data-only edits** to `RAW_SETTINGS_NAV_ITEMS` in `settings-nav.tsx`. Removing an item there removes it from the sorted export and from `visibleSettingsNavItems`. `managedAppKey` gating logic stays for any remaining gated items but the CRM/Knowledge-Graph rows are deleted outright.

---

## High-Level Technical Design

### Sidebar before → after

```
BEFORE (operator nav, abbreviated)        AFTER
  General                                    General
  ...                                        ...
  Billing            ← remove (R10)          (Billing hidden)
  Managed Applications (Layers3)  ─┐         Applications (IconApps)   ← R1,R2
  CRM (twenty-gated)               │ collapse  Memory (single entry)   ← R9
  Knowledge Graph (cognee-gated)   │ into    ...
  Knowledge Bases                  │
  Memory                           │
  Wiki Memory                     ─┘
```

### Managed-app navigation graph (after)

```
Applications (/settings/managed-applications)
  ├─ row: Cognee  ──drill──▶ Cognee Application (/settings/applications/cognee)
  │                            breadcrumb: Applications > Cognee
  │                            body: KnowledgeGraphConfigPanel
  └─ row: Twenty  ──drill──▶ Twenty CRM (/settings/crm)
                               breadcrumb: Applications > Twenty CRM
                               body: SettingsCrm (unchanged)
```

### Memory page composition (after)

```
Memory (/settings/memory)   [publishes single "Memory" breadcrumb — KTD-4]
  Tabs (local state):
    ├─ Memory           → SettingsMemory body
    ├─ Knowledge Bases  → SettingsKnowledgeBases body
    ├─ Wiki             → SettingsWiki body
    └─ Knowledge Graph  → KnowledgeGraphExplorer (data/definitions)

Redirects → /settings/memory:
    /settings/wiki, /settings/knowledge-bases, /settings/knowledge-graph
```

---

## Implementation Units

### U1. Rename Applications + IconApps + icon-only spinning Refresh

**Goal:** Satisfy the cosmetic/label changes for the Applications surface (R1, R2, R3).

**Requirements:** R1, R2, R3

**Dependencies:** none

**Files:**
- `apps/web/src/components/settings/settings-nav.tsx` (label + icon)
- `apps/web/src/components/settings/managed-applications/ManagedApplicationsPage.tsx` (header title + Refresh button)
- `apps/web/src/components/settings/settings-nav.test.tsx` (new)

**Approach:**
- In `settings-nav.tsx`: change the `Managed Applications` item's `label` to `"Applications"` and `icon` from `Layers3` to `IconApps` (add to the `@tabler/icons-react` import; drop the now-unused `Layers3` lucide import if no other item uses it — it is currently only used here).
- In `ManagedApplicationsPage.tsx`: change `SettingsHeader` `title` to `"Applications"` (keep or lightly update the description). Replace the Refresh `<Button variant="outline" size="sm">…Refresh</Button>` with an icon-only button matching the Knowledge Graph header pattern (`variant="ghost" size="icon-sm"`, `aria-label="Refresh"`). The icon spins while a refresh is in flight: drive the spin off the existing fetching state (`appsResult.fetching || statusResult.fetching || jobResult.fetching`) using `className={cn("size-4", refreshing && "animate-spin")}`. Use `IconRefresh` from tabler (or keep `RefreshCw` from lucide) — match whichever the other header icon buttons use; tabler `IconRefresh` is preferred per project icon convention for new managed-app UI.
- Verify `SettingsHeader` supports an icon-only action node (it renders whatever `actions` is given — it does).

**Patterns to follow:** Knowledge Graph header icon buttons in `SettingsKnowledgeGraph.tsx` (`variant="ghost" size="icon-sm"` with `aria-label`). Spin pattern: Tailwind `animate-spin`.

**Test scenarios** (`settings-nav.test.tsx`):
- `SETTINGS_NAV_ITEMS` contains an item with `label === "Applications"` and not `"Managed Applications"`.
- The Applications item's `to` is still `/settings/managed-applications` (KTD-1).
- `settingsCrumbForPath("/settings/managed-applications")` returns `[{ label: "Applications" }]`.
- Covers R1: no nav item labelled "Managed Applications" remains.

For the Refresh button, a component test is optional given it's presentational; if added, assert the refresh button has `aria-label="Refresh"` and the icon gains `animate-spin` when a query is fetching. `Test expectation: nav assertions required; Refresh spin test optional (presentational).`

---

### U2. Cognee Application page (from KnowledgeGraphConfigPanel)

**Goal:** Stand up a dedicated Cognee Application page that renders the existing config panel under the `Applications > Cognee` breadcrumb (R4).

**Requirements:** R4

**Dependencies:** none (uses existing `KnowledgeGraphConfigPanel`)

**Files:**
- `apps/web/src/components/settings/SettingsCogneeApplication.tsx` (new)
- `apps/web/src/routes/_authed/settings.applications.cognee.tsx` (new route)
- `apps/web/src/components/settings/SettingsCogneeApplication.test.tsx` (new)

**Approach:**
- New `SettingsCogneeApplication` component: render a page shell (mirror the padding/structure of `SettingsKnowledgeGraph`'s `showConfig` branch — `<div className="flex h-full min-h-0 w-full flex-col p-6">` with `SettingsPageTitle title="Cognee" description="Cognee infrastructure for ontology and graph retrieval."`) hosting `<KnowledgeGraphConfigPanel />`.
- Publish breadcrumb via `usePageHeaderActions({ title: "Cognee", breadcrumbs: [{ label: "Applications", href: "/settings/managed-applications" }, { label: "Cognee" }] })`.
- Route file: guard with `<ManagedApplicationRouteGuard appKey="cognee">` (matching the old knowledge-graph route guard) and render the page.

**Patterns to follow:** `settings.crm.tsx` route guard composition; `SettingsKnowledgeGraph.tsx` `showConfig` branch markup; breadcrumb shape with `href` from `SettingsCrumb` (`settings-nav.tsx` `SettingsCrumb` interface).

**Test scenarios** (`SettingsCogneeApplication.test.tsx`):
- Renders `KnowledgeGraphConfigPanel` (assert a stable element/text the panel renders).
- Publishes a breadcrumb whose first crumb is `Applications` (with href `/settings/managed-applications`) and second is `Cognee`. Covers R4.
- (If guard is exercised in the route test) blocks render when `cognee` is not runtime-enabled — mirror `ManagedApplicationRouteGuard.test.tsx` setup.

---

### U3. Applications page drill-in to Cognee / Twenty

**Goal:** Make each Applications row navigate to its detail page (R4, R5).

**Requirements:** R4, R5

**Dependencies:** U2 (Cognee Application page must exist)

**Files:**
- `apps/web/src/components/settings/managed-applications/ManagedApplicationRow.tsx`
- `apps/web/src/components/settings/managed-applications/ManagedApplicationsPage.tsx` (wire navigation target if the row needs the destination passed in)
- `apps/web/src/components/settings/managed-applications/ManagedApplicationRow.test.tsx` (new or extend)

**Approach:**
- Add an "Open" affordance to each managed-app row that navigates to the app's detail page: `cognee → /settings/applications/cognee`, `twenty → /settings/crm`. Implement as a `<Link>` (TanStack) styled as an icon button (e.g., chevron / arrow-right) or make the row title a link — match how other settings rows expose drill-in. Keep the existing plan/lifecycle controls (`onStartPlan`, `onOpenPlan`) intact; this is an *additional* affordance, not a replacement.
- Derive the destination from `app.key` via a small map; gate the link's enabled state on `runtime`/`provisioned` the same way the external-link button is gated today, or always allow navigation and let the route guard handle the not-provisioned case (prefer the latter — simpler, and the guard already renders an explanatory state).

**Patterns to follow:** `ManagedApplicationsSection.tsx` `<Button asChild><Link to=…>` pattern; existing external-link button in `ManagedApplicationRow`.

**Test scenarios:**
- Cognee row exposes a link to `/settings/applications/cognee`. Covers R4.
- Twenty row exposes a link to `/settings/crm`. Covers R5.
- Existing plan/lifecycle buttons still render (no regression).

---

### U4. Twenty CRM breadcrumb + remove standalone CRM nav

**Goal:** Reframe the CRM page as a child of Applications and remove its standalone sidebar entry (R5, R7).

**Requirements:** R5, R7

**Dependencies:** none (independent of U2/U3, but conceptually paired)

**Files:**
- `apps/web/src/components/settings/SettingsCrm.tsx` (breadcrumb)
- `apps/web/src/components/settings/settings-nav.tsx` (remove CRM item)
- `apps/web/src/components/settings/settings-nav.test.tsx` (extend)

**Approach:**
- In `SettingsCrm.tsx`: update its `usePageHeaderActions` breadcrumbs to `[{ label: "Applications", href: "/settings/managed-applications" }, { label: "Twenty CRM" }]`.
- In `settings-nav.tsx`: delete the `CRM` entry from `RAW_SETTINGS_NAV_ITEMS` (drop the now-unused `BriefcaseBusiness` lucide import). The route `/settings/crm` remains reachable (via drill-in U3) but no longer appears in the sidebar.

**Patterns to follow:** breadcrumb `href` shape (U2).

**Test scenarios** (extend `settings-nav.test.tsx`):
- No nav item with `to === "/settings/crm"`. Covers R7.
- (CRM component test, if present) breadcrumb first crumb is `Applications`, second is `Twenty CRM`. Covers R5.

---

### U5. Combined Memory page — Memory + Knowledge Bases + Wiki tabs

**Goal:** Create the tabbed Memory shell hosting three of the four facets, redirect their old routes, and collapse their nav entries (R9, partial).

**Requirements:** R9

**Dependencies:** none

**Files:**
- `apps/web/src/components/settings/SettingsMemory.tsx` (refactor: split shell vs. body; add tab container) — or a new `SettingsMemoryHome.tsx` container that imports the three bodies (decide during implementation; prefer a new container so each facet component stays focused)
- `apps/web/src/components/settings/SettingsMemory.tsx`, `SettingsWiki.tsx`, `SettingsKnowledgeBases.tsx` (extract chrome-free body exports per KTD-4)
- `apps/web/src/routes/_authed/settings.memory.tsx` (mount the tabbed container)
- `apps/web/src/routes/_authed/settings.wiki.tsx` (→ redirect)
- `apps/web/src/routes/_authed/settings.knowledge-bases.index.tsx` (→ redirect)
- `apps/web/src/components/settings/settings-nav.tsx` (remove Wiki Memory + Knowledge Bases items; keep single Memory item)
- `apps/web/src/components/settings/SettingsMemoryHome.test.tsx` (new)
- `apps/web/src/components/settings/settings-nav.test.tsx` (extend)

**Approach:**
- Build a `SettingsMemoryHome` container using `@thinkwork/ui` `Tabs/TabsList/TabsTrigger/TabsContent` (pattern: `SettingsRoutineDetail.tsx`). Tabs: `memory`, `knowledge-bases`, `wiki` (Knowledge Graph added in U6). Default tab `memory`. Tab state is local `useState` (Q3 — not URL-synced).
- The container calls `usePageHeaderActions({ title: "Memory", breadcrumbs: [{ label: "Memory" }] })` once (KTD-4).
- Refactor each facet component to expose a **body** that does *not* call `usePageHeaderActions` and does *not* assume it owns the page header. Each facet's existing in-pane title/toolbar (`SettingsPageTitle`, table/graph toggles) renders inside its `TabsContent`. Keep each facet's data hooks/queries inside its own body so they only run when mounted (acceptable to mount all tab bodies; or lazy-mount the active tab to avoid firing all queries at once — prefer lazy-mount of inactive tabs for the data-heavy facets).
- Convert `settings.wiki.tsx` and `settings.knowledge-bases.index.tsx` to redirects (`beforeLoad: () => { throw redirect({ to: "/settings/memory" }); }`), per KTD-5. Note: `knowledge-bases` may have child routes (detail/new) — verify and preserve any non-index child routes, redirecting only the index, OR point children back into the Memory tab as appropriate (resolve during implementation; check `settings.knowledge-bases.*` route files).
- Remove `Wiki Memory` and `Knowledge Bases` items from `RAW_SETTINGS_NAV_ITEMS`; keep the `Memory` item (label stays "Memory").

**Patterns to follow:** `SettingsRoutineDetail.tsx` Tabs usage; `settings.index.tsx` redirect.

**Execution note:** Start by extracting one facet body (Wiki is smallest) and proving the chrome-free body + single-breadcrumb composition before refactoring the other two.

**Test scenarios** (`SettingsMemoryHome.test.tsx`):
- Renders tab triggers: Memory, Knowledge Bases, Wiki.
- Default tab shows the Memory body; clicking a tab swaps the visible body.
- Publishes exactly one breadcrumb `[{ label: "Memory" }]` (no per-facet breadcrumb leakage). Covers R9.
- (nav test) no nav items for `/settings/wiki` or `/settings/knowledge-bases`; one item for `/settings/memory`.
- (route test, optional) `/settings/wiki` and `/settings/knowledge-bases` redirect to `/settings/memory`.
- Edge: switching tabs does not throw when a facet's query is still loading (each body handles its own loading state).

---

### U6. Add Knowledge Graph explorer as the 4th Memory tab; retire the KG page

**Goal:** Finish R9 by adding the Knowledge Graph explorer tab, redirect the KG route, remove its nav entry, and dismantle the old `SettingsKnowledgeGraph` wrapper (R6, R7, R9).

**Requirements:** R6, R7, R9

**Dependencies:** U5 (Memory shell), U2 (config already rehomed to Cognee Application)

**Files:**
- `apps/web/src/components/settings/SettingsMemoryHome.tsx` (add KG tab)
- `apps/web/src/components/settings/knowledge-graph/KnowledgeGraphExplorer.tsx` (consume directly; it already takes `mode` / `threadSheetOpen` props — host the Data/Definitions toggle inside the tab)
- `apps/web/src/routes/_authed/settings.knowledge-graph.tsx` (→ redirect)
- `apps/web/src/components/settings/SettingsKnowledgeGraph.tsx` (delete — wrapper is fully decomposed)
- `apps/web/src/components/settings/settings-nav.tsx` (remove Knowledge Graph item)
- `apps/web/src/components/settings/SettingsMemoryHome.test.tsx` (extend)

**Approach:**
- Add a `knowledge-graph` tab whose `TabsContent` renders `KnowledgeGraphExplorer`. Move the Data/Definitions `ToggleGroup` and the thread-ingest button (the `IconMessages` toggle) into the tab's local toolbar, with the `explorerMode` / `threadSheetOpen` state owned by the container (or a small KG-tab wrapper). The `showConfig` toggle is **not** carried over (R6) — config lives only on the Cognee Application page.
- Redirect `/settings/knowledge-graph` → `/settings/memory` (KTD-5). Guard consideration: the old route was `ManagedApplicationRouteGuard appKey="cognee"`. The Memory page itself is operator-gated but not cognee-gated; the KG tab should degrade gracefully when Cognee isn't runtime-enabled (show the explorer's existing empty/unavailable state, or hide the KG tab when `cognee` isn't runtime-enabled — prefer hiding the tab, consistent with the old `managedAppKey` gating). Resolve which during implementation; hiding the tab keeps parity with prior gating.
- Delete `SettingsKnowledgeGraph.tsx` once nothing imports it (grep first). Keep `KnowledgeGraphExplorer` and `KnowledgeGraphConfigPanel`.
- Remove the `Knowledge Graph` item from `RAW_SETTINGS_NAV_ITEMS` (drop the now-unused `IconTopologyStar3` import if unused elsewhere).

**Patterns to follow:** existing `KnowledgeGraphExplorer` prop interface; `visibleSettingsNavItems` gating for the hide-when-not-enabled choice.

**Test scenarios** (extend `SettingsMemoryHome.test.tsx`):
- Renders a Knowledge Graph tab; selecting it shows the explorer.
- KG tab has Data/Definitions toggle; no Info/config toggle present. Covers R6.
- (gating) when `cognee` is not runtime-enabled, the KG tab is hidden (or shows unavailable) — matches chosen approach.
- (nav test) no nav item for `/settings/knowledge-graph`. Covers R7.
- (route) `/settings/knowledge-graph` redirects to `/settings/memory`.
- No remaining import of `SettingsKnowledgeGraph` (dead-code check).

---

### U7. Remove Managed Applications section from General Settings

**Goal:** Drop the duplicated managed-app status block from General (R8).

**Requirements:** R8

**Dependencies:** none

**Files:**
- `apps/web/src/components/settings/SettingsGeneral.tsx` (remove the `<ManagedApplicationsSection>` usage + its import)
- `apps/web/src/components/settings/ManagedApplicationsSection.tsx` (delete if no other consumer)
- `apps/web/src/components/settings/ManagedApplicationsSection.test.tsx` (delete if it exists and the component is removed)

**Approach:**
- In `SettingsGeneral.tsx`: remove the `<ManagedApplicationsSection … />` block from the `showOperator` branch and its import. Leave the Deployment and Resources & URLs sections intact. Verify the surrounding `<>…</>` fragment still has valid children.
- Grep for other importers of `ManagedApplicationsSection`; if General was the only one, delete the component file (and any test). If something else imports it, keep the file and only remove the General usage.

**Patterns to follow:** n/a (deletion).

**Test scenarios:**
- (`SettingsGeneral` render test, if present) the "Managed Applications" section/label no longer renders for operators; Deployment + Resources sections still render. Covers R8.
- `Test expectation:` if no General test harness exists, this is a no-behavioral-logic removal — verify via typecheck + manual; add a minimal render assertion only if a test file already exists.

---

### U8. Remove Billing from navigation

**Goal:** Hide the unimplemented Billing page from the sidebar (R10).

**Requirements:** R10

**Dependencies:** none

**Files:**
- `apps/web/src/components/settings/settings-nav.tsx` (remove Billing item; drop unused `CreditCard` import)
- `apps/web/src/components/settings/settings-nav.test.tsx` (extend)

**Approach:**
- Delete the `Billing` entry from `RAW_SETTINGS_NAV_ITEMS`. **Leave** `settings.billing.tsx` and its component in place (route still reachable by direct URL; just not advertised), per the user's "just remove it from the navigation for now."

**Test scenarios** (extend `settings-nav.test.tsx`):
- No nav item with `to === "/settings/billing"`. Covers R10.

---

## Scope Boundaries

**In scope:** sidebar labels/icons/entries, breadcrumbs, the Applications drill-in affordance, the new Cognee Application page, the combined Memory tabbed page, route redirects, and the two nav removals — all in `apps/web`.

**Out of scope / non-goals:**
- No GraphQL schema, resolver, or backend changes. The managed-app queries (`SettingsDeploymentStatusQuery`, etc.) and the CRM/Cognee panels are reused as-is.
- No renaming of route *paths* (`/settings/managed-applications`, `/settings/crm` stay) — KTD-1.
- No removal of the Billing route/component — nav-only (R10).
- No deep-linkable per-tab URLs for the Memory page (Q3 chose local tab state + redirects).
- Mobile app (`apps/mobile`) is untouched.

### Deferred to Follow-Up Work
- If `/settings/managed-applications` should later become `/settings/applications` for URL cleanliness, do it as a separate route-rename PR with redirects.
- Deep-linkable Memory tabs (e.g., `/settings/memory?tab=wiki`) if bookmarking individual facets becomes desired.
- Actually implementing or fully removing Billing (route + component) once the billing decision is made.

---

## Risks & Dependencies

| Risk | Impact | Mitigation |
|------|--------|------------|
| Four `usePageHeaderActions` calls racing in the combined Memory page | Flickering/incorrect breadcrumb | KTD-4: parent owns the header; facet bodies are chrome-free |
| `knowledge-bases` has child routes (detail/new) that a blanket redirect would break | Broken KB detail navigation | U5: redirect only the index; audit `settings.knowledge-bases.*` route files first |
| Mounting all four tab bodies fires all data queries at once | Wasteful network / slow tab page | U5: lazy-mount inactive tabs for data-heavy facets |
| KG tab when Cognee not runtime-enabled | Empty/erroring tab for non-Cognee tenants | U6: hide the KG tab (or show unavailable state) consistent with prior `managedAppKey` gating |
| Removing standalone CRM/KG nav strands existing bookmarks | Operators' saved links 404 or hit guard | CRM route kept (reachable via drill-in); KG route redirects to Memory |
| Dropping shared lucide imports (`Layers3`, `BriefcaseBusiness`, `IconTopologyStar3`, `CreditCard`) that are used elsewhere | Build break | Grep each import before removing; only drop if unused |

**External dependency:** none. `@thinkwork/ui` Tabs and `@tabler/icons-react` (IconApps, IconRefresh) are already available.

---

## Verification

- `pnpm --filter @thinkwork/web typecheck` clean (catches dropped-import and dead-import issues).
- `pnpm --filter @thinkwork/web test` — full suite green, including the new/extended `settings-nav` and `SettingsMemoryHome` tests.
- `pnpm --filter @thinkwork/web lint` and `pnpm format:check` clean.
- Manual pass on the running dev server (operator login): sidebar shows **Applications** (with apps icon) and a single **Memory** entry; no CRM, Knowledge Graph, Wiki Memory, Knowledge Bases, or Billing rows. Applications page Refresh is icon-only and spins on click. Drilling into Cognee → `Applications > Cognee` (config panel); into Twenty → `Applications > Twenty CRM`. Memory page tabs switch across Memory / Knowledge Bases / Wiki / Knowledge Graph. Visiting `/settings/wiki`, `/settings/knowledge-bases`, `/settings/knowledge-graph` redirects to `/settings/memory`. General Settings no longer shows the Managed Applications section.

---

## Sources & Research

Codebase recon (worktree `.claude/worktrees/ui-updates`, at `origin/main`):
- Nav registry + breadcrumb: `apps/web/src/components/settings/settings-nav.tsx` (`RAW_SETTINGS_NAV_ITEMS`, `visibleSettingsNavItems`, `settingsCrumbForPath`, `SettingsCrumb`).
- Applications page: `apps/web/src/components/settings/managed-applications/ManagedApplicationsPage.tsx` (+ `ManagedApplicationRow`, `ManagedApplicationPlanDialog`).
- Knowledge Graph: `apps/web/src/components/settings/SettingsKnowledgeGraph.tsx` (`showConfig` toggle), `knowledge-graph/KnowledgeGraphExplorer.tsx`, `knowledge-graph/KnowledgeGraphConfigPanel.tsx`.
- CRM: `apps/web/src/components/settings/SettingsCrm.tsx`, route `apps/web/src/routes/_authed/settings.crm.tsx`, guard `ManagedApplicationRouteGuard.tsx`.
- Memory family: `SettingsMemory.tsx`, `SettingsWiki.tsx`, `SettingsKnowledgeBases.tsx`; routes `settings.memory.tsx`, `settings.wiki.tsx`, `settings.knowledge-bases.index.tsx`.
- General: `apps/web/src/components/settings/SettingsGeneral.tsx`, `ManagedApplicationsSection.tsx`.
- Tabs pattern: `apps/web/src/components/settings/SettingsRoutineDetail.tsx` (`@thinkwork/ui` Tabs). Redirect pattern: `apps/web/src/routes/_authed/settings.index.tsx`.
- Confirmed `@tabler/icons-react@3.41.1` exports `IconApps`; `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` exported from `@thinkwork/ui`.

External research: none — internal IA refactor following established in-repo patterns.
