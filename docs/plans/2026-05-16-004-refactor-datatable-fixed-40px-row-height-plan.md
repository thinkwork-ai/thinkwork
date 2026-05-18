---
title: "refactor: DataTable always renders 40px row height"
type: refactor
status: active
created: 2026-05-16
plan_depth: lightweight
---

# Summary

Force every body row in every `DataTable` instance across `apps/admin` and `apps/computer` to render at exactly 40px tall, regardless of cell content. Today, row height drifts because cells contain stacked badges, multi-line metadata, large buttons, or empty padding; we want a uniform 40px row across all 48 callsites.

There are **two** `DataTable` wrappers in the monorepo, both descended from the same shadcn pattern and now divergent:

1. `apps/admin/src/components/ui/data-table.tsx` — used by every `DataTable` callsite in `apps/admin` (~44 usages).
2. `packages/ui/src/components/ui/data-table.tsx` — exported as `@thinkwork/ui` and used by 4 callsites in `apps/computer` (`ArtifactsTable`, `TaskDashboard`, `CustomizeTable`, `memory.kbs`).

Both wrappers expose a `compact` prop documented as "Compact row height (~40px)" but only the `@thinkwork/ui` copy applies row-level classes; the admin copy only touches cell padding. No DataTable caller in either app actually passes `compact={true}` — every callsite currently inherits the inconsistent default row height. The fix is to make 40px the only mode, in both wrappers, and delete the now-meaningless prop.

---

# Problem Frame

- **Symptom.** Visual inspection of the admin SPA and computer app shows row heights varying between roughly 32px and 80px+ across DataTables, driven entirely by cell content (badges, action buttons, multi-line metadata).
- **Root cause.** Neither wrapper enforces a row height: admin's copy ignores row height entirely, and `@thinkwork/ui`'s copy applies `h-10` only when `compact={true}` — a prop no caller passes.
- **User intent.** The user acknowledges this is a content-driven artifact and wants the visual result locked to 40px universally. Cells whose content exceeds 40px will be clipped — that is the desired behavior.

---

# Scope

In scope:
- Both `DataTable` wrapper components.
- Existing `compact` prop removal (no caller relies on it).
- Vitest snapshot updates if any snapshots assert row classNames.

Out of scope:
- Standalone `<Table>` / `<TableRow>` usage outside `DataTable` (e.g., hand-rolled `<table>` markup in routes). Only `DataTable`-wrapped tables are affected. If the user wants raw `<Table>` rows pinned to 40px later, that's a follow-up.
- Header row height — header already renders at `h-10` via `TableHead` and is not part of the request.
- Empty-state "No results." row — keeps its existing `h-24` centered placeholder.
- `apps/mobile` (no DataTable usage).

### Deferred to Follow-Up Work

- None.

---

# Key Technical Decisions

### Lock height with `h-10` on `<TableRow>` + zero vertical cell padding

The two-line implementation that achieves the goal:

- `<TableRow>` in body rows gets `h-10 [&>td]:py-0 [&>td]:overflow-hidden`.
  - `h-10` → 40px height.
  - `[&>td]:py-0` → neutralizes `TableCell`'s default `p-2`, which would otherwise force ≥48px regardless of row `h-10` (table cells size to content).
  - `[&>td]:overflow-hidden` → clips taller content (multi-line stacks, large icons) so the row cannot grow.
- `<TableCell>` keeps its existing `align-middle whitespace-nowrap` so single-line content remains vertically centered and doesn't wrap to multiple lines.

Horizontal cell padding (`px-2` portion of the primitive's `p-2`) stays intact — we only override the vertical axis.

### Delete the `compact` prop entirely

No caller in either app passes `compact`. The prop's docstring claimed "Compact row height (~40px)" — that's now the only mode. Per repo conventions (CLAUDE.md: "Avoid backwards-compatibility hacks … if you are certain that something is unused, you can delete it completely"), we remove the prop, its docstring, and its destructured argument from both wrappers.

### Keep the two wrappers as-is (no consolidation)

The two-wrapper divergence is real but unrelated to this task. Consolidating admin's copy into `@thinkwork/ui` is a larger refactor (admin's `DataTablePagination` and `data-table-filter-bar` would need to follow); it deserves its own plan. Today we patch both wrappers identically.

