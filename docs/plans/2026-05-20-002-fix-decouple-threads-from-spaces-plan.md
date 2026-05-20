---
date: 2026-05-20
type: fix
status: superseded
depth: standard
superseded_by: docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md
---

# fix: Decouple threads / messages / linked_tasks from spaces and remove user app dropdown

> Superseded by `docs/plans/2026-05-20-003-spaces-as-agent-contextual-workrooms-template-removal-plan.md`. This plan remains useful as an inventory of thread-side coupling, but it should not be implemented literally under the new product direction: Spaces intentionally remain in the end-user app as contextual workrooms. Use it only to understand what coupling was considered, not as an implementation backlog.

## Summary

The `spaces.*` schema is being rearchitected in a parallel workstream. Before that lands, the _thread-side_ coupling to spaces — `threads.space_id`, `thread_participants.space_id`, `linked_tasks.space_id`, `linked_task_events.space_id`, `linked_tasks.checklist_item_id`, plus the `Thread.spaceId` / `Thread.space` GraphQL fields and the API code that reads/writes them — needs to go. Threads become tenant-scoped only. The user app's chat sidebar dropdown that switches between spaces also goes; it has no destination once threads no longer live inside spaces.

`spaces.*` tables themselves, all spaces.\* resolvers, the persistent "Spaces" left-rail nav item in `apps/computer/src/components/ComputerSidebar.tsx`, the `/spaces` and `/spaces/$spaceId` routes (already a redirect to `/new`), and the entire `apps/computer/src/components/spaces/` directory stay untouched. Mobile and CLI receive a pure codegen regen.

---

## Problem Frame

Threads were modeled as living _inside_ a Space — a NOT NULL `space_id` FK enforced by a Postgres trigger function (`enforce_thread_space_tenant`) plus a `threads_space_id_required` CHECK constraint. Every thread-create site (the `ensureThreadForWork` helper in `packages/database-pg/src/lib/thread-helpers.ts` plus two direct INSERT sites) had to look up or auto-provision a "general" space first. The chat sidebar shipped a `<Select>` so users could switch which space they were viewing threads in. Linked tasks mirrored the same `space_id` and additionally FK'd `space_checklist_items`.

This shape no longer matches the product intent: spaces are being rearchitected as a workspace-membership concept that does not own threads. The mismatch leaks into every thread create/list/mention path, and the dropdown affordance has no behavior worth preserving — threads belong to a tenant, not to a room.

This plan is purely subtractive on the thread side. It does not invent a replacement organizing concept; that is the parallel rearchitecture's job.

---

## Requirements

- R1. After this plan, no row in `threads`, `thread_participants`, `linked_tasks`, or `linked_task_events` carries a `space_id` column.
- R2. After this plan, `linked_tasks.checklist_item_id` (FK → `space_checklist_items`) is gone.
- R3. The GraphQL `Thread` type no longer exposes `spaceId` or `space`. The `ThreadParticipant`, `LinkedTask`, and `LinkedTaskEvent` types no longer expose `spaceId`. `CreateThreadInput.spaceId` and the `threadsPaged(spaceId: ID)` argument no longer exist.
- R4. The user app (`apps/computer`) no longer renders the spaces dropdown selector in the chat sidebar, and no longer issues `SpacesQuery` from the sidebar.
- R5. Thread creation across every entry point (GraphQL mutation, `ensureThreadForWork`, direct INSERT sites in `brain/draft-review-writeback.ts` + `slack/thread-mapping.ts`) succeeds without supplying or resolving a `space_id`.
- R6. The Strands agent-wakeup payload no longer carries `space_id`. (Runtime already ignores it — verified safe to remove.)
- R7. `apps/admin`, `apps/mobile`, and `apps/cli` continue to build after the canonical GraphQL types change — admin needs a one-touch edit to `apps/admin/src/lib/graphql-queries.ts`; mobile and CLI need only a codegen rerun.
- R8. Migration drift gate (`.github/workflows/migration-precheck.yml`) and the deploy-time `pnpm db:migrate-manual` check both pass: every dropped object is declared in the new migration's `-- drops*:` headers and absent from the dev database before merge.

**Out of scope (explicit):**

- The `spaces.*` tables (`spaces`, `space_members`, `space_agent_assignments`, `space_checklist_templates`, `space_checklist_items`, `space_integrations`)
- All resolvers under `packages/api/src/graphql/resolvers/spaces/`
- The `hasSpaceMemberAccess` helper itself (3 spaces-resolver callers remain; only the 2 thread-side callers stop using it)
- The persistent "Spaces" nav item in `apps/computer/src/components/ComputerSidebar.tsx`
- Routes `apps/computer/src/routes/_authed/_shell/spaces.index.tsx` and `spaces.$spaceId.tsx` (the latter is already a redirect to `/new`)
- All files in `apps/computer/src/components/spaces/` (including `MentionMenu.tsx`, which is consumed by non-space routes — keeps its current path)
- `apps/admin`'s spaces routes and the `space.query.ts` / `startCustomerOnboarding.mutation.ts` resolvers
- The three in-flight plans from 2026-05-19 (003 customer-onboarding-v1, 004 stepfunctions-connectors, 005 collaborative-chat-ui) — owned by the parallel spaces rearchitecture

---

## Key Technical Decisions

### D1. Hard remove the GraphQL fields rather than soft-deprecate

`Thread.spaceId` and `Thread.space` are dropped outright, not flipped to nullable for a deprecation window. Rationale: codegen consumers are enumerated (admin has one hand-written query; mobile + CLI use only generated types). The cost of one surgical edit to `apps/admin/src/lib/graphql-queries.ts` is lower than the cost of carrying a deprecated field that nobody enforces removal of, and matches the "remove space stuff" framing.

