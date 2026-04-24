---
title: Thread Detail Pre-Launch Cleanup
type: refactor
status: active
date: 2026-04-24
deepened: 2026-04-24
origin: docs/brainstorms/2026-04-24-thread-detail-cleanup-requirements.md
---

# Thread Detail Pre-Launch Cleanup

## Overview

Strip task-era carryover from the Thread domain across admin, mobile, CLI, GraphQL, and Drizzle schema: remove Comments, Sub-tasks, Attachments, Artifacts, Priority, Type; replace the manual `Status` field with a read-only derived lifecycle badge; surface the existing `threads.channel` field as "Trigger" on the detail page; and make the Traces section conditional on an empirical X-Ray deeplink check. The work is intentionally breaking (no `@deprecated`-first phase), since the target fields are either unused, half-wired, or actively misrepresenting what Thinkwork does under the enterprise control-plane posture.

---

## Problem Frame

The Thread detail screen (`apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`) was built when a thread was a task. Thinkwork has pivoted to enterprise control-plane, but the UI still ships:

- A Comments composer that has a backend but no operator workflow.
- A Sub-tasks section whose create path isn't reachable from the detail page.
- An Attachments section on the admin right rail whose upload handler literally throws `"Attachment upload is not yet implemented"` — the schema + GraphQL stay (attachments is a planned inbound feature for users sending photos/files to an agent), but the admin operator-side exposure is premature and misleading.
- An Artifacts section backed by a GraphQL type (`MessageArtifact`) that no resolver populates.
- Status / Priority / Type dropdowns whose enum values (`TASK | BUG | FEATURE | QUESTION`) describe Jira tickets.

Each of these undermines the "audit surface for an agent run" positioning. The cleanup must drop the dead surfaces, reshape the remaining right-rail to real operator signal, and keep admin, mobile, CLI, and GraphQL consistent after the breaking schema changes (see origin: `docs/brainstorms/2026-04-24-thread-detail-cleanup-requirements.md`).

---

## Requirements Trace

- R1. Remove Comments UI + `thread_comments` table + GraphQL types + `AddThreadCommentMutation` + `thread.comments` field. (origin R1)
- R2. Remove Sub-tasks UI + `threads.parent_id` column + `parent`/`children` GraphQL fields + `ThreadFormDialog` subtask affordance. (origin R2)
- R3. Remove the **admin** Attachments section + the stubbed "Upload attachment" UI on the thread detail page. **KEEP `thread_attachments` table, `ThreadAttachment` GraphQL type, and `thread.attachments` field** — reserved for the upcoming photos/files-to-agent feature (users attaching files when kicking off or continuing a thread). The admin right rail stops exposing it (operator doesn't need to see inbound user files), but the data model stays intact and ready for the future mobile/prompt-side feature. (origin R3, **narrowed** — reversed from the brainstorm's "remove entirely" based on user clarification 2026-04-24: attachments is an upcoming inbound feature, not dead surface.)
- R4. Remove Artifacts UI + `MessageArtifact` + `message.artifacts` + `message.durableArtifact`. (origin R4)
- R5. Drop `threads.priority` column + `ThreadPriority` enum + UI. (origin R5)
- R6. Drop `threads.type` column + `ThreadType` enum + UI. (origin R6)
- R7. Replace the manual Status dropdown with a derived lifecycle badge. v1 enum = `RUNNING | COMPLETED | CANCELLED | FAILED | IDLE` (`AWAITING_USER` deferred to v2 pending a real signal source; `CANCELLED` kept distinct from `FAILED` because user-initiated stops are triaged differently from system failures). (origin R7, refined)
- R8. Drop `threads.status` column + task-era `ThreadStatus` enum; introduce `ThreadLifecycleStatus` (derived at resolver time) in its place. (origin R8)
- R9. Update the Threads list view + KanbanBoard + localStorage view state so nothing references removed filter fields. (origin R9)
- R10. Right rail after cleanup shows: derived Status badge, Agent (link), Trigger (from `threads.channel`), Created, Last turn, Turn + cost summary, and — conditional on R12 — an "Open in X-Ray" link. (origin R10)
- R11. Empirically verify the X-Ray deeplink opens a real trace before deciding Traces' fate. Driven by a reusable verification script. (origin R11)
- R12. If R11 passes: keep `ThreadTraces` collapsed, add an "Open in X-Ray" link. If R11 fails: remove `ThreadTraces` component, `ThreadTracesQuery`, and the `TraceEvent` surface on this page. (origin R12)
- R13. Regenerate codegen across `apps/admin`, `apps/mobile`, `apps/cli` (packages/api has no codegen script). Sweep mobile + CLI consumers of removed types. (origin R13)
- R14. Author hand-rolled Drizzle migrations for the drops with `-- creates:` markers, pre-flight `to_regclass` guards, and the "apply to dev before merging, paste `\d+` into the PR" discipline. (origin R14)

**Origin actors:** A1 (Enterprise operator, admin SPA), A2 (Agent runtime), A3 (Downstream implementer)

---

## Scope Boundaries

- Not redesigning `ExecutionTrace` — turns, tokens, cost, tool-call rendering stay as-is.
- Not building an operator-notes replacement for Comments.
- Not building the agent-workspace-files successor for Artifacts here (separate brainstorm `docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md`).
- Not migrating existing `parent_id` / `status` / `priority` / `type` / `thread_comments` row data forward — destructive drops, data loss accepted.
- Not dropping `thread_attachments`, `ThreadAttachment`, or `thread.attachments` — reserved for the upcoming photos/files-to-agent inbound feature. Only the admin-side UI exposure is removed.
- Not touching the Inbox route unless it references removed fields.
- Not introducing `@deprecated`-first deprecation windows — hard cut.
- Not extracting a shared "thread lifecycle helper" package (see `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`).

### Deferred to Follow-Up Work

- AgentCore Strands container refresh, if the X-Ray trace ID shape changes are needed upstream: out of scope for this plan, separate PR to `packages/agentcore-strands/agent-container/`.
- Re-evaluating whether `ThreadChannel` should drop `EMAIL` or `API` from its enum: product-facing, a separate scope call once this cleanup lands.
- Extending `packages/api/src/handlers/crons/stall-monitor.ts` to sweep stuck `queued` turns → `timed_out` (today it only sweeps stuck `running`). U4's freshness window prevents the UI from latching on stuck `queued` rows, but the underlying stuck row is still in the DB until the stall-monitor handles it.

---

## Context & Research

### Relevant Code and Patterns

