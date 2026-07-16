---
title: Agent Timeout Stall False Positives - Plan
type: fix
date: 2026-07-16
topic: agent-timeout-stall-false-positives
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-brainstorm
execution: code
---

# Agent Timeout Stall False Positives - Plan

## Goal Capsule

- **Objective:** Customers never see a timeout error for a turn the agent is actively working on, and genuine stalls recover automatically without a manual Retry click.
- **Product authority:** THINK-301 (Eric Odom) — "I do not want to show messages like this. It needs to automatically retry the prompt."
- **Open blockers:** None. Root cause is verified in code; open questions below are deferrable to planning or resolvable at Requirements Review.

---

## Product Contract

### Summary

Fix the stall-detection pipeline so that mid-turn runtime activity counts as activity (eliminating false `timed_out` verdicts on long chat turns), make automatic retry safe and invisible (no duplicate turns, no red error while recovery is in progress), and re-enable the currently-disabled McPherson stall monitor once the fix ships.

### Problem Frame

Customers report timeout errors in chat: "Timed out after 5m 43s — Agent dispatch failed: Stall detected: no activity for 5 minutes" with a Retry button. The screenshot in THINK-301 shows this on a turn that was actively streaming output.

The verified cause is not the AgentCore 8-hour session ceiling. The stall-monitor cron flags any `running` turn whose `last_activity_at` is older than 5 minutes. On the chat path, `last_activity_at` is written exactly once at dispatch and never bumped mid-turn — the runtime's activity event batches flow through `packages/api/src/handlers/chat-agent-activity.ts`, which appends events but never refreshes the stall clock. Only the wakeup-processor path bumps it. So every chat turn longer than 5 minutes is falsely marked `timed_out`, the user sees a red error, and a `retry_queue` row is enqueued.

The cascade compounds the harm three ways. The retry dispatcher re-runs the prompt without checking whether the origin turn eventually succeeded, producing duplicate turns (8 were cancelled by hand on McPherson on 2026-07-15). The finalize path later overwrites `timed_out` back to `succeeded` with no status guard, so the system self-heals in the database while the user already saw and possibly acted on the error. And as a demo stopgap, the McPherson stall-monitor schedule was disabled entirely on 2026-07-15 — meaning genuine stalls on that tenant currently go undetected until the monitor is re-enabled.

### Key Decisions

- **The 5m43s errors are stall-monitor false positives, not the AgentCore 8-hour limit.** All requirements target the stall pipeline. The 8-hour ceiling is real but no customer report matches it; it is scoped as messaging-only in v1 (see Scope Boundaries).
- **Keep stall detection; fix its activity signal.** Genuine stalls (runtime crash, lost callback) are real and the monitor is the only recovery path for them. The fix makes runtime activity count, not the monitor optional.
- **Recovery is silent-first.** While automatic recovery is in progress the user sees benign progress state, not a red error with a manual Retry button. The error surface is reserved for exhausted recovery.

### Requirements

**Detection correctness**

- R1. A turn with mid-turn runtime activity (tool calls, streaming text, activity event batches) is never marked `timed_out` while that activity continues, regardless of turn duration.
- R2. A turn with genuinely no runtime activity for the stall threshold is still detected and enters automatic recovery.
- R3. The stall threshold is a configurable operational knob rather than a hardcoded constant, with 5 minutes remaining the default.

**Automatic recovery**

- R4. A detected stall triggers automatic retry of the prompt without requiring the user to click Retry.
- R5. Retry never produces a duplicate turn: a queued retry is skipped when the origin turn has already succeeded or is demonstrably still progressing.
- R6. Retried turns produce exactly one final answer in the thread; superseded attempts are not shown as separate completed turns.

**Status integrity**

- R7. A terminal status transition is guarded: a turn marked `timed_out` is not silently overwritten to `succeeded` by a late finalize — the reconciliation is explicit and consistent with what the user was shown.
- R8. The manual Retry affordance works for `timed_out` turns as well as `failed` turns wherever it remains visible (today its guard checks only `failed`).

**User-facing surface**

- R9. While automatic recovery is in progress, the thread shows a benign working/recovering state — no red error text, no raw internal strings such as "Stall detected: no activity for 5 minutes".
- R10. Only when automatic recovery is exhausted does the user see a failure state, phrased in plain language with a manual Retry affordance.

**Operational rollout**

- R11. The McPherson stall-monitor schedule (disabled 2026-07-15 as a demo stopgap) is re-enabled as part of shipping this fix, on all affected stages.

### Key Flows

- F1. Long healthy chat turn
  - **Trigger:** User sends a prompt whose turn runs longer than the stall threshold while actively streaming and calling tools.
  - **Steps:** Runtime activity keeps the turn's activity signal fresh; the stall monitor observes recent activity and takes no action; the turn finalizes normally.
  - **Outcome:** No error shown, no retry enqueued, turn ends `succeeded`. **Covers R1.**
