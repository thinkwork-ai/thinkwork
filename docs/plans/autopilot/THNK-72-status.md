---
linear_issue: THNK-72
plan: "docs/plans/2026-06-25-001-feat-data-table-filter-work-items-plan.md"
requirements: "docs/brainstorms/2026-06-25-data-table-filter-work-items-requirements.md"
status: followup-ready
started_at: 2026-06-25T00:28:34Z
completed_at:
---

# THNK-72 Autopilot Status

## Scope

Port the Bazza UI data-table-filter interaction into ThinkWork as a
TanStack-only tokenized filter primitive, then pilot it on the `/work-items`
list table. V1 filters already-loaded Work Items rows client-side, removes the
visible Work Items saved-view controls, keeps board mode outside the filter
contract, and preserves the existing Work Items route behavior outside
filtering.

THNK-72 has no child issues, so the implementation units from the attached plan
are the execution units.

## Context Discovery

- Read `AGENTS.md`.
- Read the autopilot request attachment.
- Read Linear issue THNK-72 with description, labels, team, status history,
  documents, releases, customer needs, attachments, and relations.
- Read Linear comments for THNK-72.
- Read attached Linear documents:
  - `Brainstorm Summary: Data Table Filter for Work Items`
  - `Plan: Port data-table-filter to Work Items`
- Checked for child issues with `parentId=THNK-72`; none exist.
- Checked blockers, blocked-by, related, duplicate, releases, customer needs,
  and attachments; none are active.
- Searched the repo for `THNK-72`, `Port data-table-filter to Work Items`,
  `data-table-filter`, `Data Table Filter`, and `Work Items`.
- Read repo-local planning files referenced by Linear:
  - `docs/brainstorms/2026-06-25-data-table-filter-work-items-requirements.md`
  - `docs/plans/2026-06-25-001-feat-data-table-filter-work-items-plan.md`
- Read relevant repo-local solution guidance:
  - `docs/solutions/design-patterns/screen-owned-list-display-adapters-2026-06-14.md`
  - `docs/solutions/design-patterns/audit-existing-ui-and-data-model-before-parallel-build-2026-04-28.md`
- Read `docs/plans/autopilot/THNK-69-status.md` for recent Work Items rollout
  context and autopilot ledger conventions.

## Implementation Units

1. U1: Add shared token filter model and primitive.
2. U2: Extend `DataTable` for hidden filter columns.
3. U3: Create Work Items filter adapter and table columns.
4. U4: Remove Work Items saved-view and old filter UI from the page.
5. U5: Polish visual fit and verification coverage.

Dependency order is linear: U2 depends on U1; U3 depends on U1/U2; U4 depends
on U3; U5 verifies and polishes the integrated result.

## Linear State Changes

- 2026-06-25T00:28Z: Began autopilot context discovery for THNK-72. Linear
  state left unchanged during discovery as requested.
- 2026-06-25T00:29Z: Moved THNK-72 to `In Progress`, added a Linear
  implementation-start comment, and began U1 on branch
  `codex/thnk-72-token-filter` from fresh `origin/main`.
- 2026-06-25T00:38Z: Opened U1 PR #2945 and added Linear progress comment with
  local verification evidence.
- 2026-06-25T00:47Z: U1 PR #2945 merged via squash merge
  (`9bed33d747f61fd5a9018d805aa90b70e01bb25c`); remote branch deleted and
  local U1 worktree/branch cleanup verified.
- 2026-06-25T00:49Z: Began U2 from fresh `origin/main` on branch
  `codex/thnk-72-data-table-hidden-columns`.
- 2026-06-25T01:01Z: U2 PR #2946 merged via squash merge
  (`b72124c700e1aaf5958516cd3124cef378236aa3`); remote branch deleted and
  local U2 worktree/branch cleanup verified.
- 2026-06-25T01:03Z: Began U3/U4 grouped implementation from fresh
  `origin/main` on branch `codex/thnk-72-work-items-filter-adapter`.
- 2026-06-25T01:26Z: U3/U4 PR #2948 merged via squash merge
  (`863ad1baa0c0f335ae17147629c6ebbd205848f3`); remote branch deleted and
  local U3/U4 worktree/branch cleanup verified.
- 2026-06-25T01:28Z: Restarted `http://localhost:5174/` from the merged main
  checkout and verified `/work-items?view=list&sort=updated` renders the
  completed filter/table surface.
- 2026-06-25T01:43Z: Reopened implementation after local product review found
  the option filter menu too TanStack-demo-like: Work Items needed Bazza-style
  checkbox multi-select values and a separate operator menu.
- 2026-06-25T01:53Z: Verified the follow-up locally on
  `http://localhost:5174/work-items?view=list&sort=updated` and added Linear
  progress comment with evidence.

## Unit Log

### U1: Shared Token Filter Model and Primitive

Objective: create the reusable `@thinkwork/ui` token filter primitive and
helper filter functions without wiring Work Items yet.

