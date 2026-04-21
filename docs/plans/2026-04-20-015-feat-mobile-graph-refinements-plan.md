---
title: "feat: Mobile graph refinements — fit-to-view, detail-screen tap, subgraph-in-detail, icon swap"
type: feat
status: shipped-with-divergence
date: 2026-04-20
shipped: 2026-04-20
origin: docs/plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md
---

# feat: Mobile graph refinements (fit-to-view + detail-screen tap + subgraph-in-detail + icon swap)

## Post-Implementation Status (2026-04-20)

All four planned units shipped on a single branch (`feat/mobile-graph-fit-to-view`). Several mid-session pivots changed the shape of Unit 2 and Unit 3 in ways that differ from the plan body — read this section first; the body below is the design we set out to build.

### What shipped

- **Unit 1 — Auto-fit camera**: 1s pre-reveal buffer lets the sim spread nodes silently (spinner shown), then a single eased `withTiming` zoom-in from 65% of target scale to the fit target. After that the camera is static until the user pans/pinches. No continuous tracking, no flashing.
- **Unit 2 — Tap → centered modal** (not router push to full detail screen as planned). Nodes have no labels, so a tap opens a centered `NodeDetailModal` with the page's summary + scrollable sections; an external-link icon in the modal header opens the full detail screen and dismisses the modal. This is a cheaper preview-then-commit UX than the original "always navigate" design.
- **Unit 3 — 40/60 split on detail screen**: graph top 40%, scrolling wiki content bottom 60%, 1px divider between. Tapping a node in the embedded detail subgraph opens the same `NodeDetailModal` (consistent with main-graph tap behavior); the modal's external-link icon navigates to that neighbor's detail screen.
- **Unit 4 — Icon swap**: home-tab toggle *swaps* `IconTopologyStar3` ↔ `IconList` (list icon when in graph mode, topology-star when in list mode). Detail-screen toggle *doesn't* swap — always `IconTopologyStar3`, color changes (foreground when off, `colors.primary` when on). User explicitly requested the asymmetry.
- **State persistence across navigation** (not in the original plan): module-level `graphStateCache` keyed on `${tenantId}:${agentId}` + `prevInternalRef` in `WikiGraphView` that carries `n.x/n.y` into new node objects when urql re-emits the query. `useForceSimulation` detects "all nodes have positions" on sim init and freezes (alpha 0 + stop) so d3 doesn't agitate a restored layout. Net effect: drilling into a detail screen and back lands you on the exact camera + layout you left.
- **Long-press back-chevron → dismiss-all**: added to `DetailLayout`. Short tap is normal `router.back()`; long press calls `router.dismissAll()` to pop the whole wiki drill-down in one gesture.
- **Sim config is a prop** (not in the original plan). `useForceSimulation(nodes, edges, { linkDistance, chargeStrength, collideRadius, xyStrength })`. Main graph uses the dense defaults (40 / -80 / 18 / 0.08); the detail subgraph passes wider values (90 / -260 / 42 / 0.04) so a small 1-hop neighborhood feels airy.
- **Labels on the detail subgraph** (not in the original plan): `GraphCanvas` accepts `showLabels?: boolean`. When true, renders Skia `<Text>` inside the transformed `<Group>` so labels follow the camera natively on pan/pinch (no JS-thread re-renders needed). Font via `matchFont({ fontFamily: Platform.select(...), fontSize: 11 })`.

### What diverged from the plan

