---
title: Guarded Finalize Reconciliation + timed_out Manual Retry - Plan
type: fix
date: 2026-07-16
topic: guarded-finalize-reconciliation-timed-out-manual-retry
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Guarded Finalize Reconciliation + timed_out Manual Retry - Plan

## Goal Capsule

- **Objective:** A late finalize never silently flips a `timed_out` turn to `succeeded` — the transition is an explicit, logged reconciliation that also closes that turn's queued retries and defers to an existing recovery attempt — and the manual Retry affordance accepts `timed_out` turns, matching what the UI already renders as failed.
- **Product authority:** THINK-308, units U4+U5 (PR-D) of the parent plan `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (THINK-301, Eric Odom).
- **Open blockers:** None. Both units are self-contained in `packages/api`; no deploy-ordering constraint applies to this PR itself (the ordering constraint binds when the retry-dispatcher schedule first enables — THINK-307).

---

## Product Contract

### Summary

Give the chat-finalize `succeeded` write a status predicate so terminal verdicts are never blind-overwritten; reconcile `timed_out` explicitly — flip to `succeeded` and supersede queued retries when no recovery attempt exists, or leave the verdict standing when one does; close the origin's retry row as `succeeded` when a retry attempt itself finalizes successfully; and widen the manual-Retry server guard to accept `timed_out` linked turns alongside `failed`.

### Problem Frame

The stall monitor can mark a turn `timed_out` while its finalize callback is still in flight. Today the finalize path's succeeded write (`packages/api/src/lib/chat-finalize/process-finalize.ts:630-644`) matches on turn id alone, so it silently overwrites the verdict — the database self-heals beneath an error the user already saw and may have acted on, and the pending retry row enqueued with the verdict lives on to dispatch a duplicate turn. In the other direction, nothing ever writes `retry_queue.status = 'succeeded'` (parent discovery D3), so once automatic retry exists, a recovered turn's `dispatched` row would dangle forever and the recovery surface (THINK-309) would show "recovering" indefinitely. Separately, the manual-Retry mutation's async guard (`retryAgentDispatch.mutation.ts:203-215`) matches only `status = 'failed'`, while the web already treats `timed_out` as failed — so the one affordance offered on a timeout error is rejected server-side with `BAD_USER_INPUT`.

### Key Decisions

- **Late finalize wins unless a recovery attempt exists (parent Q3, adopted).** Under the silent-first recovery surface the user sees a benign working state during a stall verdict, so flipping `timed_out → succeeded` on late finalize is consistent with what was shown. The flip is explicit — logged, retry rows superseded in the same operation, UI notified — never a bare status write.
- **A `dispatched` retry row blocks the flip, same as an existing successor turn.** A `dispatched` row means a retry wakeup is enqueued but its attempt turn may not exist yet; flipping the origin to `succeeded` in that window invites two answers in the thread once the attempt materializes. The no-successor check therefore counts both successor attempt turns and non-terminal (`pending`/`dispatched`) retry rows in flight — a refinement of the parent text, which addressed only successor turns. Planning may relax this only with an argument that closes the race.
- **Guarding is CAS-style, not lock-based.** The succeeded write carries a status predicate (update … where status = expected), following the async-retry idempotency pattern; every interleaving of the 1-minute cron and finalize resolves explicitly.
- **U4 and U5 ship as one PR.** Both are status-integrity guards in `packages/api`; U5 is a one-line production change. Separate PRs add review overhead without isolation value (parent PR-D grouping).

### Requirements

**Finalize status guard + reconciliation (U4)**

- R1. The finalize `succeeded` status write applies only when the turn's current status is non-terminal (`running`/`queued`); a turn already in a terminal state is never silently overwritten. _(Parent R7.)_
- R2. When the turn is `timed_out` and no recovery attempt exists — no successor turn with `origin_turn_id` = this turn and no `pending`/`dispatched` retry row for it — finalize performs an explicit reconciliation: status set to `succeeded`, that turn's `pending` retry rows marked `superseded`, a structured reconciliation log line emitted, and the turn-update notification fired. _(Parent R5, R7, AE4.)_
- R3. When the turn is `timed_out` and a recovery attempt exists (successor turn or in-flight retry row per R2's definition), the origin's status stays `timed_out` and the status write is skipped, while the rest of finalize still completes — events, artifacts, `finalized_at`. The successor carries the thread's one answer. _(Parent R6.)_
- R4. The `finalized_at` idempotency claim gate is untouched; a duplicate finalize for an already-finalized turn still no-ops before any status logic runs.

**Retry-row closure (U4)**

- R5. When the finalizing turn is itself a retry attempt (its `origin_turn_id` is set) and finalize succeeds, the origin turn's `pending`/`dispatched` retry rows are marked `succeeded` — this is the write that ends the "recovering" state after a genuine recovery. _(Parent D3 lifecycle; first-ever writer of `succeeded`.)_
- R6. A retry attempt whose finalize does not succeed leaves the origin's retry rows untouched, so recovery continues or exhausts on its own schedule.

**Manual Retry guard (U5)**

- R7. The manual-Retry mutation's linked-turn guard matches `status IN ('failed', 'timed_out')`; a `timed_out` linked turn no longer earns `BAD_USER_INPUT`. Sender guard and sync-stamp path are unchanged. _(Parent R8.)_

### Key Flows

- F1. Late finalize, no recovery in flight
  - **Trigger:** A turn flagged `timed_out` by the stall monitor subsequently finalizes; no successor turn or in-flight retry row exists.
  - **Steps:** Claim gate passes; the status guard sees `timed_out`; reconciliation flips the turn to `succeeded`, supersedes its pending retry rows, logs, and notifies.
  - **Outcome:** One answer in the thread, DB ends `succeeded`, no retry ever dispatches. **Covers R1, R2.**
- F2. Late finalize racing an in-flight recovery
  - **Trigger:** The origin's finalize arrives after its retry row went `dispatched` (or a successor attempt turn already exists).
  - **Steps:** The status guard sees `timed_out` with a recovery attempt in flight; the origin keeps its verdict; finalize completes events, artifacts, and `finalized_at` without a status write.
  - **Outcome:** The successor attempt carries the thread's single answer; no double answer. **Covers R3, R4.**
- F3. Retry attempt recovers the turn
  - **Trigger:** A retry attempt turn (carrying `origin_turn_id`) finalizes successfully.
  - **Steps:** Finalize marks the origin's `dispatched` retry row `succeeded` in addition to its normal completion work.
  - **Outcome:** The retry-row lifecycle closes; the recovery surface can stop showing "recovering". **Covers R5.**
- F4. Manual Retry on a timeout
  - **Trigger:** A user clicks Retry on a message whose linked turn is `timed_out`.
  - **Steps:** `hasFailedLinkedTurn` matches the `timed_out` turn; the mutation proceeds and dispatches a new turn.
  - **Outcome:** Retry works wherever the UI offers it. **Covers R7.**

### Acceptance Examples

- AE1. **Covers R1, R2.** Given a turn marked `timed_out` with one `pending` retry row and no successor, when its finalize arrives, then the turn ends `succeeded`, the retry row ends `superseded`, a reconciliation line is logged, and the turn-update notify fires. _(Parent AE4.)_
- AE2. **Covers R3.** Given a `timed_out` turn with a successor attempt turn (or a `dispatched` retry row), when its finalize arrives, then its status stays `timed_out`, `finalized_at` is stamped, and the successor's retry rows are not superseded.
- AE3. **Covers R1.** Given a turn still `running`, when finalize arrives, then the plain `succeeded` write proceeds exactly as today.
- AE4. **Covers R4.** Given a turn already finalized (double-finalize race), when a second finalize arrives, then the claim gate no-ops it with no second status write.
- AE5. **Covers R5, R6.** Given a retry attempt turn with `origin_turn_id` O, when it finalizes successfully, then O's `dispatched` retry row is marked `succeeded`; when it instead fails, O's retry rows are untouched.
- AE6. **Covers R7.** Given a message whose only linked turn is `timed_out`, when `retryAgentDispatch` is called, then it proceeds without `BAD_USER_INPUT`; with no failed or timed-out linked turn at all it is still rejected.

### Scope Boundaries

- **Out of scope:** Wiring or guarding the retry dispatcher and the wakeup-processor retry branch — U3 (THINK-307). This unit shares only the `superseded` status semantics; the status column is plain text, so neither unit needs the other to land first and no migration is required.
- **Out of scope:** Recovery-state GraphQL fields and the web recovering/failure surface — U6 (THINK-309). This unit's R5 closure is what makes that surface's `recoveryPending` flag terminate.
- **Out of scope:** Stall-monitor detection, threshold knob, schedule flags — U1/U2 (THINK-305/306).
- **Out of scope:** Any change to the `finalized_at` claim-gate semantics or to the failure-path finalize writes.

### Dependencies / Assumptions

- No deploy-ordering constraint on this PR: parent Deploy ordering requires PR-D live before the retry-dispatcher schedule first enables (THINK-307's gate), not the other way around.
- `thread_turns.origin_turn_id` and `retry_queue.origin_turn_id` both exist with an index on the latter (`idx_retry_queue_origin_turn`); successor lookups need no schema change.
- The retry-attempt turn is created with `origin_turn_id` by the wakeup-processor retry branch (`packages/api/src/handlers/wakeup-processor.ts:1428-1429`), so R5's "is this a retry attempt" test reads the finalizing turn's own row.
- The `superseded` and `succeeded` retry statuses follow the parent D3 lifecycle: `pending → dispatched → succeeded` (attempt recovered), `pending → superseded` (origin recovered), `pending|dispatched → exhausted` (ceiling).

### Outstanding Questions

**Deferred to planning**

- Q1. Whether a successor attempt in a terminal failed state (`failed`/`cancelled`, retries exhausted) should still block the origin's `timed_out → succeeded` flip. Requirements adopt the simple rule — any successor blocks the flip, and exhausted recovery surfaces the manual-Retry failure state — but planning may find the late answer is recoverable in that corner and narrow the check.
- Q2. Where the current-status/`origin_turn_id` read happens — extending an existing turn fetch in the finalize path versus a guarded update with `RETURNING` — behavior is fixed by R1–R3, the plumbing is not.
- Q3. The exact shape of the structured reconciliation log line (fields, event name) so THINK-310's rollout monitoring can query it.

### Sources / Research

- Parent plan (authoritative unit spec U4/U5, Q3 resolution, D3 lifecycle, KTD ordering): `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md`, enriched on PR [#3826](https://github.com/thinkwork-ai/thinkwork/pull/3826).
- Unguarded succeeded write (id-only `where`): `packages/api/src/lib/chat-finalize/process-finalize.ts:630-644`; claim gate at `:156-176`.
- Manual-Retry guard matching only `failed`: `packages/api/src/graphql/resolvers/messages/retryAgentDispatch.mutation.ts:203-215`; `BAD_USER_INPUT` rejection at `:139-146`.
- Retry-queue schema, status comment lacking `superseded`, origin index: `packages/database-pg/src/schema/retry-queue.ts`.
- Turn schema with `origin_turn_id`/`retry_attempt`/`finalized_at`: `packages/database-pg/src/schema/scheduled-jobs.ts:102-165`.
- Wakeup retry branch stamping `origin_turn_id` on attempt turns: `packages/api/src/handlers/wakeup-processor.ts:1394-1429`.
- Sibling requirements artifact (shared `superseded` semantics, enable-ordering gate): `docs/plans/2026-07-16-002-fix-origin-aware-retry-dispatcher-plan.md` (THINK-307).
- CAS-guard precedent: async-retry idempotency work (MaximumRetryAttempts=0 + DLQ + CAS pattern).
