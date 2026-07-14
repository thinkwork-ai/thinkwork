---
title: Connectors U2 Rename and Data Sources Tab - Plan
type: feat
date: 2026-07-13
topic: connectors-u2-rename-data-sources-tab
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
issue: THINK-285
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
