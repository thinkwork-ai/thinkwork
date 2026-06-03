# Live Agent Activity Streaming — Requirements

**Date:** 2026-06-03
**Scope tier:** Deep — feature (cross-cutting: Pi runtime → API → AppSync → Spaces client)
**Status:** Requirements — ready for `/ce-plan`

Stream agent activity (tool calls, skill invocations, phase steps, then answer text) into the Spaces thread UI **live as it happens**, instead of rendering the grouped activity summary only after the turn completes.

---

## Problem

While a turn runs, the Spaces thread shows only a turn-level placeholder — `Working… 21s · Manual chat · moonshotai.kimi-k2.5 · running` — with **no per-step detail**. The collapsible step groups ("Workspace sync", "AgentCore phases", "Finding sources", "Using browser automation", "Reading files") and the answer text appear all at once **only when status flips to `succeeded`**.

For a turn that takes 30–60s+, the operator stares at a spinner with zero insight into what the agent is doing. The value the agent produces (its reasoning trail) exists but is withheld until the end.

### Why it's withheld today (verified)

The pipeline is **buffer-then-flush**:

1. **Pi runtime** (`packages/pi-runtime-core/src/agent-loop.ts:412-492`) already subscribes to per-tool session events (`tool_execution_start` / `tool_execution_end`), but only **accumulates them in-memory** and logs to CloudWatch — no external emission mid-turn.
2. **chat-agent-invoke** dispatches Pi fire-and-forget (`InvocationType: "Event"`, `packages/api/src/handlers/chat-agent-invoke.ts:1157`). The turn runs inside that Lambda, fully **decoupled** from the client, and POSTs a **single finalize callback** at end-of-turn.
3. **process-finalize** (`packages/api/src/lib/chat-finalize/process-finalize.ts:355-394`) writes `usage_json.tool_invocations`, flips `running → succeeded`, and calls `notifyThreadTurnUpdate` → AppSync.
4. **Client** receives `onThreadTurnUpdated(tenantId)` as a bare "something changed" ping and **refetches the whole thread**. Group labels are derived client-side from the final `usage` blob.

## The key insight: most of the plumbing already exists

The gap is narrow — this is mostly **wiring existing seams together**, not net-new infrastructure:

| Piece | Already exists | Reference |
|---|---|---|
| Per-step emit point in Pi | ✅ callbacks fire, just not emitted out | `pi-runtime-core/src/agent-loop.ts:412-492` |
| Append-only, ordered event table | ✅ `thread_turn_events` (`run_id`, `seq`, `event_type`, `stream:"step"`, `payload`) | `packages/database-pg/src/schema/scheduled-jobs.ts:173-202` |
| Incremental append fn + tail query | ✅ `appendThreadTurnEvent()` + `threadTurnEvents(runId, afterSeq, limit)` | `packages/api/src/lib/thread-turn-events.ts:68-90`; `heartbeats.graphql:111` |
| Client incremental-event renderer | ✅ `turn.events[]` already renders `tool_invocation_started` etc. (fed `[]` for chat turns today) | `apps/spaces/src/components/workbench/TaskThreadView.tsx:1547-1597, 3251-3273` |
| Subscription bridge pattern | ✅ `@aws_subscribe` + `notify*` mutation POST to AppSync | `packages/database-pg/graphql/types/subscriptions.graphql`; `packages/api/src/graphql/notify.ts:201-251` |

The two **missing links**: (a) an emit seam that pushes Pi's per-step events out mid-turn, and (b) a live transport from that emit point to the client (today AppSync only publishes on status change).

---

## Goal & Success Criteria

Operators watching a running thread see the agent's activity build up **progressively**, then converge cleanly to the existing finalized view.