### D2. Drop columns entirely; do not leave nullable placeholders

`threads.space_id` etc. are removed from the Postgres schema entirely. Rationale: a dormant nullable column with no FK is just lying-by-omission about the model. The parallel spaces rearchitecture is free to add a new linking concept under a different name when it lands. Reusing the same column name would invite confusion about whether old data still applies.

### D3. Hand-rolled migration with `-- drops*:` markers; apply to dev via `psql -f` before merge

Follows the precedent of `0029_collapse_execution_types.sql`, `0091_drop_wiki_brain_compat_views.sql`, and `0092_finish_oss_connector_retirement.sql`. The migration is NOT registered in `meta/_journal.json`. Eric applies it to dev with `psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_*.sql` before merging, then the deploy-time `pnpm db:migrate-manual` drift gate confirms each declared drop is absent from the dev database.

### D4. Migration sequence inside a single transaction: trigger → trigger function → constraint → FK → index → column

Drop order matters: drop the trigger on the table first (it references the trigger function), then the trigger function, then the CHECK constraint, then the FK, then the index, then the column. Wrap the whole thing in a transaction so a partial failure rolls back cleanly. This sequence is repeated for `threads`, `thread_participants`, `linked_tasks` (with the `checklist_item_id` FK as an extra step), and `linked_task_events`.

### D5. `ensureThreadForWork` signature changes; all 8+ callers update in lockstep

The shared helper in `packages/database-pg/src/lib/thread-helpers.ts` (re-exported from `packages/api/src/lib/thread-helpers.ts`) currently takes `space_id` and auto-provisions a default space. After this plan it takes no `space_id`. The 8 callers (`packages/lambda/job-trigger.ts`, `packages/api/src/lib/orchestration/process-materializer.ts`, `packages/api/src/handlers/scheduled-jobs.ts` / `webhooks.ts` / `webhooks-admin.ts` / `eval-worker.ts` / `wakeup-processor.ts` (three sites)) all lose the `space_id` argument. This must land in one commit; TypeScript will refuse to build a partial signature change.

### D6. Auth-callback redirect goes to `/new`, not `/spaces`

`apps/computer/src/routes/auth/callback.tsx:55,60` currently sends post-OAuth users to `/spaces`. After this plan, `/spaces` is still a route (owned by the parallel rearchitecture) but isn't a chat destination. Redirect to `/new` — the existing canonical "start a new chat" route — so the user-app login flow lands somewhere useful.

### D7. The legacy `/spaces/$spaceId/threads/$threadId` route file is deleted

`apps/computer/src/routes/_authed/_shell/spaces.$spaceId.threads.$threadId.tsx` cannot survive thread-space decoupling. Delete it (and `-spaces-route.test.tsx` which tests it). Old deep links from email / Slack notifications that point at this URL will 404; that's acceptable since the route hasn't been the canonical thread URL for some time (`ChatSidebar.tsx:566-571` already canonicalizes to `/threads/$id`). A redirect catch-all is not added because the link surface is small and routing complexity has its own cost.

### D8. `apps/computer/src/components/spaces/MentionMenu.tsx` stays where it is

Even though `MentionMenu` is consumed by non-spaces routes (`ComputerThreadDetailRoute.tsx`, `TaskThreadView.tsx`), this plan does NOT touch `apps/computer/src/components/spaces/`. The directory cleanup belongs to the parallel rearchitecture. The `MentionMenu` import path stays as-is until that work happens.

---

## System-Wide Impact

| Surface                                       | Impact                                                                                                                                   | Affected by this plan? |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Postgres schema                               | 12+ objects dropped (FKs, triggers, trigger functions, constraints, indices, columns) across 4 tables                                    | Yes — Unit U1          |
| Drizzle schema                                | 3 `.ts` files lose `space_id` (+ `checklist_item_id`) columns + relations                                                                | Yes — Unit U2          |
| GraphQL canonical schema                      | `Thread` / `ThreadParticipant` / `LinkedTask` / `LinkedTaskEvent` lose `spaceId`; `CreateThreadInput`, `threadsPaged` lose `spaceId` arg | Yes — Unit U2          |
| AppSync subscription schema                   | No change required (verified — no `spaceId` field in subscription types)                                                                 | No                     |
| Strands runtime (Python)                      | Already ignores `space_id` in wakeup payload                                                                                             | No                     |
| `packages/api` resolvers                      | createThread, threadsPaged, types, sendMessage drop space coupling                                                                       | Yes — Unit U3          |
| `packages/api` libs                           | thread-helpers, mention pipeline (×3), linked-tasks sync, lastmile adapter, brain draft-review, slack thread-mapping drop space coupling | Yes — Unit U4          |
| Integration tests                             | 3 sandbox e2e tests stop writing `threads.space_id` directly                                                                             | Yes — Unit U5          |
| `apps/computer` UI                            | Chat sidebar dropdown removed; ~6 downstream files lose `spaceId` typings/branches; `spaces.$spaceId.threads.$threadId` route deleted    | Yes — Unit U6          |
| `apps/admin` UI                               | One surgical edit to `apps/admin/src/lib/graphql-queries.ts` ThreadsPagedQuery + codegen regen                                           | Yes — Unit U7          |
| `apps/mobile`                                 | Pure codegen regen — no hand-written queries select `Thread.spaceId`                                                                     | Yes — Unit U7          |
| `apps/cli`                                    | Pure codegen regen — no hand-written queries select `Thread.spaceId`                                                                     | Yes — Unit U7          |
| `packages/agentcore-strands`                  | No change                                                                                                                                | No                     |
| `terraform/`                                  | No change                                                                                                                                | No                     |
| Persistent left-rail "Spaces" nav             | Stays                                                                                                                                    | No                     |
| `apps/computer/src/components/spaces/`        | Stays                                                                                                                                    | No                     |
| All spaces.\* resolvers + admin spaces routes | Stay                                                                                                                                     | No                     |

