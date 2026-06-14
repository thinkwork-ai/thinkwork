---
title: "Screen-owned adapters keep reusable list display primitives portable"
date: 2026-06-14
category: design-patterns
module: "apps/web settings + @thinkwork/ui"
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Adding a reusable display mode to existing table-heavy React screens"
  - "Porting an interaction pattern from another app without copying domain-specific code"
  - "Restoring view configuration through route search params"
  - "Keeping shared UI primitives generic while pilot screens own labels, grouping, sorting, and row metadata"
related_components:
  - apps/web
  - packages/ui
  - settings
tags:
  - list-view
  - display-configuration
  - screen-adapters
  - route-state
  - data-table
  - settings
---

# Screen-owned adapters keep reusable list display primitives portable

## Context

THNK-22 added a LastMile-inspired List View and Display configuration pattern to
ThinkWork without replacing every existing `DataTable`. The useful product
shape was portable: a Display popover, Table/List modes, grouping,
sub-grouping, sorting, empty-group toggles, and selected row properties. The
LastMile implementation itself was not portable because it was tied to CRM/task
domain objects.

The shipped ThinkWork implementation proved the pattern on Settings Activity
Threads and Settings Automations. It kept Table as the default, preserved row
navigation and screen-specific empty/loading/error states, and restored list
configuration through TanStack Router search params. The implementation plan
explicitly called for compounding the pattern if the adapter split stayed clean;
PR #2469 landed that split and passed local and GitHub CI verification.

## Guidance

When adding a reusable list/display mode to an existing table surface, split the
work into three layers:

1. Shared UI primitives in `@thinkwork/ui`.
2. App-level state and projection helpers in `apps/web`.
3. Screen-owned adapters beside each adopting screen.

The shared UI package should stay generic. It should render controls and grouped
rows, but it should not know what an automation, activity item, model, Space, or
knowledge-base row means.

```ts
// packages/ui: visual control, no Settings-specific branches
<DisplayViewControl
  state={displayState}
  modes={[
    { value: "table", label: "Table" },
    { value: "list", label: "List" },
  ]}
  groups={SCREEN_DISPLAY_CONFIG.groups}
  subgroups={SCREEN_DISPLAY_CONFIG.subgroups}
  sorts={SCREEN_DISPLAY_CONFIG.sorts}
  properties={SCREEN_DISPLAY_CONFIG.properties}
  onStateChange={setDisplayState}
/>
```

Keep row semantics in the screen adapter. The adapter declares which modes are
supported, which grouping and sorting keys are legal, which row properties can
appear, and how a row opens its detail route.

```ts
export const AUTOMATIONS_DISPLAY_CONFIG = {
  modes: ["table", "list"],
  groups: [
    { value: "none", label: "None" },
    { value: "status", label: "Status" },
    { value: "type", label: "Type" },
    { value: "owner", label: "Owner" },
  ],
  defaults: {
    view: "table",
    group: "status",
    subgroup: "type",
    sort: "name",
    dir: "asc",
    showEmptyGroups: true,
    showEmptySubgroups: false,
    properties: ["type", "schedule", "owner", "lastRun"],
  },
};
```

Use a pure helper to normalize route state and project already-filtered rows
into groups. Unsupported route values should fall back to screen defaults rather
than rendering disabled modes or crashing.

```ts
const displayState = normalizeDisplayState(search, ACTIVITY_DISPLAY_CONFIG);

const listGroups = groupDisplayRows({
  rows: filteredRows,
  group: displayState.group,
  subgroup: displayState.subgroup,
  sort: displayState.sort,
  dir: displayState.dir,
  showEmptyGroups: displayState.showEmptyGroups,
  showEmptySubgroups: displayState.showEmptySubgroups,
  groupingOptions: activityGroupingOptions,
  sortOptions: activitySortOptions,
});
```

Preserve table behavior by rendering List as a sibling path, not as an overload
inside `DataTable`.

```tsx
const content =
  displayState.view === "list" ? (
    <GroupedListView groups={listGroups} renderRow={renderActivityRow} />
  ) : (
    <DataTable columns={columns} data={filteredRows} onRowClick={openRow} />
  );
```

## Why This Matters

The adapter split keeps reusable UI reusable. `DisplayViewControl` and
`GroupedListView` can support other screens because they receive options,
groups, row ids, and row renderers as props. The app-level helper captures the
hard-to-repeat state rules: route round-tripping, unsupported option fallback,
duplicate property removal, invalid subgroup cleanup, empty group handling, and
sort direction.

It also limits blast radius. Existing table-heavy screens often have mature
pagination, navigation, search, and empty-state behavior. A sibling List path
lets adopters improve scanning without mutating the table contract that other
screens depend on.

The review pass for THNK-22 found the risks this pattern is meant to avoid:
stale subgroup state when grouping becomes `none`, non-default list config
being erased while Table mode is active, duplicate display properties, the last
visible property being unchecked, collapse state leaking across grouping
changes, and detail navigation dropping display route params. Those are state
contract issues, not visual polish issues, so they belong in shared helpers and
focused tests.

## When to Apply

- A screen already has a table but users need to scan records by workflow
  dimensions such as status, owner, type, recency, Space, or agent.
- The first release should prove a pattern on pilot screens rather than rewrite
  every table-heavy surface.
- The list can be derived from the same already-loaded, already-filtered row set.
- Route-restored configuration is enough for v1; saved named views or team
  defaults are out of scope.
- The screen can own its row labels, grouping keys, sort comparators, empty
  buckets, visible metadata, and row navigation.

Do not use this pattern as-is when the surface primarily needs precise column
comparison, numeric auditing, dense matrix review, server-side pagination, or
backend grouping. Those screens may stay Table-only or need a separate backend
contract first.

## Examples

THNK-22 used the pattern in two pilots:

- Settings Automations groups scheduled jobs by status/type/owner, sorts by
  name, last run, schedule, status, or type, and keeps row navigation to
  `/settings/automations/$scheduledJobId`.
- Settings Activity Threads groups activity by recency/status/type/agent, keeps
  the existing `day` route state, and preserves thread detail navigation plus
  display params.

The important implementation boundary was:

- `packages/ui/src/components/ui/display-view-control.tsx` owns the popover
  controls.
- `packages/ui/src/components/ui/grouped-list-view.tsx` owns collapsible grouped
  rendering.
- `apps/web/src/lib/list-view-display.ts` owns route-state normalization and row
  grouping/sorting helpers.
- `apps/web/src/components/settings/SettingsActivity.tsx` and
  `apps/web/src/components/settings/SettingsAutomations.tsx` own their adapters
  and row renderers.

## Related

- Linear issue: THNK-22 List View
- Implementation PR: https://github.com/thinkwork-ai/thinkwork/pull/2469
- Final status PR: https://github.com/thinkwork-ai/thinkwork/pull/2470
- Plan: `docs/plans/2026-06-14-005-feat-list-view-display-configuration-plan.md`
- Requirements: `docs/brainstorms/2026-06-14-list-view-and-view-configuration-requirements.md`
- Status evidence: `docs/plans/autopilot/THNK-22-status.md`
- Related learning: `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
