---
title: Silent-First Recovery Surface, GraphQL Recovery State + Web UI - Plan
type: fix
date: 2026-07-16
topic: silent-first-recovery-surface
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Silent-First Recovery Surface, GraphQL Recovery State + Web UI - Plan

## Goal Capsule

- **Objective:** While automatic recovery is in progress the thread shows a benign working state; only exhausted recovery shows a plain-language failure with Retry; superseded attempts collapse so the thread shows exactly one final answer; raw internal strings such as "Stall detected: no activity for 5 minutes" never render.
- **Product authority:** THINK-309, unit U6 (PR-E, grouped api+web) of the parent plan `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` (THINK-301; parent R6, R9, R10, Q1, KTD3, KTD4, AE3).
- **Open blockers:** None for planning/implementation. Runtime behavior depends on U3 (THINK-307) retry-state semantics and U4 (THINK-308) retry-row closure being live for a full end-to-end demonstration, but the unit's code is independently mergeable and deployable — see Dependencies.

---

## Product Contract

### Summary

Expose server-derived recovery state on the GraphQL turn type — `recoveryPending: Boolean`, resolved from `retry_queue` — and rework the web thread surface so `timed_out` turns with recovery in flight render as a normal working state, exhausted recovery renders a plain-language failure with a Retry affordance, and origin turns superseded by a successful retry attempt collapse behind the successor. Schema, resolver, and consumer codegen (apps/web, apps/cli, apps/mobile, packages/api) land atomically in one PR.

### Problem Frame

Today the web treats `timed_out` as terminally failed (`FAILED_TURN_STATUSES = {failed, timed_out}` in `apps/web/src/components/workbench/dispatch-indicator.ts:59`) and renders the raw `turn.error` string as the visible banner — so a user watching a stalled-then-recovering turn sees "Agent dispatch failed: Stall detected: no activity for 5 minutes" in red while the system is (once U3 ships) silently retrying, and after a successful retry the thread shows two turns for one prompt. The client has no way to distinguish "recovery in progress" from "recovery exhausted": that distinction lives in `retry_queue` rows, which are server-side only. Parent KTD3 mandates deriving recovery visibility server-side over GraphQL, never inferring it client-side; parent KTD4 mandates plain-language copy keyed off status, never `turn.error`.

Grounding correction to the issue description: `originTurnId` and `retryAttempt` are **already present** on the GraphQL `ThreadTurn` type (`packages/database-pg/graphql/types/heartbeats.graphql:86`) and flow from `thread_turns.origin_turn_id` via the `snakeToCamel` row mapping — the only new schema field this unit adds is `recoveryPending`.

### Key Decisions

- **Recovery visibility is server-derived (parent KTD3).** `recoveryPending` is resolved from `retry_queue` by `origin_turn_id` (indexed: `idx_retry_queue_origin_turn`), true iff a `pending` or `dispatched` row exists for the turn. U4's retry-row closure guarantees rows go terminal (`succeeded`/`superseded`/`exhausted`) after recovery resolves, so `recoveryPending` cannot stick true forever.
- **Schema + resolver + consumer codegen land in one PR (parent KTD3 checkpoint note).** Schema/resolver drift is a known cold-start outage vector; the web change is unusable without the field, and shipping the field without its consumer invites drift. Codegen regenerates once, atomically, in all four consumers.
- **Plain-language copy is keyed off status, never `turn.error` (parent KTD4).** The raw error string stays in the DB for operators; the UI derives its copy from `status` + `recoveryPending`.
- **Successful recovery shows no trace (parent Q1, resolved).** A recovered turn is indistinguishable from a normal turn — no "recovered" badge, no residual origin-turn stub.
- **Non-stall `failed` turns keep existing behavior.** This unit changes rendering for `timed_out` and for origin-with-successor collapse; the existing `failed` surface changes only in that its copy source follows KTD4 where it currently prints raw stall internals.
- **AppSync subscription schema is untouched.** The notify payload type does not change; only the HTTP-API turn type gains a field.

### Requirements

