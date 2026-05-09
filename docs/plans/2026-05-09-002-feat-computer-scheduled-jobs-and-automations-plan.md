---
title: "feat: Re-own scheduled jobs by Computer + Automations in apps/computer"
type: feat
date: 2026-05-09
sequence: 002
status: active
depth: standard
---

# feat: Re-own scheduled jobs by Computer + Automations in apps/computer

## Summary

Two coupled changes that move scheduled-job ownership from the legacy Agent surface onto the Computer surface, then surface a real Automations page in `apps/computer`.

1. **Schema + data.** Add a nullable `scheduled_jobs.computer_id` FK to `computers(id)`, mirroring the migration shape that already shipped on `threads.computer_id` (drizzle `0072`). Backfill the user's two named jobs (`d8a56ed5-c504-4c62-b3c8-2152bc6fc7a1`, `e2429872-71ee-47fb-a084-431a302e4b35`) so they belong to the Marco Computer. `agent_id` stays populated so the existing wakeup path (job-schedule-manager → AWS Scheduler → job-trigger → Strands runtime) is unchanged; `computer_id` is the new ownership/filter field.
2. **UI.** Replace the placeholder `apps/computer/src/routes/_authed/_shell/automations.tsx` with the same DataTable shape that already lives in `apps/admin/src/routes/_authed/_tenant/automations/schedules/index.tsx`: paged table (no infinite scroll), search input, "Add Job" dialog, row-click into a detail page. Scoped to `myComputer.id` from the existing `MyComputerQuery`. Full CRUD parity with admin, just filtered to the user's Computer.

This plan deliberately limits the Automations scope in `apps/computer` to **Scheduled Jobs only**. Routines, Webhooks, and Credentials stay in the admin SPA for v1; surfacing them in `apps/computer` is deferred to follow-up work.

---

## Problem Frame

Today every scheduled job's "owner" surfaces as an Agent — the admin Type column shows the Marco *agent*'s name with a `<Bot>` icon. With the v1 reframe ("Computers are the durable per-user workplace; agent rows remain the delegated-worker/runtime substrate"), the user-facing automations the user thinks of as "my Computer's jobs" can't be filtered or surfaced cleanly inside `apps/computer` because the schema has no Computer-side identity for them.

The user has two specific scheduled jobs ("Things to do with Kids" and "Austin Events") that today show as `Marco` (agent badge) in admin and are invisible to `apps/computer/automations` (which is a placeholder). The natural product story — "the Computer scheduled this for me" — needs a column to hang on, plus a UI surface to show it.

The same Computer-ownership reframe already landed for threads in drizzle `0072` (`threads.computer_id` nullable, indexed where non-null). This plan applies the same pattern one table over, plus the UI consequence.

---

## Requirements

### Schema + data ownership

- R1. `scheduled_jobs.computer_id` is added as a nullable `uuid REFERENCES public.computers(id)` column with a partial index `(tenant_id, computer_id) WHERE computer_id IS NOT NULL`. Mirrors `threads.computer_id` from drizzle `0072`.
- R2. The two named scheduled jobs (`d8a56ed5-c504-4c62-b3c8-2152bc6fc7a1`, `e2429872-71ee-47fb-a084-431a302e4b35`) have `computer_id` set to the Marco Computer row in the dev stage as part of this PR; their `agent_id` is left untouched so the existing wakeup path is unchanged.
- R3. The Drizzle schema (`packages/database-pg/src/schema/scheduled-jobs.ts`) declares `computer_id` and a `computer` relation; codegen consumers regenerate types.
- R4. Hand-rolled migration declares `-- creates-column: public.scheduled_jobs.computer_id` and `-- creates: public.idx_scheduled_jobs_computer` markers so the deploy-time drift reporter (`pnpm db:migrate-manual`) gates on it. The user applies it manually to dev via `psql` before the PR merges (per `feedback_handrolled_migrations_apply_to_dev`).

### REST + GraphQL

- R5. `GET /api/scheduled-jobs` accepts a `computer_id` query parameter that filters via `eq(scheduledJobs.computer_id, params.computer_id)`, alongside the existing `agent_id` / `routine_id` / `trigger_type` / `enabled` filters.
- R6. `POST /api/scheduled-jobs` accepts a `computer_id` field on the body and persists it. `PUT /api/scheduled-jobs/:id` does not allow re-parenting (computer_id is set at create or backfill, not in the update path) for v1.
- R7. The GraphQL `ScheduledJob` type (`packages/database-pg/graphql/types/scheduled-jobs.graphql`) gains a `computerId: ID` field. The `scheduledJobs(...)` query gains an optional `computerId: ID` filter argument. `CreateScheduledJobInput` gains `computerId: ID`.
- R8. The `terraform/schema.graphql` AppSync subscription-only schema is regenerated via `pnpm schema:build` after the GraphQL change.

### apps/computer Automations page

