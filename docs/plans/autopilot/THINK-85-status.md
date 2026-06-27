---
issue: THINK-85
unit: "Unit 1 - Labels and Space Operating Model"
status: verified
branch: codex/think-85-openengine-labels
worktree: /Users/ericodom/Projects/thinkwork/.Codex/worktrees/think-85-openengine-labels
updated: 2026-06-27
---

# THINK-85 Autopilot Status

## Objective

Implement the first OpenEngine-native Work Items slice: tenant-scoped labels,
Space-as-project operating model support, and enough UI/API surface to start
using Work Items as a dogfood queue without depending on Linear labels.

## Included

- Work Item label vocabulary and label assignment persistence.
- GraphQL APIs to list/create/update labels.
- `labelIds` / `labelSlugs` support on Work Item create/update/filter paths.
- Work Item `labels` field resolution.
- Web Work Items create, detail, card, row, and table filter label support.
- Focused schema/API/web tests for the label surface.

## Excluded

- OpenEngine authoring fields.
- Work Item documents and S3-backed document storage.
- ThinkWork MCP tools.
- Runner execution, routing, claim semantics, and agent receipts.
- Linear import/cutover tooling.
- Dogfood verification beyond Unit 1 local checks.

## Verification

- `pnpm --filter @thinkwork/database-pg test -- __tests__/work-items-schema.test.ts`
- `pnpm --filter @thinkwork/api test -- src/graphql/resolvers/work-items/workItems.resolver.test.ts`
- `pnpm --filter @thinkwork/web test -- src/lib/graphql-queries.test.ts src/lib/graphql-queries.schema.test.ts src/components/work-items/work-item-table-filter.test.ts src/components/work-items/work-item-display.test.ts`
- `pnpm --filter @thinkwork/api typecheck`
- `pnpm --filter @thinkwork/web typecheck`
- `pnpm --filter @thinkwork/database-pg build`

## Notes

- Web codegen was regenerated because the Work Items web documents now select
  labels.
- CLI/mobile codegen was attempted, but the current generator rewrote quote and
  formatting style across large generated files without behavioral need for this
  unit. Those generated churn changes were intentionally not kept in this PR.
