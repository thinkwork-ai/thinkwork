---
title: "feat: ThinkWork Computer phase four workbench"
type: feat
status: completed
date: 2026-05-07
origin: docs/brainstorms/2026-05-06-thinkwork-computer-product-reframe-requirements.md
---

# feat: ThinkWork Computer phase four workbench

## Overview

Phase 1 created the Computer domain model and migration foundation. Phase 2 made Computers visible in admin and added the ECS/EFS runtime skeleton. Phase 3 made the runtime operable: lifecycle controls, task enqueue/read contracts, first workspace writes, Google CLI smoke, and reconciliation. The post-Phase-3 repair pass proved the runtime can complete a real workspace write and added a minimal browser-triggered check.

Phase 4 should turn the Computer detail screen from status/provenance panels into an operator-usable workbench:

- The page must reliably load the migrated source Agent workspace behind the Computer.
- Operators can run explicit runtime checks from the browser, not only a hard-coded file-write probe.
- Recent runtime events are visible alongside task history, so "running" can be inspected rather than trusted.
- The workbench should make Computers feel like the primary product surface while keeping Agents as delegated/managed workers.

This phase does not implement full Google Workspace OAuth hydration, Gmail/Calendar/Docs task execution, delegated AgentCore execution, remote desktop/browser sessions, or a raw EFS file browser. It focuses on the smallest product surface that proves the live Computer is real and usable.

## Problem Frame

The current Computer page still reads too much like a migration report. It can show desired/observed status and provenance, but it does not give the operator enough confidence that a Computer is a live workplace. A Computer detail page should answer three practical questions quickly:

- Can I edit this Computer's workspace?
- Can I ask the running runtime to do something observable?
- Can I see what happened when it tried?

Phase 4 should close that gap by tightening the source workspace binding, expanding browser-triggered runtime actions, and exposing recent Computer events.

## Requirements Trace

- R1. Computers replace user-specific Agents as the primary product model.
- R3. Computers are always-on by default.
- R4. Computers own persistent user work state.
- R5. ThinkWork Computer is positioned as a governed AWS-native workplace.
- R7. After migration, Agents mean shared/delegated managed workers.
- R9. The primary nav changes to Computers.
- R14. v1 proves the Computer with personal work orchestration.
- R15. Google CLI/tooling is part of the v1 proof.
- R16. The Computer has a live filesystem workspace.
- R17. S3 remains durability and audit infrastructure, not the primary live workspace.
- R20. Per-user credentials remain user-owned.
- R21. Governance applies to Computers and Agents.

**Origin flows:** F1 User gets a Computer, F2 Existing user-specific Agents migrate into Computers, F4 Computer performs personal work orchestration.

**Origin acceptance examples:** AE1 primary Computer surface, AE2 migration continuity, AE4 Google Workspace plus live files, AE5 governed/cost-accounted runtime visibility.

## Scope Boundaries

### In scope

- Fix Computer detail GraphQL data so `sourceAgent` is selected where the UI relies on it.
- Refine the Computer detail layout into a workbench-oriented surface, with workspace first and runtime controls/activity nearby.
- Add browser-triggered task actions for `HEALTH_CHECK`, `WORKSPACE_FILE_WRITE`, and `GOOGLE_CLI_SMOKE`.
- Add recent Computer event GraphQL/API read support and an admin event panel.
- Keep task and event output summaries bounded and safe for UI display.
- Add focused API/admin tests and regenerate GraphQL clients.

### Deferred for later

- User OAuth token hydration and real Google Workspace mutations.
- Delegated AgentCore execution from Computer tasks.
- Rich remote browser/computer-use sessions inside ECS.
- Raw EFS file browser or terminal.
- Multi-Computer-per-user behavior.
- Removing all legacy Agent language from internal implementation.

## Context & Research

### Relevant code and patterns

