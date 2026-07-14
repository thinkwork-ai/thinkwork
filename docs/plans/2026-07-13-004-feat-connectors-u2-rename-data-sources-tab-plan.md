---
title: Connectors U2 Rename and Data Sources Tab - Plan
type: feat
date: 2026-07-13
topic: connectors-u2-rename-data-sources-tab
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
issue: THINK-285
planned: 2026-07-13
---

# Connectors U2 Rename and Data Sources Tab - Plan

## Goal Capsule

- **Objective:** Rename the operator Settings surface from "Connections" to "Connectors" and give it a third "Data Sources" tab at `/settings/mcp-servers/data-sources` that owns the datasource table, removing datasources from the MCP Servers tab.
- **Product authority:** THINK-285, implementation unit U2 of the THINK-282 contract (`docs/plans/2026-07-13-003-feat-connectors-page-restructure-plan.md` — parent requirements R1, R6, R7 and acceptance example AE2). This unit-scoped artifact restates that slice with the header-action placement decision pinned; the parent contract remains the product authority on conflicts.
- **Open blockers:** none. THINK-284 (U1, merged table) is a sequencing-only dependency — both units edit the same regions of `apps/web/src/components/settings/SettingsMcpServers.tsx`, so U2 lands after U1 to avoid rebase conflicts; there is no functional dependency.

---

## Product Contract

### Summary

The page titled "Connections" at `/settings/mcp-servers` becomes "Connectors" (sidebar label, page title, breadcrumb; URLs unchanged) and gains a third "Data Sources" tab. The existing redirect stub at `/settings/mcp-servers/data-sources` becomes a live tab route rendering the datasource table, which disappears from the MCP Servers tab. Web-only, presentation-layer change.

### Key Decisions

- **Label-only rename; URLs unchanged.** Sidebar entry, page title, and breadcrumb become "Connectors"; every `/settings/mcp-servers/*` path keeps working. The per-user integrations tab keeps its "Connections" label — it accurately names the per-user connections list.
- **Data Sources revives the existing sub-route.** `/settings/mcp-servers/data-sources` already exists as a redirect stub (left from the THINK-239 merge), so promoting it to a real tab route makes old bookmarks resolve to the right place with no new redirect work.
- **Header actions split by tab.** The Register-data-source header action moves to the Data Sources tab; New MCP Server stays on the MCP Servers tab. Today both render together on the MCP Servers tab only; after the split each tab shows only the action that creates the thing it lists.

### Requirements

**Rename**

- R1. The settings sidebar entry, page title, and breadcrumb for this surface read "Connectors"; route paths under `/settings/mcp-servers` are unchanged. (Parent R1.)

**Data Sources tab**

- R2. A third tab "Data Sources" at `/settings/mcp-servers/data-sources` renders the datasource table (columns Name, Source, Instance, Database, Status, Enabled), and that table no longer appears on the MCP Servers tab. (Parent R6.)
- R3. Existing links keep working: `/settings/mcp-servers/data-sources` becomes the live tab route instead of a redirect, and `/settings/mcp-servers/servers` continues to render the MCP Servers tab. (Parent R7.)

**Header actions**

- R4. The Register-data-source header action appears on the Data Sources tab only; the New MCP Server header action appears on the MCP Servers tab only; the Connections tab keeps no header action.

### Acceptance Examples

- AE1. **Covers R2, R3.** Given an old bookmark to `/settings/mcp-servers/data-sources`, when an operator opens it, then the Connectors page loads with the Data Sources tab active showing the datasource table, and the MCP Servers tab no longer contains a Datasource MCPs section. (Parent AE2.)
- AE2. **Covers R4.** Given an operator on the MCP Servers tab, when they switch to the Data Sources tab, then the header action changes from New MCP Server to Register data source, and the register-data-source dialog opens from that tab.

### Scope Boundaries

