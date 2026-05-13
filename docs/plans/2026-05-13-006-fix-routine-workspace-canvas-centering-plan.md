---
title: "fix: Center routine workflow canvas inside visible area when sidebar is open"
type: fix
status: active
date: 2026-05-13
---

# fix: Center routine workflow canvas inside visible area when sidebar is open

## Summary

The routine detail Workflow tab and the execution detail page render their inspector sidebar as an `absolute inset-y-0 right-0 w-[380px|440px]` overlay inside the same container as the React Flow canvas. Because React Flow's `fitView` measures the *container* width — sidebar included — nodes get centered using the full width and visually shift left of the actually-visible canvas area. This plan replaces the absolute-overlay layout with a flex split (canvas column + adjacent inspector column), so the canvas's measured width matches its visible width and `fitView` centers correctly. The non-`xl` Sheet-drawer fallback is preserved unchanged.

## Requirements

- R1. The React Flow canvas in the routine detail Workflow tab centers nodes inside the visible canvas area when the inspector sidebar is open at `xl+` breakpoints.
- R2. The React Flow canvas in the execution detail page centers nodes inside the visible canvas area when the step-details sidebar is open at `xl+` breakpoints.
- R3. Mobile/tablet behavior at `<xl` is unchanged — the inspector continues to live in the Sheet drawer triggered by the existing "Details" button.
- R4. Inspector sidebar contents, dimensions, and chrome (380px on routine detail, 440px on execution detail; border-l, card background, blur) are visually preserved.
- R5. The "Add step" button and any other in-canvas overlays remain anchored to the visible canvas area, not to the new sidebar column.

---

## Scope Boundaries

- Not redesigning the inspector content, step config UI, or React Flow node visuals.
- Not changing `fitViewOptions` padding or zoom limits — the goal is for the existing `padding: 0.18` to behave correctly once the container width is honest.
- Not introducing a resizer/draggable splitter between canvas and inspector — fixed-width sidebar is fine for v1.
- Not touching the default (non-`workspace`) `RoutineWorkflowEditor` layout — it already uses a grid split (`xl:grid-cols-[minmax(0,1fr)_360px]`) and is unaffected.

### Deferred to Follow-Up Work

- Resizable splitter or persisted-width preferences for the inspector column: future iteration if operators ask for it.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx` — workspace branch (lines ~190–219) renders the canvas full-width and overlays the inspector with `absolute inset-y-0 right-0 z-20 w-[380px] xl:flex`. This is the primary site of the bug.
- `apps/admin/src/components/routines/RoutineFlowCanvas.tsx` — uses `<ReactFlow fitView fitViewOptions={{ padding: 0.18 }} … />`. `fitView` reads container size from xyflow's internal `ResizeObserver`, which measures the canvas's actual layout box — so the fix only needs to ensure the canvas's layout width equals the visible width.
- `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx` (default branch, line 221) — already uses `<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">`. This is the proven local pattern to mirror; the workspace layout just needs the same shape adapted to `h-full min-h-0 flex` (since workspace mode fills the page height instead of stacking).
- `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx` (lines ~218–242) — parallel pattern: `<div className="relative h-full min-h-0 overflow-hidden rounded-md border …">` with `ExecutionGraph` (which wraps `RoutineFlowCanvas`) and a `w-[440px]` absolute sidebar overlay. Same bug, same fix.
- Sheet drawer fallback (`Sheet`/`SheetContent` in both files) handles `<xl` and stays intact across both units.

### Institutional Learnings

- None directly applicable in `docs/solutions/`. The pattern of using `absolute` for fixed side panels next to React Flow is a known foot-gun in xyflow-based editors — the canonical fix in the xyflow community is to take the panel out of the canvas's layout box.

### External References

- xyflow `fitView` docs: viewport fit is computed against the React Flow container's measured size, so making the canvas container narrower (rather than padding the fit) is the right primitive when an adjacent panel exists.

