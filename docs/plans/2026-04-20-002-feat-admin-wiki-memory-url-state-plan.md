---
title: "feat: Persist admin /wiki and /memory filters in URL"
type: feat
status: active
date: 2026-04-20
---

# feat: Persist admin /wiki and /memory filters in URL

## Overview

Admin's `/wiki` and `/memory` routes currently keep the selected agent and view-mode toggle (Pages/Graph, Memories/Graph) in React component state. A browser refresh discards both, forcing the user to re-pick the agent and re-toggle the view every time. Sync both pieces of state to URL search params so refresh, bookmarking, and link-sharing all preserve the selection.

## Problem Frame

Eric works across multiple agents in `/wiki` and `/memory` and routinely refreshes the page (auth hiccups, deploy, devtools). Today each refresh resets the filter back to "All Agents" + the default view. The desired behavior is straightforward URL persistence — the same convention already used by `/analytics` (`?view=`) and `/scheduled-jobs` (`?agentId=&type=`). No backend or data changes needed.

## Requirements Trace

- R1. Refreshing `/wiki` or `/memory` preserves the currently-selected agent.
- R2. Refreshing preserves the currently-selected view toggle (Pages/Graph on wiki, Memories/Graph on memory).
- R3. URLs with only default values stay clean (no `?agent=all&view=pages` on a fresh load).
- R4. Bookmarking or copy-pasting a URL reproduces the same filtered view in another tab.
- R5. Changing filters uses `navigate({ replace: true })` so the back button doesn't fill up with filter toggles.

## Scope Boundaries

- Only the two list routes: `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx` and `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`.
- The search input's query text stays in local state — it requires an Enter keypress to commit, and persisting every keystroke to the URL isn't what the user asked for. Non-goal for this plan.
- Graph-sheet state (open sheet, graph node history) stays in local state. That's transient UI, not something worth preserving across refreshes.
- Other filter-heavy pages (`/threads`, `/inbox`) also don't sync filters to URL today. Migrating them is **out of scope** for this plan — they have different state (localStorage-backed on threads, ephemeral on inbox) and deserve their own look.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/analytics.tsx` — canonical reference. Uses `validateSearch` with an inline type guard, reads via `Route.useSearch()`, writes via `useNavigate()` with `replace: true`, and omits the param entirely when the value equals the default.
- `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx` (lines 23-29) — shows the two-param version of the same pattern (`type` + `agentId`) with the optional-spread style.
- `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx` — target route #1. Current `useState` values: `selectedAgentId` (line 64, default `"all"`) and `view` (line 67, default `"pages"`).
- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` — target route #2. Current `useState` values: `selectedAgentId` (line 139, default `"all"`) and `view` (line 142, default `"memories"`). Note the existing effect at lines 162-164 that force-resets `view` to `"memories"` when Hindsight disables — that behavior must keep working after the migration.

### Institutional Learnings

- `docs/solutions/` contains no prior entry on TanStack Router search-param state. The in-repo `analytics.tsx` + `scheduled-jobs/index.tsx` pair is the established convention.

## Key Technical Decisions

- **Search params, not path params.** Matches the two in-admin precedents (`/analytics?view=…`, `/scheduled-jobs?agentId=…`). Path params (`/wiki/$agentId`) would require new route files, mess with the "All Agents" sentinel, and deviate from the rest of the admin. The arrow in Eric's screenshot illustrates intent (agent in URL), not a specific URL shape.
- **No Zod schema.** The admin's eight existing `validateSearch` implementations all use plain TS type guards; there's no reason to introduce a different convention for two more routes.
- **Agent param value = `id` (UUID), not `slug`.** The existing `selectedAgentId` state is already a UUID and every downstream query variable uses it. Using the slug would require a reverse lookup every render and change the resolver behavior.
- **Omit defaults from the URL.** On a fresh load, `/wiki` and `/memory` should look exactly like they do today — no `?agent=all&view=pages` noise. Only non-default values appear.
- **`replace: true` on filter toggles.** Matches `analytics.tsx` and keeps the back button useful for navigation rather than filter-undo.
- **Param names: `agent` and `view`.** Short, URL-readable (`?agent=<uuid>&view=graph`). Matches scheduled-jobs' `agentId` in intent but with a tighter name since there's no ambiguity on these routes.
- **Invalid `agent` param (unknown UUID) is tolerated, not scrubbed.** The downstream `AgentsListQuery` will render "0 pages" / "0 memories" and the dropdown will show no selection. That's the same outcome as a deleted agent and a fine UX failure mode — no need for custom "invalid agent" handling in `validateSearch`.

## Open Questions

### Resolved During Planning

- _Path vs search params?_ — search params (see Key Technical Decisions).
- _Should the search input's text also sync?_ — No (see Scope Boundaries).
- _Does this break any existing deep links?_ — No. Adding optional search params is backwards compatible; existing `/wiki` and `/memory` links continue to work with their current behavior.

### Deferred to Implementation

- None. The plan is fully resolved.

## Implementation Units

- [ ] **Unit 1: Add URL-state sync to `/wiki`**

**Goal:** Replace the local `selectedAgentId` and `view` `useState` hooks on the wiki route with search-param sync so refresh preserves both.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx`