- The merged Tenant/Plugin table and Type column (parent R2-R5) belong to U1 / THINK-284, not this unit.
- No route-slug rename (`mcp-servers` → `connectors`) and no rename of the per-user "Connections" tab.
- No backend, GraphQL, or data-model changes; mobile is untouched.
- The server detail page keeps its current breadcrumb pointing at `/settings/mcp-servers/servers`.

### Sources / Research

- Page component: `apps/web/src/components/settings/SettingsMcpServers.tsx` — title/breadcrumb/tabs and tab-conditional header actions in the `usePageHeaderActions` call; datasource table renders in the Datasource MCPs section.
- Sidebar label: `apps/web/src/components/settings/settings-nav.tsx` ("Connections" entry).
- Redirect stub to revive: `apps/web/src/routes/_authed/settings.mcp-servers.data-sources.tsx`.
- Tab-label test fixtures: `apps/web/src/components/settings/SettingsMcpServers.test.tsx`.
- Parent contract: `docs/plans/2026-07-13-003-feat-connectors-page-restructure-plan.md`.

---

## Planning Contract

**Product Contract preservation:** unchanged — planning added no product-scope changes; R1–R4 and AE1–AE2 stand exactly as merged in PR #3728 (R4, the header-action pinning, was added at brainstorm time, upstream of this planning pass). The Planning Contract below reconciles with the parent plan's implementation-ready U2 section (KTD3–KTD5 there); no conflicts were found, so the parent's technical decisions are adopted verbatim and grounded against the current source.

### Approach Summary

All work lands in `apps/web`; no GraphQL, backend, or mobile changes. `SettingsMcpServers.tsx` already computes the `dataSourceServers` partition, builds `dataSourceColumns` via `makeColumns("data-sources")`, and derives the active tab from the pathname (`ConnectionsTab` union + `tabForPath`). This unit is therefore a routing-and-render change: extend the tab union with a third `data-sources` value, register the tab in `usePageHeaderActions`, render the datasource table as that tab's body, remove the Datasource MCPs section from the servers tab, convert the `data-sources` redirect stub into a component route, and change three display strings (sidebar label, page title, breadcrumb) to "Connectors".

**Baseline note:** this plan describes edits relative to the post-U1 (THINK-284) file — after U1 the servers tab renders one merged tenant+plugin table and the Datasource MCPs section is the only remaining titled section. The mechanics below do not depend on U1's merge details; only the exact surrounding code differs. Coding starts from fresh `main` after THINK-284 merges.

### Key Technical Decisions

Adopted from the parent plan (its KTD3–KTD5), grounded in the current source:

- **KTD1 — Tab state stays path-derived (parent KTD3).** `ConnectionsTab` becomes `"connections" | "servers" | "data-sources"`; `tabForPath` gains a `data-sources` branch checked before the `servers` prefix match (the paths don't overlap — `/settings/mcp-servers/data-sources` does not start with `/settings/mcp-servers/servers` — but explicit ordering keeps it obviously correct). Add a `DATA_SOURCES_ROUTE` constant beside the existing `CONNECTIONS_ROUTE` / `MCP_SERVERS_ROUTE`. The route file `settings.mcp-servers.data-sources.tsx` swaps its `beforeLoad` redirect for the `OperatorGuard`-wrapped `SettingsMcpServers` component, mirroring `settings.mcp-servers.servers.tsx`. The `plugins` redirect stub is untouched.
- **KTD2 — Header actions split by tab (parent KTD4).** In the `usePageHeaderActions` call: title and breadcrumb become "Connectors"; the `tabs` array gains `{ to: DATA_SOURCES_ROUTE, label: "Data Sources" }`; the `action` becomes tab-conditional — the Register-data-source `TooltipIconButton` renders when `activeTab === "data-sources"`, the New-MCP-Server button when `activeTab === "servers"`, nothing on the Connections tab. The existing `actionKey: mcp-servers:${activeTab}` already varies by tab and needs no change.
- **KTD3 — Per-tab panes with per-tab empty states (parent KTD5).** The data-sources tab renders the existing datasource table (`dataSourceColumns`, `fitContent`, empty state "No data sources registered.") inside its own `SettingsTablePane`; the Datasource MCPs section (and its heading) is removed from the servers tab, whose pane description drops the "analyst data sources" mention. Any remaining all-empty collapse logic for datasources on the servers tab goes away — each tab owns its empty state. The new pane mirrors the servers pane's fetch wiring — `loading={!servers && !error}` and the error-message toolbar branch — so a direct load of the bookmark path shows a loading pane, not a false "No data sources registered." flash, and surfaces fetch failures. The data-sources tab gets its own search state (independent of the servers tab's `search`) so a filter typed on one tab doesn't silently hide rows on the other.