### Acknowledge the trade-off: content clipping is intentional

Some current cells render two-line patterns (e.g., "name above, email below"). Those will visibly truncate to a single line. The user has explicitly accepted this — they want consistent 40px rows.

---

# Implementation Units

### U1. Pin row height in `@thinkwork/ui` DataTable

**Goal.** Make `packages/ui/src/components/ui/data-table.tsx` always render body rows at 40px.

**Requirements.** Body rows in all `apps/computer` DataTables render exactly 40px tall.

**Dependencies.** None.

**Files.**
- `packages/ui/src/components/ui/data-table.tsx` (modify)

**Approach.**
- In the `<TableRow>` rendered inside the `table.getRowModel().rows.map(...)` loop:
  - Replace the existing className array (`"max-h-10 [&>td]:max-h-10 [&>td]:overflow-hidden"`, optional `"h-10"`, optional `"cursor-pointer"`) with `"h-10 [&>td]:py-0 [&>td]:overflow-hidden"` always, plus `onRowClick ? "cursor-pointer" : undefined`.
  - Drop the `compact ? "h-10" : undefined` branch (now unconditional).
- In each `<TableCell>` inside the same row:
  - Drop the `compact ? "h-10 p-0" : undefined` branch.
  - Keep the existing `tableClassName?.includes("table-fixed") ? "overflow-hidden" : undefined` branch (separate concern: column overflow for table-fixed layout).
- Remove the `compact` prop:
  - Delete `compact?: boolean;` from `DataTableProps`.
  - Delete its JSDoc line ("Compact row height (~40px)").
  - Delete `compact = false,` from the destructured signature.
- The empty-state row (`No results.`) keeps its existing `h-24` — leave untouched.

**Patterns to follow.**
- Existing className composition pattern in this file (`[...].filter(Boolean).join(" ")`).

**Test scenarios.**
- Covers visual requirement: verify in `apps/computer` dev server that `ArtifactsTable`, `CustomizeTable`, `TaskDashboard`, and `memory.kbs` tables render body rows at exactly 40px. No DOM-level unit test is needed — the change is a className substitution.
- If any existing vitest snapshot in `packages/ui` captures `<TableRow>` className strings, update the snapshot; otherwise no new tests.

**Verification.**
- `pnpm --filter @thinkwork/ui typecheck` passes.
- `pnpm --filter @thinkwork/ui test` passes (any snapshot diffs from the className change are reviewed and accepted).
- Manual: launch `apps/computer` dev server, navigate to the four affected tables, confirm row height in DevTools is 40px.

### U2. Pin row height in `apps/admin` local DataTable

**Goal.** Make `apps/admin/src/components/ui/data-table.tsx` always render body rows at 40px, matching U1's behavior.

**Requirements.** Body rows in all `apps/admin` DataTables (~44 callsites) render exactly 40px tall.

**Dependencies.** None (parallel to U1, but kept as a separate unit so the two wrappers can be reviewed independently).

**Files.**
- `apps/admin/src/components/ui/data-table.tsx` (modify)

**Approach.**
- In the `<TableRow>` body-row render:
  - Today's className is only `onRowClick ? "cursor-pointer" : undefined`. Replace with the composed array `"h-10 [&>td]:py-0 [&>td]:overflow-hidden"` plus `onRowClick ? "cursor-pointer" : undefined`, joined with `.filter(Boolean).join(" ")` so the result mirrors U1's structure.
- In each `<TableCell>`:
  - Drop the `compact ? "p-0 h-auto" : undefined` branch.
  - Keep the `tableClassName?.includes("table-fixed") ? "overflow-hidden" : undefined` branch.