**Approach:**
- Add a `validateSearch` to the `createFileRoute` call that accepts `agent?: string` and `view?: "pages" | "graph"`. Include an `isWikiView` inline type guard mirroring `isAnalyticsView` in `analytics.tsx`.
- Replace `const [selectedAgentId, setSelectedAgentId] = useState<string>("all")` with a derived value from `Route.useSearch()`: `const { agent, view } = Route.useSearch(); const selectedAgentId = agent ?? "all"; const activeView = view ?? "pages";`.
- Replace the two setter usages (`setSelectedAgentId(value)` in the `<Select onValueChange>` at line 291, and `setView(v as "pages" | "graph")` at line 285) with calls to a shared `updateFilters({ agent?, view? })` helper that calls `useNavigate()` with `replace: true` and omits default values from the `search` object.
- Remove the now-unused `useState` import segments if they have no other consumers (the file still uses `useState` for search query and sheet state, so the import stays).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/analytics.tsx` — `validateSearch`, `Route.useSearch`, `useNavigate({ replace: true })`, default-omission pattern.
- `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx` lines 23-29 — two-param `validateSearch` shape.

**Test scenarios:**
- Happy path: Select "Marco" from the agent dropdown → URL becomes `/wiki?agent=<marco-uuid>`. Refresh → agent dropdown still shows "Marco" and table/graph renders Marco's data.
- Happy path: Toggle to "Graph" view while on "Marco" → URL is `/wiki?agent=<marco-uuid>&view=graph`. Refresh → graph view + Marco selection both persist.
- Happy path: Switch back to "All Agents" with the graph view still on → URL becomes `/wiki?view=graph` (no `agent=all` noise).
- Happy path: Switch back to defaults (All Agents + Pages) → URL becomes bare `/wiki` with no query string.
- Edge case: Load `/wiki?agent=<nonexistent-uuid>` directly → page renders with the agent pre-"selected" but queries return empty; no crash. The dropdown shows the UUID's state as whatever `Select` does with an unknown value (acceptable — matches deleted-agent behavior).
- Edge case: Load `/wiki?view=invalid` → `validateSearch` drops `view`, so the page falls back to the default Pages view.
- Integration: Filter changes don't clutter history — after toggling view three times, a single browser back press returns to the page before `/wiki` (verify with `replace: true`).

**Verification:**
- Refreshing `/wiki?agent=<uuid>&view=graph` in the browser preserves both filters without re-selecting.
- The browser back button after several filter toggles lands on the route that preceded `/wiki`, not on an earlier filter state.
- Copying the URL into a new tab renders the same filtered view.

- [ ] **Unit 2: Add URL-state sync to `/memory` (mirroring Unit 1)**

**Goal:** Apply the same search-param sync pattern to the memory route, preserving the Hindsight-disabled auto-reset behavior.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Unit 1 establishes the pattern and helper shape; land it first so Unit 2 can mirror it exactly.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`