---

## Implementation Units

### U1. Hand-rolled migration: drop space coupling from thread/linked_task tables

**Goal:** Remove every Postgres object that ties `threads`, `thread_participants`, `linked_tasks`, and `linked_task_events` to the `spaces.*` domain.

**Requirements:** R1, R2, R8

**Dependencies:** None (DB-only; precedes Drizzle + GraphQL + code changes)

**Files:**

- Create: `packages/database-pg/drizzle/NNNN_decouple_threads_from_spaces.sql` (NNNN = next sequential, check `ls packages/database-pg/drizzle/ | tail -3` at write time)

**Approach:**
The migration runs as a single transaction. Header carries a purpose paragraph, the apply command (`psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_*.sql`), verification steps, and the complete marker block. The marker block declares every dropped object so the `migration-precheck` CI gate can confirm absence in dev.

Drop order inside the transaction (repeated per table):

1. **`threads`** — drop trigger `threads_space_tenant_guard`, drop trigger function `enforce_thread_space_tenant`, drop CHECK constraint `threads_space_id_required`, drop FK `threads_space_id_spaces_id_fk`, drop index `idx_threads_tenant_space_updated`, drop column `space_id`.
2. **`thread_participants`** — symmetric set: trigger / trigger function (if present) / constraint `thread_participants_space_id_required` / FK `thread_participants_space_id_spaces_id_fk` / index `idx_thread_participants_space` / column `space_id`.
3. **`linked_tasks`** — drop FK `linked_tasks_space_id_spaces_id_fk`, drop FK `linked_tasks_checklist_item_id_*_fk` (verify exact name in dev), drop unique constraint `uq_linked_tasks_checklist_item` (if it exists per `linked-tasks-schema.test.ts:47-49`), drop index `idx_linked_tasks_space`, drop columns `space_id` and `checklist_item_id`. If trigger function `enforce_linked_task_tenant` references `space_id` in its body, recreate it without that reference; otherwise leave it (the function name suggests tenant-only enforcement, but body inspection is required during implementation).
4. **`linked_task_events`** — symmetric subset: FK `linked_task_events_space_id_spaces_id_fk`, column `space_id`, and `enforce_linked_task_event_tenant` body check.

Marker block in header (one line per declared drop), example shape. The drift reporter (`scripts/db-migrate-manual.sh`) only recognizes three drop-marker forms: `-- drops:` (objects), `-- drops-column:` (columns), `-- drops-constraint:` (constraints). Triggers and functions use the generic `-- drops:`.

```
-- drops: public.threads.threads_space_tenant_guard
-- drops: public.enforce_thread_space_tenant
-- drops-constraint: public.threads.threads_space_id_required
-- drops-constraint: public.threads.threads_space_id_spaces_id_fk
-- drops: public.idx_threads_tenant_space_updated
-- drops-column: public.threads.space_id
-- (...repeat for thread_participants, linked_tasks, linked_task_events)
```

**Patterns to follow:**

- `packages/database-pg/drizzle/0091_drop_wiki_brain_compat_views.sql` — header structure, marker block placement
- `packages/database-pg/drizzle/0092_finish_oss_connector_retirement.sql` — multi-object drop, transaction wrapping
- `packages/database-pg/drizzle/0029_collapse_execution_types.sql` — `drops-column:` precedent
- `docs/solutions/database-issues/feature-schema-extraction-pattern.md` — overall pattern
- Memory `feedback_handrolled_migrations_apply_to_dev` — apply to dev via `psql -f` BEFORE merging or the deploy gate fails

**Test scenarios:**

- Test expectation: none — this is a pure DDL change. Verification happens through `pnpm db:migrate-manual` (drift reporter) against dev after manual apply, and the schema tests in U2 update to match the new shape.

**Verification:**

- `psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_*.sql` applies cleanly to dev (no errors)
- `pnpm db:migrate-manual` against dev reports every declared object as ABSENT (not MISSING) after apply
- `\d threads`, `\d thread_participants`, `\d linked_tasks`, `\d linked_task_events` confirm `space_id` (and `checklist_item_id` for linked_tasks) are gone
- `select count(*) from pg_trigger where tgname = 'threads_space_tenant_guard'` returns 0
- `select count(*) from pg_proc where proname = 'enforce_thread_space_tenant'` returns 0

---

### U2. Drizzle schema + GraphQL canonical types + schema tests

**Goal:** Remove `space_id` (and `checklist_item_id`) columns/relations from the Drizzle TS schema, drop the corresponding fields/inputs from the canonical GraphQL types, update schema tests, regenerate `terraform/schema.graphql`.

**Requirements:** R1, R2, R3, R8

**Dependencies:** U1 (DB must match before TS schema compiles against it in CI)

**Files:**

- Modify:
  - `packages/database-pg/src/schema/threads.ts` — drop `space_id` column, drop space index, drop `space` relation, drop `spaces` import
  - `packages/database-pg/src/schema/thread-participants.ts` — drop `space_id` column, drop index, drop relation, drop `spaces` import
  - `packages/database-pg/src/schema/linked-tasks.ts` — drop `space_id` columns from `linkedTasks` + `linkedTaskEvents`, drop `checklist_item_id` column, drop `space` + `checklistItem` relations, drop `spaceChecklistItems, spaces` imports
  - `packages/database-pg/graphql/types/threads.graphql` — drop `Thread.spaceId`, `Thread.space`, `CreateThreadInput.spaceId`, `threadsPaged(... spaceId: ID)` arg, `ThreadParticipant.spaceId`
  - `packages/database-pg/graphql/types/linked-tasks.graphql` — drop `LinkedTask.spaceId`, `LinkedTaskEvent.spaceId`
