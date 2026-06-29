---
linear: THINK-108
title: Work Item Activities
status: in-progress
started_at: 2026-06-29
target_branch: main
active_branch: codex/think-108-work-item-activity-timeline
---

# THINK-108 Autopilot Status

## Context

- Linear issue: `THINK-108`
- Linear plan document: `Plan: Improve Work Item activity timeline`
- Repo plan: `docs/plans/2026-06-29-002-feat-work-item-activity-timeline-plan.md`
- Requirements: `docs/brainstorms/2026-06-29-think-108-work-item-activities-requirements.md`
- User checkpoint: local preview on `localhost:5174` is required before pushing or opening a PR.

## Implementation Strategy

- Use the existing `work_item_events` substrate and metadata instead of adding a new event model.
- Group U1-U4 on one implementation branch because the formatter, event metadata vocabulary, backend event wording, and compact renderer are coupled for a useful local preview.
- Treat U5 as a guardrail: no GraphQL schema/codegen changes unless implementation proves the existing event fields are insufficient.

## Implementation Units

- U1. Extract Work Item activity display helpers — implemented in `apps/web/src/components/work-items/work-item-activity.ts` with focused tests.
- U2. Enrich generic Work Item update events — implemented for representative core property updates via structured `fieldChanges` metadata.
- U3. Improve status, agent, and OpenEngine event wording — implemented for GraphQL status updates and `set_work_item_status`; OpenEngine route metadata now renders as route activity.
- U4. Wire semantic icons and compact timeline rendering — implemented in `WorkItemDetailPage.tsx` with event-specific Tabler icons, actor labels, action copy, and timestamps.
- U5. Preserve GraphQL and generated type parity — no schema/codegen changes needed.

## Progress Log

- 2026-06-29: Read Linear issue, attached plan document, comments, local requirements, and repo plan.
- 2026-06-29: Created isolated implementation branch `codex/think-108-work-item-activity-timeline` from `origin/main` in the existing Codex worktree.
- 2026-06-29: Confirmed there are no known child Linear issues or blockers for `THINK-108`.
- 2026-06-29: Held push/PR work until the web app was reviewed on `localhost:5174`.
- 2026-06-29: Implemented frontend activity descriptors and semantic compact timeline icons.
- 2026-06-29: Implemented backend update/status event metadata and concise messages without GraphQL schema changes.
- 2026-06-29: Local review approved after switching Activity markers to Tabler icons only and removing custom circular glyphs.
- 2026-06-29: Verification passed:
  - `pnpm --filter @thinkwork/web exec vitest run src/components/work-items/work-item-activity.test.ts`
  - `pnpm --filter @thinkwork/api exec vitest run src/graphql/resolvers/work-items/workItems.resolver.test.ts src/lib/work-items/work-item-status-tool.test.ts`
  - `pnpm --filter @thinkwork/web typecheck`
  - `pnpm --filter @thinkwork/api typecheck`
