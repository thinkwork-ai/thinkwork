---
title: "feat: Add Wiki as a separate admin module alongside Memories"
type: feat
status: active
date: 2026-04-19
---

# feat: Add Wiki as a separate admin module alongside Memories

## Overview

Reverse the key product decision from `docs/plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md`: the compiled-wiki graph should live in its own top-level module, not replace the Hindsight-backed Memories graph. Memories returns to exactly what it is today (entity+cooccurrence graph over Hindsight). A new Wiki module ships next to it in the sidebar, reusing the already-built `WikiGraph` component and introducing a wiki-page list view that mirrors the Memories list.

Three-page-type semantics become visible in the UI:
- **Entity** → blue
- **Topic** → purple
- **Decision** → dark yellow (matches the current Hindsight "Summaries" badge)

## Problem Frame

Plan 003 swapped Memories → Graph's data source from Hindsight entities to compiled wiki pages. On review, the user decided the Hindsight entity view is still valuable as-is (it's the raw extraction view), and the compiled wiki deserves its own surface because it has different content, different list semantics, and a different mental model (Obsidian-like linked pages). Squeezing both into one module obscures both.

The wiki backend is already built and visible in the admin via plan 003: resolver (`wikiGraph`), graph component (`WikiGraph.tsx`), and list-detail sheet (`WikiPageSheetBody`, currently inline inside `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`). The only missing piece is a dedicated Wiki route that hosts all of this plus a wiki-page list view.

## Requirements Trace

- R1. Memories (`/memory`) renders the Hindsight-backed entity graph and memory-record list exactly as it did before plan 003's Unit 4 wiring — no behavioral change visible to the user on that page.
- R2. A new Wiki module (`/wiki`) appears in the sidebar directly below Memories.
- R3. Wiki has a Pages|Graph toggle mirroring Memories' Memories|Graph pattern. Graph mode uses the already-built `WikiGraph` component. Pages mode renders compiled wiki pages from `recentWikiPages` with columns: Date, Agent, Type, Title.
- R4. Page-type badges use the agreed palette — Entity blue, Topic purple, Decision yellow — in both the list Type column and the graph legend/nodes.
- R5. Clicking a list row or a graph node opens the wiki-page detail sheet (title, type, summary, aliases, sections, connected pages) with the same back-arrow history behavior already shipped.
- R6. Multi-agent fan-out: "All Agents" selector works for both Pages and Graph views (reusing the per-agent client fan-out pattern Memories already follows).

## Scope Boundaries

- Not touching the compile pipeline, wiki-lint, wiki-export, or the mobile wiki surfaces.
- Not adding wiki authoring in the admin — compile remains the only author.
- Not adding pagination to `recentWikiPages`. Its current 100-row cap is acceptable for admin v1; revisit when a tenant exceeds that.
- Not rendering full markdown in the detail sheet (same decision plan 003 made — plain-text section bodies only).
- No wiki-link click-through inside rendered section bodies.
- No deletion of the legacy `memoryGraph` resolver or `apps/admin/src/components/MemoryGraph.tsx` — both stay fully in use by Memories.

### Deferred to Separate Tasks

- **Wiki list pagination** (limit >100): follow-up when needed.
- **Rich markdown rendering** in the detail sheet: follow-up; reuse mobile's `react-native-markdown-display` approach or a web equivalent.
- **Wiki-search bar**: the admin Wiki module uses `wikiSearch` for textual filtering. The graph pane reuses the existing client-side label-substring filter (no server call).

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` — structural template for the new Wiki route. Currently dual-purpose (list + graph) after plan 003; this plan reverts it to pre-003 Memories-only state and lifts the wiki-detail-sheet logic out into a reusable component.
- `apps/admin/src/components/WikiGraph.tsx` — the already-built graph component (just needs a palette update). Keep its performance patterns intact (in-place opacity mute, one-shot camera init, multi-agent fan-out).
- `apps/admin/src/components/Sidebar.tsx` — nav structure. `agentsItems` group holds `Memories`; append `Wiki` right after it.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — the canonical per-agent page-list reader. No changes; the admin wraps the existing query via codegen.
- `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts` — FTS endpoint the Wiki Pages list will hit when the user types into the search bar.
- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` (current, post-003 state) — the `WikiPageSheetBody` component that this plan will extract + rename into `apps/admin/src/components/WikiPageSheet.tsx`.
- `apps/mobile/app/wiki/[type]/[slug].tsx` — mobile reference for rendering summary + sections + aliases. Admin keeps it simpler (no markdown renderer).