- `docs/plans/2026-05-06-009-feat-thinkwork-computer-phase-three-runtime-activation-plan.md` is complete and provides the runtime/task spine this phase should build on.
- `packages/database-pg/graphql/types/computers.graphql` already exposes `ComputerTask` and task enqueue/read contracts, but not `ComputerEvent`.
- `packages/database-pg/src/schema/computers.ts` already has `computer_events` with `event_type`, `level`, `payload`, `task_id`, and timestamps.
- `packages/api/src/lib/computers/tasks.ts` contains task enqueue/list helpers and task input validation; event reads should follow the same tenant/computer access shape.
- `packages/api/src/graphql/resolvers/computers/computerTasks.query.ts` is the closest resolver pattern for a new `computerEvents` query.
- `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx` already renders `WorkspaceEditor`, `ComputerStatusPanel`, `ComputerLiveTasksPanel`, `ComputerRuntimePanel`, and `ComputerMigrationPanel`.
- `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerLiveTasksPanel.tsx` currently enqueues a single workspace-file-write probe. It should become a small runtime actions/activity panel without becoming a raw task composer.
- `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts` is a source-level route contract test and should be extended for the new workbench pieces.
- `apps/admin/src/components/agent-builder/WorkspaceEditor.tsx` remains the canonical workspace editing component; Phase 4 should reuse it rather than duplicate workspace editing.

### Institutional learnings

- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` applies to any new admin mutation, but this phase primarily adds reads plus existing task enqueue mutation use. Keep access checks explicit.
- `docs/solutions/best-practices/service-endpoint-vs-widening-resolvecaller-auth-2026-04-21.md` supports keeping runtime callbacks service-auth while product clients use GraphQL.
- `docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md` reinforces that the shared workspace editor should remain the live workspace editing path.

### External research decision

No new external research is required for this slice. The feature stays inside existing GraphQL, admin, and runtime-task contracts and does not introduce new AWS service semantics.

## Key Technical Decisions

- **Treat Phase 4 as workbench proof, not a desktop clone.** The goal is to make the Computer visibly useful and inspectable through real workspace edits, runtime tasks, and events.
- **Use GraphQL for product visibility.** Admin reads tasks/events and enqueues product-approved task types through GraphQL. Runtime service-auth REST remains private to ECS.
- **Expose curated task actions, not arbitrary payload entry.** Browser actions should cover health, workspace marker write, and Google CLI smoke. A raw JSON task composer can come later when permissions and audit UX are stronger.
- **Keep events read-only in admin.** Events are runtime/audit output; admin should inspect them, not author them.
- **Preserve Agent implementation links where needed.** The Computer can still use the source Agent workspace editor, but the visible product framing should say "Computer workspace" rather than implying the Agent is the primary object.

## Implementation Units

- U1. **Repair Computer detail source workspace binding**

**Goal:** Ensure the Computer detail query fetches the `sourceAgent` fields used by the workspace editor.

**Requirements:** R1, R4, R6, R16; F2; AE2.

**Files:**

- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Modify: `apps/admin/src/gql/graphql.ts`
- Modify: `apps/admin/src/gql/gql.ts`
- Test: `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`

**Approach:**

- Add `sourceAgent { id name slug }` to `ComputerDetailQuery`.
- Regenerate admin GraphQL codegen.
- Extend the Computer route test to assert the detail query includes `sourceAgent`.

**Test scenarios:**

- Computer detail source confirms the route renders `WorkspaceEditor`.
- GraphQL query source includes `sourceAgent` for the detail route.
- Admin build/typecheck sees `computer.sourceAgent` as typed data.

- U2. **Upgrade browser-triggered runtime actions**

**Goal:** Let an operator run the three safe Phase-3 task types from the Computer page and see clear, bounded status.

**Requirements:** R3, R4, R14, R15, R16, R20, R21; F4; AE4, AE5.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerLiveTasksPanel.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`

**Approach:**