- F2. Genuine stall with silent recovery
  - **Trigger:** The runtime dies mid-turn; no activity arrives for the stall threshold.
  - **Steps:** Stall monitor detects the stall; automatic retry re-dispatches the prompt; the thread shows a working/recovering state throughout; the retried attempt completes.
  - **Outcome:** User sees one final answer and never a red error. **Covers R2, R4, R6, R9.**
- F3. Recovery exhausted
  - **Trigger:** Automatic retries hit the attempt ceiling without a successful turn.
  - **Steps:** Retry queue marks the work exhausted; the thread surfaces a plain-language failure with a manual Retry affordance.
  - **Outcome:** User understands the turn failed and can retry by hand. **Covers R8, R10.**
- F4. Late finalize after a stall verdict
  - **Trigger:** A turn marked stalled subsequently completes (slow finalize arrives after the verdict).
  - **Steps:** The finalize path reconciles explicitly with the stall verdict instead of blind-overwriting status; any pending retry for that turn is cancelled.
  - **Outcome:** Database status and what the user saw agree; no duplicate turn fires. **Covers R5, R7.**

### Acceptance Examples

- AE1. **Covers R1.** Given a chat turn that streams tool output continuously for 12 minutes, when the stall monitor runs each minute, then the turn is never marked `timed_out` and no `retry_queue` row is created.
- AE2. **Covers R5.** Given a turn falsely or transiently flagged with a pending retry row, when the origin turn reaches `succeeded` before the retry dispatches, then the retry is skipped and no second turn appears in the thread.
- AE3. **Covers R9, R10.** Given a runtime crash mid-turn with recovery in progress, when the user views the thread, then they see a working/recovering indicator; only after the final retry attempt fails do they see a failure message with Retry.
- AE4. **Covers R7.** Given a turn marked `timed_out`, when a late finalize for that turn arrives, then the outcome is an explicit reconciliation (not a silent flip to `succeeded` beneath an error the user already saw).

### Scope Boundaries

- **Deferred for later:** Graceful handling of the true AgentCore 8-hour session ceiling (checkpoint/resume or proactive turn splitting). v1 only guarantees that if the ceiling is ever hit, the user-facing message follows R10's plain-language rule rather than exposing raw internals.
- **Deferred for later:** A general turn-progress UI (elapsed time, live step display) beyond the benign working/recovering state R9 requires.
- **Out of scope:** Removing stall detection or the retry queue; both stay, corrected.
- **Out of scope:** Changes to the wakeup-processor path's existing mid-turn activity bump, which already behaves correctly.

### Dependencies / Assumptions

- The runtime→API activity event stream (`chat-agent-activity`) fires frequently enough during healthy turns to serve as the activity signal; batches arrive well within a 5-minute window whenever the model is producing output or calling tools. If planning finds gaps (for example a single very long silent tool execution), a runtime-side heartbeat supplements it.
- The McPherson re-enable command is recorded operationally (scheduler `thinkwork-mcpherson-stall-monitor`); R11 assumes operator access at ship time.
- Retry re-dispatch consumes the existing wakeup path (`agent_wakeup_requests` with reason `retry`); dedupe/CAS discipline from prior async-retry work applies.

### Outstanding Questions

**Resolve before planning**

- Q1. When automatic recovery succeeds after a genuine stall, should the user see any trace at all (a subtle "recovered" note) or nothing? Recommended: nothing — indistinguishable from a normal turn.

**Deferred to planning**

- Q2. Where the activity bump lives: piggyback on the existing activity event batch write versus a dedicated heartbeat — and the write-amplification trade-off of bumping per batch.
- Q3. Exact reconciliation semantics for R7 (which status wins, and how the pending retry row is cancelled) given the existing `finalized_at` idempotency key.
- Q4. Whether the stall threshold knob is per-stage Terraform, SSM, or env — and whether the retry attempt ceiling (currently 5) needs the same treatment.

### Sources / Research

- Grounding dossier with verified `file:line` evidence: `/tmp/compound-engineering/ce-brainstorm/think-301/grounding.md` (session-local; key pointers reproduced here).
- Detection: `packages/api/src/handlers/crons/stall-monitor.ts` (threshold L18, verdict write L72-76, retry enqueue L86-107).
- Missing heartbeat: `packages/api/src/handlers/chat-agent-activity.ts` (no `last_activity_at` write); contrast `packages/api/src/handlers/wakeup-processor.ts:2884-2888` (bumps it).
- Duplicate-turn risk: `packages/api/src/handlers/crons/retry-dispatcher.ts` (no origin-success check); `packages/database-pg/src/schema/retry-queue.ts`.
- Status race: `packages/api/src/lib/chat-finalize/process-finalize.ts:631-644` (unguarded succeeded write).
- Error surface: `apps/web/src/components/workbench/TaskThreadView.tsx:2183-2201`, `apps/web/src/components/workbench/turnHeader.ts:64-65`, `apps/web/src/components/workbench/dispatch-indicator.ts:128`; retry guard gap `packages/api/src/graphql/resolvers/messages/retryAgentDispatch.mutation.ts:135-145,211`.
- Prior related work: `docs/plans/2026-05-22-006-refactor-chat-agent-invoke-direct-callback-finalize-plan.md` (chat-invoke Lambda timeout/retry cascade, same symptom family); `docs/solutions/diagnostics/eval-runner-stall-findings-2026-05-16.md`.
- 8-hour ceiling reference: `packages/agentcore-pi/agent-container/src/runtime/sandbox-factory.ts:83`.

