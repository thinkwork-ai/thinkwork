---
title: "Move Tools Configuration Into Agent Detail"
date: 2026-05-23
status: completed
origin: user request
---

# Move Tools Configuration Into Agent Detail

## Problem

Operators currently have to leave the Agent detail screen and open the standalone Tools page to understand whether built-in tools and MCP servers are available to the tenant platform agent. That separation makes runtime behavior hard to reason about, especially now that ThinkWork has a single tenant platform agent and Space should represent memory/context rather than tool configuration.

## Scope

Move the existing Built-in Tools and MCP Servers tabs into the Agent detail route and remove the standalone Tools page entry point. Keep the underlying built-in tool and MCP APIs intact; this is an admin information architecture change, not a backend capability deletion.

## Requirements

- Agent Detail shows four tabs: Files, Config, Built-in Tools, and MCP Servers.
- Built-in Tools under Agent Detail preserves the current effective agent access table and dialogs.
- MCP Servers under Agent Detail preserves the current registration, test, approval, context-tool, enable, and delete flows.
- The sidebar no longer shows a separate Tools item.
- `/capabilities` and its child route surfaces are removed or redirected away so there is no duplicate Tools page.
- Breadcrumbs and copy should refer to Agent configuration rather than a standalone Tools area or retired agent templates.

## Existing Patterns

- `apps/admin/src/routes/_authed/_tenant/agent.tsx` owns the Agent detail layout and child tab chrome.
- `apps/admin/src/routes/_authed/_tenant/agent/files.tsx` and `apps/admin/src/routes/_authed/_tenant/agent/config.tsx` are the current Agent tab routes.
- `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx` contains the effective built-in tool status UI.
- `apps/admin/src/routes/_authed/_tenant/capabilities/mcp-servers.tsx` contains the MCP server registry UI.
- `docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md` says UI removal should preserve backend mutations until a separate backend audit confirms they are dead.

## Implementation Unit 1: Agent Tool Tabs

### Files

- `apps/admin/src/routes/_authed/_tenant/agent.tsx`
- `apps/admin/src/routes/_authed/_tenant/agent/tools.tsx`
- `apps/admin/src/routes/_authed/_tenant/agent/mcp-servers.tsx`
- `apps/admin/src/routes/_authed/_tenant/capabilities/builtin-tools.tsx`
- `apps/admin/src/routes/_authed/_tenant/capabilities/mcp-servers.tsx`
- `apps/admin/src/components/Sidebar.tsx`
- `apps/admin/src/routeTree.gen.ts`
- `apps/admin/src/routes/_authed/_tenant/-ontology-route.test.tsx`
- New or updated Agent route target tests under `apps/admin/src/routes/_authed/_tenant/agent/__tests__/`

### Decisions

- Reuse the existing Built-in Tools and MCP page implementations by exporting their page components and mounting them under Agent child routes. This keeps behavior stable and makes the PR mostly routing and copy changes.
- Add Agent tab entries for Built-in Tools and MCP Servers instead of building a nested tab set. The user asked for “tabs from tools page to agent detail,” and a single row of Agent tabs is the most obvious configuration surface.
- Preserve `listBuiltinTools`, `upsertBuiltinTool`, `listMcpServers`, and related API helpers. The standalone page is being removed, not the capability model.
- Remove the sidebar Tools item and replace route tests that currently assert Tools ordering with tests that assert Tools has been folded into Agent.

### Test Scenarios

- Agent layout source includes `Built-in Tools` and `MCP Servers` tabs with links to `/agent/tools` and `/agent/mcp-servers`.
- Agent layout still defaults `/agent` to `/agent/files`.
- Built-in Tools page source no longer depends on `/capabilities/builtin-tools` route registration and uses Agent breadcrumbs.
- MCP Servers page source no longer depends on `/capabilities/mcp-servers` route registration and uses Agent breadcrumbs.
- Sidebar source no longer includes a standalone `Tools` navigation item.
- Route generation and TypeScript build pass after removing capabilities routes.

## Verification

- `pnpm --filter @thinkwork/admin test -- <target route tests>`
- `pnpm --filter @thinkwork/admin build`
- Browser smoke of `/agent/tools` and `/agent/mcp-servers` with the admin dev server if local environment variables are available.

## Out of Scope

- Backend deletion of built-in tool or MCP APIs.
- Changing tenant policy semantics for Code Sandbox, email, browser, web search, or Company Brain.
- Redesigning Space pages beyond keeping Space focused on memory/context.
