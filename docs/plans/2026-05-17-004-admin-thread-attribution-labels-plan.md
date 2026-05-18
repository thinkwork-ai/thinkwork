---
title: "Admin Thread Computer and User Attribution Labels"
date: 2026-05-17
status: active
origin: "User request in Codex thread, 2026-05-17"
---

# Admin Thread Computer and User Attribution Labels

## Problem Frame

Shared Computers changed the meaning of a thread from "owned by one personal computer" to "requested by a user and handled by a shared Computer." The admin Threads list and Thread Detail page still render the legacy `Computer-owned` label and generic timeline actors (`User`, `Computer`). Operators need to see who made the request and which Computer handled it without opening secondary screens.

## Requirements Trace

- Replace `Computer-owned` on the Threads page with the actual Computer name and User name.
- Replace `Computer-owned` in Thread Detail properties with the actual Computer name and add the request User name.
- Replace generic timeline actor labels with the request User name for user messages and the called Computer name for assistant/computer messages.
- Preserve existing non-computer agent thread behavior, including the assignee picker.
- Do not change the thread assignment, access-control, or execution model.

## Existing Patterns

- `packages/database-pg/graphql/types/threads.graphql` already stores `Thread.computerId` and `Thread.userId`.
- `packages/api/src/graphql/resolvers/threads/types.ts` already resolves related `agent`, `assignee`, and `reporter` fields from thread IDs.
- `apps/admin/src/lib/graphql-queries.ts` is the admin query source; schema edits require codegen refresh.
- `apps/admin/src/components/threads/ThreadsTable.tsx` is the shared table for `/threads` and Computer Detail.
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` owns the full Thread Detail page, properties panel, and `ExecutionTrace` labels.
- `docs/solutions/conventions/admin-trim-ui-preserve-backend-mutations-2026-05-13.md` warns to keep backend behavior intact while changing admin presentation.

## Scope

In scope:

- Add first-class GraphQL relationships from `Thread` to `Computer` and request `User`.
- Fetch those relationships in admin thread list/detail queries.
- Render attribution labels in list, detail properties, detail timeline, and the lightweight thread detail sheet.
- Update targeted tests and generated GraphQL types.

Out of scope:

- Changing who can access a thread.
- Reworking computer assignment rules.
- Replacing the assignee picker for non-computer threads.
- Renaming stored channels, statuses, or historical thread data.

## Implementation Units

### Unit 1: Thread Attribution GraphQL Fields

Files:

- `packages/database-pg/graphql/types/threads.graphql`
- `packages/api/src/graphql/resolvers/threads/types.ts`

Plan:

- Add nullable `computer: Computer` and `user: User` fields to `Thread`.
- Resolve `Thread.computer` from `computerId`/`computer_id` using the existing `computers` table and `computerToCamel`.
- Resolve `Thread.user` from `userId`/`user_id` using the existing user loader where possible.
- Preserve existing `agent`, `assignee`, `reporter`, and message behavior.

Tests:

- Add or update a resolver-level test that proves `Thread.computer` and `Thread.user` return related entities when IDs are present and `null` when absent.

### Unit 2: Admin Query and Type Refresh

Files:

- `apps/admin/src/lib/graphql-queries.ts`
- Generated GraphQL outputs for consumers with codegen scripts.

Plan:

- Select `computer { id name slug }` and `user { id name email image }` in thread list and detail queries used by admin.
- Run codegen for GraphQL consumers after the schema/query change.

Tests:

- Run the smallest relevant codegen/typecheck target for admin, then broaden if schema generation requires it.

### Unit 3: Admin List and Detail Rendering

Files:

- `apps/admin/src/components/threads/ThreadsTable.tsx`
- `apps/admin/src/components/threads/ThreadDetailSheet.tsx`
- `apps/admin/src/components/threads/ExecutionTrace.tsx`
- `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`
- `apps/admin/src/routes/_authed/_tenant/dashboard.tsx` if it still renders the legacy label from the same data.

Plan:

- Add small local display helpers for thread user/computer labels with conservative fallbacks.
- In `ThreadsTable`, replace the static computer chip with a compact attribution cell that shows Computer name and User name.
- In Thread Detail properties, render separate `Computer` and `User` rows for computer-backed threads.
- Pass request User and Computer labels into `ExecutionTrace` and use them for message rows.
- Keep non-computer threads on existing agent/assignee paths.

Tests:

- Update source-grep admin tests that pin the table behavior.
- Add focused coverage for the new label helpers if a helper is extracted.

### Unit 4: Verification and PR

Files:

- `docs/plans/2026-05-17-004-admin-thread-attribution-labels-plan.md`

Plan:

- Run targeted package tests first.
- Run relevant typecheck/codegen verification after generated files change.
- Start admin dev server from the worktree with copied env and inspect `/threads` and a thread detail route in browser when feasible.
- Run the LFG review and browser-test steps before committing.

Tests:

- API resolver test for thread attribution fields.
- Admin component/source tests for table/detail labels.
- Admin typecheck or equivalent generated-type verification.
- Browser check for visible thread attribution labels on list/detail screens.

## Risks

- Generated GraphQL type changes may touch multiple workspaces; keep edits scoped to schema/query fallout.
- Existing historical threads may have `null userId`; UI must render a graceful fallback instead of hiding the Computer name.
- Field resolvers can introduce list N+1 queries. This mirrors existing `Thread.agent` behavior and is acceptable for the current paginated admin surface; if it becomes hot, batch through a computer loader in a later optimization.