### Sequencing and PR Boundaries

Single unit, single PR (factory default) — the rename, the tab, and the action split are one coherent presentation change; splitting them would ship a "Connectors" title over a page whose datasources are still misplaced, or a tab with the wrong header action. No child issues: THINK-285 is itself the shippable unit under parent THINK-282.

Coding is gated on THINK-284 (U1) merging first — same file regions in `SettingsMcpServers.tsx` and its test file; sequencing-only, no functional dependency.

---

## Implementation Units

### U1. Connectors rename + Data Sources tab (parent plan unit U2)

**Goal:** The surface is titled "Connectors" (sidebar, page title, breadcrumb) and gains a third "Data Sources" tab at `/settings/mcp-servers/data-sources` that owns the datasource table; the MCP Servers tab no longer shows datasources; header actions split per tab.

**Requirements:** R1, R2, R3, R4 (AE1, AE2). **Child issue:** THINK-285 (this issue). **PR boundary:** one PR.

**Dependencies:** THINK-284 (U1 of the parent plan) merged to `main` — sequencing-only.

**Files:**

- `apps/web/src/components/settings/SettingsMcpServers.tsx` — modify (tab union, `tabForPath`, header actions, data-sources pane, remove datasource section from servers tab)
- `apps/web/src/components/settings/settings-nav.tsx` — modify (label only: "Connections" → "Connectors")
- `apps/web/src/routes/_authed/settings.mcp-servers.data-sources.tsx` — modify (redirect → `OperatorGuard` + component route)
- `apps/web/src/components/settings/SettingsMcpServers.test.tsx` — modify (update tab/heading/action assertions; add data-sources-tab scenarios)
- `apps/web/src/components/settings/settings-nav.test.ts` — modify (add a "Connectors" label assertion for the sidebar entry)

