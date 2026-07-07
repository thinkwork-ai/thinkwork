---
title: Thread Min Width - Plan
type: fix
date: 2026-07-06
topic: thread-min-width
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Thread Min Width - Plan

## Goal Capsule

- **Objective:** The Thread conversation pane in the chat/artifact split view can never be resized below 500px, so the conversation stays readable no matter how far the artifact side panel is dragged open.
- **Product authority:** Linear THINK-211 (Eric Odom); LFG closed loop pre-authorized.
- **Open blockers:** None.

## Product Contract

### Summary

Enforce a 500px minimum width on the Thread conversation pane in the thread/artifact resizable split. Today only the artifact panel has a minimum (360px) and a maximum (70vw); the thread pane has no floor of its own, so dragging the divider can crush the conversation to an unusable sliver on common laptop widths.

### Requirements

- R1. When the artifact side panel is open on desktop, the Thread conversation pane never renders narrower than 500px, regardless of divider drag position.
- R2. A persisted artifact-panel width (localStorage) that would violate the 500px thread floor on the current window is clamped at mount, not honored as stored.
- R3. The artifact panel's existing 360px minimum and the mobile behavior (split hidden below the `md` breakpoint) are unchanged.

### Acceptance Examples

- AE1. **Covers R1.** Given a 1440px-wide window with the artifact panel open, when the user drags the divider left as far as it will go, then the thread pane stops at 500px instead of shrinking to ~430px (30% of the window).
- AE2. **Covers R2.** Given a stored artifact-panel width of 1000px and a 1200px window, when the thread view mounts, then the artifact panel opens at a width that leaves the thread pane at least 500px.

### Scope Boundaries

- Only the thread/artifact split owned by the thread view is in scope. Other resizable splits (workspace file editor, settings editors) keep their current constraints.
- No redesign of the resize interaction, divider, or persistence model — this is a constraint fix.

### Dependencies / Assumptions

- The split is built on `react-resizable-panels` v4, which already accepts pixel-unit `minSize` (the artifact panel uses one today), so the floor is a declarative constraint, not new resize logic.
- Assumption for planning to verify: when the window is too narrow to satisfy both minimums plus the divider (below roughly 861px but at or above the 768px `md` breakpoint where the split still renders), the library clamps panels rather than breaking layout; confirm the degraded behavior is acceptable at those widths. **Resolved in planning — see KTD3 and Risks.**

### Sources / Research

- `apps/web/src/components/workbench/TaskThreadView.tsx` — owns the `ResizablePanelGroup`; the thread `ResizablePanel` has no `minSize`, while the artifact panel declares `minSize` 360px / `maxSize` 70vw.
- `apps/web/src/components/artifacts/thread-artifact-panel-store.ts` — persisted global panel width with `MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX = 360`; storage clamps only the artifact side.
- `packages/ui/src/components/ui/resizable.tsx` — thin wrapper over `react-resizable-panels` v4 primitives.

---

## Planning Contract

**Product Contract preservation:** Product Contract unchanged. The one planning-time assumption it flagged (degraded 768–861px window) is resolved below without altering any R/AE.

### Key Technical Decisions

- **KTD1 — Declarative pixel floor, no new resize logic.** Add `minSize` in pixel units to the thread `ResizablePanel` in `TaskThreadView.tsx`, the same v4 mechanism the artifact panel already uses (`minSize={`${MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX}px`}`). Define the constant `MIN_THREAD_PANE_WIDTH_PX = 500` next to `MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX` in `thread-artifact-panel-store.ts`, which already owns the split's width constants.
- **KTD2 — R2 rides the library's mount-time layout validation, not new store logic.** `react-resizable-panels` v4 converts pixel constraints to percentages of the measured group and validates the initial layout against *all* panels' constraints, so a stored 1000px `defaultSize` on a 1200px window is clamped by the thread pane's declared floor without touching `getStoredThreadArtifactPanelWidthPx`. **Verified at planning time against the v4.11.0 dist:** the initial layout derived from `defaultSize` passes through the same validation that clamps each panel to its derived min/max and redistributes. Note the clamped width is also *persisted* immediately at mount, not on the next drag — v4 fires `onResize` with the initial measured size via its ResizeObserver — so repeating AE2 requires re-seeding localStorage each attempt. AE2 in a real browser remains the proof. **Contingency (only if AE2 fails):** clamp the width in a pure helper exported from `thread-artifact-panel-store.ts` (unit-testable there) and apply it to `defaultSize` in `TaskThreadView` (`min(stored, groupWidth − 500 − handle)`) — an execution-time decision, not pre-committed.
- **KTD3 — Degraded window (group width < ~861px while ≥ `md`): accept library normalization, with a defined fallback.** Between the 768px `md` breakpoint and ~861px (500 + 360 + 1px divider), both minimums cannot be satisfied. **Verified at planning time against the v4.11.0 dist:** over-constrained layouts render via `flexGrow` percentages with `flexShrink: 1`, so a >100% constraint sum degrades proportionally rather than overflowing (both panes also carry `min-w-0`), and the drag resolver clamps every delta to zero while both pivots sit at their minimums — the divider is grabbable but intentionally immobile there. This is acceptable degradation: the floor is guaranteed at ≥ ~861px group width, which covers every realistic desktop use. Verification explicitly checks ~800px for visual breakage. **Fallback if verification finds breakage:** dynamic effective floor `min(500px, groupWidth − 360px − handle)` on the thread pane, computed from measured group width — a follow-up repair, not part of U1's first PR.