Branch:

- `codex/thnk-72-token-filter`

Planned local verification:

- `pnpm --filter @thinkwork/ui test -- data-table-token-filter`
- Relevant `@thinkwork/ui` typecheck or package tests after implementation.

Implementation notes:

- Added `DataTableTokenFilter` as a generic TanStack-table-oriented shared UI
  primitive.
- Added compact V1 token filter state helpers for text, option, and boolean
  filters.
- Added generic TanStack filter functions for text, option, and boolean token
  values.
- Added interaction support for add, edit, remove, clear, empty draft cancel,
  single-token-per-field replacement, option loading/empty/error/unavailable
  states, and page reset on filter edits.

Local verification:

- 2026-06-25T00:35Z: Initial focused test failed before implementation because
  the new exports were missing, confirming the test-first guard.
- 2026-06-25T00:35Z: `pnpm --filter @thinkwork/ui test -- data-table-token-filter`
  passed.
- 2026-06-25T00:35Z: `pnpm --filter @thinkwork/ui typecheck` passed.
- 2026-06-25T00:35Z: `pnpm --filter @thinkwork/ui test` passed.
- 2026-06-25T00:35Z: `pnpm dlx prettier@3.6.2 --check ...` passed for touched
  THNK-72 files. Root `pnpm format:check` could not run in this worktree
  because `prettier` is not installed in the workspace dependency graph.

Status: merged.

PR:

- https://github.com/thinkwork-ai/thinkwork/pull/2945

### U2: DataTable Hidden Filter Columns

Objective: let callers add filter-only TanStack columns and initial visibility
without rendering those columns or affecting visible table layout.

Branch:

- `codex/thnk-72-data-table-hidden-columns`

Planned local verification:

- `pnpm --filter @thinkwork/ui test -- data-table`
- Relevant `@thinkwork/ui` typecheck or package tests after implementation.

Implementation notes:

- Added `initialColumnVisibility` to `DataTable` for filter-only hidden
  columns.
- Kept column visibility owned internally by DataTable while seeding the initial
  TanStack visibility state.
- Changed fixed-table `<colgroup>` rendering to use visible leaf columns only,
  so hidden filter columns cannot distort widths.
- Changed empty-state `colSpan` to use the visible leaf column count.
- Added coverage proving hidden columns do not render headers/cells/colgroup
  entries, can still filter rows, and keep empty-state colSpan aligned.

Local verification:

- 2026-06-25T00:50Z: Initial focused test failed before implementation because
  hidden columns still rendered and fixed-table colgroups included hidden
  columns.
- 2026-06-25T00:50Z: `pnpm --filter @thinkwork/ui test -- data-table` passed.
- 2026-06-25T00:50Z: `pnpm --filter @thinkwork/ui test` passed.
- 2026-06-25T00:50Z: `pnpm --filter @thinkwork/ui typecheck` passed.
- 2026-06-25T00:51Z: `pnpm dlx prettier@3.6.2 --check ...` passed for touched
  U2 files.

Status: merged.

PR:

- https://github.com/thinkwork-ai/thinkwork/pull/2946

### U3: Work Items Filter Adapter and Table Columns

Objective: add Work Items-specific token filter configuration and filter-only
columns beside the Work Items list view.

Branch:

- `codex/thnk-72-work-items-filter-adapter`

Planned local verification:

- Focused Work Items adapter tests.
- Focused Work Items list view tests.
- Relevant `apps/web` typecheck/test target after implementation.

Implementation notes:

- Added a Work Items token-filter adapter with hidden TanStack filter columns
  for search, status, priority, due bucket, required, blocked, applicable,
  Space, and owner.
- Converted the Work Items list view from the grouped custom list to
  `DataTable`, with visible columns for Work Item, Status, Priority, Due, and
  Threads.
- Wired `DataTableTokenFilter` into the list view toolbar so filters apply to
  already-loaded rows client-side.
- Tuned the table column sizing after browser verification so all visible
  columns fit in the current app shell width.

Local verification:

- 2026-06-25T01:09Z: Initial focused web test could not run because the fresh
  worktree was missing `node_modules`; ran `pnpm install` successfully. The
  optional `canvas` native build failed under Node 25 / missing `pkg-config`,
  but pnpm completed with exit code 0 and test tooling was installed.
- 2026-06-25T01:09Z: `pnpm --filter @thinkwork/web test -- work-item` passed
  with 4 files / 14 tests.
- 2026-06-25T01:10Z: `pnpm --filter @thinkwork/web typecheck` passed.
- 2026-06-25T01:13Z: After formatting and table-width polish,
  `pnpm --filter @thinkwork/web test -- work-item` passed with 4 files /
  14 tests.
- 2026-06-25T01:13Z: After formatting and table-width polish,
  `pnpm --filter @thinkwork/web typecheck` passed.
- 2026-06-25T01:13Z: Targeted Prettier check passed for touched Work Items
  files.
