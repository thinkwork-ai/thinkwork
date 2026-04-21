---
title: "refactor: Switch admin memories graph from Hindsight entities to compiled wiki pages"
type: refactor
status: active
date: 2026-04-19
---

# refactor: Switch admin memories graph from Hindsight entities to compiled wiki pages

## Overview

The admin Memories → Graph tab currently renders Hindsight's raw entity + cooccurrence tables. That view is visually cool but low-signal for a human exploring what the system knows: nodes are untyped extracted entities, edges are cooccurrence weights, and there is no semantic page, summary, or clickable detail worth reading. The compiled-memory (wiki) pipeline now produces owner-scoped `wiki_pages` with explicit `[[...]]` links, aliases, summaries, and section bodies — an Obsidian-style knowledge layer that is much closer to what the admin graph is trying to communicate.

This plan replaces the data source behind the Graph toggle: same toggle, same force-graph canvas, but nodes are `wiki_pages` and edges are `wiki_page_links`. Click a node → wiki-page detail sheet (summary + sections + backlinks). Stay inside the existing admin Memories surface; no new top-level nav.

## Problem Frame

`apps/admin/src/routes/_authed/_tenant/memory/index.tsx` wires the `Graph` toggle to `<MemoryGraph>` (`apps/admin/src/components/MemoryGraph.tsx`), which issues `MemoryGraphQuery` → `memoryGraph(assistantId)` → reads `hindsight.entities` + `hindsight.entity_cooccurrences` directly (`packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts`). Nodes are Hindsight entities (Person/Company/Location/…); edges are cooccurrences.

Meanwhile the compiled memory layer has shipped:
- Tables `wiki_pages`, `wiki_page_sections`, `wiki_page_links`, `wiki_page_aliases`, `wiki_section_sources` in `packages/database-pg/src/schema/wiki.ts`.
- GraphQL type + read endpoints (`wikiPage`, `wikiSearch`, `wikiBacklinks`, mobile-only `recentWikiPages`, `mobileWikiSearch`) in `packages/database-pg/graphql/types/wiki.graphql` + `packages/api/src/graphql/resolvers/wiki/`.
- Mobile already consumes wiki pages via `@thinkwork/react-native-sdk` hooks (`useWikiPage`, `useWikiBacklinks`).

What is missing for the admin graph view: a single resolver that returns all active wiki pages plus all `[[...]]` links for a `(tenant, owner)` scope in one round-trip, a matching GraphQL query and type in the admin app, and a graph component that renders them. The current `wikiPage` / `wikiBacklinks` endpoints are per-page and would force N+1 calls to build a full graph.

## Scope Boundaries

- Admin app only. Mobile already has its own planned force graph surface (`docs/plans/archived/compounding-memory-mobile-memories-force-graph.md`); this plan does not touch it.
- v1 is a static "all active pages + links in scope" render. No time scrubbing, no focal-expand mode, no pinned-position persistence.
- v1 keeps the existing `memoryGraph` resolver + `MemoryGraphQuery` on the server untouched so nothing else in the system breaks. The admin stops calling them; follow-up PR removes them after a short soak.
- No wiki authoring surface (no create/edit/delete pages or links). Compile is the only author, same rule as mobile.
- No changes to the compile pipeline, lint, export, or bootstrap paths.
- No new dependencies in the admin app; reuse `react-force-graph-3d` + `three` that `MemoryGraph` already uses.
- Detail sheet renders markdown via a simple readable pass. No wiki-link navigation inside the markdown body in v1 (planned follow-up). Backlink list is clickable.

### Deferred to Separate Tasks

