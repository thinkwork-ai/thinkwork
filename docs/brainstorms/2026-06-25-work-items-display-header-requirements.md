---
date: 2026-06-25
topic: work-items-display-header
---

# Work Items Display Header

## Problem Frame

The Work Items page already has List and Board views, but view configuration is split across saved views, tabs, filters, and simple sort controls. The desired change is a fresh, route-state-only display header for Work Items that ports the useful LastMile `HeaderDisplay` interaction for choosing List or Board and configuring how each view is grouped, sorted, and annotated.

The goal is not to add saved named views or a Table mode. The goal is to make `/work-items` feel like a focused operational work surface where a user can quickly change the current view shape without leaving the page or committing preferences to the backend.

---

## Actors

- A1. Work Item user: scans and adjusts operational Work Items from `/work-items`.
- A2. Implementation planner: translates the display-header requirements into route state, UI controls, and List/Board rendering behavior without re-scoping saved views or table mode.

---

## Key Flows

- F1. Switch between List and Board
  - **Trigger:** A user opens the Work Items display header.
  - **Actors:** A1
  - **Steps:** The user sees only List and Board view choices; selects the desired view; the Work Items page re-renders the same filtered dataset in that view.
  - **Outcome:** The user can move between List and Board without changing filters, search, or backend-saved preferences.
  - **Covered by:** R1, R2, R3, R9

- F2. Configure List view
  - **Trigger:** A user wants the Work Items list organized around a different working question.
  - **Actors:** A1
  - **Steps:** The user selects List; chooses grouping, optional sub-grouping, sort field, sort direction, empty-group visibility, and visible display properties.
  - **Outcome:** The List view updates immediately from route state and shows only the selected metadata properties.
  - **Covered by:** R4, R5, R6, R7, R8, R9

- F3. Configure Board view
  - **Trigger:** A user wants the Work Items board organized by different lanes or swimlanes.
  - **Actors:** A1
  - **Steps:** The user selects Board; chooses board columns, optional row grouping, optional sub-grouping, sort field, sort direction, empty-column or empty-row visibility, and visible display properties.
  - **Outcome:** The Board view updates immediately from route state and preserves Work Item status-change behavior.
  - **Covered by:** R4, R5, R6, R7, R8, R9, R10

---

## Requirements

**Display header scope**

- R1. `/work-items` must replace the current saved-view selector and separate List/Board tabs with a single Display header control for view configuration.
- R2. The Display header must offer only `List` and `Board` view modes; Table, Map, and Calendar must not appear in this scope.
- R3. Saved Work Item Views are out of scope for this page iteration and should be removed from the Work Items user flow rather than adapted into the display header.

**Route-state behavior**

- R4. Display header changes must update route/search state immediately so refresh, browser navigation, and link sharing preserve the current view shape.
- R5. Route state must remain the source of truth for view mode, grouping, sub-grouping, sorting, sort direction, empty-group visibility, and selected display properties.
- R6. Changing display settings must preserve existing Work Item filters and search terms unless the user explicitly clears or changes those filters.

**List configuration**

- R7. List mode must support the LastMile-style controls: grouping, sub-grouping, sort by, direction, show empty groups, show empty sub-groups, and display properties.
- R8. List display properties must be Work Item-specific metadata choices such as status, priority, owner, due date, Space, thread/source indicators, created, updated, completed, required, blocked, and applicability.

**Board configuration**

- R9. Board mode must support the LastMile-style controls: columns, optional row grouping, sub-grouping, sort by, direction, show empty columns, show empty rows, and display properties.
- R10. Board status updates and existing Work Item card actions must keep working after view configuration changes.

**Rendering expectations**

- R11. List and Board rendering must respect the selected display properties by showing selected metadata and hiding unselected metadata without changing the underlying Work Item data.
- R12. Grouping and sub-grouping labels must use Work Item language and avoid LastMile-specific domain labels such as order number, organization, task type, estimate, or fuel-dispatch concepts.
- R13. The display header should match the LastMile interaction structure closely while using ThinkWork UI primitives and the existing Work Items visual language.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a user opens `/work-items`, when they open Display, then they see List and Board choices and do not see saved view, Table, Map, or Calendar controls.
- AE2. **Covers R4, R5, R6.** Given a user has searched for `onboarding`, when they switch to Board and group by priority, then the search remains active and the URL can restore the same Board configuration after refresh.
- AE3. **Covers R7, R8, R11.** Given a user selects List and hides `Due date`, when the list renders, then Work Item rows omit due-date metadata while keeping status, title, and row actions intact.
- AE4. **Covers R9, R10, R11.** Given a user selects Board and changes columns from status to priority, when they update a card's status through an existing status control, then the status mutation still works and the card remains visible in the configured Board view.
- AE5. **Covers R12, R13.** Given the Display header is modeled on LastMile, when Work Items property choices render, then labels are Work Item-native rather than LastMile-specific.

---

## Success Criteria

- A Work Item user can configure List or Board shape from one Display control without learning separate tabs, saved views, and filter controls.
- Work Items keep search/filter continuity while view configuration changes.
- Planning can proceed without re-deciding saved views, Table mode, or whether LastMile labels should be copied verbatim.
- The implementation can be verified through route-state restoration and visible List/Board metadata changes.

---

## Scope Boundaries

- Do not build or retain saved named Work Item Views in this iteration.
- Do not add Table, Map, Calendar, or TanStack table column-order/column-visibility controls.
- Do not change Work Item creation, status mutation, GraphQL schema, or backend filtering contracts solely for this display-header work.
- Do not import LastMile domain labels or dispatch-specific behavior into ThinkWork Work Items.
- Do not convert unrelated Settings tables or other list surfaces as part of this plan.

---

## Key Decisions

- **Route state is the source of truth.** The user chose route state over saved views, so the display header config is shareable and ephemeral rather than backend-persisted.
- **List and Board only.** Work Items should not gain a Table mode just to host TanStack table controls.
- **LastMile interaction, ThinkWork vocabulary.** The structure of the display popover is ported, but property labels and grouping options must map to Work Item concepts.

---

## Dependencies / Assumptions

- Verified context: `/work-items` currently exists at `apps/web/src/routes/_authed/_shell/work-items.index.tsx` and renders `apps/web/src/components/work-items/WorkItemsPage.tsx`.
- Verified context: Work Items currently has separate List and Board components at `apps/web/src/components/work-items/WorkItemsListView.tsx` and `apps/web/src/components/work-items/WorkItemsBoardView.tsx`.
- Verified context: Work Item saved views exist in GraphQL and UI today, but this brainstorm scopes removing the saved-view user flow from `/work-items` rather than extending it.
- Verified context: LastMile's `src/components/header/header-display.tsx` uses one Display popover for view mode, List configuration, Board configuration, and per-view display properties.
- Assumption: route-state-only configuration is acceptable for v1 even though saved view GraphQL types remain available for future use or other surfaces.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R5][Technical] Decide the exact route search keys and defaults for Work Item List and Board configuration.
- [Affects R8, R9][Design] Choose the initial allowed grouping, sub-grouping, sort, column, and display-property option sets from the available Work Item fields.
- [Affects R13][Technical] Decide whether to adapt the LastMile component shape directly or create a smaller Work Items-specific display-header component.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
