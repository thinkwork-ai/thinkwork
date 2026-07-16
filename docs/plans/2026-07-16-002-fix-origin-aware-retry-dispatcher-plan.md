---
title: Origin-Aware Retry Dispatcher, Wired and Backlog-Safe - Plan
type: fix
date: 2026-07-16
topic: origin-aware-retry-dispatcher
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Origin-Aware Retry Dispatcher, Wired and Backlog-Safe - Plan

## Goal Capsule

- **Objective:** Genuine agent stalls recover automatically — the retry dispatcher is actually scheduled for the first time — and a retry never dispatches when the origin turn already succeeded, is demonstrably progressing, or the queued row is stale backlog.
- **Product authority:** THINK-307, unit U3 (PR-C) of the parent plan `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (THINK-301, Eric Odom: "It needs to automatically retry the prompt.").
- **Open blockers:** None for planning/implementation. The dispatcher schedule must not first go ENABLED on a stage until U1 (THINK-305), U4+U5 (THINK-308), and U6 (THINK-309) are live there — see Dependencies.

---

## Product Contract

### Summary

Wire the existing-but-never-scheduled `cron-retry-dispatcher` Lambda into Terraform (handler registration + 1-minute schedule + `retry_dispatcher_enabled` variable) and, in the same PR, make it born-safe: skip and supersede a queued retry when the origin turn already succeeded or shows fresh activity, supersede stale backlog rows instead of dispatching them, and pair the recovered answer to the user's original message by copying `triggering_message_id` onto the retry-attempt turn.

### Problem Frame

Parent-plan discovery D1: `cron-retry-dispatcher` is built by `scripts/build-lambdas.sh` but registered nowhere in `terraform/` — no handler entry, no `aws_scheduler_schedule`. Automatic retry has never functioned; `retry_queue` rows enqueued by the stall monitor are never drained, so every affected stage carries a backlog of stale `pending` rows. Naively enabling the dispatcher would (a) mass-dispatch months of stale rows on first enable, (b) re-run prompts whose origin turn eventually succeeded (duplicate turns — 8 were cancelled by hand on McPherson 2026-07-15), and (c) produce recovered answers orphaned from the user's message, because the wakeup-processor retry branch does not carry the origin turn's `triggering_message_id`.

### Key Decisions

- **Dispatcher and safety guards land in one PR (parent KTD2).** The schedule is never live in a state where a stale backlog or a recovered origin can double-dispatch.
- **Skipped retries are recorded, not deleted.** A retry cancelled because the origin recovered or the row is stale backlog is marked with a new `superseded` status (parent D3); the column is plain text, so no migration is needed. The schema comment enumerates the new status.
- **Backlog safety is in-code, not a manual cleanup.** Rows whose `scheduled_at` is older than a 60-minute cutoff are superseded without dispatch. This is safe because the retry backoff cap is 300 seconds — no legitimate retry is ever scheduled that far out.
- **Existing dispatcher semantics are preserved.** `FOR UPDATE SKIP LOCKED` claiming and `max_attempts → exhausted` behavior stay as-is; this unit adds guards in front of dispatch, it does not redesign the queue.

### Requirements

- R1. The retry dispatcher runs on a 1-minute schedule registered in Terraform (`terraform/modules/app/lambda-api/handlers.tf`), with its enabled state controlled by a `retry_dispatcher_enabled` variable declared through module and root passthrough. _(Parent R4 — wiring half.)_
- R2. Before dispatching a claimed retry row, the dispatcher loads the origin turn and supersedes the row without dispatch when the origin's status is `succeeded`/`completed`. _(Parent R5, AE2.)_
- R3. A claimed row whose origin turn is `running` with `COALESCE(last_activity_at, started_at)` fresher than the stall threshold is superseded without dispatch — the turn recovered or was reconciled. _(Parent R5.)_
- R4. A claimed row whose `scheduled_at` is older than 60 minutes is superseded without dispatch, so first enable on a stage with stale backlog cannot mass-dispatch. _(Parent R2/R5, discovery D1.)_
- R5. A row that passes all guards dispatches via the existing `agent_wakeup_requests` insert (reason `retry`) and is marked `dispatched`, preserving current claiming and exhaustion behavior. _(Parent R2, R4.)_
- R6. The wakeup-processor retry branch copies `triggering_message_id` from the origin turn onto the attempt turn (looked up via `originTurnId`, no wakeup payload change), so the recovered answer pairs to the user's message and the per-message dispatch indicator follows the live attempt. _(Parent R6.)_
- R7. The `retry_queue` schema comment enumerates the `superseded` status alongside `pending | dispatched | succeeded | exhausted`.
- R8. During this unit, McPherson's live scheduler state for both crons (stall-monitor, retry-dispatcher) is inspected and recorded in the issue — customer stacks deploy through a pinned runner and can drift from repo Terraform. _(Parent D2 confirmation.)_

### Key Flows

- F1. Genuine stall dispatches a retry
  - **Trigger:** The 1-minute schedule fires with a due `pending` row whose origin turn is `timed_out` with no successor.
  - **Steps:** Dispatcher claims the row, guards pass, inserts an `agent_wakeup_requests` row (reason `retry`, `retryAttempt`/`originTurnId` payload), marks the row `dispatched`; the wakeup-processor runs the attempt turn carrying the origin's `triggering_message_id`.
  - **Outcome:** A recovery attempt runs, and its answer arrives paired to the user's original message. **Covers R1, R5, R6.**
- F2. Origin recovered before dispatch
  - **Trigger:** A due row whose origin turn finalized `succeeded`, or is `running` with fresh activity.
  - **Steps:** Dispatcher claims the row, the origin-state guard fires, row marked `superseded`, no wakeup insert.
  - **Outcome:** No duplicate turn appears in the thread. **Covers R2, R3.**
- F3. First enable on a backlogged stage
  - **Trigger:** `retry_dispatcher_enabled` first goes true on a stage carrying months of stale `pending` rows.
  - **Steps:** Each cron pass claims due rows; every row older than the 60-minute cutoff is marked `superseded` without dispatch.
  - **Outcome:** The backlog drains as superseded records; zero prompts re-run. **Covers R4.**

### Acceptance Examples

- AE1. **Covers R2.** Given a pending retry row whose origin turn reached `succeeded` before dispatch, when the dispatcher claims it, then the row ends `superseded` and no new turn appears in the thread. _(Parent AE2.)_
- AE2. **Covers R4.** Given a pending row with `scheduled_at` 2 hours old, when the dispatcher claims it, then it is superseded without any wakeup insert.
- AE3. **Covers R1, R5.** Given a due pending row whose origin is `timed_out` with no successor, when the dispatcher runs, then a wakeup with `retryAttempt`/`originTurnId` is inserted and the row is `dispatched`.
- AE4. **Covers R6.** Given a retry wakeup processed for an origin turn with `triggering_message_id` M, when the attempt turn is created, then it carries `triggering_message_id` M.
- AE5. **Covers R1, R8.** Given the unit deployed to dev, `aws scheduler` shows the retry-dispatcher schedule present with var-driven state, and McPherson's live scheduler state for both crons is recorded in THINK-307.

### Scope Boundaries

- **Out of scope:** The `succeeded` writer for retry rows and the `timed_out → succeeded` finalize reconciliation — both are U4 (THINK-308); this unit shares only the `superseded` status semantics.
- **Out of scope:** Recovery-state GraphQL fields and the web "recovering" surface — U6 (THINK-309).
- **Out of scope:** Stall-threshold knob and stall-monitor schedule flag — U2 (THINK-306); this unit follows the Terraform var patterns U2 establishes.
- **Out of scope:** Changes to retry-queue claiming (`FOR UPDATE SKIP LOCKED`), backoff, or `max_attempts → exhausted` semantics.
- **Deferred:** Any cleanup/archival of accumulated `superseded` rows; they are inert records.

### Dependencies / Assumptions

- **Enable ordering (parent Deploy ordering):** `retry_dispatcher_enabled` first goes true on a stage only after U1 (THINK-305), U4+U5 (THINK-308), and U6 (THINK-309) are live there — otherwise a genuine stall shows today's raw red banner while a silent retry produces a second answer. Merge order of the PRs is free; the constraint is on when the schedule first enables.
- U2 (THINK-306) lands first or alongside to establish the `handler_extra_env` / schedule-state var patterns this unit follows (`brain_dream_state_enabled` pattern, `handlers.tf:1956`).
- The wakeup-processor already threads `retryAttempt`/`originTurnId` into the attempt turn (`wakeup-processor.ts:1394-1429`); R6 extends that branch without changing the wakeup payload shape, avoiding the dual payload-builder parity trap.
- The stall threshold used by the R3 freshness guard is the same operational knob U2 introduces (default 5 minutes).

### Outstanding Questions

**Resolvable at Requirements Review (recommendation adopted for planning)**

- Q1. The parent plan's U3 files list says `retry_dispatcher_enabled` defaults `true`, while its Deploy ordering gates first-enable on U1/U4+U5/U6 being live and the issue states the flag "goes true only after" those units. Recommended resolution, adopted here: **declare the variable defaulting `false`** and flip it per stage (dev, prod, McPherson) once the prerequisite units are verified live — a default-true var makes the safety of the rollout depend on PR merge timing instead of an explicit operator action. Planning may instead keep default `true` and rely on PR-C merging last; the requirement either way is that the schedule is never ENABLED on a stage before U1, U4+U5, and U6 are live there.

**Deferred to planning**

- Q2. Whether the origin-turn freshness guard (R3) reads the threshold from the same env knob as the stall monitor or takes a module parameter — behavior is fixed (threshold-fresh activity means skip), the plumbing is not.

### Sources / Research

- Parent plan (authoritative unit spec, discoveries D1–D3, KTD2, Deploy ordering, Verification Contract V3): `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` — U3 section as enriched on PR [#3826](https://github.com/thinkwork-ai/thinkwork/pull/3826).
- Dispatcher (no origin-success check today): `packages/api/src/handlers/crons/retry-dispatcher.ts`; no test file exists yet.
- Wakeup retry branch (threads `retryAttempt`/`originTurnId`): `packages/api/src/handlers/wakeup-processor.ts:1394-1429`.
- Queue schema + status comment: `packages/database-pg/src/schema/retry-queue.ts`.
- Terraform registration point + schedule-state var pattern: `terraform/modules/app/lambda-api/handlers.tf` (`brain_dream_state_enabled` at `:1956`).
- Live-account verification (D1): dev/prod have `*-stall-monitor` schedules ENABLED but no retry-dispatcher schedule or function.
