---
date: 2026-04-24
topic: thread-detail-cleanup
---

# Thread Detail Screen Cleanup (Pre-Launch)

## Problem Frame

The Thread detail screen in the admin SPA still carries its task-tracker origins — Comments, Sub-tasks, Attachments, Artifacts, and task-style Properties (Status / Priority / Type) — from when threads were modeled as work items. Thinkwork has since shifted to an enterprise control-plane posture: a Thread is the audit surface for an agent run, not a Jira card. Several of those legacy sections either do nothing (Comments), half-work (Attachments, where upload is stubbed), or duplicate signal in more useful surfaces. Before launch, this page needs to stop inviting actions that aren't real and stop describing agent runs in task vocabulary.

---

## Actors

- A1. Enterprise operator (admin SPA): triages and audits agent threads. Primary user of this screen.
- A2. Agent runtime: produces the thread's activity timeline and any model-invocation traces.
- A3. Downstream implementer: executes the cleanup plan across admin, GraphQL, Drizzle schema, and mobile codegen.

---

## Requirements

**Removals — UI + schema**

- R1. Remove the Comments section from the thread detail page, including the "Leave a comment…" composer and the `ExecutionTrace` comments list. Drop `thread_comments` (table in `packages/database-pg/src/schema/threads.ts`), `ThreadComment` / `ThreadCommentsPage` GraphQL types, `AddThreadCommentMutation`, and `thread.comments` field.
- R2. Remove the Sub-tasks section from the right rail. Drop `threads.parent_id` column, the self-referential `parentChild` relation, the `parent` / `children` GraphQL fields on `Thread`, and any subtask-create affordance in `ThreadFormDialog`.
- R3. Remove the Attachments section from the right rail, including the stubbed upload path. Drop `thread_attachments` table, `ThreadAttachment` GraphQL type, `thread.attachments` field.
- R4. Remove the Artifacts section from the right rail. Drop `MessageArtifact` table and `message.artifacts` / `message.durableArtifact` GraphQL fields (`packages/database-pg/graphql/types/messages.graphql:23-33`). This commits to agent-workspace-files as the sole path for durable agent outputs.
- R5. Remove the `priority` column, `ThreadPriority` enum, `thread.priority` GraphQL field, and the Priority dropdown from the right rail.
- R6. Remove the `type` column, `ThreadType` enum (currently `TASK | BUG | FEATURE | QUESTION`), `thread.type` GraphQL field, and the Type dropdown from the right rail.

**Reshape — Status becomes derived lifecycle**

- R7. Replace the manual Status dropdown with a read-only, derived lifecycle badge driven by real thread state: `Running`, `Awaiting user`, `Completed`, `Failed`, `Idle`. No user edit.
- R8. Remove the manually-writable `threads.status` column and `ThreadStatus` enum in their task-era form. Source the derived badge from live signals (latest turn status, terminal state, heartbeat). Exact computation is deferred to planning.
- R9. Update the Threads list view and any filter surfaces that currently sort/filter on Status, Priority, or Type so they do not reference removed fields.

**Right-rail content after cleanup**

- R10. After removals, the right rail must still convey operator-useful context. Keep: Agent (with link to the agent page), Created, Last turn, and the derived Status badge. Add: Trigger source (Manual chat / Schedule / Automation / Webhook) and a summary line with total turns + total cost. If R12 is confirmed, surface an "Open in X-Ray" link on the thread header or inside activity rows.

**Traces — conditional on verification**

- R11. Verify end-to-end that the ThreadTraces view is receiving real X-Ray span rows for current Bedrock model invocations on threads. Record whether traces appear for a freshly-started thread on the `dev` stack.
- R12. If R11 confirms traces are flowing: keep `ThreadTraces` as a collapsed section and expose one X-Ray deep link on thread header (and/or per activity row). If R11 fails: remove the `ThreadTraces` component, `ThreadTracesQuery`, and any `TraceEvent` surface on this page. Do not ship a section that shows an empty state in production.

**Cross-app consistency**

- R13. Regenerate GraphQL codegen in every consumer that imports removed types or fields: `apps/admin`, `apps/mobile`, `apps/cli`, `packages/api`. Update mobile thread screens to not reference removed fields (mobile currently uses `ThreadTurnsForThreadQuery`, not the removed sections, but any `ThreadType` / `ThreadPriority` / `ThreadStatus` enum references need to be swept).
- R14. Ship schema removals as a new Drizzle migration; apply via the normal deploy pipeline. Keep any hand-rolled `.sql` for partial indices/FKs consistent with `pnpm db:migrate-manual` reporter markers (per CLAUDE.md).

