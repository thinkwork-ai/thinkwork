---
title: Unify Mobile Graph with Web - Plan
type: refactor
date: 2026-07-08
topic: unify-mobile-graph-with-web
execution: code
linear: THINK-235
---

# Unify Mobile Graph with Web - Plan

Mirror of [THINK-235](https://linear.app/thinkworkai/issue/THINK-235/unify-mobile-graph-with-web-match-nodeedge-labels-layout-and-coloring).

## Goal

Make the **mobile** graph (Wiki / Memory / Knowledge) look and behave nearly
identically to the **web** graph. Keep the two renderers (they must differ — see
below) but **unify the shared logic** and match node-label styling, edge-label
styling, coloring, sizing, and layout so the same data produces a visually
equivalent graph on both platforms.

Reference target: the web Memory/Wiki graph — community-colored nodes, wrapped
white in-node labels, `mentions` labels drawn along directed edges.

## Why two renderers exist (do NOT port the web component)

The web graph in `packages/graph` renders through **`react-force-graph-2d`** →
`force-graph` / `react-kapsule`, which mount an **HTML `<canvas>`** and rely on
`document` / `window` / `ResizeObserver` / DOM `PointerEvent`s / Tailwind DOM
overlays (`use-graph-pointer.ts` is entirely DOM pointer math, and exists partly
to work around Brave's canvas-readback fingerprint shield). None of that exists
in React Native, so it **cannot** run on Expo.

The mobile app correctly ships its own native renderer in
`apps/mobile/components/wiki/graph/`:

- **`@shopify/react-native-skia`** — drawing
- **`d3-force`** — layout
- **`react-native-gesture-handler` + `reanimated`** — pan/zoom camera
- **`d3-quadtree`** — tap hit-testing

So the split (Skia on native / canvas on web) is right. The problem is that
mobile **re-implements** logic and styling that has drifted from web.

## Files

- **Web**: `packages/graph/src/{MemoryGraph,WikiGraph,KnowledgeGraph}.tsx`,
  `graph-utils.ts`, `use-graph-pointer.ts`
- **Mobile**: `apps/mobile/components/wiki/graph/` — `GraphCanvas.tsx`,
  `hooks/useForceSimulation.ts`, `hooks/useGraphCamera.ts`,
  `layout/{hitTest,fitBounds,neighborhood,typeStyle}.ts`, `WikiGraphView.tsx`,
  `KnowledgeGraph.tsx`

## Visual / behavior gaps (mobile → web)

1. **Node coloring — biggest difference.** Web colors by **Louvain community**
   (`graph-utils.ts` `detectCommunities` → `communityColor` / `COMMUNITY_COLORS`).
   Mobile colors by **entity type** (`layout/typeStyle.ts`). Adopt community
   coloring on mobile via the shared logic.
2. **Node labels.** Web draws **wrapped, centered, white, weight-600** labels
   inside nodes, **zoom-gated** (`labelsVisibleAtScale` + `wrapLabelLines`).
   Match wrapping, font weight/size scaling, color, and zoom threshold on mobile.
3. **Edge labels.** Web draws the relationship label (e.g. `mentions`) **inline
   along each edge** (`linkCanvasObject`). Mobile `GraphCanvas.tsx` renders only
   the `Line` — add Skia text along edges with the same visibility gating.
4. **Directed arrowheads.** Web draws arrowheads on directed edges; ensure mobile
   edges render arrowheads to match.
5. **Layout / clustering.** Web anchors clusters by community
   (`computeCommunityLayout` / `computeCommunityAnchors`) plus specific
   `d3-force` params. Mobile uses `d3-force` **without** community anchoring, so
   clusters form differently. Share the layout constants + community anchoring.
6. **Node sizing.** Use the same `degreeRadius` (degree/mention-count → radius)
   formula on both.
7. **Dim/highlight + filtering.** Match the matched/neighbor/other classification
   and exact alpha values (dim ≈ 0.15), and the "mute connecting lines only while
   filtering (not on select)" behavior recently shipped on web.

## Unify the logic (shared, renderer-agnostic module)

`graph-utils.ts` is almost entirely **DOM-free** and is the reusable core:
`detectCommunities` / `computeCommunityLayout` / `computeCommunityAnchors`
(graphology + louvain), `degreeRadius`, `COMMUNITY_COLORS` / `communityColor` /
`contrastTextColor` / `darkenColor`, `classifyNode` / `deriveGraphClassification`,
`expandNeighborhood`, `wrapLabelLines`, and label/zoom-gate math.

- Extract it into a **renderer-agnostic shared module** consumed by both web and
  mobile (a `@thinkwork/graph-core` entry, or a `packages/graph` subpath with no
  `react-force-graph-2d` / DOM imports).
- Add **`graphology`** + **`graphology-communities-louvain`** to `apps/mobile`
  deps (pure JS, RN-safe; not currently present).
- Replace the one DOM leak: `isDarkMode()` reads `document.documentElement` —
  swap for an injected `isDark` param so mobile passes `useColorScheme()`.
- Remove mobile duplicates (its own `classifyNode` in `GraphCanvas.tsx`, its own
  colors in `layout/typeStyle.ts`) in favor of the shared module.

## Acceptance criteria

- [ ] Same input data → **same community clustering and node colors** on web and
      mobile.
- [ ] Node labels wrapped/centered/weight-600/white and zoom-gated identically.
- [ ] Edge relationship labels (`mentions`, etc.) render on mobile, matching web
      styling/gating.
- [ ] Directed arrowheads present on mobile edges.
- [ ] Node radius (by degree) matches web.
- [ ] Filter dim/highlight + muted-links-while-filtering parity.
- [ ] Classification, palette, community detection, and sizing live in **one
      shared module** — no duplicated logic across web/mobile.

## Out of scope

- Porting `react-force-graph-2d` to RN (impossible — DOM/canvas). Keep Skia on
  native, canvas on web.
- Backend / GraphQL changes (both already consume the same `wikiGraph` /
  `memoryGraph` shape).

## Verification

Side-by-side web vs. mobile (Expo / simulator) on the same tenant memory graph;
screenshots should be near-identical in clustering, colors, node labels, and
edge labels.
