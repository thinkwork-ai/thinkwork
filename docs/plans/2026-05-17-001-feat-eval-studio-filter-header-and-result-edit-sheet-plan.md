---
title: "feat: Improve Eval Studio filters and result editing access"
type: feat
status: active
date: 2026-05-17
---

# feat: Improve Eval Studio filters and result editing access

## Overview

Improve the admin evaluation authoring/review workflow so the Eval Studio filter controls behave like the Eval Runs page, result detail sheets have enough room for trace and rubric evidence, and operators can jump from an eval result directly into the test case editor without losing review context.

---

## Problem Frame

The current Eval Studio places search inside a card header that scrolls away with the table, and it lacks category toggles even though RedTeam work depends on category-level scanning. Eval result side sheets are narrower than the content they show, and reviewing a failed run requires manually finding the matching test case in Studio before editing it.

---

## Requirements Trace

- R1. Eval Studio must show category toggles and search together on the left side of a better non-scrolling header, matching the Eval Runs filter pattern.
- R2. Eval result side sheets must be widened to 750px.
- R3. The eval result side sheet must link to the Edit Eval component for result rows with a test case id.
- R4. The edit link must preserve the side-sheet workflow by opening the existing edit UI in a side sheet, not forcing a full page transition.
- R5. The change must follow existing admin UI conventions, use focused tests for behavior helpers, and avoid backend/API changes.

---

## Scope Boundaries

- Do not change eval execution, scoring, runner fan-out, or backend GraphQL contracts.
- Do not redesign the Eval Studio form fields or RedTeam corpus content.
- Do not add new persistence for edit-sheet state; the sheet is route/query-state local to the admin SPA.
- Do not introduce a new table system; keep using existing admin table primitives where practical.

---

## Context & Research

### Relevant Code and Patterns

- `apps/admin/src/components/PageLayout.tsx` already provides a fixed header area with a separate scrollable content area.
- `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx` renders the run detail category badges above a scrollable `DataTable` and owns the eval result side sheet.
- `apps/admin/src/routes/_authed/_tenant/evaluations/studio/index.tsx` currently renders Eval Studio search inside `CardHeader`, which scrolls with the table.
- `apps/admin/src/routes/_authed/_tenant/evaluations/studio/edit.$testCaseId.tsx` and `apps/admin/src/components/evaluations/EvalTestCaseForm.tsx` are the existing edit surface to reuse.
- `apps/admin/src/routes/_authed/_tenant/evaluations/studio/$testCaseId.tsx` has a similar history result side sheet and should receive the same width treatment for consistency.

### Institutional Learnings

- `docs/solutions/diagnostics/eval-runner-stall-findings-2026-05-16.md` reinforces that eval UI should make progress and scope visible while runs are being reviewed.
- `docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md` reinforces that category/test-case scope must be explicit and verifiable in eval workflows.

### External References

- None. This is a local admin UI refinement using existing React, TanStack Router, urql, and shadcn-style components.

---

## Key Technical Decisions

- Use `PageHeader.children` for Eval Studio filters so the controls remain in the fixed page header area and visually match Eval Runs.
- Compute category options client-side from loaded test cases and apply category filtering locally, while keeping the existing server-side name search variable.
- Keep the Eval Studio table in a scrollable body using `DataTable` so table headers remain visible and the page-level filters do not scroll away.
- Reuse `EvalTestCaseForm` inside a route-adjacent sheet component for result-driven edits, rather than duplicating edit form fields.
- Use an explicit sheet width class `data-[side=right]:w-[min(750px,calc(100vw-2rem))]` so desktop gets 750px while small viewports remain usable.

---

## Open Questions

### Resolved During Planning

- Should this touch backend data? No. Existing result rows already expose `testCaseId`, and the edit form already loads by id.
- Should the edit affordance be a page link or sheet? The request explicitly says display in side sheet, so this plan uses a nested edit sheet from the result sheet.

### Deferred to Implementation

- Exact shared helper names for category derivation/filtering can be adjusted while editing the route file.
- Whether the Studio detail-history sheet should also expose the edit sheet depends on how easily the shared component shape falls out during implementation.

---

## Implementation Units

- U1. **Eval Studio fixed filter header**

**Goal:** Move Studio search and category toggles into a non-scrolling header area and keep test cases in a scrollable table.

