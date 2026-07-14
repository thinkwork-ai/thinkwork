---
title: Connectors Page Restructure - Plan
type: feat
date: 2026-07-13
topic: connectors-page-restructure
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
issue: THINK-282
planned: 2026-07-13
---

# Connectors Page Restructure - Plan

## Goal Capsule

- **Objective:** Restructure the operator Settings → Connections surface in `apps/web`: rename it to "Connectors", merge the Tenant servers and Plugin MCPs tables into one table with a Type column, and move the Datasource MCPs table to its own "Data Sources" tab.
- **Product authority:** THINK-282 (Eric's issue description plus annotated screenshot); LFG run — small open calls resolved with recorded recommendations below.
- **Open blockers:** none.

---

## Product Contract

### Summary

The page currently titled "Connections" (`/settings/mcp-servers`) becomes "Connectors" and gains a third tab. The MCP Servers tab collapses its Tenant servers and Plugin MCPs sections into a single table whose new Type column shows Tenant or Plugin, and the Datasource MCPs section moves to the new Data Sources tab. This is a web-only, presentation-layer restructure — no backend or data-model change.

### Key Decisions

- **Label-only rename; the URL stays `/settings/mcp-servers`.** The sidebar item, page title, and breadcrumb become "Connectors". Renaming the route slug would break every existing `/settings/mcp-servers/*` link for no user-visible gain; a slug rename can ride a later change if wanted.
- **The per-user integrations tab keeps its "Connections" label.** With the surface renamed "Connectors", the first tab still accurately names the list of per-user connections it shows. Renaming that tab too was not asked for and would invent scope.
- **Data Sources becomes a sub-route tab, reviving the existing path.** `/settings/mcp-servers/data-sources` already exists as a redirect stub (left over from the THINK-239 merge), so promoting it back to a real tab route means old bookmarks resolve to the right place with no new redirect work.
- **Type is derived from the existing client-side classification.** Rows classified by `isPluginInstalledMcpServer` (which includes managed-application servers) show Type "Plugin"; the remainder show "Tenant". No new backend field.
- **The inline "plugin" name badge is retired.** The Type column now carries that information; keeping both would show the same fact twice in one row.

### Requirements

**Rename**

- R1. The settings sidebar entry, page title, and breadcrumb for this surface read "Connectors"; the route paths under `/settings/mcp-servers` are unchanged.

**MCP Servers tab — merged table**

- R2. The MCP Servers tab renders one table containing both tenant-registered servers and plugin/managed-application MCP servers, replacing the two titled sections.
- R3. The merged table has a Type column showing "Tenant" or "Plugin" per row, derived from the existing client-side classification (managed-application servers count as Plugin).
- R4. The inline "plugin" badge next to the server name is removed; Type is conveyed only by the new column.
- R5. Merged rows sort by name ascending by default, and existing per-row behavior is preserved: status pill, Enabled toggle (still disabled for plugin rows), search filtering, and click-through to the server detail page.

**Data Sources tab**

- R6. A third tab "Data Sources" at `/settings/mcp-servers/data-sources` renders the datasource table (columns Name, Source, Instance, Database, Status, Enabled) and that table no longer appears on the MCP Servers tab.
- R7. Existing links keep working: `/settings/mcp-servers/data-sources` becomes the live tab route instead of a redirect, and `/settings/mcp-servers/servers` continues to render the (now merged) MCP Servers tab.

### Acceptance Examples

- AE1. **Covers R2, R3.** Given a tenant with three tenant-registered servers and four plugin MCPs, when an operator opens the MCP Servers tab, then one table shows all seven rows and the Type column reads "Tenant" for the three and "Plugin" for the four (including any managed-application server).
- AE2. **Covers R6, R7.** Given an old bookmark to `/settings/mcp-servers/data-sources`, when an operator opens it, then the Connectors page loads with the Data Sources tab active showing the datasource table, and the MCP Servers tab no longer contains a Datasource MCPs section.

### Scope Boundaries

- Mobile is untouched — its equivalent surface is the Credential Locker screen, which has no "Connections" label to rename.
- No backend, GraphQL, or data-model changes — Tenant/Plugin classification stays client-side.
- No route-slug rename (`mcp-servers` → `connectors` in the URL) in this change.
- The server detail page keeps its current "MCP Servers" breadcrumb pointing at `/settings/mcp-servers/servers`; no detail-page redesign.

### Sources / Research

- Grounding: page component `apps/web/src/components/settings/SettingsMcpServers.tsx` (title/tabs, three-section render, `makeColumns`, row partition), classification in `apps/web/src/lib/mcp-api.ts` (`isPluginInstalledMcpServer`), sidebar label in `apps/web/src/components/settings/settings-nav.tsx`, redirect stubs `apps/web/src/routes/_authed/settings.mcp-servers.{plugins,data-sources}.tsx`, tab-label test fixtures in `apps/web/src/components/settings/SettingsMcpServers.test.tsx`.
- Prior structure came from the THINK-239 datasource merge; this change re-splits datasources into a tab while keeping the THINK-239 classification helpers.

---

## Planning Contract

**Product Contract preservation:** unchanged — planning added no product-scope changes; R1–R7 and AE1–AE2 stand as merged in PR #3723.

### Approach Summary

All work lands in `apps/web`; no GraphQL, backend, or mobile changes. `SettingsMcpServers.tsx` already computes the three row partitions (`individualServers`, `pluginServers`, `dataSourceServers`) and already sorts each by name via `sortMcpServers`. The merge is therefore a render-layer change: concatenate the tenant and plugin partitions into one sorted list, render it through the existing `McpServerSection` (untitled), and add a Type column to `makeColumns("servers")`. The Data Sources tab is a routing change: extend the page's `ConnectionsTab` union and `tabForPath` with a third value, add the tab to `usePageHeaderActions`, and convert the `data-sources` redirect stub back into a component route. The rename touches only display strings (sidebar label, page title, breadcrumb).

### Key Technical Decisions

- **KTD1 — Merge at render time, keep the partitions.** The `individualServers` / `pluginServers` split (and the `pluginServerUrls` dedup that drops manual duplicates of plugin URLs) stays intact; the merged table renders their concatenation re-sorted by `sortMcpServers`. Rationale: the dedup and the Type-column derivation both need the classification anyway; merging upstream of the dedup would regress the duplicate-row fix covered by existing tests.
- **KTD2 — Type column is a content-fit column between Name and URL** rendering an outline `Badge` ("Tenant" / "Plugin"), derived per row from `isPluginInstalledMcpServer`. The inline "plugin" badge inside the Name cell is deleted (R4). The datasource column set (`makeColumns("data-sources")`) does not get a Type column — every row on that tab is a data source.
- **KTD3 — Tab state stays path-derived.** `tabForPath` gains a `data-sources` branch checked before the `servers` prefix match (the paths don't overlap, but explicit ordering keeps it obviously correct). The route file `settings.mcp-servers.data-sources.tsx` swaps its `redirect` for the `OperatorGuard`-wrapped `SettingsMcpServers` component, mirroring `settings.mcp-servers.servers.tsx`. The `plugins` redirect stub is untouched.
- **KTD4 — The "Register data source" header action moves to the Data Sources tab.** Today both header actions (Register data source, New MCP Server) render on the servers tab. With data sources on their own tab, the register action belongs there; New MCP Server stays on the MCP Servers tab. (LFG decision — the requirements don't name button placement; co-locating the action with the table it feeds is the only defensible layout.)
- **KTD5 — Per-tab empty states replace the `allEmpty` collapse.** The grouped-sections logic (`allEmpty`, conditional section headings) is deleted. The MCP Servers tab renders one table with empty state "No MCP servers configured."; the Data Sources tab renders the datasource table with empty state "No data sources registered." The search box renders on both server-list tabs and keeps filtering by name.

### Sequencing and PR Boundaries

One PR per unit (factory default). U1 ships the merged table (page structure otherwise unchanged — Datasource MCPs section still present, title still "Connections"). U2 ships the third tab plus the rename. U2 depends on U1 only because both edit the same regions of `SettingsMcpServers.tsx` and its test file — serializing avoids a guaranteed rebase conflict; there is no functional dependency. Neither unit leaves a broken intermediate state: after U1 alone the page is the current page with a merged table; after U2 the full THINK-282 outcome is live.

---

## Implementation Units

### U1. Merge Tenant and Plugin sections into one table with a Type column

**Goal:** The MCP Servers tab renders a single table of tenant-registered and plugin/managed-application servers with a Type column, replacing the "Tenant servers" and "Plugin MCPs" titled sections.

**Requirements:** R2, R3, R4, R5 (AE1). **Child issue:** THINK-284.

**Dependencies:** none.

**Files:**
- `apps/web/src/components/settings/SettingsMcpServers.tsx` — modify
- `apps/web/src/components/settings/SettingsMcpServers.test.tsx` — modify

**Approach:** Add a `mergedServers` memo: `sortMcpServers([...individualServers, ...pluginServers])` (KTD1 — partitions and URL dedup untouched). In `makeColumns("servers")`, insert a Type column (content-fit, outline Badge, "Plugin" when `isPluginInstalledMcpServer(server)` else "Tenant") and delete the inline "plugin" badge from the Name cell. Replace the two `McpServerSection` blocks for tenant/plugin rows with one untitled section rendering `mergedServers`; the Datasource MCPs section stays exactly as-is in this unit. Simplify the empty handling for the merged group ("No MCP servers configured." when it is empty); keep the Datasource section's collapse-when-empty behavior unchanged until U2 moves it.

**Patterns to follow:** existing `FIT_CONTENT_COLUMN` meta for content-fit columns; existing Badge usage in the Source column; existing `McpServerSection` props.

**Test scenarios** (update the existing suite in place):
- Covers AE1. Given 3 tenant servers and 4 plugin servers (including one managed-application server), the tab renders one table with all 7 rows; the "Tenant servers" and "Plugin MCPs" headings are gone; Type cells read "Tenant" ×3 and "Plugin" ×4.
- Rows render in a single name-ascending order interleaving tenant and plugin rows (assert row order across the merge boundary).
- The inline "plugin" name badge no longer renders (`screen.queryAllByText("plugin")` scoped to name cells is empty; Type-column "Plugin" text is asserted separately).
- A manual tenant row duplicating a plugin server's URL still renders exactly once (dedup preserved).
- Enabled toggle: disabled for plugin rows, active for tenant rows; toggling a tenant row still calls `setMcpServerEnabled`.
- Search filters the merged table by name; row click navigates to the server detail route.
- Empty state: no servers at all → "No MCP servers configured."

**Verification (browser contract, deployed dev):** Sign in as an operator → Settings → Connections → MCP Servers tab. Confirm: one table (no "Tenant servers" / "Plugin MCPs" headings); Type column shows Tenant/Plugin correctly (plugin-installed and managed-application rows say Plugin); no inline "plugin" badge; rows sorted by name; search narrows the table; clicking a row opens the server detail page; the Enabled switch works on a tenant row and is disabled on a plugin row; the Datasource MCPs section still renders below (unchanged in this unit).

### U2. Connectors rename + Data Sources tab

**Goal:** The surface is titled "Connectors" (sidebar, page title, breadcrumb) and gains a third "Data Sources" tab at `/settings/mcp-servers/data-sources` that owns the datasource table; the MCP Servers tab no longer shows datasources.

**Requirements:** R1, R6, R7 (AE2). **Child issue:** THINK-285.

**Dependencies:** U1 / THINK-284 (same file regions; avoids rebase conflict — no functional dependency).

**Files:**
- `apps/web/src/components/settings/SettingsMcpServers.tsx` — modify
- `apps/web/src/components/settings/settings-nav.tsx` — modify (label only)
- `apps/web/src/routes/_authed/settings.mcp-servers.data-sources.tsx` — modify (redirect → component route)
- `apps/web/src/components/settings/SettingsMcpServers.test.tsx` — modify

**Approach:** Extend `ConnectionsTab` to `"connections" | "servers" | "data-sources"` and add the `data-sources` branch to `tabForPath` (KTD3). In `usePageHeaderActions`: title and breadcrumb become "Connectors"; tabs become Connections / MCP Servers / Data Sources; header actions split per KTD4 (Register data source → data-sources tab, New MCP Server → servers tab; update `actionKey` accordingly). Render the datasource table (existing `dataSourceColumns`, `fitContent`) as the data-sources tab body inside its own `SettingsTablePane` with the search toolbar and empty state "No data sources registered."; remove the Datasource MCPs section from the servers tab. Swap the route stub's `beforeLoad` redirect for the `OperatorGuard` + `SettingsMcpServers` component (mirror `settings.mcp-servers.servers.tsx`). Change the sidebar label in `settings-nav.tsx` to "Connectors". The server-detail breadcrumb ("MCP Servers" → `/settings/mcp-servers/servers`) is out of scope per the Product Contract.

**Test scenarios:**
- Header contract: title and breadcrumb are "Connectors"; tabs are exactly `[Connections → /settings/mcp-servers, MCP Servers → /settings/mcp-servers/servers, Data Sources → /settings/mcp-servers/data-sources]`.
- Covers AE2. Rendering at pathname `/settings/mcp-servers/data-sources` shows the datasource table (Name / Source / Instance / Database / Status / Enabled columns, cluster · database values) and none of the tenant/plugin rows.
- The servers tab no longer renders the "Datasource MCPs" heading or datasource rows.
- Header actions: Register-data-source action present only on the data-sources tab; New-MCP-Server action present only on the servers tab; neither on the Connections tab.
- Data Sources empty state: no datasource rows → "No data sources registered."
- Sidebar nav item renders "Connectors" (settings-nav fixture).

**Verification (browser contract, deployed dev):** Sign in as an operator. (1) Sidebar shows "Connectors"; opening it lands on the Connections tab with title/breadcrumb "Connectors" and three tabs. (2) Open `/settings/mcp-servers/data-sources` directly (old bookmark): page loads with the Data Sources tab active showing the datasource table; the register-data-source header action is present and opens the Register dialog. (3) MCP Servers tab shows the merged table only — no datasource rows — and the New MCP Server action opens its dialog. (4) `/settings/mcp-servers/servers` still renders the merged tab (R7).

---

## Verification Contract

- Per-unit gates: `pnpm --filter @thinkwork/web test` (full package suite), `pnpm --filter @thinkwork/web typecheck`, `pnpm lint`, `pnpm format:check` — green before each PR.
- Browser proof per unit as specified in each unit's Verification block, driven against deployed dev after the unit's PR merges and deploys (factory Verification phase owns the drive).
- AE1 is proven by U1's browser pass; AE2 by U2's browser pass.

## Definition of Done

- Both unit PRs squash-merged to `main` with green checks; deploy pipeline completed.
- On deployed dev: Connectors rename visible; MCP Servers tab shows one merged table with a correct Type column and no plugin badge; Data Sources tab live at the old bookmark path with the datasource table; servers tab free of datasource rows; all preserved behaviors (toggle, search, detail click-through) working.

## Risks

- **Low.** Presentation-layer only. The main regression surface is the existing test suite's structural assertions (section headings, badge counts, tab arrays) — they must be updated deliberately, not deleted; the dedup and toggle-disabled assertions carry real behavior.
- `@thinkwork/ui` test mocks lack `cn` — if new shared-component usage is added, join class strings rather than importing `cn` in components under the mock allowlist (known repo gotcha).

## Deferred to Follow-Up Work

- Route-slug rename (`mcp-servers` → `connectors`) — explicitly out of scope (Product Contract).
- Server-detail breadcrumb still says "MCP Servers" — acceptable per scope; revisit only if Eric flags it.
