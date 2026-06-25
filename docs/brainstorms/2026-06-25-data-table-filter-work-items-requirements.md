---
date: 2026-06-25
topic: data-table-filter-work-items
---

# Data Table Filter for Work Items

## Problem Frame

ThinkWork should port the Bazza UI data-table-filter interaction as a ThinkWork-native filter primitive, preserving the Linear-style tokenized look and feel while adapting the behavior to the web app's React + TanStack Table stack. The first adoption is the `/work-items` list table. V1 filters the already-loaded client rows in the table and deliberately avoids Next.js, `nuqs`, URL-synchronized filter state, and server-side filtering.

The Work Items page currently has a select-heavy filter row plus saved-view controls. This feature replaces that filtering experience for the list table with a compact token builder and removes saved-view functionality from the Work Items page for now.

---

## Actors

- A1. ThinkWork operator: scans and narrows Work Items by status, priority, due state, ownership, and text.
- A2. Implementation planner: ports the interaction without reintroducing Bazza's Next.js or `nuqs` assumptions.

---

## Key Flows

- F1. Build a Work Items filter from tokens
  - **Trigger:** A ThinkWork operator opens `/work-items` in list view and wants to narrow the table.
  - **Actors:** A1
  - **Steps:** The operator opens the filter menu, chooses a Work Item property, chooses an operator, enters or selects a value, and sees the active filter render as a segmented token.
  - **Outcome:** The Work Items DataTable shows only currently loaded rows matching the active token filters.
  - **Covered by:** R1, R2, R3, R5, R6

- F2. Edit and clear active filters
  - **Trigger:** A ThinkWork operator wants to adjust the active Work Items view.
  - **Actors:** A1
  - **Steps:** The operator edits a token's subject, operator, or value, removes one token, or clears all filters.
  - **Outcome:** The table updates immediately without a route navigation, saved-view mutation, or backend refetch solely for filtering.
  - **Covered by:** R2, R4, R7, R8

---

## Requirements

**Filter primitive**

- R1. ThinkWork must introduce a reusable data-table filter primitive that preserves the Bazza UI / Linear-style tokenized visual language: filter button, active filter chips, segmented subject/operator/value controls, per-token remove action, and clear action.
- R2. The primitive must be TanStack Table oriented in V1: it controls or adapts to TanStack column filter state for an existing table instance rather than depending on Next.js routing, `nuqs`, or a server URL-state contract.
- R3. The primitive must support the Work Items filter types needed for the pilot: text search, single-option fields, boolean fields, and date/due-state style fields.
- R4. Filter changes must be local and immediate for V1. They must not update URL search params, saved views, or backend filter inputs as part of this port.

**Work Items pilot**

- R5. `/work-items` list view must be the only production pilot in V1.
- R6. The Work Items list table must expose token filters for the useful existing fields currently represented by the filter row where they make sense client-side: search/title text, Space, status/status category, priority, due state, required, blocked, and applicable.
- R7. The old select-heavy `WorkItemFilters` row should no longer be the primary list filtering UI after the pilot lands.
- R8. The Work Items page must remove saved-view functionality from the visible page experience for V1, including the saved-view selector/save/delete controls. Backend saved-view APIs are not part of this requirements scope.
- R9. Existing Work Items list behavior must remain intact outside filtering: table columns, pagination, status updates, thread links, metrics, refresh, loading, error, and empty states must not regress.
- R10. Board view is not a filter-behavior pilot for V1. Planning may keep board view available, but the token filter contract is only required to drive the TanStack DataTable list.

**Look and feel**