- R9. `apps/computer/src/routes/_authed/_shell/automations.tsx` renders the user's scheduled jobs in a paged DataTable matching the admin layout: columns `Name`, `Type`, `Schedule`, `Status`, `Last Run`, `Next Run`. **Paged**, not scrollable — the page does not introduce vertical page-scroll; the DataTable's built-in pagination shows "Page 1 of N" + page-size select.
- R10. The page filters `scheduled_jobs` by `myComputer.id` (resolved from the existing `MyComputerQuery`), via `GET /api/scheduled-jobs?computer_id=<id>`. While the Computer ID is loading, render a `PageSkeleton` equivalent.
- R11. The page has a search input that filters in-memory by `name` and `description`, plus an "Add Job" button that opens a Computer-scoped form dialog. **`trigger_type` is deliberately dropped** from the search field set: the admin search includes it, but the apps/computer Type column shows the Computer's display name (R15), not the raw `trigger_type` enum, so a user searching "Marco" or "Computer" against `trigger_type` would silently get zero results. The admin `Type` filter (Agent/Routine) is also dropped — Computer-scoped jobs are all "computer" semantically.
- R12. "Add Job" creates a scheduled job with `computer_id = myComputer.id`, `agent_id = myComputer.sourceAgent.id`, `created_by_type = "user"`, plus the standard schedule_type/expression/timezone fields. This keeps the existing wakeup path firing against the Computer's underlying agent. **If `myComputer.sourceAgent` is null** (a Computer that was never bound to a source agent), the Add Job button is disabled with a tooltip directing the user to admin — the agent-typed wakeup contract requires a non-null `agent_id`. This is the authoritative behavior; do **not** ship a fallback that posts `agent_id: null` to agent-typed triggers.
- R13. Row-click navigates to `apps/computer/src/routes/_authed/_shell/automations.$scheduledJobId.tsx`, a detail page with the same controls admin provides: enable/disable toggle, Edit (opens form dialog), Delete (confirmation), Fire Now, run history. Run history queries `GET /api/thread-turns?limit=N` filtered to `trigger_id`.
- R14. Live updates: the page subscribes to `ThreadTurnUpdatedSubscription` (already exported from `apps/computer/src/lib/graphql-queries.ts`) and refetches on delivery. Note: the existing subscription payload is `{ threadId, status, updatedAt }` — no `triggerId`. The list page accepts a tenant-wide refetch on every delivery (cheap for two rows). The detail page (U7) accepts the same trade-off rather than extending the subscription payload in this plan.

### Type column semantics

- R15. The `Type` column in `apps/computer` shows the Computer's name (badge with `<Monitor>` icon) instead of the legacy Agent name + `<Bot>` icon. Routine-typed rows continue to render as `Routine`. This is the only deliberate visual divergence from admin's table.

### Out-of-scope (deferred)

- R16. Routines, Webhooks, and Credentials are **not** ported to `apps/computer` in this plan. The sidebar `Automations` link continues to point at the single `/automations` route.

---

## Acceptance Criteria

- AC1. **Covers R1, R2.** After applying drizzle `0075` + the `0076` backfill to dev, `psql` against the dev DB returns two rows for `SELECT id, name, agent_id, computer_id FROM scheduled_jobs WHERE id IN ('d8a56ed5-c504-4c62-b3c8-2152bc6fc7a1','e2429872-71ee-47fb-a084-431a302e4b35')`, both with non-null `computer_id` matching the Marco Computer. Both rows still have non-null `agent_id`.
- AC2. **Covers R5, R7.** `curl '$API/api/scheduled-jobs?computer_id=<marco-computer-id>'` (with auth) returns those two jobs. The same call with a different computer_id returns an empty list. The graphql query `scheduledJobs(tenantId: $t, computerId: $c)` returns the same two rows.
- AC3. **Covers R9, R10, R11.** Loading `apps/computer/automations` on dev shows the user's two jobs in a paged DataTable, search filters by name as expected, and "Page 1 of 1" appears in the footer. The page has no vertical scroll outside the DataTable's internal scroll region.
- AC4. **Covers R12, R13.** Creating a new "Daily summary" reminder via the Add Job dialog persists with `computer_id = myComputer.id` and shows up in the table without a page reload. Clicking the row opens the detail page; toggling Enabled, editing, and Fire Now all work end-to-end and surface a `thread_turns` row in run history.
- AC5. **Covers R8.** `pnpm schema:build` produces a clean diff (only the new `computerId` field on `ScheduledJob` + filter arg).
- AC6. **Covers R14.** With the page open, manually firing the job in another tab causes the table's run-status indicator and Last Run column to update without a manual refresh.
- AC7. **Covers R15.** The Type column on `apps/computer/automations` renders "Marco" with a `<Monitor>` icon (Computer badge), not the legacy Bot/agent badge.

---

## Scope Boundaries

**In scope:**
- Schema + backfill + REST + GraphQL plumbing for `computer_id`.
- The `apps/computer/automations` page + detail route + form dialog + schedule picker components copied/adapted from admin.
- Regenerated codegen for affected consumers.

**Out of scope (true non-goals):**
- Re-parenting jobs that aren't already user-owned (system heartbeats, routine schedules with no Computer).
- Backfilling every existing scheduled job tenant-wide. Only the two named jobs are migrated. A broader backfill, if needed, lands as a follow-up after we observe usage.
- Removing the admin `/automations/schedules` page. Admin keeps full visibility for operators and tenant-wide jobs.
- Updating the admin Type column to render the Computer badge when `computer_id` is non-null. **Intentional divergence**: admin is the operator/tenant-wide view (Bot/Agent badge stays); apps/computer is the per-user reframe (Monitor/Computer badge). The same row legitimately carries two identities depending on audience. Re-unifying the badge across surfaces is deferred to follow-up work if the divergence becomes confusing in practice.
- Disallowing `agent_id` on new Computer-scoped jobs. It stays as the runtime hook.
- Renaming the existing `agent_*` trigger_type values (`agent_heartbeat`, `agent_reminder`, `agent_scheduled`). The semantics still mean "wake an agent runtime"; the `computer_id` column says who owns the job.

### Deferred to Follow-Up Work

