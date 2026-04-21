---
title: "feat: Mobile wiki graph label toggle"
type: feat
status: active
date: 2026-04-20
---

# feat: Mobile wiki graph label toggle

## Overview

Add a header-level toggle on the mobile Wiki tab's constellation view that turns on labels (and a label-friendly force layout) so users can browse and explore their knowledge graph the same way the page-detail subgraph already supports today. The toggle is a Tabler `IconLetterCase` button placed alongside the existing list ↔ graph view switcher and is only visible when the constellation is showing.

## Problem Frame

The dense unlabeled constellation looks impressive but is browsing-hostile: every node is a blue dot, and the only navigation is "tap a dot and hope." The detail-page 1-hop subgraph (`WikiDetailSubgraph`) already proves the labeled, more-spaced rendering works well — `KnowledgeGraph` accepts both a `showLabels` prop and a `simConfig` prop, and `GraphCanvas` already draws labels — the capability is in the renderer; the main agent graph just never opts in. This plan exposes the existing capability behind a user-controlled toggle so the same surface flips between "pretty constellation" and "browseable map."

This is intentionally a narrow tactical change. The larger `docs/brainstorms/2026-04-20-mobile-wiki-browse-feature-requirements.md` Browse redesign (Hub Launchpad, signal strips, etc.) is a separate effort and explicitly leaves the constellation unchanged in its v1 (R10). This plan does not block, depend on, or duplicate that work.

## Requirements Trace