- **Units did not ship as four separate PRs.** Plan called for one PR per unit; iteration cost was too high (device reload + user feedback per unit → 3–4× the wall-clock for the same work). Moved to a single branch with rapid iterations and let the work converge. One PR for the whole set.
- **No test files.** Plan called for `layout/fitBounds.test.ts` and `layout/neighborhood.test.ts`. `apps/mobile` has no Jest/Vitest test runner configured. Decision: keep the two pure modules small and inspectable, don't introduce a test toolchain just for this unit. Noted as follow-up if we ever add mobile tests.
- **Router.replace vs. router.push on the detail subgraph**: plan said `router.replace` for sideways nav. User wanted full back-stack hop-by-hop, so changed to `router.push`. Combined with the new long-press-to-pop-all on the back button, the resulting navigation model is better than the plan's.
- **Modal instead of router.push for main-graph tap**: plan Unit 2 said "nodes tap → navigate to full detail". User feedback after first implementation: "too much back and forth since the nodes don't have labels". Swapped to centered modal with external-link icon as the commit action. Old `NodeDetailSheet` (bottom sheet) was deleted in this session, a new `NodeDetailModal` (centered) replaces it.
- **Reveal animation had to split into two effects** (not anticipated in plan). Original single-effect version fired `setTimeout` in the same `useEffect` that depended on `subgraph`; urql re-emits within the 1s window cleared the timer via `useEffect` cleanup and never re-scheduled, leaving `revealed: false` forever. Fixed by separating: (a) a mount-only `setTimeout` effect that flips `preRevealComplete`, (b) a reveal effect gated on `preRevealComplete` + `hasRevealedRef` that fires the fit animation exactly once per component instance.
- **Center-on-origin was a wrong turn**: mid-session experiment to lock `tx/ty` at canvas center and only scale during sim. Turned out the whole "chase the fit every tick" model was flawed (too jittery, flashing, incorrect centering when cluster isn't at origin). Scrapped in favor of the "one eased fit, no continuous tracking" model that actually shipped.

### What the plan specified but did NOT need special handling

- **`WikiDetailSubgraph` opts out of `showRevealLoader`** and uses `showLabels={true}` via `KnowledgeGraph` props — clean prop-driven variants without touching the shared component.
- **`DetailLayout.headerRight`** slot handled the toggle cleanly; no layout changes needed.
- **Tabler `IconTopologyStar3`** was already in `apps/mobile/node_modules/@tabler/icons-react-native` at the right version — no dep change.

### Shipped files

- New: `components/wiki/graph/layout/fitBounds.ts`, `components/wiki/graph/layout/neighborhood.ts`, `components/wiki/graph/NodeDetailModal.tsx`, `components/wiki/graph/WikiDetailSubgraph.tsx`, `components/wiki/graph/graphStateCache.ts`
- Modified: `components/wiki/graph/KnowledgeGraph.tsx`, `components/wiki/graph/GraphCanvas.tsx`, `components/wiki/graph/WikiGraphView.tsx`, `components/wiki/graph/hooks/useForceSimulation.ts`, `components/wiki/graph/hooks/useGraphCamera.ts`, `components/wiki/graph/index.ts`, `components/layout/detail-layout.tsx`, `app/(tabs)/index.tsx`, `app/wiki/[type]/[slug].tsx`
- Deleted: `components/wiki/graph/NodeDetailSheet.tsx` (Unit 2 swap)

### Things worth knowing before touching the graph again

1. **The reveal is two effects, not one.** If you add a new condition to when reveal should fire, add it to the `[preRevealComplete, size, subgraph, camera]` effect, not the mount-only timer effect.
2. **State preservation is three layers**: module cache (across unmounts), `prevInternalRef` (across urql re-emits within a session), and `useForceSimulation`'s "all-preseeded" detection (keeps d3 from agitating restored positions). Break any one and the graph resets on nav.
3. **Node positions mutate in place.** Every path that consumes `subgraph.nodes` is reading mutated refs. If you cache or memoize on a shallow diff, you'll miss updates.
4. **`isWikiPageType` in the route is case-sensitive uppercase.** If you build a URL to `/wiki/[type]/[slug]`, pass `ENTITY` / `TOPIC` / `DECISION` as-is, not lowercase. Lowercase → "Not found".
5. **Camera shared values are stable across renders via `useMemo`** in `useGraphCamera`. Depending on `camera` in a `useEffect` is safe — it doesn't re-fire every 30Hz render.

---

## Overview

Four bounded refinements to the v1 Wiki force-graph viewer (shipped 2026-04-20 per `docs/plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md`). Mobile-only. No new backend. Two visual polish units, one new surface on the detail screen, one icon swap.

## Problem Frame

Real-device feedback on the shipped graph surfaced four UX gaps:

1. **Initial camera is too zoomed in.** `useGraphCamera` starts at `scale = 1` and translates to `(width/2, height/2)`. d3-force is centered at `(0, 0)`, so the sim drops nodes into `[-W, +W] × [-H, +H]` world space before settling, and the user sees only the middle slice at first paint. The user wants the camera to "zoom out slowly as nodes load" so the full extent becomes visible once the sim quiesces.
2. **Tap → bottom sheet conflicts with the rest of the app.** Every other drill-down path (`/wiki/[type]/[slug]`, connected-page tiles, backlinks, markdown wiki-links) goes to the full detail screen with the shared `DetailLayout` chrome. The graph alone pops a `NodeDetailSheet` — two different patterns for the same "inspect this page" intent. User wants the full detail screen.
3. **Detail screen is text-only.** Once on a page, there's no way to see its neighborhood. A 1-hop subgraph around the current page (reusing the existing `KnowledgeGraph` component) would keep the drill-down visually coherent with the home-tab graph view.
4. **Toggle icon inconsistent with the rest of the app's visual vocabulary.** Home-tab toggle currently uses lucide `Network` / `List` — the user wants `IconTopologyStar3` from the Tabler pack (already bundled), and wants the same icon on the new detail-screen toggle for consistency.

## Scope and Non-Goals

**In scope.**
- Fit-to-view on sim-settle, animated via Reanimated shared values.
- Route all graph-node taps through `router.push("/wiki/[type]/[slug]")`; delete / retire `NodeDetailSheet`.
- Add a `headerRight` toggle on the wiki detail screen that swaps the body between text view and an embedded `KnowledgeGraph` scoped to a 1-hop neighborhood of the current page.
- Swap both toggle icons (home tab + detail screen) to `IconTopologyStar3`.

**Out of scope.**
- Compile-side link densification (owned by `docs/plans/2026-04-20-014-feat-compile-link-densification-plan.md`).
- Node pinning, temporal scrub, LOD labels, edge tap — still parked per the parent plan.
- Any backend / schema change. 1-hop neighborhood is derived client-side from the existing `wikiGraph` payload.
- Web target: all four units are `apps/mobile` only.

## Success Criteria

- On home-tab toggle into graph view, within ~1s of sim-settle the camera has translated + scaled so every node fits inside the viewport with ~10% padding on each edge. Pan / pinch immediately after still feel natural (no post-animation snap).
- Tapping a node in the home-tab graph (or the embedded detail-screen subgraph) navigates to `/wiki/[type]/[slug]?agentId=…` via `router.push`. No bottom sheet appears.
- On any wiki detail screen, the header-right toggle is off by default. Turning it on replaces the text body with a KnowledgeGraph containing the current page + its 1-hop neighbors + the edges among that set. Tapping a neighbor navigates to that neighbor's detail screen (replacing the current one so the back stack stays shallow).
- Both toggle icons (home tab + detail) render as `IconTopologyStar3` in the correct accent color for the current state.
- `pnpm --filter mobile typecheck` + lint are clean. Manual iOS Simulator smoke covers: toggle on home, tap a node, arrive at detail, toggle the embedded graph, tap a neighbor, back button returns correctly.

## Requirements Traceability

| Requirement | Source | Implementation Unit |
|---|---|---|
| Slow zoom-out as nodes settle | User prompt §1 | Unit 1 |
| Tap opens detail screen, not bottom sheet | User prompt §2 | Unit 2 |
| Embedded subgraph in detail with toggle (off by default, upper right) | User prompt §3 | Unit 3 |
| `IconTopologyStar3` on homepage + detail toggles | User prompt §4 | Unit 4 |

## Architectural Context

- **Camera (`apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts`)** owns `tx`, `ty`, `scale` as Reanimated shared values; gestures mutate them. All animation can stay on the UI thread via `withTiming` from `react-native-reanimated`.
- **Sim (`apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts`)** mutates `node.x` / `node.y` in place and calls `sim.stop()` when `alpha < 0.01`. This is the existing "layout settled" signal — Unit 1 hooks into it.
- **`WikiGraphView`** is the composition root: data → adapter → `KnowledgeGraph` + `NodeDetailSheet`. Unit 2 removes the sheet; Unit 3 re-uses `KnowledgeGraph` and `useWikiGraph` with a client-side 1-hop filter.
- **`DetailLayout`** (`apps/mobile/components/layout/detail-layout.tsx`) already accepts a `headerRight` slot — no layout changes needed for Unit 3's toggle.
- **`@tabler/icons-react-native` ^3.37.1** is already in `apps/mobile/package.json`; `IconTopologyStar3.mjs` is present under `node_modules`. No dependency change in Unit 4.

## Risks and Decisions

- **Fit animation vs. first user gesture race.** If the user starts panning/pinching before the fit-animation finishes, `withTiming` will race with the gesture. Decision: use `cancelAnimation(tx)` / `cancelAnimation(ty)` / `cancelAnimation(scale)` at the start of pan/pinch `onStart` so gestures always win. Accept the visual "snap-out of animation, into drag."
- **1-hop filter scale.** Agent graphs are ≤~850 nodes (per link-density data in the parent plan). A detail-screen 1-hop neighborhood is typically <30 nodes. Filtering client-side from the cached `wikiGraph` payload is trivial; no need to restore the deleted `wikiSubgraph` resolver. Decision: filter in `useMemo`, keyed on `(page.id, graph)`.
- **Empty-neighborhood detail graph.** Floating islands will yield "just this one node." Decision: render the single node centered; surface a muted line like "No connected pages yet" beneath. Do not block the toggle.
- **`NodeDetailSheet` deletion vs. retention.** It's currently only consumed by `WikiGraphView`. Decision: delete the file and drop the barrel re-export in `apps/mobile/components/wiki/graph/index.ts`. Keep `useWikiPage` usage in the real detail screen untouched. Git history preserves the sheet if we ever want it back.
- **`KnowledgeGraph` camera ownership inside a smaller container.** The existing component reads `useWindowDimensions()` for initial camera centering. For the embedded detail-screen variant, the viewport is a bounded `View`, not the full window. Decision: make `KnowledgeGraph` accept optional `viewportSize?: { width: number; height: number }`; default to `useWindowDimensions()` when absent. This keeps the home-tab call site unchanged.
- **`cancelAnimation` import.** Reanimated 4 exports `cancelAnimation` from `react-native-reanimated`. Verified API exists; no version risk.

## Execution Posture

Straightforward polish work. No test-first requirement — unit-level tests for the fit-math helper in Unit 1 are the only place a pure unit test adds real value. Everything else is verified on simulator.

## Implementation Units

### Unit 1 — Auto-fit camera on sim-settle

**Goal.** After the sim quiesces, animate the camera so every node fits inside the viewport with ~10% padding. Let subsequent gestures cancel the animation.

**Files.**
- `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` — expose a settled signal (tick counter already present; add an `onSettle` callback prop or a `settled: boolean` return flag). Prefer a `settled` boolean flipped on `alpha < QUIESCE_ALPHA`.
- `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts` — add `animateTo({ tx, ty, scale }, duration?)` helper that calls `withTiming` on all three shared values. Gesture `onStart` handlers call `cancelAnimation` on each before reading `.value`.
- `apps/mobile/components/wiki/graph/layout/fitBounds.ts` — **new pure module.** Exports `computeFit(nodes, viewportWidth, viewportHeight, paddingPct=0.1): { tx, ty, scale }`. Handles: single node (keep `scale=1`, center), zero-extent cluster (fallback to default), honors `SCALE_MIN` / `SCALE_MAX` bounds.
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` — after sim reports settled, call `camera.animateTo(computeFit(subgraph.nodes, width, height))` once per `(subgraph, viewportSize)` identity.
- `apps/mobile/components/wiki/graph/layout/fitBounds.test.ts` — **new test file.** Unit-test the math.

**Decisions.**
- Fit runs **once per subgraph identity**, not continuously. Refitting on every sim tick fights the user. A `useRef<boolean>` guard + `useEffect` keyed on `settled && subgraph` is sufficient.
- Animation duration: 600ms with `Easing.out(Easing.cubic)`. Captured as constants in `useGraphCamera.ts`.
- `computeFit` is pure and deterministic — trivial to unit-test.

**Test scenarios (for `fitBounds.test.ts`).**
- Many nodes in a bounded extent: returns `scale < 1`; world-center maps to viewport-center; padding honored.
- Single node: returns `scale = 1`; node lands on viewport-center.
- Zero nodes: returns identity `(tx = viewportWidth/2, ty = viewportHeight/2, scale = 1)`.
- Extent that would require `scale < SCALE_MIN`: clamped to `SCALE_MIN`.
- Extent that would require `scale > SCALE_MAX`: clamped to `SCALE_MAX`.
- Horizontal-dominant cluster vs. vertical-dominant cluster: chooses the tighter of the two axis ratios so both fit.

**Manual verification.**
- Cold-open graph view on Marco (261 nodes): camera visibly zooms out over ~600ms, final frame shows every node inside viewport with margin.
- Cold-open on Cruz (10 nodes): still zooms to fit; doesn't over-magnify (respects `SCALE_MAX`).
- Start panning 100ms after sim settles: fit animation cancels cleanly, pan tracks finger from the current (mid-animation) camera position.

---

### Unit 2 — Tap node navigates to detail screen

**Goal.** Replace `NodeDetailSheet` with `router.push("/wiki/[type]/[slug]?agentId=…")`.

**Files.**
- `apps/mobile/components/wiki/graph/WikiGraphView.tsx` — remove `NodeDetailSheet` usage, remove `selectedNodeId` state (selection is transient now), wire `onSelectNode` → `router.push`. Keep `dimmedNodeIds` + search behavior unchanged.
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` — `selectedNodeId` prop becomes optional (defaults to `null`) so the caller can drop it without breaking the selection ring code path (ring renders only when set).
- `apps/mobile/components/wiki/graph/NodeDetailSheet.tsx` — **delete.**
- `apps/mobile/components/wiki/graph/index.ts` — remove the `NodeDetailSheet` re-export.
- `apps/mobile/package.json` — leave `@gorhom/bottom-sheet` in place (may still be used elsewhere; verify and only remove if no remaining imports).

**Decisions.**
- Use `router.push`, not `router.replace`. Users returning from a tapped-node detail back to the graph expect the back button to land on the graph, and the graph's sim state (node positions) will be preserved because the home tab stays mounted.
- Preserve the `?agentId=…` query param exactly as the existing `NodeDetailSheet.onFocusHere` flow encodes it — the detail screen's `useWikiPage` + `useWikiConnectedPages` depend on it.
- `selectedNodeId` can stay in `KnowledgeGraph` as internal transient state (set on tap, cleared on mount) so the selection ring still flashes briefly before navigation — but the simpler implementation is to skip the ring entirely during the handoff to nav. Decision: skip the ring for now; the screen transition is the feedback. Revisit if users report the tap feels unresponsive.

**Test scenarios (manual).**
- Tap a node on Marco: detail screen opens on the right page (verify header title matches tapped node's label).
- Back button returns to the home tab's graph view with camera state preserved (nodes haven't re-run sim from scratch).
- Rapid double-tap on different nodes: only one navigation fires (Expo Router dedup or accept last-tap-wins).
- Tap in empty space: no navigation, no error (existing `nearestNode` returns null, we no-op).

---

### Unit 3 — Subgraph-in-detail toggle

**Goal.** Add an off-by-default header-right toggle on the wiki detail screen. When on, replace the text body with a `KnowledgeGraph` containing the current page + its 1-hop neighbors.

**Files.**
- `apps/mobile/app/wiki/[type]/[slug].tsx` —
  - Add `const [showGraph, setShowGraph] = useState(false)`.
  - Pass a `Pressable` wrapping `IconTopologyStar3` to `DetailLayout.headerRight`. Accent color when `showGraph` is true, muted when false.
  - Gate the `ScrollView` body behind `!showGraph`; render `<WikiDetailSubgraph pageId={page.id} tenantId={tenantId} ownerId={ownerId} />` when `showGraph && page`.
- `apps/mobile/components/wiki/graph/WikiDetailSubgraph.tsx` — **new.** Fetches the full agent graph via `useWikiGraph`, filters to 1-hop neighborhood of `pageId`, adapts to `WikiSubgraph`, renders `<KnowledgeGraph>` bounded to its container. Handles loading, empty-neighborhood, and tap-to-navigate (uses `router.replace` to swap the current detail screen with the neighbor's — keeps back stack shallow).
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` — accept optional `viewportSize?: { width: number; height: number }`. When provided, camera initialization uses it; when absent, falls back to `useWindowDimensions()` (current behavior).
- `apps/mobile/components/wiki/graph/index.ts` — re-export `WikiDetailSubgraph`.
- `apps/mobile/components/wiki/graph/layout/neighborhood.ts` — **new pure module.** Exports `oneHopNeighborhood(graph: WikiGraphPayload, pageId: string): WikiGraphPayload`. Returns the page + all directly-connected neighbors + all edges where both endpoints are in the returned set.
- `apps/mobile/components/wiki/graph/layout/neighborhood.test.ts` — **new test file.**

**Decisions.**
- **Reuse `useWikiGraph`, don't restore `wikiSubgraph`.** The parent plan deleted the `wikiSubgraph` resolver/hook in PR #281 specifically because client-side filtering is cheap. Agent graphs are ≤850 nodes; filtering a hash map lookup is microseconds. Any graph size that *would* break client-side filtering also breaks `useWikiGraph`, so both fail at the same point — no lever.
- **`router.replace` vs. `router.push` for neighbor taps.** From inside a detail subgraph, tapping a neighbor should feel like drilling sideways, not deeper. `replace` keeps the back button behavior intuitive (back → home tab, not back → previous detail → previous-previous detail). If users push back against this, swap to `push`.
- **Toggle state resets per navigation.** `useState(false)` inside the detail screen component means every new detail opens with the subgraph off. This is the "off by default" the user asked for and matches the cognitive model.
- **Viewport sizing.** Use `onLayout` on the container `View` to capture `{width, height}`, then pass to `KnowledgeGraph`. This avoids the camera centering on the full window when the actual canvas is smaller (e.g., accounting for header chrome).
- **Search-filter reuse.** The detail subgraph does not need a search filter in v1 — user is already focused on one page.

**Test scenarios.**
- `neighborhood.test.ts`:
  - Page with zero links: returns `{nodes: [page], edges: []}`.
  - Page with 3 outgoing + 2 incoming links: returns the page + 5 neighbors + 5 edges. Edges between two neighbors that both happen to be in the set are **included** (the rendering looks right when the neighborhood is already a cluster).
  - Page id not in `graph.nodes`: returns `{nodes: [], edges: []}`. The detail-subgraph component should render the empty-state copy, not crash.
  - Self-loop edge (`source === target`): included if both endpoints are the page itself.
- Manual: on a well-linked page (from Marco's 70%-linked pages), toggle on → subgraph with a handful of nodes renders inside the detail chrome; tap a neighbor → navigate to that neighbor; toggle off → text body returns.
- Manual: on a floating-island page (from GiGi's 30%+), toggle on → single-node render + muted "No connected pages yet" copy; toggle off restores text.

**Test file paths.**
- `apps/mobile/components/wiki/graph/layout/fitBounds.test.ts` (Unit 1)
- `apps/mobile/components/wiki/graph/layout/neighborhood.test.ts` (Unit 3)

---

### Unit 4 — Tabler `IconTopologyStar3` icon swap

**Goal.** Replace the lucide `Network` / `List` toggle icons on the home tab with a single `IconTopologyStar3` that tints based on state, and use the same icon for the new detail-screen toggle.

**Files.**
- `apps/mobile/app/(tabs)/index.tsx` —
  - Remove `Network`, `List as ListIcon` from the lucide import (keep the rest).
  - Add `import { IconTopologyStar3 } from "@tabler/icons-react-native"`.
  - Replace the conditional `Network` / `ListIcon` render with a single `<IconTopologyStar3 size={22} color={wikiViewMode === "graph" ? colors.primary : colors.foreground} stroke={2} />`.
  - Update `accessibilityLabel` wording unchanged.
- `apps/mobile/app/wiki/[type]/[slug].tsx` — reuse the same `IconTopologyStar3` for the new Unit 3 toggle, matching the accent/muted color convention.

**Decisions.**
- **Single icon with color state**, not two icons. Tabler's single topology icon conveys "graph" regardless of current state; color + accessibility label tell the user whether it's on. Matches the pattern the existing Filter icon uses (tint changes with `filtersOpen && hasActiveFilters`).
- **Stroke width 2** to match the SVG the user pasted. Tabler's React Native component accepts `stroke` — default is fine but we pin it explicitly to avoid drift.
- **No need to restyle the press target** — the existing `p-2` + `accessibilityRole="button"` wrapper stays.

**Test scenarios (manual).**
- Home tab in list mode: icon renders muted (foreground color).
- Home tab in graph mode: icon renders accent (primary color).
- Detail screen with subgraph off: icon muted.
- Detail screen with subgraph on: icon accent.
- Screen reader reads the correct "Switch to graph view" / "Switch to list view" (home) and matching labels on detail.

---

## Dependencies and Sequencing

- Unit 1 (fit-to-view) is independent; can ship first.
- Unit 2 (tap → detail) is independent; touches `WikiGraphView` only.
- Unit 3 (subgraph-in-detail) depends on Unit 2's nav pattern for neighbor taps inside the embedded graph, and on `KnowledgeGraph`'s optional `viewportSize` prop. Ship after Unit 2.
- Unit 4 (icon swap) is independent visually but the detail-screen half depends on Unit 3 existing (there's no toggle to put an icon on until Unit 3 lands). Ship Unit 4's home-tab half any time; bundle the detail-screen half with Unit 3 or immediately after.

**Suggested PR order.** 1 → 2 → 3 → 4. Each as a separate PR to `main`, squash-merged, branch auto-deleted (per repo convention: `feedback_pr_target_main.md`). Worktree per PR (per `feedback_worktree_isolation.md`).

## Testing Strategy

- **Unit tests** where the math is pure and worth locking down: `fitBounds.test.ts`, `neighborhood.test.ts`.
- **Typecheck** via `pnpm --filter mobile typecheck` on every unit.
- **Lint** via `pnpm --filter mobile lint`.
- **Simulator smoke** per unit's "Manual verification" section. No automated UI tests planned — the existing graph surface has none and adding a test harness is out of scope for polish work.
- **TestFlight build** after Unit 4 lands to dogfood on-device.

## Patterns and References

- Existing force-graph architecture: `docs/plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md` §"What shipped".
- `DetailLayout.headerRight` usage: any `apps/mobile/app/settings/**` screen that passes a header-right button.
- Reanimated `withTiming` + `cancelAnimation` — standard patterns; see `react-native-reanimated` v4 docs.
- Tabler icon usage: `apps/mobile/components/wiki/WikiList.tsx` (`IconBrain`), `apps/mobile/components/chat/ChatScreen.tsx` (`IconHistory`).

## Follow-Ups and Parking Lot

- **Selection-ring flash on tap.** Dropped in Unit 2 for simplicity. Revisit if tap feels unresponsive on-device.
- **Search filter inside detail subgraph.** Not built. Reconsider if users report neighborhood clutter on well-connected pages.
- **Fit-to-view on sim-restart.** Unit 1 fits once per subgraph identity. If a future feature triggers `simulation.restart()` (e.g., node pinning), the fit logic needs to re-fire. Out of scope for this pass.
- **Deeper detail-subgraph (2-hop).** v1 is 1-hop. If users report "not enough context," iterate on the neighborhood helper — it's already factored out.