- Test (modify):
  - `packages/database-pg/__tests__/thread-participants-schema.test.ts` — remove the `creates-column: public.threads.space_id` assertion
  - `packages/database-pg/__tests__/migration-0109.test.ts` — either retire (this test asserts the now-dropped `0109` invariants) or update to assert the inverse
  - `packages/database-pg/__tests__/linked-tasks-schema.test.ts` — remove `uq_linked_tasks_checklist_item` and any `space_id` invariants
- Regenerate (via `pnpm schema:build`):
  - `terraform/schema.graphql` — should show no diff in subscription-type definitions; Thread-related types are HTTP-only and don't surface here

**Approach:**
After U1 lands and dev DB matches, edit each Drizzle schema file to drop the `space_id` (and `checklist_item_id`) columns, their indices, and their relations. The `spaces` import at the top of each file goes away. Pay attention to the `relations()` blocks at the bottom of `threads.ts` and `linked-tasks.ts` — drop the `space:` field from each. Run `pnpm --filter @thinkwork/database-pg build` to confirm TS compiles.

GraphQL types: open each `.graphql` file and delete the offending field lines. Run `pnpm schema:build` to regenerate `terraform/schema.graphql` and confirm only HTTP-side types changed (AppSync subscription types should be unaffected).

Schema tests: the existing tests in `packages/database-pg/__tests__/` assert `creates: public.threads.space_id` markers from prior migrations (`0106`, `0109`). Those assertions become stale invariants. Either delete each obsolete assertion or rewrite to assert absence post-decoupling. Prefer deletion of the specific assertion lines over deletion of whole test files unless the file is wholly about the dropped invariant.

**Patterns to follow:**

