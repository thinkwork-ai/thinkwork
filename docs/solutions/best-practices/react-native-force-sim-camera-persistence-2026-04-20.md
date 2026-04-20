---
title: Persisting d3-force + Reanimated camera state across React Native navigation
date: 2026-04-20
last_updated: 2026-04-20
category: best-practices
module: apps/mobile/components/wiki/graph
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Mounting a d3-force simulation inside an Expo Router / React Navigation stack that can unmount the host screen on blur
  - Combining a mutating physics sim with a Reanimated shared-value camera (pan/zoom)
  - Driving nodes from an urql subscription that may re-emit a fresh object reference mid-session (including when a sibling component creates a duplicate subscription during drill-down)
  - Any drill-down flow where returning should land the user on the exact camera + layout they left
tags:
  - react-native
  - d3-force
  - reanimated
  - expo-router
  - urql
  - state-persistence
  - force-directed-graph
---

# Persisting d3-force + Reanimated camera state across React Native navigation

## Context

A wiki graph screen renders nodes/edges with `@shopify/react-native-skia` under a Reanimated-driven camera (`tx`, `ty`, `scale` shared values) and lays them out with a d3-force simulation wrapped in a `useForceSimulation` hook. Users pan/pinch to a preferred viewport, tap a node to drill into a detail screen, and expect to come back to exactly the same camera and node positions.

Three forces fight that expectation and each one produces a different user-visible regression:

1. **Expo Router unmounts the graph screen** when the user navigates away (tab unmount-on-blur or stack push that displaces the origin screen).
2. **urql emits a new payload object for the same query** — either on focus/refetch or when a sibling component creates an identical subscription. This is also an intentional case: setting `requestPolicy: "cache-and-network"` and firing `refetch()` on mount to give a Skia-canvas surface a "pull-to-refresh"-equivalent will re-emit on every mount by design. Without Layer 2 below, every intended refresh stomps the user's camera + layout. The adapter's `useMemo` rebuilds, producing fresh node objects with no `x`/`y`.
3. **d3-force starts at `alpha = 1`** on every (re-)init. Even with seeded positions, it immediately applies fresh velocities on the first tick and flings nodes away from the restored layout.

No single persistence layer defeats all three. You need three independent layers working together.

## Guidance

**Layer 1 — Module-level cache.** Store a `Map<string, { tx: number; ty: number; scale: number; positions: Map<nodeId, {x, y}> }>` at module scope, keyed on something stable (e.g. `${tenantId}:${agentId}`). Write to it in the camera component's unmount cleanup. Read from it on mount once the viewport size is known, apply positions to matching node ids by id lookup, and set the camera's shared values directly. Survives full unmount.

**Layer 2 — Parent-level `prevInternalRef`.** In the component that adapts the server payload into the internal node/edge shape (the one holding the `useMemo` that converts the urql result to `WikiGraphNode[]`), keep a `useRef` to the previously-built subgraph. When `useMemo` rebuilds, read positions from `prev.nodes` by id and assign onto the new node objects *before* returning. Survives same-data urql re-emits without needing unmount.

**Layer 3 — Sim-init preseeded-detection.** Inside `useForceSimulation`, after constructing the `forceSimulation(nodes)`, check whether every node has `typeof n.x === "number" && typeof n.y === "number"`. If so, call `sim.alpha(0); sim.stop()` *before any tick fires*, and set the hook's `settled` state to `true`. Prevents d3 from agitating the restored layout.

## Why This Matters

Each layer alone fails in a specific, easy-to-misdiagnose way:

- **Layer 1 only**: works for unmount/remount but positions still reset when urql re-emits mid-session. A new subgraph ref creates new node objects with no `x`/`y`, the sim starts from d3's sunflower seed, and the user's layout is gone.
- **Layer 2 only**: works for urql re-emits within a single mount but on full remount the ref is gone and there's nothing to fall back to.
- **Layers 1 + 2 without Layer 3**: positions arrive correctly on the nodes, but d3's default `alpha = 1` generates velocities on the first tick and throws the nodes around. The user sees a correct frame for ~16ms then watches the whole layout scatter.

The three layers are orthogonal. Omitting any one produces a different regression, and each one is easy to mistake for "caching is broken" in a debugging session.

## When to Apply

- Any Skia / Reanimated canvas whose layout is computed by an iterative simulation (d3-force, matter-js, custom springs) **and** whose host screen can unmount.
- **Adding a background data-refresh affordance** to the same surface (no pull-to-refresh on a Skia canvas, so remount-on-toggle is the only natural trigger). Once Layers 1–3 are in place this is a one-line change: fire `refetch()` in a mount-only effect, via a stable ref so the effect stays at empty deps.

  ```tsx
  const { graph, refetch } = useWikiGraph({ tenantId, ownerId });
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    refetchRef.current();
  }, []);
  ```

  The ref is load-bearing. Putting `refetch` itself in the dep array refires on every urql identity change — a refetch storm. Calling it inline in render fires ~30× per second during active simulation. The stable-ref idiom keeps the effect one-shot per mount while still calling whatever `refetch` closure urql currently exposes. Cached data renders instantly on mount, fresh data slides in silently via Layer 2 — the user never sees a loading state on the graph itself.

