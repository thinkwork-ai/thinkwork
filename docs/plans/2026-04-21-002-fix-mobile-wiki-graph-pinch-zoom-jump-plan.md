---
title: "fix: Mobile wiki graph pinch-zoom jumps at edges"
type: fix
status: active
date: 2026-04-21
---

# fix: Mobile wiki graph pinch-zoom jumps at edges

## Overview

P1 user report: pinch-to-zoom on the Wiki-tab constellation sometimes "jumps" to a different place mid-gesture, hiding the nodes the user was looking at. Worse closer to the edges of the constellation. Reading `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts` points at two plausible root causes in the gesture orchestration (not the focal-preserving math itself, which is algebraically correct). This plan fixes both, since the cost is low and they interact.

## Problem Frame

The camera is driven by a composed `Gesture.Simultaneous(pan, pinch)` in `useGraphCamera.ts`. The pinch handler's focal-preserving translation math is correct for a **static** focal point:

```
tx1 = focalX - (focalX - tx0) * (s1 / s0)
```

But two orchestration bugs defeat that math in practice:

1. **Pan and pinch run concurrently.** When two fingers are down, the gesture handler can fire both `pan.onUpdate` (which sets `tx = startTx + translationX`) and `pinch.onUpdate` (which sets tx via the focal-preserving formula) in the same frame. Whichever runs last wins. As the user's finger centroid drifts during pinch — which it always does, even slightly — pan's translation stomps pinch's focal math. Frame-ordering non-determinism produces "jumps."
2. **Pinch anchors to a stale focal.** `pinch.onStart` snapshots `focalX.value = e.focalX`. `pinch.onUpdate` uses that snapshot. But React Native Gesture Handler emits an updated `e.focalX / e.focalY` on every update (the current centroid between the two fingers). Over the course of a pinch the centroid drifts; the snapshot does not. The zoom stays anchored to the original touch-down centroid while the fingers have moved somewhere else — the visible world shifts.

"Worse at edges" fits both: when the user reaches for edge content, their fingers grip more awkwardly, the centroid drifts more per frame, and pan picks up larger `translationX` during the pinch. Both effects compound the further the user has panned from world origin (because any tx error is magnified relative to the small fraction of the world actually on screen).

## Requirements Trace

- R1. Pinch-to-zoom anchors the world point under the user's finger centroid and keeps it there for the duration of the pinch — both on the initial touch centroid AND as that centroid moves during the gesture.
- R2. A pinch does not cause unintended translation beyond what's needed to preserve the focal — in particular, pan's translation does not apply during an active pinch.
- R3. Pan-only gestures (single-finger drag) continue to work exactly as today.
- R4. The "jump" symptom is no longer reproducible on the main graph at any pan offset or zoom level on the test tenant (~150 nodes, Marco).
- R5. Clamping at `SCALE_MIN`/`SCALE_MAX` still works and the camera snaps cleanly at the limits (no residual drift after hitting a clamp).

## Scope Boundaries

- Not changing the camera transform chain (`translate(tx, ty)` then `scale(s)`) — order is correct, used throughout the render layer.
- Not changing `SCALE_MIN` / `SCALE_MAX` values.
- Not touching the fit-to-view / reveal animation (`animateTo`, `stepToward`) — separate code path, works correctly today.
- Not touching `useForceSimulation` — unrelated system.
- Not introducing a separate pan-during-pinch "translation lock" state machine unless the straightforward fix doesn't fully resolve the bug. Added complexity is a fallback, not the primary approach.
- Not adding haptic feedback, momentum, or inertia to the camera — out of scope for a P1 bug fix.

## Context & Research

### Relevant Code and Patterns

- `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts` — the only file needing changes. Current pinch handler at lines 64-85; pan at lines 50-62; `Gesture.Simultaneous(pan, pinch)` at line 87.
- `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` lines 243-247 — the site where `camera.gesture` is composed with the tap gesture into `composedGesture`. No changes needed here, but worth reading to confirm the composed gesture contract.
- `apps/mobile/components/wiki/graph/GraphCanvas.tsx` — consumes the `transform` derived value. No changes needed.

### Institutional Learnings