---

## Key Technical Decisions

- **Refactor layout, don't patch `fitViewOptions` padding.** The two options surfaced by the user were (a) take the sidebar out of the canvas's layout box, or (b) compensate inside React Flow (e.g., `fitViewOptions={{ padding: { right: 380 } }}` or a manual `setViewport` offset). Option (a) is chosen because: (1) it keeps the canvas's measured width honest, so every xyflow behavior (fitView, panning bounds, controls placement, future "zoom to selection") works without a coupled magic number; (2) it removes the runtime coupling between sidebar width and canvas centering — change the sidebar to 420px tomorrow and nothing else moves; (3) it mirrors the proven non-workspace grid split already in the same file.
- **Use flex with fixed-width sidebar, not grid.** The workspace layout is height-constrained (`h-full min-h-0`) and needs the canvas to flex while the sidebar stays a constant 380px (routine) / 440px (execution). `flex` with `flex-1 min-w-0` on the canvas and `shrink-0` on the sidebar expresses this most directly. Grid with `[minmax(0,1fr)_380px]` would also work and matches the non-workspace pattern; flex is preferred here because the sidebar column needs `min-h-0 flex flex-col` for inner scrolling and that composes more cleanly under a flex parent.
- **Keep in-canvas overlay buttons inside the canvas column.** The mobile-only "Details" button (`absolute right-28 top-3 xl:hidden` in `RoutineWorkflowEditor`, `absolute right-3 top-3 xl:hidden` in execution detail) and the canvas's own badges/Add-step button (in `RoutineFlowCanvas`) anchor to the canvas's relative parent, which is now the canvas column rather than the outer wrapper. Class names already use `xl:hidden`, so they remain hidden when the sidebar column is visible — no class changes needed beyond moving the JSX inside the new canvas column.

---

## Open Questions

### Resolved During Planning

- Should the fix cover the execution detail page too? Yes — confirmed by the user. Both pages share `RoutineFlowCanvas` and the same overlay pattern, so a partial fix would ship a visible inconsistency.
- Should `fitViewOptions.padding` be adjusted? No — once the container width is honest, the existing `0.18` ratio works.

### Deferred to Implementation

- Whether the `relative` modifier on the canvas column needs to stay for `RoutineFlowCanvas`'s own internal `absolute` overlays (badges, Add step button). Almost certainly yes (and that's the natural shape of a flex column anyway), but final confirmation requires running the dev server.

---

## Implementation Units

### U1. Refactor RoutineWorkflowEditor workspace layout to canvas + sidebar flex split

**Goal:** Replace the absolute-overlay inspector sidebar in the workspace branch of `RoutineWorkflowEditor` with a flex split so the canvas column's width is the visible canvas width and `fitView` centers correctly.

**Requirements:** R1, R3, R4, R5

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx`

**Approach:**
- In the `workspace` branch (currently `<>` fragment containing the `relative min-h-0 flex-1 overflow-hidden …` div), replace the outer single container with a two-column flex row that fills the available height.
- Canvas column: `flex-1 min-w-0 relative overflow-hidden rounded-md border border-border/80 bg-background h-full min-h-0`. Houses `{flowCanvas}` and the `xl:hidden` mobile "Details" button. Border + rounded-md stay here so the canvas keeps its current chrome.
- Sidebar column: `hidden xl:flex w-[380px] shrink-0 min-h-0 flex-col border border-border/70 bg-card/95 rounded-md backdrop-blur` (replace the old absolute classes; drop `inset-y-0 right-0 z-20 shadow-2xl` — they were compensating for being overlaid). Contains `{renderSidebar()}` unchanged.
- The outer flex parent gets `flex gap-3 h-full min-h-0`. Keep the parent `<section className="h-full min-h-0">` from `RoutineDefinitionPanel` as-is — only the inner workspace layout changes.
- The `Sheet` block stays unchanged outside the new flex row.
- Verify the canvas column still establishes a positioning context for `RoutineFlowCanvas`'s internal absolute overlays (badges, Add-step button) — `relative` on the canvas column handles this.

**Technical design:** *(directional)*

```
<section h-full min-h-0>
  <div flex gap-3 h-full min-h-0>
    <div flex-1 min-w-0 relative overflow-hidden rounded-md border h-full min-h-0>   ← canvas column
      {flowCanvas}
      <Button xl:hidden Details/>
    </div>
    <div hidden xl:flex w-[380px] shrink-0 min-h-0 flex-col border rounded-md bg-card/95>   ← sidebar column
      {renderSidebar()}
    </div>
  </div>
  <Sheet …/>   ← unchanged, drives <xl drawer
