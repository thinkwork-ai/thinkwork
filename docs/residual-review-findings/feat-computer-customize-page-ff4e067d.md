---
branch: feat/computer-customize-page
head_sha: ff4e067d
review_run_id: 20260509-105424-81e8bc12
review_artifact: /tmp/compound-engineering/ce-code-review/20260509-105424-81e8bc12/
generated_at: 2026-05-09
---

# Residual Review Findings — feat/computer-customize-page

ce-code-review (autofix mode) produced these residual `downstream-resolver` findings. No tracker sink was available at the time of review; this file is the durable record. When the PR for this branch is opened, these findings should be migrated into the PR body and this file can be removed.

## Source

- Plan: `docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md`
- Brainstorm: `docs/brainstorms/2026-05-09-computer-customization-page-requirements.md`
- Reviewers: ce-correctness-reviewer, ce-testing-reviewer, ce-maintainability-reviewer, ce-project-standards-reviewer, ce-data-migrations-reviewer, ce-kieran-typescript-reviewer, ce-schema-drift-detector
- 0 P0/P1-blocking issues; 3 safe_auto fixes applied this run; verdict: Ready with fixes

## Residual Actionable Work

### P1 — High

- **#1 [P1][manual]** `packages/database-pg/__tests__/schema-computers.test.ts` — schema-computers.test.ts not extended for new `primary_agent_id` column.
  - **Suggested fix:** Extend the existing schema-parity test (or add one if absent) to assert the `primary_agent_id` column type, nullability, FK target, and `idx_computers_primary_agent` presence. Reviewer: testing.

- **#2 [P1][manual]** `packages/database-pg/src/schema/tenant-customize-catalog.ts` — no schema-parity test for `tenant_connector_catalog` / `tenant_workflow_catalog`.
  - **Suggested fix:** Add schema-parity tests covering `uq_tenant_*_catalog_slug` uniqueness, status enum CHECK, and kind enum CHECK on connector_catalog. Mirror the existing per-table schema test pattern in `packages/database-pg/__tests__`. Reviewer: testing.

### P2 — Moderate

- **#3 [P2][gated_auto]** `apps/computer/src/lib/computer-routes.ts:13` — per-tab Customize route constants and `currentCustomizeTab()` have zero production callers.
  - **Suggested fix:** Either wire `customize.tsx` to import `CUSTOMIZE_TABS` instead of redeclaring `TAB_VALUES` inline (resolves #4 simultaneously), or defer the constants to U7 with their consumers. Reviewers: maintainability, kieran-typescript.

- **#4 [P2][gated_auto]** `apps/computer/src/routes/_authed/_shell/customize.tsx:7` — duplicate `CustomizeTabValue` type with conflicting semantics (path vs segment).
  - **Suggested fix:** Rename the path-valued `CustomizeTabValue` in `computer-routes.ts` to `CustomizeTabPath` (or rename the segment-valued one to `CustomizeTabSegment`) so the two vocabularies don't collide when U7 wires nested file routes. Reviewer: kieran-typescript.

- **#5 [P2][manual]** `apps/computer/src/components/customize/CustomizeTabBody.test.tsx` — tests skip the category-dropdown interaction.
  - **Suggested fix:** Add a test that opens the category Select, picks a value, and asserts the grid filters to that category. Discover-chip and discover-empty cases were added in the autofix pass; category dropdown remains. Reviewer: testing.

### P3 — Low

- **#11 [P3][manual]** `apps/computer/src/test/visual/` — no visual contract test for the Customize shell.
  - **Suggested fix:** Add `apps/computer/src/test/visual/customize-shell.test.tsx` mirroring `app-artifact-shell.test.tsx`: render the page, assert the three pill triggers exist, default tab is `connectors`. Reviewer: testing.

- **#12 [P3][manual]** `apps/computer/src/components/customize/customize-filtering.test.ts` — does not exercise combined chip+search+category.
  - **Suggested fix:** Add one test that combines `chip='available'` + `search='git'` + `category='Engineering'` and asserts only the GitHub item survives. Reviewer: testing.

## Advisory (no action recommended in v1)

- **#6 [P3]** Drizzle schema declares non-partial index but SQL migration creates partial index — intentional per CLAUDE.md hand-rolled-SQL convention.
- **#7 [P3]** `ALL_CATEGORIES` sentinel `'__all__'` could collide with a real category — theoretical risk only.
- **#8 [P3]** Filter state resets when switching Customize tabs — acceptable in v1 inert page.
- **#9 [P3]** Three near-identical empty-state strings in `customize.tsx` TabsContent slots — intentional parallelism for U4-U6 seam-swap.
- **#10 [P3]** Optional `onAction` prop in `CustomizeTabBody` silently swallows clicks — intentional in v1 inert page; make required when U4-U6 wire mutations.

## Applied autofix (this run)

- `auto-1` Use `COMPUTER_CUSTOMIZE_ROUTE` constant in `ComputerSidebar.tsx`
- `auto-2` Add CustomizeCard tests for `iconUrl` and `iconFallback`
- `auto-3` Add CustomizeTabBody tests for the Discover chip and Discover-empty fallback