**Approach:** Per KTD1–KTD3 above. Concretely: add `DATA_SOURCES_ROUTE`; extend `ConnectionsTab` and `tabForPath`; in `usePageHeaderActions` set title/breadcrumb to "Connectors", add the third tab, and make each header `TooltipIconButton` conditional on its owning tab; add an `activeTab === "data-sources"` branch returning a `SettingsTablePane` (title "Data Sources", datasource-appropriate description, its own search state and toolbar, the servers pane's `loading`/error wiring, `McpServerSection` with `dataSourceColumns` + `fitContent` + empty text "No data sources registered."); delete the Datasource MCPs section (and `dataSourceServers` usage) from the servers-tab body and trim that pane's description; keep the `RegisterDataSourceDialog` and `NewMcpServerDialog` mounted so either tab's action can open its dialog. Swap the route stub's `beforeLoad` redirect for a component route mirroring `settings.mcp-servers.servers.tsx`. Change the sidebar label in `settings-nav.tsx`. The existing test that exercises datasource rows ("lists analyst connectors…") moves its rendered path to `/settings/mcp-servers/data-sources`.

**Patterns to follow:** `settings.mcp-servers.servers.tsx` for the component-route shape; existing `SettingsTablePane` usage in the same file for the new tab body; existing tab-conditional `action` rendering in `usePageHeaderActions`.

**Test scenarios** (update the existing suite in place):

- Header contract: title and breadcrumb are "Connectors"; tabs are exactly `[Connections → /settings/mcp-servers, MCP Servers → /settings/mcp-servers/servers, Data Sources → /settings/mcp-servers/data-sources]`.
- Covers AE1. Rendering at pathname `/settings/mcp-servers/data-sources` shows the datasource table (Name / Source / Instance / Database / Status / Enabled columns, cluster · database values) and none of the tenant/plugin rows.
- The servers tab no longer renders the "Datasource MCPs" heading or datasource rows.
- Covers AE2. Header actions: Register-data-source action present only on the data-sources tab (and opens the Register dialog); New-MCP-Server action present only on the servers tab (and opens its dialog); neither on the Connections tab.
- Data Sources empty state: no datasource rows → "No data sources registered."
- Data Sources loading/error: while the server list is unresolved the pane renders its loading state (no premature empty text); a fetch failure surfaces the error message.
- Search on the data-sources tab filters datasource rows by name and is independent of the servers tab's filter; row click navigates to the server detail route.
- Sidebar nav item renders "Connectors" (settings-nav fixture).
- Existing register/provision dialog tests (internal, external, builtin) keep passing — the dialog now opens from the data-sources tab.

**Verification (browser contract, deployed dev):** Sign in as an operator. (1) Sidebar shows "Connectors"; opening it lands on the Connections tab with title/breadcrumb "Connectors" and three tabs. (2) Open `/settings/mcp-servers/data-sources` directly (old bookmark): page loads with the Data Sources tab active showing the datasource table; the register-data-source header action is present and opens the Register dialog. (3) MCP Servers tab shows the merged table only — no datasource rows — and the New MCP Server action opens its dialog. (4) `/settings/mcp-servers/servers` still renders the merged tab (R3). These four flows are the complete end-to-end proof; the Verification phase drives them in a real browser against deployed dev after the PR merges and deploys.

---

## Verification Contract

- Pre-PR gates: `pnpm --filter @thinkwork/web test` (full package suite), `pnpm --filter @thinkwork/web typecheck`, `pnpm lint`, `pnpm format:check` — green before the PR.
- Browser proof: the four numbered flows in U1's Verification block, driven against deployed dev after merge + deploy (factory Verification phase owns the drive). AE1 is proven by flow (2)+(3); AE2 by the action split observed across flows (2) and (3).

## Definition of Done

- The unit PR squash-merged to `main` with green checks; deploy pipeline completed.
- On deployed dev: sidebar/title/breadcrumb read "Connectors"; Data Sources tab live at `/settings/mcp-servers/data-sources` with the datasource table and the Register action; MCP Servers tab free of datasource rows with the New MCP Server action; `/settings/mcp-servers/servers` still renders.

## Risks

- **Low.** Presentation-layer only. The main regression surface is the existing test suite's structural assertions (tab arrays, section headings, action presence) — update them deliberately, not by deletion; the datasource-table column and dialog assertions carry real behavior and must survive the tab move.
- Baseline drift: this plan is written against pre-U1 source with a post-U1 baseline assumed. If U1's merge reshapes the servers-tab body beyond the parent plan's description, the mechanics here (tab union, header actions, route swap, nav label) are unaffected; only the exact deletion site for the Datasource section moves.
- Existing register/provision dialog tests anchor on `findByPlaceholderText("Search servers…")` before clicking the Register header action. After the split those tests must render at the data-sources path and re-anchor (the new pane's search placeholder should read "Search data sources…", so the anchors change deliberately).
- `@thinkwork/ui` test mocks lack `cn` — if new shared-component usage is added, join class strings rather than importing `cn` in components under the mock allowlist (known repo gotcha).

## Deferred to Follow-Up Work

- Route-slug rename (`mcp-servers` → `connectors`) — explicitly out of scope (Product Contract).
- Server-detail breadcrumb still says "MCP Servers" — acceptable per scope; revisit only if Eric flags it.