- Schema: `packages/database-pg/src/schema/threads.ts`, `packages/database-pg/src/schema/cost-events.ts`
- GraphQL types: `packages/database-pg/graphql/types/threads.graphql`, `packages/database-pg/graphql/types/messages.graphql`, `packages/database-pg/graphql/types/observability.graphql`
- Resolvers to gut/edit: `packages/api/src/graphql/resolvers/threads/{index,types,loaders,thread.query,threadsPaged.query,updateThread.mutation,createThread.mutation,addThreadComment.mutation,updateThreadComment.mutation,deleteThreadComment.mutation,escalateThread.mutation,delegateThread.mutation}.ts`; `packages/api/src/graphql/resolvers/messages/messages.query.ts`; `packages/api/src/graphql/resolvers/observability/threadTraces.query.ts`
- Admin surfaces: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (right rail, `ThreadProperties`), `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (list + filters + localStorage), `apps/admin/src/components/threads/{ExecutionTrace,ThreadTraces,CreateThreadDialog,KanbanBoard,IssueProperties}.tsx`, `apps/admin/src/components/StatusBadge.tsx`, `apps/admin/src/components/threads/StatusIcon.tsx`, `apps/admin/src/components/threads/LiveRunWidget.tsx` (reads `useActiveTurnsStore`)
- Admin queries: `apps/admin/src/lib/graphql-queries.ts` (lines 389, 423, 460, 551, 1357, 1725)
- Mobile: `apps/mobile/lib/graphql-queries.ts` (lines 689, 742, 830, 836, 842); `apps/mobile/app/thread/[threadId]/{index,info}.tsx`; `apps/mobile/app/threads/[id]/index.tsx`; `apps/mobile/app/threads/index.tsx`
- CLI: `apps/cli/src/commands/thread.ts`
- Migration templates: `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` (drop + pre-flight DO-block), `packages/database-pg/drizzle/0023_tenants_deactivation.sql` (marker syntax)
- Migration tooling: `scripts/db-migrate-manual.sh`, `scripts/schema-build.sh`
- Existing trigger-source plumbing: `threads.channel` populated in `packages/lambda/job-trigger.ts:268`, `packages/api/src/handlers/{webhooks,scheduled-jobs,chat-agent-invoke,wakeup-processor}.ts`, `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts:23`
- Live turn state (candidate lifecycle source): `apps/admin/src/components/threads/LiveRunWidget.tsx`, the `useActiveTurnsStore` hook (used at `apps/admin/src/routes/_authed/_tenant/threads/index.tsx:44`)

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — every hand-rolled `.sql` must have `-- creates:` markers, pre-flight `to_regclass()` guards, an `Apply manually:` header with literal `psql` command, be applied to dev before merge, and pass `scripts/db-migrate-manual.sh` (deploy gate).
- `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md` — pre-flight row counts before destructive DDL, idempotent transition SQL, post-retirement reference sweep.
- `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md` — row-derived `requireTenantAdmin(ctx, thread.tenant_id)` gate must survive any mutation refactor; `ctx.auth.tenantId` is null for Google-federated users.
- `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md` — post-deploy cross-component smoke invocation, not CI green, is the signal that the surface works.
- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — for the X-Ray verification, walk emit → bus → consumer → UI per stage; commit the audit script.
- `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md` — inline 3× before extracting; don't spin up a "thread-status" shared package during this sweep.

### External References

None required — fully grounded in repo patterns + institutional learnings.

---

## Key Technical Decisions

- **Trigger source reuses `threads.channel`, no new column.** Research showed `channel` is already populated across all five thread-creation paths. "Trigger" in the right rail is a read-only projection of `channel` with a UI-side label map. The underlying `ThreadChannel` GraphQL enum (`packages/database-pg/graphql/types/threads.graphql` lines 29–36) holds `CHAT | EMAIL | SCHEDULE | MANUAL | WEBHOOK | API`; the DB column is plain text with the lowercase values `chat | email | schedule | manual | webhook | api` (writers cited in Context & Research). Label map: `chat` / `manual` → "Manual chat", `schedule` → "Schedule", `webhook` → "Webhook", `api` → "Automation", `email` → "Email". UI must also define a fallback ("Unknown" or raw value) for any unrecognized string. This collapses what the origin doc treated as net-new feature work into a display change.
- **Derived lifecycle ships as a _new_ enum (`ThreadLifecycleStatus`), not a renamed `ThreadStatus`.** Keeping the name would carry task-era semantic baggage (`backlog`, `done`) through every codegen'd client. Introducing a new enum makes the break explicit at the type level and forces every consumer to re-bind — by design.
- **Derived status computation reads `thread_turns.status` (plain text, known values: `queued | running | succeeded | failed | cancelled | timed_out | skipped`) plus the active-turn probe.** Mapping: `queued` and `running` → `RUNNING` (must group them to avoid IDLE→RUNNING flicker during the queued→running handoff window); `succeeded` → `COMPLETED`; **`cancelled` → `CANCELLED` (user-initiated stop — not a failure; operators triage it differently)**; `failed`, `timed_out` → `FAILED`; `skipped` and zero-turn threads → `IDLE`. Resolver evaluation order: active-turn probe first (covers the `queued`→`running` window when the latest row is still the prior `succeeded`), then latest-row fallback.
- **v1 enum ships 5 values: `RUNNING | COMPLETED | CANCELLED | FAILED | IDLE`.** `AWAITING_USER` is intentionally NOT in the v1 enum — no signal source exists today (no `awaiting_user_input` state, event, or wakeup marker in the codebase), and shipping an enum value the server never emits is the same anti-pattern the cleanup is solving. When a real signal lands (operator heuristic, tool-call pending-input event, etc.), add the enum value then and regenerate codegen — one more codegen pass, cheap, and the team by then has PR patterns for adding enum variants from this cleanup.
- **Traces gate is empirical, not metric-based.** The verification script does a real thread invocation on `dev`, reads the `cost_events.trace_id` value from the resolved `ThreadTracesQuery`, and curls the resulting X-Ray console URL shape to confirm the trace exists. If either the `trace_id` value isn't an X-Ray segment ID or X-Ray returns empty, R12 branches to remove rather than patch.
- **`escalateThread` / `delegateThread` lose their system-comment trace.** Refactor writes a `thread_turn` event (existing table, structured) instead of a `thread_comments` row. Keeps the audit trail without keeping the comments table. **Prerequisite: `thread_turns.kind` column must be added first (U12) — today the table has `status` but no `kind` column, no CHECK, no enum.** New writes use `kind = 'system_event'` with a structured payload; default on existing rows is `'agent_turn'`.
- **Hard cut, no deprecate-first window.** All consumers live in this monorepo; there is no external API contract. Shipping two PRs (deprecate → drop) adds codegen churn without mitigation value.
- **Server work is split into PR 3a (stop reading/writing the task-era fields) and PR 3b (drop the schema).** Originally considered "atomic PR" — but `.github/workflows/deploy.yml` updates Lambda code during `terraform-apply` before the `migration-drift-check` job runs (the drift check is read-only; it gates but doesn't apply). That creates a real skew window: if Lambda picks up the new code before `psql -f 0027_...` is run, any old resolver still referencing `status`/`priority`/`type` errors; if the SQL applies before Lambda updates, current code reading dropped columns errors. Splitting gives PR 3a (deploy once, resolvers stop reading + `createThread`/handler writers stop writing) a full stabilization window before PR 3b runs the destructive DDL. Cost: one extra PR. Benefit: no production-data skew window during deploy.
- **PR 3b (U5 schema drops) is HARD-GATED on agent-workspace-files reaching a merged `ce-plan` doc with `ce-work` in flight.** Dropping `MessageArtifact` + `message.artifacts` + `message.durableArtifact` + the `artifacts` table leaves the platform with zero durable agent file output until workspace-files replaces it. For 400+ agents across 4 enterprises, that's a product-level gap, not a schema cleanup. The `2026-04-21-agent-workspace-files-requirements.md` brainstorm is not sufficient — an implementation plan must exist and be actively executed before PR 3b merges. If workspace-files slips, PR 3b holds indefinitely; the rest of the cleanup (PR 3a, PRs 4-9) ships and operators see no Artifacts section (acceptable — it was already broken). This gate converts a silent product risk into an explicit blocker.
- **Admin localStorage view state migration is a defensive filter, not a migration.** On load, filter unknown filter fields out of `thinkwork:threads-view:<tenantId>`; don't write a migration. Simplest path; stale cache self-heals.
- **Integration tests in `packages/api/test/integration/` over new admin component tests.** Admin has no Vitest setup; spinning one up is out of scope. Feature correctness verified via resolver integration tests and the post-deploy smoke.

---

## Open Questions

### Resolved During Planning

- **Does `threads.channel` already exist?** Yes (`packages/database-pg/src/schema/threads.ts:43`). No new column needed.
- **Is `MessageArtifact` populated by any resolver?** No — declared in GraphQL but no resolver fills it. Drop is lower-risk than origin assumed.
- **Are `status` / `priority` / `type` Postgres enums?** No — plain text columns. No `DROP TYPE` needed.
- **Does `packages/api` need codegen regen?** No — no codegen script; server types are inferred from resolvers.
- **Full call-site enumeration of removed types/fields?** Done in research (see Relevant Code and Patterns). Mobile + CLI expansions captured in U9 / U10.
- **Do escalate/delegate mutations depend on `thread_comments`?** Yes — they write system comments. U2 refactors before U3 can drop the table.
- **Is `ThreadTraces` backed by AWS X-Ray?** No — it queries Postgres `cost_events` with a speculative X-Ray deeplink. The question isn't "is X-Ray flowing" but "does `cost_events.trace_id` open a real X-Ray trace?"
- **What values does `thread_turns.status` hold?** `queued | running | succeeded | failed | cancelled | timed_out | skipped` — plain text, no CHECK, no pg enum. Full enumeration verified against every `.insert(threadTurns).set({ status })` site (see Context & Research).
- **Does an `awaiting_user_input` state/signal exist?** No. Grep across `packages/`, `apps/admin`, `apps/mobile` returns zero hits for `awaiting_user`, `awaiting_input`, `pending_input`, `AwaitingUser`. `AWAITING_USER` ships in the `ThreadLifecycleStatus` enum for forward-compat but the v1 resolver never emits it.
- **Does `thread_turns.kind` exist?** No. U12 adds it (`text NOT NULL DEFAULT 'agent_turn'`) as a prerequisite migration before U2 can write system events.
- **Does the drift reporter support `-- drops:` markers?** No. U5 extends `scripts/db-migrate-manual.sh` (~30-line patch) to parse `-- drops: public.X` and `-- drops-column: public.T.C` with inverted probes (`to_regclass(...) IS NULL` → `DROPPED`). Extension ships in the same PR as the destructive migration. No sentinel-table workaround — there is no precedent for sentinels in the existing migrations and it leaves dead tables in the schema.
- **Is `message_artifacts` in scope?** Yes — `packages/database-pg/src/schema/messages.ts:82` declares `message_artifacts.artifact_id → artifacts.id` but no FK was ever applied (no `ALTER TABLE` in any drizzle file). After `artifacts` drops, `message_artifacts` becomes a dangling table. U5 drops `message_artifacts` in the same migration.
- **Aurora topology?** Aurora Serverless v2, single cluster, single writer, single region, `deletion_protection` on (per `terraform/modules/data/aurora-postgres/main.tf`). No cross-region replica concerns, but DDL still holds `ACCESS EXCLUSIVE` on live traffic — U5 mitigates with explicit `lock_timeout` + `statement_timeout`.

### Deferred to Implementation

- **Exact lifecycle status transitions for edge cases** (e.g., a thread with zero turns yet — `Idle` or `Running`?). Settle during U4 resolver implementation against actual turn-state invariants.
- **`ThreadChannel` label mapping for `email` / `api`**. If label copy is wrong, fix at PR review; don't block cleanup.
- **Which `cost_events` rows belong to which tenant for trace counts**. Already enforced via `requireTenantAdmin` at resolver layer; verify during U8.
- **Whether KanbanBoard should be dropped entirely or rewritten to group by Agent**. Product decision surfaced during U7 — default is drop if group-by-status was the only meaningful board axis.
- **Final labels on the right rail "Turn + cost summary" row** (e.g., "3 turns · $0.0118" vs split rows). Settle at U6.

---

## High-Level Technical Design

> _This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce._

**Data flow for the reshaped right rail:**

```
thread row
 ├─ channel  ──────────────→ Trigger row (UI label-mapped)
 ├─ agent_id ──────────────→ Agent link
 ├─ created_at ────────────→ Created
 └─ (no more status/priority/type/parent_id)

thread_turns (latest)
 └─ state ─────────────→┐
                         ├──→ Thread.lifecycleStatus resolver ──→ ThreadLifecycleBadge
useActiveTurnsStore ────┘       (Running | Awaiting user |
                                 Completed | Failed | Idle)

thread_turns (aggregate)
 └─ count + tokens_total + cost_total ──→ Turn + cost summary row

cost_events (existing, if U1 passes)
 └─ latest trace_id ──────→ "Open in X-Ray" header link
```

**PR sequencing:**

```
PR 1 (U1)   Pre-gate (verify-traces + row counts + dependency probe)
PR 2 (U12)  ADD COLUMN thread_turns.kind ─→ merge + apply (pre-req for U2)
PR 3 (U2)   Escalate/Delegate refactor off thread_comments ─→ merge

PR 3a: U3 + U4
  Stop reading + stop writing status/priority/type/parent_id
  Add ThreadLifecycleStatus resolver
  (schema files + Drizzle SQL unchanged)
     │
     ▼ deploy, observe CloudWatch error filters 24h
     │
PR 3b: U5
  0027_thread_cleanup_drops.sql (+ rollback SQL, + reporter extension)
  Schema file drops (threads.ts, messages.ts, artifacts.ts)
     │
     ▼ apply to dev, paste \d+ + S3 paths, deploy
     │
     ┌───────┬──────┬──────┬──────┐
     ▼       ▼      ▼      ▼      ▼
     U6     U7     U8     U9     U10
     admin  list   Traces mobile CLI
     detail rewrite branch sweep cleanup
     │      │      │      │      │
     └──────┴──────┼──────┴──────┘
                    ▼
              U11 codegen regen + smoke + CloudWatch alarm
