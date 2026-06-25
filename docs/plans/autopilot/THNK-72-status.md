---
linear_issue: THNK-72
plan: "docs/plans/2026-06-25-001-feat-data-table-filter-work-items-plan.md"
requirements: "docs/brainstorms/2026-06-25-data-table-filter-work-items-requirements.md"
status: active
started_at: 2026-06-25T00:28:34Z
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

Status: locally verified; ready for commit/PR.

PR:

- https://github.com/thinkwork-ai/thinkwork/pull/2945

### U2: DataTable Hidden Filter Columns

Objective: let callers add filter-only TanStack columns and initial visibility
without rendering those columns or affecting visible table layout.

Branch: pending.

Planned local verification:

- `pnpm --filter @thinkwork/ui test -- data-table`
- Relevant `@thinkwork/ui` typecheck or package tests after implementation.

Status: pending.

### U3: Work Items Filter Adapter and Table Columns

Objective: add Work Items-specific token filter configuration and filter-only
columns beside the Work Items list view.

Branch: pending.

Planned local verification:

- Focused Work Items adapter tests.
- Focused Work Items list view tests.
- Relevant `apps/web` typecheck/test target after implementation.

Status: pending.

### U4: Remove Saved-View and Old Filter UI

Objective: stop exposing saved views and the old select-heavy filter row on
`/work-items` while preserving route context needed by existing navigation.

Branch: pending.

Planned local verification:

- Focused Work Items page and route-state tests.
- Existing shell/sidebar and Space route tests named by the plan.
- Relevant `apps/web` typecheck/test target after implementation.

Status: pending.

### U5: Polish and Verification

Objective: verify the token filter bar matches the reference interaction,
behaves on desktop/mobile widths, and does not regress the Work Items page.

Branch: pending.

Planned local verification:

- Shared package and web focused tests.
- Browser smoke on `/work-items` after copying the ignored web `.env` into the
  worktree if needed.

Status: pending.

## Current Blockers

None.