- Remove the `compact` prop:
  - Delete `compact?: boolean;` from `DataTableProps`.
  - Delete its JSDoc line.
  - Delete `compact = false,` from the destructured signature.
- Empty-state row (`No results.`) keeps its `h-24`.

**Patterns to follow.**
- Match U1's className composition exactly so the two wrappers stay textually aligned (future consolidation becomes a copy-paste).

**Test scenarios.**
- Covers visual requirement: verify in `apps/admin` dev server (`pnpm --filter @thinkwork/admin dev`, port 5174) that representative tables render body rows at exactly 40px. Spot-check ones with known dense content: `routes/_authed/_tenant/agents/index.tsx`, `routes/_authed/_tenant/threads/index.tsx`, `routes/_authed/_tenant/memory/index.tsx`, `routes/_authed/_tenant/evaluations/$runId.tsx`.
- If any existing vitest in `apps/admin` snapshots row className strings, update the snapshot.

**Verification.**
- `pnpm --filter @thinkwork/admin typecheck` passes.
- `pnpm --filter @thinkwork/admin test` passes.
- Manual: launch admin dev server, visit 3–5 routes from the spot-check list, confirm row height = 40px in DevTools and rows with stacked content visibly truncate as expected.

### U3. Repo-wide lint, typecheck, and test

**Goal.** Confirm no stranded references to the removed `compact` prop and no test regressions.

**Requirements.** Pipeline-green delivery.

**Dependencies.** U1, U2.

**Files.**
- None modified directly. This unit runs verifications.

**Approach.**
- `grep -rn "compact" packages/ui/src apps/admin/src apps/computer/src --include='*.tsx' --include='*.ts'` and confirm no remaining matches reference the `DataTable` `compact` prop. (Other unrelated `compact` mentions — e.g., `RunbookQueue`'s own prop — are fine.)
- Run `pnpm -r --if-present typecheck`, `pnpm -r --if-present lint`, `pnpm -r --if-present test` from the repo root.
- Run `pnpm format:check` and `pnpm format` if needed.

**Test scenarios.**
- None new. This unit is verification only.

**Verification.**
- All three monorepo-wide commands pass.

---

# System-Wide Impact

- **Visual regression risk.** Every DataTable in both apps changes appearance. Tables relying on stacked-content cells (e.g., "name + email" patterns) will visibly truncate. This is the user's stated intent. No code changes to cell renderers are needed — the clip happens at the row level.
- **No API change for callers.** All 48 DataTable callsites continue to compile; only the (unused) `compact` prop is removed. No caller passes it, so no callsite needs updating.
- **No backend, network, or data-flow impact.**
- **Snapshot updates.** A search for `*.test.ts` / `*.test.tsx` snapshots that include DataTable row markup should be done during execution; update any that flip.

---

# Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Some cells with custom inline buttons or selects render taller than 40px and are now clipped in a way the user finds unacceptable on review | Medium | Visual spot-check during ce-test-browser. If clipping is too aggressive on specific cells, those callsites can be adjusted (compact cell content, smaller icons) without changing the wrapper. |
| A snapshot test relies on the old `compact` prop or row classNames | Low | U3 runs the full test suite; any snapshot diffs are reviewed and accepted as part of the refactor. |
| Horizontal padding feels wrong once vertical padding is removed | Low | `TableCell`'s `p-2` becomes effectively `px-2 py-0`. Horizontal spacing is unchanged. Reviewable in dev server. |

---

# Verification Plan

- Repo-wide `pnpm typecheck`, `pnpm lint`, `pnpm test` all green (U3).
- Manual visual spot-check in dev servers (U1, U2): all rows render at 40px in DevTools; rows with previously-tall content now clip; no horizontal layout regressions.
- Browser pipeline test (ce-test-browser) confirms the affected admin routes still load and render without runtime errors.