- Also watch for two sibling gotchas from the same surface area:
  - **Timed reveal / intro animations** whose `useEffect` depends on data that can re-emit. If a `setTimeout` sits inside a `useEffect` whose deps change at a higher frequency than the timer fires, the cleanup will repeatedly clear the timer — you're stuck with `revealed: false` forever. Fix: split into two effects — (a) a mount-only `useEffect(() => { const t = setTimeout(...); return () => clearTimeout(t); }, [])` that flips a `preRevealComplete` state, and (b) a second effect gated on `preRevealComplete + hasRevealedRef.current` that runs the reveal logic exactly once per component instance.
  - **Labels that must follow the camera**: render as Skia `<Text>` inside the transformed `<Group>`, not as RN `<Text>` overlays positioned by reading `camera.tx.value` on the JS thread. Shared-value writes happen UI-thread without triggering a JS re-render, so overlay math stays stale during pan/pinch.

## Examples

**Module cache snapshot/restore** (`apps/mobile/components/wiki/graph/graphStateCache.ts` + the snapshot/rehydrate effects in `KnowledgeGraph.tsx`):

```ts
// graphStateCache.ts — module scope
export interface CachedGraphState {
  tx: number;
  ty: number;
  scale: number;
  positions: Map<string, { x: number; y: number }>;
}
const store = new Map<string, CachedGraphState>();
export const saveGraphState = (key: string, e: CachedGraphState) => store.set(key, e);
export const loadGraphState = (key: string) => store.get(key) ?? null;
```

```ts
// KnowledgeGraph.tsx — snapshot on unmount via a "latest" ref so the
// cleanup captures the final values, not render-time closures.
const snapRef = useRef({ subgraph, camera, cacheKey });
snapRef.current = { subgraph, camera, cacheKey };
useEffect(() => () => {
  const { subgraph: sg, camera: cam, cacheKey: ck } = snapRef.current;
  if (!ck) return;
  const positions = new Map<string, { x: number; y: number }>();
  for (const n of sg.nodes) {
    if (typeof n.x === "number" && typeof n.y === "number") {
      positions.set(n.id, { x: n.x, y: n.y });
    }
  }
  saveGraphState(ck, {
    tx: cam.tx.value,
    ty: cam.ty.value,
    scale: cam.scale.value,
    positions,
  });
}, []);
```

**Parent adapter carrying positions across urql re-emits** (`WikiGraphView.tsx`):

```tsx
const prevInternalRef = useRef<WikiSubgraph | null>(null);
const internalSubgraph = useMemo(() => {
  if (!graph) return null;
  const sub = toInternalSubgraph(graph);
  const prev = prevInternalRef.current;
  if (prev) {
    const byId = new Map(prev.nodes.map(n => [n.id, n]));
    for (const n of sub.nodes) {
      const p = byId.get(n.id);
      if (p && typeof p.x === "number" && typeof p.y === "number") {
        n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0;
      }
    }
  } else {
    // First build — seed from the module cache
    const cached = loadGraphState(cacheKey);
    if (cached) {
      for (const n of sub.nodes) {
        const p = cached.positions.get(n.id);
        if (p) { n.x = p.x; n.y = p.y; n.vx = 0; n.vy = 0; }
      }
    }
  }
  prevInternalRef.current = sub;
  return sub;
}, [graph, cacheKey]);
```

**Preseeded-detection inside `useForceSimulation`** (`hooks/useForceSimulation.ts`):

```ts
const preseeded =
  nodes.length > 0 &&
  nodes.every(n => typeof n.x === "number" && typeof n.y === "number");

const sim = forceSimulation(nodes)
  .force("link", forceLink(edges).id(d => d.id).distance(linkDistance))
  .force("charge", forceManyBody().strength(chargeStrength))
  .force("center", forceCenter(0, 0))
  .force("collide", forceCollide(collideRadius));

if (preseeded) {
  sim.alpha(0);   // no velocity applied on the first tick
  sim.stop();     // no ticks fire at all until the user triggers restart()
  setSettled(true);
}
```

## Related

- Plan: [`plans/2026-04-20-003-feat-mobile-graph-refinements-plan.md`](../../../plans/2026-04-20-003-feat-mobile-graph-refinements-plan.md) — Post-Implementation Status block with the session-level narrative and divergences.
- Plan: [`plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md`](../../../plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md) — the v1 graph ship this pattern was added on top of.
- Code: `apps/mobile/components/wiki/graph/graphStateCache.ts` · `WikiGraphView.tsx` · `hooks/useForceSimulation.ts` · `KnowledgeGraph.tsx`
- Sibling gotcha: the same session surfaced the two-effect reveal pattern and Skia-text-inside-Group for auto-following labels; both are documented in the v2 plan's "Things worth knowing before touching the graph again" section.
- PR #292 — the landed implementation of all three layers.
- PR #301 — turned on mount-triggered `refetch()` on `WikiGraphView` to give the graph surface a refresh affordance. Layer 2's `prevInternalRef` is what makes the intentional re-emit safe; validates the "urql re-emits mid-session" branch of the Context section.