- **Delete `memoryGraph` resolver, schema, and client code**: separate follow-up PR after the new graph has been verified on dev for at least one day. Keeps this PR's blast radius tight.
- **Wiki-link navigation inside rendered markdown body** (click `[[Mom's Cardiologist]]` → navigate to that page in the sheet): follow-up once the minimum graph + detail sheet ships.
- **Type subtype coloring** (Entity → Person / Company / …): wiki pages carry only `entity | topic | decision`. Subtype coloring needs classifier work upstream; out of scope here.
- **Mobile force graph**: already owned by `docs/plans/archived/compounding-memory-mobile-memories-force-graph.md`.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` — current Memories page; owns Memories|Graph toggle, all-agents vs single-agent selector, search bar, and the graph-node detail sheet.
- `apps/admin/src/components/MemoryGraph.tsx` — current force-graph component; consume its shape and patterns (forwardRef handle, multi-agent fan-out, `nodeThreeObject` Skia-like sprite+sphere, in-place opacity mute for filters, one-shot camera init). The new component should mirror this shape so the page-level wiring changes minimally.
- `packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts` — existing resolver reference for "return a graph shape" (`{ nodes: [...], edges: [...] }`). Wiki resolver uses the same wire shape.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — canonical pattern for agent-scoped wiki read with `resolveCallerTenantId(ctx)` fallback for Google-OAuth users whose `ctx.auth.tenantId` is null. The new resolver must use the same pattern (this has bitten us before — see `feedback_oauth_tenant_resolver` memory).
- `packages/api/src/graphql/resolvers/wiki/auth.ts` and `assertCanReadWikiScope` — already enforces `(tenant, owner)` read visibility. Reuse.
- `packages/api/src/graphql/resolvers/wiki/mappers.ts` — `toGraphQLPage` helper. Reuse for node shape to stay consistent with the existing wiki GraphQL surface.
- `packages/database-pg/graphql/types/wiki.graphql` — existing `WikiPage` / `WikiPageType` / `WikiSearchResult` types. Extend with a new `WikiGraph` type here, not in a new file, so the wiki schema stays single-sourced.
- `apps/mobile/app/wiki/[type]/[slug].tsx` + `apps/mobile/components/memory/CapturesList.tsx` — reference implementation for rendering wiki-page detail (markdown body, section list, aliases). Admin detail sheet can be simpler but follow the same read shape.

### Institutional Learnings

- **OAuth tenantId resolver**: `ctx.auth.tenantId` is null for Google-federated users. Every new resolver that is scoped by tenant must use `resolveCallerTenantId(ctx)` as the fallback, mirroring `recentWikiPages.query.ts:30`. Cognito pre-token trigger has not landed yet. (memory: `feedback_oauth_tenant_resolver`)
- **Admin worktree Cognito callbacks**: when iterating locally on a worktree admin vite build, the vite port (`:5175+`) must be in ThinkworkAdmin's CallbackURLs or Google OAuth breaks with a generic-looking `redirect_mismatch` error. (memory: `project_admin_worktree_cognito_callbacks`) — relevant because this plan will involve running admin locally for verification.
- **Worktree isolation**: land the implementation in `.claude/worktrees/admin-wiki-graph/` off `origin/main`, not in the main checkout, which has multiple in-flight streams (compounding memory refinement + hierarchical aggregation). (memory: `feedback_worktree_isolation`)
- **Verify wire format empirically**: before shipping client code that assumes the new GraphQL field names, run an actual GraphQL query against the new resolver on dev and confirm the casing round-trips correctly. No refactors based on schema files alone. (memory: `feedback_verify_wire_format_empirically`)

### External References

- `docs/plans/archived/wiki-compiler-memory-layer.md` — architectural anchor for the compiled memory layer. Confirms compiled pages are a strictly downstream, rebuildable projection; treating them as the primary visualization is aligned with the architecture (there is no danger of the admin UI accidentally making wiki state canonical).
- `docs/plans/archived/compounding-memory-mobile-memories-force-graph.md` — mobile force-graph PRD. Useful shape reference for node/edge types; v1 admin intentionally does not inherit the temporal-scrub or Skia pieces.

## Key Technical Decisions

- **New single `wikiGraph(tenantId, ownerId)` GraphQL query**: one round-trip returns `{ nodes, edges }` for an agent's active pages. Keeps the admin client simple and mirrors the `memoryGraph` shape so the force-graph component needs minimal changes. Rationale: building the graph via N page fetches + backlinks-per-page would N+1 on every agent and slow the Graph tab noticeably once an agent has >50 pages.
- **Wire shape intentionally matches `memoryGraph`**: `{ nodes: [{ id, label, type, strategy, entityType, edgeCount, latestThreadId }], edges: [{ source, target, label, weight }] }`. `nodeType` becomes `"page"` instead of `"entity" | "memory"`; `entityType` carries `ENTITY|TOPIC|DECISION`; `strategy` is always null; `latestThreadId` is null in v1 (no provenance hookup yet). This lets the new `WikiGraph` component be a near-clone of `MemoryGraph` today, which is the known-working pattern. When follow-up work lands threading/provenance to pages, filling in those fields is additive, not a refactor.
- **Multi-agent "All Agents" view**: fan out the same way `MemoryGraph` does — one `wikiGraph` query per agent, prefix each node id with `<agentId>:` to avoid collisions, concatenate. No server-side multi-agent endpoint in v1; the client fan-out pattern already works and keeps resolver complexity flat.
- **Edge direction and label**: `wiki_page_links.from_page_id → to_page_id` is a directed reference (`[[alias]]` in from-page's markdown points at to-page). Render arrows. Label is `"references"` for every edge in v1 — edges carry no semantic relation yet, but a non-empty label keeps the existing ForceGraph3D visual (colored arrow) consistent with how `memoryGraph` edges render.
- **Type → color mapping**: three page types only in v1. Entity → sky, Topic → amber, Decision → rose (or the three existing wiki-type palette colors already used in mobile/wiki UI; see `apps/admin/src/components/icons/` + `PR #245` memory icon palette that just landed). Reuse existing admin color tokens rather than hardcoding new ones. Empty `Untyped` legend slot is removed.
- **Feature gate source**: do NOT gate the new graph on `memorySystemConfig.hindsightEnabled`. The compiled wiki lives in Aurora and is populated by the compile pipeline, which is today Hindsight-dependent upstream but not from the admin graph's point of view. Instead gate on "wiki pages exist in scope": if the server returns zero nodes, show the existing empty state with a message tailored to wiki ("No compiled memory pages yet — ask the agent a few questions and come back in a few minutes"). The Graph toggle stays visible unconditionally.
- **Detail sheet keeps two modes but different content**: the existing list-view detail sheet (memory-record editing) is untouched — it still hits the Hindsight-backed memory-record mutations for the list tab. The graph-node detail sheet is rewritten to render wiki page summary + sections (read-only) + backlinks (clickable). The two sheets already live in the same file; keep them separate so the memory-list tab is unchanged.
- **Zero-node state inside graph**: when the force graph has no nodes in the current scope, render the same empty-state treatment the list view already ships (brain icon + copy), not the "click Dream" wording currently in `MemoryGraph.tsx:395`.
- **Admin-app GraphQL query**: add a new `WikiGraphQuery` in `apps/admin/src/lib/graphql-queries.ts` using the existing `graphql(...)` codegen helper so types are generated. Do not hand-write types.