- Existing relations pattern in `packages/database-pg/src/schema/wiki.ts` (post-extraction, doesn't reference spaces)
- `packages/database-pg/__tests__/wiki-schema.test.ts` for the test shape after a schema extraction

**Test scenarios:**

- `pnpm --filter @thinkwork/database-pg test` — schema unit tests pass
- `pnpm --filter @thinkwork/database-pg build` — TypeScript build succeeds
- `pnpm schema:build` — exits 0; `git diff terraform/schema.graphql` shows zero changes (Thread types are HTTP-only)

**Verification:**

- `grep -rn "space_id\|spaceId\|spaces\b" packages/database-pg/src/schema/threads.ts packages/database-pg/src/schema/thread-participants.ts packages/database-pg/src/schema/linked-tasks.ts` returns zero results (modulo `space` substrings that are part of unrelated words, none expected)
- `grep -n "spaceId\|space:" packages/database-pg/graphql/types/threads.graphql packages/database-pg/graphql/types/linked-tasks.graphql` returns zero
- `pnpm -r --if-present typecheck` passes for `@thinkwork/database-pg`

---

### U3. API thread + message resolvers: drop space coupling

**Goal:** Strip space-coupling from the four core thread/message resolvers + their unit tests.

**Requirements:** R3, R5, R6

**Dependencies:** U2 (TS schema must be `space_id`-free for these files to compile)

**Files:**

- Modify:
  - `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` — drop `i.spaceId` handling, drop `ensureDefaultThreadSpace` import + call, drop `hasSpaceMemberAccess` import + call, drop `spaces` + `spaceAgentAssignments` imports if unused after, drop the entire space-lookup branch + threadSpace plumbing, simplify the INSERT to omit `space_id`
  - `packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts` — drop the `if (args.spaceId)` block (lines ~47-54), drop the `hasSpaceMemberAccess` gating, drop the `!args.spaceId` branch in the cognito-non-admin clause (line ~57)
  - `packages/api/src/graphql/resolvers/threads/types.ts` — drop the `space` field resolver (lines ~70-80), drop `spaces` import
  - `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts` — drop `space_id: threads.space_id` from the SELECT (line ~43), drop `spaceId: thread.space_id` from both wakeup payloads (lines ~128, ~151)
- Test (modify or delete):
  - `packages/api/src/graphql/resolvers/threads/createThread.space.test.ts` — DELETE (this entire test file asserts space-gating behavior that no longer exists)
  - `packages/api/src/graphql/resolvers/threads/threadsPaged.query.test.ts` — delete the "adds a space_id condition when spaceId is set" test cases (~lines 230-260); keep other tests
  - `packages/api/src/graphql/resolvers/threads/types.test.ts` — delete the "resolves a related Space from thread.spaceId" test case (~lines 120-133)

**Approach:**
`createThread.mutation.ts` is the biggest change. The current control flow does `if (!i.spaceId) { threadSpace = await ensureDefaultThreadSpace(...) } else { ... validate ... }` and then later writes `space_id: threadSpace.id` into the INSERT. After this plan, the function takes no spaceId, performs no space lookup, and INSERTs without that column. The `spaceAgentAssignments` lookup (~line 186) that auto-attaches agents from the space's assignments also goes — initial thread participants come only from explicit input or other mention paths.

`threadsPaged.query.ts` simplifies to tenant-scoped filtering with no space dimension. The cognito-non-admin branch that says "if user isn't admin and didn't supply a spaceId, restrict to threads they participate in" needs a replacement membership check that doesn't go through spaces — current behavior probably keeps the participation check but drops the `!args.spaceId` precondition. Read the code carefully during implementation; if the participation check was _only_ applied when `spaceId` was missing, it now applies unconditionally for cognito-non-admin callers, which is the safe default.

`types.ts` and `sendMessage.mutation.ts` are straightforward deletions.

**Patterns to follow:**

- Other thread mutations in `packages/api/src/graphql/resolvers/threads/` for the post-cleanup INSERT/SELECT shape

**Test scenarios:**

- `createThread` happy path: caller provides `tenantId` + title + initial message → thread created with tenant_id but no space_id; test it via `createThread.mutation.test.ts` if one exists, or via the existing non-space test cases
- `createThread` no longer requires "Space membership" — verify the GraphQL mutation succeeds for a caller who would previously have failed the membership check
- `threadsPaged` happy path: returns threads for tenant scoped only; cognito-non-admin callers see threads they participate in
- `threadsPaged` cognito-non-admin: a user with no space membership but who is a participant on a thread can still see it (this should be a new test if not already covered)
- `sendMessage` happy path: wakeup payload no longer carries `spaceId`; verify the dispatched payload object via the existing payload-shape test in `sendMessage.mutation.test.ts`

**Verification:**

- `pnpm --filter @thinkwork/api test packages/api/src/graphql/resolvers/threads packages/api/src/graphql/resolvers/messages` passes
- `grep -rn "space_id\|spaceId" packages/api/src/graphql/resolvers/threads packages/api/src/graphql/resolvers/messages` returns zero results

---

### U4. API libs + helpers + handlers: drop space coupling from the broader pipeline

**Goal:** Sweep every non-resolver site in `packages/api` and `packages/lambda` that reads or writes `space_id` on threads/messages/linked_tasks.

**Requirements:** R5, R6

**Dependencies:** U3 (resolver signatures stabilize first; this unit propagates the cleanup outward)

**Files:**

- Modify (helpers):
  - `packages/database-pg/src/lib/thread-helpers.ts` — drop `ensureDefaultThreadSpaceId`, drop `space_id` from `ensureThreadForWork` + `ensureRecurringThread` signatures, drop `space_id` from the INSERT
  - `packages/api/src/lib/thread-helpers.ts` — drop any re-export glue + caller-facing wrappers that touched `space_id`
- Modify (8 callers, all drop the `space_id` argument they currently pass):
  - `packages/lambda/job-trigger.ts:16,710`
  - `packages/api/src/lib/orchestration/process-materializer.ts:10,61`
  - `packages/api/src/handlers/scheduled-jobs.ts:45,874`
  - `packages/api/src/handlers/webhooks.ts:32,354`
  - `packages/api/src/handlers/webhooks-admin.ts:34,326`
  - `packages/api/src/handlers/eval-worker.ts:12,613`
  - `packages/api/src/handlers/wakeup-processor.ts:59,689,1400,1480` (three insertion sites)
- Modify (direct INSERT sites):
  - `packages/api/src/lib/brain/draft-review-writeback.ts:566` — drop the default-space lookup, INSERT without `space_id`
  - `packages/api/src/lib/slack/thread-mapping.ts:198` — same pattern
- Modify (mention pipeline):
  - `packages/api/src/lib/mentions/thread-mention-targets.ts:44,56` — drop `space_id` from SELECT
  - `packages/api/src/lib/mentions/thread-participant-mentions.ts:9,29,52,63,96` — drop `spaceId` from input + the `if (!input.spaceId)` gate (the gate becomes a no-op once removed)
  - `packages/api/src/lib/mentions/dispatch-agent-mentions.ts:30,89` — drop `spaceId` from the agent-wakeup payload entirely (no replacement)
- Modify (linked tasks):
  - `packages/api/src/lib/linked-tasks/sync-linked-task.ts:61,239,508,547` — drop `spaceId` from the sync input + the INSERT to `linked_tasks` / `linked_task_events`; drop any `checklist_item_id` linkage
  - `packages/api/src/graphql/resolvers/linked-tasks/threadLinkedTasks.query.ts:25` — drop `hasSpaceMemberAccess` call; access control falls back to tenant + thread-participation check (whichever is the established pattern in adjacent resolvers — verify by reading `unreadThreadCount.query.ts` and `threadsPaged.query.ts` post-U3)
- Modify (lastmile):
  - `packages/api/src/lib/lastmile/tasks-adapter.ts:47,134` — drop `spaceId` from the LastMile external task payload. (External API ignored the field per prior smoke runs; if it returns a 400 on unrecognized fields, that's the only behavioral risk to verify in implementation.)
- Possibly modify:
  - `packages/api/src/lib/spaces/default-space.ts` — this file's primary export `ensureDefaultThreadSpace` becomes dead. Delete the file unless it has other exports. Spaces resolvers (`startCustomerOnboarding`, `space.query`) don't import it (verified — they use `hasSpaceMemberAccess` from `spaces/shared.ts`).
- Modify (tests that exercise these libs):
  - Any unit test under `packages/api/src/lib/mentions/`, `packages/api/src/lib/linked-tasks/`, `packages/api/src/lib/brain/`, `packages/api/src/lib/slack/`, `packages/api/src/handlers/` that constructs a `space_id`-shaped input or asserts a `spaceId`-shaped output

**Approach:**
This is the largest unit by file count but mechanically the simplest: every site is removing an existing argument or column reference, never adding behavior. Work outward from the helper signature change: edit `thread-helpers.ts` first, let TypeScript flag every caller, fix each in turn. The mention pipeline files are sequential — `thread-mention-targets` feeds `thread-participant-mentions` feeds `dispatch-agent-mentions`. Walk the chain.

The one site needing judgment is `threadLinkedTasks.query.ts:25`'s removal of `hasSpaceMemberAccess`. Read `threadsPaged.query.ts` after U3 lands to confirm the post-decoupling access pattern (likely: tenant scope + thread participation check), then apply the same pattern here.

`lastmile/tasks-adapter.ts` makes an outbound HTTP call. The LastMile external API takes a JSON payload; the `spaceId` field is currently included but the LastMile docs and our prior integration testing suggest it's unused there. Drop it from the payload. If LastMile's API contract has changed to reject unknown fields (unlikely), surface that during execution.

**Patterns to follow:**

- The wakeup-processor.ts ~1400 / ~1480 insertion sites are good references for the post-decoupling INSERT shape
- Existing `unreadThreadCount.query.ts` for the participation-based access check (no space coupling)

**Test scenarios:**

- `ensureThreadForWork`: callers can create threads without supplying a space_id; the resulting row carries no space_id (verify via the existing helper unit tests if present)
- `dispatchAgentMentions`: the dispatched wakeup payload's shape contains no `spaceId` key — assert via the existing dispatch test
- `syncLinkedTask`: a linked task can be created/updated for a thread that has no space; assert no DB error
- `tasks-adapter.ts` LastMile: the outbound payload (captured via the existing mock HTTP test) contains no `spaceId` field
- `threadLinkedTasks.query`: a cognito-non-admin caller who is a thread participant can list the thread's linked tasks; a non-participant cannot

**Verification:**

- `pnpm --filter @thinkwork/api test` — full API test suite passes
- `pnpm --filter @thinkwork/api typecheck` passes
- `grep -rn "space_id\|spaceId" packages/api/src packages/lambda` — only spaces/\* directories and acceptable substrings (e.g., `workspaceId` in unrelated code) remain
- `grep -n "ensureDefaultThreadSpace\|hasSpaceMemberAccess" packages/api/src/lib packages/api/src/handlers packages/lambda` — only calls inside `packages/api/src/graphql/resolvers/spaces/` remain

---

### U5. Integration tests: stop writing `threads.space_id` directly

**Goal:** Remove direct SQL writes to `threads.space_id` from the sandbox integration tests so they keep building and passing after U1+U2 land.

**Requirements:** R5, R8

**Dependencies:** U2 (TS schema must not expose `space_id` for these tests to compile against the new shape)

**Files:**

- Modify:
  - `packages/api/test/integration/sandbox/sandbox-pilot.e2e.test.ts:178` — drop `space_id` from the raw INSERT into `threads`
  - `packages/api/test/integration/sandbox/sandbox-cross-tenant.e2e.test.ts:143` — same
  - `packages/api/test/integration/sandbox/sandbox-cap-breach.e2e.test.ts:157` — same

**Approach:**
Pure mechanical edit. These tests build a thread row to seed sandbox fixtures. Drop the `space_id` column from each INSERT. No other test logic changes.

**Patterns to follow:**

- Adjacent fixtures in the same files that build other tables (e.g., agents) without spaces references

**Test scenarios:**

- Test expectation: none — these are existing tests; the change is to keep them green, not add coverage.

**Verification:**

- `pnpm --filter @thinkwork/api test packages/api/test/integration/sandbox` passes
- `grep -n "space_id" packages/api/test/integration/sandbox/` returns zero

---

### U6. User app: remove dropdown + downstream UI cleanup

**Goal:** Remove the spaces dropdown from the chat sidebar, drop `Thread.spaceId` typings + branches from downstream UI files, delete the legacy thread-within-space route, redirect post-OAuth landing to `/new`.

**Requirements:** R4

**Dependencies:** U2 (canonical GraphQL types must have dropped `Thread.spaceId` before codegen rerun)

**Files:**

- Modify:
  - `apps/computer/src/components/shell/ChatSidebar.tsx` — delete the `<Select>` block (lines ~273-308), delete the `SpacesQuery` import + `useQuery<SpacesResult>` call (~lines 101-107), delete `selectedSpaceId` / `setSelectedSpaceId` state, replace `activeSpaceId` references with tenant-only filtering, delete `spaceIdFromThreadPath` helper + its usage, delete `isGeneralSpace` helper, delete the `SpacesResult` interface
  - `apps/computer/src/components/shell/chat-sidebar-types.ts` — drop `spaceId?` and `space?` fields from `ChatThreadSummary`; delete the `SpaceNavSummary` interface
  - `apps/computer/src/components/shell/GlobalInboxSection.tsx:79-89` — collapse the `thread.spaceId` branch (both branches currently link to `/threads/$id`, so the branch becomes unconditional)
  - `apps/computer/src/components/computer/ComputerThreadDetailRoute.tsx:43` — drop `spaceId?` from `ThreadResult` typing
  - `apps/computer/src/components/computer/ComputerThreadDetailRoute.test.tsx:78` — drop `spaceId` from test fixture
  - `apps/computer/src/components/NewThreadDialog.tsx:27-105` — drop the optional `spaceId` prop, drop the `/spaces/$spaceId/threads/$threadId` navigation branch, navigation always goes to `/threads/$id`
  - `apps/computer/src/lib/graphql-queries.ts` — drop `SpacesQuery` export, drop the `$spaceId: ID` variable and `spaceId` selection from `ThreadsPagedQuery`
  - `apps/computer/src/routes/auth/callback.tsx:55,60` — change both redirects from `/spaces` to `/new`
- Delete:
  - `apps/computer/src/routes/_authed/_shell/spaces.$spaceId.threads.$threadId.tsx`
  - `apps/computer/src/routes/_authed/_shell/-spaces-route.test.tsx`
- Regenerate (via `pnpm --filter @thinkwork/computer codegen`):
  - `apps/computer/src/gql/graphql.ts` (or whatever the codegen output path is — verify in `apps/computer/codegen.ts`)
  - `apps/computer/src/routeTree.gen.ts` (auto-regenerates when the route file is deleted)
- Test (modify):
  - `apps/computer/src/components/shell/ChatSidebar.test.tsx` — drop tests that assert the dropdown's presence; keep tests that assert the rest of the sidebar's behavior. Update any test fixture that supplies `spaceId` on a thread to omit it.

**Do NOT touch:**

- `apps/computer/src/components/ComputerSidebar.tsx` — persistent left-rail Spaces nav stays (parallel rearchitecture owns it)
- `apps/computer/src/components/spaces/` — entire directory stays; `MentionMenu.tsx` import path in `ComputerThreadDetailRoute.tsx` and `TaskThreadView.tsx` remains unchanged
- `apps/computer/src/routes/_authed/_shell/spaces.index.tsx` — stays
- `apps/computer/src/routes/_authed/_shell/spaces.$spaceId.tsx` — already a redirect to `/new`; stays
- `apps/computer/src/components/computer/TaskDashboard.tsx`, `apps/computer/src/components/artifacts/ArtifactsListBody.tsx`, `apps/computer/src/lib/computer-routes.ts` — these reference `/spaces` URLs but link to the surviving spaces routes; out of scope here (the parallel rearchitecture's call whether to keep these links)

**Approach:**
Start with the canonical query removal: edit `apps/computer/src/lib/graphql-queries.ts` first so codegen has fewer types to emit. Then edit `ChatSidebar.tsx` — the dropdown removal collapses the active-space state out of the component. The downstream files (`chat-sidebar-types`, `GlobalInboxSection`, `ComputerThreadDetailRoute`, `NewThreadDialog`) each lose a single `spaceId` reference or branch. Auth callback redirect is a one-line edit each. Delete the two route files last (route tree regenerates on next build).

Run `pnpm --filter @thinkwork/computer codegen` after the canonical GraphQL change in U2 to refresh the generated types. Then `pnpm --filter @thinkwork/computer build` + `pnpm --filter @thinkwork/computer typecheck` to confirm clean.

**Patterns to follow:**

- The simplified sidebar shape in `apps/admin/src/components/shell/AdminSidebar.tsx` (no per-row group selector — admin's sidebar has always been simpler)
- The auth callback's existing structure for the post-OAuth redirect

**Test scenarios:**

- `ChatSidebar` renders without the dropdown — assert via `ChatSidebar.test.tsx` (snapshot or DOM query for absence of the SelectTrigger)
- `ChatSidebar` thread list shows tenant-scoped threads regardless of space membership — extend the existing test that exercises `ThreadsPagedQuery`
- `GlobalInboxSection` renders unread items linking to `/threads/$id` — assert all rendered links use the canonical URL
- `NewThreadDialog` always navigates to `/threads/$id` — assert via the existing dialog test (drop the spaceId branch coverage)
- `ComputerThreadDetailRoute` accepts a thread with no `spaceId` — assert via `ComputerThreadDetailRoute.test.tsx`
- Manual: dev-server smoke — open sidebar, confirm no dropdown; click a thread, confirm it opens at `/threads/$id`; sign out and re-OAuth, confirm landing at `/new`

**Verification:**

- `pnpm --filter @thinkwork/computer test` passes
- `pnpm --filter @thinkwork/computer typecheck` passes
- `pnpm --filter @thinkwork/computer build` passes
- `grep -rn "spaceId\|SpacesQuery\|isGeneralSpace\|spaceIdFromThreadPath" apps/computer/src` returns only hits inside `apps/computer/src/components/spaces/` (which is out of scope) and `apps/computer/src/components/ComputerSidebar.tsx` / `apps/computer/src/components/computer/TaskDashboard.tsx` / `apps/computer/src/components/artifacts/ArtifactsListBody.tsx` / `apps/computer/src/lib/computer-routes.ts` (which reference `/spaces` URLs, not Thread.spaceId)
- Manual smoke against the dev server: dropdown gone, threads load, no console errors

---

### U7. Downstream codegen consumers: admin surgical edit + mobile/CLI regen

**Goal:** Keep `apps/admin`, `apps/mobile`, and `apps/cli` building after the canonical GraphQL field removal.

**Requirements:** R7

**Dependencies:** U2 (canonical types must have dropped the fields first)

**Files:**

- Modify:
  - `apps/admin/src/lib/graphql-queries.ts:889-922` — drop `$spaceId: ID` from the `ThreadsPagedQuery` variables, drop the `spaceId` selection on items
- Regenerate (mechanical):
  - `apps/admin/src/gql/graphql.ts` + `apps/admin/src/gql/gql.ts` (via `pnpm --filter @thinkwork/admin codegen`)
  - `apps/mobile/lib/gql/graphql.ts` (via `pnpm --filter @thinkwork/mobile codegen`)
  - `apps/cli/src/gql/graphql.ts` (via `pnpm --filter @thinkwork/cli codegen`)

**Do NOT touch:**

- Admin's spaces routes (`apps/admin/src/routes/_authed/_tenant/spaces/*`) — they query `spaces.*` / `space(id)` resolvers which keep working (those resolvers stay)
- Any other hand-written admin/mobile/cli query

**Approach:**
The admin edit is one query, two-line surgical. Run codegen in all three apps after. Confirm each one's typecheck + build passes.

**Patterns to follow:**

- `apps/admin/src/lib/graphql-queries.ts` itself for the pre-cleanup `ThreadsPagedQuery` shape (the post-cleanup shape mirrors `apps/computer/src/lib/graphql-queries.ts` after U6)

**Test scenarios:**

- Test expectation: none — pure codegen propagation + one query field drop. Verified by build/typecheck across all three apps.

**Verification:**

- `pnpm --filter @thinkwork/admin typecheck && pnpm --filter @thinkwork/admin build` pass
- `pnpm --filter @thinkwork/mobile typecheck` passes
- `pnpm --filter @thinkwork/cli typecheck && pnpm --filter @thinkwork/cli build` pass
- `grep -n "spaceId" apps/admin/src/lib/graphql-queries.ts` returns zero

---

## Scope Boundaries

### Deferred to Follow-Up Work

- **Rebuild a "workspace" affordance** if the parallel spaces rearchitecture lands and the user app needs a new organizing nav element. This plan does not create one.
- **MentionMenu relocation** out of `apps/computer/src/components/spaces/`. Path stays until the parallel rearchitecture deletes the `components/spaces/` directory.
- **Catch-all redirect** from `/spaces/$spaceId/threads/$threadId` → `/threads/$threadId` for old deep links. Not added; old links 404. If user reports surface it, add as a follow-up.
- **Cleanup of `apps/computer/src/components/computer/TaskDashboard.tsx` + `ArtifactsListBody.tsx` "Open Space" / "Open Spaces" links** if the parallel rearchitecture decides those destinations are no longer useful.
- **Three in-flight 2026-05-19 plans** (003 customer-onboarding-v1, 004 stepfunctions-connectors, 005 collaborative-chat-ui). Their `status` frontmatter is not touched by this plan; the parallel spaces rearchitecture owns their disposition.

### Out of scope (parallel work / not this plan's identity)

- The `spaces`, `space_members`, `space_agent_assignments`, `space_checklist_templates`, `space_checklist_items`, `space_integrations` tables
- The persistent "Spaces" nav item in `apps/computer/src/components/ComputerSidebar.tsx`
- All resolvers under `packages/api/src/graphql/resolvers/spaces/`
- `hasSpaceMemberAccess` itself (the helper stays; only thread-side callers stop using it)
- The admin SPA's spaces routes (`apps/admin/src/routes/_authed/_tenant/spaces/`)
- The Strands runtime — no changes
- Any new workspace concept's data model, UI, or API surface

---

## Risk Analysis & Mitigation

| Risk                                                                                                                                               | Likelihood | Impact                                        | Mitigation                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Migration applied to dev but not declared in marker block → deploy gate fails                                                                      | Low        | High (blocks deploy of every PR merged after) | U1 verification step explicitly runs `pnpm db:migrate-manual` against dev after apply and before merge                       |
| Caller of `ensureThreadForWork` missed during U4 sweep → runtime error on thread creation                                                          | Medium     | High                                          | TypeScript signature change forces every caller to update; no caller can compile against the old signature                   |
| Admin's `ThreadsPagedQuery` not updated before merge → admin app breaks in prod                                                                    | Low        | High                                          | U7 is gated on U2; admin's typecheck step in CI catches the mismatch before merge                                            |
| LastMile external API rejects payload without `spaceId`                                                                                            | Low        | Medium                                        | Verify during U4 implementation via the existing mock or a probe; if API contract has changed, file follow-up before merging |
| Old `/spaces/$spaceId/threads/$threadId` deep links 404 after route deletion                                                                       | Medium     | Low                                           | Acceptable per D7; old emails/Slack links may break but the canonical thread URL has been `/threads/$id` for some time       |
| `enforce_linked_task_tenant` / `enforce_linked_task_event_tenant` trigger function bodies reference `space_id` and silently fail after column drop | Low        | Medium                                        | U1 explicitly inspects each trigger function body during implementation and recreates without `space_id` reference if needed |
| Schema test asserts a `creates-column: ... space_id` invariant and silently passes after deletion (because the assertion file is wholly deleted)   | Low        | Low                                           | U2 prefers targeted assertion deletion over whole-file deletion; the remaining assertions stay live                          |

---

## Verification Strategy

End-to-end verification before merge:

1. **Migration applied to dev:**

   - `psql "$DATABASE_URL" -f packages/database-pg/drizzle/NNNN_*.sql` runs cleanly
   - `pnpm db:migrate-manual` against dev reports every declared object as ABSENT

2. **Monorepo-wide build/typecheck/test:**

   - `pnpm -r --if-present typecheck` passes
   - `pnpm -r --if-present test` passes
   - `pnpm -r --if-present build` passes
   - `pnpm format:check` passes

3. **Manual smoke in the user app:**

   - Dev server `pnpm --filter @thinkwork/computer dev --host localhost --port 5180`
   - Open chat sidebar → dropdown gone
   - Click a recent thread → opens at `/threads/$id`
   - Sign out + re-OAuth → lands at `/new`
   - Send a message → no console errors, wakeup dispatches successfully

4. **CI gate:**

   - `migration-precheck` workflow passes (marker block matches reality in dev)
   - Standard PR checks (cla, verify, lint, typecheck, test) pass

5. **Post-merge:**
   - Watch `gh run list --branch main` for the Deploy run
   - Confirm `terraform apply` (if any) and computer-app deploy succeed
   - Confirm `pnpm db:migrate-manual` as part of the deploy gate confirms each dropped object remains absent

---

## Dependencies / Prerequisites

- Memory `feedback_handrolled_migrations_apply_to_dev` — apply `0NNN_*.sql` to dev via `psql -f` before merging
- Memory `project_migration_precheck_ci_gate` — `.github/workflows/migration-precheck.yml` will run the drift reporter on this PR
- Memory `feedback_worktree_tsbuildinfo_bootstrap` — if working in a worktree, `find . -name tsconfig.tsbuildinfo -not -path '*/node_modules/*' -delete && pnpm --filter @thinkwork/database-pg build` after `pnpm install`
- Parallel spaces rearchitecture workstream — this plan must not collide with its schema-side work; coordinate before U1 lands if the rearchitecture is also actively touching `spaces.*` migrations
- Dev DB endpoint + credentials per `project_dev_db_secret_pattern`