- **G1 — Live steps.** Tool/skill/phase steps appear in the thread within ~1s of occurring, with their start/running/done state, while the turn is still `running`.
- **G2 — Live text.** The assistant answer chunks into the message bubble as it's generated (coalesced ~250ms batches — reads as streaming, not literal tokens).
- **G3 — Clean convergence.** On completion, the live view resolves into the **same** collapsible grouped summary rendered today — no duplicate rows, no flicker, no re-layout jump.
- **G4 — Turn correctness unaffected.** Activity streaming is best-effort; dropping every activity event must still produce a correct, complete turn via the finalize callback.
- **G5 — Durable.** A reload / reconnect mid-turn recovers the in-flight activity (events are persisted, not just pushed).

**Success looks like:** the boxed step-group list in the user's screenshot appears *during* the turn, growing in real time, with answer text streaming in beneath it.

---

## Users & Value

- **Primary:** ThinkWork operators (Eric and tenant users) watching a thread execute in Spaces (web `app.thinkwork.ai` + desktop renderer — both `apps/spaces`).
- **Value:** confidence and legibility — see *what* the agent is doing and that it's making progress, catch a wrong turn early, and reduce the "is it stuck?" anxiety of a silent 60s spinner. This is the same reasoning-trail value that already lands at completion, delivered when it's actually useful.

---

## Scope

### In scope — Phase 1 (step plane)

- Emit seam in the Pi runtime that pushes `tool_execution_start` / `_end` (and skill/phase) events out mid-turn.
- A lightweight **activity callback** endpoint (mirror of the finalize callback) that appends events to `thread_turn_events` and publishes them.
- A new **`onThreadTurnStep(threadId)`** subscription carrying the step payload (seq, type, label inputs, status).
- Client: feed live events into the existing `turn.events[]` renderer so groups appear/expand in real time; converge to the finalized grouped view on completion.

### In scope — Phase 2 (text plane, fast-follow)

- Extend the emit seam to assistant text deltas; **coalesce** to ~250ms / N-char batches before POSTing.
- Stream coalesced text into the in-flight assistant message bubble over the same channel; reconcile with the final text at finalize.

### Phased / deferred

