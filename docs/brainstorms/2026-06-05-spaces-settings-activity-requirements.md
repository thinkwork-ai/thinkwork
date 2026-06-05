---
date: 2026-06-05
topic: spaces-settings-activity
---

# Spaces Settings Activity

## Problem Frame

Spaces Settings has an Analytics page for cost, but it does not yet give operators the Activity view they use in admin to audit recent thread activity. Operators need a Settings-native Activity page that reuses the useful parts of admin Analytics > Activity while matching the visual structure of other Spaces Settings pages. The page must also preserve date context when the operator drills from a filtered activity list into a thread detail view and then navigates back.

---

## Actors

- A1. Operator: reviews recent workspace activity from Spaces Settings and opens thread details for investigation.
- A2. Spaces Settings shell: provides the sidebar, header bar, breadcrumbs, and Settings page layout.
- A3. Thread detail viewer: displays the selected thread while keeping the operator in the Settings context when entered from Activity.

---

## Key Flows

- F1. Browse activity
  - **Trigger:** A1 opens the new Activity item in Spaces Settings.
  - **Actors:** A1, A2
  - **Steps:** The Settings shell shows an Activity breadcrumb/header matching other Settings pages; the page displays recent activity count, the 30-day bar chart, search, refresh, and a paginated thread activity table.
  - **Outcome:** A1 can scan recent thread activity without leaving Settings.
  - **Covered by:** R1, R2, R3, R4

- F2. Filter by day
  - **Trigger:** A1 clicks a day in the Activity chart.
  - **Actors:** A1, A2
  - **Steps:** The selected chart day becomes the active date filter; the table shows only matching thread rows; the selected date badge and clear action appear on the same horizontal row as Search Activity.
  - **Outcome:** The filtered day is visible, reversible, and encoded in the page URL so reload/back navigation keeps the filter.
  - **Covered by:** R5, R6, R7, R8

- F3. Open and return from thread detail
  - **Trigger:** A1 clicks a thread row while optionally filtered by a date.
  - **Actors:** A1, A2, A3
  - **Steps:** The selected thread opens in a Settings-hosted thread detail view; the Settings breadcrumb trail includes Activity, the selected date when present, and the thread title; breadcrumb links return to unfiltered Activity or the date-filtered Activity page.
  - **Outcome:** A1 can investigate a thread and reliably return to the exact Activity context they came from.
  - **Covered by:** R9, R10, R11, R12

---

## Requirements

**Settings placement and page shape**

- R1. Add a standalone Activity page to Spaces Settings, visible to the same operator audience as Settings Analytics.
- R2. The Activity page header area must follow the Settings Analytics page pattern: Settings header breadcrumb/title behavior, in-body page title, and Settings content spacing rather than the admin Analytics tab header.
- R3. Activity should be a Settings navigation destination named "Activity", not a tab inside Settings Analytics.
- R4. The Activity page should preserve the useful admin Activity tab surface: 30-day activity bar chart, item count, search activity input, refresh action, thread activity table, status badge, cost, duration, relative time, empty state, and pagination.

**Filtering and table behavior**

- R5. Clicking a chart day toggles that day as the active date filter for the thread list.
- R6. When a date filter is active, the selected date badge and "Clear date filter" control render on the same horizontal row as the Search Activity input rather than in a separate row below it.
- R7. The active date filter must be represented in the URL as route search state so reloads, browser back/forward, and copied links preserve the filtered day.
- R8. Clearing the date filter removes the date from the URL and returns the Activity table to the unfiltered state without resetting the search text unless the user explicitly changes it.

**Thread detail and breadcrumbs**

- R9. Clicking a thread row from Activity opens a Settings-hosted Thread Detail page rather than navigating to the main Threads shell.
- R10. The Settings-hosted Thread Detail page must port the relevant Spaces thread detail experience so operators can inspect the thread without losing Settings navigation.
- R11. When opened from unfiltered Activity, the thread detail breadcrumb trail includes a clickable "Activity" crumb that returns to the unfiltered Activity page, followed by the thread title.
- R12. When opened from date-filtered Activity, the thread detail breadcrumb trail includes "Activity" linking to unfiltered Activity, then the selected date linking to date-filtered Activity, then the thread title. Browser back should also return to the date-filtered Activity page.
- R13. Breadcrumb links in the Settings header must preserve route search state when a crumb supplies it.