---

## Planning Contract

> **Product Contract preservation:** Product Contract unchanged. All planning content below enriches, never rewrites, R1–R11 / F1–F4 / AE1–AE4.

### Planning Discoveries (verified 2026-07-16, planning phase)

- **D1. The retry dispatcher has never run.** `cron-retry-dispatcher` is built by `scripts/build-lambdas.sh` (P2 cron loop) but is registered nowhere in `terraform/` — no handler entry, no `aws_scheduler_schedule`. Verified live: the AWS account hosting dev + prod has `thinkwork-{dev,prod}-stall-monitor` schedules ENABLED and `*-api-cron-stall-monitor` Lambdas, but no retry-dispatcher schedule or function. Consequence: `retry_queue` rows enqueued by the stall monitor are never drained; R4 requires wiring the dispatcher, and every affected stage carries a backlog of stale `pending` rows that must not mass-dispatch on first enable.
- **D2. Duplicate-turn mechanism reattributed.** With no dispatcher running, the McPherson duplicate turns (8 cancelled by hand 2026-07-15) most plausibly came from users clicking Retry on false-positive red errors, not from automatic retries (to confirm on McPherson's stack during U3 — customer stacks can drift from repo Terraform). Either way U3's origin-aware dispatch plus U1's false-positive elimination close both paths.
- **D3. `retry_queue.status = 'succeeded'` has no writer.** The schema comment enumerates `pending | dispatched | succeeded | exhausted`, but nothing ever writes `succeeded`. The column is plain text (no CHECK), so U3/U4 introduce `superseded` for retries cancelled because the origin turn recovered, without a migration — and U4 finally gives `succeeded` its writer (a retry attempt that finalizes successfully closes its origin's `dispatched` row). Retry-row lifecycle after this plan: `pending → dispatched → succeeded` (attempt recovered) / `pending → superseded` (origin recovered or stale backlog) / `pending|dispatched → exhausted` (ceiling hit).
- **D4. The stall-monitor schedule state is hardcoded `ENABLED`** (`terraform/modules/app/lambda-api/handlers.tf:2463`). The McPherson disable was done out-of-band in the console, so any Terraform apply on that stack would silently re-enable the broken monitor before this fix ships. U2 codifies an enable var; U7 owns the flip.
- **D5. The web already treats `timed_out` as failed** (`FAILED_TURN_STATUSES = {failed, timed_out}` in `apps/web/src/components/workbench/dispatch-indicator.ts:59`) and renders raw `turn.error` as the banner text, while the manual-retry mutation's async guard accepts only `status = 'failed'` (`retryAgentDispatch.mutation.ts:211`) — the R8 gap, confirmed.

### Resolved Questions

- **Q1 (silent recovery trace): show nothing.** A recovered turn is indistinguishable from a normal turn. (Adopted recommendation; recorded per LFG-style autonomy for the planning phase.)
- **Q2 (activity-bump placement): piggyback on the activity endpoint, throttled.** `chat-agent-activity.ts` already loads the turn row per request; add `last_activity_at` to that select and bump it only when NULL or older than 60 seconds. Healthy turns emit event batches well inside any 5-minute window, so no dedicated runtime heartbeat is needed in v1; if verification exposes a long fully-silent tool execution, a runtime-side heartbeat is a named follow-up, not a v1 blocker.
- **Q3 (R7 reconciliation semantics): late finalize wins unless a successor attempt exists.** Under R9 the user sees a benign working state during the stall verdict — never a red error — so flipping `timed_out → succeeded` on late finalize is _consistent with what the user was shown_. (This rationale is fully honest only once U6 ships; the deploy ordering below therefore puts the U6 surface live before automatic retry turns on.) The flip must be explicit: log the reconciliation, supersede any pending retry rows for that origin turn in the same operation, and notify the UI. If a retry attempt already produced a successor turn, the origin stays `timed_out` (superseded) and the successor carries the answer (R6: exactly one final answer). The `finalized_at` claim gate is untouched.
- **Q4 (knob location): Lambda env var via Terraform.** `STALL_THRESHOLD_MINUTES` env var on `cron-stall-monitor` (default `5`), injected through the existing `handler_extra_env` pattern and surfaced as a module var with root-module passthrough. The retry attempt ceiling stays the `retry_queue.max_attempts` DB default (5) — no second knob in v1.

### Key Technical Decisions

- **KTD1. Bump the stall clock server-side in the activity endpoint, not runtime-side.** The runtime already POSTs batches best-effort; the API is the single writer of `thread_turns` and can throttle writes. No Pi/runtime image change needed for R1.
- **KTD2. Ship the retry dispatcher and its safety guard in the same PR.** The dispatcher is born origin-aware (skip when origin succeeded / superseded) and backlog-safe (expire rows older than a cutoff instead of dispatching them). Never enable the schedule in a state where a stale backlog or a recovered origin can double-dispatch.
- **KTD3. Recovery visibility is derived server-side and exposed over GraphQL, not inferred client-side.** The turn type gains recovery-state fields (pending-recovery flag + attempt linkage) resolved from `retry_queue` and `thread_turns.origin_turn_id`, so web/mobile render "recovering" vs "failed" from server truth. Schema + resolver + consumer codegen land in one PR (schema/resolver drift is a known cold-start outage vector).
- **KTD4. Plain-language copy is keyed off status, not `turn.error`.** For `timed_out` turns the UI never renders raw internals like "Stall detected: no activity for 5 minutes"; the raw string stays in the DB/error field for operators.
- **KTD5. Threshold/enable knobs live in Terraform env + schedule vars,** matching existing `handlers.tf` patterns (`handler_extra_env`, `state = var.x_enabled ? "ENABLED" : "DISABLED"`). New root vars must be declared in `terraform/examples/greenfield/main.tf` and module passthrough or all deploys fail (known trap).

---

## High-Level Technical Design

Corrected stall pipeline (F1–F4 mapped onto components):

```mermaid
sequenceDiagram
    participant RT as Pi runtime
    participant ACT as chat-agent-activity (U1)
    participant DB as thread_turns / retry_queue
    participant SM as stall-monitor cron (U2)
    participant RD as retry-dispatcher cron (U3)
    participant WP as wakeup-processor
    participant FIN as process-finalize (U4)
    participant UI as web thread UI (U6)

    RT->>ACT: activity event batch (mid-turn)
    ACT->>DB: bump last_activity_at (throttled ≥60s)
    Note over SM: every 1 min
    SM->>DB: flag running turns idle > STALL_THRESHOLD_MINUTES<br/>→ timed_out + retry_queue(pending)
    RD->>DB: claim due pending rows
    alt origin succeeded or fresh activity
        RD->>DB: mark retry superseded (no dispatch)
    else genuine stall
        RD->>WP: agent_wakeup_requests reason='retry'
        WP->>DB: new attempt turn (origin_turn_id linkage)
    end
    FIN->>DB: finalize: succeeded write now status-guarded;<br/>timed_out → explicit reconciliation + supersede pending retries
    DB-->>UI: turn status + recoveryPending + attempt linkage
    Note over UI: timed_out + recovery pending → benign "still working"<br/>exhausted → plain-language failure + Retry (works for timed_out)
```

State rules after this plan:

- `running` + fresh activity → untouched (R1).
- `running` + idle past threshold → `timed_out` + pending retry (R2).
- `timed_out` + late finalize, no successor → `succeeded` (explicit reconciliation) + retries superseded (R7, R5).
- `timed_out` + successor attempt exists → origin stays `timed_out`/superseded; successor carries the one answer (R6).
- retry exhausted → UI failure state, plain language, manual Retry enabled for `timed_out` (R8, R10).

---

## Implementation Units

Dependency order: U1 and U2 are independent and land first; U3 depends on U2's Terraform var patterns and must deploy after/with U1; U4+U5 are independent of U3 but before U6; U6 depends on U3's retry-state semantics; U7 is the operational tail gated on U1–U4 being live.

### U1. Mid-turn activity bumps the stall clock

- **Goal:** Runtime activity event batches (and document emissions) refresh `thread_turns.last_activity_at`, so an actively-working turn never looks stalled.
- **Requirements:** R1 (F1, AE1)
- **Dependencies:** none
- **Files:** `packages/api/src/handlers/chat-agent-activity.ts`, `packages/api/src/handlers/chat-agent-activity.test.ts`
- **Approach:** Add `last_activity_at` to the existing turn-lookup selects (both the events branch and the `document.emit` branch). After validation succeeds, bump `last_activity_at = NOW()` only when the fetched value is NULL or older than 60 seconds (write-amplification throttle). The bump is failure-isolated exactly like the notify path: a bump error logs and never fails the request. The wakeup-processor's existing bump (`wakeup-processor.ts:2884-2888`) is untouched (out of scope per Product Contract).
- **Patterns to follow:** best-effort/failure-isolated side-writes already in this handler (born-artifact upsert, notify).
- **Test scenarios:**
  - Covers AE1 (detection half). Event batch on a turn whose `last_activity_at` is 5 minutes old → row updated to now.
  - Event batch on a turn bumped 10 seconds ago → no second write (throttle).
  - `last_activity_at` NULL → bump written.
  - `document.emit` branch bumps the clock too.
  - Bump write throws → request still returns 200 with events appended.
  - 404 turn-not-found path performs no bump.
- **Verification:** With U1 deployed to dev, a chat turn streaming activity for >6 minutes keeps a fresh `last_activity_at` in the dev DB and is never flagged by the live stall monitor (see Verification Contract V1).

### U2. Configurable stall threshold + schedule enable flag

- **Goal:** The stall threshold becomes an operational env knob (default 5 minutes) and the stall-monitor schedule state becomes a Terraform variable instead of hardcoded `ENABLED`.
- **Requirements:** R3; enabler for R11 (D4)
- **Dependencies:** none
- **Files:** `packages/api/src/handlers/crons/stall-monitor.ts`, `packages/api/src/handlers/crons/stall-monitor.test.ts`, `terraform/modules/app/lambda-api/handlers.tf`, module variables + `terraform/modules/thinkwork` passthrough, `terraform/examples/greenfield/main.tf`
- **Approach:** Replace the `STALL_THRESHOLD_MINUTES` const with a function that reads `process.env.STALL_THRESHOLD_MINUTES` (default 5, clamp to sane range) — read inside the handler, not at module load (vitest env-capture trap). Inject via `handler_extra_env` for `cron-stall-monitor`. Change the schedule to `state = var.stall_monitor_enabled ? "ENABLED" : "DISABLED"` (default `true`), following the `brain_dream_state_enabled` pattern at `handlers.tf:1956`. Declare the new vars through module passthrough and greenfield root (KTD5).
- **Test scenarios:**
  - Env unset → 5-minute predicate (existing behavior preserved).
  - `STALL_THRESHOLD_MINUTES=15` → 15-minute predicate and matching error string.
  - Invalid env value (`"abc"`, `"0"`) → falls back to 5.
- **Verification:** `terraform plan` on dev shows only the env var + schedule-state additions; deployed dev stall monitor still flags a synthetic idle turn at the default threshold (Verification Contract V2 exercises the verdict path).

### U3. Origin-aware retry dispatcher, wired and backlog-safe

- **Goal:** Genuine stalls automatically retry (dispatcher actually scheduled for the first time), and a retry never dispatches when the origin turn already succeeded, is demonstrably progressing, or the row is stale backlog.
- **Requirements:** R2, R4, R5 (F2, AE2)
- **Dependencies:** U2 (Terraform var patterns); deploy after/with U1 so false positives stop before automatic retry turns on.
- **Files:** `packages/api/src/handlers/crons/retry-dispatcher.ts`, `packages/api/src/handlers/crons/retry-dispatcher.test.ts` (new — none exists), `packages/api/src/handlers/wakeup-processor.ts` (retry-attempt turn message pairing), `packages/database-pg/src/schema/retry-queue.ts` (status comment only), `terraform/modules/app/lambda-api/handlers.tf` (register `cron-retry-dispatcher` in the handler set + new `aws_scheduler_schedule`, rate 1 minute, `retry_dispatcher_enabled` var default `true`), module/root var passthrough
- **Approach:** Per claimed row, before enqueueing the wakeup: (a) load the origin turn; if its status is `succeeded`/`completed` → mark the row `superseded`, skip (AE2); (b) if the origin is `running` with `COALESCE(last_activity_at, started_at)` fresher than the stall threshold → `superseded`, skip (turn recovered or was reconciled); (c) **backlog guard:** rows whose `scheduled_at` is older than a cutoff (60 minutes) → mark `superseded` without dispatch, so first enable on a stage with months of stale pending rows (D1) cannot mass-dispatch (safe: the backoff cap is 300s, so no legitimate retry is ever scheduled that far out); (d) otherwise dispatch the existing `agent_wakeup_requests` insert (reason `retry`) — the wakeup-processor already threads `retryAttempt`/`originTurnId` into the new attempt turn (`wakeup-processor.ts:1394-1429`). **Message pairing:** the wakeup-processor's retry branch must also copy `triggering_message_id` from the origin turn onto the attempt turn (looked up via `originTurnId` — no payload change, so the dual payload-builder parity trap is avoided); without it the recovered answer arrives orphaned from the user's message and the per-message dispatch indicator stays bound to the dead origin. Update the schema comment to enumerate `superseded`. Keep `FOR UPDATE SKIP LOCKED` claiming and `max_attempts → exhausted` behavior as-is.
- **Execution note:** The Terraform schedule and the guard logic must land in the same PR — the dispatcher goes live already-safe (KTD2).
- **Test scenarios:**
  - Covers AE2. Pending row due, origin turn `succeeded` → row `superseded`, no wakeup insert.
  - Pending row due, origin `timed_out`, no successor → wakeup inserted with `retryAttempt`/`originTurnId` payload; row `dispatched`.
  - Origin `running` with fresh activity → `superseded`, no wakeup.
  - Row with `scheduled_at` 2 hours old → `superseded` (backlog guard), no wakeup.
  - Wakeup-processor retry branch: attempt turn carries the origin turn's `triggering_message_id`.
  - `attempt >= max_attempts` → `exhausted` (existing behavior preserved).
  - Batch claiming untouched: two due rows processed in one run.
- **Verification:** Dev `aws scheduler` shows `retry-dispatcher` ENABLED; seeding a synthetic pending row for a succeeded origin turn drains it as `superseded` with no new turn in the thread; Verification Contract V3 proves the genuine-stall path end to end in the browser. During this unit, also confirm McPherson's live scheduler state for both crons (D2) and record it in the issue.

### U4. Guarded finalize reconciliation

- **Goal:** A late finalize never silently flips `timed_out → succeeded`; the transition is an explicit, logged reconciliation that also cancels pending retries — and it defers to an existing successor attempt.
- **Requirements:** R5, R7 (F4, AE4)
- **Dependencies:** none (semantics shared with U3's `superseded` status)
- **Files:** `packages/api/src/lib/chat-finalize/process-finalize.ts`, `packages/api/src/lib/chat-finalize/process-finalize.test.ts`
- **Approach:** Give the succeeded write (`process-finalize.ts:629-644`) a status predicate. Normal path: update only when current status is non-terminal (`running`/`pending`/etc.). When the current status is `timed_out`: run the explicit reconciliation branch per Q3 — if no successor attempt turn exists (`thread_turns.origin_turn_id = turnId`), set `succeeded`, mark that turn's pending `retry_queue` rows `superseded`, log a structured reconciliation line, and notify; if a successor exists, leave the origin `timed_out` and skip the status write (the successor carries the answer, R6) while still completing the rest of finalize (events, artifacts, `finalized_at`). **Retry-row closure:** when the finalizing turn is itself a retry attempt (its row carries `origin_turn_id`), a successful finalize marks the origin's `pending`/`dispatched` retry rows `succeeded` — this is what ends the "recovering" state after a genuine recovery (D3 lifecycle; without it, `dispatched` rows dangle forever and U6 would show recovering indefinitely). The `finalized_at` claim gate (`:156-172`) is untouched.
- **Patterns to follow:** CAS-style guarded updates from the async-retry idempotency work (update … where status = expected).
- **Test scenarios:**
  - Covers AE4. Turn `timed_out`, no successor, finalize arrives → status `succeeded`, pending retry rows `superseded`, reconciliation logged, notify fired.
  - Turn `timed_out`, successor attempt exists → status stays `timed_out`, finalize still stamps `finalized_at`, no retry supersede of the successor's rows.
  - Turn `running` → plain succeeded write (existing behavior).
  - Turn already `succeeded` (double finalize race) → no duplicate status write; claim gate still dedupes.
  - Finalizing turn is a retry attempt (has `origin_turn_id`) and succeeds → origin's `dispatched` retry row marked `succeeded`.
  - Finalizing retry attempt fails → origin's retry rows untouched (recovery continues or exhausts).
- **Verification:** Verification Contract V2 drives this in the browser: a turn flagged `timed_out` mid-flight that then finalizes shows one answer, DB ends `succeeded`, and its retry row is `superseded`.

### U5. Manual Retry works for timed_out turns

- **Goal:** The Retry affordance's server guard accepts `timed_out` linked turns, matching what the UI already renders as failed.
- **Requirements:** R8 (F3)
- **Dependencies:** none
- **Files:** `packages/api/src/graphql/resolvers/messages/retryAgentDispatch.mutation.ts`, `packages/api/src/graphql/resolvers/messages/retryAgentDispatch.mutation.test.ts`
- **Approach:** Widen `hasFailedLinkedTurn` (`:203-215`) to match `status IN ('failed', 'timed_out')`. Sender guard and sync-stamp path unchanged.
- **Checkpoint note:** grouped into U4's PR — same package, same status-integrity review context, one-line production change.
- **Test scenarios:**
  - Linked turn `timed_out` → mutation proceeds (no BAD_USER_INPUT).
  - Linked turn `failed` → still proceeds; no linked failure at all → still rejected.
- **Verification:** In the dev browser, a turn left in exhausted/failure state after V4 accepts a manual Retry click and dispatches a new turn.

### U6. Silent-first recovery surface (GraphQL + web)

- **Goal:** While recovery is in progress the thread shows a benign working state; only exhausted recovery shows a plain-language failure; superseded attempts collapse to one final answer; raw internal strings never render.
- **Requirements:** R6, R9, R10, Q1 (F2, F3, AE3)
- **Dependencies:** U3 (retry-state semantics), U4 (reconciliation semantics)
- **Files:** `packages/database-pg/graphql/types/*.graphql` (thread-turn type), `packages/api/src/graphql/resolvers/threads/types.ts` (+ its test), `apps/web/src/components/workbench/dispatch-indicator.ts` + test, `apps/web/src/components/workbench/turnHeader.ts` + test, `apps/web/src/components/workbench/TaskThreadView.tsx`, codegen outputs in `apps/web`, `apps/cli`, `apps/mobile`, `packages/api`
- **Approach:** Expose server-derived recovery state on the turn type (KTD3): `recoveryPending: Boolean` (a `pending`/`dispatched` retry row exists for this turn — U4's retry-row closure guarantees these go terminal after recovery, so `recoveryPending` cannot stick) and `originTurnId: ID` (attempt linkage, already persisted on `thread_turns`). Resolver joins `retry_queue` by `origin_turn_id` (indexed). Web behavior: `timed_out` + `recoveryPending` → indicator state `recovering` rendered as the normal working affordance (no red, no raw error — R9/AE3); `timed_out`/`failed` without pending recovery → failure state whose copy is plain language keyed off status (KTD4), e.g. "This response took too long. It was automatically retried without success — you can retry now." with the Retry button (R10); a turn whose successor attempt exists renders collapsed/hidden in favor of the successor so the thread shows exactly one final answer (R6); successful recovery shows no trace (Q1). Run codegen in all four consumers; schema + resolver ship together (drift = cold-start outage). AppSync subscription schema is untouched unless the notify payload type changes — avoid changing it.
- **Checkpoint note:** API schema/resolver + web UI in one PR, justified: the web change is unusable without the schema fields, and shipping the schema without its consumer invites drift; codegen must be regenerated once, atomically.
- **Test scenarios:**
  - Covers AE3. `deriveDispatchIndicatorState`: `timed_out` + `recoveryPending` → `recovering` (not `failed`).
  - `timed_out`, no recovery pending → `failed` with plain-language reason; raw `turn.error` "Stall detected…" never surfaces in the rendered string.
  - `failed` (non-stall) turns keep existing behavior.
  - Resolver: turn with a `pending` retry row → `recoveryPending: true`; with only `superseded`/`exhausted` rows → `false`.
  - Thread with origin turn + successor attempt → list renders one visible answer (successor), origin collapsed.
  - turnHeader: `timed_out` label no longer exposes raw stall internals.
- **Verification:** Verification Contract V3/V4 in a real browser against deployed dev: recovering state during a genuine stall drill, plain-language failure + working Retry after exhaustion, exactly one answer after recovery.

### U7. Re-enable the McPherson stall monitor + staged rollout

- **Goal:** The disabled McPherson stall monitor is re-enabled (as code, not console state) once the corrected pipeline is live, and the rollout is verified on every affected stage.
- **Requirements:** R11
- **Dependencies:** U1–U4 deployed to the affected stages (U6 strongly preferred first so any genuine stall renders correctly).
- **Files:** stage/tenant Terraform configuration for McPherson (customer-stack vars; exact file determined by the customer deploy runner layout), plus an ops note in the issue/Progress doc. No application code.
- **Approach:** With U2's `stall_monitor_enabled` var in place, set it explicitly per stage: dev/prod already ENABLED stay true; McPherson flips from its out-of-band console DISABLED to var-driven `true`. Mind the customer-runner ledger: McPherson deploys through the pinned customer runner, so confirm the runner version carries U1–U4 before flipping (a Terraform apply with the old code would re-enable the broken monitor — D4). Record before/after `aws scheduler get-schedule` evidence.
- **Test scenarios:** Test expectation: none — configuration/operations unit; verification is live evidence.
- **Verification:** Verification Contract V5: McPherson scheduler shows ENABLED via var-driven state; ≥1 business day with zero false-positive `timed_out` verdicts on active turns (query: `timed_out` turns whose `finished_at` predates a later successful finalize); a synthetic genuine-stall drill on dev recovering silently.

---

## Checkpoint PR boundaries

One PR per unit by default; two explicit groupings. Linear children in parentheses:

1. **PR-A:** U1 (activity bump) — smallest, highest-leverage; stops the false positives. (THINK-305)
2. **PR-B:** U2 (threshold knob + schedule flag). (THINK-306)
3. **PR-C:** U3 (origin-aware dispatcher + Terraform wiring) — code and schedule land together by design (KTD2). (THINK-307)
4. **PR-D:** U4 + U5 grouped — both are status-integrity guards in `packages/api`, U5 is a one-line production change; separate PRs would add review overhead without isolation value. (THINK-308)
5. **PR-E:** U6 (GraphQL + web surface) — schema, resolver, and consumer land atomically (KTD3 justification above). (THINK-309)
6. **PR-F:** U7 — customer-stack config flip + evidence; may be config-only or pure ops depending on where McPherson's tfvars live. (THINK-310)

Deploy ordering: **PR-A first** (stops the false positives); **PR-D and PR-E before PR-C** — the reconciliation guard and the silent-first surface must be live before automatic retry turns on, otherwise a genuine stall in the interim shows today's raw red banner _while_ a silent retry produces a second answer (worse than the status quo, and Q3's rationale depends on it); **PR-F strictly last**. Merge order of the PRs themselves can be anything (units are code-compatible); the constraint is on when `retry_dispatcher_enabled` first goes true, which PR-C controls.

---

## Verification Contract

All flows are driven in a real browser against deployed dev (dogfood auth per the operator recipe), with DB/scheduler evidence recorded in the issue.

- **V1 — Long healthy turn (F1/AE1, proves U1+U2).** In the dev web app, send a prompt engineered to keep the agent working >6 minutes (multi-step tool task). Watch the thread the entire time: no red banner, no Retry button appears; the turn ends with a single answer. Evidence: `thread_turns` row shows fresh `last_activity_at` bumps during the run, final status `succeeded`, zero `retry_queue` rows for the turn.
- **V2 — Stall verdict then late finalize (F4/AE4, proves U4 + U2 verdict path).** Start a healthy long turn, then force the verdict by aging the clock (`UPDATE thread_turns SET last_activity_at = NOW() - INTERVAL '10 minutes' WHERE id = …`) and letting the 1-minute cron flag it; let the turn finalize naturally. Browser: no red error at any point (with U6: a working/recovering state); one final answer. Evidence: status history `running → timed_out → succeeded` with a reconciliation log line; retry row `superseded`.
- **V3 — Genuine stall, silent recovery (F2/AE2-adjacent, proves U3+U6).** Start a turn and kill the runtime mid-flight (or age the clock on a turn whose finalize is blocked); stall monitor flags it; retry dispatcher fires; wakeup-processor runs a new attempt that completes. Browser: continuous benign working state, then exactly one final answer; no trace of the recovery (Q1). Evidence: origin turn `timed_out` with successor attempt linked by `origin_turn_id`; retry row closed as `succeeded` by the attempt's finalize; one visible answer in the thread, paired to the user's message.
- **V4 — Recovery exhausted + manual Retry (F3/AE3, proves U5+U6).** Seed a retry row at `attempt = max_attempts` for a genuinely-stalled turn (or set `max_attempts = 1` on the row) so recovery exhausts. Browser: plain-language failure message (no "Stall detected: no activity for 5 minutes" string anywhere), Retry button present; clicking Retry dispatches a fresh turn that completes. Evidence: retry row `exhausted`; new turn from the manual retry.
- **V5 — McPherson re-enable (R11, proves U7).** `aws scheduler get-schedule` before/after showing DISABLED → ENABLED via var-driven state on McPherson; one business day of monitoring with zero false-positive verdicts; dev genuine-stall drill (V3 rerun) green on the shipped build.

---

## Risks & Mitigations

- **First-enable backlog drain (high).** Stages carry months of undrained `pending` retry rows (D1). Mitigated in-code by U3's backlog guard (rows older than 60 minutes supersede, never dispatch) — safe on every stage without manual cleanup.
- **Finalize/stall race remains a race.** The 1-minute cron and finalize can still interleave; U4's guarded CAS-style update makes every interleaving explicit (succeeded-first blocks the verdict via `status = 'running'` predicate already present in the monitor; verdict-first reconciles via U4). No distributed lock needed.
- **Customer-stack drift (McPherson).** Repo Terraform says the dispatcher was never scheduled, but customer stacks deploy through a pinned runner and may differ. U3 verification includes inspecting McPherson's live scheduler; U7 gates on the runner carrying the fixed code (D4).
- **Write amplification from the activity bump.** Bounded by the 60-second throttle: worst case one extra UPDATE per turn per minute, on a row already being read per request.
- **Long fully-silent tool executions (>threshold with zero events).** Believed rare (tool start/end emit events); if V1-style dogfooding surfaces one, the named follow-up is a runtime-side heartbeat — deferred, not v1.
- **GraphQL drift outage class.** U6 ships schema + resolver + codegen atomically; never deploy a resolver referencing a field the deployed schema lacks.

---

## Definition of Done

- R1–R11 each demonstrably satisfied via V1–V5 evidence recorded in THINK-301.
- All six PRs merged to main and deployed; dev + prod + McPherson stall monitors ENABLED via Terraform state; retry dispatcher live and origin-aware on all affected stages.
- No raw stall internals visible in any user-facing surface for `timed_out` turns.
- Progress document updated with rollout evidence; McPherson monitored ≥1 business day post-re-enable with zero false positives.