### Institutional Learnings

- **OAuth tenantId resolver**: `ctx.auth.tenantId` is null for Google-federated users; every wiki resolver uses `resolveCallerTenantId(ctx)` as fallback. `recentWikiPages` and the already-shipped `wikiGraph` both follow this pattern. (memory: `feedback_oauth_tenant_resolver`)
- **Admin worktree Cognito callbacks**: each vite port (main :5174, worktrees :5175+) must be allowlisted in ThinkworkAdmin CallbackURLs or Google OAuth fails with a generic redirect_mismatch error. Relevant because this plan will involve local admin verification. (memory: `project_admin_worktree_cognito_callbacks`)
- **Worktree isolation**: stay in `.claude/worktrees/admin-wiki-graph/` for this follow-up as well — the current branch already has the plan-003 work that this plan partially reverts. Keep the revert + new Wiki work on the same branch so the PR shows one coherent product delta. (memory: `feedback_worktree_isolation`)
- **Verify wire format empirically**: when this plan's Unit 4 adds `RecentWikiPagesQuery` to admin codegen, curl the live `recentWikiPages` endpoint with a real user token to confirm field casing round-trips before writing downstream list/column code. (memory: `feedback_verify_wire_format_empirically`)

## Key Technical Decisions

- **Revert Memories, don't keep it split**: Memories goes back to exactly pre-plan-003 Unit 4 state — Memories|Graph toggle, `MemoryGraph` component, Hindsight-backed detail sheet, `hindsightEnabled` gate on the toggle. Rationale: users with only Hindsight (no compiled wiki) should keep seeing their entity graph. Keeping Memories untouched restores that behavior without adding a conditional.
- **Wiki is a peer module, not a sub-route of Memories**: clone the Memories route structure into `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx`. Don't nest under Memories (e.g., `/memory/wiki`) — that fights TanStack Router's file-based routing and signals sub-navigation where the two are actually different modules.
- **Reuse `recentWikiPages` for the list**: no new backend endpoint. `recentWikiPages(agentId, limit=100)` returns pages ordered by `COALESCE(last_compiled_at, updated_at)` desc, which is the Memories-style "most recent first" sort order. Multi-agent fan-out mirrors Memories' per-agent fan-out (same `useClient()` + `Promise.all` pattern).
- **Extract `WikiPageSheetBody` into its own file** (`apps/admin/src/components/WikiPageSheet.tsx`): both the Wiki list and Wiki graph sheet consume it. Keeping it inline in a route file would force a copy-paste between list and graph, which is how drift starts. The extracted component takes `tenantId`, `agentId`, `slug`, `entityType`, `title` as props and internally runs `WikiPageQuery`.
- **List Type badge = Graph node color** (single source of truth): define a shared `PAGE_TYPE_COLORS` map (probably in `apps/admin/src/components/WikiPageSheet.tsx` or a new `apps/admin/src/lib/wiki-palette.ts`) that both the list badge and the graph use. Entity=`blue`, Topic=`purple`, Decision=`yellow`. The current WikiGraph palette (sky/amber/rose) changes here.
- **Search behavior**:
  - List view runs `wikiSearch(tenantId, ownerId, query)` when the user presses Enter in the search bar (same submit-only pattern Memories uses — see memory `feat(memory): Memories-tab search is submit-only with Searching overlay` shipped in PR #244).
  - Graph view passes `searchQuery` to `WikiGraph` for client-side label-substring filter (already how WikiGraph works).
- **Icon choice for sidebar**: `Network` (lucide-react) — matches the linked-pages mental model without colliding with `BookOpen` (Knowledge Bases) or `Brain` (Memories).
- **Remove the `@deprecated` breadcrumbs** on `MemoryGraph.tsx` and `memoryGraph.query.ts`: they were added in plan 003 Unit 5 on the assumption the admin would stop calling those. After this plan, both are still primary code for Memories. Stale deprecation notices mislead reviewers.

## Open Questions

### Resolved During Planning

- *Does Wiki need its own backend list endpoint, or reuse `recentWikiPages`?* → Reuse. 100-row cap is fine for v1.
- *Should the list search use `wikiSearch` or client-side title-substring filter?* → `wikiSearch` (FTS) on submit. Matches Memories' submit-only pattern and gets proper ranking across title, summary, body, aliases.
- *Sidebar icon?* → `Network`.
- *Default view in Wiki?* → `pages` (list). Mirrors Memories where the list is the default landing view.

### Deferred to Implementation

- Whether `WikiPageSheet.tsx` should accept a whole `WikiGraphNode` or just `{slug, type, title, agentId}`. Both are valid — inline the choice based on which callsite (list vs graph) is more awkward to adapt.
- Empty-state copy for the Wiki list (no pages yet). Base on what feels right after seeing dev-tenant output.
- Whether to add a Type filter (pills or select) above the list. Out of v1 unless content volume demands it.

## Implementation Units

- [ ] **Unit 1: Revert Memories route + remove deprecation breadcrumbs**

**Goal:** Restore `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` to pre-plan-003-Unit-4 behavior. Clean up stale `@deprecated` JSDoc on the legacy memory-graph path.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`
- Modify: `apps/admin/src/components/MemoryGraph.tsx`
- Modify: `packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts`

**Approach:**
- In `memory/index.tsx`: swap `WikiGraph` / `WikiGraphHandle` / `WikiGraphNode` imports back to the `MemoryGraph` trio. Restore the `hindsightEnabled` gate on the `ToggleGroup`. Put back the original graph-node sheet (the one that renders memory text vs entity labels and threads the `latestThreadId` link). Remove the inline `WikiPageSheetBody` component — that logic moves to Unit 2.
- In `MemoryGraph.tsx`: delete the `@deprecated` JSDoc block at the top of the file.
- In `memoryGraph.query.ts`: delete the `@deprecated` JSDoc block.
- Preserve the imports `WikiPageQuery`, `WikiBacklinksQuery` in `apps/admin/src/lib/graphql-queries.ts` even though Memories no longer uses them — they'll be consumed by the new Wiki route in Unit 5.

**Patterns to follow:**
- The exact pre-003 shape of `memory/index.tsx` is visible in git history (`git show origin/main:apps/admin/src/routes/_authed/_tenant/memory/index.tsx`). Use that as the restoration target, not a from-scratch rewrite.

**Test scenarios:**
- Happy path: opening `/memory` shows Memories|Graph toggle. Graph toggle only visible when `memorySystemConfig.hindsightEnabled` is true.
- Happy path: clicking a graph entity node opens a sheet with the entity label + "View source thread" link when `latestThreadId` is present.
- Regression: the Memories list tab still renders memory records with Date/Agent/Type/Memory columns. Editing and deleting a record still work.

**Verification:**
- Diff against `origin/main:apps/admin/src/routes/_authed/_tenant/memory/index.tsx` is empty (or limited to whitespace) once the revert lands.
- No references to `WikiGraph` or `WikiPageSheetBody` remain inside `memory/index.tsx`.

---

- [ ] **Unit 2: Extract `WikiPageSheet` component + palette module**

**Goal:** Move the wiki-page detail sheet logic out of the old `memory/index.tsx` (pre-revert) into a reusable component. Lock the Entity/Topic/Decision palette in one shared place so list badges and graph nodes stay in sync.

**Requirements:** R4, R5

**Dependencies:** None (runs in parallel with Unit 1; Unit 1's revert removes the inline body, Unit 2 writes it back in its own file)

**Files:**
- Create: `apps/admin/src/components/WikiPageSheet.tsx`
- Create: `apps/admin/src/lib/wiki-palette.ts` (or colocate inside WikiPageSheet.tsx — implementer's call)
- Test: `apps/admin/src/components/WikiPageSheet.test.tsx` *(optional — see Test scenarios)*

**Approach:**
- `WikiPageSheet` takes props: `tenantId`, `ownerId` (= agentId), `type` (ENTITY|TOPIC|DECISION), `slug`, `title`, `connectedEdges` (from graph) — OR a simpler `connectedPages` list when invoked from the list view (empty array). Plus `onBack` and `onEdgeClick` for graph-driven re-anchoring. Keep the back-arrow history behavior intact.
- Shared palette module exports:
  - `PAGE_TYPE_LABELS` — "Entity" / "Topic" / "Decision"
  - `PAGE_TYPE_BADGE_CLASSES` — `bg-blue-500/20 text-blue-400` / `bg-purple-500/20 text-purple-400` / `bg-yellow-500/20 text-yellow-400`
  - `PAGE_TYPE_BORDER_CLASSES` — matching border/text variants for outline badges
  - `PAGE_TYPE_FORCE_COLORS` — hex triplet for the three.js sphere color (blue `#60a5fa`, purple `#a78bfa`, yellow `#facc15`)
- Import the palette module in both `WikiPageSheet.tsx` and Unit 3's `WikiGraph.tsx` update.

**Patterns to follow:**
- Existing inline `WikiPageSheetBody` in `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` (post-plan-003) — copy its structure verbatim, only adapt props.

**Test scenarios:**
- Test expectation: none for Unit 2 beyond Unit 5's integration scenarios — this is a mechanical extraction. If the team prefers, a render test that passes `{type: "TOPIC"}` and asserts the purple badge class is present suffices.

**Verification:**
- `grep -rn "WikiPageSheetBody\|WikiPageSheet" apps/admin/src` returns only the new component file and its imports.
- Palette module exports exactly three entries per map; no stale sky/amber/rose tokens linger in the component layer.

---

- [ ] **Unit 3: Repaint `WikiGraph` to the new palette**

**Goal:** Graph nodes, legend, and badge colors use the canonical Entity blue / Topic purple / Decision yellow tokens from the Unit 2 palette module.

**Requirements:** R4

**Dependencies:** Unit 2 (palette module must exist first)

**Files:**
- Modify: `apps/admin/src/components/WikiGraph.tsx`

**Approach:**
- Replace the hardcoded `TYPE_COLORS` map (sky/amber/rose) with `PAGE_TYPE_FORCE_COLORS` imports from the shared palette module.
- Update the legend swatch styles to match the same palette.
- Preserve the legend's `{ count }` rendering and all force-layout/camera/opacity-mute patterns.

**Patterns to follow:**
- Current `apps/admin/src/components/WikiGraph.tsx` — all other shape stays. Only color literals change.

**Test scenarios:**
- Happy path: a scope with one Entity + one Topic + one Decision renders with distinct blue/purple/yellow spheres; legend shows all three with counts.
- Edge case: a scope with only Entities renders only the Entity swatch in the legend.

**Verification:**
- Visual check on dev tenant — graph re-paints without layout changes. Filter keystrokes still don't reset the camera.

---

- [ ] **Unit 4: Add `RecentWikiPagesQuery` + `WikiSearchQuery` to admin codegen**

**Goal:** Wrap the backend endpoints the new Wiki list view needs into admin `graphql(`…`)` templates so strongly-typed operation hooks are generated.

**Requirements:** R3, R6

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Regenerate: `apps/admin/src/gql/*` (via `pnpm -C apps/admin codegen`)

**Approach:**
- Add `RecentWikiPagesQuery` with variables `{ agentId: ID!, limit: Int }` selecting `id type slug title summary lastCompiledAt updatedAt`.
- Add `WikiSearchQuery` with variables `{ tenantId: ID!, ownerId: ID!, query: String!, limit: Int }` selecting `score matchedAlias page { id type slug title summary lastCompiledAt updatedAt }`.
- Distinct operation names from the existing mobile-SDK wrappers (`WikiSearch` vs `MobileMemorySearch`) to avoid codegen collisions.

**Patterns to follow:**
- Existing `WikiGraphQuery` / `AdminWikiPage` / `AdminWikiBacklinks` additions in the same file (from plan 003).

**Test scenarios:**
- Test expectation: none beyond typecheck — this is scaffolding.

**Verification:**
- `apps/admin/src/gql/graphql.ts` contains both `RecentWikiPagesQuery` and `WikiSearchQuery` as DocumentNode exports.
- `pnpm -C apps/admin exec tsc --noEmit` does not introduce new errors outside the pre-existing ones (ExecutionTrace, org.tsx, forgot-password, etc.).

---

- [ ] **Unit 5: Build the Wiki route — list + graph + detail sheet**

**Goal:** `/wiki` module that mirrors Memories' UI shape (header with agent selector, search bar, toggle, list or graph panel, detail sheet) but backed by compiled wiki pages.

**Requirements:** R2, R3, R4, R5, R6

**Dependencies:** Units 2, 3, 4

**Files:**
- Create: `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx`

**Approach:**
- Route file exports `createFileRoute("/_authed/_tenant/wiki/")` — TanStack Router picks it up automatically.
- Structure mirrors Memories: `useTenant()`, `selectedAgentId` (all | agentId), `searchQuery` / `activeSearch`, `view: "pages" | "graph"`, `graphRef`, `graphNode` state.
- List mode:
  - Single-agent: `useQuery(RecentWikiPagesQuery, { agentId, limit: 100 })`
  - Multi-agent "All Agents": per-agent fan-out via `useClient().query(RecentWikiPagesQuery)` + `Promise.all`, same shape as memory's `fetchAllAgentRecords`.
  - Search mode: `useQuery(WikiSearchQuery, { tenantId, ownerId, query, limit: 50 })`. Search is submit-only (Enter), matches Memories' submit-only pattern.
  - Columns: **Date** (updatedAt or lastCompiledAt, short local date), **Agent** (from agent-name-by-id map), **Type** (badge with palette color), **Title** (with ~1-line summary preview muted beneath).
  - Row click → open `WikiPageSheet` with the row's data. `connectedEdges = []` in list mode (no graph context available).
- Graph mode:
  - Render `<WikiGraph>` with `tenantId`, `agentId`, `agentIds` (All Agents), `searchQuery`.
  - Node click → open `WikiPageSheet` with `connectedEdges` from the graph.
- Breadcrumbs: `[{ label: "Wiki" }]`.
- Header copy: "Wiki — {agentCount} agents" or "{rowCount} pages" depending on mode.
- Empty states:
  - List mode: `Sparkles` icon + "No compiled pages yet. Ask an agent a few questions and come back in a few minutes."
  - Graph mode: (already handled inside WikiGraph).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` (post-Unit-1 revert, i.e., the pre-plan-003 Memories state) — structural template.
- `apps/admin/src/components/WikiGraph.tsx` — how to wire `tenantId` + `agentId` + multi-agent `agentIds`.
- PR #244 for submit-only search + "Searching" overlay pattern (`feat(memory): Memories-tab search is submit-only`).

**Test scenarios:**
- Happy path: navigate to `/wiki`, default view is Pages list, rows render sorted by lastCompiledAt desc.
- Happy path: type a title substring + Enter → list switches to search results ranked by FTS score.
- Happy path: click a row → `WikiPageSheet` opens with title, badge in correct palette color, summary, sections.
- Happy path: toggle to Graph → `WikiGraph` renders with the same palette; click a node → `WikiPageSheet` opens with "Connected pages" list populated.
- Happy path: switch agent selector — list and graph both refetch for the new scope.
- Edge case: "All Agents" fans out `RecentWikiPagesQuery` per agent; results merge, sorted by lastCompiledAt desc across all agents.
- Edge case: empty scope (no pages for selected agent) — list empty-state copy renders; graph empty-state copy renders.
- Edge case: search returns zero hits → "No pages match your search." copy.
- Error path: backend throws on `RecentWikiPagesQuery` (e.g., tenant auth fails) → urql error is surfaced without crashing the whole module.
- Integration: opening a page from the list and then toggling to Graph while the sheet is open — sheet state persists, graph renders fresh, clicking the same node re-anchors the same sheet (or closes and reopens consistently).

**Verification:**
- `/wiki` renders in dev with at least one row for Eric's agent scope.
- `WikiGraph` and the list agree on type color for the same page.
- `pnpm -C apps/admin build` succeeds.
- Network tab shows `RecentWikiPagesQuery` (list) / `WikiSearchQuery` (search) / `WikiGraphQuery` (graph) / `AdminWikiPage` + `AdminWikiBacklinks` (sheet) as the only wiki-related operations fired from this module.

---

- [ ] **Unit 6: Add `Wiki` sidebar entry**

**Goal:** Top-level Wiki nav item under Memories in the sidebar.

**Requirements:** R2

**Dependencies:** Unit 5 (route must resolve before the link renders usefully)

**Files:**
- Modify: `apps/admin/src/components/Sidebar.tsx`

**Approach:**
- Import `Network` from `lucide-react`.
- Insert `{ to: "/wiki", icon: Network, label: "Wiki" }` into `agentsItems` immediately after the existing `Memories` entry.
- No badge count in v1.

**Patterns to follow:**
- The existing `Memories` entry in `Sidebar.tsx:169`.

**Test scenarios:**
- Happy path: sidebar shows Wiki directly below Memories. Active-state highlighting uses `pathname.startsWith("/wiki")`.
- Happy path: clicking Wiki navigates to `/wiki`.
- Edge case: on mobile, tapping Wiki collapses the sheet (same `setOpenMobile(false)` hook the other entries use).

**Verification:**
- Sidebar item appears in both desktop and mobile layouts.
- No generic-icon collision — `Network` is not already used elsewhere in the sidebar (quick `grep -n "Network" apps/admin/src/components/Sidebar.tsx` should return only the new import + usage).

## System-Wide Impact

- **Interaction graph:** purely additive at the route level; Memories is fully restored, Wiki is new. No callbacks, middleware, or observers change.
- **Error propagation:** new route surfaces urql errors from `RecentWikiPagesQuery`, `WikiSearchQuery`, `WikiGraphQuery`, `AdminWikiPage`, `AdminWikiBacklinks`. All already have auth-failure paths (throw WikiAuthError / "Tenant context required") that urql renders as query errors.
- **State lifecycle risks:** none — read-only module.
- **API surface parity:** no backend shape change. All read endpoints used here are pre-existing.
- **Integration coverage:** the sheet's cross-query shape (list-source vs graph-source) is the one cross-layer risk. Unit 5's integration scenario covers the list→sheet and graph→sheet paths.
- **Unchanged invariants:** Memories module (list + graph + sheets), compile pipeline, Hindsight read paths, mobile wiki surfaces, and all backend resolver behavior.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Reverting `memory/index.tsx` loses the inline `WikiPageSheetBody` before Unit 2/5 put the extracted version in place. If revert is committed alone the intermediate tree has no consumer of the sheet — fine, but if a reviewer bisects between revert and Wiki route they'll see the gap. | Land Unit 1 and Unit 2 in one commit, or land Unit 1 → Unit 2 back-to-back so no intermediate checkout is missing the component. |
| Palette drift: list badge and graph node disagree on which blue is "blue". | Single `wiki-palette.ts` module is the only source. Both consumers import from it. Unit 2's verification step checks no other palette tokens remain. |
| `recentWikiPages` returns only 100 rows; tenants with many more pages see truncation. | Acceptable for v1 (admin tool, low tenant page count today). Documented as a deferred follow-up. If it bites sooner, add a cursor and swap the query. |
| `WikiSearchQuery` operation name collides with the backend schema's operation naming expectations. | Admin operation names are client-side only; schema operation naming is not shared. Distinct operation names across admin (`WikiSearch`, `AdminWikiPage`, `AdminWikiBacklinks`) and mobile SDK (`WikiPage`, `WikiBacklinks`, `MobileMemorySearch`) already work in plan 003. |
| Wiki route rendered before the compile pipeline has produced pages shows empty states across both tabs, which can look broken. | Empty-state copy is deliberately explanatory (tells the user the compile pipeline needs a minute). Dev tenants that haven't triggered a compile recently will match this state. |
| Sidebar icon `Network` could be confusing vs. the Knowledge Bases icon (`BookOpen`). | `Network` is the canonical linked-pages icon in Lucide and pairs well with the Brain (Memories) + BookOpen (Knowledge Bases) visual language. If review disagrees, `NotebookText` or `Library` are the fallback swaps. |

## Documentation / Operational Notes

- Admin release notes: "New Wiki module — compiled memory pages as an Obsidian-like list + graph, alongside the existing Memories module. Entity pages in blue, Topic pages in purple, Decision pages in yellow."
- No Terraform, no schema migration, no new feature flag.
- The legacy `memoryGraph` resolver and `MemoryGraph.tsx` are both kept in active use — neither is deprecated after this plan.

## Sources & References

- Immediate predecessor plan: [docs/plans/2026-04-19-003-refactor-admin-wiki-graph-plan.md](./2026-04-19-003-refactor-admin-wiki-graph-plan.md) — whose Unit 4 wiring this plan partially reverts.
- Architectural anchor: [docs/plans/archived/wiki-compiler-memory-layer.md](archived/wiki-compiler-memory-layer.md).
- Related in-flight work (untouched): [docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md](./2026-04-19-002-feat-hierarchical-aggregation-plan.md).
- Pattern references: `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`, `apps/admin/src/components/WikiGraph.tsx`, `apps/admin/src/components/Sidebar.tsx`, `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts`, `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts`.