```

---

## Implementation Units

- U1. **Pre-gate: X-Ray deeplink verification script + row counts**

**Goal:** Produce an authoritative signal for R11/R12, plus baseline row counts for the dropped tables to guard against surprise tenant data.

**Requirements:** R11, and indirectly R1/R3/R4 (row-count safety).

**Dependencies:** None.

**Files:**

- Create: `scripts/verify-thread-traces.ts` (runnable via `pnpm tsx`)
- Create: `scripts/pre-drop-row-counts.sql` (psql-runnable, paste output into the server PR)

**Approach:**

- Verification script: create a dev-stack thread via GraphQL mutation, trigger one Bedrock-backed turn, poll until `ThreadTracesQuery` returns rows, grab the `trace_id`, construct the console URL (`https://<region>.console.aws.amazon.com/cloudwatch/home#xray:traces/${trace_id}`), and `curl -I` the AWS API surface (`arn:aws:xray:${region}:${account_id}:trace/${trace_id}` via `aws xray batch-get-traces`) to confirm the trace exists. Exit 0 if both the `cost_events` row exists AND X-Ray returns a non-empty trace payload; exit 1 otherwise.
- Row-count SQL: `SELECT count(*), count(DISTINCT tenant_id) FROM thread_comments;` for thread_comments, artifacts, message_artifacts (`thread_attachments` is NOT being dropped; no count needed). Run on dev first, then prod (read-only), paste both into the server PR.

**Execution note:** Run script output + SQL output live in the server PR description; gate U8 (Traces branch) on the verification exit code.

**Patterns to follow:**

- Empirical-verification pattern from `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`.
- Post-deploy smoke pattern from `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`.

**Test scenarios:**

- Happy path: script invoked on dev returns exit 0 with a real trace payload printed.
- Error path: script handles the case where X-Ray returns empty (trace ID not a real segment ID) and exits 1 with a clear message.
- Edge case: script handles the case where the thread produces zero turns within the poll window and fails loudly rather than silently passing.

**Verification:**

- Script committed, runnable with `pnpm tsx scripts/verify-thread-traces.ts --stage dev`, and its exit code is the input to U8.
- Row counts captured and attached to the server PR.

---

- U2. **Refactor `escalateThread` / `delegateThread` off `thread_comments`**

**Goal:** Remove the system-comment write path so U3 can drop the `thread_comments` table without regressing the audit trail.

**Requirements:** R1.

**Dependencies:** U1 (row counts inform whether pre-cutover escalate/delegate comments matter), **U12 (must ship first — `thread_turns` has no `kind` column today)**.

**Files:**

- Modify: `packages/api/src/graphql/resolvers/threads/escalateThread.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/threads/delegateThread.mutation.ts`
- Modify: `packages/database-pg/src/schema/scheduled-jobs.ts` (`threadTurns` table lives here; U12 adds the `kind` column — U2 only needs to write to it, no schema edit required if U12 has already shipped)
- Test: `packages/api/test/integration/threads/escalate-delegate.test.ts` (new)

**Approach:**

- Replace the `threadComments.insert` in each mutation with a `thread_turns.insert` of kind `system_event` carrying a structured payload (`{ kind: "escalate" | "delegate", actor_id, reason, previous_assignee_id, new_assignee_id }`).
- `thread_turns` is the existing timeline source `ExecutionTrace` already renders — system events flow through the same UI without a separate section.
- **Add `requireTenantAdmin(ctx, row.tenant_id)` to both mutations — it is not present today.** Load the thread row first (returning `NOT_FOUND` if missing), then gate. This is a cross-tenant security fix in-scope for this cleanup per `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`.
- The `thread_turns.insert` must source `tenant_id` from the loaded thread row, not from args — required for tenant-isolation of the new system-event rows.

**Execution note:** Characterization-first — add an integration test capturing today's escalate/delegate outcome (comment row written) before the refactor, then update the test to assert the new thread_turn shape. This is legacy-y code and we don't want to regress the actor/tenant plumbing.

**Patterns to follow:**

- Row-derived tenant pin (`docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`).
- Existing `thread_turns` writer patterns in `packages/api/src/graphql/resolvers/threads/` (search for `threadTurns.insert`).

**Test scenarios:**

- Happy path: escalateThread writes a `thread_turn` with `kind = system_event`, correct `tenant_id` from the row, and the expected payload; `thread_comments` is untouched.
- Happy path: delegateThread same, different payload.
- Error path (security regression guard): non-admin caller returns `UNAUTHORIZED`; no turn written. Asserts `requireTenantAdmin` is wired.
- Error path (security regression guard): admin caller in tenant A invoking escalateThread on a tenant B threadId returns `NOT_FOUND` (row lookup → tenant pin mismatch); no turn written. Asserts tenant isolation.
- Error path: Google-federated caller with `ctx.auth.tenantId = null` resolves via `resolveCallerTenantId(ctx)` and still gates correctly.
- Integration: after escalate, `Thread.turns` (or the existing turns query) returns the new system event in the correct tenant's timeline only.

**Verification:**

- Existing escalate/delegate behavior preserved from the operator's POV (thread updated + audit-trail event present).
- Grep finds zero remaining `threadComments` references in escalate/delegate files.

---

- U3. **Server: drop GraphQL fields/types/mutations/resolvers + handler write paths (PR 3a)**

**Goal:** Remove every GraphQL-layer reference to Comments, Sub-tasks, Attachments, Artifacts, Priority, Type, and the old manual Status, AND make every server-side write path stop writing those columns. Schema drops come later in PR 3b (U5). This creates a stabilization window between PR 3a deploy and PR 3b, during which the columns still exist but nothing reads or writes them.

**Requirements:** R1, R2, R3, R4, R5, R6, R8.

**Dependencies:** U2 (must merge first so escalate/delegate no longer write to `thread_comments`), U12 (must merge first so `thread_turns.kind` exists).

**Files:**

- Modify: `packages/database-pg/graphql/types/threads.graphql` (drop `ThreadPriority`, `ThreadType`, task-era `ThreadStatus`, `ThreadComment`, `ThreadCommentsPage`; drop `thread.priority`, `thread.type`, `thread.status` (task-era), `thread.parent`, `thread.children`, `thread.comments`; drop `addThreadComment`/`updateThreadComment`/`deleteThreadComment` from `extend type Mutation`; drop `status`/`priority`/`type` arguments from `threads(...)` query). **Keep `ThreadAttachment` type and `thread.attachments` field** — reserved for upcoming photos/files-to-agent feature.
- Modify: `packages/database-pg/graphql/types/messages.graphql` (drop `MessageArtifact`, `Message.artifacts`, `Message.durableArtifact`)
- Delete: `packages/api/src/graphql/resolvers/threads/addThreadComment.mutation.ts`, `.../updateThreadComment.mutation.ts`, `.../deleteThreadComment.mutation.ts`
- Modify: `packages/api/src/graphql/resolvers/threads/index.ts` (unregister comment mutations)
- Modify: `packages/api/src/graphql/resolvers/threads/types.ts` (drop `children` resolver, `parent` field handling)
- Modify: `packages/api/src/graphql/resolvers/threads/thread.query.ts` (drop `commentRows` lookup at line 29; drop `comments` field on returned object. **Keep `attachmentRows` + `attachments` field** — reserved for the upcoming photos/files-to-agent feature. The admin UI no longer consumes it but the GraphQL contract stays intact.)
- Modify: `packages/api/src/graphql/resolvers/threads/threadsPaged.query.ts` (drop `statuses`/`priorities`/`type` filter args, drop `status`/`priority` sort handling)
- Modify: `packages/api/src/graphql/resolvers/threads/updateThread.mutation.ts` (drop `status`/`priority`/`type` from input; **add `requireTenantAdmin(ctx, row.tenant_id)` — not present today; load thread row first → NOT_FOUND → gate, before the DB write**)
- Modify: `packages/api/src/graphql/resolvers/observability/threadTraces.query.ts` (**add `requireTenantAdmin(ctx, args.tenantId)` — resolver currently accepts caller-supplied tenantId with no verification; this is a cross-tenant read vulnerability that the cleanup must close whether U8 takes the keep or remove path**)
- Modify: `packages/api/src/graphql/resolvers/threads/thread.query.ts` (**audit for and add `requireTenantAdmin(ctx, row.tenant_id)` if missing — the primary thread-read surface that the reshaped right rail depends on**)
- Modify: `packages/api/src/graphql/resolvers/threads/createThread.mutation.ts` (drop the status-from-channel derivation at line 29 — stops WRITING `status`)
- Modify (stop writing status/priority/type anywhere else): audit + edit `packages/api/src/handlers/webhooks.ts`, `packages/api/src/handlers/scheduled-jobs.ts`, `packages/api/src/handlers/chat-agent-invoke.ts`, `packages/api/src/handlers/wakeup-processor.ts`, `packages/lambda/job-trigger.ts`. Grep these for `.set({ status:`, `.values({ status:`, `priority:`, `type:` targeting the `threads` table and remove. **Additionally grep for `notifyThreadUpdate(` across the same set plus `packages/api/src/graphql/notify.ts` — any call passing task-era `status:` literals (e.g., `chat-agent-invoke.ts:1093` passes `status: 'in_progress'`) must be updated to pass the derived `lifecycleStatus` instead.** The typecheck pass after removing `status` from the schema TS object is the authoritative audit — compile errors enumerate every missed writer.
- Modify: `packages/database-pg/graphql/types/subscriptions.graphql` (rename `notifyThreadUpdate(...)` arg from `status: String!` to `lifecycleStatus: String!`; accept one of the 5 `ThreadLifecycleStatus` enum values as stringified). Run `pnpm schema:build` and commit the resulting `terraform/schema.graphql` diff.
- Modify: `packages/api/src/graphql/notify.ts` (`notifyThreadUpdate` implementation — update the AppSync-published payload shape).
- Modify: `apps/admin/src/context/AppSyncSubscriptionProvider.tsx` and any mobile subscription listeners — update the `OnThreadUpdated` / `notifyThreadUpdate` handler to read `lifecycleStatus` instead of `status`.
- Modify: `packages/api/src/graphql/resolvers/threads/loaders.ts` (drop `threadCommentCount`)
- Modify: `packages/api/src/graphql/resolvers/messages/messages.query.ts` (drop `artifacts`/`durableArtifact` population; drop the `artifacts` table join)
- Test: `packages/api/test/integration/threads/removed-fields-rejected.test.ts` (new — asserts removed fields produce expected GraphQL errors)