## Open Questions

### Resolved During Planning

- *Which GraphQL file does the new `WikiGraph` type live in?* → `packages/database-pg/graphql/types/wiki.graphql`, extending the existing wiki type surface. Avoids spreading wiki schema across files.
- *Do we need a `wikiGraphMulti(tenantId, ownerIds)` server endpoint to optimize "All Agents"?* → No, client fan-out is fine for v1. The existing `MemoryGraph` ships the same pattern and admin tenants have ≤10 agents today.
- *How do we surface "this page cites which memories"?* → Not in v1. The plan intentionally leaves provenance drill-down to the separate compounding-memory refinement plan (`docs/plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md`, now superseded by the hierarchical aggregation plan). The admin graph shows structural links between pages only.
- *Should the current list view's search bar also search wiki pages?* → Out of scope. The search input continues to search memory records in list mode; the graph pane already runs its own client-side node-label filter on `searchQuery`, which is reused.

### Deferred to Implementation

- Exact visual weights for type-colored nodes (sphere radius, font size) once the three-type palette is rendering on real data — current `MemoryGraph` tuning is based on 200 entities; wiki pages will be far fewer so radii may need re-tuning.
- Whether `edgeCount` should use outbound + inbound links, outbound only, or inbound only. Default in the resolver: count any link where the page is either `from_page_id` or `to_page_id`. Revisit if the force-layout mass ends up misleading.
- Final behavior for zero-link pages (isolated nodes): d3-force handles them fine visually, but the user may want an opt-in "hide orphans" toggle. Not a v1 blocker.

## Implementation Units

- [ ] **Unit 1: Add `wikiGraph` GraphQL resolver + type**

**Goal:** Single agent-scoped endpoint that returns all active pages + links for `(tenant, owner)` in one query.

**Requirements:** R1 (data source is compiled wiki, not Hindsight entities), R5 (same wire shape as `memoryGraph` so the admin client stays close to the existing pattern).

**Dependencies:** None — wiki tables already exist.

