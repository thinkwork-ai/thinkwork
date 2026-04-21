---
title: Force-directed graph filter — 3-state rendering + no-simulation-restart invariant
date: 2026-04-20
category: best-practices
module: wiki-graph
problem_type: best_practice
component: frontend_stimulus
severity: medium
related_components:
  - assistant
  - tooling
applies_when:
  - Adding search or type filters to a force-directed graph (wiki, knowledge, or memory graphs).
  - Non-matches must stay visible so users keep spatial context, not be hidden.
  - Filter keystrokes must not restart the d3 simulation or reset the camera.
  - Rendering the same graph across an imperative stack (THREE / ForceGraph3D) and a declarative one (Skia).
symptoms:
  - Bright edges appear to fly into near-invisible nodes ("orphaned edges") when the filter is active.
  - Users can't tell which dim nodes are actually connected to their search hit.
  - Node footprint visibly grows when a ring is drawn to mark a neighbor.
  - Camera or layout jumps on every filter keystroke.
tags:
  - graph-visualization
  - d3-force
  - react-force-graph-3d
  - react-native-skia
  - three-js
  - filter-ux
  - wiki-graph
---

# Force-directed graph filter — 3-state rendering + no-simulation-restart invariant

## Context

The admin and mobile Wiki graphs both support live search filtering on a force-directed layout. A predecessor implementation used a binary dim (matched full color, everything else 15%, edges untouched), which produced the orphaned-edge symptom in the frontmatter: bright edges flying into near-invisible bubbles.

A sibling concern shapes the rest of this doc: naive filter implementations rebuild `graphData` or change `nodeThreeObject` identity on every keystroke, which restarts d3-force and resets the camera. That invariant is already load-bearing in `docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md` (mobile) and in the header comment on `apps/admin/src/components/WikiGraph.tsx` (admin). Any filter UX has to respect it.

