---
title: "feat: Shared Computer user-thread ownership and E2E coverage"
type: feat
status: active
date: 2026-05-17
origin: docs/brainstorms/2026-05-17-shared-computers-product-reframe-requirements.md
extends: docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md
---

# feat: Shared Computer user-thread ownership and E2E coverage

## Overview

Complete the shared Computer reframe by making requester thread ownership explicit and testable. Every user-originated Thread created against a shared Computer must persist `threads.user_id` as the invoking user, use that same identity in the Computer task/requester envelope, and let end-user surfaces list only that user's Threads even when several users share the same Computer.

The existing shared Computer migration and assignment work gives multiple users access to one shared Computer. This plan closes the remaining identity gap: the shared Computer is the capability, while `threads.user_id` is the requester display/memory boundary.

---

## Problem Frame

The current shared Computer model correctly allows a shared, ownerless Computer such as `Base Computer`. But requester-owned Thread behavior is only partially enforced. `threads.user_id` exists and some helpers set it, yet `createThread` still falls back to `threadComputer.owner_user_id` for non-user-created shared Computer Threads, and user-facing Thread list queries filter by `computerId` rather than always narrowing to the requester. With a shared Computer assigned to many users, that can cause two classes of bugs:

- Thread display can leak or blend many users' work under one shared Computer.
- Runtime memory/context injection can lose the exact requester boundary needed by Hindsight and delegated AgentCore agents.

The product invariant should be simple: a shared Computer can serve many users, but every user-originated Thread belongs to exactly one requester user and the runtime carries that requester through the task envelope.

---

## Requirements Trace

- R1. User-originated shared Computer Threads persist `threads.user_id` as the invoking `users.id`.
- R2. User-originated Thread creation fails closed when no requester user can be resolved.
- R3. End-user Thread list queries in apps/computer return only Threads for the calling user, even when filtered by a shared `computerId`.
- R4. Admin/operator Thread queries keep tenant/computer visibility for governance and debugging.
- R5. Computer task envelopes, runtime context, assistant message metadata, and event payloads all preserve the same requester user id.
- R6. Requester user id is the memory and credential subject for user-originated shared Computer work unless a future connector policy explicitly supplies a different credential subject.
- R7. Multiple assigned users can create Threads on the same shared Computer without seeing each other's Threads in end-user surfaces.
- R8. E2E smoke coverage can exercise at least two different end users against one shared Computer and verify both persistence and display scoping.

**Origin actors:** A1 end user, A3 shared Computer, A4 requester context layer, A6 planner/implementer
**Origin flows:** F1 assigned shared Computer request, F4 personal context overlay
**Origin acceptance examples:** AE1 assigned chooser, AE2 no-assignment fail-closed, AE4 personal memory isolation

---

## Scope Boundaries

- This plan does not reintroduce personal Computers.
- This plan does not add automatic Computer routing.
- This plan does not migrate historical archived personal Computer Threads beyond preserving their existing `user_id` where present.
- This plan does not implement full Slack invocation UX; it preserves the same requester/thread identity contract Slack will use later.
- This plan does not change tenant-admin governance visibility in apps/admin.

### Deferred to Follow-Up Work

- Updating the legacy streaming smoke to match the current durable-message Computer-native contract.
- Slack-specific multi-user requester attribution UI.
- Tenant-owned/shared connector credential subjects.

