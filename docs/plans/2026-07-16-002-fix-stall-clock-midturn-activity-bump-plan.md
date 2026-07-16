---
title: Stall Clock Mid-Turn Activity Bump - Plan
type: fix
date: 2026-07-16
topic: stall-clock-midturn-activity-bump
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
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

On the chat path, `last_activity_at` is written once at dispatch and never refreshed — `chat-agent-activity.ts` appends events but never touches the stall clock, while the wakeup-processor path already bumps it (`packages/api/src/handlers/wakeup-processor.ts`, "Update last_activity_at to prevent false stall detection"). The stall monitor (`packages/api/src/handlers/crons/stall-monitor.ts`) flags any `running` turn whose coalesced activity timestamp is older than 5 minutes, so every chat turn longer than the threshold is falsely marked `timed_out`: the user sees a red timeout error mid-stream and a `retry_queue` row is enqueued for a turn that was never stuck. This unit fixes the signal; sibling units fix the threshold knob, retry dispatch, finalize reconciliation, UI surface, and rollout.

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
- AE4. **Covers R2.** Given a `running` turn whose `last_activity_at` is stale, when a `document.emit` payload is accepted for it, then `last_activity_at` is refreshed the same as for an event batch.

### Scope Boundaries

- **Out of scope (sibling units of THINK-301):** stall-threshold configurability and schedule enable flag (U2/THINK-306), retry dispatcher wiring and origin-awareness (U3/THINK-307), finalize reconciliation and manual Retry guard (U4+U5/THINK-308), recovery UI surface (U6/THINK-309), McPherson monitor re-enable (U7/THINK-310).
- **Out of scope:** the wakeup-processor path's existing bump, which already behaves correctly.
- **Out of scope:** changes to the Pi runtime's POST cadence or payload shape; the fix consumes the existing stream.

### Dependencies / Assumptions

- The runtime activity stream fires well within the 5-minute stall window during any healthy turn (parent contract assumption); if planning finds a silent-gap case, a runtime-side heartbeat is a later supplement, not part of this unit.
- Verification target from the parent arc: a real >6-minute browser turn on deployed dev completes with no red timeout banner and fresh `last_activity_at` bumps observable in the database.

### Outstanding Questions

None open. Q1 and Q2 (deferred from brainstorming) are resolved in the Planning Contract below.

### Sources / Research