### Child Issue Split

None. This is a single shippable unit; the parent THINK-211 itself is the work item and moves Ready to Work → Verification → Done. Creating a lone child would only add dispatcher hops.

### Checkpoint PR Boundaries

- U1 → one PR to `main` (`fix(web): enforce 500px thread-pane minimum width (THINK-211)`). No grouping question arises with a single unit. Web changes reach deployed dev via continuous CD from `main`; note that the user-facing web bundle ships on `desktop-v*` canary tags, so *dev-stage* verification is against the dev deploy from `main` per the standard lane flow.

---

## Implementation Units

### U1. Enforce the 500px thread-pane floor

- **Goal:** The thread conversation pane can never render below 500px in the thread/artifact split, including from persisted widths at mount.
- **Requirements:** R1, R2, R3; AE1, AE2.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/components/artifacts/thread-artifact-panel-store.ts` — add exported `MIN_THREAD_PANE_WIDTH_PX = 500` beside the existing width constants (no behavior change in the store itself).
  - `apps/web/src/components/workbench/TaskThreadView.tsx` — add `minSize` (pixel unit, from the new constant) to the thread `ResizablePanel` (the currently unconstrained first panel in the `ResizablePanelGroup`).
  - `apps/web/src/components/artifacts/thread-artifact-panel-store.test.ts` — existing suite stays green; add a trivial assertion that the new constant is exported at 500 only if it earns its keep (no clamp logic lands in the store under KTD2's primary path).
- **Approach:** Purely declarative per KTD1/KTD2. Do not modify the artifact panel's `minSize`/`maxSize`, the handle, the persistence key, or the `md` visibility classes (R3). No changes to `packages/ui` — the wrapper already passes `minSize` through.
- **Test scenarios:** JSDOM cannot measure layout, so resize behavior is not unit-testable; the enforced coverage is the browser Verification Contract below. `Test expectation: unit tests limited to keeping thread-artifact-panel-store.test.ts green` — behavioral proof is browser-driven per lane doctrine. If the KTD2 contingency lands, its store-exported clamp helper must gain unit tests in `thread-artifact-panel-store.test.ts`: stored width larger than available space clamps to leave 500px; stored width within bounds passes through unchanged; non-finite stored values fall back to default.
- **Verification:** See Verification Contract (all six flows). Complete when the PR is merged, the post-merge Deploy run on `main` is green, and the flows pass against deployed dev.

---

## Verification Contract

All flows run in a real browser against deployed dev (dev is continuous-CD from `main`; wait for the post-merge Deploy run). Entry point: any thread containing at least one card-rendered artifact; open the artifact panel by clicking its ArtifactCard.

1. **AE1 / R1 — drag floor (primary flow).** At a ~1440px-wide window with the artifact panel open, drag the divider left as far as it will go. Expected: the thread pane stops at 500px (measure via devtools; previously ~430px) and content stays readable; the artifact panel absorbs the rest.
2. **AE2 / R2 — persisted-width clamp at mount.** In devtools, set `localStorage["thinkwork.thread-artifact-panel.width"] = "1000"`, size the window to ~1200px, reload, reopen the artifact panel. Expected: at mount the thread pane is ≥ 500px; the artifact panel opens narrower than 1000px. Note: mount immediately re-persists the clamped width (KTD2), so re-seed localStorage before each repeat of this flow.
3. **R3 — artifact minimum unchanged.** Drag the divider right as far as it will go. Expected: the artifact panel stops at 360px, exactly as before.
4. **KTD3 — degraded window.** Size the window to ~800px (above `md`, below ~861px total constraint), including resizing the OS window live through this zone from a wider layout. Expected: both panes render, no horizontal overflow or clipped divider, no console errors, no visual jump/flash during the live resize. The divider is grabbable but expected NOT to move while both panes are pinned at their minimums — immobility here is a pass; a *visually broken* layout is the failure that triggers KTD3's fallback. Sub-minimum pane widths here are accepted degradation, not a failure.
5. **R3 — mobile unchanged.** Size below 768px. Expected: handle and artifact panel are hidden (`hidden md:flex`), thread fills the width — identical to current behavior.
6. **Persistence still works.** Drag to a valid width (e.g., artifact ≈ 600px), reload, reopen the panel. Expected: the panel restores at the dragged width and the thread pane is ≥ 500px.

---

## Definition of Done

- U1 PR merged to `main` with green CI; post-merge Deploy run on `main` green.
- All six Verification Contract flows pass on deployed dev with evidence (screenshots + measured widths for flows 1–2).
- No regression in `apps/web` test suite; no changes outside the three `apps/web` files listed in U1.

## Risks

- **Over-constrained degraded window (768–861px).** Accepted per KTD3 with a defined fallback; behavior verified against the library dist at planning time; verification flow 4 is the browser tripwire.
- **Mount clamp depends on library behavior (KTD2).** Verified against the v4.11.0 dist at planning time; if the real browser nevertheless contradicts it, AE2 fails in verification and the documented contingency (store-exported clamp helper applied to `defaultSize`) is the smallest repair.
- **Persisted preference is rewritten downward on narrow windows.** Mounting on a narrow window permanently clamps the stored width (it does not spring back when the window widens). This follows directly from R2 plus the existing single-global-width persistence model — accepted product tradeoff, not a defect.
- **Rollout:** none beyond standard web deploy — no schema, API, flag, or Terraform surface; instantly revertable single-file constraint.
