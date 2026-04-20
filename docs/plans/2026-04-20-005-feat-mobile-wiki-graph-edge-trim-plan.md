---
title: "feat: Mobile wiki graph edge trim at node boundary"
type: feat
status: active
date: 2026-04-20
---

# feat: Mobile wiki graph edge trim at node boundary

## Overview

In the mobile wiki graph, edges (Skia `<Line>`) currently draw from node center to node center, so the line visually passes through the filled circle. When a node is dimmed via the filter (15% opacity), the line continues across the faded disk and is very noticeable — the effect looks like a crosshair through the node rather than a tidy connection. Trim both endpoints inward by the node radius so edges start and end on the circle's outer edge.

## Problem Frame

`apps/mobile/components/wiki/graph/GraphCanvas.tsx:107-134` renders each edge as:

```tsx
<Line p1={vec(a.x, a.y)} p2={vec(b.x, b.y)} ... />
```

`a.x, a.y` and `b.x, b.y` are node centers. `getNodeRadius()` returns a constant `14` (`apps/mobile/components/wiki/graph/layout/typeStyle.ts:25-27`), so the line overshoots the circle by exactly `r` on each side.

Why this is newly visible: PR #308 introduced the 3-state filter partition (matched / neighbor / hidden). `neighbor` nodes render at `DIM_OPACITY = 0.15` with a stroked outline ring. At that opacity the fill no longer hides the line segment that crosses the disk, so the line reads as continuous through the node — an "orphaned crosshair" instead of an edge terminating at a neighbor. The screenshot from the feature description shows this clearly: the line to the top-right neighbor bisects it.

Fix: before drawing, shift each endpoint from the center toward the other endpoint by `r` along the unit vector of the edge. The line then starts on `a`'s outer edge and ends on `b`'s outer edge.

## Requirements Trace

- R1. Every edge in `GraphCanvas` renders with endpoints on the outer edge of each node's filled circle, not the center.
- R2. Behavior is unconditional — applies whether a filter is active or not, and regardless of `matched/neighbor/hidden` classification.
- R3. Existing edge opacity logic (full when at least one endpoint is matched, `DIM_OPACITY` otherwise) is preserved.
- R4. When two nodes are so close that `distance ≤ 2 * nodeRadius` (overlapping circles — degenerate layout), the edge is skipped rather than drawn as a zero-length or reversed segment.
- R5. No change to the force simulation, camera, position cache, or reveal animation — this is a pure render-time geometric adjustment.

## Scope Boundaries

- Mobile `GraphCanvas` only (`apps/mobile/components/wiki/graph/GraphCanvas.tsx`).
- No change to the force sim, hit-testing, camera, or filter classification.
- No change to node radius, edge color, or stroke width.
- No change to `WikiDetailSubgraph` — that component shares the same `GraphCanvas`, so it picks up the fix automatically; nothing to plan separately.

### Deferred to Separate Tasks

- Admin wiki graph (`apps/admin/src/components/WikiGraph.tsx`) edge rendering. Admin uses `react-force-graph` (not Skia), which renders edges via its own canvas/SVG pipeline with its own node-radius-aware hooks. Different implementation path; likely a `linkWidth`/`nodeRelSize` or a custom `linkCanvasObject`. Defer until the user confirms they see the same issue on admin and wants parity.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/components/wiki/graph/GraphCanvas.tsx:107-134` — edge render loop. This is the only site that changes.
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx:99` — `const nodeRadius = getNodeRadius();` already resolved once per render; reuse it for the trim computation.
- `apps/mobile/components/wiki/graph/layout/typeStyle.ts:25-27` — `getNodeRadius()` returns `14` (global; no per-type variation). This plan relies on that invariant; if per-type radii are introduced later, the trim needs to look up each endpoint's radius independently, which is a trivial extension.
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx:54, 183-192` — selection ring sits at `r + SELECTION_RING_OFFSET` (stroked, 2px). Decision: trim to `r`, not `r + SELECTION_RING_OFFSET`. The selection ring is an accent floating outside the node; an edge ending at `r` lands exactly on the filled disk's outer edge for every node, with the ring as an unrelated overlay. Keeping the trim distance uniform across all nodes is simpler and consistent with the user's ask ("stop at the edge" = the circle fill's edge).

### Institutional Learnings

- None directly relevant — this is a localized render fix with no state-lifecycle or sim-restart risk. The no-restart invariants called out in `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md` are preserved because the change is inside the render map, not the subgraph memo or sim config.

### External References

- None needed; the geometry is elementary.

## Key Technical Decisions

- **Compute trim inline inside the edge `.map()` callback.** Each iteration already has `a` and `b` resolved; adding four lines of math (dx, dy, dist, unit vector, trimmed endpoints) is clearer than extracting a helper for a single callsite.
- **Skip degenerate edges where `dist ≤ 2 * nodeRadius`.** Drawing a reversed or zero-length line is worse than omitting it; this case is rare in practice because `collideRadius > nodeRadius` in the sim defaults.
- **No changes to stroke width or color.** Only the endpoints move.
- **Do not pre-compute trimmed edges into a memo.** The array is small (typical graph: tens of edges, not thousands), the math is cheap, and a memo would need to invalidate on every simulation tick since node positions change continuously during the reveal animation.

## Open Questions

### Resolved During Planning

- *Should the trim distance match the selection-ring outer radius for the selected node?* No — trim to `r` for all nodes. Uniform, simpler, and the selection ring is an accent outside the node footprint.
- *Is `nodeRadius` per-type?* No. `getNodeRadius()` is a no-arg constant today (`14`). If that changes, revisit.

### Deferred to Implementation

- Whether to inline the trim math or extract a `trimSegment(a, b, r)` helper in `layout/`. Inline is cleaner for one callsite; the implementer may extract if it reads better.

## Implementation Units

- [ ] **Unit 1: Trim edge endpoints to node boundary in `GraphCanvas`**

**Goal:** Edges render from the outer edge of each endpoint's circle instead of from center to center, with degenerate short edges skipped.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `apps/mobile/components/wiki/graph/GraphCanvas.tsx`

**Approach:**
- Inside the existing edge `.map((e) => { ... })` at `GraphCanvas.tsx:107-134`, after the null-guard on `a`/`b` coords and before building the `<Line>`:
  - Compute `dx = b.x - a.x`, `dy = b.y - a.y`, `dist = Math.hypot(dx, dy)`.
  - If `dist <= 2 * nodeRadius`, `return null` (overlap / degenerate).
  - Compute `ux = dx / dist`, `uy = dy / dist`.
  - Pass `p1={vec(a.x + ux * nodeRadius, a.y + uy * nodeRadius)}` and `p2={vec(b.x - ux * nodeRadius, b.y - uy * nodeRadius)}`.
- Keep the existing `edgeDimmed` opacity logic and the `key={e.id}` unchanged.

**Technical design:** *(directional, not implementation spec)*

```
Before:                          After:
  a●───────────────●b              a●  ●─────────●  ●b
   (line crosses disks)             (line ends at r on each side)