- Detection predicate: `packages/api/src/handlers/crons/stall-monitor.ts` (threshold constant, `COALESCE(last_activity_at, started_at)` query, `timed_out` write + `retry_queue` insert).
- Missing bump: `packages/api/src/handlers/chat-agent-activity.ts` (no `last_activity_at` write on either the events or document branch); existing test at `packages/api/src/handlers/chat-agent-activity.test.ts`.
- Question intake (same Lambda, `/questions` route): `packages/api/src/lib/user-questions/intake.ts` — runtime-initiated, awaited mid-turn by the Pi `ask_user_question` extension; existing test at `packages/api/src/lib/user-questions/intake.test.ts`.
- Working contrast: `packages/api/src/handlers/wakeup-processor.ts` (throttle-free bump commented "prevent false stall detection"); dispatch-time writes in `packages/api/src/handlers/chat-agent-invoke.ts`.
- Column: `thread_turns.last_activity_at` in `packages/database-pg/src/schema/scheduled-jobs.ts` (timestamptz, nullable).
- Parent contract: `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (R1, AE1, F1, deploy-first ordering; parent Q2 resolution adopted here as KTD2).
- Failure-isolation pattern to mirror: the best-effort side-writes already in `chat-agent-activity.ts` (born-artifact upsert, binding capture, notify — awaited with `.catch` + `console.error`).

---

## Planning Contract

> **Product Contract preservation:** R1–R4 and AE1–AE3 verbatim. Two additive changes, no existing text altered: (1) Q1 resolves to *yes* — the `/questions` intake route also bumps the clock, extending the bump to a third accepted-request kind (recorded as KTD4, covered by U1 test scenarios); (2) AE4 added to give R2 explicit acceptance coverage (doc-review finding — every other R had a mapped AE).

### Resolved Questions

- **Q1 — `/questions` intake counts as activity: YES.** Code evidence settles the brainstorm's hesitation: the intake POST is **runtime-initiated** — the Pi `ask_user_question` extension POSTs the question batch and awaits the 200 *before returning its sentinel tool result* (`packages/api/src/lib/user-questions/intake.ts` header). It proves runtime liveness exactly as an event batch does. (The brainstorm framing "a user answering a question" was inaccurate — the user's *answer* arrives via GraphQL, not this Lambda, and is not touched.) The intake's ownership join already loads the turn row, so the same throttled bump rides it at zero extra query cost. Residual gap recorded as a risk below: a turn parked for many minutes *waiting* for the human answer emits no further activity and can still be stall-flagged — pre-existing behavior, explicitly not fixed by this unit.
- **Q2 — bump placement and mechanics: per-request, riding the existing turn lookups.** Adopts the parent plan's Q2 resolution. Each of the three accepted-request branches (events, `document.emit`, question intake) adds `last_activity_at` to its existing turn-lookup select; after validation/ownership checks pass, a shared helper writes `last_activity_at = NOW()` only when the fetched value is NULL or older than 60 seconds. Per-request, not per-event; no conditional-`WHERE` throttle needed (see KTD2).

### Key Technical Decisions

- **KTD1. Server-side bump in the activity endpoint, no runtime change.** (Inherits parent KTD1.) The API is the single writer of `thread_turns` and can throttle; the Pi image is untouched.
- **KTD2. The throttle gates on the value fetched by the existing selects — zero extra queries in the steady state.** Each branch already selects the turn row per request; adding the `last_activity_at` column is free. The UPDATE targets the row by id only. A race between concurrent requests can produce a duplicate bump — harmless (an idempotent timestamp refresh), so atomic conditional-UPDATE ceremony is deliberately omitted.
- **KTD3. The bump fires on request acceptance, not on append success.** It runs immediately after auth + validation + tenant/thread ownership pass, before the branch's main work. Rationale: the accepted request itself proves runtime liveness; a batch that later 500s on a per-event fault still came from a live runtime and must not leave the clock stale.
- **KTD4. Question intake counts as activity** (Q1 above). The bump sits after the intake's ownership join + active-status check, before the message/pending-question transaction.
- **KTD5. One shared, failure-isolated helper, bare-awaited (catches internally).** A `bumpTurnActivityIfStale`-style helper in a new `packages/api/src/lib/turn-activity-bump.ts` owns the 60-second throttle constant and the swallow-and-log discipline (R4/AE3) *inside the helper*, so call sites bare-`await` it — mirroring the intent of the handler's existing best-effort side-writes. It is awaited (never fire-and-forget) — un-awaited promises in a Lambda handler may be frozen at return and silently never run.
- **KTD6. No status guard on the UPDATE.** The stall monitor only examines `running` turns, so bumping a turn in any other status is a no-op for detection; skipping the guard keeps the events-branch select shape unchanged beyond the one added column.

### High-Level Technical Design

Bump placement across the one Lambda's three accepted-request branches:

```mermaid
flowchart TD
    RT[Pi runtime POST] --> ROUTE{path ends /questions?}
    ROUTE -- yes --> QI[question intake:<br/>auth + ownership join + active check]
    ROUTE -- no --> ACT[activity handler:<br/>auth + body validation + turn lookup + tenant/thread pin]
    ACT --> DOC{payload.document present?}
    QI --> BUMP
    DOC -- yes --> BUMP
    DOC -- no --> BUMP
    BUMP{{bumpTurnActivityIfStale:<br/>fetched last_activity_at NULL or >60s old?}}
    BUMP -- stale --> UPD[UPDATE thread_turns SET last_activity_at = NOW()<br/>awaited; errors caught + logged inside helper, never fails request]
    BUMP -- fresh --> SKIP[no write]
    UPD --> WORK[branch's existing work unchanged:<br/>event append loop / document emission / question transaction]
    SKIP --> WORK
    WORK --> SM[stall monitor reads COALESCE fresh -> turn never flagged]
```

---

## Implementation Units

Single unit — the work is one behavior (the bump) applied at three call sites in one Lambda, plus its helper. Splitting would create review overhead with no isolation value.

### U1. Mid-turn activity bumps the stall clock

- **Goal:** Every accepted runtime request on the chat path — activity event batch, `document.emit`, question intake — refreshes `thread_turns.last_activity_at` (throttled, failure-isolated), so an actively-working turn never looks stalled.
- **Requirements:** R1, R2, R3, R4 (AE1–AE4); parent R1/F1/AE1; Q1/KTD4 (intake).
- **Dependencies:** none.
- **Files:**
  - `packages/api/src/lib/turn-activity-bump.ts` (new — shared helper, throttle constant, failure isolation)
  - `packages/api/src/lib/turn-activity-bump.test.ts` (new)
  - `packages/api/src/handlers/chat-agent-activity.ts` (both branches: add column to the two turn-lookup selects, call helper after validation)
  - `packages/api/src/lib/user-questions/intake.ts` (add column to the ownership-join select, call helper after the active-status check)
  - `packages/api/src/handlers/chat-agent-activity.test.ts` (extend: bump scenarios on events + document branches; db mock gains an update chain and `last_activity_at` in the select fixture)
  - `packages/api/src/lib/user-questions/intake.test.ts` (extend: bump scenario on accepted intake)
- **Approach:** Helper takes the already-fetched turn (`id`, `last_activity_at`) and the db handle; if the value is NULL or older than 60s it issues `UPDATE thread_turns SET last_activity_at = NOW() WHERE id = …`, catching and logging any error internally so callers can bare-`await` it (KTD2/KTD3/KTD5). Call sites: events branch after the tenant/thread pin passes; document branch after its equivalent pin; intake after `TURN_NOT_ACTIVE`/`TENANT_MISMATCH` checks pass and before the message transaction. Wakeup-processor bump untouched (out of scope per Product Contract).
- **Patterns to follow:** the failure-isolated best-effort side-writes already in `chat-agent-activity.ts` (born-artifact upsert, binding capture, notify: awaited, `.catch(err => console.error(…))`).
- **Test scenarios:**
  - *Helper (`turn-activity-bump.test.ts`):* NULL `last_activity_at` → UPDATE issued; value 5 minutes old → UPDATE issued; value 10 seconds old → no UPDATE (throttle, AE2); UPDATE rejects → resolves without throwing and logs (AE3/R4).
  - *Events branch (`chat-agent-activity.test.ts`):* **Covers AE1 (signal half).** Valid batch on a turn with stale clock → bump fired once per request (not per event) with the turn id; **Covers AE2.** turn bumped 10s ago → no write; **Covers AE3.** bump write rejects → 200 with events appended and notify still fired; 401 / 400 validation failure / 404 turn-not-found → no bump attempted; per-event `PAYLOAD_TOO_LARGE` skip → bump still happened (request was accepted, KTD3).
  - *Document branch:* **Covers AE4.** `document.emit` payload on a stale-clock turn → bump fired before emission handling; document branch 404 (turn not found) → no bump.
  - *Intake (`intake.test.ts`):* accepted question POST (200) on a stale-clock turn → bump fired; `TURN_NOT_ACTIVE` (403) → no bump; bump rejection does not turn a committed question into a non-200.
- **Verification:** see Verification Contract V1 below — this unit is complete only when the deployed-dev browser flow passes, not merely when the suite is green.

---

## Checkpoint PR boundary

One PR for U1 (parent plan's **PR-A**, THINK-305). No grouping decisions needed. Ships through the normal merge-to-main deploy pipeline: no Terraform, no schema migration, no codegen — `packages/api` only, bundled into the existing `chat-agent-activity` Lambda by the standard build.

---

## Verification Contract

- **V1 — Long healthy browser turn on deployed dev (proves R1/R2/R3, parent AE1).** Full user flow: sign in to the deployed dev web app (dogfood operator auth recipe), open a Space thread, send a prompt engineered to keep the agent working well past the 5-minute threshold AND emit a document along the way (multi-step tool task ending in `emit_document`, e.g. a browsing/research errand that produces a report; target >6–7 minutes). The document emission exercises the `document.emit` bump live (AE4); if the live turn can't be steered into emitting one, R2 is discharged by the U1 document-branch unit tests and that substitution is recorded in the evidence. Watch the thread the entire time: no red timeout banner, no Retry button, exactly one final answer; the turn ends `succeeded`. DB evidence from the dev database: the turn's `last_activity_at` advances during the run (sample it 2–3 times ≥60s apart to also witness the throttle — R3), final status `succeeded`, and zero `retry_queue` rows for the turn.
- **V2 — Stall monitor negative check (proves the signal reaches the predicate).** While the V1 turn is running past minute 5, confirm the live dev stall-monitor cron (runs every minute) never flags it: no `timed_out` status transition and no "Stall detected" error on the turn afterward.
- **V3 — Question-intake bump (proves Q1/KTD4).** In the dev browser, drive a turn that asks a user question (`ask_user_question` skill path). After the question card appears, confirm in the dev DB that the turn's `last_activity_at` is fresh (bumped at intake time). Answer the question and let the turn complete normally.
- Unit/suite gates: full `pnpm --filter @thinkwork/api test` green (whole package, not just the touched files), plus repo-wide lint/typecheck/format per pre-commit.

---

## Risks

- **Parked question wait can still stall-flag (pre-existing, not fixed here).** A turn waiting >threshold for a human answer emits no activity after the intake bump and can be marked `timed_out` mid-wait. Out of scope for U1 (parent contract names the recovery pipeline for genuine idleness); if dogfooding surfaces it as noisy, the fix belongs with parked-turn semantics or a threshold bump (U2 knob), recorded for the parent arc.
- **Long fully-silent tool executions** (>threshold with zero event batches) would still false-flag. Believed rare (tool start/end emit events); parent plan's named follow-up is a runtime-side heartbeat — deferred, not v1.
- **Write amplification** bounded by the 60-second throttle: worst case one extra UPDATE per turn per minute, on a row already read per request (KTD2).
- **Test-mock drift (both suites):** the existing db mocks only stub what their handlers used to need — `chat-agent-activity.test.ts` stubs `select` only, and `intake.test.ts` stubs `select` + `transaction` only. Both mocks must gain an `update().set().where()` chain (resolved promise) and `last_activity_at` in their turn fixtures, without weakening existing assertions. Beware the masking hazard: with the helper's internal catch, a `db.update is not a function` throw in a mock would be silently swallowed — assert the update was *called*, not just that no error surfaced.
- **Sibling THINK-307 already merged (schedule ships DISABLED).** The retry dispatcher's code and Terraform schedule exist on main gated by `retry_dispatcher_enabled` (default `false`). Deploy-first ordering still holds, but before merging U1 confirm the flag is still `false` on dev — an already-enabled dispatcher would amplify any bump bug into real retry dispatches.

---

## Definition of Done

- U1 merged to main via one PR (PR-A) with all checks green, and deployed to dev by the merge pipeline.
- All U1 test scenarios implemented and the full `@thinkwork/api` suite green.
- V1–V3 evidence (browser observations + DB queries) recorded in THINK-305.
- Deploy-first ordering honored: this unit is live on dev before THINK-307 (U3) enables the retry dispatcher.
