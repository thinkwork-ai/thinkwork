---
title: Stall Clock Mid-Turn Activity Bump - Plan
type: fix
date: 2026-07-16
topic: stall-clock-midturn-activity-bump
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Stall Clock Mid-Turn Activity Bump - Plan

## Goal Capsule

- **Objective:** Mid-turn runtime activity on the chat path keeps `thread_turns.last_activity_at` fresh, so the stall monitor never marks an actively-working chat turn `timed_out`.
- **Product authority:** THINK-305 (unit U1 of THINK-301); parent Product Contract in `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (covers parent R1, AE1).
- **Open blockers:** None. This unit deploys first in the THINK-301 sequence — it must be live before the automatic retry dispatcher (THINK-307 / U3) is enabled.

---

## Product Contract

### Summary

`packages/api/src/handlers/chat-agent-activity.ts` — the endpoint the Pi runtime POSTs to mid-turn — additionally bumps `thread_turns.last_activity_at` when it receives runtime activity for a turn, throttled and failure-isolated. This is the missing activity signal on the chat path: the stall monitor already reads `COALESCE(last_activity_at, started_at)`, so fresh bumps stop every false `timed_out` verdict on long healthy chat turns.

### Problem Frame

On the chat path, `last_activity_at` is written once at dispatch and never refreshed — `chat-agent-activity.ts` appends events but never touches the stall clock, while the wakeup-processor path already bumps it (`packages/api/src/handlers/wakeup-processor.ts:2884-2888`). The stall monitor (`packages/api/src/handlers/crons/stall-monitor.ts`) flags any `running` turn whose coalesced activity timestamp is older than 5 minutes, so every chat turn longer than the threshold is falsely marked `timed_out`: the user sees a red timeout error mid-stream and a `retry_queue` row is enqueued for a turn that was never stuck. This unit fixes the signal; sibling units fix the threshold knob, retry dispatch, finalize reconciliation, UI surface, and rollout.

### Requirements

**Activity signal**

- R1. A runtime activity event batch accepted for a `running` turn refreshes that turn's `last_activity_at`, so the turn is never stall-flagged while batches keep arriving. Inherits parent R1.
- R2. A document emission (`document.emit` payload branch) accepted for a `running` turn counts as activity the same way — long document-producing turns are not a false-positive gap.

**Write discipline**

- R3. The bump is throttled: it writes only when `last_activity_at` is NULL or more than 60 seconds stale, bounding write amplification from high-frequency event batches.
- R4. The bump is failure-isolated: a failed bump never fails the activity request, and the durable event append and publish behavior of the handler is unchanged in every success and error path.

### Acceptance Examples

- AE1. **Covers R1.** Given a chat turn streaming tool output continuously for 12 minutes on a deployed stage, when the stall monitor runs each minute, then the turn is never marked `timed_out` and no `retry_queue` row is created. Mirrors parent AE1.
- AE2. **Covers R3.** Given a turn posting event batches every 2 seconds, when 10 batches arrive within one minute, then `last_activity_at` is written at most once in that window (plus the initial NULL fill).
- AE3. **Covers R4.** Given the bump write throws, when an otherwise-valid activity batch arrives, then the request still returns 200 with the events appended and the error is logged.

### Scope Boundaries

- **Out of scope (sibling units of THINK-301):** stall-threshold configurability and schedule enable flag (U2/THINK-306), retry dispatcher wiring and origin-awareness (U3/THINK-307), finalize reconciliation and manual Retry guard (U4+U5/THINK-308), recovery UI surface (U6/THINK-309), McPherson monitor re-enable (U7/THINK-310).
- **Out of scope:** the wakeup-processor path's existing bump, which already behaves correctly.
- **Out of scope:** changes to the Pi runtime's POST cadence or payload shape; the fix consumes the existing stream.

### Dependencies / Assumptions

- The runtime activity stream fires well within the 5-minute stall window during any healthy turn (parent contract assumption); if planning finds a silent-gap case, a runtime-side heartbeat is a later supplement, not part of this unit.
- Verification target from the parent arc: a real >6-minute browser turn on deployed dev completes with no red timeout banner and fresh `last_activity_at` bumps observable in the database.

### Outstanding Questions

**Deferred to planning**

- Q1. Whether the question-intake route (`/questions`), which the same Lambda fronts, should also count as activity — a user answering an agent question mid-turn arguably proves liveness, but the parent contract names only event batches and document emissions.
- Q2. Where in the handler the bump attaches (after turn validation, per-request vs per-event) and whether the throttle check rides the existing turn lookup or a conditional UPDATE.

### Sources / Research

- Detection predicate: `packages/api/src/handlers/crons/stall-monitor.ts` (threshold constant, `COALESCE(last_activity_at, started_at)` query, `timed_out` write + `retry_queue` insert).
- Missing bump: `packages/api/src/handlers/chat-agent-activity.ts` (no `last_activity_at` write on either the events or document branch); existing test at `packages/api/src/handlers/chat-agent-activity.test.ts`.
- Working contrast: `packages/api/src/handlers/wakeup-processor.ts:2884-2888`.
- Column: `thread_turns.last_activity_at` in `packages/database-pg/src/schema/scheduled-jobs.ts`.
- Parent contract: `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (R1, AE1, F1, deploy-first ordering).