- R1. When the Wiki tab is showing the constellation (graph) view, the header shows a label-toggle button using Tabler's `IconLetterCase`, positioned to the immediate right of the existing list ↔ graph toggle.
- R2. Tapping the label-toggle flips a `wikiShowLabels` state; the icon's color follows the same active/inactive convention as the existing filter button (primary color when active, foreground color when inactive).
- R3. When labels are on, each visible node renders its title beneath it (already supported by `GraphCanvas`'s `showLabels` path) and the force simulation uses a label-friendly config — longer link distance, stronger charge, larger collide radius — so labels do not overlap adjacent nodes.
- R4. Toggling labels on or off triggers a re-layout: the existing node positions seed the new sim, but the sim restarts with enough alpha that nodes re-distribute under the new forces (otherwise the preseeded-quiesce branch in `useForceSimulation` would freeze the layout immediately and the new config would have no visible effect).
- R5. The label-toggle state is local to the screen instance; switching to the list view and back, or toggling search, preserves it during the same session. Cold-app launches start with labels off (matching the current default).
- R6. The toggle has no effect when the list view is active; the icon is not rendered in that case.

## Scope Boundaries

- Not changing label rendering itself (font, truncation, gap) — `GraphCanvas` already does this.
- Not changing the detail-screen subgraph behavior — `WikiDetailSubgraph` keeps its hardcoded `showLabels` and `simConfig`.
- Not adding a "labels on by default" preference or admin setting — defaults stay off.
- Not persisting the toggle across cold app launches; in-session is enough for v1.
- Not changing the search/filter 3-state rendering. Labels continue to render only for `matched` nodes (existing behavior in `GraphCanvas`), so when a search is active and labels are on, only matched nodes show titles.
- Not introducing cluster-derived labels (that is R11 of the larger Browse brainstorm and is explicitly out of scope here).
- Not changing the wide-layout (`isWide`) header (`TabHeader`); the toggle is mobile-narrow-layout only, matching the existing graph/list toggle.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/app/(tabs)/index.tsx` lines 402-425 — current Wiki-tab header strip with the list ↔ graph toggle (`wikiViewMode`). The new icon goes in the same `<View className="flex-row items-center gap-3">` cluster, adjacent to (and behind the same `activeTab === "wiki"` gate as) the existing toggle.
- `apps/mobile/app/(tabs)/index.tsx` line 33 — existing Tabler import: `import { IconTopologyStar3, IconList } from "@tabler/icons-react-native";`. Add `IconLetterCase` to the same import line.
- `apps/mobile/app/(tabs)/index.tsx` line 259 — `wikiViewMode` `useState` declaration; declare the new `wikiShowLabels` state immediately below it.
- `apps/mobile/app/(tabs)/index.tsx` lines 546-551 — `WikiGraphView` mount site; pass the new `showLabels` prop here.
- `apps/mobile/components/wiki/graph/WikiGraphView.tsx` — accept and forward a new optional `showLabels?: boolean` prop to `KnowledgeGraph`. Also forward a label-mode `simConfig` derived from that flag.
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` — already supports `showLabels` and `simConfig`. Add an effect that calls the sim's `restart(...)` when `showLabels` flips so the relayout actually runs (see Key Technical Decisions).
- `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` lines 48-92 — current defaults (`linkDistance=60`, `chargeStrength=-130`, `collideRadius=22`, `xyStrength=0.08`) and the preseeded-quiesce branch that motivates R4. The `restart(alpha)` it returns at line 117 is the lever we need.
- `apps/mobile/components/wiki/graph/WikiDetailSubgraph.tsx` lines 113-118 — known-good label-friendly config used by the detail subgraph (`linkDistance: 90`, `chargeStrength: -260`, `collideRadius: 42`, `xyStrength: 0.04`). Use as the starting point for the main-graph label config; tune slightly looser for the much larger node count.
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx` lines 199-216 — labels already render only for `matched` nodes (filter-aware), exactly the behavior we want under R5.

### Institutional Learnings

- `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md` — search filtering deliberately *does not* restart the sim, so panning/positions stay stable. The label toggle is a different case: changing sim parameters without restarting would simply have no effect (preseeded-quiesce). The "no restart" pattern still applies to filter changes; this plan only restarts on the label-mode flip.
- `docs/brainstorms/2026-04-20-mobile-wiki-browse-feature-requirements.md` (related, not origin) — confirms the constellation is intentionally untouched by the larger Browse redesign in v1, so this tactical improvement is non-conflicting and lands ahead of that work.

### External References

None — the change is fully internal and reuses already-imported libraries (`@tabler/icons-react-native@3.41.1` is in `apps/mobile/package.json` and the `IconLetterCase` glyph is present in the installed dist's icon list).

## Key Technical Decisions

- **Relayout trigger lives in `KnowledgeGraph`, not the parent.** When the new `showLabels` prop changes, `KnowledgeGraph` calls `restart(0.5)` from `useForceSimulation`'s return value in a `useEffect` keyed on `showLabels`. **Why:** `useForceSimulation`'s effect tears down + rebuilds the sim whenever `simConfig` values change (line 112), but its preseeded branch (lines 60-69 + 88-93) immediately quiesces the new sim because every node still has x/y from the previous layout. Without an explicit restart, the new link/charge/collide values would never actually push the nodes apart, and the toggle would visibly do nothing except turn text on. Skipping the first-mount restart (use a ref guarded by "labels has changed") avoids interfering with the existing reveal-fit animation.
- **No new key in `graphStateCache`.** The cache stores positions keyed only by `${tenantId}:${agentId}`. After the relayout, the new positions overwrite the old on the next save. This means the very first toggle in a session may "snap" to the new layout, but this is a one-time cost per direction-change, not a regression. **Why:** Adding a label-mode dimension to the cache key would mean each direction-change starts from random positions, which is worse than reusing positions and re-settling.
- **Label-mode sim values: start from `WikiDetailSubgraph`'s and loosen.** Detail subgraph uses `linkDistance: 90, chargeStrength: -260, collideRadius: 42, xyStrength: 0.04` for ~10-30 nodes. The main agent graph routinely has 100-200 nodes; raise `chargeStrength` and `collideRadius` slightly so labels (~18 chars × 11pt ≈ 100px wide) don't collide. Treat the exact numbers as a tuning task during implementation; final values are not knowable without seeing real test data on a tenant graph.
- **In-session toggle state, not persisted.** `wikiViewMode` is also component-local; matching that convention keeps both toggles consistent. AsyncStorage persistence is a follow-up if users complain.
- **Keep the toggle narrow-layout-only.** The wide layout uses `TabHeader` (no inline icons today). Adding icons there is a different design exercise and not needed for the user's reported pain.

## Open Questions

### Resolved During Planning

- *Where does the new icon live?* In the existing right-side icon cluster (`<View className="flex-row items-center gap-3">`), gated by the same `activeTab === "wiki"` check the current graph/list toggle uses, with an additional inner gate on `wikiViewMode === "graph"` so it disappears in list mode (R6).
- *Does the renderer already support labels?* Yes — `KnowledgeGraph` already accepts `showLabels`/`simConfig` and `GraphCanvas` already renders the labels (filter-aware). No renderer changes are needed.
- *How is the toggle's active visual state expressed?* Same convention as the filter button at line 430 (primary color when active, foreground color when inactive). No background pill needed; matches the existing icon-row visual rhythm.
- *Should labels show for non-matched nodes when search is active?* No — keep `GraphCanvas`'s existing behavior (labels only on `matched`). Labeling muted nodes would defeat the search filter's de-emphasis intent.

### Deferred to Implementation

- Final label-mode `simConfig` numeric values. Should be tuned against a real tenant graph during implementation; the starting point is `linkDistance: 110, chargeStrength: -340, collideRadius: 52, xyStrength: 0.04`, but adjust until labels in the densest cluster (orange hub nodes) don't collide with neighbors at default zoom.
- Whether to slightly slow camera fit-animation when relayout happens during a toggle, or just rely on the existing fit-on-size-change branch. Most likely the existing fit will not run (size doesn't change), so the user will see the nodes settle in place — that may be the right behavior; revisit if the settle-in-place feels janky in TestFlight.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
[apps/mobile/app/(tabs)/index.tsx]
  state: wikiShowLabels (boolean, default false)
  header (narrow only, when activeTab === "wiki" AND wikiViewMode === "graph"):
    [IconLetterCase] -> toggles wikiShowLabels (color = primary when true, foreground when false)
  body (when wikiViewMode === "graph"):
    <WikiGraphView ... showLabels={wikiShowLabels} />

[apps/mobile/components/wiki/graph/WikiGraphView.tsx]
  prop: showLabels?: boolean
  passes: <KnowledgeGraph
            showLabels={showLabels}
            simConfig={showLabels ? LABEL_MODE_SIM_CONFIG : undefined}
            ... />

[apps/mobile/components/wiki/graph/KnowledgeGraph.tsx]
  capture restart from useForceSimulation
  useEffect on [showLabels]:
    if not first render -> restart(~0.5)   // unblock preseeded-quiesce
```

## Implementation Units

- [ ] **Unit 1: Plumb `showLabels` prop through `WikiGraphView` to `KnowledgeGraph`**

**Goal:** Give the parent a way to flip the constellation into label mode without changing the renderer.

**Requirements:** R3, R5

**Dependencies:** None

**Files:**
- Modify: `apps/mobile/components/wiki/graph/WikiGraphView.tsx`

**Approach:**
- Add `showLabels?: boolean` to `WikiGraphViewProps` (default false).
- Define a module-level `LABEL_MODE_SIM_CONFIG` constant (object matching `SimConfig`) tuned for ~100-200 node main graphs. Start from `WikiDetailSubgraph`'s values and loosen as described in Key Technical Decisions.
- Pass `showLabels` through to `<KnowledgeGraph showLabels={...} simConfig={showLabels ? LABEL_MODE_SIM_CONFIG : undefined} />`.
- Do not change anything else (filter logic, sub-modal, refetch behavior).

**Patterns to follow:**
- `apps/mobile/components/wiki/graph/WikiDetailSubgraph.tsx` lines 105-119 — same `KnowledgeGraph` invocation shape with `showLabels` + `simConfig`.

**Test scenarios:**
- Happy path: When `showLabels={true}` is passed, `KnowledgeGraph` receives `showLabels={true}` and a non-undefined `simConfig` whose values match `LABEL_MODE_SIM_CONFIG`.
- Happy path: When `showLabels` is omitted or `false`, `KnowledgeGraph` receives `showLabels={false}` and `simConfig={undefined}` (preserving today's defaults).
- Edge case: Rapidly toggling the prop in/out does not throw — the renderer remains mounted.

**Verification:** A manual prop flip in the parent visibly changes labels and node spacing in the constellation.

- [ ] **Unit 2: Trigger sim relayout when `showLabels` changes in `KnowledgeGraph`**

**Goal:** Make the new sim config actually take effect on toggle, instead of being immediately quiesced by the preseeded branch.

**Requirements:** R4

**Dependencies:** Unit 1 (so the prop exists to react to)

**Files:**
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx`

**Approach:**
- Capture the return value of `useForceSimulation(...)` (currently discarded at line 102) — specifically the `restart` function.
- Add a `useEffect` keyed on `[showLabels]` that:
  - Skips on first render (use a ref initialized to `false` and flipped to `true` after the first run, or compare against a `prevShowLabelsRef`). This avoids stomping the existing reveal-fit animation.
  - On subsequent toggles, calls `restart(0.5)` so the freshly built sim gets enough alpha to re-distribute nodes under the new forces.
- Do not change the reveal/fit logic, the camera state, or the position-cache snapshot logic. The relayout uses the existing positions as seed and lets the sim find a new resting state in place.

**Patterns to follow:**
- `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` lines 117-119 — `restart(alpha)` API; the `0.3` default is the conventional re-heat value, `0.5` here gives label mode a bit more travel.
- The "skip first render" guard is a vanilla `useRef(false)` + flip-after-effect pattern; do not reach for a library.

**Test scenarios:**
- Happy path: With labels off (default), mounting the constellation shows the same dense unlabeled layout it does today (no regression). The relayout effect does not fire on first mount.
- Happy path: Toggling labels on visibly spreads nodes and shows titles within ~1s; the camera does not jump.
- Happy path: Toggling labels off re-tightens the layout to roughly the original spacing; titles disappear.
- Edge case: Toggling labels on, then off, then on again within 2 seconds does not cause crashes, NaN positions, or runaway alpha; each toggle restarts the sim.
- Edge case: Toggling labels while a search filter is active continues to dim non-matched nodes correctly and only labels matched ones (verifies the relayout did not break filter-aware label rendering in `GraphCanvas`).
- Integration: After toggling labels and unmounting/remounting (e.g. drilling into a detail screen and back), the cached positions are the most-recent label-mode positions — confirming the existing `graphStateCache` snapshot path still works after restart.

**Verification:** Manual TestFlight check on a tenant graph with 100+ pages: labels are readable, do not overlap node disks, and the layout settles within ~1s of toggling.

- [ ] **Unit 3: Add the `IconLetterCase` header toggle and wire `wikiShowLabels` state**

**Goal:** Expose the toggle in the Wiki-tab header (narrow layout) so users can flip label mode without code changes.

**Requirements:** R1, R2, R5, R6

**Dependencies:** Unit 1 (the prop must exist to bind to)

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`

**Approach:**
- Add `IconLetterCase` to the existing Tabler import on line 33.
- Add a `wikiShowLabels` `useState<boolean>(false)` next to the existing `wikiViewMode` state declaration.
- In the right-side header icon cluster (lines 403-465), insert a new `<Pressable>` directly after the existing graph/list toggle, gated by both `activeTab === "wiki"` AND `wikiViewMode === "graph"`. The `Pressable` sets `wikiShowLabels` to its negation; renders `<IconLetterCase size={22} strokeWidth={2} color={wikiShowLabels ? colors.primary : colors.foreground} />`. Use `accessibilityRole="button"` and an `accessibilityLabel` that reflects the next state ("Show labels" / "Hide labels").
- Pass `showLabels={wikiShowLabels}` to `<WikiGraphView ... />` at line 547.
- Make no changes to the wide-layout `<TabHeader>` branch.

**Patterns to follow:**
- `apps/mobile/app/(tabs)/index.tsx` lines 405-425 — the existing graph/list `Pressable` is the structural model: same `className="p-2"`, same icon size/strokeWidth, same accessibility attributes.
- `apps/mobile/app/(tabs)/index.tsx` line 430 — the filter button's active-state color expression (`colors.primary` when active, `colors.foreground` otherwise) is the visual model for R2.

**Test scenarios:**
- Happy path: On the Wiki tab in graph mode, the header shows three icons (label-toggle, filter, overflow); the label-toggle icon is `IconLetterCase`.
- Happy path: Tapping the label-toggle flips the `IconLetterCase` color between primary and foreground and toggles labels in the constellation.
- Happy path: In list mode (`wikiViewMode === "list"`) the label-toggle is not rendered.
- Happy path: Switching to the Threads tab hides the label-toggle entirely (existing `activeTab === "wiki"` gate).
- Edge case: Toggling label mode, then list mode, then back to graph mode preserves the prior label state for the same screen instance (in-session persistence per R5).
- Edge case: With labels on, opening a wiki page detail and tapping back returns to the constellation with labels still on (the screen instance is the same; state survives the back navigation).
- Integration: With the search footer active and labels on, only matched nodes are labeled and the overall search dim/highlight behavior is unchanged from today.
- Edge case: VoiceOver reads the toggle's `accessibilityLabel` as the *next* action ("Show labels" when off, "Hide labels" when on), matching the convention of the existing graph/list toggle.

**Verification:** TestFlight build: tap the new icon on a real tenant graph; confirm the icon, the labels, the spread, and the active-color state all behave as described.

## System-Wide Impact

- **Interaction graph:** The label-toggle is a leaf control. It only feeds `wikiShowLabels` into `WikiGraphView` → `KnowledgeGraph`. No callbacks, observers, or middleware are touched.
- **Error propagation:** None — pure UI state. No new network calls or side-effecting writes.
- **State lifecycle risks:** The relayout-on-toggle interacts with `graphStateCache` snapshotting (`KnowledgeGraph.tsx` lines 187-204). The unmount-time snapshot writes whatever positions are current; if the user toggles labels and immediately unmounts, the snapshot will be a mid-relayout state. This is acceptable — the sim will continue from there on remount and quickly re-settle.
- **API surface parity:** None. Web admin's wiki graph (`apps/admin`) is a separate component tree; no parity required by this change. The detail-screen subgraph (`WikiDetailSubgraph`) is unaffected — it keeps its hardcoded `showLabels` and `simConfig`.
- **Integration coverage:** The Unit 2 "toggle while search active" scenario is the only cross-layer behavior worth manual verification — it touches the renderer's filter-aware label path, the sim restart, and the search-filter memo at the same time.
- **Unchanged invariants:** `WikiGraphView`'s search-filter memo, `useWikiGraph` data flow, refetch-on-mount behavior, and `NodeDetailModal` interaction are all unchanged. The unlabeled default rendering is unchanged for users who never tap the new toggle.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Label-mode sim values produce overlapping labels on dense hubs (orange nodes with 10+ neighbors). | Treat the starting numeric config as a tuning task; verify against a real tenant graph in TestFlight before merge. Bump `collideRadius` further if needed. |
| `restart(0.5)` causes the layout to drift visibly far from where the user left it, breaking spatial recognition. | The existing positions seed the new sim, so most nodes only travel a short distance. If drift is excessive, reduce alpha to `0.3` or lower. Tune in TestFlight. |
| Rapid toggling causes the sim to thrash and burn battery. | Each toggle just calls `restart(0.5)`; the existing 30Hz tick budget caps re-render cost. The auto-quiesce at `alpha < 0.01` (line 17) caps burn time per toggle to ~1-2 seconds. No additional debounce needed unless we see thermals. |
| Label rendering on web is broken because Skia's `matchFont` resolves a different font there. | `GraphCanvas.tsx` line 93 already uses `Platform.select({ ios: "Helvetica", default: "sans-serif" })` and the detail subgraph uses labels in production today, so the path is exercised. No new web risk. |

## Documentation / Operational Notes

- No backend changes, no migrations, no new resolver. No SSM/Lambda/Cognito impact.
- No README or `docs/` updates required; the change is self-explanatory in the UI.
- Demo reel for PR description: short GIF showing tap → labels appear → tap → labels disappear, plus one shot of the icon's primary-color active state.

## Sources & References

- Related (not origin): [docs/brainstorms/2026-04-20-mobile-wiki-browse-feature-requirements.md](../brainstorms/2026-04-20-mobile-wiki-browse-feature-requirements.md) — larger Wiki Browse redesign that explicitly leaves the constellation untouched in v1, so this tactical improvement does not conflict.
- Related learning: `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md` — explains why search filtering deliberately avoids sim restart; this plan's restart is scoped only to the label-mode flip.
- Related code:
  - `apps/mobile/app/(tabs)/index.tsx` — host of the Wiki tab header and `WikiGraphView` mount.
  - `apps/mobile/components/wiki/graph/WikiGraphView.tsx` — main constellation entry.
  - `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` — already supports `showLabels` + `simConfig`.
  - `apps/mobile/components/wiki/graph/WikiDetailSubgraph.tsx` — reference for label-mode `simConfig` shape.
  - `apps/mobile/components/wiki/graph/GraphCanvas.tsx` — label rendering already filter-aware.
  - `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` — preseeded-quiesce branch and `restart` lever.
- External: `@tabler/icons-react-native@3.41.1` (already installed); `IconLetterCase` is exported (`letter-case` present in `dist/esm/icons-list.mjs`).