**Visual and interaction quality**

- R14. The Activity chart should visually indicate the selected date and de-emphasize non-selected dates, matching the admin behavior.
- R15. The table row click target should feel consistent with other clickable list/table rows in Spaces Settings.
- R16. The page must behave well at common desktop widths used by the Settings shell: toolbar controls should not overlap, long thread titles should truncate cleanly, and pagination should remain reachable.

---

## Acceptance Examples

- AE1. **Covers R5, R6, R7.** Given the Activity page is unfiltered, when an operator clicks the May 31 chart bar, the table shows only May 31 rows, the URL contains the selected day, and the "May 31" badge plus "Clear date filter" appear beside the Search Activity input.
- AE2. **Covers R8.** Given the Activity page has search text and a selected date, when the operator clears the date filter, the date is removed from the URL and the search text remains applied.
- AE3. **Covers R9, R11.** Given the Activity page is unfiltered, when the operator opens a thread row, the thread detail opens inside Settings and the "Activity" breadcrumb returns to unfiltered Activity.
- AE4. **Covers R9, R12, R13.** Given the Activity page is filtered to May 31, when the operator opens a thread row, the thread detail breadcrumb is Activity > May 31 > thread title; clicking May 31 returns to Activity filtered to May 31, while clicking Activity returns to Activity with no date filter.

---

## Success Criteria

- Operators can audit recent thread activity in Spaces Settings with the same core capability they had in admin Analytics > Activity.
- Date-filtered investigations are not lossy: the selected date survives reload, browser back/forward, breadcrumb navigation, and thread-detail drill-in.
- The new Activity page feels native to Spaces Settings rather than a pasted admin Analytics tab.
- A downstream planner can proceed without inventing the page location, filter behavior, breadcrumb semantics, or thread-detail navigation model.

---

## Scope Boundaries

- Do not redesign the broader Analytics cost page.
- Do not add new activity types beyond what the admin Activity table already normalizes for thread activity unless planning finds they are already available at no extra product cost.
- Do not add new backend analytics aggregation solely for this page in the brainstormed v1; use existing thread/activity data where possible and defer backend performance decisions to planning.
- Do not build a new thread detail design from scratch; port or adapt the existing Spaces thread detail experience into the Settings context.
- Do not expose this page to non-operator users unless an existing Settings access policy already grants them Analytics-level visibility.

---

## Key Decisions

- **Activity is standalone in Settings.** The user asked for a new Settings page called Activity, and the breadcrumb requirements refer to Activity as its own navigable parent.
- **Date is URL state.** Breadcrumbs and browser back cannot reliably remember the filtered day if the selected day only lives in component state.
- **Thread detail stays inside Settings when launched from Activity.** Leaving the Settings shell would break the operator's mental model and make Activity breadcrumbs impossible.
- **The toolbar is a single row.** The selected date and clear control belong beside Search Activity to reduce vertical jump and keep the active filter near the filter input.

---

## Dependencies / Assumptions

- Verified context: admin currently has an Analytics > Activity tab with chart day filtering, search, refresh, and row navigation.
- Verified context: Spaces Settings has an Analytics page whose header/content pattern should be used as the visual template.
- Verified context: Spaces has a thread detail route/component already used by the main thread shell; the Settings-hosted version should preserve Settings breadcrumbs and back behavior.
- Verified context: Settings breadcrumbs are driven by shared page header state; preserving breadcrumb search state is part of this feature's required behavior.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R10][Technical] Decide whether to move admin activity utilities into a shared package/location or port a Spaces-specific version.
- [Affects R4, R7][Technical] Decide whether thread activity should load through the existing paged threads query, an existing admin-style list query, or a small Spaces-specific query shape.
- [Affects R10, R12][Technical] Decide whether Settings thread detail should be a wrapper around the existing Spaces thread detail component or a dedicated route variant with injected breadcrumbs/back links.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
