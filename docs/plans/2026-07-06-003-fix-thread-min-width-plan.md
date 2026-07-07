---
title: Thread Min Width - Plan
type: fix
date: 2026-07-06
topic: thread-min-width
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
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
- Assumption for planning to verify: when the window is too narrow to satisfy both minimums plus the divider (below roughly 861px but at or above the 768px `md` breakpoint where the split still renders), the library clamps panels rather than breaking layout; confirm the degraded behavior is acceptable at those widths.

### Sources / Research

- `apps/web/src/components/workbench/TaskThreadView.tsx` — owns the `ResizablePanelGroup`; the thread `ResizablePanel` has no `minSize`, while the artifact panel declares `minSize` 360px / `maxSize` 70vw.
- `apps/web/src/components/artifacts/thread-artifact-panel-store.ts` — persisted global panel width with `MIN_THREAD_ARTIFACT_PANEL_WIDTH_PX = 360`; storage clamps only the artifact side.
- `packages/ui/src/components/ui/resizable.tsx` — thin wrapper over `react-resizable-panels` v4 primitives.