---

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/src/schema/threads.ts` already defines nullable `threads.user_id` with an index on `(tenant_id, user_id)`.
- `packages/database-pg/src/lib/thread-helpers.ts` sets `user_id` when `ensureThreadForWork` receives `userId`.
- `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` writes `user_id` from `createdById` for user-created Threads but otherwise falls back to `threadComputer.owner_user_id`, which is null for shared Computers.
- `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts` resolves the sender from auth and validates shared Computer assignment before queueing a task.
- `packages/api/src/lib/computers/thread-cutover.ts` validates requester access and writes `created_by_user_id` on `computer_tasks` from task input.
- `packages/api/src/lib/computers/runtime-api.ts` assembles requester context from `payload.requesterUserId ?? task.created_by_user_id`.
- `apps/computer/src/lib/graphql-queries.ts` lists Threads by `tenantId` and `computerId`, which is not enough after shared Computers.
- `packages/api/src/graphql/resolvers/threads/threads.query.ts` and `threadsPaged.query.ts` are the main places to distinguish end-user scoped reads from admin/operator reads.

### Institutional Learnings

- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`: never resolve user identity by tenant-only fallback in multi-user tenants; explicit user predicates and fail-closed behavior are required.
- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`: schema migrations need correct marker kinds if this work adds constraints or indexes.
- `docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md`: requester identity and shared Computer identity are distinct; user memory is a request overlay, not shared Computer state.

### External References

- None. This is a repo-local correctness and coverage follow-up with clear existing patterns.

---

## Key Technical Decisions

- **Use `threads.user_id` as the end-user display and memory boundary:** `computer_id` answers which shared capability acted; `user_id` answers whose work and personal context the Thread belongs to.
- **Fail closed for user-originated work without a requester:** Cognito app requests should resolve the caller via `resolveCallerFromAuth`; if no user id is available, do not create a shared Computer Thread.
- **Keep admin visibility broad:** Admin Computer detail and tenant Threads views may query all tenant/computer Threads; apps/computer and mobile user surfaces should filter by caller/requester.
- **Do not infer requester from shared Computer owner:** Shared Computers are ownerless by design. Any fallback to `owner_user_id` is only valid for historical personal compatibility and must not power new shared requests.
- **Make multi-user tests prove isolation:** At least two users assigned to one shared Computer should create/list Threads independently in tests and smoke scripts.

---

## Open Questions

### Resolved During Planning

- **Should `threads.user_id` be required for all Threads?** No. System, admin, migration, and connector/service Threads may remain nullable. User-originated shared Computer Threads must set it.
- **Should admin lists filter by `user_id`?** No. Admin/operator governance remains tenant/computer scoped.
- **Should `created_by_id` replace `user_id`?** No. `created_by_id` is flexible text for actor attribution; `user_id` is the typed FK used for display, memory, and query scoping.

### Deferred to Implementation

- Whether to add a resolver-level optional `userId` argument or rely entirely on auth-derived scoping for apps/computer. The implementation should prefer auth-derived scoping for end-user calls and avoid letting clients spoof another user's id.
- Whether local tests need small resolver test seams or can reuse existing mocked Drizzle chains.

---

## Implementation Units

- U1. **Thread creation requester invariant**

**Goal:** Ensure user-created shared Computer Threads always persist the invoking user's `users.id` in `threads.user_id` and propagate that id into the Computer task envelope.

**Requirements:** R1, R2, R5, R6

**Dependencies:** None

**Files:**

- Modify: `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`
- Modify: `packages/api/src/lib/computers/thread-cutover.ts`
- Test: `packages/api/src/graphql/resolvers/threads/createThread.shared-computer-user.test.ts`
- Test: `packages/api/src/graphql/resolvers/messages/sendMessage.shared-computer-user.test.ts`
- Test: `packages/api/src/lib/computers/thread-cutover.test.ts`

**Approach:**

- Resolve the authenticated caller once for `createdByType: "user"` and require a `userId`.
- Set `threads.user_id` from the resolved requester for user-created Threads, including atomic `firstMessage` creation.
- Remove shared Computer owner fallback from the user-created path.
- Ensure `enqueueComputerThreadTurn` receives `actorType: "user"` and `actorId` equal to the same requester for both atomic create-with-message and follow-up send paths.

**Execution note:** Test-first around the shared ownerless Computer case that previously could produce null `threads.user_id`.

**Patterns to follow:**

- `packages/api/src/graphql/resolvers/core/resolve-auth-user.ts`
- `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`

**Test scenarios:**

- Happy path: User A creates a `firstMessage` Thread on shared `Base Computer`; inserted Thread has `computer_id = Base`, `user_id = User A`, `created_by_id = User A`, and task requester is User A.
- Happy path: User B creates a Thread on the same Computer; inserted Thread has `user_id = User B` and task requester is User B.
- Error path: Cognito user-created Thread with no resolved user id fails before insert.
- Error path: User A cannot create/send to a shared Computer they are not assigned to.
- Compatibility path: service/system-created Thread may omit `user_id` when no requester exists.

**Verification:**

- Focused resolver and thread-cutover tests pass.

---

- U2. **End-user Thread listing scoped by requester**

**Goal:** Ensure apps/computer only displays the calling user's Threads, even when many users share the same Computer.

**Requirements:** R3, R4, R7

**Dependencies:** U1

**Files:**

- Modify: `packages/database-pg/graphql/types/threads.graphql`
- Modify: `packages/api/src/graphql/resolvers/threads/threads.query.ts`
- Modify: `packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts`
- Modify: `apps/computer/src/lib/graphql-queries.ts`
- Test: `packages/api/src/graphql/resolvers/threads/threads.query.shared-computer-user.test.ts`
- Test: `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts`
- Test: `apps/computer/src/routes/_authed/_shell/threads.index.test.tsx`

**Approach:**

- For Cognito end-user calls, resolve the caller's `users.id` and add `threads.user_id = callerUserId` to apps/computer-compatible list queries.
- Preserve apikey and admin/operator broad reads where existing admin surfaces require them.
- If a GraphQL argument is added for requester scope, treat it as a narrowing hint only after verifying it matches the caller; do not allow spoofed user ids.
- Update Computer app queries/tests so they rely on user-scoped Thread list behavior.

**Patterns to follow:**

- Existing tenant gate in `packages/api/src/graphql/resolvers/threads/threads.query.ts`
- Existing Computer read access helper in `packages/api/src/graphql/resolvers/computers/shared.ts`

**Test scenarios:**

- Happy path: User A listing `threads(tenantId, computerId)` receives only User A Threads for the shared Computer.
- Happy path: User B listing the same shared Computer receives only User B Threads.
- Admin path: tenant admin list can still see multiple users' Threads for one shared Computer in admin context.
- Error path: Cognito caller with unresolved user id receives an empty list or authz failure, not cross-user data.
- Edge case: apikey/service calls preserve service-to-service tenant/computer reads.

**Verification:**

- GraphQL API tests and Computer app route tests pass.

---

- U3. **Requester context and memory contract coverage**

**Goal:** Prove that runtime context assembly receives the same requester user id used by the Thread and task, so delegated Computer/AgentCore work can inject the correct user's memory bank.

**Requirements:** R5, R6, R8

**Dependencies:** U1

**Files:**

- Modify: `packages/api/src/lib/computers/runtime-api.ts`
- Modify: `packages/computer-runtime/src/task-loop.ts`
- Test: `packages/api/src/lib/computers/runtime-api.test.ts`
- Test: `packages/computer-runtime/src/task-loop.test.ts`
- Test: `packages/api/src/handlers/mcp-context-engine.requester-context.test.ts`

**Approach:**

- Add or strengthen tests that assert `loadThreadTurnContext` uses the task requester id and passes it into requester context assembly.
- Ensure assistant message metadata includes the requester id for audit/display.
- Ensure Computer runtime task-loop forwards `requesterUserId` into thread response/event calls consistently.

**Patterns to follow:**

- Existing requester context tests in `packages/api/src/handlers/mcp-context-engine.requester-context.test.ts`
- Existing `taskRequesterUserId` helper in `packages/computer-runtime/src/task-loop.ts`

**Test scenarios:**

- Happy path: Runtime context for User A includes User A as requester and memory subject.
- Happy path: Runtime context for User B on the same Computer includes User B as requester and memory subject.
- Error path: missing requester for user-originated task produces `contextClass: system` only for non-user/system tasks, not normal chat.
- Audit path: assistant message metadata records requester id and source message id.

**Verification:**

- Runtime API and Computer runtime tests pass.

---

- U4. **Multi-user shared Computer E2E smoke**

**Goal:** Add a deployed smoke that exercises two distinct end users assigned to one shared Computer and verifies creation, task completion, list isolation, and requester context persistence.

**Requirements:** R7, R8

**Dependencies:** U1, U2, U3

**Files:**

- Modify: `scripts/post-deploy-smoke-computer-thread-streaming.sh`
- Create: `scripts/smoke/computer-shared-multi-user-smoke.mjs`
- Test: `scripts/smoke/computer-shared-multi-user-smoke.test.mjs`
- Modify: `apps/computer/README.md`

**Approach:**

- Select one active shared Computer and at least two directly assigned users in the same tenant.
- For each user, create a Thread with a deterministic prompt through the deployed GraphQL API.
- Wait for completed Computer tasks and persisted assistant messages.
- Query Threads as each user and assert each user sees their own Thread and not the other user's Thread.
- Assert `threads.user_id`, `computer_tasks.created_by_user_id`, task input requester, and assistant metadata agree.
- Keep this smoke tolerant of the current durable-message contract rather than requiring token chunk events.

**Patterns to follow:**

- `scripts/smoke/computer-thread-streaming-smoke.mjs`
- `scripts/post-deploy-smoke-computer-thread-streaming.sh`

**Test scenarios:**

- Integration: User A and User B both create successful Threads on the same shared Computer.
- Integration: User A list excludes User B Thread; User B list excludes User A Thread.
- Integration: DB assertions confirm both Threads share `computer_id` but have different `user_id`.
- Error path: if fewer than two assigned users exist, smoke exits with a clear setup failure.

**Verification:**

- Local script unit test passes.
- Deployed dev smoke can run after merge using normal deploy pipeline credentials.

---

## System-Wide Impact

- **Interaction graph:** User app and mobile create/read Threads through GraphQL; API enqueues Computer tasks; runtime loads requester context; AgentCore/Hindsight memory wrappers use requester identity.
- **Error propagation:** Missing requester identity in user-originated paths should fail before thread/task writes. Unassigned shared Computer access should remain an authorization error.
- **State lifecycle risks:** Partial writes are highest in create-with-first-message flows; keep thread insert, first message insert, and requester fields in one transaction.
- **API surface parity:** apps/computer, mobile, CLI, and admin GraphQL consumers may all use Thread queries; scope changes must preserve admin/service behavior while tightening end-user behavior.
- **Integration coverage:** Unit tests alone do not prove multi-user tenant isolation. U4 adds deployed smoke coverage across GraphQL, DB, runtime queue, and Computer response persistence.
- **Unchanged invariants:** Shared Computers remain ownerless; assignments remain the access primitive; admin operators retain tenant-level governance visibility.

---

## Risks & Dependencies

| Risk                                              | Mitigation                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Tightening Thread list scoping breaks admin views | Distinguish Cognito end-user callers from admin/operator contexts and preserve admin `threadsPaged` behavior where required. |
| Existing historical Threads have null `user_id`   | Keep `user_id` nullable and only require it for new user-originated shared Computer work.                                    |
| User id spoofing through GraphQL args             | Prefer auth-derived requester id; any explicit user filter must be validated against the caller.                             |
| Smoke depends on deployed data shape              | Fail clearly when fewer than two assigned users exist; allow explicit env overrides for tenant/computer/users.               |
| Runtime context still uses stale owner fallback   | Add focused tests around ownerless shared Computer with two requester ids.                                                   |

---

## Documentation / Operational Notes

- Update `apps/computer/README.md` with the new multi-user shared Computer smoke.
- If this work adds schema constraints or migration SQL, follow manual migration marker guidance from `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.
- Post-merge deploy verification should run the new multi-user smoke against `dev`.

---

## Sources & References

- Origin document: `docs/brainstorms/2026-05-17-shared-computers-product-reframe-requirements.md`
- Prior plan: `docs/plans/2026-05-17-001-feat-shared-computers-reframe-plan.md`
- Related learning: `docs/solutions/logic-errors/oauth-authorize-wrong-user-id-binding-2026-04-21.md`
- Related learning: `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
- Related code: `packages/database-pg/src/schema/threads.ts`
- Related code: `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts`
- Related code: `packages/api/src/graphql/resolvers/threads/threads.query.ts`
- Related code: `packages/api/src/lib/computers/runtime-api.ts`