**Files:**
- Create: `packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts`
- Modify: `packages/api/src/graphql/resolvers/wiki/index.ts` — register resolver
- Modify: `packages/database-pg/graphql/types/wiki.graphql` — add `WikiGraph`, `WikiGraphNode`, `WikiGraphEdge` types and the `wikiGraph(tenantId, ownerId)` Query field
- Test: `packages/api/src/graphql/resolvers/wiki/wikiGraph.query.test.ts`

**Approach:**
- Mirror `recentWikiPages.query.ts` for auth shape: `ctx.auth.tenantId ?? resolveCallerTenantId(ctx)`, reject if unresolvable, then `assertCanReadWikiScope(ctx, { tenantId, ownerId })`.
- Single query for pages: `SELECT id, type, slug, title, summary, last_compiled_at FROM wiki_pages WHERE tenant_id = $1 AND owner_id = $2 AND status = 'active'`.
- Single query for links joined against page set: `SELECT l.id, l.from_page_id, l.to_page_id FROM wiki_page_links l JOIN wiki_pages p1 ON l.from_page_id = p1.id JOIN wiki_pages p2 ON l.to_page_id = p2.id WHERE p1.tenant_id = $1 AND p1.owner_id = $2 AND p1.status = 'active' AND p2.status = 'active'`.
- Compute `edgeCount` per node as `COUNT` over `from_page_id` + `to_page_id` appearances; zero for isolated pages.
- Output nodes shape: `{ id: page.id, label: page.title, type: "page", strategy: null, entityType: page.type (ENTITY|TOPIC|DECISION), edgeCount, latestThreadId: null }` — intentionally reuses the `memoryGraph` field names so the client component can be a near-clone.
- Output edges shape: `{ source: from_page_id, target: to_page_id, label: "references", weight: 0.5 }`. Weight is a constant in v1 — no cooccurrence analog.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — tenant resolution + auth pattern.
- `packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts` — overall resolver shape + output contract.
- `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts` — raw-SQL join pattern for wiki tables.

**Test scenarios:**
- Happy path: scope has 5 pages, 6 links → resolver returns 5 nodes with correct `entityType` casing and 6 edges with correct `source`/`target`.
- Happy path: `edgeCount` counts both inbound and outbound links (a page with 2 outbound + 1 inbound has `edgeCount: 3`).
- Edge case: scope has pages but zero links → returns 5 nodes, 0 edges, no crash.
- Edge case: scope has zero pages → returns `{ nodes: [], edges: [] }`.
- Edge case: archived page is filtered out — create one active + one archived page, assert only active is returned. A link from active → archived is dropped.
- Error path: caller's tenant does not own the `ownerId` agent → `assertCanReadWikiScope` throws `Access denied`.
- Error path: `ctx.auth.tenantId` is null AND `resolveCallerTenantId` returns null → throw `"Tenant context required"`.
- Integration: write ownership — passing another agent's `ownerId` for a valid agent in the same tenant still throws (owner scope is strict, matches `recentWikiPages.query.ts` behavior).

**Verification:**
- `pnpm -C packages/api test` passes.
- Dev GraphQL introspection shows the new `wikiGraph` query and types with `AWSDateTime` / `WikiPageType` casing matching the rest of the wiki surface.
- Curling the dev endpoint with a real Google-OAuth user token returns pages for Eric's active agent (sanity against `feedback_oauth_tenant_resolver`).

---

- [ ] **Unit 2: Add `WikiGraphQuery` to admin codegen + client**

**Goal:** Admin app can call `wikiGraph` with generated types.

**Requirements:** R1, R5.

**Dependencies:** Unit 1.

**Files:**
- Modify: `apps/admin/src/lib/graphql-queries.ts` — add `WikiGraphQuery` using `graphql(...)` template
- Regenerate: `apps/admin/src/gql/*` — urql codegen output (`pnpm -C apps/admin codegen` or equivalent)

**Approach:**
- Mirror `MemoryGraphQuery`'s template shape but request `wikiGraph(tenantId: $tenantId, ownerId: $agentId)` and select `nodes { id label type strategy entityType edgeCount latestThreadId }` + `edges { source target label weight }`.
- Keep query name distinct (`WikiGraph`) so generated types don't collide with existing `MemoryGraph` operation hooks.
- No removal of `MemoryGraphQuery` in this unit — dead-code cleanup is a deferred follow-up.

**Patterns to follow:**
- `apps/admin/src/lib/graphql-queries.ts:1-45` — `AgentsListQuery` shows the `graphql(...)` template + codegen pattern.