- R11. The visual result should match the screenshot/reference closely enough that a user recognizes the same interaction pattern: compact toolbar, outlined segmented tokens, icons in subject cells, muted operator cells, value segments, and close buttons.
- R12. The component must use ThinkWork's existing UI primitives and theme tokens so it feels native inside `@thinkwork/ui` and `apps/web`, rather than copying foreign app chrome wholesale.
- R13. The filter bar must fit in the existing Work Items page header/body layout on desktop and wrap or collapse gracefully on narrow widths without text overlap.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R6.** Given the user is on `/work-items` list view, when they add `Status is Done`, then an active token appears and the list table only shows loaded rows whose status matches Done.
- AE2. **Covers R3, R6.** Given the user adds a text filter for "onboarding", when the table updates, then rows whose searchable Work Item text does not match are hidden client-side.
- AE3. **Covers R4, R8.** Given a user edits or clears a token filter, when the table updates, then the URL search params and saved-view records are not changed by that filter edit.
- AE4. **Covers R7, R11, R12.** Given the Work Items page renders after the pilot, when the user scans the toolbar, then they see the tokenized filter interaction instead of the current row of individual select boxes.
- AE5. **Covers R9.** Given a filtered Work Items table, when the user changes an item's status or opens a thread link, then the existing action still works.

---

## Success Criteria

- Work Items filtering feels like the Bazza UI / Linear-inspired interaction while behaving as a local ThinkWork TanStack Table filter.
- Operators can narrow the list without managing saved views or route-state side effects.
- The handoff to planning is clear: V1 is a TanStack-only client-side pilot, not a full Bazza engine port and not a server filtering redesign.

---

## Scope Boundaries

- Do not port Next.js assumptions, `nuqs`, or Bazza's server-side filtering examples into V1.
- Do not make filter tokens route-restorable or shareable in V1.
- Do not build or keep Work Items saved-view UI as part of this pilot.
- Do not remove or redesign backend saved-view APIs solely because the Work Items page stops using them.
- Do not convert every ThinkWork table to the new filter primitive in V1.
- Do not require board view to participate in the new filter behavior.
- Do not introduce backend pagination or backend faceting work for this port.

---

## Key Decisions

- **TanStack-only port:** Preserve the interaction and visual grammar, but adapt the behavior to ThinkWork's TanStack Table usage.
- **Client-side first:** Filter the already-loaded Work Items rows in V1; avoid route and backend coupling until a later server-side version is intentionally scoped.
- **Work Items only:** Use `/work-items` list view as the production pilot and avoid broad table migration.
- **Saved views removed from the pilot:** The Work Items page should stop exposing saved-view functionality while this filter experience is being established.
- **Bazza is the canonical reference:** Use https://ui.bazza.dev/docs/data-table-filter and the `bazzalabs/ui` static TanStack demo as the behavioral/design source, with ThinkWork styling and architecture taking precedence where they conflict.

---

## Dependencies / Assumptions

- Verified context: ThinkWork web is Vite + React + TanStack Router, not Next.js.
- Verified context: Work Items route lives at `apps/web/src/routes/_authed/_shell/work-items.index.tsx`.
- Verified context: Work Items list view renders `DataTable` from `@thinkwork/ui` in `apps/web/src/components/work-items/WorkItemsListView.tsx`.
- Verified context: Work Items currently has route-backed filters and saved-view UI through `apps/web/src/components/work-items/WorkItemFilters.tsx`, `apps/web/src/components/work-items/WorkItemSavedViews.tsx`, and `apps/web/src/components/work-items/work-item-filters.ts`.
- Assumption: V1 can filter the current loaded row set without changing the GraphQL Work Items query contract.
- Assumption: Keeping board view available but outside the token-filter behavior is acceptable for the first pilot.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R2, R3][Technical] Decide whether the shared primitive owns a compact filter state model and maps into TanStack `ColumnFiltersState`, or whether it directly manipulates the table instance's column filters.
- [Affects R6][Technical] Decide the exact Work Item column ids/accessors needed so every token filter maps cleanly to the list table.
- [Affects R10][Product/technical] Confirm whether board view should render unfiltered loaded rows, hide the filter bar, or receive a later non-TanStack filtering adapter.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