- R1. The GraphQL `ThreadTurn` type gains `recoveryPending: Boolean`, resolved server-side as: a `retry_queue` row with `origin_turn_id = turn.id` exists in status `pending` or `dispatched`. Rows in `succeeded`/`superseded`/`exhausted` do not count. _(Parent KTD3.)_
- R2. Attempt linkage (`originTurnId`) is available to clients on every turn — already exposed on the type; this unit verifies it is populated for retry-attempt turns and consumes it in the web thread. _(Parent R6 linkage half.)_
- R3. Web: a `timed_out` turn with `recoveryPending = true` renders as the normal benign working affordance (indicator state `recovering`) — no red styling, no failure banner, no raw error text anywhere. _(Parent R9, AE3.)_
- R4. Web: a `timed_out` turn with `recoveryPending = false` renders a failure state whose copy is plain language keyed off status — for example "This response took too long. It was automatically retried without success — you can retry now." — with the Retry button visible to the sender. The raw `turn.error` string (e.g. "Stall detected…") never appears in the rendered output. _(Parent R10, KTD4.)_
- R5. Web: an origin turn that has a successor attempt (some turn whose `originTurnId` equals the origin's id) renders collapsed/hidden in favor of the successor, so the thread shows exactly one visible final answer per prompt. _(Parent R6.)_
- R6. A turn that recovered successfully shows no trace of the recovery — the thread is visually indistinguishable from one where the turn succeeded first try. _(Parent Q1.)_
- R7. Codegen is regenerated in `apps/web`, `apps/cli`, `apps/mobile`, and `packages/api`; schema, resolver, and web consumer merge in a single PR. The AppSync subscription schema (`terraform/schema.graphql`) is unchanged.
- R8. Non-stall `failed` turns keep their existing rendering behavior (copy source aside per KTD4); `cancelled` remains excluded from failure/retry treatment.

### Key Flows

- F1. Stall verdict with recovery in flight
  - **Trigger:** A user's turn is marked `timed_out` by the stall monitor while a retry row is `pending` or `dispatched`.
  - **Steps:** The turn query/subscription delivers `status = timed_out`, `recoveryPending = true`; the dispatch indicator derives state `recovering`; the thread keeps showing the normal working affordance.
  - **Outcome:** The user sees an uninterrupted working state — no red, no internals. **Covers R1, R3.**
- F2. Recovery exhausted, manual retry
  - **Trigger:** The retry ceiling is hit; the retry row goes `exhausted`, so `recoveryPending` flips false while status stays `timed_out`.
  - **Steps:** The indicator derives the failure state; the surface shows the plain-language failure copy with the Retry button; clicking Retry dispatches a fresh turn (mutation guard accepting `timed_out` is U5/THINK-308).
  - **Outcome:** The user understands the turn failed, in plain words, and can retry by hand. **Covers R1, R4.**
- F3. Silent recovery completes
  - **Trigger:** A retry attempt turn (carrying `originTurnId`) finalizes `succeeded`; U4 closes the origin's retry row as `succeeded`.
  - **Steps:** The thread renders the successor turn's answer; the origin `timed_out` turn collapses behind it; no recovery indicator or badge remains.
  - **Outcome:** Exactly one final answer, paired to the user's message, with no trace of the recovery. **Covers R2, R5, R6.**

### Acceptance Examples

- AE1. **Covers R1, R3.** Given a turn with `status = timed_out` and a `pending` retry row, when the web derives the dispatch indicator state, then the state is `recovering` (not `failed`) and no destructive/red styling or `turn.error` text renders. _(Parent AE3, first half.)_
- AE2. **Covers R1, R4.** Given a turn with `status = timed_out` whose retry rows are all `exhausted`, when the thread renders, then the visible copy is plain language (the string "Stall detected" appears nowhere in the DOM) and the Retry button is present for the sender. _(Parent AE3, second half.)_
- AE3. **Covers R1.** Given the resolver a turn with only `superseded`/`exhausted` retry rows, when `recoveryPending` resolves, then it is `false`; with a `pending` or `dispatched` row it is `true`.
- AE4. **Covers R5, R6.** Given a thread containing an origin turn (`timed_out`) and its successor attempt (`succeeded`, `originTurnId` = origin id), when the thread renders, then exactly one answer is visible (the successor's) and the origin is collapsed with no recovery badge.
- AE5. **Covers R8.** Given a `failed` (non-stall) turn, when the thread renders, then its existing failure behavior is unchanged.
- AE6. **Covers R7.** Given the merged PR, the generated GraphQL artifacts in all four consumers include `recoveryPending`, and `terraform/schema.graphql` shows no diff.

### Scope Boundaries

- **Out of scope:** The retry dispatcher itself, its Terraform wiring, and `superseded` writes — U3 (THINK-307).
- **Out of scope:** Finalize reconciliation, retry-row closure (`succeeded` writer), and the `retryAgentDispatch` mutation guard accepting `timed_out` — U4+U5 (THINK-308). This unit renders the Retry affordance for `timed_out`; the server-side guard that makes it work is U5.
- **Out of scope:** Mobile UI changes — `apps/mobile` receives codegen only; rendering parity is a follow-up if wanted.
- **Out of scope:** A general turn-progress UI (elapsed time, live step display) beyond the benign working/recovering state (parent deferral).
- **Out of scope:** AppSync subscription schema or notify payload changes.
- **Deferred:** Distinct visual treatment for `recovering` vs plain `working` (subtle "still working…" nuance). v1 renders the same benign working affordance for both.

### Dependencies / Assumptions

- **Deploy ordering (parent):** PR-E (this unit) must be live on a stage **before** `retry_dispatcher_enabled` (U3/THINK-307) first goes true there — otherwise a genuine stall shows today's raw red banner while a silent retry produces a second answer. Merge order of the PRs is free; the constraint is on the dispatcher's first enable.
- **`recoveryPending` cannot stick without U4.** Until U4's retry-row closure is live, a `dispatched` row could dangle and hold `recoveryPending` true indefinitely. Acceptable in the interim only because the dispatcher (U3) is not yet enabled anywhere, so no `dispatched` rows are being created; stale historical `pending` rows are superseded by U3's backlog guard.
- `thread_turns.origin_turn_id` and `retry_attempt` exist (`packages/database-pg/src/schema/scheduled-jobs.ts:157-158`) and are populated by the wakeup-processor retry branch (`packages/api/src/handlers/wakeup-processor.ts:1394-1429`). No DB migration is needed for this unit.
- `retry_queue.origin_turn_id` is indexed (`idx_retry_queue_origin_turn`), so the `recoveryPending` join is cheap.
- Turn rows reach GraphQL via `snakeToCamel` mapping in `packages/api/src/graphql/resolvers/threads/types.ts`; `recoveryPending` is the only field needing an explicit derived resolver.

### Outstanding Questions

**Deferred to planning**

- Q1. Exact failure copy string for exhausted recovery. Recommended (from parent U6): "This response took too long. It was automatically retried without success — you can retry now." — planning may adjust wording; the requirement is only plain language keyed off status (R4).
- Q2. How `recoveryPending` is resolved without N+1 across turn lists — per-turn field resolver vs batched loader vs a join in the turn list queries. Behavior is fixed by R1; the plumbing is planning's.
- Q3. Collapse mechanism for superseded origin turns (R5) — filtered out of the rendered turn/message pairing in `TaskThreadView.tsx` vs collapsed-but-expandable. Recommended: fully hidden (consistent with Q1's no-trace rule); planning decides where the filter lives.

### Sources / Research

- Parent plan (authoritative unit spec, R6/R9/R10/Q1, KTD3/KTD4, deploy ordering, Verification Contract V3/V4): `docs/plans/2026-07-16-001-fix-agent-timeout-stall-false-positives-plan.md` — U6 section.
- GraphQL turn type (already has `originTurnId`, `retryAttempt`; gains `recoveryPending`): `packages/database-pg/graphql/types/heartbeats.graphql:53-88`.
- Web failure surface today: `apps/web/src/components/workbench/dispatch-indicator.ts:59` (`FAILED_TURN_STATUSES` includes `timed_out`), `apps/web/src/components/workbench/TaskThreadView.tsx:2180-2201` (renders raw failure reason in red), `apps/web/src/components/workbench/turnHeader.ts:64-65` ("Timed out after …" label).
- Turn linkage columns: `packages/database-pg/src/schema/scheduled-jobs.ts:157-158` (`retry_attempt`, `origin_turn_id` on `thread_turns`); populated at `packages/api/src/handlers/wakeup-processor.ts:1429`.
- Retry queue schema + origin index: `packages/database-pg/src/schema/retry-queue.ts:36,50`.
- Resolver mapping layer: `packages/api/src/graphql/resolvers/threads/types.ts` (`snakeToCamel` turn mapping).
- Sibling unit requirements (format + cross-unit boundaries): `docs/plans/2026-07-16-002-fix-origin-aware-retry-dispatcher-plan.md` (THINK-307), `docs/plans/2026-07-16-002-fix-stall-clock-midturn-activity-bump-plan.md` (THINK-305), `docs/plans/2026-07-16-002-fix-stall-threshold-env-knob-schedule-enable-flag-plan.md` (THINK-306).