```

**Patterns to follow:**
- Existing early-return-null guards in the same `.map()` (lines 112-121) — mirror that style.

**Test scenarios:**
- Happy path: two nodes 100 units apart with `r=14` render a line of length `100 - 2*14 = 72`, starting at a point `14` units from `a`'s center toward `b` and ending `14` units from `b`'s center toward `a`. Validate visually on device against the reference screenshot.
- Happy path: diagonal edge (non-zero dx and dy) trims correctly — the endpoint offsets are proportional to dx/dist and dy/dist, not just horizontal.
- Edge case: two nodes exactly `2*r = 28` apart — edge is skipped (condition is `<=`, so they're considered touching).
- Edge case: two nodes `2*r + 0.1` apart — edge is drawn as a very short segment (essentially a dot). Acceptable; the sim's `collideRadius` makes this vanishingly rare.
- Edge case: filtered view with a matched center and multiple dimmed neighbors (the screenshot scenario) — every edge terminates on its neighbor's outer edge; no line crosses a filled disk.
- Edge case: `showLabels=true` in `WikiDetailSubgraph` — labels still render correctly; label positioning is unrelated to edge geometry.
- No regression: unfiltered view renders edges identically to matched↔matched in the filtered view (full opacity), just trimmed.

**Verification:**
- On an iPhone simulator (or device) open the mobile wiki tab, tap the filter/search bar to apply a filter that leaves one match with several 1-hop neighbors, and confirm no edge line visibly passes through any neighbor or matched circle.
- With the filter cleared, confirm the graph still looks clean — edges end at circle edges rather than at centers — and no edges have gone missing.
- Confirm the `WikiDetailSubgraph` (tap a node → detail view) renders edges the same way, since it shares `GraphCanvas`.

## System-Wide Impact

- **Interaction graph:** None. Hit-testing (`layout/hitTest.ts`) operates on node centers and radii, not edge endpoints — unaffected.
- **Error propagation:** None. Pure render-side geometry.
- **State lifecycle risks:** None. Does not touch subgraph identity, sim config, camera, position cache, or the `hasRevealedRef` gate — the no-restart invariants (see `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`) are untouched.
- **API surface parity:** Admin (`apps/admin/src/components/WikiGraph.tsx`) has the same conceptual need on a different render stack (react-force-graph). Explicitly deferred; no current parity requirement since admin uses a different library with library-level solutions.
- **Integration coverage:** `WikiDetailSubgraph` uses the same `GraphCanvas` and automatically inherits the fix; no separate plumbing.
- **Unchanged invariants:** Node radius constant (`getNodeRadius() = 14`), edge color, stroke width, `edgeDimmed` opacity rule, force-sim defaults, camera behavior, reveal animation — all unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Overlap edge case (`dist ≤ 2r`) could hide a legitimately short edge during reveal animation when nodes start stacked near the origin and animate outward. | The reveal animation completes in under a second; the sim's `collideRadius` quickly pushes nodes apart beyond `2r`. Worst case: a few edges briefly don't render during the first frames of the first view. Acceptable; alternative (drawing reversed segments) looks worse. |
| If `getNodeRadius()` is extended to return per-`pageType` radii in the future, the trim becomes wrong (uses one radius for both endpoints). | Signature change would be caught immediately; extension is trivial (`getNodeRadius(a.pageType)` / `getNodeRadius(b.pageType)`). Noted in "Relevant Code and Patterns" above. |

## Sources & References

- Related code: `apps/mobile/components/wiki/graph/GraphCanvas.tsx:107-134`
- Related code: `apps/mobile/components/wiki/graph/layout/typeStyle.ts:25-27`
- Related learning: `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`
- Related PRs: #308 (introduced the 3-state filter partition that made this visible)
- Related plan: `docs/plans/2026-04-20-004-feat-mobile-wiki-graph-neighbor-ring-plan.md`
