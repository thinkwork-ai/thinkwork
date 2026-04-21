---
title: Tuning d3-force settle animations — separate duration knobs from layout knobs
date: 2026-04-21
category: best-practices
module: apps/mobile/components/wiki/graph
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Tuning d3-force simulation settle time on a visible graph
  - Users report a force-layout animation is "too slow" or "cuts off abruptly"
  - Balancing layout quality (cluster cohesion) against animation duration
  - Adding a quiesce / early-stop threshold to a d3-force hook
related_components:
  - frontend_stimulus
tags:
  - d3-force
  - animation
  - react-native
  - wiki-graph
  - force-simulation
  - alpha-decay
  - velocity-decay
  - tuning
---

# Tuning d3-force settle animations — separate duration knobs from layout knobs

## Context

A d3-force simulation has multiple parameters that all *feel* like they control "how long the animation takes" — and engineers routinely reach for the wrong one. The most common mistake is raising `velocityDecay` (per-tick damping) to shorten a settle animation. It does shorten the visible motion, but only because nodes stop moving before the force equilibrium is reached. The result: clusters don't actually pack, and the engineer then compensates by weakening other forces — further degrading layout.

This guidance came out of a mobile wiki-graph label-toggle animation (~150 nodes) that needed to settle faster without losing cluster legibility. The fix was not "tune harder" — it was realizing that **animation duration and steady-state layout quality are controlled by different knobs**, and they must be tuned independently.

## Guidance

When tuning a d3-force settle animation, keep three knobs straight:

### 1. `velocityDecay` (d3 default 0.4) — per-tick damping

Controls how much velocity is retained each tick. Higher values kill per-tick motion faster. **Raising this degrades clustering**, because nodes get damped before they can pack into the force equilibrium. Use it to tune the *character* of steady-state motion (snappy vs. floaty), not the duration of the animation. **Default case: leave it alone.**

### 2. `alphaDecay` (d3 default ~0.0228) — per-tick cooling rate

Controls how fast the simulation's "temperature" drops. Raising it reduces total tick count **without changing per-tick motion behavior**. This is the correct lever for shortening the animation: forces still act normally on each tick, there are just fewer ticks.

### 3. `quiesceAlpha` — the stop threshold (not native to d3-force)

d3-force doesn't expose this; you add it in your simulation hook as the alpha value at which you stop ticking and mark the sim as settled. Raising it ends the animation sooner by skipping the low-amplitude tail. **But** if raised too high, the stopping tick still has meaningful per-tick motion — the animation appears to cut off mid-drift instead of trailing to rest.

### The pairing rule

`quiesceAlpha` must be **low enough** that at that alpha the per-tick motion is already small — target <10% of peak. Otherwise any time savings from raising it naively get reclaimed from visual quality (abrupt cut-off).

**The pattern that works:**
- Aggressive `alphaDecay` to cool fast.
- Low `quiesceAlpha` so the stopping tick is already mostly still.
- Leave `velocityDecay` at its d3 default (0.4) so nodes can actually reach equilibrium.

### Example config (~150-node graph, landed after 4 iterations)

```ts
const LABEL_MODE_SIM_CONFIG: SimConfig = {
  linkDistance: 110,
  chargeStrength: -340,
  collideRadius: 52,
  xyStrength: 0.04,
  alphaDecay: 0.1,       // vs d3 default ~0.0228 — aggressive cooling
  quiesceAlpha: 0.02,    // vs hook default 0.01 — stops where per-tick motion ~7% of peak
  // velocityDecay intentionally omitted (uses d3 default 0.4)
};

// On the event that triggers re-settle:
sim.restart(0.3);  // enough heat to re-balance seeded positions into a new equilibrium
```

And the hook-level plumbing that makes `quiesceAlpha` a tunable:

```ts
// SimConfig fields
alphaDecay?: number;
velocityDecay?: number;
quiesceAlpha?: number;  // default QUIESCE_ALPHA = 0.01 if omitted
```

## Why This Matters

The naive mental model — "higher damping = shorter animation" — is technically true but misses that damping operates per-tick, so it trades motion for layout quality. `alphaDecay` and `quiesceAlpha` trade *ticks* for duration, which leaves per-tick physics untouched. If you conflate the two categories, you'll spend iterations adjusting forces to compensate for layout you broke with `velocityDecay`, never realizing the real fix is a one-line `alphaDecay` bump.

Separating these concerns also makes the tuning loop converge: you pick `velocityDecay` once for motion character, then tune `alphaDecay` and `quiesceAlpha` for duration without touching it again.

### Iteration trace (the wrong turns)

The lesson is sharper with the misses:

1. **v1** — `alphaDecay 0.06, velocityDecay 0.55, restart 0.5→0.3`. Still too slow. `velocityDecay 0.55` was damping motion but not shortening visibly.
2. **v2** — `alphaDecay 0.12, velocityDecay 0.7, restart 0.2`. Clusters stopped forming. `velocityDecay 0.7` killed per-tick motion so hard the force equilibrium never came together. **This is the insight moment**: aggressive damping reduces clustering, not animation length.
3. **v3** — Reverted `velocityDecay`, kept `alphaDecay 0.08`, introduced `quiesceAlpha 0.05`. Better, but stopped abruptly. `quiesceAlpha 0.05` was ~30% of peak motion — you could see the cut-off.
4. **v4 (landed)** — `alphaDecay 0.1, quiesceAlpha 0.02, restart 0.3`, no `velocityDecay` override. Clean settle.

The arc: a `velocityDecay` detour → a `quiesceAlpha` overshoot → landing on the right pairing. The three-knob framing is what would have skipped steps 1–3.

## When to Apply

Reach for this guidance when:

- You have a d3-force (or d3-force-like) simulation that drives a visible settle animation and you want it to finish sooner.
- You've tried raising damping/friction and clusters look worse.
- The animation "finishes" but cuts off instead of trailing to rest.
- You're adding a "settle complete" signal to a force sim and need to pick a stop threshold.

Skip it when:

- The animation is already offscreen / non-visible (just run to a fixed tick count).
- You're tuning for *feel* of in-flight motion (snap, bounce, float) rather than duration — that's the `velocityDecay` regime.
- The graph is small enough (<20 nodes) that equilibrium is reached in a handful of ticks regardless.

### Does not soften the "filter does not restart the sim" invariant

This doc introduces `sim.restart(0.3)` on the label-toggle path. That is **not** a precedent for restarting the sim on search-filter changes — filter changes keep the "no restart" invariant documented in [`graph-filter-states-no-restart-2026-04-20.md`](./graph-filter-states-no-restart-2026-04-20.md). Label-toggle and filter-change are different events: a label toggle swaps in a new `simConfig` (longer links, stronger charge) and needs re-layout; a filter change only re-styles existing nodes and must not disturb the user's camera/layout.

## Examples

### Wrong — shorten by damping harder

```ts
// Kills per-tick motion; clusters don't pack; engineer then weakens
// chargeStrength/linkDistance to "fix" layout, spiraling further.
const cfg: SimConfig = {
  // ...forces...
  velocityDecay: 0.7,    // WRONG lever for "make it shorter"
  alphaDecay: 0.12,
};
```

### Right — cool faster, stop when already quiet

```ts
const cfg: SimConfig = {
  // ...forces unchanged...
  alphaDecay: 0.1,       // fewer ticks, same per-tick physics
  quiesceAlpha: 0.02,    // stop once per-tick motion is ~<10% of peak
  // velocityDecay: omitted — d3 default 0.4 is fine
};
```

### Right — calibrating `quiesceAlpha` against observed motion

Log per-tick max-velocity (or max delta position) during a representative settle. Pick `quiesceAlpha` at the alpha where that value first drops below ~10% of its peak. If it's still at ~30% (as in v3 above), lower `quiesceAlpha` until the stop is invisible.

## Related

- [`docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md`](./react-native-force-sim-camera-persistence-2026-04-20.md) — same hook (`useForceSimulation`), different axis. That doc's Layer 3 (`sim.alpha(0); sim.stop()` for pre-seeded layouts) governs *when not to start motion at all*; this doc governs *how to end motion cleanly once it's running*. Both are in `useForceSimulation` and must not be conflated.
- [`docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md`](./graph-filter-states-no-restart-2026-04-20.md) — the "filter does not restart sim" invariant. `sim.restart(0.3)` in this doc is scoped to label-toggle events and does not extend to filter changes; see the caveat in "When to Apply" above.
- Plan: [`docs/plans/2026-04-21-001-fix-mobile-wiki-graph-label-toggle-settle-speed-plan.md`](../../plans/2026-04-21-001-fix-mobile-wiki-graph-label-toggle-settle-speed-plan.md) — the plan that drove PR #325.
- Plan: [`docs/plans/2026-04-20-011-feat-mobile-wiki-graph-label-toggle-plan.md`](../../plans/2026-04-20-011-feat-mobile-wiki-graph-label-toggle-plan.md) — the feature whose slowness prompted the tuning.
- Plan: [`docs/plans/2026-04-20-015-feat-mobile-graph-refinements-plan.md`](../../plans/2026-04-20-015-feat-mobile-graph-refinements-plan.md) — where `QUIESCE_ALPHA` and the `settled` signal first appeared in the hook.
- Plan: [`docs/plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md`](../../plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md) — v1 graph ship; baseline values this tuning evolved from.
- PR [#325](https://github.com/thinkwork-ai/thinkwork/pull/325) — this learning's landing PR.
- PR [#324](https://github.com/thinkwork-ai/thinkwork/pull/324) — the label-toggle feature that exposed the slowness.
- Code: `apps/mobile/components/wiki/graph/hooks/useForceSimulation.ts` · `WikiGraphView.tsx` · `KnowledgeGraph.tsx`
