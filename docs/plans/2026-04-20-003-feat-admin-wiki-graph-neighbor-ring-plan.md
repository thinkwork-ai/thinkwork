---
title: "feat: Admin wiki graph neighbor ring on filter"
type: feat
status: active
date: 2026-04-20
---

# feat: Admin wiki graph neighbor ring on filter

## Overview

When the user filters the admin Wiki graph (search box or — in the future — a type filter), matched nodes stay full-color but every non-matching node mutes to `opacity 0.15`. Edges, however, render at a static `rgba(255,255,255,0.7)` regardless of filter state. The visual result is bright edges flying off into near-invisible bubbles — the "orphaned edges" the user called out. This plan changes the filter presentation so a filter produces a **match set + 1-hop context ring**: matches render at full color, their direct neighbors render as muted fill with a colored outline (so the reader can see *what* the match is linked to and what *type* that neighbor is), and everything else — plus any edge that touches only non-context nodes — is hidden.

## Problem Frame

The admin Wiki Graph view at `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx` embeds `WikiGraph` (`apps/admin/src/components/WikiGraph.tsx`). `WikiGraph` already computes a `matchedIds` set when a filter is active and mutes unmatched node materials in-place (`__sphereMat.opacity`, `__spriteMat.opacity` at 0.15) — a deliberate pattern that avoids restarting the d3 simulation or the camera on every keystroke (see the header comment and the effect at `WikiGraph.tsx:375-383`).

Two gaps produce the current feel:

1. **Edges are not filter-aware.** `linkColor`, `linkWidth`, and `linkDirectionalArrowColor` are all constant lambdas. Muted nodes disappear but the edges to them stay bright, reading as orphaned edges pointing at nothing.
2. **Muted nodes lose identity.** At `opacity 0.15` the sphere fill is too faint to communicate type. The user still wants to see that a match is linked to an `Entity` / `Topic` / `Decision`, just not compete with the matches for attention.

## Requirements Trace

- R1. When a filter is active, render matched nodes at full color.
- R2. When a filter is active, render every node that is one hop from a matched node with muted fill + a colored outline in its `PAGE_TYPE_FORCE_COLORS` color.
- R3. When a filter is active, hide nodes that are neither matched nor 1-hop neighbors.
- R4. When a filter is active, show an edge only when at least one endpoint is in the matched set; hide edges whose endpoints are both outside the match set (neighbor-to-neighbor or hidden-to-hidden).
- R5. When no filter is active, the graph renders identically to today — full color on every node, every edge visible.
- R6. Preserve the no-restart invariant: a filter change must not rebuild `graphData`, restart the d3 simulation, or re-run the one-shot camera init.
- R7. Space nodes further apart so adjacent spheres don't visually overlap in dense clusters — the current layout jams ~200 nodes into tight clumps where individual pages become hard to pick out.

## Scope Boundaries

- WikiGraph only. `MemoryGraph.tsx` is a near-clone but out of scope for this change — the user asked specifically about `Home → Wiki → Filter`.
- No change to the GraphQL schema, resolvers, or the `wikiGraph` query shape.
- No change to the filter UI in the page route (search box at `wiki/index.tsx:343-363`). This is a rendering change inside `WikiGraph`.
- No change to the detail sheet, re-anchoring history, or node-click behavior.
- Matched-node size remains degree-based; neighbor (muted) nodes keep their degree-based radius (confirmed with user).

### Deferred to Separate Tasks