---

## Success Criteria

- An enterprise operator loading a thread detail page sees only content that carries real information about that agent run; no dead composers, no stubbed uploads, no task-era vocabulary.
- No row in the right rail implies an action (comment, attach, sub-task) that the backend will not service.
- Status, when shown, reflects actual thread lifecycle derived from live state — never a user-entered value.
- Schema, GraphQL, and codegen across admin + mobile + CLI + api are internally consistent after the cleanup; no dangling references to removed types.
- A downstream implementer can execute the cleanup from this doc without re-litigating which sections stay, which get dropped, or what replaces Properties.

---

## Scope Boundaries

- Not redesigning the activity timeline (`ExecutionTrace`) itself. Messages, tokens, cost, and tool-call rendering stay as they are.
- Not replacing Comments with a new operator-notes feature. If that need emerges, it's a separate brainstorm.
- Not building the agent-workspace-files replacement for artifacts here — that concept lives in the 2026-04-21 agent-workspace-files brainstorm.
- Not migrating any existing parent/child thread relationships, task-status values, or priority/type data into new concepts. These rows just lose those columns.
- Not redesigning the thread list page beyond removing references to dropped filter fields.
- Not touching the Inbox (`apps/admin/src/routes/_authed/_tenant/inbox`) unless it directly references removed fields.

---

## Key Decisions

- **MessageArtifact is being dropped entirely, not deprecated.** Agent-workspace-files is the intended successor path; v1 accepts no durable agent file output via the Message/Artifact path during the transition.
- **Status stays, but as derived, read-only lifecycle.** A dedicated lifecycle signal is worth the screen real estate even after dropping the manual dropdown; it's the one task-era field with genuine operator value once repurposed.
- **Traces is conditional, not pre-decided.** Keep iff X-Ray is actually emitting spans end-to-end. Dead observability UI at launch is worse than no observability UI.
- **X-Ray verification runs as a scripted check before planning, not as a manual pass.** A small script that starts a thread on `dev`, triggers a Bedrock call, and inspects TraceEvent / X-Ray becomes the authoritative source for R12 and is reusable for future regression checks.
- **Trigger source is a net-new addition, not task-era polish.** The cleanup leaves the right rail thin; "how did this thread start" is the single most useful addition for enterprise triage.

---

## Dependencies / Assumptions

- Assumes `apps/mobile` does not display `thread.priority`, `thread.type`, `thread.children`, `thread.parent`, `thread.comments`, `thread.attachments`, or `message.artifacts` today beyond what codegen touches. Verify during planning.
- Assumes the Threads list view (`apps/admin/src/routes/_authed/_tenant/threads/index.tsx`) uses `status`, `priority`, or `type` as filter/sort inputs. Planning pass will enumerate call sites and update them.
- Assumes agent-workspace-files concept is the replacement path for durable agent file output and will land before, or concurrent with, this cleanup's GA. If workspace-files is not ready, R4 needs revisiting.
- Assumes dropping `threads.status`, `threads.priority`, `threads.type`, `threads.parent_id` and related tables (`thread_comments`, `thread_attachments`, `MessageArtifact`) is safe given these fields are either unused or were only populated under the retired task-tracker model. Data loss on pre-cleanup rows is acceptable.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R11, R12][Technical] Authoring the X-Ray verification script (start a dev thread, trigger a Bedrock call, inspect `TraceEvent` + X-Ray). R12 branches on its result.
- [Affects R7, R8][Technical] Exact computation of the derived Status badge: does "Awaiting user" come from a heartbeat signal, a tool-call pending-user-input marker, or something else? Depends on current turn-state model.
- [Affects R10][Technical] Does a `trigger source` field already exist on threads or thread_turns, or does this require a new column populated at thread-creation time from each trigger path (chat / job-trigger / webhook / automation)?
- [Affects R9, R13][Needs research] Full call-site enumeration of `ThreadType`, `ThreadPriority`, `ThreadStatus`, `thread.comments`, `thread.attachments`, `thread.parent`, `thread.children`, `message.artifacts`, `message.durableArtifact` across the monorepo.
- [Affects R14][Technical] Safe migration order for dropping columns with indexes (`idx_threads_tenant_status`, `idx_threads_parent_id`) and their hand-rolled `.sql` counterparts.

---

## Next Steps

-> `/ce-plan` for structured implementation planning. The X-Ray verification script is the plan's first task; its result drives R12.