**Requirements:** R1, R5

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/studio/index.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/evaluations/studio/-studio-filters.test.ts`

**Approach:**
- Add small pure helpers for deriving sorted categories, counting visible items, and filtering by selected category.
- Render filter badges in `PageHeader.children` with the same compact badge pattern as Eval Runs.
- Keep search input beside the badges on the left and keep import/new-test actions on the right.
- Replace the card-wrapped table with a height-constrained `DataTable` so the page header stays fixed and the table body scrolls.

**Patterns to follow:**
- Category badge UX in `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx`.
- Fixed page header behavior in `apps/admin/src/components/PageLayout.tsx`.

**Test scenarios:**
- Happy path: mixed test cases produce an `All` count plus sorted category filters.
- Happy path: selecting a category returns only matching test cases.
- Edge case: missing/blank categories are excluded from category toggles but still visible under `All`.
- Edge case: no selected category returns all search results from the query.

**Verification:**
- Eval Studio shows category toggles and search in the fixed header area; scrolling the table does not move those controls.

---

- U2. **Wider result side sheets**

**Goal:** Widen evaluation result detail sheets to 750px while preserving responsive behavior.

**Requirements:** R2, R5

**Dependencies:** None

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/studio/$testCaseId.tsx`

**Approach:**
- Replace `sm:max-w-2xl` result sheet sizing with a 750px right-sheet width class capped by viewport width.
- Keep existing overflow behavior so trace, expected, actual output, and assertions remain scrollable inside the sheet.

**Patterns to follow:**
- Existing right-sheet width classes in routine detail sheets under `apps/admin/src/routes/_authed/_tenant/automations/`.

**Test scenarios:**
- Test expectation: none -- this is a styling-only width adjustment verified by browser inspection.

**Verification:**
- Result detail sheets are wider on desktop and do not overflow mobile/narrow widths.

---

- U3. **Edit Eval from result sheet**

**Goal:** Add an Edit Eval affordance to the run result side sheet that opens the existing edit form in a side sheet for rows tied to a test case.

**Requirements:** R3, R4, R5

**Dependencies:** U2

**Files:**
- Modify: `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx`
- Modify: `apps/admin/src/components/evaluations/EvalTestCaseForm.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/evaluations/-result-detail.test.ts`

**Approach:**
- Add a nested edit sheet state in the run detail page and pass an `onEditTestCase` callback into `ResultDetailSheet`.
- Show an icon/text edit button only when `result.testCaseId` is present.
- Reuse `EvalTestCaseForm` with `initial`, `isEdit`, and a completion callback so a successful save closes the edit sheet and refreshes the run result query.
- Extend `EvalTestCaseForm` with an optional post-submit callback or redirect override, preserving existing full-page edit behavior.

**Patterns to follow:**
- Existing edit route `apps/admin/src/routes/_authed/_tenant/evaluations/studio/edit.$testCaseId.tsx`.
- Header action hoisting already supported by `EvalTestCaseForm.onActions`.

**Test scenarios:**
- Happy path: result detail helper reports the edit action is available when `testCaseId` is present.
- Edge case: result rows without `testCaseId` do not show the edit action.
- Integration: saving from the embedded form can avoid the default navigation path and invoke the supplied completion callback.

**Verification:**
- From a run result side sheet, clicking Edit opens a 750px edit sheet populated with the matching test case; saving closes the edit sheet and leaves the operator on the run detail page.

---

## System-Wide Impact

- **Interaction graph:** Admin-only route/component changes; no API, database, eval runner, CLI, or mobile impact.
- **Error propagation:** Existing urql query errors remain in component state; the new edit sheet should show `PageSkeleton` while loading and a simple not-found state if the test case disappears.
- **State lifecycle risks:** Nested sheets must close cleanly without leaving stale selected test case ids after result rows change.
- **API surface parity:** No GraphQL schema change required.
- **Integration coverage:** Browser verification should cover Studio scrolling, result sheet width, and edit-sheet launch.
- **Unchanged invariants:** Existing full-page Studio edit route must continue to work.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Nested side sheets feel cramped or trap focus unexpectedly | Keep result sheet and edit sheet separate, use existing `Sheet` primitives, and verify in browser. |
| Search/category filters double-filter unexpectedly | Treat server-side search as the base result set and apply category filtering locally to that result set. |
| Embedded edit form navigates away after save | Add an explicit callback/redirect control to `EvalTestCaseForm` and test the helper behavior. |
| Generated route types change after adding tests or route imports | Run admin typecheck and codegen only if route generation requires it. |

---

## Documentation / Operational Notes

- No user-facing docs or deployment runbook changes are required.
- PR description should mention this is a UI-only admin workflow improvement.

---

## Sources & References

- Related code: `apps/admin/src/routes/_authed/_tenant/evaluations/studio/index.tsx`
- Related code: `apps/admin/src/routes/_authed/_tenant/evaluations/$runId.tsx`
- Related code: `apps/admin/src/components/evaluations/EvalTestCaseForm.tsx`
- Related learning: `docs/solutions/diagnostics/eval-runner-stall-findings-2026-05-16.md`
- Related learning: `docs/solutions/logic-errors/eval-runner-ignored-system-workflow-test-case-selection-2026-05-03.md`