- `docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md` — three-layer persistence pattern. The camera shared-values (`tx`, `ty`, `scale`) are persisted across navigation. Any change to how they're mutated during pinch must not break the snapshot-on-unmount / restore-on-mount contract described in that doc. This plan doesn't change when/how snapshots happen, only the math during an active gesture, so the invariant is preserved.
- `docs/solutions/best-practices/graph-filter-states-no-restart-2026-04-20.md` — filter changes must not restart the sim or reset camera. Not directly relevant (filters don't touch the gesture handler), but the bar it sets — "the user's camera is sacred during a gesture" — applies here too.

### External References

Two likely-useful patterns from the React Native Gesture Handler docs and community examples:
- **Focal-tracking pinch**: read `e.focalX` / `e.focalY` every `onUpdate`. Keep the anchor math relative to the start focal, but add the focal delta to tx/ty so finger centroid drift translates the world naturally. This handles R1's "as the centroid moves" clause.
- **Gesture composition**: `Gesture.Race(...)` or manually conditioning pan's update on "is pinch active" are alternatives to `Gesture.Simultaneous`. The minimal intervention is to make pan's `onUpdate` a no-op while a pinch is active (tracked with a shared value flag).

Confirming which pattern matches current RNGH (`react-native-gesture-handler@^2.x`) and Reanimated (`react-native-reanimated@^4.x`) is a Phase 1 execution step, not a planning question — the APIs are stable and well-documented.

## Key Technical Decisions

- **Fix the orchestration, not the math.** The `tx = focalX - (focalX - startTx) * ratio` formula is correct. The bug is that (a) pan overwrites tx during pinch and (b) pinch ignores centroid drift. Those are the two targets. **Why:** rewriting the math adds risk for no benefit; the formula is algebraically derived from the invariant "world-point-under-finger stays under finger."
- **Prefer adding focal-tracking to pinch before introducing a pan-lock flag.** The correct focal-tracking formula handles centroid drift cleanly AND reduces pan-stomp surface area (because pinch's update will write the right tx on every frame, re-overwriting any pan mistake). If the P1 symptom persists after focal-tracking is added, introduce a shared-value `isPinching` flag that pan's `onUpdate` respects. **Why:** minimum intervention first; the pan-lock flag adds a small state machine that needs coordinated start/end handling across two gestures.
- **Keep `focalX` / `focalY` shared values but add `startFocalX` / `startFocalY`.** The snapshot fields describe "where was the focal at pinch start" (anchors the world point). The live `e.focalX` from `onUpdate` describes "where is the focal now." Both are needed. **Why:** the focal-tracking formula is `tx = e.focalX - (startFocalX - startTx) * ratio`. The live focal becomes the NEW anchor, the start focal is where the world-point was located relative to startTx.
- **Do not change `Gesture.Simultaneous`.** Pan-and-pinch simultaneous is correct for natural two-finger interaction (user might be slightly translating while pinching intentionally). The fix is to make each handler's math robust to concurrent firing, not to serialize them. **Why:** switching to `Gesture.Race` or `Gesture.Exclusive` changes UX — users would no longer be able to translate during a pinch, which is a regression for the intentional cases.
- **Verification bar includes a stress test at edge conditions.** The plan's "done" criterion is "cannot reproduce at any pan offset / any zoom level," not just "feels better." **Why:** the user explicitly flagged edges as the worst case; not regression-testing those conditions would leave the P1 half-fixed.

## Open Questions

### Resolved During Planning

- *Is the focal-preserving math wrong?* No, it's correct for a static focal. The bugs are in orchestration: concurrent pan + stale focal snapshot.
- *Does the camera's transform order (translate then scale) matter?* No — the focal-preserving formula is derived from exactly that transform order. Confirmed by code read.
- *Do we need to change `Gesture.Simultaneous`?* Not as a default. If focal-tracking doesn't fully resolve the P1, a pan-lock-during-pinch flag is a fallback (documented in Deferred).

### Deferred to Implementation

- *Does focal-tracking alone resolve the P1, or is a pan-lock also required?* Cannot be fully resolved from reading — depends on runtime ordering of pan/pinch handlers in the installed RNGH version and how aggressively pan reports translation during two-finger input. The plan's Unit 1 lands focal-tracking and validates on-device. If the jump still reproduces, Unit 2 lands the pan-lock. Splitting lets Unit 1 ship if it's sufficient.
- *Exact RNGH / Reanimated API shapes for reading `e.focalX` inside `onUpdate`.* Trivial to confirm once editing the file; not a blocking planning question.
- *Is there a Skia canvas offset (insets, safe-area) affecting focal coordinates?* Read of `KnowledgeGraph.tsx` suggests no (the canvas is mounted flush in an `Animated.View`), but implementation should verify before concluding focal-tracking is the whole fix.

## Implementation Units

- [ ] **Unit 1: Pinch-tracks-current-focal fix in `useGraphCamera`**

**Goal:** Make pinch anchor the world-point under the fingers to the *current* centroid, not the centroid captured at pinch start. Eliminates the "fingers moved but zoom didn't follow" jumps.

**Requirements:** R1, R4, R5

**Dependencies:** None

**Files:**
- Modify: `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts`

**Approach:**
- Rename existing `focalX` / `focalY` shared values to `startFocalX` / `startFocalY`. These still snapshot the centroid at `onStart` — that's the point that locates the world-anchor relative to `startTx`.
- In `pinch.onUpdate(e)`, read the *current* centroid from `e.focalX` / `e.focalY`. Compute `tx` and `ty` so the world point that was under `startFocal` at `onStart` is now under the current `e.focal`:
  - `tx = e.focalX - (startFocalX - startTx) * ratio`
  - `ty = e.focalY - (startFocalY - startTy) * ratio`
  - Where `ratio = next / startScale` as today.
- Keep the `scale` clamp and all cancellation behavior (`cancelAnimation(tx/ty/scale)`) exactly as today.
- Keep `Gesture.Simultaneous(pan, pinch)` — do not change gesture composition in this unit.

**Execution note:** Validate on-device against the reported P1 after this unit ships. If the jump no longer reproduces at edge conditions, skip Unit 2. If it still reproduces, proceed to Unit 2.

**Patterns to follow:**
- `useGraphCamera.ts` current structure: shared-value snapshots in `onStart`, math in `onUpdate`, all worklet-side. No JS-thread detour on hot path.
- `animateTo` / `stepToward` use `withTiming` and lerp respectively — untouched.

**Test scenarios:**
- Happy path: Pinch out with fingers perfectly still (or as still as humanly possible) in the graph center. Scale increases, world-point under the centroid stays fixed.
- Happy path: Pinch out with fingers drifting ~20 px during the pinch. World-point under the *current* centroid stays fixed (the pre-pinch anchor tracks the fingers).
- Edge case: Pinch near the right edge of the canvas with the user panned to the right extreme of the graph. No jump; zoom anchors as expected.
- Edge case: Pinch near the bottom edge with user panned down. Same — no jump.
- Edge case: Pinch at maximum zoom (`SCALE_MAX`) — `next` clamps, but subsequent tx/ty math stays consistent with the clamped scale; no drift after release.
- Edge case: Pinch at minimum zoom (`SCALE_MIN`) — same clamp-consistency check.
- Integration: Pan, release, then pinch. The pinch's `startTx` reads the post-pan tx, focal math works from that baseline.
- Integration: Pan + pinch simultaneously (the user intentionally drags while pinching). The world-point under the current centroid still stays under the current centroid — pan's concurrent updates may add some translation, but the pinch invariant holds. (If this scenario still shows jumps, Unit 2 is required.)

**Verification:**
- On-device test on the ~150-node graph, panned to an edge, pinching to zoom in and out: no visible jumps.
- Pinching in the center of the canvas with very still fingers: indistinguishable from today's behavior (no regression on the happy path).
- Returning to the screen after a pinch restores the exact camera state persisted on unmount (persistence pattern from `react-native-force-sim-camera-persistence-2026-04-20.md` still works — nothing in this unit touches unmount snapshots).

---

- [ ] **Unit 2: Lock pan during active pinch (conditional — only if Unit 1 is insufficient)**

**Goal:** If Unit 1's focal-tracking doesn't fully resolve the P1, prevent `pan.onUpdate` from writing `tx` / `ty` while a pinch is active. Closes the frame-ordering race where pan stomps pinch.

**Requirements:** R2, R4

**Dependencies:** Unit 1 (validated to be insufficient on-device)

**Files:**
- Modify: `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts`

**Approach:**
- Add an `isPinching` shared value (boolean).
- Set `isPinching.value = true` in `pinch.onStart`, `false` in `pinch.onEnd` and `pinch.onFinalize`.
- In `pan.onUpdate`, early-return if `isPinching.value` is true. `pan.onStart` should also snapshot `startTx` / `startTy` only if not currently pinching — otherwise the snapshot becomes stale once pinch ends and pan resumes. The cleanest approach is to re-snapshot `startTx` / `startTy` from current tx/ty in `pinch.onEnd` so pan can resume from a clean baseline if the user keeps a finger down.
- Do not change `Gesture.Simultaneous` — the composition stays as-is. Only the per-handler behavior changes.

**Execution note:** Skip this unit if Unit 1 on-device testing confirms the P1 is resolved. Land Unit 1's tests first; only open this unit on evidence.

**Patterns to follow:**
- Same as Unit 1 — shared-value snapshots, worklet-side math.

**Test scenarios:**
- Happy path: Pan-only gesture (single finger). Behavior unchanged from today.
- Happy path: Pinch-only gesture. Focal-tracking from Unit 1 works; pan is a no-op during the pinch.
- Integration: Pan → pinch → release pinch → continue panning with one finger still down. Pan resumes cleanly from the post-pinch tx/ty without a jump.
- Integration: Simultaneous two-finger drag + pinch (the "spread and move" case). Pinch handles the scale + focal-preserving translation; pan is locked out, so no double-writes. The net motion should still feel natural (pinch's focal-tracking accounts for centroid movement).
- Edge case: Very fast pinch (scale changes rapidly). `isPinching` flag state stays consistent — no frame where both handlers write conflicting tx values.

**Verification:**
- Same on-device test as Unit 1: P1 is no longer reproducible at edge conditions.
- Pan-only UX is indistinguishable from pre-fix behavior.

## System-Wide Impact

- **Interaction graph:** Only `useGraphCamera` is consumed by `KnowledgeGraph` (both the main `WikiGraphView` and the detail-screen `WikiDetailSubgraph`). Both use the same composed gesture. The fix applies to both surfaces uniformly.
- **Error propagation:** None — gesture handlers run on the worklet; no JS-thread errors to propagate.
- **State lifecycle risks:** The camera's shared values are snapshotted on unmount and restored on mount (`graphStateCache`). This fix doesn't change when those reads/writes happen; it only changes the math inside `pinch.onUpdate`. The persistence contract is preserved.
- **API surface parity:** `useGraphCamera`'s return shape (`tx`, `ty`, `scale`, `transform`, `gesture`, `animateTo`, `stepToward`) is unchanged. No callers need updates.
- **Integration coverage:** The gesture handler integrates with `KnowledgeGraph.tsx` via the composed `Gesture.Simultaneous(camera.gesture, tapGesture)`. Tap-gesture behavior is orthogonal. The fit-to-view animation uses `animateTo` (untouched). The hit-testing inside `handleTap` reads `camera.tx.value` / `ty.value` / `scale.value` — these shared values still hold the same semantics.
- **Unchanged invariants:**
  - Camera persistence across unmount/remount (three-layer pattern) — unchanged.
  - Sim-filter-does-not-restart invariant — unrelated, unchanged.
  - `SCALE_MIN` / `SCALE_MAX` clamps — unchanged.
  - `onUserGesture` callback fires once per gesture on the JS thread — unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Focal-tracking changes the "feel" of pinching — users accustomed to the static-focal-anchor behavior notice the difference | Focal-tracking is the industry-standard pinch behavior (Maps, Photos, etc.). The current static-anchor is an artifact, not a design choice. If user feedback surfaces, we can tune by blending (but unlikely). |
| Unit 2's `isPinching` flag gets stuck in a wedged state (e.g., `pinch.onEnd` never fires) and permanently disables pan | Ensure the flag is reset in BOTH `onEnd` and `onFinalize` (Reanimated / RNGH fires one or the other depending on how the gesture terminates). Add a defensive `onTouchesEnded` fallback if RNGH version requires it. |
| Math regression — a typo in the focal-tracking formula produces drift instead of anchor-hold | The formula is a small change (~3 lines). On-device test scenarios explicitly cover "fingers still → world-point stays" AND "fingers drift → world-point tracks fingers." Both must pass. |
| Pan-during-pinch intentional use case breaks if Unit 2 lands and lock is too aggressive | Pinch's focal-tracking in Unit 1 ALREADY handles centroid translation (the pinch's own math moves tx/ty as the centroid moves). Pan is therefore redundant during pinch — locking it doesn't remove a user capability, it removes a double-write. |
| P1 severity warrants faster-than-PR-review turnaround | Fix is localized to one file, one function. Ship Unit 1 immediately after on-device validation. Unit 2 only if needed. |

## Documentation / Operational Notes

- No doc changes required for users — this is a bug fix with no behavior change except "the bug is gone."
- Consider a short `docs/solutions/logic-errors/` entry post-landing documenting the root cause ("focal captured at onStart ignores centroid drift" + "concurrent pan stomps pinch"). Not a blocker for shipping.
- No rollout concerns — mobile ship goes through TestFlight, not feature-flagged. Land the fix, cut the next TestFlight build.

## Sources & References

- P1 user report: "as I'm pinch to zoom on the chart, sometimes it 'jumps' to a different place and the nodes I was looking at are no longer visible. I notice it happening closer to the edges of the constellation."
- Related code: `apps/mobile/components/wiki/graph/hooks/useGraphCamera.ts` (the one file) · `apps/mobile/components/wiki/graph/KnowledgeGraph.tsx` (composer)
- Related learning: [`docs/solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md`](../solutions/best-practices/react-native-force-sim-camera-persistence-2026-04-20.md) — camera persistence pattern that must not be regressed.
- Prior PRs in this area: #292 (fit-to-view + persistence), #324 (label toggle), #325 (settle-speed tuning).