- Porting Routines (`/automations/routines` + `$routineId` + executions) to `apps/computer`.
- Porting Webhooks (`/automations/webhooks` + `$webhookId`) to `apps/computer`.
- Porting Credentials (`/automations/credentials`) to `apps/computer` (likely never — credentials are tenant-infra, not user-owned).
- Extracting `ScheduledJobFormDialog` + `SchedulePicker` into a shared package (`@thinkwork/automations-ui` or similar) so admin and computer share one source. v1 ships a copy in `apps/computer`; consolidation lands once a second app needs the form (e.g., mobile).
- Tenant-wide backfill of `computer_id` for every existing scheduled job. Possible algorithm: for each row with `agent_id IS NOT NULL`, lookup `computers WHERE migrated_from_agent_id = scheduled_jobs.agent_id` and set `computer_id`. Defer until product needs the global Computer-ownership view.
- Locking down the `PUT /api/scheduled-jobs/:id` path to allow `computer_id` re-parenting (out of scope while we have only one known migration).

---

## Key Technical Decisions

- **Add a column instead of repointing `agent_id`.** Rationale: jobs need to keep firing into the Strands runtime, and the runtime is keyed off `agent_id`. Repointing `agent_id` to a different agent row would either break wakeups or require duplicating the agent row. A new `computer_id` column cleanly separates "who owns this" from "what runtime fires it" — the same separation `threads.computer_id` already enforces. (Background: `packages/database-pg/drizzle/0072_threads_computer_ownership.sql`.)
- **Add the column now rather than waiting for a forcing function.** A reviewer pointed out that filtering apps/computer by `agent_id = myComputer.sourceAgent.id` would meet the stated user pain without any schema, REST, or GraphQL work, since both backfilled jobs already have a populated `agent_id`. The decision to ship the column now anyway is deliberate: (a) matches the `threads.computer_id` precedent so the two near-identical tables don't end up with asymmetric ownership semantics, (b) the v1 enterprise-scale target (4 enterprises × 100+ agents) makes re-parenting and sourceAgent-less Computers near-term states rather than hypothetical, and (c) the dual-key bookkeeping cost (set both `computer_id` and `agent_id` on every Computer-scoped create) is small relative to the migration cost we'd take on later.
- **Hand-rolled migration with `-- creates-column:` markers.** Rationale: the v1 codebase has well-established hand-rolled migration discipline (see `feedback_handrolled_migrations_apply_to_dev`) — the deploy-time drift reporter (`pnpm db:migrate-manual`) checks for declared `creates:` markers and fails the deploy if they're missing. Following the existing pattern keeps the deploy gate honest and matches `0072`.
- **`computer_id` is set at create-time only.** Rationale: re-parenting a scheduled job from one Computer to another isn't a v1 user-flow. Restricting it now keeps the PUT handler simple. If it becomes a real ask, add it as a deliberate update path with audit logging.
- **`agent_id` stays populated on Computer-owned jobs.** Rationale: AWS Scheduler invokes `job-trigger` Lambda with a target ID; the existing path resolves it to an agent runtime. Setting `agent_id = computer.sourceAgent.id` on Computer-created jobs preserves wakeup semantics with zero runtime changes. The Computer entity does not (yet) have its own scheduler-callable target.
- **Drop the admin Type filter (`agent` / `routine`) on apps/computer.** Rationale: every scheduled job in `apps/computer/automations` is Computer-owned by definition. A filter that always shows the same thing is dead UI. If we eventually add Routines to apps/computer, reintroduce the filter then.
- **Copy `ScheduledJobFormDialog` + `SchedulePicker` from admin into `apps/computer/src/components/scheduled-jobs/`.** Rationale: the v1 Computer scaffold philosophy was "thinner versions, even if it duplicates short-term, until we know which abstractions are actually shared." The duplication is a deliberate inert-first seam: documented as deferred consolidation work. (Background: `apps/computer/src/components/ComputerSidebar.tsx` follows the same logic vs. admin's Sidebar.)
- **Computer Type-column badge uses `<Monitor>` icon + Computer name.** Rationale: in `apps/computer`, the user-mental-model owner is the Computer. Showing "Marco" with a `<Bot>` icon there would re-leak the legacy agent surface into a Computer-first product UI.

---

## High-Level Technical Design

```mermaid
flowchart TD
  A[apps/computer<br/>/automations] -->|MyComputerQuery| B[urql cache]
  A -->|GET /api/scheduled-jobs?computer_id=...| C[graphql-http Lambda<br/>scheduled-jobs handler]
  C -->|drizzle: where computer_id = ?| D[(scheduled_jobs)]
  A -->|POST /api/scheduled-jobs<br/>{computer_id, agent_id: sourceAgent.id, ...}| C
  C --> E[job-schedule-manager Lambda]
  E -->|create EventBridge schedule| F[AWS Scheduler]
  F -->|rate firing| G[job-trigger Lambda]
  G -->|wake agent_id| H[Strands runtime / Computer ECS]
  H --> I[(thread_turns rows)]
  A -->|ThreadTurnUpdatedSubscription| I
```

This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.

The seam is intentional: `computer_id` is purely an ownership/filter dimension. The wakeup path stays keyed off `agent_id`. If we later move runtime targeting to Computer (e.g., job-trigger fans out via `computer_tasks`), that's a separate plan.

---

## Implementation Units

### U1. Drizzle migration: scheduled_jobs.computer_id

**Goal:** Add nullable `computer_id` FK to `scheduled_jobs` with partial index, mirroring drizzle `0072`'s shape.

**Requirements:** R1, R3, R4.

**Dependencies:** none.

**Files:**
- Create: `packages/database-pg/drizzle/0075_scheduled_jobs_computer_ownership.sql`
- Create: `packages/database-pg/drizzle/0075_scheduled_jobs_computer_ownership_rollback.sql`
- Modify: `packages/database-pg/src/schema/scheduled-jobs.ts` (add column + index + relation)

**Approach:**
- The forward SQL adds `computer_id uuid REFERENCES public.computers(id)` and `CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_computer ON public.scheduled_jobs (tenant_id, computer_id) WHERE computer_id IS NOT NULL`.
- Header carries `-- creates-column: public.scheduled_jobs.computer_id` and `-- creates: public.idx_scheduled_jobs_computer` so `pnpm db:migrate-manual` gates the deploy.
- Use `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s'; ... COMMIT;` matching `0072`'s envelope.
- Drizzle schema adds `computer_id: uuid("computer_id").references(() => computers.id)`, an `index("idx_scheduled_jobs_computer")` declaration, and a `computer` relation.
- The migration is **not** registered in `meta/_journal.json` (matching `0072`'s hand-rolled posture). The PR author applies it via `psql` to dev before merge.

**Patterns to follow:**
- `packages/database-pg/drizzle/0072_threads_computer_ownership.sql` and `0072_threads_computer_ownership_rollback.sql` — exact envelope, marker format, partial-index shape.
- `packages/database-pg/src/schema/threads.ts` for the schema-side declaration shape (column, partial index using `where`, relation).

**Test scenarios:** `Test expectation: none -- migration + schema declaration is config-only; behavior is exercised by U2 (backfill verification) and U3 (handler tests).`

**Verification:**
- `psql -f packages/database-pg/drizzle/0075_scheduled_jobs_computer_ownership.sql` against dev applies cleanly.
- `pnpm --filter @thinkwork/database-pg build` succeeds with the new column referenced.
- `\d scheduled_jobs` shows the new column + index.
- `pnpm db:migrate-manual` reports the `creates-column` and `creates` declarations as present.

### U2. Backfill the two named jobs to Marco Computer

**Goal:** Set `computer_id` on the two specified scheduled-job UUIDs to the Marco Computer row in dev.

**Requirements:** R2.

**Dependencies:** U1.

**Files:**
- Create: `packages/database-pg/drizzle/0076_scheduled_jobs_marco_backfill.sql` (idempotent, hand-rolled, separate from `0075` so the schema migration and the data backfill are independently rerunnable).

Before creating the file, confirm `0076` is unclaimed: `ls packages/database-pg/drizzle/ | grep ^0076` should return nothing. If a parallel branch has taken the slot, increment to the next free number and update the file references in this unit.

**Approach:**
- The script accepts the target Computer UUID via a psql variable (`:'computer_id'`). Resolving the Marco Computer is done by the operator before applying — `psql -c "SELECT id FROM computers WHERE owner_user_id = (SELECT id FROM users WHERE email = $OWNER_EMAIL) AND status = 'active' LIMIT 1"` — and the resolved UUID is then passed to the script: `psql -v computer_id=<uuid> -f packages/database-pg/drizzle/0076_scheduled_jobs_marco_backfill.sql`. The owner email **never** lives in the committed SQL file.
- The script asserts non-empty input and stage safety up front:
  - Fail fast if `:'computer_id'` is empty or unset.
  - Fail fast if the resolved Computer doesn't exist: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM computers WHERE id = :'computer_id') THEN RAISE EXCEPTION 'Marco Computer not found — wrong stage or wrong UUID'; END IF; END $$;`. This prevents the script from silently no-op'ing on staging or prod (which won't have that Computer row) and from corrupting data if a stale UUID is passed.
- `UPDATE scheduled_jobs SET computer_id = :'computer_id' WHERE id IN ('d8a56ed5-c504-4c62-b3c8-2152bc6fc7a1','e2429872-71ee-47fb-a084-431a302e4b35') AND tenant_id = (SELECT tenant_id FROM computers WHERE id = :'computer_id')` — joins the tenant from the Computer row so the operator only passes one variable.
- Wrap in `BEGIN/COMMIT` with `lock_timeout` + `statement_timeout`.
- Header marker: `-- backfill: scheduled_jobs.computer_id for known marco jobs (dev-only by stage guard)` (no `creates:` marker — this is data, not schema).
- The script is idempotent (`UPDATE` with already-set `computer_id` is a no-op for these two specific IDs).

**Patterns to follow:**
- `packages/api/src/__smoke__/flue-marco-smoke.ts` for how Marco is identified in dev fixtures (Eric Odom is Marco's USER.md author per the file header).

**Test scenarios:**
- Verify by running the resolver subselect alone against dev to confirm exactly one Computer row matches the owner.
- After applying: `SELECT id, agent_id, computer_id FROM scheduled_jobs WHERE id IN ('d8a56ed5...','e2429872...')` returns two rows, both with non-null `computer_id` and unchanged `agent_id`.
- Re-running the script is a no-op (rowcount = 2 each time, same `computer_id`).

**Verification:**
- The two `SELECT` outputs above match expectations.
- Pre-merge: the implementer captures the verification `SELECT` output and pastes it into the PR description.

### U3. REST handler: ?computer_id= filter + body field

**Goal:** Teach `packages/api/src/handlers/scheduled-jobs.ts` to filter by `computer_id` on GET and persist it on POST.

**Requirements:** R5, R6.

**Dependencies:** U1.

**Files:**
- Modify: `packages/api/src/handlers/scheduled-jobs.ts`
- Create: `packages/api/src/handlers/__tests__/scheduled-jobs-computer-filter.test.ts` (or extend an existing test file if one exists for this handler)

**Approach:**
- In `listScheduledJobs`, append `if (params.computer_id) conditions.push(eq(scheduledJobs.computer_id, params.computer_id));` next to the existing `agent_id` / `routine_id` clauses. The `tenant_id` clause stays first, so a foreign-tenant `computer_id` query argument intersects to an empty result.
- In `createScheduledJob`, accept `computer_id` from the body. Before persisting it, **validate that the Computer belongs to the caller's tenant**: `SELECT tenant_id FROM computers WHERE id = body.computer_id` and reject (400) if the row is missing or its `tenant_id` doesn't match `check.tenantId`. Without this check, a tenant admin could create a scheduled job that references a foreign-tenant Computer UUID — the `tenant_id` filter on later GETs would scope it to their own tenant, but the FK row in `computers` belongs to someone else.
- `updateScheduledJob` does **not** accept `computer_id` for v1 (deliberate omission per the Key Technical Decisions section). Add a brief code comment noting it's intentionally read-only on update.

**Patterns to follow:**
- The existing `agent_id` filter clause (`packages/api/src/handlers/scheduled-jobs.ts:260`).
- `apps/admin/src/routes/_authed/_tenant/automations/schedules/index.tsx`'s caller pattern (the `apiFetch<ScheduledJobRow[]>("/api/scheduled-jobs?...")` shape).

**Test scenarios:**
- Happy path: GET with `?computer_id=<id>` returns only rows matching that computer_id within the tenant.
- Empty: GET with `?computer_id=<unknown-uuid>` returns `[]`.
- Cross-filter: GET with `?computer_id=<id>&trigger_type=agent_heartbeat` correctly intersects.
- Tenant scoping: a job with matching `computer_id` but a different tenant_id is excluded (`x-tenant-id` header drives `check.tenantId`).
- Create: POST with `computer_id` in the body persists and the resulting row has the column populated.
- Create: POST without `computer_id` persists with `computer_id = null` (unchanged behavior).
- **Cross-tenant create rejected**: POST with a `computer_id` whose `computers.tenant_id` does not match the caller's tenant returns 400 with a clear error and inserts no row.
- Update: PUT with `computer_id` in the body silently ignores it (the field is not in the `updates` object); existing fields update normally.

**Verification:**
- `pnpm --filter @thinkwork/api test src/handlers/__tests__/scheduled-jobs-computer-filter.test.ts` is green.
- Manual `curl` against dev with the auth bearer returns the two backfilled jobs when `computer_id` matches Marco Computer.

### U4. GraphQL contract: computerId field + filter argument

**Goal:** Reflect the new column on the GraphQL surface so consumers (admin, computer, mobile) can read/filter it.

**Requirements:** R7, R8.

**Dependencies:** U1.

**Files:**
- Modify: `packages/database-pg/graphql/types/scheduled-jobs.graphql`
- Modify: `packages/api/src/graphql/resolvers/...` — update the `scheduledJobs` query resolver and the `ScheduledJob` type resolver (whichever file owns them; locate via `grep -rn "scheduledJobs" packages/api/src/graphql/resolvers`)
- Modify: `terraform/schema.graphql` (regenerated via `pnpm schema:build`)
- Modify: any codegen consumer — `apps/cli`, `apps/admin`, `apps/mobile`, `packages/api` — run `pnpm --filter @thinkwork/<name> codegen` for each. Per `CLAUDE.md`, codegen is required after GraphQL changes. **Note:** `apps/computer` deliberately skips the codegen pipeline in Phase 1 (see comment at the top of `apps/computer/src/lib/graphql-queries.ts`); its GraphQL operations remain plain `gql\`\`` literals. The `MyComputerQuery` extension in U6 is therefore a hand-edit, not a generated step.

**Approach:**
- Add `computerId: ID` to `type ScheduledJob` and `input CreateScheduledJobInput`.
- Add `computerId: ID` argument to the `scheduledJobs(...)` query.
- The resolver maps `args.computerId` to the same drizzle filter the REST handler uses.
- `pnpm schema:build` regenerates `terraform/schema.graphql`; commit the diff.
- Run codegen across consumers; commit the regenerated `*.generated.ts` files.

**Patterns to follow:**
- Existing `agentId: ID` filter on the same query — add `computerId` symmetrically.
- The `Computer.sourceAgent` resolver (`packages/api/src/graphql/resolvers/computers/types.ts`) for the standard parent.snake → camel mapping pattern.

**Test scenarios:**
- Snapshot test (or hand-asserted): the GraphQL schema after build contains exactly the four additions (one type field, one input field, one query arg, regenerated AppSync schema).
- Resolver test: querying `scheduledJobs(tenantId, computerId)` on a fixture DB with two matching rows returns both with non-null `computerId`.
- Resolver test: omitting `computerId` returns all tenant rows (backward-compat).
- Resolver test: querying `scheduledJobs(tenantId, computerId)` where `computerId` belongs to a foreign tenant returns an empty result (intersection with `tenant_id` filter).
- Codegen sanity: each consumer's regenerated `*.generated.ts` (admin/cli/mobile/api — `apps/computer` is excluded by Phase 1 posture) contains the new field; `pnpm typecheck` passes across the monorepo.

**Verification:**
- `pnpm schema:build` produces a clean diff (only the additive changes above).
- `pnpm -r --if-present typecheck` is green after codegen.
- `pnpm --filter @thinkwork/api test` is green for resolver tests.

### U5. Copy ScheduledJobFormDialog + SchedulePicker into apps/computer

**Goal:** Make the admin form dialog reusable from `apps/computer` without taking a runtime dependency on the admin SPA.

**Requirements:** R12, R13 (form-side).

**Dependencies:** U3 (form posts the new field).

**Files:**
- Create: `apps/computer/src/components/scheduled-jobs/ScheduledJobFormDialog.tsx` (copy of admin's, imports normalized to `@thinkwork/ui`)
- Create: `apps/computer/src/components/schedule-picker/SchedulePicker.tsx` (copy of admin's `apps/admin/src/components/schedule-picker/SchedulePicker.tsx`)
- Modify: `apps/computer/src/lib/api-fetch.ts` only if a tenant-header passthrough isn't already present (verify with `grep -n extraHeaders apps/computer/src/lib/api-fetch.ts`)

**Approach:**
- File-copy the two components, then sweep imports: `@/components/ui/*` → `@thinkwork/ui`. Remove any admin-specific dependencies (e.g., admin's `BreadcrumbContext`).
- This is **not just an import sweep** — three behavioral edits are required to drop the agent-picker UX:
  1. Drop `agentId` from the Zod schema. The new schema is `z.object({ name: z.string().min(1, 'Name is required'), prompt: z.string().optional() })`.
  2. Remove the agent `<Select>` `FormField` block from the dialog's JSX (and the `agents` `useState` + `useEffect(() => apiFetch('/api/agents'))` that backs it). Agents are pre-resolved by the parent route.
  3. Add `computerId: string` and `agentId: string | null` props on the dialog. `handleFormSubmit` merges both into the body before invoking `onSubmit`: `onSubmit({ ...values, agent_id: agentId, computer_id: computerId, ... })`. The seam is "form merges props into body before `onSubmit`," not "parent merges after `onSubmit`."
- Extend `ScheduledJobFormData` (the exported interface that `onSubmit` receives) to include `agent_id?: string | null` and `computer_id?: string | null`. Admin already has `agent_id` populated by its select; the new fields are additive.
- The form submits via the apps/computer `apiFetch` helper with an `x-tenant-id` extra header (matches admin's pattern in `apps/admin/src/lib/api-fetch.ts`).
- Document in a top-of-file comment that this is a deliberate copy of the admin component pending a shared package extraction (link the Deferred to Follow-Up Work item). Include a concise diff-stat note ("agent picker removed; agentId/computerId injected via props") so the divergence stays auditable.

**Patterns to follow:**
- `apps/computer/src/components/ComputerSidebar.tsx` for the "thinner copy of admin" precedent and the `@thinkwork/ui` import shape.
- `apps/admin/src/lib/api-fetch.ts` for the `extraHeaders` passthrough used to forward `x-tenant-id`.

**Test scenarios:** `Test expectation: none -- this unit is a copy + import sweep with no behavior change. Behavior is exercised by U6 (route integration test).`

**Verification:**
- `pnpm --filter @thinkwork/computer typecheck` passes.
- The dialog renders in isolation via Storybook or a smoke render in vitest if either is already wired (otherwise rely on U6's integration coverage).

### U6. apps/computer/automations route + DataTable

**Goal:** Replace the placeholder route with the full Automations page.

**Requirements:** R9, R10, R11, R12, R14, R15.

**Dependencies:** U3, U4, U5.

**Files:**
- Modify: `apps/computer/src/routes/_authed/_shell/automations.tsx`
- Create: `apps/computer/src/routes/_authed/_shell/automations.tsx.test.tsx` (vitest + Testing Library — match existing apps/computer test patterns; check `apps/computer/src/components/computer/ComputerWorkbench.test.tsx` for the local shape)
- Modify: `apps/computer/src/lib/graphql-queries.ts` — extend `MyComputerQuery` to select `sourceAgent { id name }`. The existing `ThreadTurnUpdatedSubscription` (already exported there) is the live-update query — do not add a second copy under a different name.
- Create: `apps/computer/src/components/PageHeader.tsx` and `apps/computer/src/components/PageSkeleton.tsx` — minimal local primitives matching admin's API surface (title + description + actions slot for PageHeader; full-bleed muted-bar shimmer for PageSkeleton). One-consumer-now is acceptable: this page is long-lived and the detail route in U7 will re-use both immediately, giving us the second consumer.

**Approach:**
- Resolve `myComputer.id` via `useQuery(MyComputerQuery)`. While `null`, render `<PageSkeleton />` (created in U6's Files list).
- Fetch all Computer-scoped jobs in a single call: `apiFetch<ScheduledJobRow[]>("/api/scheduled-jobs?computer_id=" + computerId, { extraHeaders: { "x-tenant-id": tenantId } })` — no `limit`/`offset` parameters. Pagination is client-side within the DataTable over the full result set, so the in-memory search filter (R11) covers every row. The expected job count per Computer is small enough that fetching all rows is appropriate for v1; revisit only if a Computer accumulates >100 scheduled jobs.
- Use `@thinkwork/ui`'s `DataTable` with the same columns as admin (Name, Type, Schedule, Status, Last Run, Next Run). Render the Type column with the Computer name + `<Monitor>` icon. (Routine-typed rows are not reachable in v1 — Routines aren't in scope per Out-of-scope — so the Routine branch in `ownerLabel` is forward-compat scaffolding only; ship it without a fixture.) Co-locate the pure helpers (`formatSchedule`, `estimateNextRun`, `JOB_TYPE_LABELS`) next to the route as `apps/computer/src/routes/_authed/_shell/-automations.utils.ts` (the leading `-` keeps TanStack Router from treating it as a route). `relativeTime` already exists somewhere shared — re-use the existing import rather than duplicating it.
- DataTable runs **paged**, not `scrollable`. The `@thinkwork/ui` DataTable enables client-side pagination automatically when `pageSize > 0` (default 10) and renders the `Rows per page` selector + `Page X of Y` + prev/next/first/last controls via `DataTablePagination`. Pass `pageSize={10}` explicitly and **do not** set `scrollable` or `totalCount` (server-side pagination mode is for total-count-driven flows we don't need here). Confirmed against `packages/ui/src/components/ui/data-table.tsx`.
- "Add Job" button mounts the copied `ScheduledJobFormDialog` with `computerId={myComputer.id}` and `agentId={myComputer.sourceAgent.id}`. **The button is disabled (with tooltip) when `myComputer.sourceAgent` is null** — see R12. Once disabled, the dialog cannot be opened.
- Subscribe to `ThreadTurnUpdatedSubscription` and refetch on delivery, mirroring admin's `apps/admin/src/routes/_authed/_tenant/automations/schedules/index.tsx`. Note the existing subscription payload has no `triggerId`, so refetches are tenant-wide on every delivery — acceptable for the small computer-scoped row count.
- **Empty state**: when the API returns zero rows, the DataTable's built-in "No results." cell is the fallback — but for the *initial* empty state (a fresh Computer with no jobs created yet), render an above-table empty-state block with copy "No automations yet" + secondary "Scheduled jobs created from this Computer will appear here" + an inline "Add Job" CTA (mirrors `ComputerSidebar`'s "No threads yet — click New" precedent). When the search box has a value but filtered rows are empty, fall back to the DataTable's "No results." (different state, different copy is intentional).
- Row click navigates to the detail route (U7).

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/automations/schedules/index.tsx` for column definitions, search/filter wiring, and subscription refetch.
- `apps/computer/src/components/ComputerSidebar.tsx` for `MyComputerQuery` consumption.
- `packages/ui/src/components/ui/data-table.tsx` for DataTable props (search via `filterValue`/`filterColumn`, pagination configuration).

**Test scenarios:**
- **Covers AC3.** Render the page with a mocked `myComputer.id` and an `apiFetch` mock returning two rows. Assert: table shows two rows, "Page 1 of 1" appears, no vertical-scroll wrapper outside the DataTable.
- Search input filters rows: typing "Austin" leaves one row visible.
- "Add Job" button opens the dialog (assert dialog title/visibility).
- Empty-state: zero rows from API renders an empty-state message (not a crash).
- Loading state: while `myComputer` is null, the skeleton renders (no API call fires).
- API error: `apiFetch` rejection renders a destructive error message in the header (matches admin's behavior).
- **Covers AC6.** Subscription delivers `onThreadTurnUpdated`; the test asserts `apiFetch` was called twice (initial + refetch).
- **Covers AC7.** Type column for an agent-typed row renders `<Monitor>` icon + Computer name (not `<Bot>` + agent name).

**Verification:**
- `pnpm --filter @thinkwork/computer test src/routes/_authed/_shell/automations.tsx.test.tsx` is green.
- `pnpm --filter @thinkwork/computer dev` against dev shows the user's two backfilled jobs in the paged table.
- Visual: open `http://localhost:5180/automations`, confirm no page-level vertical scroll, paged controls visible at the bottom.

### U7. apps/computer/automations.$scheduledJobId detail route

**Goal:** Per-job detail page with enable toggle, Edit, Delete, Fire Now, run history.

**Requirements:** R13.

**Dependencies:** U5, U6.

**Files:**
- Create: `apps/computer/src/routes/_authed/_shell/automations.$scheduledJobId.tsx`
- Create: `apps/computer/src/routes/_authed/_shell/automations.$scheduledJobId.test.tsx`

**Approach:**
- Mirror admin's `apps/admin/src/routes/_authed/_tenant/automations/schedules/$scheduledJobId.tsx` shape, normalized to `@thinkwork/ui` and using apps/computer's `apiFetch`.
- Drop admin's `useBreadcrumbs(...)` calls — apps/computer doesn't have BreadcrumbContext yet; instead render a simple "← Automations" back link in the header.
- The Edit button mounts the copied `ScheduledJobFormDialog` in `mode="edit"` with the job pre-populated.
- Delete shows an `AlertDialog` (from `@thinkwork/ui`) with confirm; on confirm, call `DELETE /api/scheduled-jobs/:id` and `navigate({ to: "/automations" })`.
- "Fire Now" calls `POST /api/scheduled-jobs/:id/fire` and toasts success/failure (use `sonner` from `@thinkwork/ui`). After the toast, the page does **not** call a `setTimeout` refetch hack — the next run row arrives via `ThreadTurnUpdatedSubscription` (subscription-driven, not timer-driven).
- Run history queries `GET /api/thread-turns?limit=50&trigger_id=:id` and renders a list with status badges + relative time. The REST query parameter is `trigger_id` (snake_case) per the existing handler convention; this is unrelated to the GraphQL `triggerId` camelCase field.
- Two-tier error rendering: if the job-detail fetch fails, render a full-page error with a back link (the job-not-found case). If only the runs fetch fails, the job header renders normally and the run-history section shows an inline error with a "Retry" button — don't collapse the whole page on a partial failure.
- Subscribe to `ThreadTurnUpdatedSubscription` so live runs update the history. Because the subscription payload lacks `triggerId`, every delivery triggers a runs-list refetch — acceptable for the small per-trigger run count.

**Patterns to follow:**
- `apps/admin/src/routes/_authed/_tenant/automations/schedules/$scheduledJobId.tsx` for layout + handlers.
- `apps/computer/src/routes/_authed/_shell/tasks.$id.tsx` for an existing apps/computer detail-route shape.

**Test scenarios:**
- Happy path: page loads, shows job name, schedule expression, status badge.
- Toggle Enabled flips the badge and calls `PUT /api/scheduled-jobs/:id` with `{ enabled: !current }`.
- Edit opens the form pre-filled with the current values; submitting triggers `PUT` and refetch.
- Delete confirmation: clicking "Cancel" closes the dialog; clicking "Delete" triggers the API call and navigation.
- Fire Now: button click triggers `POST /:id/fire`, toast appears, run history gets a new row when subscription delivers.
- 404: navigating to a nonexistent ID renders a full-page error with a back link.
- Partial failure: job-detail fetch succeeds but the runs fetch errors — the job header renders, the run-history section shows an inline error with a Retry button. The toggle/Edit/Delete/Fire-Now controls remain enabled.
- Subscription refetch: any `thread_turn` update delivered while the page is open triggers a runs refetch (the subscription payload doesn't carry `triggerId`, so this is a tenant-wide signal, accepted as cheap).

**Verification:**
- `pnpm --filter @thinkwork/computer test` is green for the detail-route test file.
- Manual: full CRUD round-trip on dev for one of the backfilled jobs.

---

## Accepted Debt

- **`x-tenant-id` is a client-supplied header.** The new endpoints (GET filter, POST body field) inherit the existing trust posture: `apiFetch` forwards `x-tenant-id` from the SPA, and `requireTenantMembership` on the server validates that the Cognito caller is actually a member of the named tenant. The tenant identity itself is still client-driven rather than derived from the JWT `sub` claim. Both `apps/computer/src/lib/api-fetch.ts` and `apps/admin/src/lib/api-fetch.ts` flag this with a TODO pointing at "PR B" — the future change that will derive `tenantId` from the JWT and drop the passthrough. This plan intentionally inherits that posture rather than fixing it locally; deferring to PR B keeps the auth migration coherent across handlers instead of fragmenting it. The new `computer_id` POST body field gets server-side tenant validation in U3, which closes the most material gap (cross-tenant FK reference) regardless of how `tenantId` is sourced.

---

## System-Wide Impact

- **`scheduled_jobs` table.** New column. All existing rows have `computer_id = NULL`. Admin's `/automations/schedules` keeps working unchanged because it doesn't filter on `computer_id`. Future tenant-wide backfill is deferred.
- **GraphQL schema.** Additive only (new optional field + filter arg). AppSync subscription schema regenerated.
- **Codegen consumers.** `apps/cli`, `apps/admin`, `apps/mobile`, `apps/computer`, `packages/api` all need a `pnpm --filter <name> codegen` after the GraphQL change.
- **Wakeup path.** Unchanged. AWS Scheduler still fires `job-trigger` Lambda against `agent_id`, which still wakes the Strands runtime for that agent. The Computer is just an additional ownership label.
- **Admin SPA.** No required changes. Admin's Type column continues to show the Agent name + Bot icon for agent-typed rows. (Optional follow-up: admin could surface `computerId` next to `agentId` on the detail page; not in scope here.)
- **`pnpm db:migrate-manual`.** The deploy gate now expects the new `creates-column` and `creates` markers from `0075`. Missing-marker failures during deploy mean the migration wasn't applied to dev — exactly the desired behavior.

---

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Migration applied without `meta/_journal.json` registration drifts undetected | Low | Medium | The `creates:` markers + `pnpm db:migrate-manual` deploy gate catches a missing apply. Same envelope as `0072` — pattern is proven. |
| Backfill picks the wrong Computer row in dev (e.g., archived clone) | Low | Low (reversible) | The backfill subselect filters `status = 'active'` and `LIMIT 1`. The implementer pastes the verification `SELECT` into the PR description before merge. Backfill is a `UPDATE` of two specific UUIDs — easy to reverse. |
| Admin form dialog imports diverge between admin and the copy in apps/computer | Medium | Low | Documented as Deferred to Follow-Up Work (extract into a shared package). Until then, both copies are touched together when the form changes. Add a top-of-file comment in both files cross-referencing each other. |
| `agent_id = sourceAgent.id` is null for some Computers | Low | Medium | If `sourceAgent` is null, the create call sends `agent_id: null`. For agent-typed triggers, the schedule-manager Lambda will fail to provision an EventBridge target. Detect this in the form: if `myComputer.sourceAgent === null`, disable the "Add Job" button with a tooltip "This Computer has no source agent yet — use admin to create the schedule." |
| Codegen drift across the five consumers | Medium | Low | `pnpm typecheck` at repo root catches it. The PR includes the regenerated files in the diff. |
| Two paged tables (admin + computer) drift in column order or formatting | Low | Low | Implementation pulls the helper functions (`formatSchedule`, `estimateNextRun`) into a shared lib file so the format logic stays singular even if the table layouts diverge. |

---

## Verification

After all units land and the migration (`0075`) + backfill (`0076`) are applied to dev:

1. `psql` against dev confirms the two named jobs have non-null `computer_id` matching the Marco Computer (AC1).
2. `curl` with the auth bearer hits `/api/scheduled-jobs?computer_id=<marco>` and returns those two jobs (AC2).
3. `pnpm --filter @thinkwork/computer dev` shows the table at `/automations` with the two jobs, paged controls visible, no vertical page scroll (AC3).
4. End-to-end: create a new job through the dialog, see it appear in the table, open it, toggle disabled, fire now, see a `thread_turns` row (AC4, AC6).
5. The Type column renders "Marco" with the Monitor icon (AC7).
6. `pnpm schema:build` produces only the additive diff (AC5).
7. `pnpm -r --if-present test typecheck lint` green at repo root.

---

## Deferred Implementation Notes

- The exact filename of the existing `scheduledJobs` resolver in `packages/api/src/graphql/resolvers/` is unknown until grep'd — U4's file list is intentionally a glob (`grep -rn "scheduledJobs" packages/api/src/graphql/resolvers` will resolve it).
- The Computer's display name is read from `myComputer.name` (already in `MyComputerQuery`) at the route level and closed over in the column definition — the column receives a job row, not the Computer. If the name is missing for any reason, fall back to "Computer" so the badge still renders.
- `Computer.sourceAgent` already resolves on the GraphQL surface (`packages/api/src/graphql/resolvers/computers/types.ts`) — only the apps/computer `MyComputerQuery` selection needs to be extended to include it. This is captured as a U6 file modification.
