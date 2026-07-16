---
title: Agent Timeout Stall False Positives - Plan
type: fix
date: 2026-07-16
topic: agent-timeout-stall-false-positives
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
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
- Detection: `packages/api/src/handlers/crons/stall-monitor.ts` (threshold L17, verdict write L70-74, retry enqueue L86-104).
- Missing heartbeat: `packages/api/src/handlers/chat-agent-activity.ts` (no `last_activity_at` write); contrast `packages/api/src/handlers/wakeup-processor.ts:2884-2888` (bumps it).
- Duplicate-turn risk: `packages/api/src/handlers/crons/retry-dispatcher.ts` (no origin-success check); `packages/database-pg/src/schema/retry-queue.ts`.
- Status race: `packages/api/src/lib/chat-finalize/process-finalize.ts:631-644` (unguarded succeeded write).
- Error surface: `apps/web/src/components/workbench/TaskThreadView.tsx:2183-2201`, `apps/web/src/components/workbench/turnHeader.ts:64-65`, `apps/web/src/components/workbench/dispatch-indicator.ts:128`; retry guard gap `packages/api/src/graphql/resolvers/messages/retryAgentDispatch.mutation.ts:135-145,211`.
- Prior related work: `docs/plans/2026-05-22-006-refactor-chat-agent-invoke-direct-callback-finalize-plan.md` (chat-invoke Lambda timeout/retry cascade, same symptom family); `docs/solutions/diagnostics/eval-runner-stall-findings-2026-05-16.md`.
- 8-hour ceiling reference: `packages/agentcore-pi/agent-container/src/runtime/sandbox-factory.ts:83`.