Shipped in PR [#307](https://github.com/thinkwork-ai/thinkwork/pull/307) (admin) and PR [#308](https://github.com/thinkwork-ai/thinkwork/pull/308) (mobile).

## Guidance

### 1. Classify nodes into three states, not two

When a filter is active, partition nodes by their relationship to the match set:

```ts
type NodeVisualState = "matched" | "neighbor" | "other";

// d3-force mutates links in place: endpoints start as strings and become
// node objects once the sim runs. Handle both shapes.
type Link = { source: string | { id: string }; target: string | { id: string } };

function deriveNeighbors(matched: Set<string>, links: Link[]): Set<string> {
  const neighbors = new Set<string>();
  for (const l of links) {
    const s = typeof l.source === "object" ? l.source.id : l.source;
    const t = typeof l.target === "object" ? l.target.id : l.target;
    const sMatched = matched.has(s);
    const tMatched = matched.has(t);
    // Match-match edges contribute no neighbors — both endpoints are
    // already in the match set. Only mixed-match edges do.
    if (sMatched && !tMatched) neighbors.add(t);
    else if (tMatched && !sMatched) neighbors.add(s);
  }
  return neighbors;
}
```

Render each state distinctly:

| State | Fill | Label | Outline ring |
|-------|------|-------|--------------|
| matched | 100% | 100% | hidden |
| neighbor | 15% | 15% | **visible, type-colored** |
| other | 15% | 15% | hidden |

The ring earns its pixels because it only appears on nodes that are topologically adjacent to a match. That's the whole point: it's a "which of these dim nodes is part of the match's neighborhood" affordance.

### 2. Draw the ring INSIDE the sphere footprint

Outside rings (ring radius > node radius) visually enlarge the node, so filter keystrokes read as layout churn even when nothing actually moves. Inside rings keep the footprint constant.

- **Skia (mobile):** stroke at `r = nodeRadius - strokeWidth/2`. The stroke's outer edge is flush with the filled circle's outer edge.
- **THREE sprite (admin):** scale the ring sprite to `r * 2` (sphere diameter) and draw the stroked arc inside the canvas at `rSize/2 - lineWidth`. The visible ring sits inside the sphere's radius.

### 3. Edge opacity = endpoint match state, not node opacity

```ts
// admin (linkColor accessor) / mobile (opacity prop)
const edgeLitUp = matched.has(source.id) || matched.has(target.id);
// admin:
return edgeLitUp ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.1)";
// mobile:
<Line opacity={edgeLitUp ? 1 : DIM_OPACITY} />
```

Prefer filter-aware `linkColor` / opacity over `linkVisibility`. Visibility toggles are jumpy; opacity interpolates cleanly.

### 4. Preserve the no-simulation-restart invariant

Filter changes must mutate opacity in place, not rebuild data or change stable-callback identity.

**Admin (`react-force-graph-3d`):**

- Keep `nodeThreeObject = useCallback((node) => {...}, [])` — empty deps. `ForceGraph3D` re-invokes `nodeThreeObject` for every node whenever the callback identity changes, which destroys and rebuilds each `Object3D` and restarts the sim. Stable callback identity is the load-bearing property.
- Read classification via a **ref** so the stable callback always sees the latest value:
  ```ts
  const classificationRef = useRef<Classification | null>(null);
  classificationRef.current = classification; // render-phase write
  // inside nodeThreeObject: classificationRef.current.matchedIds.has(id)
  ```
  Render-phase ref writes are a well-known workaround for "stable closure, latest value"; if you need strict concurrent-mode safety, assign in a `useLayoutEffect` instead.
- Stash per-node materials on the node object at build time: `node.__sphereMat`, `node.__spriteMat`, `node.__ringMat`. This requires a module augmentation (or an `as any` stash site) to satisfy strict TS — the ForceGraph `NodeObject` type doesn't know about your extras.
- Run a separate effect that iterates `graphData.nodes` and mutates `__sphereMat.opacity`, `__ringMat.opacity`, etc., then calls `fgRef.current?.refresh?.()`. Do **not** add anything to this effect that invalidates `graphData`'s memo identity.
- Re-use the same ref pattern for `linkColor` / `linkDirectionalArrowColor` so new edge opacities don't require a new function identity (which would re-trigger ForceGraph3D's prop diffing).
- One-shot camera init behind `cameraInitRef.current`; never re-seat the camera on filter.

**Mobile (Skia):**

The declarative Skia tree is simpler — each render computes per-node `opacity` and ring visibility from props — but the same discipline applies:

- Don't recompute `internalSubgraph` identity on filter change. The view's `filter` memo and the `internalSubgraph` memo are **separate** memos with **separate** deps. Filter changes update only the former.
- `useForceSimulation` keys its effect on `[nodes, edges, ...simConfig]`. Keep sim config values static across renders; never pass new defaults on filter.

### 5. Loosen d3-force defaults for dense tenants

The ring makes the visual weight of each node tighter, but the real win is that dense clusters were already visually overlapping. Space nodes apart with static sim-config defaults:

- **Admin** (`apps/admin/src/components/WikiGraph.tsx`):
  - `charge.strength`: `-120 → -200` (>50 nodes) / `-80 → -130` (≤50).
  - `link.distance`: `70 → 100` / `55 → 75`.
  - `collide.radius`: `20 → 28`.
- **Mobile** (`apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts`):
  - `chargeStrength`: `-80 → -130`.
  - `linkDistance`: `40 → 60`.
  - `collideRadius`: `18 → 22`.

Mobile's numbers stay below any per-call `simConfig` overrides (e.g. `WikiDetailSubgraph`'s 1-hop detail view), which are tuned for sparse layouts and win when present.

## Why This Matters