- Per-step **expandable inputs/results** detail during the turn (the screenshot's `▸ navigate …` lines) — land with or just after Phase 1 once the step payload carries enough detail.

### Out of scope (v1)

- **Mobile** (`apps/mobile`). The server-side event table + subscription are client-agnostic, so mobile can adopt the same feed later without rework — but v1 ships Spaces only.
- **True per-token text streaming** (Approach C / Lambda response streaming). Explicitly rejected — see Decisions.
- Changing the finalized grouped-summary rendering or the existing `usage`-derived labels.

---

## Chosen Approach — A (phased), with coalesced text

**Pi emit seam → batched activity callback → `thread_turn_events` + `onThreadTurnStep` → client `turn.events[]`.**

```
Pi runtime (running inside the fire-and-forget Lambda)
  │  session events: tool start/end, skill, phase, text-delta
  ▼
[emit seam]  batch (steps: per-event/small; text: ~250ms coalesce)
  │  best-effort HTTP POST (does NOT block or fail the turn)
  ▼
chat-agent-activity endpoint (new, mirrors finalize-callback auth)
  │  appendThreadTurnEvent()  → thread_turn_events (durable, seq-ordered)
  │  notifyThreadTurnStep()   → AppSync publish
  ▼
onThreadTurnStep(threadId)  ──▶  Spaces client
                                   feeds turn.events[]  (existing renderer)
                                   groups stream in live; text chunks in
  ... turn ends ...
finalize callback (unchanged) → status succeeded + usage_json
  ▶ client converges to finalized grouped summary (dedups live events)
```

### Why A over the alternatives

- **B (persist-only + client polling):** simplest infra, but polling latency makes text feel janky and adds steady DB load per viewer. Rejected for the text plane; A's push is strictly better for the same emit work.
- **C (Lambda response streaming / SSE):** true per-token, but **breaks the fire-and-forget decoupling the entire chat pipeline is built on** — client holds a connection to the Pi Lambda for up to 15 min, brutal reconnect story on reload / mobile background, and still needs separate persistence for history. Blast radius not worth literal-token fidelity; coalesced ~250ms chunks read as streaming to a human eye.

---

## Key Decisions

- **D1 — Best-effort, failure-isolated emit.** The activity POST is fire-and-forget *from Pi's perspective*; a failed/slow activity call must never delay or fail the turn. Turn correctness rides on the finalize callback alone (G4).
- **D2 — Finalize stays source of truth.** Live events are the *progressive* view; the finalize `usage` blob is *authoritative*. On completion the client converges to today's grouped summary, deduping live events against `usage.tool_invocations` (the client already does this — `TaskThreadView.tsx:3251-3273`).
- **D3 — Coalesced text, not tokens.** ~250ms / N-char batching for the text plane. No held-open connection; decoupling and durability preserved.
- **D4 — Durable via the event table.** Every streamed event is persisted to `thread_turn_events` before/as it's published, so reload/reconnect recovers in-flight state by tailing `threadTurnEvents(afterSeq)` (G5).
- **D5 — Subscribe by threadId.** `onThreadTurnStep(threadId)` (like `onNewMessage`), not tenant-wide — tighter routing, less client-side filtering and fan-out than `onThreadTurnUpdated(tenantId)`.
- **D6 — Phase the work.** Step plane ships first (high value, mostly wiring); text plane is a fast-follow on the same channel.

---

## Guardrails / Assumptions (for planning)

- **Volume cap with no silent truncation.** A pathological turn (hundreds of tool calls, very long output) must not flood AppSync. Cap publish rate / batch size; if events are coalesced or dropped from the *live* view, the **finalized** view must still be complete, and any live-view cap should be visible (not a silent gap). (Per project norm: no silent caps.)
- **AppSync payload limits.** Step payloads (tool inputs/results) can be large; cap per-event payload size for the live feed and rely on finalize for the full record.
- **Ordering.** `thread_turn_events.seq` gives total order; the client renders by seq and tolerates out-of-order/duplicate delivery (AppSync is at-least-once).
- **Auth.** Activity endpoint reuses the finalize-callback bearer/secret pattern; subscription reuses existing AppSync API-key auth scoped by threadId.
- **Assumption — Pi SDK exposes text deltas.** Phase 2 assumes the `@earendil-works/pi-coding-agent` session emits incremental assistant-text events alongside tool events. **Verify during planning**; if only whole-message text is available, Phase 2 degrades to "text appears at first/last token," and the decision to ship Phase 2 should be revisited.

---

## Risks

- **R1 — Double-render / flicker on convergence (D2).** Highest-likelihood UX bug: a tool shows as a live event *and* in the finalized `usage` blob. Mitigated by the existing name-based dedup, but the live event shape must match what dedup expects. Needs explicit test coverage.
- **R2 — Cost/throughput of mid-turn AppSync publishes.** New publish traffic proportional to step count × active viewers. Batching + caps (guardrails) contain it; measure on a browser-automation-heavy turn.
- **R3 — Extra HTTP from inside the Pi Lambda.** Batched POSTs add latency/IO surface to the runtime. Keep them async/non-blocking (D1); confirm they don't extend turn wall-clock meaningfully.
- **R4 — Pi text-delta availability (Phase 2 assumption).** See guardrails — gates Phase 2 viability.

---

## Open Questions

1. **Phase 1 detail depth:** do step groups stream in *with* their expandable input/result detail from day one, or do groups appear first (label + status) and detail lands as a quick follow? (Leaning: label+status first, detail immediately after — keeps Phase 1 a pure wiring exercise.)
2. **Coalesce cadence tuning:** 250ms is a starting point; confirm against feel + AppSync cost once Phase 2 is live.

---

## Handoff

Ready for `/ce-plan` (Phase 1 first). Planning should resolve: the exact emit-seam shape in `pi-runtime-core` / agentcore-pi container, the activity endpoint + `notifyThreadTurnStep` mutation + `onThreadTurnStep` subscription wiring (canonical GraphQL in `packages/database-pg/graphql/types/`), the `thread_turn_events` payload shape for the live `step` stream, and the client reducer that merges live `turn.events[]` with the finalized `usage` view without double-rendering (R1).