- Replace the single `Check Runtime` action with compact icon+text buttons for health check, workspace marker write, and Google CLI smoke.
- Keep the workspace marker write TTL metadata from the post-Phase-3 repair pass.
- Use idempotency keys that include Computer id, task type, and timestamp.
- Keep output summaries small and useful: path/marker path, message, CLI availability, or a generic "Output recorded".
- Refresh task state immediately after enqueue and continue polling while tasks are pending/running.

**Test scenarios:**

- Source-level route test confirms health, workspace, and Google CLI actions are present.
- The workspace marker action still writes under `.thinkwork/runtime-checks/`.
- No task action accepts or displays OAuth token material.

- U3. **Expose Computer runtime events**

**Goal:** Make runtime/event activity visible in the product UI, not only task rows.

**Requirements:** R5, R12, R21; F4; AE5.

**Files:**

- Modify: `packages/database-pg/graphql/types/computers.graphql`
- Create: `packages/api/src/lib/computers/events.ts`
- Create: `packages/api/src/graphql/resolvers/computers/computerEvents.query.ts`
- Modify: `packages/api/src/graphql/resolvers/computers/index.ts`
- Test: `packages/api/src/lib/computers/events.test.ts`
- Test: `packages/api/src/graphql/resolvers/computers/computerEvents.query.test.ts`
- Modify: `apps/admin/src/lib/graphql-queries.ts`
- Modify: `apps/admin/src/gql/graphql.ts`
- Modify: `apps/admin/src/gql/gql.ts`
- Create: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerEventsPanel.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`

**Approach:**

- Add `ComputerEvent` and `computerEvents(computerId: ID!, limit: Int): [ComputerEvent!]!` to GraphQL.
- Use `requireComputerReadAccess` before reading events.
- Return recent events ordered newest-first with a bounded default/max limit.
- Add an admin panel that displays event type, level, task id when present, relative timestamp, and compact payload summary.
- Refresh events alongside tasks when task activity changes.

**Test scenarios:**

- Happy path: authorized caller lists events for a Computer.
- Error path: missing Computer returns `NOT_FOUND`.
- Error path: caller without read access is rejected through existing shared access helper.
- Limit handling: null/default and oversized limits are bounded.
- UI route test confirms `ComputerEventsPanel` is rendered and the query is defined.

- U4. **Tune Computer detail workbench layout and copy**

**Goal:** Make the page feel like the Computer product surface instead of a migration report.

**Requirements:** R1, R5, R7, R9, R16, R21; F1; AE1, AE5.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/computers/$computerId.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerRuntimePanel.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/computers/-components/ComputerMigrationPanel.tsx`
- Test: `apps/admin/src/routes/_authed/_tenant/computers/-computers-route.test.ts`

**Approach:**

- Keep workspace first and call it the Computer workspace.
- Place status/actions/events near the top so the operator can act and inspect in one scan.
- Demote migration provenance below live runtime information.
- Keep legacy Agent references explicit but secondary: "Source Agent workspace" only where technically necessary.

**Test scenarios:**

- Route source places `WorkspaceEditor`, `ComputerStatusPanel`, `ComputerLiveTasksPanel`, `ComputerEventsPanel`, and runtime/migration panels in the intended order.
- Empty source workspace state remains understandable for non-migrated Computers.

## Verification Plan

- `pnpm schema:build`
- `pnpm --filter @thinkwork/admin codegen`
- `pnpm --filter @thinkwork/api test -- computers`
- `pnpm --filter @thinkwork/admin test -- src/routes/_authed/_tenant/computers/-computers-route.test.ts`
- `pnpm --filter @thinkwork/admin build`
- Browser pipeline check against the admin Computer route after implementation.

## Rollout Notes

- This phase is backward-compatible for existing Computers because it adds read queries and UI affordances around existing `computer_events` and `computer_tasks`.
- No new database migration is required; the event table already exists.
- If deployed runtime events are sparse, the panel should show an honest empty state rather than inventing health.