- **Orphaned edges feel like a bug.** Users report "the graph is broken" before they report "the filter looks weird." Matching edge opacity to endpoint state is cheap and kills the effect entirely.
- **Footprint churn obliterates spatial memory.** If the ring grows the node, the user loses track of where their match was on every keystroke. Drawing the ring inside the existing footprint keeps the graph stable to the eye.
- **Sim restarts are the worst form of churn.** A single unstable useCallback dep on `nodeThreeObject` was enough in an earlier iteration to reset the camera on every filter keystroke. The ref-carried classification + empty-deps `nodeThreeObject` is the only pattern that keeps the d3 simulation stable while filtering at 60fps.
- **3-state > 2-state.** The outline ring earns its pixels because it exclusively marks neighbors. If every dim node got a ring, the signal would collapse into noise — exactly what the user corrected during implementation.

Not needed for static SVG graphs where a full re-render is cheap and identity stability doesn't matter. The full set of situations where this pattern applies is captured in the `applies_when` frontmatter.

## Examples

### Admin: THREE sprite ring inside the sphere

`apps/admin/src/components/WikiGraph.tsx` — the three load-bearing lines:

```ts
// Canvas sprite (128x128) drawn once per node. The arc radius inside
// the canvas puts the stroke inside the sprite's visible bounds.
rCtx.beginPath();
rCtx.arc(64, 64, 64 - 10, 0, Math.PI * 2); // inset by lineWidth
rCtx.stroke();

ringSprite.scale.set(r * 2, r * 2, 1);     // sprite = sphere diameter
node.__ringMat = ringSprite.material;      // stash for in-place mutation
```

The rest is standard THREE boilerplate (CanvasTexture, SpriteMaterial, `group.add`). The point is: arc inset + sprite scale = sphere diameter. That's what keeps the ring inside the footprint.

### Mobile: Skia stroked circle drawn inside the node

`apps/mobile/components/wiki/graph/GraphCanvas.tsx`:

```tsx
// NEIGHBOR_RING_INSET = NEIGHBOR_RING_STROKE / 2 — stroke's outer edge
// aligns with the filled circle's outer edge, so footprint stays r.
if (state === "neighbor") {
  return (
    <Group key={n.id}>
      <Circle cx={n.x} cy={n.y} r={nodeRadius}
              color={nodeColor} opacity={DIM_OPACITY} />
      <Circle cx={n.x} cy={n.y} r={nodeRadius - NEIGHBOR_RING_INSET}
              color={nodeColor} style="stroke"
              strokeWidth={NEIGHBOR_RING_STROKE} />
    </Group>
  );
}
```

### Iteration history — what missed before it landed

- **v1: hid non-neighbor unmatched nodes.** Rejected — "muted nodes with the outline are ONLY for nodes attached to the searched node. other nodes are just muted." Hiding destroys graph topology.
- **v2: 2-state — all unmatched nodes get muted+outline.** Outline loses its "this is adjacent" meaning. 3-state earns the ring's pixels.
- **v3: 3-state, ring OUTSIDE the sphere (`r + offset`).** Classification was correct, but the ring enlarged the footprint and the graph looked like it was re-laying-out on every keystroke. Moved to ring inside (`r - inset`) for the final shipped version.

### Related load-bearing fix

The callback-ref dims measurement bug documented in `docs/solutions/logic-errors/admin-graph-dims-measure-ref-2026-04-20.md` landed earlier the same day on the same admin component. It's the reason the graph mounts correctly after a refresh — filter work here assumes that's in place.

## Related

- [react-native-force-sim-camera-persistence-2026-04-20.md](../best-practices/react-native-force-sim-camera-persistence-2026-04-20.md) — the mobile force-sim-preservation invariant this doc builds on (Layer 3: "mutate in place, never `.restart()`").
- [admin-graph-dims-measure-ref-2026-04-20.md](../logic-errors/admin-graph-dims-measure-ref-2026-04-20.md) — same-day admin fix that makes the filter-capable graph actually mount.
- PRs: [#307](https://github.com/thinkwork-ai/thinkwork/pull/307) (admin), [#308](https://github.com/thinkwork-ai/thinkwork/pull/308) (mobile).
- Plans: `docs/plans/2026-04-20-003-feat-admin-wiki-graph-neighbor-ring-plan.md`, `docs/plans/2026-04-20-004-feat-mobile-wiki-graph-neighbor-ring-plan.md`.
