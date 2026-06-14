---
date: 2026-06-14
topic: list-view-and-view-configuration
linear: THNK-22
---

# List View and View Configuration

## Problem Frame

ThinkWork has several operational list surfaces that currently render as dense data tables. Tables are still useful when users need exact column comparison, but they are a poor default for workflow-style scanning: grouped work, status review, ownership buckets, time-based activity, and row summaries are easier to read in a Linear-style list.

THNK-22 asks to bring over the useful LastMile pattern: a List view that can sit beside existing Table views, plus a Display configuration popover for grouping, sub-grouping, sorting, direction, empty-group visibility, and displayed properties. The goal is not to rewrite every table. The goal is to establish a reusable ThinkWork list-surface pattern and prove it on high-fit screens.

---

## Actors

- A1. ThinkWork operator: scans tenant-wide operational records such as activity, automations, Spaces, knowledge bases, tools, or other settings lists.
- A2. ThinkWork end user: scans row-like work surfaces where grouped status, owner, or recency matters more than column-by-column comparison.
- A3. Implementation planner: decides which existing screens are eligible for the shared List View pattern without re-litigating product behavior.

---

## Key Flows

- F1. Switch a supported surface from Table to List
  - **Trigger:** A user opens a screen that supports both dense table scanning and grouped list scanning.
  - **Actors:** A1 or A2
  - **Steps:** The screen renders its normal toolbar; the user opens the Display control; the user selects List; the row collection re-renders as grouped list rows without changing the selected dataset or search/filter state.
  - **Outcome:** The user can scan the same records as a List view and can switch back to Table when column comparison is better.
  - **Covered by:** R1, R2, R3, R4, R9

- F2. Configure the List view
  - **Trigger:** A user wants the list organized around a different working question.
  - **Actors:** A1 or A2
  - **Steps:** The user opens Display; chooses grouping, optional sub-grouping, sort field, and direction; toggles empty group visibility when applicable; selects the properties visible on each row.
  - **Outcome:** The List view updates immediately and keeps the current screen context intact.
  - **Covered by:** R5, R6, R7, R8, R9, R10

- F3. Use a List row as an entry point
  - **Trigger:** A user finds a relevant record in a grouped list.
  - **Actors:** A1 or A2
  - **Steps:** The user expands or collapses groups as needed; scans the row title and visible property chips; opens a row.
  - **Outcome:** Existing row-click navigation or detail-sheet behavior is preserved.
  - **Covered by:** R11, R12, R13

---

## Requirements

**Reusable list surface**

- R1. ThinkWork must introduce a reusable List View pattern for row collections where each record has a primary label plus metadata properties.
- R2. List View must coexist with existing Table views on eligible screens; v1 must not remove the current table path from pilot surfaces.
- R3. The first release must prove the pattern on a small pilot set rather than converting every table-heavy screen at once.
- R4. The v1 pilot set should include Settings Activity and Settings Automations because both already expose row collections with useful status, type, owner, and recency dimensions.

**Display configuration**

- R5. Eligible screens must expose a Display control that lets users switch between supported view modes for that screen.
- R6. The Display control must only offer modes that actually work on the current screen; it must not show a Board/Map/Calendar option unless that mode is implemented for the surface.
- R7. List configuration must support grouping, optional sub-grouping, sort field, sort direction, and show/hide empty groups where the underlying data can express those choices.
- R8. List configuration must support display-property selection so screens can decide which row metadata appears as compact chips or secondary text.
- R9. Changing view mode or List configuration must preserve active search/filter context on the current screen.
- R10. List configuration should be restorable through screen state such as URL search params or equivalent route-local state; saved named views are not required for v1.

**List rendering behavior**

- R11. List groups and sub-groups must render as collapsible section headers with readable labels and record counts.
- R12. List rows must prioritize a clear primary title, then a compact set of screen-specific metadata properties, rather than recreating every table column inside the row.
- R13. Existing row actions must continue to work from List view, including row-click navigation, detail sheets, or existing inline affordances that are available from Table view.
- R14. Empty, loading, and error states must remain screen-specific and must not regress when a user switches between Table and List.

**Adoption rules**