- 2026-06-25T01:15Z: `pnpm --filter @thinkwork/web test` passed with
  198 files / 1510 tests.
- 2026-06-25T01:13Z: Started the worktree web dev server on
  `http://localhost:5174/` after copying `apps/web/.env` from the main
  checkout.
- 2026-06-25T01:13Z: Browser smoke verified authenticated
  `http://localhost:5174/work-items?view=list&sort=updated`: Work Items page
  renders, filter menu opens, all visible table columns fit, and applying then
  clearing `Status is Todo` creates/removes a token while preserving the visible
  row.

Status: merged.

PR:

- https://github.com/thinkwork-ai/thinkwork/pull/2948

### U4: Remove Saved-View and Old Filter UI

Objective: stop exposing saved views and the old select-heavy filter row on
`/work-items` while preserving route context needed by existing navigation.

Branch:

- `codex/thnk-72-work-items-filter-adapter` (grouped with U3 because this is
  the smallest testable Work Items integration surface)

Planned local verification:

- Focused Work Items page and route-state tests.
- Existing shell/sidebar and Space route tests named by the plan.
- Relevant `apps/web` typecheck/test target after implementation.

Implementation notes:

- Removed the visible saved-view control and delete flow from the Work Items
  page header.
- Removed the old select-heavy Work Item filter row from the page.
- Deleted the now-unused `WorkItemFilters` and `WorkItemSavedViews`
  components/tests.
- Simplified Work Items route/search state to display context (`view`,
  `spaceId`, `threadId`, `sort`) and made legacy filter/saved-view query params
  ignored.
- Simplified `buildWorkItemsInput` so the API fetches the current display
  context while token filters run client-side in the table.

Local verification:

- Covered by the U3/U4 grouped verification above.

Status: merged.

PR:

- https://github.com/thinkwork-ai/thinkwork/pull/2948

### U5: Initial Polish and Verification

Objective: verify the token filter bar matches the reference interaction,
behaves on desktop/mobile widths, and does not regress the Work Items page.

Branch:

- `codex/thnk-72-work-items-filter-adapter` for integrated polish.
- `codex/thnk-72-closeout` for final status ledger closeout.

Planned local verification:

- Shared package and web focused tests.
- Browser smoke on `/work-items` after copying the ignored web `.env` into the
  worktree if needed.

Final verification:

- Shared U1 and U2 package tests/typechecks passed before their merges.
- U3/U4 focused Work Items tests, web typecheck, targeted formatting checks,
  and full `@thinkwork/web` test suite passed before merge.
- GitHub CI passed for all implementation PRs before merge.
- Authenticated browser smoke passed on merged main at
  `http://localhost:5174/work-items?view=list&sort=updated`: the table renders,
  visible columns fit the app shell, the Filter menu opens, a `Status is Todo`
  token applies, and clearing filters returns the page to a clean state.

Status: superseded by U6 follow-up polish.

### U6: Bazza-Exact Multi-Value Option Filters

Objective: address product review feedback that option filters must match the
Bazza demo interaction, not the TanStack demo: values are selected with
checkboxes, multiple values stay in one token, and operator selection is
separate from value selection.

Branch:

- `codex/thnk-72-multi-value-filters`

Implementation notes:

- Added option filter operators `is any of` and `is none of` while preserving
  boolean `is` / `is not` and text `contains` / `does not contain`.
- Extended token filter values to support arrays for multi-value option
  filters.
- Changed option value editing to a searchable checkbox list that applies
  immediately and keeps the menu open for multi-select.
- Split option operator editing into the token operator segment with its own
  searchable operator menu.
- Changed Work Items to use the icon-only filter trigger and red `Clear`
  action from the reference demo.
- Kept the change scoped to the shared primitive plus the Work Items pilot
  configuration.

Local verification:

- 2026-06-25T01:49Z: `pnpm --filter @thinkwork/ui test -- data-table-token-filter`
  passed with 9 tests.
- 2026-06-25T01:49Z: `pnpm --filter @thinkwork/ui typecheck` passed.
- 2026-06-25T01:49Z: `pnpm --filter @thinkwork/web test -- work-item` passed
  with 4 files / 14 tests.
- 2026-06-25T01:49Z: `pnpm --filter @thinkwork/web typecheck` passed.
- 2026-06-25T01:49Z: Targeted Prettier check passed for touched UI and Work
  Items files.
- 2026-06-25T01:52Z: Browser smoke verified
  `http://localhost:5174/work-items?view=list&sort=updated`: the Status value
  menu shows search plus checkbox rows only, selecting `Done` and `Todo`
  creates one `Status | is any of | 2 statuses` token, both values remain
  checked, the red `Clear` action appears, and the token operator segment opens
  a separate searchable operators menu with `is any of` and `is none of`.

Status: local verification passed; PR pending.

## Current Blockers

None. U6 is ready for PR/CI/merge.
