---
title: THINK-211 Dogfood Verification — Thread min width (500px floor)
date: 2026-07-07
issue: THINK-211
pr: "#3478"
merge_commit: 4d4196884
deploy_run: https://github.com/thinkwork-ai/thinkwork/actions/runs/28841020366
verifier: dogfood verification worker (opus)
status: PASS
---

# THINK-211 Dogfood Verification — Thread min width

Verifies the 500px minimum-width floor on the Thread conversation pane in the
thread/artifact resizable split (PR #3478, merge commit `4d4196884`).

**Result: PASS — all six Verification-Contract flows green, no console or
server errors, no visual breakage. Decisions for a human: none.**

**Change under test (diff-scoped):**
- `apps/web/src/components/artifacts/thread-artifact-panel-store.ts` — exported `MIN_THREAD_PANE_WIDTH_PX = 500`.
- `apps/web/src/components/workbench/TaskThreadView.tsx` — added `minSize={\`${MIN_THREAD_PANE_WIDTH_PX}px\`}` to the thread `ResizablePanel` (previously unconstrained). Import added. 2 files, +7/-1 — matches PR #3478 exactly.

**Verification surface:** web dev server built from this worktree at the merged
commit `4d4196884` (the exact fix), pointed at deployed dev backend via the
copied `apps/web/.env` (GraphQL `ho7oyksms0.execute-api…`, Cognito pool
`us-east-1_L4DhLVKis`). This is a pure frontend layout constraint, so the local
bundle at the merged commit is a faithful exercise of the shipped code. Auth:
minted a fresh Cognito token from the CLI dev refresh grant and injected it into
localStorage (standard dogfood-dev pattern). Test thread:
`/threads/2bb90c06-…` ("THINK-207 R12 retry — Q4 onboarding rollout narrative"),
which contains a card-rendered `PLAN` artifact ("Q4 Customer Onboarding Rollout").
Widths measured via `getBoundingClientRect()` on the `[aria-label="Thread
conversation"]` region and the artifact `[data-panel]`.

## Scenario matrix (plan's six-flow Verification Contract)

| # | Flow | Expected | Functional | Experiential |
| - | ---- | -------- | ---------- | ------------ |
| 1 | AE1/R1 drag floor | ≥1440px window, drag divider fully left → thread pane floors at 500px (was ~430px) | **PASS** — floored at **exactly 500px** (582→500) | PASS — conversation stays readable; smooth stop, no jump |
| 2 | AE2/R2 persisted-width clamp | seed localStorage=1000px on 1200px window, reload → thread pane ≥500px at mount | **PASS** — thread **500px**, artifact opened **399px** (not 1000); clamp re-persisted as `399` | PASS — no flash of an oversized panel at mount |
| 3 | R3 artifact minimum | drag divider right fully → artifact panel stops at 360px, unchanged | **PASS** — artifact floored at **exactly 360px** (thread grew to 779) | PASS — pre-existing behavior intact |
| 4 | KTD3 degraded window | window ~800px → proportional flex degradation, divider grabbable-but-immobile = PASS | **PASS** — panes degrade proportionally (thread 290 / artifact 209), **no horizontal overflow**, divider immobile | PASS — cramped but coherent; documented tradeoff (see paper cut #2) |
| 5 | R3 mobile | window <768px → split hides entirely, thread fills width | **PASS** — at 700px handle `display:none`, artifact panel hidden, thread fills width, no overflow | PASS — identical to prior mobile behavior |
| 6 | Persistence | drag to valid non-default width, reload → width persists, thread ≥500px | **PASS** — dragged to artifact **638px**, reload restored **638px**, thread **501px** (≥500) | PASS — width survives reload cleanly |

## Per-scenario evidence

### Flow 1 — AE1/R1 drag floor (primary). PASS
- Window 1440×900. Default state: thread 582px / artifact 557px, divider at x=882.
- Simulated pointer drag of the divider fully left (to x≈305). Measured after release:
  `conversation.w = 500`, artifact panel `= 639`. Thread pane stopped at **exactly 500px** instead of the pre-fix ~430px (30% of the ~1140px group).
- No console errors. Screenshot: `evidence-THINK-211/flow1-drag-floor-500px.png` — conversation fully readable beside the open Q4 rollout artifact.

### Flow 2 — AE2/R2 persisted-width clamp at mount. PASS
- Seeded `localStorage["thinkwork.thread-artifact-panel.width"] = "1000"`, window 1200×900 (group ≈ 900px), reloaded, reopened the artifact panel.
- Measured at mount: `conversation.w = 500`, artifact `= 399`. The stored 1000px was clamped by the library's mount-time layout validation against the new thread floor — **no new store logic** (KTD2 primary path confirmed).
- Confirmed KTD2 re-persist: after mount, `localStorage[...width]` read back as `"399"` (the clamped value, written immediately by the ResizeObserver-driven `onResize`, not on next drag). Screenshot: `flow2-mount-clamp-1200px.png`.

### Flow 3 — R3 artifact minimum unchanged. PASS
- Window 1440×900, fresh default (thread 659 / artifact 480). Dragged the divider fully right.
- Measured: artifact `= 360` (its declared min), thread grew to `779` (= 1140 − 1 − 360). The artifact panel's 360px minimum is untouched by this change. Screenshot: `flow3-artifact-floor-360px.png`.
- Note: the artifact canvas renders in an `<iframe>` that swallows synthetic pointer-move events once the drag crosses into it. This is a **test-harness artifact of CDP-dispatched mouse events**, not a product defect (real user pointers use `setPointerCapture`, which redirects correctly). Worked around by setting the iframe `pointer-events:none` for the duration of the rightward drag only, then restoring it. Leftward drags (Flows 1/6) needed no workaround because they move away from the iframe.

### Flow 4 — KTD3 degraded window (~800px). PASS
- Window 800×900 (group ≈ 500px; below the ~861px needed for 500+360+divider). Panes degraded proportionally: thread 290px / artifact 209px (ratio ≈ 500:360). `document.documentElement.scrollWidth == clientWidth == 800` → **no horizontal overflow**; divider rendered, not clipped.
- Divider immobility confirmed: attempted a leftward drag; thread/artifact stayed 290/209 (both pinned at their proportional minimums). Immobility here is a **PASS** per KTD3.
- No console errors, no visual jump. Screenshot: `flow4-degraded-800px.png` shows both panes rendering coherently (content wraps; nothing overlaps or clips). Sub-minimum widths at this window are accepted degradation, not a failure. KTD3 fallback (dynamic effective floor) was **not** triggered.

### Flow 5 — R3 mobile unchanged. PASS
- Window 700×900 (below the 768px `md` breakpoint). Resize handle computed style `display:none`; artifact iframe width 0 / not visible (`hidden md:flex` intact). Thread conversation fills the width. No horizontal overflow. Screenshot: `flow5-mobile-700px.png`.

### Flow 6 — Persistence still works. PASS
- Window 1440×900. Dragged to a valid non-default width (artifact 638px; `localStorage[...width]` = `"638"`). Reloaded and reopened the panel: artifact restored at **638px**, thread **501px** (≥500). Persistence model unaffected by the new floor; the floor is respected on restore. No console errors. Screenshot: `flow6-persist-restore.png`.

### Global checks
- Browser console: **zero** errors/warnings across all six flows (excluding Vite HMR/websocket noise).
- Dev server log: **zero** runtime errors (excluding the benign `callback.test.tsx` route-export warning, unrelated to this change).

## Paper cuts (non-blocking — recorded, not failing)

1. **No visible affordance when the thread pane hits its 500px floor.** Dragging left, the divider simply stops with no cursor/edge cue that a minimum was reached. This exactly mirrors the pre-existing artifact-side 360px min behavior (also affordance-less), so it is consistent, not a regression. Low priority; only worth a design pass if the resize interaction is ever revisited.
2. **The 500px guarantee does not hold in the 768–861px window band** (Flow 4). A user parked at ~800px with the artifact panel open sees a ~290px conversation — below the readability floor the feature otherwise promises. This is the **documented KTD3 tradeoff** (both minimums cannot fit; proportional flex degradation is the accepted behavior), not a defect. The plan's fallback — a dynamic effective floor `min(500px, groupWidth − 360px − handle)` — remains available as a follow-up if this narrow band ever draws a real complaint. Not recommended now: it adds measured-width logic for a window range that is rare on real desktops and never produces broken layout.

## Decisions for a human

None. All six flows pass functionally and experientially; both paper cuts are pre-existing-consistent or explicitly documented tradeoffs, neither blocking. THINK-211 is complete.