- R15. A screen is eligible for List View when grouped scanning is materially useful: status, owner, type, recency, Space, agent, or similar workflow dimensions should help users make sense of the records.
- R16. A screen should remain Table-only when its primary job is precise column comparison, numeric auditing, or dense matrix-style review.
- R17. LastMile should be used as the interaction reference for Display configuration and List grouping, but ThinkWork should adapt the pattern to its existing `@thinkwork/ui` primitives and web app design language.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R9.** Given a user is on Settings Automations with a search query active, when they switch from Table to List in Display, then the filtered automations remain filtered and render as list rows instead of a table.
- AE2. **Covers R7, R8, R11, R12.** Given Settings Activity supports grouping by recency or status, when the user groups the List view and selects visible properties, then the screen shows collapsible groups with counts and each row shows only the selected metadata chips.
- AE3. **Covers R6.** Given a pilot screen only supports Table and List, when the user opens Display, then the control does not advertise Board, Map, or Calendar as selectable modes.
- AE4. **Covers R10.** Given a user configures a pilot List view and refreshes or shares the route, when the screen reloads, then the selected view and core List configuration are restored without needing a server-side saved-view feature.
- AE5. **Covers R13, R14.** Given a row opens a detail page or sheet from the current Table view, when the same row appears in List view, then selecting it opens the same destination and loading/error/empty states remain coherent.

---

## Success Criteria

- Users can choose a grouped List view on the pilot screens when table scanning feels too column-heavy.
- The Display control feels like a ThinkWork-native version of the LastMile interaction, not a disconnected settings panel.
- Existing table workflows remain available and do not regress on the pilot screens.
- Planning can proceed without re-deciding whether v1 is a broad table rewrite, whether Board is required, or which configuration knobs belong in the List view.

---

## Scope Boundaries

- Do not replace every ThinkWork data table in v1.
- Do not build Board, Map, or Calendar views unless a separate requirements document scopes those modes.
- Do not add saved named views, shared team defaults, or server-persisted view preferences in v1.
- Do not add new backend filtering, grouping, or pagination contracts solely for this brainstorm; planning may identify backend work only if a pilot screen cannot meet the requirements client-side.
- Do not make List view a generic card grid. The desired pattern is a dense grouped list with row metadata, not marketing-style cards or dashboard tiles.
- Do not remove existing search, filter, row-click, pagination, loading, empty, or error behavior from pilot screens.

---

## Key Decisions

- **V1 is reusable primitive plus pilot adoption.** This gives the product a real pattern without turning THNK-22 into a risky rewrite of every DataTable screen.
- **Table remains available.** List view solves grouped scanning; it does not replace precise column comparison.
- **Display shows only implemented modes.** The LastMile screenshot includes Table/List/Board, but ThinkWork should not advertise modes that are not implemented for a given screen.
- **Use LastMile as interaction reference, not a blind port.** The useful behavior transfers; ThinkWork styling, component primitives, and route conventions still lead.

---

## Dependencies / Assumptions

- Verified context: THNK-22 has no comments, child issues, dependencies, related issues, or Linear documents at the time of this brainstorm.
- Verified context: THNK-22 embeds two LastMile screenshots showing a grouped list and Display configuration.
- Verified context: the LastMile lmi app includes a Display control with view selection and List-specific grouping, sub-grouping, sorting, direction, empty-group toggles, and display properties.
- Verified context: ThinkWork web already has table-heavy list surfaces using `DataTable`, including `apps/web/src/components/settings/SettingsAutomations.tsx`, `apps/web/src/components/settings/SettingsActivity.tsx`, `apps/web/src/components/settings/SettingsSpaces.tsx`, and `apps/web/src/components/settings/SettingsKnowledgeBases.tsx`.
- Assumption: Settings Activity and Settings Automations are the best first pilots because they have row metadata that benefits from grouped list scanning. Planning may swap one pilot only if codebase validation finds a materially better fit with the same product intent.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] Confirm the exact two pilot surfaces after reading component dependencies and test coverage.
- [Affects R10][Technical] Decide whether route search params or a local screen-state helper should store the v1 configuration.
- [Affects R8][Design] Decide each pilot screen's allowed display-property list and default visible properties.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