</section>
```

**Patterns to follow:**
- Non-workspace branch in the same file (line ~221): `<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">{flowCanvas}<div className="min-h-0">{inspector}</div></div>`. The new workspace shape is the height-filling flex equivalent.
- The inner scroll structure of `renderSidebar()` (`shrink-0 border-b` header + `min-h-0 flex-1 overflow-y-auto` body) already composes correctly under a flex column parent — no changes needed inside `renderSidebar`.

**Test scenarios:**
- Test expectation: none -- CSS layout refactor with no behavioral change. xyflow's `fitView` centering is driven by container `ResizeObserver` in a real browser and is not exercised by Vitest + JSDOM, so unit-test coverage would not catch the bug. The component has no existing unit tests (`RoutineWorkflowEditor` is not referenced from any `*.test.*` in `apps/admin/src/components/routines/`), and adding one solely for this CSS change would be churn. Verification is via the dev-server visual check below.

**Verification:**
- Start the admin dev server (`pnpm --filter @thinkwork/admin dev`, port 5174 — register the port in Cognito if running from a worktree).
- Open a routine with at least 3 nodes (e.g., the "Check Austin Weather Codex" routine from the screenshot) at viewport width ≥ 1280px (`xl` breakpoint).
- The workflow nodes are visually centered inside the canvas area to the left of the inspector sidebar, not centered in the full container width.
- Resize the browser to <1280px: the sidebar disappears, the "Details" button appears, opening it shows the inspector in a right-side Sheet drawer, and the canvas continues to fill the now-full container.
- Selecting a node still highlights the corresponding inspector content; saving still works.

---

### U2. Refactor execution detail page sidebar to canvas + sidebar flex split

**Goal:** Apply the same overlay-to-flex-split refactor on the execution detail page so its step-details sidebar no longer overlays the React Flow container.

**Requirements:** R2, R3, R4, R5

