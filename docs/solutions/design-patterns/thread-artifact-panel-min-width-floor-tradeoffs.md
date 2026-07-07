---
title: Two-pane resizable split with competing pixel floors — mount-time clamping and narrow-window degradation
date: 2026-07-07
category: docs/solutions/design-patterns
module: apps/web thread/artifact workbench split
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Adding or changing a pixel-unit minSize floor on a react-resizable-panels ResizablePanelGroup that already has another panel with its own minSize floor"
  - "Deciding whether a persisted/stored panel width needs new clamp logic when the window is resized or reloaded"
  - "A window width falls below the sum of two panels' declared minimums plus the divider width"
  - "Evaluating whether to add a dynamic/measured effective floor versus accepting library-level proportional degradation"
symptoms:
  - "A resizable pane can be dragged narrower than its intended readability floor because no minSize is declared"
  - "A persisted/stored panel width from localStorage can exceed what a newly-added minimum permits on reload"
  - "At certain intermediate window widths, two panels' declared minimums cannot both be satisfied simultaneously"
related_components:
  - apps/web/src/components/artifacts/thread-artifact-panel-store.ts
  - apps/web/src/components/workbench/TaskThreadView.tsx
tags:
  - resizable-panels
  - thread-artifact-split
  - min-width
  - layout-tradeoff
  - think-211
  - flex-degradation
  - persisted-width-clamp
---

# Two-pane resizable split with competing pixel floors — mount-time clamping and narrow-window degradation

## Context

The thread/artifact workbench split (`apps/web/src/components/workbench/TaskThreadView.tsx`) uses a resizable-panel library (`react-resizable-panels`) to divide horizontal space between the conversation thread and the artifact side panel. The artifact pane already had a 360px `minSize`. THINK-211 reported that the thread pane had no floor at all and could be dragged arbitrarily narrow by the artifact panel's resize handle.

The fix (PR #3478, merge commit `4d4196884`, 2 files, +7/-1) was small: `MIN_THREAD_PANE_WIDTH_PX = 500` was exported from `apps/web/src/components/artifacts/thread-artifact-panel-store.ts`, and `minSize={`${MIN_THREAD_PANE_WIDTH_PX}px`}` was added to the thread `ResizablePanel` in `TaskThreadView.tsx`. That single prop addition is the entire application-code change — everything else described below is the library's existing behavior being exercised, not new code.

Dogfood verification (PR #3479, PASS, deployed dev, live bundle at the merge commit, widths measured via `getBoundingClientRect`) drove 6 flows: drag-to-floor at 1440px (thread floors at exactly 500px, was ~430px/30% pre-fix), a mount-time clamp with a stale 1000px localStorage value on a 1200px window (mounts at thread 500px / artifact 399px, not 1000px), the pre-existing artifact 360px floor (unchanged), a degraded narrow window (~800px: thread 290px / artifact 209px, proportional, no overflow), mobile <768px (split hidden, pre-existing), and persistence (drag to 638px, reload restores ≥500px). Zero console/server errors.

## Guidance

When a two-pane resizable split declares independent `minSize` values on both panes, three behaviors fall out of the library for free and should be relied on rather than re-implemented:

1. **Mount-time clamping.** If a persisted/seeded width violates the current `minSize`, the library's own layout validation on mount re-clamps to a valid split — do not add application-level clamping logic for this case. It then re-persists the clamped value via its own `ResizeObserver`-driven `onResize`, overwriting the stale stored value before the user does anything.
2. **Proportional degradation below the combined floor.** When the container is narrower than `sum(minSizes) + handleWidth`, the library does not "pick a winner" — it degrades both panes proportionally, keeping their ratio roughly intact (e.g. ~500:360 held even at 290:209). This is the accepted default for this codebase whenever two independent minimums are declared on a split pane. It never produces overflow or a broken layout, only a narrower-than-ideal one, so it is deliberately not treated as a bug.
3. **No affordance when a drag hits a minimum.** The divider simply stops moving — no cursor change, edge highlight, or toast, on either pane. This is consistent across the pre-existing 360px artifact floor and the new 500px thread floor, so it reads as an established interaction gap for this library usage in this codebase, not a regression introduced by adding a second minimum.

If a real user complaint about the narrow-window degradation band ever arrives, the documented escape hatch is a **dynamic effective floor**: compute the thread's minimum at render/resize time as `min(500px, groupWidth - 360px - handleWidth)` (via `ResizeObserver`) instead of a fixed `minSize`, so the thread's 500px guarantee holds everywhere the container is wide enough, and only the artifact pane degrades in the remaining narrow band. This was considered and explicitly rejected for the initial THINK-211 fix — do not implement it speculatively.

## Why This Matters

Without this framing, a future contributor touching this split pane is likely to:
- Add unnecessary clamp-on-mount or clamp-on-resize application code to "fix" the stale-localStorage case, duplicating behavior the library already provides.
- Mistake the narrow-window (768-861px) proportional degradation for a bug and file/fix it reactively, when it is actually a structurally unavoidable conflict for any two-pane split with two independent fixed minimums (you cannot guarantee both below their sum + divider width) — the only real fix is the dynamic-floor approach, which has a real complexity cost.
- Treat the missing drag-limit affordance as specific to the new thread floor, when it's actually a pane-wide (both sides) pre-existing gap; fixing it for one side without the other would be inconsistent.

Naming these tradeoffs here means the next person who hits any of the three behaviors above can recognize it as known-and-accepted rather than re-diagnosing it from scratch.

## When to Apply

- Any time a `ResizablePanel`/resizable-split component in this codebase gains or changes a `minSize` on one or both panes.
- When investigating a report that a resizable split "jumps" to an unexpected width on load — check for the mount-time reclamp behavior (item 1) before assuming a bug.
- When investigating a report that a resizable split's panes look "too small" in a narrow window — check whether the window falls in the sub-combined-floor band before assuming a regression (item 2).
- Before adding a hover/drag affordance to one pane's minimum boundary — do it for both panes' minimums together, or explicitly scope why only one.
- Before implementing a dynamic/computed effective floor for any split pane — confirm there's an actual user complaint about the fixed-narrow-window band first; it was explicitly deferred here as not worth the complexity absent one.

## Examples

- `apps/web/src/components/artifacts/thread-artifact-panel-store.ts` — exports `MIN_THREAD_PANE_WIDTH_PX = 500`, the thread pane's floor.
- `apps/web/src/components/workbench/TaskThreadView.tsx` — `ResizablePanel` for the thread side takes `minSize={`${MIN_THREAD_PANE_WIDTH_PX}px`}`; the artifact side's sibling `ResizablePanel` already had `minSize="360px"` before this change, and is the reference for "two independent floors on one split."
- PR #3478 (fix, +7/-1) and PR #3479 (dogfood verification report, 6 flows, PASS) are the concrete before/after evidence for all three library behaviors described above.

## Related

- `docs/plans/2026-07-06-003-fix-thread-min-width-plan.md` — THINK-211 implementation plan; defines KTD2 (mount-time clamp) and KTD3 (narrow-window degradation) in full.
- `docs/dogfood-reports/2026-07-07-THINK-211-dogfood.md` — verification report backing the pixel values cited above.
- `docs/solutions/ui-bugs/failed-thread-turn-default-open-layout-shift-2026-06-14.md` — touches the same `TaskThreadView.tsx` file but an unrelated concern (disclosure-state layout shift, not resize-pane minimums).