**Test scenarios:**
- Happy path: codegen succeeds, generated types include `WikiGraphQuery`, `WikiGraphQueryVariables` with `tenantId: string; agentId: string`.
- Happy path: importing `WikiGraphQuery` in a typechecked file resolves without errors.
- Test expectation: no runtime tests — this is generated-type scaffolding. Unit 4 covers behavioral tests that use the query.

**Verification:**
- `pnpm -C apps/admin typecheck` passes.
- `apps/admin/src/gql/graphql.ts` contains a `WikiGraphQuery` document.

---

- [ ] **Unit 3: New `WikiGraph.tsx` component (near-clone of `MemoryGraph.tsx`)**

**Goal:** Drop-in force-graph component that consumes `WikiGraphQuery` and renders pages + links. Minimal visual deviation from today's admin graph so user muscle memory survives.

**Requirements:** R1, R2 (replace Hindsight-backed rendering), R3 (multi-agent fan-out), R4 (type coloring for ENTITY/TOPIC/DECISION).

**Dependencies:** Unit 2.

**Files:**
- Create: `apps/admin/src/components/WikiGraph.tsx`
- Test: `apps/admin/src/components/WikiGraph.test.tsx` (or Vitest equivalent — follow the admin app's existing test harness)

**Approach:**
- Copy the structural scaffolding from `MemoryGraph.tsx` — forwardRef handle, single-agent + multi-agent branches, multi-agent client fan-out via `useClient`, `nodeThreeObject` sphere+sprite, in-place opacity mute for `matchedIds`, one-shot camera init, collide/charge force tuning, cleanup on unmount.
- Replace the data-fetching layer: `MemoryGraphQuery` → `WikiGraphQuery`; `assistantId` variable → `{ tenantId, agentId: ownerId }`.
- Replace the color map: introduce a `PAGE_TYPE_COLORS: Record<'ENTITY'|'TOPIC'|'DECISION', string>` + default. Drop the Hindsight ontology `TYPE_COLORS` map entirely.
- Node `label` now comes straight from `page.title` (not a clipped entity name). Keep the canvas-sprite truncation cap to ~16 chars for legibility; full title is still in the tooltip.
- Multi-agent id prefixing unchanged (`${agentId}:${node.id}`). Edge references inside one agent stay consistent because edges carry page-level IDs.
- Empty-state copy: "No compiled memory pages yet — ask an agent a few questions and come back in a few minutes."
- Legend: render the three page-type swatches (Entity / Topic / Decision) with counts. Remove the "Untyped" slot.
- `getNodeWithEdges` handle shape unchanged — same `{ node, edges }` contract so the Memories page's sheet logic keeps working unmodified.

**Patterns to follow:**
- `apps/admin/src/components/MemoryGraph.tsx` — structural source of truth for the new file. Every performance/visual tweak that file carries (no camera reset on filter, no graphData rebuild on filter, sprite-material opacity for mute) is load-bearing and must be preserved (see `feedback_verify_wire_format_empirically` and the in-line comments in that file for context on why each pattern exists).

**Test scenarios:**
- Happy path: single-agent mode renders one sphere per returned page with correct type color.
- Happy path: multi-agent mode fans out queries, merges results, prefixes ids, renders all pages with no id collisions.
- Edge case: zero-node response → renders empty-state copy, not "click Dream".
- Edge case: search bar filter — matching node stays at full opacity, non-matching nodes drop to `0.15`, no camera reset during the filter change (test by asserting camera-init effect ran exactly once).
- Integration: `getNodeWithEdges(id)` returns the full `{ node, edges }` object the page-level sheet consumes; edges have correct `targetLabel`, `targetType: "page"`, and `targetId` after cross-agent id prefixing.

**Verification:**
- Admin vite dev server renders the new graph for Eric's agent scope with real compiled pages (requires recent compile on dev).
- No console errors in the browser; no regressions in `MemoryGraph.tsx`, which remains untouched in this unit.

---

- [ ] **Unit 4: Wire new graph + new detail sheet into Memories page**

**Goal:** Admin Memories → Graph tab consumes `<WikiGraph>` instead of `<MemoryGraph>`, and the graph-node sheet shows wiki-page content (summary, sections, backlinks).

**Requirements:** R1, R2, R4, R6 (clickable backlinks for in-sheet navigation).

**Dependencies:** Unit 3.

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/memory/index.tsx`
- Modify (optional, only if the sheet grows large): extract the graph-node sheet into `apps/admin/src/components/WikiPageSheet.tsx` to keep `index.tsx` legible.

**Approach:**
- Swap the import and JSX: `MemoryGraph`/`MemoryGraphHandle`/`MemoryGraphNode` → `WikiGraph`/`WikiGraphHandle`/`WikiGraphNode`.
- Drop the `hindsightEnabled` gate on the Graph toggle — it stays visible unconditionally (decision above). Keep the `memorySystemConfig` query; it still governs the list-view "Edit" / immutable-AgentCore copy.
- Rewrite the graph-node sheet body: render `graphNode.label` (= page title) in the title, `graphNode.entityType` (= page type badge), and fetch full page detail via an inline `useQuery(WikiPageQuery, { tenantId, ownerId, type: graphNode.entityType, slug: derivedSlug })`. Slug is not in the current `WikiGraphQueryNode` shape — add `slug` to Unit 1's output and Unit 2's query. Update this approach line accordingly.
- Backlinks list: use existing `WikiBacklinksQuery(pageId: graphNode.id)` and render each as a clickable row that re-anchors the sheet via `graphRef.current?.getNodeWithEdges(backlinkId)`, pushing history the same way the current sheet already does.
- Sections: render as collapsible `<details>` blocks with heading + markdown body (no need for full markdown-it / react-markdown — the existing admin memory sheet already uses `whitespace-pre-wrap`; start there and upgrade if it looks rough).
- Remove the "View source thread" link path in the graph sheet (wiki pages don't carry a `latestThreadId` in v1 — that was a Hindsight-entity concept).

**Patterns to follow:**
- Existing graph-node sheet logic in `apps/admin/src/routes/_authed/_tenant/memory/index.tsx:648-749` — history stack, "back" arrow, edge click-through, badge color logic.
- `apps/mobile/app/wiki/[type]/[slug].tsx` — admin does not need Markdown rendering parity with mobile, but the data fetching shape (`useWikiPage` + `useWikiBacklinks` composition) is the reference.

**Test scenarios:**
- Happy path: switching the toggle to Graph shows the new component, not the old one.
- Happy path: clicking a page node opens the sheet, fetches full page, renders title + type badge + summary + sections + backlinks.
- Happy path: clicking a backlink re-anchors the sheet to that page, pushes history, and the back arrow returns.
- Edge case: agent has compiled pages but no `[[...]]` links between them yet → graph renders isolated nodes, sheet still works.
- Edge case: zero-node scope → graph shows empty-state copy; toggle is still usable.
- Edge case: All Agents mode with pages spread across agents → sheet correctly resolves `(tenantId, ownerId)` for the clicked node's owning agent (use the `<agentId>:` prefix pattern), so `wikiPage` fetches succeed.
- Integration: search input filters the graph nodes by title substring (existing behavior), does not reset the camera.
- Regression: Memories list tab is unchanged — editing a memory record in the list sheet still works against the Hindsight mutation path.

**Verification:**
- Manual dev walkthrough end-to-end: Memories → Graph → click a node → read page → click a backlink → back arrow → swap agent → re-check.
- Network tab shows `WikiGraphQuery` + `WikiPageQuery` + `WikiBacklinksQuery` and no `MemoryGraphQuery` calls while on the Graph tab.

---

- [ ] **Unit 5: Deprecation breadcrumbs + follow-up ticket**

**Goal:** Make the now-unused code easy to remove later without breaking anything in this PR.

**Requirements:** (scope hygiene)

**Dependencies:** Unit 4.

**Files:**
- Modify: `packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts` — add a `@deprecated` doc comment at the top noting it is no longer called by any app, with a pointer to this plan.
- Modify: `apps/admin/src/components/MemoryGraph.tsx` — add a one-line deprecation comment at the top pointing at `WikiGraph.tsx`.
- Create: one-line entry in `docs/followups/` (if that convention exists) or a GitHub issue, capturing the deletion follow-up.

**Approach:**
- No code behavior change. Strictly comments + tracking.
- Verify (via grep) that no other app/package imports `MemoryGraphQuery` or `MemoryGraph` before marking deprecated. If anything unexpected shows up, surface it — don't silently leave it.

**Test scenarios:**
- Test expectation: none — pure annotation change.

**Verification:**
- `rg -n "MemoryGraphQuery\|MemoryGraph" apps packages` shows only the deprecated files plus the admin-app cleanup pointers.

## System-Wide Impact

- **Interaction graph:** the new resolver only reads `wiki_pages` and `wiki_page_links`. It does not enqueue compile jobs, touch Hindsight, or run any Bedrock call. Safe to invoke from any admin user in any tenant. No observable impact on the compile pipeline, `memory-retain`, `wiki-compile`, or `wiki-lint`.
- **Error propagation:** auth failures raise from `assertCanReadWikiScope`. Tenant-missing → explicit `"Tenant context required"` error. Database errors bubble up as GraphQL errors; the admin graph already handles empty data gracefully, so a failed query just renders the empty state + a toast (existing urql error handling).
- **State lifecycle risks:** none — the resolver is read-only, the admin component holds no local persistence, and there is no write path in v1.
- **API surface parity:** no breaking change. The new query is additive. `memoryGraph` keeps working until Unit 5's follow-up deletes it.
- **Integration coverage:** the graph-node detail sheet sits across three queries (`wikiGraph`, `wikiPage`, `wikiBacklinks`). Unit 4's integration scenarios (All Agents mode, backlink click-through) are the primary guard against the sheet going out of sync with the graph.
- **Unchanged invariants:** the compile pipeline, wiki read-auth rules, Hindsight memory-record read/write paths, and the existing admin Memories list view are explicitly untouched. This plan only swaps the Graph tab's data source.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Compiled-wiki tenants have very few pages/links in v1, so the graph looks empty for some users | Keep the Graph toggle visible unconditionally; render an informative empty state; expectation-set in the copy that this is a compounded view that grows over time |
| `WikiPageQuery` fires per-sheet-open and adds a round-trip to the click → details interaction | Acceptable for v1 (matches mobile's shape). Revisit if click-to-detail feels slow; server-side pre-population of sections in `wikiGraph` is a plausible v1.1 optimization |
| Backlink click-through (`getNodeWithEdges(backlinkId)`) can fail if the backlink target is on a different agent in All Agents mode (node ids are prefixed with `<agentId>:`) | The backlink row carries the target's raw `page.id`; before handing it to `getNodeWithEdges`, the sheet must reconstruct the prefixed id using the current context agent. Unit 4's "All Agents backlink click-through" scenario guards this |
| Multi-agent fan-out amplifies load: `wikiGraph` × N agents per render | Limit to active agents in scope (same as current `MemoryGraph`). Server-side aggregation across agents is a plausible follow-up but not a v1 blocker |
| Running admin locally on a worktree hits `redirect_mismatch` on Cognito | Ensure the worktree's vite port is present in `ThinkworkAdmin` CallbackURLs before starting verification (memory: `project_admin_worktree_cognito_callbacks`) |
| Landing this in the main checkout conflicts with the compounding-memory refinement stream | Do the work in `.claude/worktrees/admin-wiki-graph/` off `origin/main` (memory: `feedback_worktree_isolation`) |

## Documentation / Operational Notes

- No operator runbook changes. The resolver is read-only, uses existing indexes (`uq_wiki_pages_tenant_owner_type_slug`, `idx_wiki_pages_tenant_owner_type_status`, `idx_wiki_page_links_to`) — no new migration required.
- Admin release notes: "Memories → Graph now renders compiled wiki pages with `[[links]]` instead of raw Hindsight entities. Click a node to see the page summary, sections, and backlinks."
- No Terraform changes.
- No feature-flag required — the existing compile pipeline already feature-gates content creation, and an empty scope renders an informative empty state.

## Sources & References

- Related code:
  - `apps/admin/src/routes/_authed/_tenant/memory/index.tsx` (current Memories page)
  - `apps/admin/src/components/MemoryGraph.tsx` (pattern source)
  - `packages/api/src/graphql/resolvers/memory/memoryGraph.query.ts` (deprecated path)
  - `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` (auth pattern)
  - `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts` (raw-SQL wiki pattern)
  - `packages/database-pg/src/schema/wiki.ts` (tables)
  - `packages/database-pg/graphql/types/wiki.graphql` (schema home)
- Related PRs/plans:
  - `docs/plans/archived/wiki-compiler-memory-layer.md` — architectural anchor
  - `docs/plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md` — superseded; aggregation plan covers provenance surfaces
  - `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` — sibling work on compounding loop; this plan's graph tab will visibly benefit once hierarchical aggregation lands
