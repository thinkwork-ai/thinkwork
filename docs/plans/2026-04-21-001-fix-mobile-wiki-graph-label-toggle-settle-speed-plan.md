---
title: "fix: Speed up mobile wiki graph label-toggle settle"
type: fix
status: active
date: 2026-04-21
---

# fix: Speed up mobile wiki graph label-toggle settle

## Overview

When the Wiki tab's constellation has a large graph (~100-200 nodes) and the user flips the header label toggle, the new force config triggers a re-layout that visibly settles over 2–3 seconds. The sim is correct, just over-patient. Expose a handful of d3-force cooling knobs through `SimConfig`, tune the label-mode config to cool faster, and lower the label-toggle restart alpha. No behavior changes, no renderer changes — the animation just finishes sooner.

## Problem Frame

Toggling labels on the main graph (`apps/mobile/app/(tabs)/index.tsx` → `WikiGraphView` with `showLabels=true`) swaps in `LABEL_MODE_SIM_CONFIG` (`linkDistance: 110, chargeStrength: -340, collideRadius: 52, xyStrength: 0.04`). `useForceSimulation.ts` tears down the old sim and builds a new one; its preseeded-quiesce branch immediately stops ticks because every node still has `x/y`; `KnowledgeGraph.tsx` then calls `sim.restart(0.5)` so the new forces actually push the nodes apart (this wiring was added in PR #324 and is still correct — see `docs/plans/2026-04-20-011-feat-mobile-wiki-graph-label-toggle-plan.md`).

The slowness is purely how long d3-force takes from alpha=0.5 down to the hook's `QUIESCE_ALPHA=0.01` at d3's default `alphaDecay ≈ 0.0228` — about 170 ticks. At 30Hz render throttle (and d3's 60Hz internal timer), the user watches ~2.5–3s of drift before the graph is visibly still. Positions are already seeded from the previous layout, so the sim does not need a fresh "cold-start" budget — it only needs enough alpha to re-balance under the new forces, and it can cool much faster than d3's defaults.

The cooling knobs (`alphaDecay`, `velocityDecay`) already exist on d3-force and are safe to turn up for this specific case; the hook just does not expose them today.

## Requirements Trace

- R1. Toggling labels on a large main graph settles visibly faster than today — target "feels quick" (<1s of motion for a 150-node graph) without skipping the animated transition entirely.
- R2. The initial reveal-fit animation (cold mount, no labels) is not regressed — first-mount spread still has enough budget to separate d3's tight sunflower seed.
- R3. Label-mode layout quality is preserved: once settled, labels still do not visibly overlap at default zoom for the sizes we see in practice.
- R4. Label-off toggle (labels → no labels) settles at least as fast as label-on, since the target positions are closer to the current ones.
- R5. `WikiDetailSubgraph`'s label-mode cold-start on the 1-hop neighborhood is not regressed — users should continue to see the detail subgraph come up in roughly the current time (it is already acceptably fast).

## Scope Boundaries

- Not changing the renderer (`GraphCanvas.tsx`) — no label-layout, font, or styling changes.
- Not changing the toggle UX (icon, placement, activation color) — that shipped in PR #324 and is not in question.
- Not changing the three-layer persistence pattern (module cache + `prevInternalRef` + preseeded-quiesce) — the fix slots in between those layers.
- Not changing search-filter behavior or the "filter does not restart sim" invariant (`docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`).
- Not adding a user-visible "faster animation" setting — this is a tuning change, not a preference.
- Not switching away from d3-force or moving the sim off the JS thread — that is a much larger investment for a much larger payoff and is explicitly out of scope.
- Not adding synchronous pre-ticking (block the JS thread for N ticks before revealing the new layout). Considered, rejected — see Alternative Approaches.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` — owns the sim lifecycle. `SimConfig` (lines 18-27) is where the new knobs land. The construction chain (lines 75-86) is where `.alphaDecay(...)` / `.velocityDecay(...)` get applied. The quiesce gate (`QUIESCE_ALPHA = 0.01`, line 16; check at lines 102-105) defines "settled." The `restart(alpha)` return (lines 117-120) is the lever `KnowledgeGraph.tsx` pulls on toggle.
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` lines 111-116 — the effect that fires `sim.restart(0.5)` when `showLabels` flips. This is where the label-toggle restart alpha lives today and where it gets lowered.
- `apps/mobile/components/wiki/graph/WikiGraphView.tsx` lines 30-35 — `LABEL_MODE_SIM_CONFIG`. The right spot to set aggressive cooling for the main-graph label mode without affecting the default (no-label) config or the detail subgraph.
- `apps/mobile/components/wiki/graph/WikiDetailSubgraph.tsx` lines 113-118 — inline `simConfig` used by the 1-hop subgraph. Keep today's values unchanged so detail neighborhoods still spread the same way on first mount.
- d3-force defaults the implementation relies on: `alphaDecay ≈ 0.0228` (derived from `alphaMin = 0.001` over 300 iterations), `velocityDecay = 0.4`, `alphaTarget = 0`. Raising either decay cools the sim faster; raising `velocityDecay` also dampens per-tick motion so visible jitter settles before alpha even reaches the quiesce gate.

### Institutional Learnings

- `docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md` — the three-layer persistence pattern. Important here because Layer 3 (preseeded-quiesce) is the reason `sim.restart(0.5)` exists at all on the toggle path; the fix must keep that contract intact (don't remove the restart, just tune what it restarts *at*).
- `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md` — search filter changes deliberately never restart the sim. The label-toggle restart is an intentional exception; this plan keeps the exception bounded to that one case.

### External References

- d3-force README — `simulation.alphaDecay([decay])` and `simulation.velocityDecay([decay])`: both are safe, orthogonal knobs. Higher `alphaDecay` cools the temperature faster; higher `velocityDecay` damps per-tick motion more aggressively. Together they cut the tick count to visible-stillness without changing the steady-state layout quality.

## Key Technical Decisions

- **Expose `alphaDecay` and `velocityDecay` on `SimConfig`, don't bake them in.** `useForceSimulation` is also used by `WikiDetailSubgraph` (1-hop, small N) where the current feel is fine. Keeping the defaults unchanged and letting only the main-graph label mode opt into aggressive cooling avoids regressing the detail case. **Why:** blanket-changing the defaults would implicitly affect the detail subgraph's first-mount spread and would also change the main-graph's *unlabeled* cold-start feel, neither of which is the reported problem.
- **Start with `alphaDecay ≈ 0.06` and `velocityDecay ≈ 0.55` for label mode.** At `alpha(0.3).alphaDecay(0.06)`, `alpha` reaches 0.01 in ~55 ticks (~0.9s at 60Hz sim timer, <1s of visible motion). `velocityDecay = 0.55` keeps nodes from coasting past the new equilibrium. These are starting points — tune on-device during implementation; the implementer should expect a small iteration loop to land the final numbers.
- **Lower the label-toggle restart alpha from 0.5 to 0.3.** Positions are seeded, the sim only needs enough heat to re-balance under the new forces, not to cold-spread from random. **Why:** `0.5` predates the toggle-specific tuning and was a conservative guess; `0.3` still gives enough heat for `linkDistance 60→110` and `chargeStrength −130→−340` to visibly spread nodes, and shaves ~25 ticks off the settle time before any decay change.
- **Leave `QUIESCE_ALPHA` alone.** Raising it is tempting (stops React re-renders sooner) but the gate lives in the tick handler and affects every sim path, including cold reveal. Let `alphaDecay` do the work of ending the animation sooner. **Why:** one knob that only affects the case we care about beats one global knob that also affects cold-start.
- **Do not pre-tick synchronously.** Running `for (let i=0; i<N; i++) sim.tick()` on the JS thread before revealing the new layout would be nearly instant visually but would block interaction for hundreds of ms at 150+ nodes. The animated settle is a feature here, not a bug — users see the graph "reorganize" rather than "pop" to a new state.

## Open Questions

### Resolved During Planning

- *Does this change the toggle's correctness contract?* No. `KnowledgeGraph` still calls `sim.restart(...)` on label flip; the sim still settles to the same equilibrium. Only the cooling schedule shortens.
- *Does the detail subgraph need the same tuning?* No — `WikiDetailSubgraph` passes its own inline `simConfig` without the new fields, so it falls through to d3 defaults and behaves exactly as today.
- *Are there existing decay knobs we're ignoring?* `alphaMin` is another option but it would silently change `sim.alpha()`'s floor and interact with the existing `QUIESCE_ALPHA` check; `alphaDecay` is the cleaner lever.

### Deferred to Implementation

- Final numeric values for `alphaDecay`, `velocityDecay`, and the label-toggle restart alpha. Land starting values from Key Technical Decisions, then adjust on-device against a real large-graph tenant.
- Whether the "labels off" direction needs a different restart alpha than the "labels on" direction. If it feels too loose going back (over-spreads before settling), drop to `0.2` for the off-direction specifically; otherwise keep one value.

## Implementation Units

- [ ] **Unit 1: Add `alphaDecay` and `velocityDecay` to `SimConfig` and apply them when building the sim**

**Goal:** Let callers tune d3-force's cooling schedule per-graph without changing existing behavior for callers that don't opt in.

**Requirements:** R2, R3, R5

**Dependencies:** None

**Files:**
- Modify: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts`

**Approach:**
- Extend `SimConfig` with two optional fields: `alphaDecay?: number` and `velocityDecay?: number`. Document sensible ranges in the type's doc comment (d3 defaults are ~0.0228 and 0.4).
- Default both to `undefined` and only call `.alphaDecay(...)` / `.velocityDecay(...)` when a caller provides a value (so the no-opt-in path behaves identically to today).
- Add the two new values to the effect's dependency array so changing them rebuilds the sim just like the existing four knobs do.
- Preserve the preseeded-quiesce branch as-is — the new knobs don't interact with the "restored positions → alpha=0 + stop" logic.

**Patterns to follow:**
- Existing `SimConfig` field shape in `useForceSimulation.ts` lines 18-27.
- Existing effect dep pattern on line 112.

**Test scenarios:**
- Happy path: Caller passes `alphaDecay: 0.06, velocityDecay: 0.55` → assert the constructed simulation reflects those values via `sim.alphaDecay()` / `sim.velocityDecay()` getters.
- Happy path: Caller omits both → `sim.alphaDecay()` returns d3's default (~0.0228) and `sim.velocityDecay()` returns 0.4.
- Edge case: Caller passes `alphaDecay: 0` → sim never cools on its own; still stops via the existing `QUIESCE_ALPHA` gate if alpha happens to dip (should not happen with decay=0, so the sim runs until `stop()` is called on unmount — acceptable, just documented).
- Integration: Changing `alphaDecay` or `velocityDecay` causes the effect to tear down the old sim and build a new one (same behavior as the existing four knobs). Assert by mounting with one pair of values, re-rendering with a new pair, and verifying the hook returns a new `restart` identity.

**Verification:**
- Unit tests in the existing hook test file (or a new one if none exists) cover the three scenarios above.
- Type check passes; `SimConfig` is backward-compatible (all new fields optional).

- [ ] **Unit 2: Tune `LABEL_MODE_SIM_CONFIG` for faster settle and lower the label-toggle restart alpha**

**Goal:** Use the knobs from Unit 1 so the main-graph label toggle settles in well under a second for large graphs, without regressing cold-reveal or the detail subgraph.

**Requirements:** R1, R3, R4

**Dependencies:** Unit 1

**Files:**
- Modify: `apps/mobile/components/wiki/graph/WikiGraphView.tsx`
- Modify: `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx`

**Approach:**
- In `WikiGraphView.tsx`, extend `LABEL_MODE_SIM_CONFIG` (lines 30-35) with `alphaDecay: 0.06` and `velocityDecay: 0.55` as starting values. Leave the four existing entries (`linkDistance`, `chargeStrength`, `collideRadius`, `xyStrength`) untouched — label spacing is a separate concern from cooling speed.
- In `KnowledgeGraph.tsx` lines 111-116, change the hard-coded `sim.restart(0.5)` to `sim.restart(0.3)`. Update the comment on that block to explain that `0.3` is enough heat to re-balance seeded positions under new forces.
- Do not touch `WikiDetailSubgraph.tsx` — its inline `simConfig` stays as-is so detail neighborhoods continue to cold-spread the same way.

**Execution note:** This unit is tuning by feel. Land the starting values above, then open the graph on a representative large tenant (Eric's thinkwork dev tenant has 100+ pages on the primary agent), toggle labels both directions, and adjust until it feels quick but not snappy-to-the-point-of-jarring. Expect one or two rounds of adjustment before the values are final.

**Patterns to follow:**
- `LABEL_MODE_SIM_CONFIG` naming + object-literal pattern already in `WikiGraphView.tsx` lines 30-35.
- Existing inline-comment style on the `sim.restart(0.5)` line.

**Test scenarios:**
- Integration (manual): Toggle labels on the main Wiki tab against a graph with ≥100 nodes. Visible motion ends in <~1s, noticeably faster than today.
- Integration (manual): Toggle labels back off on the same graph. Settle time is comparable to or faster than the "on" direction; no overshoot where nodes pack too tightly then rebound.
- Integration (manual): Cold-launch the app, open the Wiki tab with labels off. The reveal animation is indistinguishable from today (no change to the default `SimConfig`).
- Integration (manual): Navigate into a wiki page detail that embeds `WikiDetailSubgraph`. Neighborhood spread on first mount is indistinguishable from today.
- Edge case (manual): On a very small main graph (≤10 nodes), toggling labels still produces a visible re-spread (not a blink-free instant swap). Confirms `alpha(0.3)` has enough heat even for tiny graphs.
- Regression sanity: Pan/zoom the graph, then toggle labels. Camera position is preserved (the persistence pattern continues to work — this is a pre-existing guarantee we must not regress).

**Verification:**
- On a ≥100-node tenant graph on a physical iPhone (TestFlight dev build), label toggle settles in well under 1s of visible motion.
- No visible regression on cold-reveal or detail-subgraph first mount.
- Labels still don't overlap at default zoom once settled (visual check across `ENTITY`, `TOPIC`, `DECISION` nodes).

## System-Wide Impact

- **Interaction graph:** `useForceSimulation` is consumed by `KnowledgeGraph`, which is consumed by both `WikiGraphView` (main constellation) and `WikiDetailSubgraph` (1-hop). The new `SimConfig` fields are opt-in, so only `WikiGraphView`'s label-mode config sees the new behavior; the detail subgraph is untouched by design.
- **Error propagation:** None — the d3-force APIs being tuned (`alphaDecay`, `velocityDecay`) don't throw on valid numeric inputs, and the values are internal constants, not user input.
- **State lifecycle risks:** None. The three-layer persistence pattern is unaffected: Layer 1 (module cache), Layer 2 (`prevInternalRef`), and Layer 3 (preseeded-quiesce) all continue to work identically. The only thing that changes is how quickly d3-force cools after `sim.restart()`.
- **API surface parity:** `SimConfig` gains two optional fields. No breaking change; existing callers continue to work.
- **Integration coverage:** The manual integration tests in Unit 2 cover the paths a unit test of `useForceSimulation` alone can't prove — specifically that the label toggle feels right against a real graph rendering through `GraphCanvas` on device.
- **Unchanged invariants:** The filter-does-not-restart-sim invariant (`docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`) is unchanged. The preseeded-quiesce contract is unchanged. `WikiDetailSubgraph`'s behavior is unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Faster cooling leaves nodes insufficiently spread under the new forces, producing label overlap | Start with conservative `alphaDecay=0.06` (not 0.1+); validate on-device against a real large graph before landing; `linkDistance`/`collideRadius` already provide the geometric spread — decay only affects how quickly nodes *reach* that equilibrium, not the equilibrium itself |
| Lowering restart alpha to 0.3 means labels-off direction doesn't re-tighten enough and ends up looking sparse | Manual integration test for both directions; drop to `alpha(0.2)` for the off-direction only if needed (deferred to implementation, documented in Open Questions) |
| Test coverage for `useForceSimulation` is thin today, so the hook's test file may not exist | Unit 1 includes provision to add a hook test file if missing; keep scope of tests to the two new knobs (don't retrofit broad hook coverage in this PR) |
| Tuning by feel produces values that feel right for Eric's tenant but feel wrong on a much larger or much sparser graph | Start conservative; call out in the PR description that the numbers are tunable and future tenants with very different graph sizes may prompt follow-up adjustment |

## Sources & References

- Related plan: [`docs/plans/2026-04-20-011-feat-mobile-wiki-graph-label-toggle-plan.md`](2026-04-20-011-feat-mobile-wiki-graph-label-toggle-plan.md) — the toggle plumbing this change tunes.
- Related code: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` · `apps/mobile/components/wiki/graph/WikiGraphView.tsx` · `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` · `apps/mobile/components/wiki/graph/WikiDetailSubgraph.tsx`
- Related learning: [`docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md`](../solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md) — the three-layer persistence pattern this change must not break.
- Related learning: [`docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`](../solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md) — the invariant that filter changes don't restart the sim; still holds.
- Prior PRs: #324 (label toggle), #310 (edge trim), #308 (neighbor ring + looser spacing), #292 (fit-to-view + persistence).
- External: d3-force `alphaDecay` / `velocityDecay` docs.