**Dependencies:** None (independent of U1; the two pages don't share the wrapper code, only `RoutineFlowCanvas`)

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx`

**Approach:**
- Replace the `<div className="relative h-full min-h-0 overflow-hidden rounded-md border border-border/80 bg-background">` wrapper that currently holds `ExecutionGraph` + the `xl:hidden` Details button + the `absolute inset-y-0 right-0 w-[440px]` step-details panel with a two-column flex row matching U1's shape but with `w-[440px]` for the sidebar.
- Canvas column: `flex-1 min-w-0 relative overflow-hidden rounded-md border border-border/80 bg-background h-full min-h-0`. Houses `<ExecutionGraph … className="h-full min-h-0 rounded-none border-0" />` (className stays as-is — `ExecutionGraph` already expects to fill its parent) plus the `xl:hidden` Details button.
- Sidebar column: `hidden xl:block w-[440px] shrink-0 min-h-0 overflow-y-auto border border-border/70 bg-card/95 rounded-md backdrop-blur`. Contains `{renderStepDetails()}` unchanged.
- Outer `<PageLayout>` wrapper stays the same; only the inner div changes.
- `Sheet` block at lines ~243–253 stays unchanged.

**Patterns to follow:**
- U1's resulting layout — identical structure with the 440px sidebar width substituted.
- Existing `xl:hidden` / `xl:block` breakpoint discipline in this file.

**Test scenarios:**
- Test expectation: none -- parallel CSS layout refactor to U1. Same reasoning: no behavioral change, xyflow centering not reproducible under JSDOM, no existing component tests on this route. Verification via dev server.

**Verification:**
- With the admin dev server running, navigate to an execution detail page (any executed routine run) at ≥ 1280px wide.
- The execution graph nodes are visually centered inside the canvas area, not centered behind the step-details panel.
- The step-details panel renders with the same chrome and width as before (440px, border-l, card background, blur).
- Selecting a step still updates the panel; clicking the canvas background still deselects.
- At <1280px the panel disappears, the Details button appears, and the Sheet drawer continues to work.

---

## System-Wide Impact

- **Interaction graph:** No changes to event handlers, mutations, or queries. Only the JSX wrapping of three regions (canvas, inspector, mobile Sheet) is rearranged.
- **API surface parity:** Both routine detail and execution detail render workflow graphs via `RoutineFlowCanvas`. Both are fixed in this plan; no other consumer of `RoutineFlowCanvas` exists in `apps/admin/src` (grep-verified).
- **Unchanged invariants:**
  - `RoutineFlowCanvas` itself is not modified — its `fitViewOptions={{ padding: 0.18 }}`, `minZoom`, `maxZoom`, `nodesDraggable`, and event handlers are untouched.
  - `renderSidebar()` and `renderStepDetails()` callbacks are untouched — they continue to render the same content under both desktop sidebar and mobile Sheet.
  - Sheet drawer behavior at `<xl` is preserved.
  - The default (non-`workspace`) `RoutineWorkflowEditor` layout is unaffected.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Canvas column loses its rounded-md border or background when the surrounding border is moved off the outer wrapper. | Move the `rounded-md border border-border/80 bg-background` styling onto the canvas column directly; mirror with `rounded-md border border-border/70` on the sidebar column so the visual chrome matches the previous overlay look. |
| `min-w-0` is missing on the canvas column, causing flexbox to refuse to shrink the React Flow container below its intrinsic content width and breaking centering at narrow `xl` widths. | Include `flex-1 min-w-0` on the canvas column — this is the standard flex-truncation pattern and is already used in the non-workspace grid (`minmax(0,1fr)`). Verification step exercises a narrow `xl` viewport. |
| In-canvas absolute overlays (Add-step button, badges) reposition unexpectedly because their positioning context changes from outer wrapper to canvas column. | The positioning context was already the canvas column's nearest `relative` ancestor before the refactor (the React Flow canvas is itself `relative h-[…] w-full`), so semantics are unchanged. Verify badges still appear at `left-3 top-3` of the canvas and Add-step button at `right-3 top-3`. |
| At `xl` exactly (1280px), the 380/440px sidebar plus padding leaves the canvas column too narrow and nodes look cramped. | Existing behavior at the `xl` breakpoint pre-bug was already 380/440 of overlay coverage; the visible canvas area in the new layout matches the previously-visible-area. If cramping is observed, it can be addressed with a `2xl:`-only sidebar widening in a follow-up — out of scope here. |

---

## Sources & References

- Related code: `apps/admin/src/components/routines/RoutineWorkflowEditor.tsx`, `apps/admin/src/components/routines/RoutineFlowCanvas.tsx`, `apps/admin/src/routes/_authed/_tenant/automations/routines/$routineId_.executions.$executionId.tsx`, `apps/admin/src/components/routines/ExecutionGraph.tsx`
- Related PRs: #828 (`fix(admin): polish routine workflow workspace`), #782 (`feat(routines): add visual workflow graph UX`)
- xyflow `fitView` reference: https://reactflow.dev/api-reference/react-flow#fitviewoptions
