---
title: "feat: Mobile wiki graph neighbor ring on filter"
type: feat
status: active
date: 2026-04-20
origin: docs/plans/2026-04-20-003-feat-admin-wiki-graph-neighbor-ring-plan.md
---

# feat: Mobile wiki graph neighbor ring on filter

## Overview

Mirror the admin wiki graph filter UX on the mobile app. Today, `WikiGraphView` computes a `dimmedNodeIds` set (nodes whose label doesn't include the search term) and `GraphCanvas` renders those at 15% opacity while edges stay near-full opacity — same orphaned-edge problem as admin. This plan introduces a 3-state partition (matched / 1-hop neighbor / hidden), gives neighbors a colored outline ring (reusing the existing selection-ring pattern at `apps/mobile/components/wiki/graph/GraphCanvas.tsx:128-137`), hides non-neighbor unmatched nodes, and hides any edge that doesn't touch a match. Node spacing is loosened in the default sim config.

## Problem Frame

The mobile wiki graph renders with `@shopify/react-native-skia`. `WikiGraphView` (`apps/mobile/components/wiki/graph/WikiGraphView.tsx`) hosts the search filter and passes `dimmedNodeIds` down through `KnowledgeGraph` to `GraphCanvas`. `GraphCanvas` already supports:
- Per-node dim via `opacity` prop on a Skia `Circle`.
- Edge dim when *both* endpoints are dimmed (stronger than admin's original behavior).
- A stroked selection ring using `style="stroke"` in the node's type color — the exact visual treatment we want for the neighbor ring.

Gaps:
1. The dim state is binary; there's no "1-hop neighbor" notion — search collapses everything unmatched into a single faded set.
2. Edges to lone-match endpoints still render at near-full opacity (`edgeDimmed` is true only when *both* sides are dimmed), producing orphaned edges when the match has any unmatched neighbors.
3. The sim defaults (`chargeStrength: -80`, `linkDistance: 40`, `collideRadius: 18`) jam dense agent graphs together on small mobile canvases.

## Requirements Trace

- R1. When the search query is active, render matched nodes at full color with their existing node radius.
- R2. When the search query is active, render 1-hop neighbors at 15% fill opacity with a stroked outline ring in their `pageType` color.
- R3. When the search query is active, hide nodes that are neither matched nor 1-hop neighbors.
- R4. When the search query is active, render an edge only when at least one endpoint is in the matched set. Otherwise skip rendering the `<Line>` entirely.
- R5. When no search query is active, rendering is identical to today — all nodes full color, all edges visible.
- R6. Preserve the no-restart invariants around camera, position cache, and the reveal animation: filter changes must not re-trigger the reveal, reset the camera, or restart the force sim.
- R7. Loosen the default sim spacing so adjacent nodes no longer visually overlap on a phone-sized canvas.

## Scope Boundaries

- Mobile wiki graph only. Admin's `apps/admin/src/components/WikiGraph.tsx` already has the equivalent treatment shipped on the `feat/admin-wiki-graph-neighbor-ring` worktree branch and is out of scope here.
- No change to the GraphQL schema or `useWikiGraph` SDK hook.
- No change to the search-bar UI (lives outside `WikiGraphView`).
- No change to `WikiDetailSubgraph`, `NodeDetailModal`, or the 1-hop-detail flow — the detail subgraph is already filtered upstream and doesn't render a filter-time partition.

### Deferred to Separate Tasks

- Type-filter UI for the mobile wiki graph (mirrors admin's `typeFilter` prop that doesn't have a picker yet): out of scope.
- Carry-forward to the mobile `WikiDetailSubgraph` view: defer until user asks.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/components/wiki/graph/WikiGraphView.tsx:127-135` — the current `dimmedNodeIds` memo. This is where classification moves to.
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx:27` — `dimmedNodeIds?: Set<string>` prop flowing through. The prop becomes a classification object; the signature gets one extra field (`classification`).
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx:128-137` — selection ring precedent: a stroked `<Circle>` at `r + SELECTION_RING_OFFSET` in the node's type color. Neighbor ring reuses this exact pattern.
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx:86-113` — edge rendering loop. Today uses `edgeDimmed = both-dimmed`; becomes `return null` when neither endpoint is matched.
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx:114-127` — node rendering loop. Today uses `isDimmed` → opacity 0.15; becomes three-state (render + match-opacity / render + neighbor-opacity + outline / skip).
- `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts:48-53` — sim defaults. The spacing bump lives here.
- `apps/mobile/components/wiki/graph/layout/neighborhood.ts` — `oneHopNeighborhood` already exists for detail subgraph use; shares the same 1-hop-reachable concept but filters the payload upstream. Not reused directly (the classification lives on the full graph, not on a narrowed payload) but validates the mental model.
- `apps/mobile/components/wiki/graph/layout/typeStyle.ts` — `getNodeColor(pageType, scheme)` already returns the right stroke color for each type.

### Institutional Learnings

- The mobile graph uses `prevInternalRef` + `graphStateCache` to carry positions through urql re-emits (`WikiGraphView.tsx:78-113`). Filter changes must not touch `internalSubgraph`'s identity, or positions will snap back and the reveal animation will replay. Classification is derived state; it must not be folded into the subgraph object.
- `KnowledgeGraph` gates the reveal on a mount-only `hasRevealedRef` (line 160). Anything that changes `subgraph` identity could re-trigger the reveal. Classification updates must stay isolated from the subgraph memo.
- `useForceSimulation` re-initializes the sim when `linkDistance/chargeStrength/collideRadius` change (dep array at line 112). Bumping the defaults is safe because it's a one-time value change; changing them at filter-time would restart the sim. We keep the values static.

### External References

- None needed; the design mirrors the admin plan and the relevant patterns already exist on mobile.

## Key Technical Decisions

- **Classification lives in `WikiGraphView`, not `KnowledgeGraph` or `GraphCanvas`.** The search query is already owned at the view level; keeping classification there means `KnowledgeGraph` stays render-agnostic (it just forwards the prop).
- **Pass a `classification` prop instead of a naked `Set<string>`.** Shape: `{ matchedIds: Set<string>; neighborIds: Set<string> } | null`. `null` means no filter active. Keeps the two sets bundled so render sites don't have to recompute or plumb both.
- **Keep `dimmedNodeIds` removed cleanly rather than double-plumbing.** Mobile has no other consumer of the prop (grep confirmed 5 hits, all within this feature). Replace the prop outright.
- **Neighbor ring = stroked `<Circle>` at `nodeRadius + NEIGHBOR_RING_OFFSET` in `getNodeColor(pageType, scheme)`.** Same pattern as the selection ring; share the `SELECTION_RING_OFFSET` constant or define a parallel `NEIGHBOR_RING_OFFSET` (default 2px — slightly tighter than selection's 4px so a node that's both selected and a neighbor shows both rings distinctly).
- **Sim spacing bump is static in `useForceSimulation` defaults**, not dynamic on filter. Rationale: sim restart would ripple through the camera reveal and position cache. Static bump keeps the existing lifecycle intact.
- **Spacing numbers for mobile are smaller than admin's** because the canvas is ~1/3 the size: `chargeStrength: -130` (was -80), `linkDistance: 60` (was 40), `collideRadius: 22` (was 18). Tune during implementation.

## Open Questions

### Resolved During Planning

- *Scope of the muted + outline treatment:* 1-hop neighbors only, non-neighbor unmatched hidden (same as admin; user already confirmed on admin and the mobile ask is "port the same UX").
- *Neighbor node size:* same radius as today (uniform `getNodeRadius()` = 14).
- *Type filter support:* mobile doesn't have a type-filter UI; only `searchQuery` drives classification for now.

### Deferred to Implementation

- Ring offset tuning against the denser mobile canvas. Admin used a large radius with a 20% scale bump; mobile uses a uniform 14px radius, so a 2-3px offset is probably right — final value picked visually.
- Whether the selection ring should render on top of the neighbor ring when the selected node is also a neighbor. Default: selection ring wins (drawn last); neighbor ring still visible around the selection since the selection ring is offset by +4px and neighbor by +2px.

## Implementation Units

- [ ] **Unit 1: Compute classification in `WikiGraphView`**

**Goal:** Replace `dimmedNodeIds` with a 3-state classification object derived from `searchQuery` + subgraph edges.

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `apps/mobile/components/wiki/graph/WikiGraphView.tsx`

**Approach:**
- Remove the `dimmedNodeIds` memo (line 127-135).
- Add a `classification` memo that returns `null` when the search query is empty, otherwise `{ matchedIds: Set<string>; neighborIds: Set<string> }`.
- `matchedIds` = nodes whose label (case-insensitive, trimmed) includes the query substring — mirrors today's dimming predicate, inverted.
- `neighborIds` = for each edge in `internalSubgraph.edges`, the unmatched endpoint when the other endpoint is matched.
- Endpoints can be strings or `WikiGraphNode` objects depending on whether d3 has resolved them (see `GraphCanvas.tsx:87-90` for the same guard pattern). Handle both.
- Pass `classification` down to `<KnowledgeGraph />` instead of `dimmedNodeIds`.

**Patterns to follow:**
- Endpoint-resolution pattern at `GraphCanvas.tsx:87-90` (`typeof e.source === "string" ? ... : ...`).
- Memo dependency shape at `WikiGraphView.tsx:127-135` — keep `[searchQuery, internalSubgraph]` as deps.

**Test scenarios:**
- Happy path: search for a term that matches one node with two linked pages — `matchedIds.size === 1`, `neighborIds.size === 2`, no other nodes classified.
- Edge case: search matches nothing — `matchedIds` is empty, `neighborIds` is empty, classification is non-null → every node hides, every edge hides. Graph looks empty. Acceptable: `NodeDetailModal` isn't involved, no UI blows up.
- Edge case: search matches every node — `matchedIds` contains all ids, `neighborIds` is empty, every node renders full color (no neighbors to show). Same as no-filter visually, which is fine.
- Edge case: empty or whitespace-only query — classification is `null` (same shape as pre-refactor "no filter").
- Integration: typing into the footer search box updates classification without restarting the sim or resetting the camera. The reveal animation must not replay (`hasRevealedRef` stays true).

**Verification:**
- In the running Expo session, search for a known page title. The match renders bright, the directly-linked pages render dimmed-with-outline, the rest vanish. Type more characters — no reveal flash, no camera jump.

- [ ] **Unit 2: Thread `classification` through `KnowledgeGraph`**

**Goal:** Replace the `dimmedNodeIds` prop with `classification`, pass-through only. No rendering change in this component.

**Requirements:** R1–R4

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx`

**Approach:**
- Rename the `dimmedNodeIds?: Set<string>` prop to `classification?: { matchedIds: Set<string>; neighborIds: Set<string> } | null`.
- Forward it unchanged to `<GraphCanvas />`.
- Update the prop-level docstring (line 23-26) to describe the new shape.
- No touching of the sim, camera, reveal, or cache logic.

**Patterns to follow:**
- Existing `dimmedNodeIds` plumbing in this component — same shape, new name.

**Test scenarios:**
- Pass-through: with classification passed from the view, `GraphCanvas` receives it intact.
- No regression: when called from `WikiDetailSubgraph` (which doesn't currently pass `dimmedNodeIds`), the classification prop defaults to `undefined` and everything renders as today.

**Verification:**
- Mobile wiki detail subgraph (opened from a wiki page) renders identically — no classification prop, no filter UI, full color.

- [ ] **Unit 3: Render 3-state in `GraphCanvas`**

**Goal:** Edges render only when at least one endpoint is matched. Nodes render per classification state: matched (full color), neighbor (dim fill + colored outline ring), hidden (skip).

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** Unit 2

**Files:**
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx`

**Approach:**
- Replace the `dimmedNodeIds?: Set<string>` prop with `classification?: { matchedIds: Set<string>; neighborIds: Set<string> } | null`.
- Define a `NEIGHBOR_RING_OFFSET` constant (start at 2; tune visually).
- Define a small inline `classifyNode(id, c)` helper (or local `type NodeVisualState = "matched" | "neighbor" | "hidden"` returned from a switch) — same shape as the admin helper.
- Edge loop (line 86-113): resolve both endpoint ids; when classification is non-null, skip the entire `<Line>` if neither endpoint is in `matchedIds`. Drop the old `edgeDimmed` logic.
- Node loop (line 114-127): switch on state. For "hidden" return `null`. For "neighbor" render a full-opacity `<Circle>` at `opacity={DIM_OPACITY}` **plus** a sibling `<Circle>` at `r + NEIGHBOR_RING_OFFSET` with `style="stroke"`, `strokeWidth={1.5}`, color `getNodeColor(pageType, scheme)`, full opacity. For "matched" render the existing full-opacity circle.
- Selection ring (line 128-137): leave unchanged — it renders on top by virtue of being later in the tree, so it still shows correctly whether the selection is matched or a neighbor.
- Labels loop (line 138-155): already guards on `dimmedNodeIds`; update to render labels only for "matched" nodes when classification is non-null.

**Patterns to follow:**
- Selection-ring block at `GraphCanvas.tsx:128-137` — same stroked-circle pattern for the neighbor ring.
- Existing node-map structure at line 114-127 — preserve it; add the second `<Circle>` for neighbors as a `<>...</>` fragment or by rendering an array.

**Test scenarios:**
- Happy path: one matched node + two neighbors + many hidden — screen shows one bright circle, two dim circles with colored rings, no other circles. Edges present only between the matched and the neighbors.
- Edge case: classification is `null` — all circles render full color, all edges render, labels render as configured. Matches today exactly.
- Edge case: a node is both matched and the selected node — selection ring (offset +4) renders on top of the matched node with no neighbor ring (since state is "matched").
- Edge case: a node is a neighbor and also the selected node — neighbor ring at +2 and selection ring at +4, both visible, stacked.
- Edge case: classification is empty-on-both-sides (no-match search) — every node and edge skips → blank canvas. Confirm Skia doesn't error on an empty `<Group>`.
- Integration: swipes and pinches still work on hidden nodes? No — `hitTest` (`layout/hitTest.ts`) already iterates `subgraph.nodes` (not classification). Hidden nodes would still be tappable. Option A: filter hidden nodes out of the hit-test. Option B: don't bother (they're invisible; user won't try to tap them). Pick A for the cleaner UX — update `KnowledgeGraph.handleTap` to pass an adjusted node list. Track as an Open Question deferred to implementation (see below).

**Verification:**
- Visual check on iOS simulator: search matches one page in a dense tenant graph. Bright match, outlined neighbors, rest gone, no orphaned edges.

- [ ] **Unit 4: Skip hidden nodes in tap hit-testing**

**Goal:** Hidden nodes aren't tappable. Avoids ghost-taps when the user aims at blank canvas and happens to hit an invisible node.

**Requirements:** R3 (implicit — "hidden" should be fully hidden, including interaction).

**Dependencies:** Unit 3

**Files:**
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx`

**Approach:**
- Thread `classification` into `handleTap` so hit-test can filter to renderable nodes.
- Pass a filtered node list to `nearestNode` (`layout/hitTest.ts`) when classification is non-null: include matched + neighbors; exclude hidden.
- When classification is `null`, pass all nodes (today's behavior).
- Don't modify `hitTest.ts` itself — the contract is a node list.

**Patterns to follow:**
- The existing `handleTap` uses `subgraph.nodes`; just filter before handing off.

**Test scenarios:**
- Happy path: with a filter active, tapping empty space where a hidden node used to sit does not open a modal.
- Happy path: tapping a matched or neighbor node opens its `NodeDetailModal` as today.
- Edge case: no filter — hit-test reaches every node as today.

**Verification:**
- With a search active in the simulator, tap an area that visibly has no circles. No modal opens.

- [ ] **Unit 5: Loosen sim spacing defaults**

**Goal:** Give the mobile graph breathing room so individual pages are tappable in dense clusters.

**Requirements:** R7

**Dependencies:** None (can land independently of Units 1–4)

**Files:**
- Modify: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts`

**Approach:**
- Current defaults at line 48-53: `linkDistance: 40`, `chargeStrength: -80`, `collideRadius: 18`.
- New defaults (tune visually during implementation): `linkDistance: 60`, `chargeStrength: -130`, `collideRadius: 22`.
- Leave `xyStrength: 0.08` as-is — it's the drift-containment force and doesn't need to change.
- Do not change per-call `simConfig` overrides (e.g. `WikiDetailSubgraph` passes its own larger values); those win.

**Patterns to follow:**
- Existing default-vs-override destructure at line 48-53 — same shape, new numbers.

**Test scenarios:**
- Happy path (dense tenant): individual nodes are visually distinct in the densest cluster; no two nodes appear to merge.
- Edge case (sparse tenant, <20 nodes): layout doesn't fly apart so far that `computeFit` zooms way out. If it does, tighten only the `< 50` equivalent — except this hook doesn't branch on node count, so keep defaults tame and rely on `xyStrength` to contain sparse graphs. Revisit only if visual check shows fly-apart.
- Integration: `WikiDetailSubgraph`'s custom `simConfig` still overrides (confirm by opening a detail-screen embed and checking it still feels right).

**Verification:**
- On a ~100-node tenant, nodes in the densest cluster are individually pickable with a single thumb tap.

## System-Wide Impact

- **Interaction graph:** Purely presentational + a tiny hit-test filter. No GraphQL, no SDK, no navigation, no modal change.
- **Error propagation:** Classification is defensive against null/empty search queries and missing edges. `GraphCanvas` already handles `x == null || y == null` for pre-settle ticks.
- **State lifecycle risks:**
  - `internalSubgraph` identity MUST NOT depend on classification. Keep the memos separate. A filter change should never invalidate the positions cache.
  - `useForceSimulation`'s deps array includes the sim config values — keep them static between renders so a filter change doesn't restart the sim.
  - `hasRevealedRef` must stay true across filter changes — verify no code path sets it back to false.
- **API surface parity:** `KnowledgeGraph` is called by `WikiGraphView` (now with classification) and `WikiDetailSubgraph` (no classification). Both paths must still work; default-undefined classification preserves detail-subgraph behavior.
- **Integration coverage:** Mobile has a Jest harness in `apps/mobile/__tests__/` but `graph/` is largely untested today. Visual verification on the iOS simulator is the coverage mechanism.
- **Unchanged invariants:**
  - `graphStateCache` positions/camera persist as today.
  - Reveal animation and `FIT_START_SCALE_MULT` untouched.
  - `NodeDetailModal` contract untouched.
  - `WikiDetailSubgraph` (the 1-hop detail view) gets no classification and renders identically.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The second `<Circle>` for the neighbor ring doubles the Skia draw call count for neighbor nodes. On a ~100-node tenant with ~20 neighbors, that's +20 calls — negligible. If it ever matters, collapse into a single radial-gradient circle with a painted ring, but don't preoptimize. | Profile only if frame drops show up on the iOS simulator during filter typing. |
| Sim-default bump (Unit 5) re-initializes the sim when hot-reload picks up the file change during dev, causing a visible "graph jump" on the reload. This is dev-only; cold production starts are unaffected. | Accept the dev-only flicker. |
| `WikiDetailSubgraph` already overrides `simConfig` with larger numbers for a sparse 1-hop layout — the new defaults must stay smaller than its overrides so detail views don't get over-spaced. | `WikiDetailSubgraph` uses roughly `linkDistance: 80 / chargeStrength: -200 / collideRadius: 28` (or similar — confirm during implementation). New defaults (60/-130/22) stay below. |
| Empty-match search produces a blank canvas with no messaging. User may think the graph broke. | Acceptable for v1 — the search input visibly contains the query, and the wiki list view already handles "no results" copy. Revisit if users report confusion. |

## Documentation / Operational Notes

- No docs to update; mobile README doesn't describe the graph filter UX.
- File-level comment on `GraphCanvas.tsx` (currently minimal) can gain a one-paragraph note mirroring the admin file's invariant: "classification = null → render everything; classification non-null → matched full color, neighbors dim+ring, hidden skipped; edges follow."

## Sources & References

- Related plan: `docs/plans/2026-04-20-003-feat-admin-wiki-graph-neighbor-ring-plan.md` (admin equivalent).
- Related code: `apps/mobile/components/wiki/graph/*`, `apps/mobile/lib/theme.ts`.
- Related PRs: #298 (3-way view cycle), #301 (background refetch) — recent mobile graph work.
