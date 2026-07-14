---
title: Connectors Page Restructure - Plan
type: feat
date: 2026-07-13
topic: connectors-page-restructure
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
issue: THINK-282
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