- Applying the same neighbor-ring pattern to `MemoryGraph.tsx`: defer until the user asks.
- A type-filter UI for the Wiki graph (the component already accepts `typeFilter` but the page doesn't render a picker today): out of scope here.

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/WikiGraph.tsx`
  - `matchedIds` memo at line 228 — already computes the match set from `typeFilter` + `searchQuery`.
  - `graphData` memo at line 249 — deliberately does **not** depend on filter state; this is load-bearing for the no-restart invariant.
  - `nodeThreeObject` at line 318 — stable `useCallback` with empty deps; reads `matchedIdsRef.current` to decide initial opacity. Stashes `__sphereMat` / `__spriteMat` on each node.
  - In-place mute effect at line 375 — mutates stashed materials when `matchedIds` changes; calls `fgRef.current?.refresh?.()`.
  - Link renderers at lines 467-471 — all static lambdas today.
- `apps/admin/src/lib/wiki-palette.ts` — `PAGE_TYPE_FORCE_COLORS` is already the source of truth for sphere + legend colors; reuse it for the outline.
- `apps/admin/src/components/MemoryGraph.tsx:417-418` — precedent for filter-agnostic link-variant styling (unlabeled edges already render dimmer/thinner there). Same mechanism — arrow-function `linkColor` / `linkWidth` — is what we'll extend.

### Institutional Learnings

- The in-place opacity-mutation pattern exists because an earlier version reset the camera and restarted d3 on every filter keystroke. The file comment at `WikiGraph.tsx:6-10` is explicit: *"Do not 'clean up' those without measuring."* Any new ring material must be stashed on the node and toggled in-place, not injected by rebuilding `graphData`.
- `nodeThreeObject` is called once per node (when the node is first materialized), not per frame. `linkColor` / `linkWidth` / `linkVisibility` are called per render. So per-node state (matched / neighbor / hidden) needs to live on stashed material refs; per-link state can be derived live from a ref to the current sets.

### External References

- [react-force-graph-3d docs](https://github.com/vasturiano/react-force-graph) — `linkVisibility: (link) => boolean` hides a link cleanly without manipulating geometry; preferred over returning transparent color for the "hide this edge" case.

## Key Technical Decisions

- **Neighbor set derives from `matchedIds` + `graphData.links`, not from a resolver change.** The graph already returns all of an agent's pages and their edges; a 1-hop context ring is just a client-side set derivation. No backend work.
- **"Hidden" means `opacity: 0` on the existing sphere + sprite materials, plus `linkVisibility` returning `false` on the edge.** This preserves the stashed-material mutation pattern — we don't add or remove nodes from `graphData`. The force simulation still sees those nodes so the layout stays stable when filters change.
- **The colored outline is a new material stashed on the node as `__ringMat`, implemented as a `THREE.Sprite` whose canvas paints a stroked-only circle in `PAGE_TYPE_FORCE_COLORS[entityType]`.** Rationale: the graph already uses a canvas-sprite for the text label, so the pattern and lifecycle are well-understood. A sprite always faces the camera, which is what we want for an outline ring; a `RingGeometry` would need camera-billboarding. Ring opacity is toggled the same way as the label/sphere opacity — in the filter-change effect.
- **Ring radius slightly larger than the sphere radius (e.g., `r * 1.15`) so it reads as an outline around the sphere, not a sphere-sized ring that competes with it.** Matched and hidden nodes render the ring at opacity 0; only neighbor nodes show it.
- **A single classification pass per filter change computes each node's state as `"matched" | "neighbor" | "hidden"` and an edge's state as `"visible" | "hidden"`**. This is the one-place-of-truth the in-place mutation effect and `linkVisibility` both read from, so we don't duplicate the "is this node in the context ring" logic in multiple lambdas.

## Open Questions

### Resolved During Planning

- *Scope of the muted + outline treatment:* 1-hop neighbors only; non-neighbor unmatched nodes are hidden entirely (confirmed with user).
- *Neighbor node size:* same degree-based radius as today — no shrink (confirmed with user).
- *MemoryGraph parity:* out of scope; not requested.

### Deferred to Implementation

- Exact ring stroke width and any anti-aliasing padding on the canvas sprite — tune visually against the live graph during implementation.
- Whether the neighbor node's *label sprite* should be fully muted (opacity 0.15) or slightly brighter (e.g., 0.35) so the title stays readable when it's the endpoint the user is trying to trace. Default to 0.15 to match today's muted feel; revisit if the outline makes the label look crowded.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Three-state node classification drives everything:

```
filter active?
├── no  → every node = "matched" state (full color, ring hidden)
│        every edge visible
└── yes → matchedIds       = matchedIds memo (today's logic, unchanged)
          neighborIds      = nodes connected to a matched node by ≥1 edge,
                             minus matchedIds itself
          hiddenIds        = allNodes - matchedIds - neighborIds

          per-node opacity/material state:
            matched  : sphere=1.0  label=1.0  ring=0.0
            neighbor : sphere=0.15 label=0.15 ring=1.0  (ring color = type color)
            hidden   : sphere=0.0  label=0.0  ring=0.0

          per-edge visibility (linkVisibility):
            source ∈ matched OR target ∈ matched  → true
            otherwise                              → false
```

The classification is computed once per filter change inside a memo, stashed on a ref, and read by both (a) the in-place mutation effect that tweaks stashed materials and (b) the `linkVisibility` / `linkColor` / `linkWidth` lambdas.

The force simulation still sees every node and every edge. Hidden nodes contribute to the layout but don't render; this keeps neighbor positions stable when the user toggles filters, avoiding the "graph dances on every keystroke" feel.

## Implementation Units

- [ ] **Unit 1: Derive neighbor and hidden sets from the existing match set**

**Goal:** Produce a single classification structure the renderer can read without duplicating "is this node a neighbor" logic in multiple lambdas.

**Requirements:** R1, R2, R3, R6

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/components/WikiGraph.tsx`

**Approach:**
- Add a `useMemo` (call it `classification`) next to the existing `matchedIds` memo at around line 244.
- When `matchedIds` is `null` (no filter active), return `null` — the renderer interprets `null` as "everything matched".
- When `matchedIds` is non-null: walk `graphData.links`, build `neighborIds` as the set of non-matched endpoints of any edge where the other endpoint is matched. Union = `matchedIds ∪ neighborIds`; hidden = complement.
- Output shape: `{ matchedIds: Set<string>, neighborIds: Set<string> }` (`hidden` is derived as `!matched && !neighbor` so we don't carry a third set).
- Stash on a ref (`classificationRef`) so the per-frame link lambdas and `nodeThreeObject`'s closure can read it without becoming filter-dependent. Mirrors the existing `matchedIdsRef` pattern at line 291.

**Patterns to follow:**
- `matchedIdsRef` at `WikiGraph.tsx:291-292` — exact precedent for the mutable-ref-next-to-memo pattern.

**Test scenarios:**
- Happy path: filter matches one node connected to two pages — `neighborIds` has exactly those two page ids; `hidden` set includes all others.
- Edge case: filter matches a node with zero edges — `neighborIds` is empty; the match renders alone and every other node hides.
- Edge case: filter matches every node (e.g., search matches all labels) — `neighborIds` is empty because every neighbor is already matched; no node is hidden.
- Edge case: `matchedIds` is `null` (no filter) — classification returns `null`; renderers treat every node as matched.
- Integration: flipping from filter-active to no-filter must trigger the in-place effect once and leave the `graphData` identity untouched (the d3 simulation must not restart — observable as the force layout not "bouncing").

**Verification:**
- Manually trigger a search that matches one known node and confirm via React DevTools that `classification.neighborIds` contains exactly the ids that appear as edge endpoints of the match.

- [ ] **Unit 2: Stash a colored-outline ring material on every node and toggle it in-place on filter change**

**Goal:** Make the "muted fill + colored outline" state reachable by mutating stashed materials, matching the existing no-restart pattern.

**Requirements:** R2, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/admin/src/components/WikiGraph.tsx`

**Approach:**
- Inside `nodeThreeObject` (line 318), after building the sphere and label sprite, construct a third `THREE.Sprite` whose canvas draws a stroked-only circle of radius `r * 1.15` in `PAGE_TYPE_FORCE_COLORS[entityType]` (fallback to `PAGE_TYPE_DEFAULT_FORCE_COLOR` for missing types). Initial opacity: 0 (ring is invisible in the no-filter default state).
- Stash the ring's `SpriteMaterial` on the node as `node.__ringMat`, parallel to `__sphereMat` / `__spriteMat`.
- Extend the filter-change effect at line 375 to read from `classificationRef` instead of `matchedIds`, and set each node's three materials according to the state table in the High-Level Technical Design section.
- For the no-filter case (`classification === null`), set sphere=1, label=1, ring=0 — equivalent to today's "everything visible" state.
- Call `fgRef.current?.refresh?.()` after the mutations, same as today.

**Patterns to follow:**
- The existing sphere + sprite construction inside `nodeThreeObject` at `WikiGraph.tsx:334-365` — the ring is a third member of that group with the same material-stash pattern.
- The in-place mutation effect at `WikiGraph.tsx:375-383` — extend, don't replace.

**Test scenarios:**
- Happy path: with a filter active that produces exactly one match and two neighbors, inspect the three nodes in the scene and confirm the matched node shows `__sphereMat.opacity === 1` and `__ringMat.opacity === 0`, and the two neighbor nodes show `__sphereMat.opacity === 0.15` and `__ringMat.opacity === 1` with the ring color matching each node's `PAGE_TYPE_FORCE_COLORS`.
- Edge case: a node with `entityType` outside `PAGE_TYPES` — ring uses `PAGE_TYPE_DEFAULT_FORCE_COLOR`.
- Edge case: user types into the search box, then clears it — the ring on every node drops back to opacity 0 without restarting the d3 simulation (observable as nodes not re-laying-out).
- Integration: node construction happens exactly once per node per session (ForceGraph3D caches the `nodeThreeObject` return value). Confirm by counting sprite creations via a temporary console log during filter changes — should stay at the initial node-count and not increment.

**Verification:**
- With a filter matching a single node, screenshot the graph and confirm: one bright colored sphere in the center, a handful of outlined rings around it at faint fill, everything else gone.

- [ ] **Unit 3: Make edge rendering filter-aware**

**Goal:** Show an edge only when at least one endpoint is in the matched set. Remove orphaned edges by construction, not by alpha.

**Requirements:** R4, R6

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/admin/src/components/WikiGraph.tsx`

**Approach:**
- At the `ForceGraph3D` call site (line 457), add `linkVisibility={(link) => ...}` that reads `classificationRef.current`. When classification is `null`, return `true` for every link. Otherwise, return `true` iff either endpoint id is in `matchedIds`.
- Keep `linkColor`, `linkWidth`, and `linkDirectionalArrowColor` as today for visible links — a later iteration can soften matched-to-neighbor edges if needed, but that's not in this plan's requirements.
- Links use either string ids or resolved node objects once d3 has processed them. Resolve endpoint id with the same `typeof l.source === "object" ? l.source.id : l.source` pattern already used at `WikiGraph.tsx:299-300` and `488-489`.

**Patterns to follow:**
- Endpoint-id resolution pattern at `WikiGraph.tsx:299-300`.
- `MemoryGraph.tsx:417-418` — filter-agnostic but structurally identical `link => ...` lambda shape.

**Test scenarios:**
- Happy path: one match with two direct neighbors — exactly the two matched-to-neighbor edges render; any edge between the two neighbors is hidden.
- Edge case: match set is empty (filter matches nothing) — every edge hides; only the match-empty state (no matched + no neighbors) is visible, which is all-hidden. The user sees an empty canvas, which is the correct "no results" feel. (Not a regression — the list view already handles this copy; the graph view is silent today.)
- Edge case: no filter — every edge visible, matching today's behavior.
- Error path: a link whose `source` or `target` somehow isn't in `graphData.nodes` — today's `graphData` memo at `WikiGraph.tsx:249` already filters those out, so `linkVisibility` never sees one. Nothing to do; just confirm the invariant hasn't changed.
- Integration: toggling filter state does not cause `linkVisibility` to return different values for the same `(filter, link)` pair across renders — the ref read is deterministic given the same `classification`.

**Verification:**
- With one match, confirm visually that every visible edge has the bright-colored match on one end. No edge has two outlined (neighbor) endpoints.

- [ ] **Unit 4: Increase node spacing in the force layout**

**Goal:** Give the graph room to breathe so individual pages are visually pickable in dense clusters, without turning the layout into a sparse blob that requires zooming out.

**Requirements:** R7

**Dependencies:** None (can land independently of Units 1–3)

**Files:**
- Modify: `apps/admin/src/components/WikiGraph.tsx`

**Approach:**
- Current force tuning at `WikiGraph.tsx:385-394`:
  - `charge.strength`: `-120` when `nodeCount > 50`, else `-80`
  - `link.distance`: `70` when `nodeCount > 50`, else `55`
  - `collide.radius`: `20` (flat)
- Bump charge repulsion and link distance modestly so clusters loosen but the shape remains coherent. Starting point (to tune during implementation):
  - `charge.strength`: `-200` when `nodeCount > 50`, else `-130` (≈60% stronger)
  - `link.distance`: `100` when `nodeCount > 50`, else `75` (≈40% longer)
  - `collide.radius`: `28` (up from 20) — prevents overlap since spheres can be up to radius 18 (see `nodeThreeObject` at line 331).
- Node *size* stays exactly the same; only the empty space between them grows.
- Keep `distanceMax(200)` as-is for now — raising it would let repulsion reach further but also risks flinging disconnected islands off-screen. Revisit if clusters still feel cramped after the other bumps.

**Patterns to follow:**
- The existing conditional tuning at `WikiGraph.tsx:388-391` — same shape, bigger numbers.

**Test scenarios:**
- Happy path (dense tenant, ~200 nodes as in the screenshot): adjacent spheres in the densest cluster have at least a sphere-radius of empty space between them; the user can click any one without accidentally hitting its neighbor.
- Edge case (sparse tenant, <20 nodes): the layout doesn't spread so wide that the camera zoom-out reveals a mostly-empty canvas. If it does, tighten the `nodeCount <= 50` numbers; don't touch the `> 50` branch.
- Integration: the camera init effect at `WikiGraph.tsx:397-419` runs exactly once with `camera.position.set(0, 0, 500)`. After this spacing change the cluster may feel further away at the same camera z; if it does, bump the initial z or leave it (the user can pan/zoom). Revisit only if the first frame feels awkward.

**Verification:**
- Reload the admin Wiki graph on the same tenant that produced the screenshot. Individual nodes in the densest cluster no longer visually overlap; the overall "graph shape" is still recognizable, not blown apart.

- [ ] **Unit 5: Make `nodeThreeObject`'s initial state honor the current filter**

**Goal:** Newly-materialized nodes (when `ForceGraph3D` first mounts after a filter is already active, e.g., when the user arrives via a URL-persisted search) should render in the correct matched / neighbor / hidden state on first paint — not "everything full color, then the effect kicks in".

**Requirements:** R1, R2, R3

**Dependencies:** Unit 1, Unit 2 (independent of Unit 4)

**Files:**
- Modify: `apps/admin/src/components/WikiGraph.tsx`

**Approach:**
- Today, `nodeThreeObject` computes initial opacity from `matchedIdsRef.current`. Replace that with a read from `classificationRef.current` so the initial sphere / sprite / ring opacities match the post-filter state on first render.
- Keep `nodeThreeObject` itself as a stable `useCallback` with empty deps — it reads from a ref; no new dependencies.

**Patterns to follow:**
- Current `matchedIdsRef.current` read at `WikiGraph.tsx:319-320`.

**Test scenarios:**
- Happy path: load the Wiki page with `?q=some-term` already in the URL (the URL-state PR at `docs/plans/2026-04-20-002-feat-admin-wiki-memory-url-state-plan.md` makes this common) — the graph renders in filtered state on first paint, no flash of everything-visible.
- Edge case: no filter at initial mount — every node renders at full color, as today.
- Integration: this unit and the in-place mutation effect from Unit 2 must agree on state. Testing is one and the same: the classification table is the source of truth.

**Verification:**
- With DevTools throttling enabled and a pre-filtered URL, the first frame of the graph shows correctly filtered output — no flicker.

## System-Wide Impact

- **Interaction graph:** Purely presentational. No GraphQL call, no state shape change in `wiki/index.tsx`, no effect on the detail sheet or re-anchoring.
- **Error propagation:** No new failure modes. If `classificationRef.current` is transiently null (unlikely — the memo runs synchronously with `matchedIds`), renderers fall back to "no filter", which is a safe default.
- **State lifecycle risks:** The no-restart invariant from the file header comment is the single most important thing not to break. Unit 2 extends the existing in-place mutation effect; it does not add anything to `graphData`'s dep list. Unit 3 uses `linkVisibility`, which is a ForceGraph3D accessor evaluated per render — it does not invalidate graphData.
- **API surface parity:** `MemoryGraph.tsx` stays on today's all-visible-edges behavior. This is an intentional scope boundary: the user asked about Wiki; parity can come later if desired.
- **Integration coverage:** None automated — admin has no test harness today (confirmed via glob on `*.test.{ts,tsx}`). Manual verification against the running admin app is the coverage mechanism for each unit.
- **Unchanged invariants:**
  - `graphData` identity does not depend on filter state.
  - The one-shot camera init effect at `WikiGraph.tsx:397-419` does not run more than once per session.
  - The force-layout tuning effect at `WikiGraph.tsx:385-394` continues to re-run only when `graphData` changes.
  - The legend at the bottom-left (`WikiGraph.tsx:514-526`) still shows counts for the underlying (unfiltered) type distribution — this plan doesn't change what "count" means and neither should it.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Adding a third Sprite per node (the ring) grows GPU draw calls by ~50% per node. | Ring sprite is small (same canvas size as the label sprite) and ForceGraph3D batches sprites efficiently; the existing graph already draws two per node. If this becomes a perf issue on 100+ node graphs, collapse the ring into a wireframe `THREE.Mesh` with a `RingGeometry` billboarded to the camera — defer until measured. |
| A link whose endpoint stayed as a string id (d3 hasn't resolved it yet on the very first frame) could cause `linkVisibility` to read an undefined id from the sets. | The endpoint-id resolution pattern at `WikiGraph.tsx:299` already handles both cases. Follow it. |
| Users relying on seeing the full graph shape to orient themselves might find the hidden-node treatment too aggressive. | The request explicitly asked for the neighbor-only scope and we confirmed. If it feels too sparse in practice, we can flip to Option B ("all filtered-out nodes get the muted+outline treatment") as a one-line classification change. |
| A filter that matches every node produces an all-matched graph (no neighbors) — correct, but confusingly indistinguishable from the unfiltered state. | Acceptable: the search box already shows the query, and the matched count is communicated by the page's `headerCount` and the pages-view. No new UI needed. |
| Wider spacing (Unit 4) pushes disconnected islands off the initial viewport, forcing the user to zoom out on first load. | Start with the modest bumps in Unit 4 (≈60% charge, ≈40% link distance); re-measure on the same tenant that produced the screenshot before promoting bigger numbers. If the camera's fixed `z=500` position feels too close after the change, raise it — that's a one-line tweak to `WikiGraph.tsx:403`. |

## Documentation / Operational Notes

- No customer-facing docs today; no change needed.
- File-level comment at `WikiGraph.tsx:1-10` should be updated to mention the neighbor-ring behavior alongside the existing "in-place opacity mute on filter" note — same paragraph, same invariant, just more precise about what the mute now looks like.

## Sources & References

- Related code: `apps/admin/src/components/WikiGraph.tsx`, `apps/admin/src/components/MemoryGraph.tsx`, `apps/admin/src/lib/wiki-palette.ts`, `apps/admin/src/routes/_authed/_tenant/wiki/index.tsx`.
- Related PRs: #300 (URL-persisted filter state — makes Unit 4's first-paint case more common), #298-#301 (recent graph/wiki work).
- External docs: [react-force-graph-3d API](https://github.com/vasturiano/react-force-graph) — `linkVisibility`, `nodeThreeObject`, `refresh()`.