**Approach:**

- GraphQL schema drops land first in the same commit as resolver drops.
- For `threadsPaged`, keep pagination + tenant filter; drop status/priority/type filter + sort paths.
- `AppSync subscription schema` (`terraform/schema.graphql`) — run `pnpm schema:build` and confirm no diff (this cleanup doesn't touch subscriptions). If there is a diff, inspect before committing.

**Execution note:** Do not split this across PRs. Splitting schema-drop from resolver-drop creates a runtime window where resolvers reference missing columns post-U5 apply.

**Patterns to follow:**

- Row-derived `requireTenantAdmin` on every surviving mutation (`docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`) — audit the final resolver set.

**Test scenarios:**

- Happy path: `thread(id)` returns a thread without `comments`/`parent`/`children`/`priority`/`type` fields; `attachments` field is still present (reserved for upcoming feature).
- Happy path: `thread(id) { messages { edges { node { artifacts } } } }` errors with "field does not exist".
- Error path: `threads(statuses: [...])` errors because the argument was removed.
- Error path: `addThreadComment` mutation errors with "unknown mutation".
- Integration: `escalateThread` + `delegateThread` (from U2) still succeed end-to-end after U3.
- Integration: after U5 applies, `thread(id)` does not error reading a row with null-dropped columns.

**Verification:**

- `pnpm -r --if-present typecheck` passes in `packages/api`.
- Integration tests in `packages/api/test/integration/` pass.
- `pnpm schema:build` shows no unexpected diff.

---

- U4. **Server: derived `ThreadLifecycleStatus` resolver**

**Goal:** Add a new `Thread.lifecycleStatus` field + `ThreadLifecycleStatus` enum that powers the derived badge. Ships in the same PR as U3/U5.

**Requirements:** R7, R8.

**Dependencies:** U3 (atomic PR).

**Files:**

- Modify: `packages/database-pg/graphql/types/threads.graphql` (add `enum ThreadLifecycleStatus { RUNNING COMPLETED CANCELLED FAILED IDLE }`; add `thread.lifecycleStatus: ThreadLifecycleStatus!`)
- Modify: `packages/api/src/graphql/resolvers/threads/types.ts` (add `lifecycleStatus` resolver)
- Modify: `packages/api/src/graphql/resolvers/threads/thread.query.ts` (populate lifecycleStatus on the returned thread)
- Create: `packages/api/src/graphql/resolvers/threads/lifecycle-status.ts` (pure function: `(thread, latestTurn) => ThreadLifecycleStatus`)
- Test: `packages/api/test/integration/threads/lifecycle-status.test.ts` (new)

**Approach:**

- Pure-function derivation from two inputs:
  1. Server-side active-turn probe: `SELECT 1 FROM thread_turns WHERE thread_id = $1 AND status IN ('queued', 'running') AND created_at > now() - interval '5 minutes' LIMIT 1` — if exists, return `RUNNING`. Covers the `queued → running` handoff window during which the latest committed row may still be the prior `succeeded`. **The 5-minute freshness window prevents stuck-`queued` rows from latching the badge to `RUNNING` forever** (a real failure mode documented in `project_agentcore_deploy_race_env.md` — warm containers can boot pre-env-injection and strand `queued` turns with "missing THINKWORK_API_URL"). If the active probe finds no fresh row, a stuck `queued > 5 min` row falls through to the latest-row fallback, which maps `queued` to `FAILED` (see mapping table below) — pushing the stuck thread into the operator's triage queue instead of hiding it.
  2. Latest-row fallback (if active probe returns empty): `SELECT status FROM thread_turns WHERE thread_id = $1 ORDER BY created_at DESC LIMIT 1` mapped by a fixed table:

  | `thread_turns.status`                                 | `ThreadLifecycleStatus`                                |
  | ----------------------------------------------------- | ------------------------------------------------------ |
  | `queued` (fresh ≤ 5 min, via active probe), `running` | `RUNNING`                                              |
  | `queued` (stuck > 5 min)                              | `FAILED` (stuck dispatch — surface to operator triage) |
  | `succeeded`                                           | `COMPLETED`                                            |
  | `cancelled`                                           | `CANCELLED`                                            |
  | `failed`, `timed_out`                                 | `FAILED`                                               |
  | `skipped`                                             | `IDLE`                                                 |
  | (no rows)                                             | `IDLE`                                                 |

- `AWAITING_USER` is present in the GraphQL enum but **not emitted by v1** — no input signal source exists in the codebase today. Tests assert the resolver never returns it.
- Resolver reads the same `thread_turns` table that `ExecutionTrace` uses; no separate query.
- Computed per-request; no caching, no columns.
- Mirror `apps/admin/src/components/threads/LiveRunWidget.tsx:26-28`'s `queued | running → active` grouping on the server, not `cancelThreadTurn.mutation.ts`'s narrower "running only" check.

**Test scenarios:**

- Happy path: thread with fresh `queued` turn (created < 5 min ago, pre-dispatch window) → `RUNNING`.
- Edge case (freshness guard): thread with stuck `queued` turn (created > 5 min ago, never transitioned to `running`) → `FAILED`. Asserts the freshness predicate.
- Happy path: thread with `running` turn → `RUNNING`.
- Happy path: thread with latest turn `succeeded` → `COMPLETED`.
- Happy path: thread with latest turn `failed` → `FAILED`.
- Happy path: thread with latest turn `cancelled` → `CANCELLED` (user-initiated stop, distinct from system failure).
- Happy path: thread with latest turn `timed_out` → `FAILED`.
- Happy path: thread with latest turn `skipped` (agent paused / tenant deactivated) → `IDLE`.
- Edge case: thread with zero turns → `IDLE`.
- Edge case: thread whose latest committed row is `succeeded` BUT a new `queued` turn has been inserted (handoff window) → `RUNNING` (active-turn probe wins).
- Edge case (contract): `ThreadLifecycleStatus` enum has exactly 5 values (`RUNNING`, `COMPLETED`, `CANCELLED`, `FAILED`, `IDLE`; no `AWAITING_USER`) — assert schema shape.
- Integration: field resolves correctly alongside the existing `thread(id)` query.

**Verification:**

- `lifecycle-status.ts` unit tests cover all five states + transitional edge case.
- Integration test hits `thread(id) { lifecycleStatus }` and asserts the value.

---

- U5. **Schema: hand-rolled Drizzle migration dropping columns/tables/indexes (PR 3b)**

**Goal:** Remove the physical schema footprint for everything U3 stopped reading in PR 3a. Ships as PR 3b after PR 3a has deployed and stabilized for at least one full deploy cycle.

**Requirements:** R1, R2, R3, R4, R5, R6, R8, R14.

**Dependencies:** U3 deployed (PR 3a — resolvers must have stopped reading/writing before the columns/tables disappear), U1 (row counts + pre-flight probe), U4 (derived lifecycle already shipped in PR 3a), **U13 (backups bucket + `aws_s3` extension must exist before `aws_s3.query_export_to_s3` calls)**, **agent-workspace-files plan merged + `ce-work` in flight (hard gate on the `MessageArtifact` drop component of this unit)**.

**Files:**

- Create: `packages/database-pg/drizzle/0027_thread_cleanup_drops.sql` (verify next available NNNN by `ls packages/database-pg/drizzle/` at author time)
- Create: `packages/database-pg/drizzle/0027_rollback_thread_cleanup.sql` (idempotent rollback; committed at same time, not applied by default)
- Modify: `scripts/db-migrate-manual.sh` (extend reporter to parse `-- drops: public.X` and `-- drops-column: public.T.C` markers; invert probe to pass on `to_regclass(...) IS NULL`)
- Modify: `packages/database-pg/src/schema/threads.ts` (drop `status`, `priority`, `type`, `parent_id` columns; drop `thread_comments` table declaration; drop `parentChild`/`comments` relations; drop `idx_threads_tenant_status` + `idx_threads_parent_id` from the indexes block). **Keep `thread_attachments` table declaration + `attachments` relation** — reserved for upcoming photos/files-to-agent feature.
- Modify: `packages/database-pg/src/schema/messages.ts` (drop `MessageArtifact` table declaration; drop `artifacts` relation on messages; **drop `message_artifacts` table declaration + its relations** — dangling after `artifacts` drop)
- Modify or delete: `packages/database-pg/src/schema/artifacts.ts` (source file for the `artifacts` table — confirm exact location and edit accordingly)

**Approach:**

Hand-rolled SQL, header shape:

```
-- Apply manually: psql "$DATABASE_URL" -f packages/database-pg/drizzle/0027_thread_cleanup_drops.sql
-- drops-column: public.threads.status
-- drops-column: public.threads.priority
-- drops-column: public.threads.type
-- drops-column: public.threads.parent_id
-- drops: public.thread_comments
-- drops: public.artifacts
-- drops: public.message_artifacts
-- drops: public.idx_threads_tenant_status
-- drops: public.idx_threads_parent_id
-- NOTE: public.thread_attachments is intentionally preserved (upcoming photos/files-to-agent feature).
```

Script body (sketch — directional, not implementation):

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';        -- fail fast on lock contention instead of wedging the cluster
SET LOCAL statement_timeout = '60s';

-- Pre-flight: back up row data to S3 before destructive DROPs via the Aurora aws_s3 extension.
-- Unconditional, cheap, recoverable forever. Uses aws_s3.query_export_to_s3, NOT \copy TO PROGRAM
-- (which does not work on Aurora RDS — superuser required; client-side \copy has no S3 credentials).
-- Requires: aws_s3 extension enabled on the cluster parameter group + IAM role attached with
-- s3:PutObject on thinkwork-${stage}-backups/pre-drop/*. See U0 below for the prerequisite.
SELECT aws_s3.query_export_to_s3(
  'SELECT * FROM public.thread_comments',
  aws_commons.create_s3_uri('thinkwork-${stage}-backups', 'pre-drop/thread_comments_2026_04_24.csv', '${region}'),
  options := 'format csv, header true'
);
-- thread_attachments is NOT backed up here — it is NOT being dropped (reserved for upcoming feature).
SELECT aws_s3.query_export_to_s3(
  'SELECT * FROM public.artifacts',
  aws_commons.create_s3_uri('thinkwork-${stage}-backups', 'pre-drop/artifacts_2026_04_24.csv', '${region}'),
  options := 'format csv, header true'
);
SELECT aws_s3.query_export_to_s3(
  'SELECT * FROM public.message_artifacts',
  aws_commons.create_s3_uri('thinkwork-${stage}-backups', 'pre-drop/message_artifacts_2026_04_24.csv', '${region}'),
  options := 'format csv, header true'
);

-- Drop order: indexes → columns → child tables → parent tables.
DROP INDEX IF EXISTS public.idx_threads_tenant_status;
DROP INDEX IF EXISTS public.idx_threads_parent_id;

ALTER TABLE public.threads DROP COLUMN IF EXISTS status;
ALTER TABLE public.threads DROP COLUMN IF EXISTS priority;
ALTER TABLE public.threads DROP COLUMN IF EXISTS type;
ALTER TABLE public.threads DROP COLUMN IF EXISTS parent_id;

-- CASCADE explicit — message_artifacts.artifact_id has no live FK, but declaring CASCADE
-- makes the intended behavior explicit and robust if a future ALTER adds one.
DROP TABLE IF EXISTS public.message_artifacts CASCADE;
DROP TABLE IF EXISTS public.thread_comments;
DROP TABLE IF EXISTS public.artifacts CASCADE;
-- NOTE: thread_attachments intentionally preserved — reserved for upcoming photos/files-to-agent feature.

COMMIT;
```

- `DO $$ ... RAISE EXCEPTION` pre-flight guards (per `drizzle/0016_wiki_schema_drops.sql` template) **only on unexpected state, not on already-applied state.** Re-applying to a DB already in the dropped state is a silent no-op (all `DROP IF EXISTS`). Applying to a DB where the pre-flight SQL (U1) detected a CHECK/FK/view/trigger dependency raises loudly.
- Drop order matters: indexes before columns (avoid scan re-planning mid-drop); columns before tables (clearer error diagnostics); child tables (`message_artifacts`) before parents (`artifacts`) even with CASCADE for auditability.
- Reporter extension (`scripts/db-migrate-manual.sh`): parallel `probe_dropped`/`probe_dropped_column` functions inverting `to_regclass(...) IS NULL` → `DROPPED`, `information_schema.columns` absence → `DROPPED`; dispatch block identical to the existing `creates:` handler but sets `any_unexpected=1` when a declared drop target is `STILL_PRESENT` rather than `MISSING`.
- Rollback SQL (`0027_rollback_thread_cleanup.sql`) re-creates `threads.status`/`priority`/`type` as `text NULL` (no defaults, no CHECK), re-creates `threads.parent_id` as `uuid NULL` (no FK), and re-creates `thread_comments`/`artifacts`/`message_artifacts` with minimal column shape from `HEAD~1` of `schema/*.ts` (`thread_attachments` is not in this list — it was never dropped). Row data restore path: `COPY FROM` the S3 CSVs. Not applied automatically; reviewed at PR time so it isn't composed under pressure at 2am.

**Execution note:** Apply to dev first (`psql "$DATABASE_URL" -f ...`). Paste `\d+ threads`, `\d+ messages`, and "Did not find any relation" outputs for the dropped tables into the PR. Do NOT run `pnpm db:push` — hand-rolled file is outside `meta/_journal.json` per CLAUDE.md. The drift reporter (post-extension) runs after `terraform-apply` and fails the deploy if declared drops haven't landed.

**Patterns to follow:**

- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` (drops + DO-block template).
- `packages/database-pg/drizzle/0023_tenants_deactivation.sql` (marker syntax).

**Test scenarios:**

- Happy path: applying to a dev DB that has the columns/tables produces the expected dropped state; `\d+ threads` shows no `status`/`priority`/`type`/`parent_id`; `thread_comments` / `artifacts` / `message_artifacts` tables absent; **`thread_attachments` is STILL PRESENT** (preserved for upcoming feature).
- Happy path: S3 CSVs exist under `s3://thinkwork-dev-backups/pre-drop/` with non-empty content where source tables had rows.
- Happy path: re-applying to a DB already in the dropped state exits 0 (idempotent, silent no-op).
- Error path: applying to a DB where pre-flight discovers an unexpected dependency (new view referencing `threads.status`, CHECK constraint not in the HEAD schema) — raises, apply aborts with clear message identifying the dependency.
- Error path: applying under contention causes `lock_timeout` to fire in ≤5s rather than wedging the cluster.
- Integration: `scripts/db-migrate-manual.sh` (post-extension) reports all declared drops as `DROPPED`; exit 0.
- Integration: `scripts/db-migrate-manual.sh` applied to a DB where drops did NOT land reports `STILL_PRESENT` for each and exits 1 (validates the extension works).
- Integration: rollback SQL applied to a post-drop DB re-creates the empty shells; `\d+` shows the columns/tables back.

**Verification:**

- Applied to dev, `\d+` output pasted into PR; S3 CSV paths pasted.
- `scripts/db-migrate-manual.sh` exits 0 against dev post-apply.
- `pnpm --filter @thinkwork/database-pg build` passes after schema edits.
- CloudWatch metric filter on `graphql-http` Lambda logs (added in U11) shows zero hits for `column "(status|priority|type|parent_id)" does not exist` or `relation "(thread_comments|artifacts|message_artifacts)" does not exist` in the 30-min window after apply.
- `EXPLAIN (BUFFERS) SELECT … FROM threads WHERE tenant_id = $1 AND channel = $2 ORDER BY updated_at DESC LIMIT 50` before/after shows no regression to seq scan (confirms `idx_threads_tenant_channel` covers the new access path without `idx_threads_tenant_status`).
- `SELECT count(*) FROM threads` identical before and after (drops don't affect rows; any delta is a red flag).

---

- U6. **Admin: thread detail right-rail cleanup + `ThreadLifecycleBadge` + Trigger row**

**Goal:** The detail page matches R10 — derived status badge, Agent link, Trigger (from `channel`), Created, Last turn, Turn + cost summary; no Comments composer, Sub-tasks, Attachments, Artifacts.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R10.

**Dependencies:** U3/U4 deployed (admin codegen will break until server ships).

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (drop `ThreadProperties`'s Status/Priority/Type `<Select>` blocks at lines 688–796; drop Sub-tasks block lines 540–567; drop Attachments block lines 569–590; drop Artifacts block lines 592–609; add ThreadLifecycleBadge at the top of `ThreadProperties`; add Trigger row reading `thread.channel`; keep Agent/Created/Last-turn; add Turn+cost summary row)
- Create: `apps/admin/src/components/threads/ThreadLifecycleBadge.tsx` (wraps existing `StatusBadge` or dedicated; consumes `thread.lifecycleStatus` + optional override from `useActiveTurnsStore` for real-time refresh)
- Modify: `apps/admin/src/components/threads/ExecutionTrace.tsx` (drop the `<Comment>` form + `comments` list rendering and related props)
- Modify: `apps/admin/src/components/threads/CreateThreadDialog.tsx` (drop subtask/parent creation path; drop Priority/Type fields from the form)
- Modify: `apps/admin/src/lib/graphql-queries.ts` (update `ThreadDetailQuery` to drop removed fields, add `lifecycleStatus` and keep `channel`)

**Approach:**

- Label map for Trigger: `chat` + `manual` → "Manual chat"; `schedule` → "Schedule"; `webhook` → "Webhook"; `api` → "Automation"; `email` → "Email"; **any unrecognized value → render the raw string (not "Unknown") so unexpected values surface during review instead of being silently hidden**.
- Turn + cost summary: compose from the existing `thread.messages.edges` aggregate already shown at `Activity` header. One row, format e.g. "3 turns · 1,444 tokens · $0.0118".
- `ThreadLifecycleBadge` reuses the visual vocabulary of `apps/admin/src/components/StatusBadge.tsx` but with the new enum values.
- **Badge loading/refresh states:** on initial query load (no `thread.lifecycleStatus` resolved yet), render a skeleton pill (same width/height as the badge, animated pulse). On real-time refresh via `useActiveTurnsStore`, hold the previous rendered value and update in place — do NOT flash a spinner or revert to skeleton during the refresh. The store-derived active check is an override that forces `RUNNING` if the client sees an active turn, even if the resolver last returned a terminal state (resolves the stale-cache flicker).
- **Trigger row null/empty state:** if `thread.channel` is null (shouldn't happen — schema has `NOT NULL DEFAULT 'manual'` — but defensive), render "—" (em dash). Distinct from the unrecognized-string case above.
- **"Open in X-Ray" link coordination with U8:** U1 (pre-gate) runs in PR 1 — its result is known before U6 starts. If U1 exited 0 (keep path), U6 includes the X-Ray header link; if U1 exited 1 (remove path), U6 omits it. No need for U6 to ship optimistically and U8 to subtract, or vice versa. U8's scope is only the `ThreadTraces` section itself + the GraphQL resolver, not the header link.

**Patterns to follow:**

- `StatusBadge` styling + `LiveRunWidget` live-turn read pattern.

**Test scenarios:** — none (no admin test harness). Covered by U11 smoke.

**Verification:**

- Dev server renders thread detail page with new right rail; no runtime errors in console.
- Manual pass: open threads with live / awaiting / failed / completed / zero-turn states and confirm the badge is correct.

---

- U7. **Admin: threads list view filters/sort/KanbanBoard rewrite**

**Goal:** No reference to removed filter/sort fields in the list view, KanbanBoard, quick-filters, or persisted localStorage view state.

**Requirements:** R9.

**Dependencies:** U3/U4 deployed.

**Files:**

- Modify: `apps/admin/src/routes/_authed/_tenant/threads/index.tsx` (drop `statuses`/`priorities` from view state; drop `sortField: "status" | "priority"`; drop `groupBy: "status" | "priority"`; drop quick-filter presets that used status; add defensive load filter — on rehydrate, strip unknown keys from `thinkwork:threads-view:<tenantId>` before use)
- Delete: `apps/admin/src/components/threads/KanbanBoard.tsx` (the component is task-era; status-column grouping doesn't translate to the new model, and a rewrite adds v1 scope that isn't justified pre-launch. If operators ask for a board after v1 ships, scope it then against real usage signals). Also drop `viewMode: "board"` and `groupBy` from the list-view localStorage state.
- Modify: `apps/admin/src/lib/graphql-queries.ts` (update `ThreadsPagedQuery` to drop status/priority arguments)

**Approach:**

- localStorage prune: on load, `const safe = { ...loaded, statuses: undefined, priorities: undefined, sortField: loaded.sortField === "status" || loaded.sortField === "priority" ? "updated" : loaded.sortField }` equivalent; write back only safe keys.
- If KanbanBoard stays, rewrite the column definitions to lifecycle states (Running / Awaiting user / Completed / Failed / Idle).

**Test scenarios:** — none automated. Manual:

- Happy path: fresh localStorage, list view renders defaults.
- Edge case: stale localStorage with `statuses: ["backlog"]` — view loads with defaults instead of crashing.
- Happy path: sort by "Updated" / "Created" / "Title" still works.
- Happy path: KanbanBoard renders post-rewrite columns (if kept).

**Verification:**

- No grep hits for `statuses`, `priorities`, `sortField: "status"`, `sortField: "priority"` in `apps/admin/src`.

---

- U8. **Traces branch: conditional keep-or-remove**

**Goal:** Resolve R12 based on U1 output.

**Requirements:** R11, R12.

**Dependencies:** U1 (gate), U6 (admin detail reshape).

**Files (keep path — if U1 exit 0):**

- Modify: `apps/admin/src/components/threads/ThreadTraces.tsx` (keep, fix the X-Ray deeplink format if U1 revealed an error)
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (keep Traces collapsed section; add "Open in X-Ray" header link)

**Files (remove path — if U1 exit 1):**

- Delete: `apps/admin/src/components/threads/ThreadTraces.tsx`
- Modify: `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx` (drop the `<TracesSection>` wrapper at lines 522–527)
- Modify: `apps/admin/src/lib/graphql-queries.ts` (drop `ThreadTracesQuery`)
- Modify: `packages/database-pg/graphql/types/observability.graphql` (drop `TraceEvent` type + `threadTraces` query)
- Delete: `packages/api/src/graphql/resolvers/observability/threadTraces.query.ts`
- Modify: `packages/api/src/graphql/resolvers/observability/index.ts` (unregister threadTraces)

**Approach:**

- Only one path runs; decision is made atomically after U1.
- If removing, the `cost_events` table stays (used elsewhere for billing signals per research). Only the per-thread GraphQL surface goes.

**Test scenarios:**

- Remove path integration: `threadTraces(threadId:)` errors with unknown query after PR merge.
- Keep path manual: clicking "Open in X-Ray" navigates to a real trace.

**Verification:**

- Grep for `ThreadTraces` / `TraceEvent` / `threadTraces` returns zero hits across admin/api/graphql (remove path) OR the link is exercised once per stage (keep path).

---

- U9. **Mobile: remove references to removed thread fields**

**Goal:** Mobile app compiles and renders correctly after server removes `thread.status` / `thread.priority` / `thread.type` / `thread.children` / `thread.parent` / `thread.comments` / `message.artifacts` / `message.durableArtifact`. (`thread.attachments` is NOT removed — reserved for upcoming photos/files feature; mobile may need to render or send attachments once that feature lands, out of scope for this cleanup.)

**Requirements:** R13.

**Dependencies:** U3/U4 deployed.

**Files:**

- Modify: `apps/mobile/lib/graphql-queries.ts` (update `ThreadQuery` line 742: drop removed field selections; add `lifecycleStatus` + keep `channel`; update `ThreadsQuery` line 689: drop `ThreadStatus`/`ThreadPriority` arg types)
- Modify: `apps/mobile/app/thread/[threadId]/index.tsx` (drop `thread.children` rendering at line 240)
- Modify: `apps/mobile/app/thread/[threadId]/info.tsx` (drop `thread.children`/`thread.priority`/`thread.type` rendering at lines 146, 174, 176, 180, 182; add derived lifecycle + Trigger rows to match admin)
- Modify: `apps/mobile/app/threads/[id]/index.tsx` (drop `thread.status`/`type`/`priority` rendering at lines 152, 225, 228, 231, 234; add lifecycle badge)
- Modify: `apps/mobile/app/threads/index.tsx` (drop `thread.type`/`thread.status` rendering at lines 119, 129; replace with lifecycle + channel)
- Regenerate: `apps/mobile/lib/gql/*` via `pnpm --filter mobile codegen`

**Approach:**

- Match admin visual vocabulary where possible (same labels for Trigger).
- No net-new mobile features; the goal is parity with admin's lifecycle + trigger view.

**Test scenarios:**

- Happy path: thread detail screen on mobile renders lifecycle badge + trigger row for threads in each channel.
- Edge case: thread with zero turns renders `IDLE` without crashing.
- Integration: app does not surface the old sub-task list.

**Verification:**

- `pnpm --filter mobile typecheck` passes.
- `pnpm --filter mobile build` (iOS simulator) succeeds.
- Manual pass through relevant screens on a TestFlight dev build.

---

- U10. **CLI: remove status/priority/type flags from thread commands**

**Goal:** `thinkwork thread` subcommands no longer expose `--status`, `--priority`, `--type`.

**Requirements:** R13.

**Dependencies:** U3/U4 deployed.

**Files:**

- Modify: `apps/cli/src/commands/thread.ts` (drop `--status`, `--priority`, `--type` flag definitions at lines 25–26; drop references in list/create/update/release at lines 70, 79, 84, 94, 98–99, 107–115, 153, 156; add `--lifecycle` read filter pointing at `lifecycleStatus` if a filter option is desired; otherwise drop the filter-by-state feature entirely)
- Regenerate: `apps/cli/src/gql/*` via `pnpm --filter @thinkwork/cli codegen`
- Modify: `apps/cli/__tests__/commands/thread.test.ts` (update command tests — drop status/priority/type flag cases)

**Test scenarios:**

- Happy path: `thinkwork thread list` renders without referencing removed fields.
- Error path: `thinkwork thread update --status ...` errors with "unknown flag".
- Happy path: `thinkwork thread create --agent <id>` works without requiring type/priority.

**Verification:**

- `pnpm --filter @thinkwork/cli typecheck` passes.
- `pnpm --filter @thinkwork/cli test` passes.

---

- U11. **Cross-app codegen regen + post-deploy smoke**

**Goal:** Final sweep + empirical verification that the whole surface works end-to-end after deploy.

**Requirements:** R13, and cross-surface success criteria from origin.

**Dependencies:** U2–U10.

**Files:**

- Regenerate: `apps/admin/src/gql/*`, `apps/mobile/lib/gql/*`, `apps/cli/src/gql/*` — run `pnpm --filter admin codegen && pnpm --filter mobile codegen && pnpm --filter @thinkwork/cli codegen`
- Run: `pnpm schema:build` and commit any diff in `terraform/schema.graphql` (expect none for this cleanup)
- Create: `scripts/smoke-thread-cleanup.sh` (invokes `scripts/verify-thread-traces.ts` + curls `thread(id)` with every dropped field to confirm GraphQL errors + spot-checks admin/mobile/cli build outputs)
- Modify: `terraform/modules/app/lambda-api/main.tf` — add CloudWatch metric filters on the graphql-http Lambda's log group for `column "..." does not exist` + `relation "..." does not exist` patterns, plus CloudWatch alarms (threshold: sum ≥ 1 over 5-min period) wired to an existing SNS topic scoped to ops-only subscribers. Attach alongside the existing Lambda definition — no new module.

**Approach:**

- After all code PRs are deployed, run smoke on the dev stack:
  1. Create a thread via chat → confirm Trigger renders "Manual chat" in admin + mobile.
  2. Create a thread via schedule trigger → confirm Trigger renders "Schedule".
  3. Drive a thread to each lifecycle state → confirm badge matches.
  4. Curl `thread(id)` with removed fields — confirm GraphQL errors on each.
  5. If U8 keep-path: click through X-Ray deeplink and confirm a real trace opens.
- Per `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`, trust-the-green is the failure mode — this is a real invocation, not aggregate CI status.

**Execution note:** Smoke script lives in the repo; rerunnable for regression guarding.

**Test scenarios:** The smoke script IS the test. No separate unit coverage.

**Verification:**

- Script exits 0 on dev.
- No grep hits across the monorepo for `ThreadComment`, `MessageArtifact`, `ThreadPriority`, `ThreadType`, task-era `ThreadStatus` usages, `thread.parent`/`thread.children`, `thread.comments`, `message.artifacts`/`message.durableArtifact` (excluding commit history and this plan doc). **`ThreadAttachment` + `thread.attachments` remain** — reserved for upcoming feature.

---

- U13. **Infrastructure: provision `thinkwork-${stage}-backups` S3 bucket + enable `aws_s3` Aurora extension**

**Goal:** Make U5's `aws_s3.query_export_to_s3` calls executable. Without this, the pre-drop row-data backup fails silently and the rollback runbook is non-functional.

**Requirements:** Enables R14's row-recoverability posture.

**Dependencies:** None. Must merge before U5.

**Files:**

- Create or modify: `terraform/modules/data/s3-buckets/main.tf` (add a `thinkwork-${stage}-backups` bucket with SSE-KMS encryption, block public access, lifecycle rule for 90-day expiry on `pre-drop/` prefix, bucket policy limiting `GetObject`/`PutObject` to the Aurora IAM role + a named DBA role)
- Modify: `terraform/modules/data/aurora-postgres/main.tf` (attach an IAM role to the Aurora cluster granting `s3:PutObject` to the backups bucket; associate the role with the cluster parameter group)
- Post-deploy: `psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE"` (applied manually after the IAM role attaches; verify with `\dx aws_s3`)

**Approach:**

- Follow the `s3-buckets/main.tf` existing pattern (separate `aws_s3_bucket` + `aws_s3_bucket_policy` + `aws_s3_bucket_lifecycle_configuration` resources).
- IAM role trust policy allows `rds.amazonaws.com` to assume; permissions are `s3:PutObject` on `thinkwork-${stage}-backups/pre-drop/*` only.
- Bucket policy explicitly denies public access and restricts to the Aurora role + a DBA principal.
- 90-day lifecycle expiration on `pre-drop/` keeps storage cost bounded; can be extended if compliance requires.
- `CREATE EXTENSION aws_s3` is idempotent but needs `rds_superuser`; the deploy-pipeline DB user has this grant.

**Execution note:** Apply the Terraform changes + extension creation at least one deploy cycle before U5. Verify with a test `SELECT aws_s3.query_export_to_s3(...)` call against a 1-row probe table before merging U5.

**Patterns to follow:**

- Existing bucket definitions in `terraform/modules/data/s3-buckets/main.tf` (SSE-KMS, block-public-access defaults).
- Aurora IAM role pattern in `terraform/modules/data/aurora-postgres/main.tf` (if a precedent exists — search at implementation time).

**Test scenarios:**

- Happy path: `aws s3 ls s3://thinkwork-dev-backups/` returns no error (bucket exists, IAM lets the operator list).
- Happy path: test export `SELECT aws_s3.query_export_to_s3('SELECT 1 AS x', aws_commons.create_s3_uri('thinkwork-dev-backups', 'test.csv', 'us-east-1'), 'format csv')` returns `rows_uploaded = 1`.
- Error path: invoking from a DB role without the attached IAM role returns a permission error, not silent success.

**Verification:**

- Terraform plan + apply succeeds against dev.
- `\dx aws_s3` in psql shows extension installed.
- `aws s3 ls s3://thinkwork-dev-backups/pre-drop/` works from operator shell with the DBA role.

---

- U12. **Prerequisite migration: add `thread_turns.kind` column**

**Goal:** Add the column that U2's new `escalateThread`/`delegateThread` writers rely on. Today the table has `status` but no `kind` column, no CHECK, no pg enum.

**Requirements:** R1 (indirectly — enables U2's system-event migration path).

**Dependencies:** None. Must merge before U2.

**Files:**

- Create: `packages/database-pg/drizzle/0026_thread_turns_add_kind.sql` (hand-rolled, verify next available NNNN at author time)
- Modify: `packages/database-pg/src/schema/scheduled-jobs.ts` (add `kind` column declaration on `threadTurns` table)

**Approach:**

```sql
-- Apply manually: psql "$DATABASE_URL" -f packages/database-pg/drizzle/0026_thread_turns_add_kind.sql
-- creates-column: public.thread_turns.kind
-- creates: public.idx_thread_turns_kind

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.thread_turns ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'agent_turn';
CREATE INDEX IF NOT EXISTS idx_thread_turns_kind ON public.thread_turns(kind);

COMMIT;
```

- Plain `text` column, no CHECK, matching the existing `status`/`channel`/`role` convention (per research).
- `DEFAULT 'agent_turn'` backfills existing rows without a separate UPDATE.
- Index on `kind` supports future queries that filter timeline events by type.

**Execution note:** Apply to dev first; paste `\d+ thread_turns` into PR. Shippable as a standalone small PR well before U2.

**Patterns to follow:**

- `packages/database-pg/drizzle/0023_tenants_deactivation.sql` (marker syntax + ADD COLUMN template).

**Test scenarios:**

- Happy path: applying adds the column with the default; existing rows query as `kind = 'agent_turn'`.
- Happy path: re-applying is a no-op (IF NOT EXISTS).
- Integration: `scripts/db-migrate-manual.sh` reports `public.thread_turns.kind` and `public.idx_thread_turns_kind` present; exit 0.

**Verification:**

- Applied to dev, `\d+ thread_turns` shows `kind text NOT NULL DEFAULT 'agent_turn'`.
- `scripts/db-migrate-manual.sh` exits 0.
- `pnpm --filter @thinkwork/database-pg build` passes.

---

## System-Wide Impact

- **Interaction graph:** escalateThread/delegateThread mutations migrate from `thread_comments` writer to `thread_turns` writer (U2). `createThread.mutation.ts` and the channel-writing Lambda handlers (`webhooks.ts`, `scheduled-jobs.ts`, `chat-agent-invoke.ts`, `wakeup-processor.ts`, `job-trigger.ts`) lose their `status`/`priority`/`type` write paths in PR 3a. All other removed fields had no downstream readers beyond the UI and their own resolvers. AppSync subscription schema (`terraform/schema.graphql`) is not expected to change — confirm with `pnpm schema:build`.
- **Error propagation:** Post-deploy, any client on a stale bundle querying removed fields gets a hard GraphQL error. Admin + mobile + CLI bundles must ship codegen regen in the same release window. Mobile TestFlight rollout lags App Store review — users on old builds will see GraphQL errors until they update. Consider a mobile server-side GraphQL client-version check, but that's out of scope here; at minimum, bump the mobile build number to force an in-app update prompt.
- **State lifecycle risks:** Destructive drop — row data for `thread_comments`/`artifacts`/`message_artifacts` is lost at DDL time (`thread_attachments` is preserved). Mitigated by the `\copy ... TO 's3://...'` pre-flight in U5 (recoverable from S3 CSV via `COPY FROM` if tenants need historical audit access), the `lock_timeout = '5s'` + `statement_timeout = '60s'` guards (fail fast instead of wedging the cluster under Aurora Serverless v2), and the committed-alongside `0027_rollback_thread_cleanup.sql` that re-creates empty shells for emergency roll-back.
- **API surface parity:** CLI and mobile expose the same semantic model as admin post-cleanup — lifecycle + channel + agent + turn aggregates. GraphQL `Thread` type shape is the single source of truth.
- **Integration coverage:** U4 (lifecycle resolver) and U2 (escalate/delegate refactor) need integration tests because turn-state transitions are not provable from unit mocks alone. U5 (migration) needs the `scripts/db-migrate-manual.sh` reporter gate (post-extension, `-- drops:` markers are recognized).
- **Observability during + after migration:** Post-deploy CloudWatch metric filters on `graphql-http` Lambda logs catch regression symptoms that the drift reporter can't see: `column "(status|priority|type|parent_id)" does not exist`, `relation "(thread_comments|artifacts|message_artifacts)" does not exist`. Alarm threshold 1 for the 30-min window after each deploy. Before/after `EXPLAIN (BUFFERS)` on the top 3 thread list queries catches seq-scan regressions from the `idx_threads_tenant_status` drop. `SELECT count(*) FROM threads` parity check confirms no row-count delta (DDL drops shouldn't affect rows; a delta is a red flag).
- **Query plan risk:** The list view's server-side sort is migrating from `status`/`priority` to `updated_at` (default) + `created_at`. Confirm `idx_threads_tenant_channel` (plus primary key index on `updated_at` if present) covers the new access path before merging U7.
- **Unchanged invariants:** `requireTenantAdmin` on every mutation that survives the sweep. Thread tenancy model (`tenant_id` row-derivation) stays. `thread_turns` timeline model stays — U2 adds new event kinds via U12's `kind` column, doesn't change `status` semantics. Activity timeline (`ExecutionTrace`) rendering of turns/tokens/tools stays. `cost_events` table stays even if U8 takes the remove path — it powers billing signals beyond this page. Aurora Serverless v2 single-writer topology stays; no topology changes required.

---

## Risks & Dependencies

| Risk                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand-rolled migration applied to dev but not production → drift gate fails the deploy | `scripts/db-migrate-manual.sh` is CI-enforced in `.github/workflows/deploy.yml` (per `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`). U5 extends the reporter to recognize `-- drops:` markers so destructive migrations are verifiable, not just the `-- creates:` sentinel pattern. Dev apply + PR `\d+` paste is the author-side defense. |
| `thread_turns.kind` column missing — U2 writes would fail immediately                 | U12 adds the column via a standalone pre-req migration with `DEFAULT 'agent_turn'` backfill. U2 depends on U12 explicitly.                                                                                                                                                                                                                                                                      |
| `message_artifacts` table left orphaned after `artifacts` drop                        | U5 now drops `message_artifacts` in the same migration (with explicit `CASCADE` on `artifacts`) and its schema declaration is removed from `packages/database-pg/src/schema/messages.ts`.                                                                                                                                                                                                       |
| Deploy pipeline skew window — Lambda updates before SQL applies                       | Split server work into PR 3a (stop reading/writing — U3 + U4) and PR 3b (schema drops — U5). After PR 3a deploys and stabilizes, no resolver or handler references the soon-to-be-dropped columns, making PR 3b's DDL a boring operation.                                                                                                                                                       |
| DDL `ACCESS EXCLUSIVE` locks wedge `threads` reads under live traffic                 | `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout = '60s'` inside the migration transaction. Fail fast on contention rather than blocking every resolver query behind the DDL. Run during lowest-traffic window even though no maintenance window is formally planned.                                                                                                              |
| Row data unrecoverable after destructive DROP                                         | Pre-flight `\copy ... TO PROGRAM 'aws s3 cp - s3://.../pre-drop/<table>.csv'` in 0026. Tenants get an S3-resident audit trail; `COPY FROM` is the recovery path.                                                                                                                                                                                                                                |
| Rollback plan exists only in commit history                                           | Commit `0027_rollback_thread_cleanup.sql` alongside the destructive migration. Reviewed at PR time, not composed at 2am under pressure. Re-creates empty shells + references the S3 CSVs for row restore.                                                                                                                                                                                       |
| Resolver errors in the 30-min post-apply window go unnoticed                          | CloudWatch metric filter + alarm (threshold 1) for `column "..." does not exist` / `relation "..." does not exist` in `graphql-http` Lambda logs. Added in U11 smoke script.                                                                                                                                                                                                                    |
| Query plan regression after dropping `idx_threads_tenant_status`                      | `EXPLAIN (BUFFERS)` diff on the top 3 thread list queries before/after — confirm `idx_threads_tenant_channel` or `uq_threads_tenant_number` covers the new access path.                                                                                                                                                                                                                         |
| Unexpected dependencies (view, matview, trigger, CHECK, FK) on dropped columns        | U1 pre-flight probe SQL enumerates all dependencies before U5 runs. Output pasted into the PR alongside `\d+`.                                                                                                                                                                                                                                                                                  |
| Handler write paths for status/priority/type missed in U3 audit                       | Explicit grep step in U3 Files section targeting `packages/api/src/handlers/{webhooks,scheduled-jobs,chat-agent-invoke,wakeup-processor}.ts` and `packages/lambda/job-trigger.ts`. Fail the PR review if any `status:` / `priority:` / `type:` write targeting `threads` remains.                                                                                                               |
| Historical escalate/delegate system-comment context lost from ExecutionTrace          | Documented as accepted data loss per origin. Pre-cutover escalations disappear from the timeline; acceptable for pre-launch. If audit continuity becomes a requirement, add a backfill step before U5 (one-shot `INSERT INTO thread_turns(kind, payload, ...) SELECT ...` from `thread_comments` matching the escalate/delegate pattern).                                                       |
| Mobile client on old bundle queries removed fields post-deploy                        | Bump mobile build number + TestFlight expedited review; accept short window of stale-bundle GraphQL errors for internal dogfooders.                                                                                                                                                                                                                                                             |
| `escalateThread`/`delegateThread` regression after U2 refactor                        | Characterization-first integration tests before the refactor; manual pass on both mutations before U2 merge.                                                                                                                                                                                                                                                                                    |
| `ThreadTraces` remove path deletes a feature operators were actually using            | U1 script + manual verification on dev gate the decision. Row counts on `cost_events` per tenant inform whether real usage exists.                                                                                                                                                                                                                                                              |
| Admin localStorage view-state rehydration crash on stale keys                         | Defensive filter on load in U7; stale cache self-heals.                                                                                                                                                                                                                                                                                                                                         |
| `ThreadChannel` label mapping loses `email` / `api` semantics                         | Label copy surfaces at PR review; `channel` column stays on the schema, so relabeling is a UI-only fix later.                                                                                                                                                                                                                                                                                   |
| Subscription schema drift (AppSync)                                                   | `pnpm schema:build` must run + produce no diff; if it does, inspect before committing.                                                                                                                                                                                                                                                                                                          |
| KanbanBoard rewrite takes longer than cleanup warrants                                | Default to delete in U7; only rewrite if a concrete operator need is named.                                                                                                                                                                                                                                                                                                                     |

---

## Alternative Approaches Considered

- **Deprecate-first, two-PR pair per removal.** Adds one codegen cycle per dropped field (~8 extra regenerations), no mitigation value (no external clients), and extends the window where UI and schema disagree. Rejected.
- **Keep `threads.status` column + rename values to lifecycle terms.** Would preserve filter/sort infra but muddles the derived-vs-manual distinction; operators would still be able to set an incorrect value via direct GraphQL. Derived-only via new enum is cleaner.
- **Add a new `trigger_source` column + backfill.** Redundant with `threads.channel` (populated by all 5 creation paths). Rejected in research phase.
- **Move `MessageArtifact` to `thread_artifacts` and keep a durable-output surface.** Conflates with the agent-workspace-files brainstorm (`docs/brainstorms/2026-04-21-agent-workspace-files-requirements.md`). Origin doc decided to drop; workspace-files is the replacement path.
- ~~**Ship U3 + U5 atomically in one PR.**~~ Rejected after deep-dive on `.github/workflows/deploy.yml`: terraform-apply updates Lambda code before the drift-check runs (and the drift-check is read-only — it never applies). "Atomic PR" was a misread; the real pipeline always has a skew window between Lambda update and `psql` apply. **Adopted instead:** PR 3a (stop reading + stop writing, no schema change) → stabilization window → PR 3b (schema drops). The stabilization window guarantees no live resolver references the soon-to-be-dropped columns.
- **Build admin component tests as part of this cleanup.** Admin has no Vitest setup; spinning one up is meaningful out-of-scope work. Deferred; covered by resolver integration tests + U11 smoke.

---

## Phased Delivery

### Phase 1 — Pre-gate & prep (U1, U13, U12, U2)

- PR 1: U1 — `scripts/verify-thread-traces.ts` + `scripts/pre-drop-row-counts.sql` + pre-flight dependency probe SQL. Merge once script runs clean on dev.
- PR 2: U13 — Terraform provisioning for `thinkwork-${stage}-backups` S3 bucket + Aurora IAM role + enable `aws_s3` extension. Must land + deploy before PR 5 (PR 3b).
- PR 3: U12 — `thread_turns.kind` column migration + schema declaration. Small, standalone, applies cleanly to dev + prod.
- PR 4: U2 — escalate/delegate refactor off `thread_comments`, writing `thread_turns` with `kind = 'system_event'`, adding `requireTenantAdmin` gates. Merge once integration tests pass.

### Phase 2 — Server (U3, U4 as PR 3a; U5 as PR 3b)

- **PR 3a (PR 5)** — U3 + U4 together: GraphQL schema drops + resolver removals + `ThreadLifecycleStatus` resolver + handler write-path grep + `createThread` stops writing status + `notifyThreadUpdate` status → lifecycleStatus rename + `requireTenantAdmin` gates added to `updateThread`/`threadTraces`/`thread.query`. **Schema files and Drizzle migration stay unchanged in this PR.** Merge + deploy, observe CloudWatch error filters for 24h.
- **PR 3b (PR 6)** — U5: hand-rolled Drizzle migration `0027_thread_cleanup_drops.sql` + `0027_rollback_thread_cleanup.sql` + `scripts/db-migrate-manual.sh` extension for `-- drops:` markers + schema file drops in `packages/database-pg/src/schema/{threads,messages,artifacts}.ts`. **HARD GATE: agent-workspace-files `ce-plan` doc merged + `ce-work` in flight before this PR merges.** Apply 0027 to dev, paste `\d+` + S3 CSV paths into PR description, deploy.

### Phase 3 — Client sweep (U6, U7, U8, U9, U10) — can run in parallel after PR 3a deploys

- PR 7: Admin right-rail cleanup + `ThreadLifecycleBadge` + Trigger row (U6); X-Ray header link inclusion conditional on U1 result.
- PR 8: Admin list view cleanup + KanbanBoard **deletion** (U7).
- PR 9: Traces branch (U8) — merges regardless of path; contents differ by U1 result.
- PR 10: Mobile sweep (U9).
- PR 11: CLI flag cleanup (U10).

### Phase 4 — Verification (U11)

- PR 12: codegen regen sweep + `scripts/smoke-thread-cleanup.sh` + CloudWatch metric filter + alarm (attached to `terraform/modules/app/lambda-api/main.tf`). Merge once smoke exits 0 on dev.

---

## Documentation Plan

- Write a learnings doc at `docs/solutions/patterns/pre-launch-thread-cleanup-2026-04-24.md` after PR 9 merges: document the migration shape, the deprecate-vs-hard-cut decision for intra-monorepo breaking changes, and the X-Ray verification script as a reusable pattern.
- Update `CLAUDE.md` if the `-- drops:` marker convention gets added to `scripts/db-migrate-manual.sh` in U5.
- No changelog/public docs update needed (pre-launch, no external consumers).

---

## Operational / Rollout Notes

- **Do not use `pnpm db:push`** for U5 or U12 — hand-rolled files are outside `meta/_journal.json` per CLAUDE.md. Apply with `psql "$DATABASE_URL" -f <file>` against dev, then the deploy pipeline's `terraform-apply` → `scripts/db-migrate-manual.sh` gate ensures prod parity.
- **Deploy sequencing, PR 3a → PR 3b:** PR 3a's Lambda update goes live first. No schema change in PR 3a, so readers/writers simply stop referencing the columns. Observe the 24h stabilization window. PR 3b applies the SQL via `psql` (manual step by the operator running the merge); the drift reporter then runs in CI and confirms the drops landed. If PR 3b's Lambda update somehow precedes the SQL apply — it's a no-op (no code references those columns anymore).
- **Lambda order within PR 3b:** not load-bearing. Since PR 3a already removed every resolver and handler reference to `status`/`priority`/`type`/`parent_id`, PR 3b's Lambda update is a schema-file + type-regen change only. Neither order produces runtime errors.
- **CloudWatch metric filters + alarms** go live in U11's smoke PR (PR 9) but must be created manually in the AWS console _before_ PR 3a deploys if catching regression early matters. Filters:
  - `{ $.message = "column \"*\" does not exist" }` on `/aws/lambda/thinkwork-<stage>-graphql-http`
  - `{ $.message = "relation \"*\" does not exist" }` on the same log group
  - Alarm on sum > 0 over a 5-min period; notify pre-launch on-call.
- **No feature flag.** All changes are intra-monorepo breaking; flags would add complexity without mitigation value.
- **Rollback:** U5 is destructive at the DDL level. Rollback procedure:
  1. Apply `packages/database-pg/drizzle/0027_rollback_thread_cleanup.sql` (re-creates empty shells for `status`/`priority`/`type` as `text NULL`, `parent_id` as `uuid NULL`, and the dropped tables with minimal columns).
  2. Restore row data from S3 CSVs via `COPY FROM`:
     ```
     psql "$DATABASE_URL" -c "\\copy thread_comments FROM PROGRAM 'aws s3 cp s3://thinkwork-${stage}-backups/pre-drop/thread_comments_2026_04_24.csv -' WITH CSV HEADER"
     ```
     Repeat for each dropped table.
  3. Roll back Lambda code to the pre-PR-3a image via `aws lambda update-function-code` (one-off exception to the "GraphQL deploys via PR" rule; document in the rollback runbook).
  4. Mobile + CLI clients keep working on their post-cleanup bundles because the restored schema is a _superset_ of what they expect.
  5. If point 3 isn't feasible, faster path is roll-forward with a patch PR. The rollback SQL + S3 CSVs are the "insurance" — written and reviewed at PR time, not composed at 2am.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-24-thread-detail-cleanup-requirements.md](../brainstorms/2026-04-24-thread-detail-cleanup-requirements.md)
- Related code: `packages/database-pg/src/schema/threads.ts`, `packages/database-pg/graphql/types/threads.graphql`, `apps/admin/src/routes/_authed/_tenant/threads/$threadId.tsx`
- Related learnings:
  - `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`
  - `docs/solutions/patterns/retire-thinkwork-admin-skill-2026-04-24.md`
  - `docs/solutions/best-practices/every-admin-mutation-requires-requiretenantadmin-2026-04-22.md`
  - `docs/solutions/workflow-issues/deploy-silent-arch-mismatch-took-a-week-to-surface-2026-04-24.md`
  - `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`
  - `docs/solutions/best-practices/inline-helpers-vs-shared-package-for-cross-surface-code-2026-04-21.md`