**Approach:**
- Add `validateSearch` accepting `agent?: string` and `view?: "memories" | "graph"`, with an `isMemoryView` type guard.
- Replace the local `useState`s at lines 139 and 142 with derived values from `Route.useSearch()`, using the same default-fallback pattern as Unit 1 (defaults: `agent → "all"`, `view → "memories"`).
- The existing `useEffect` that forces `view` back to `"memories"` when `!hindsightEnabled && view === "graph"` (lines 162-164) needs to **call the new URL updater** instead of `setView("memories")`. Otherwise the URL would still say `view=graph` while the page rendered memories — a classic out-of-sync bug. Swap the `setView("memories")` call for the shared `updateFilters({ view: undefined })` helper.
- Update the two setter usages: the view `<ToggleGroup onValueChange>` at line 395 and the agent `<Select onValueChange>` at line 400, pointing both at the same `updateFilters` helper.

**Patterns to follow:**
- Same as Unit 1. Keep the helper and type-guard shape consistent across both files even at the cost of a small amount of duplication — two routes is not enough to justify a shared utility module.

**Test scenarios:**
- Happy path: Select "Marco" + toggle Graph view → URL is `/memory?agent=<marco-uuid>&view=graph`. Refresh → both persist.
- Happy path: Defaults-only load renders `/memory` with no query string.
- Edge case: Hindsight is disabled and the URL is loaded as `/memory?view=graph` directly → the auto-reset effect kicks in, strips `view` from the URL (so the URL becomes `/memory`), and the page renders the memories list. This is the hardest case to get right — verify the URL updates, not just the in-memory state.
- Edge case: Load `/memory?agent=<uuid>&view=graph` when Hindsight becomes disabled mid-session → same auto-reset behavior, `agent` param is preserved, only `view` is removed.
- Integration: All-Agents multi-fetch fan-out at lines 211-231 still triggers correctly when `selectedAgentId` comes from search params instead of `useState` — same `isAllAgents` derivation, same effect dependencies.

**Verification:**
- Refreshing `/memory?agent=<uuid>&view=graph` preserves both filters.
- On a Hindsight-disabled deployment, loading `/memory?view=graph` results in both the UI and the URL showing the memories list with no `view` param.
- Multi-agent fan-out still runs when the agent dropdown is on "All Agents" (no regression).

## System-Wide Impact

- **Interaction graph:** No other routes link to `/wiki` or `/memory` with deep-link params today, so no downstream link sources to update. The sidebar nav links to bare `/wiki` and `/memory` and continues to work.
- **State lifecycle risks:** Memory's `useEffect`-driven view reset must update the URL (not just local state), or the rendered view will disagree with the URL after refresh. Flagged in Unit 2's approach.
- **Unchanged invariants:** The GraphQL query variables, multi-agent fan-out logic, search-query-text state, sheet-open state, and `useBreadcrumbs` calls are explicitly untouched. Only the source of truth for `selectedAgentId` and `view` changes from `useState` to `Route.useSearch()`.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Memory's Hindsight-disabled auto-reset misses the URL and leaves `view=graph` in the URL while rendering memories | Unit 2's approach explicitly routes that effect through the shared `updateFilters` helper. Test scenario covers it. |
| A future teammate copy-pastes from `analytics.tsx` and names the param `view` to match but names the other one `agentId` to match `scheduled-jobs`, producing three different conventions in admin | The plan picks `agent` + `view` deliberately and both units use the same names; any future migration of `/threads` and `/inbox` should match. |

## Sources & References

- Related code: `apps/admin/src/routes/_authed/_tenant/analytics.tsx`, `apps/admin/src/routes/_authed/_tenant/scheduled-jobs/index.tsx`
- Target files: `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx`, `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`
- External docs: TanStack Router search params — https://tanstack.com/router/latest/docs/framework/react/guide/search-params
