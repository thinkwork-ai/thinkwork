---
title: "feat: Live agent activity streaming (Spaces thread)"
type: feat
status: active
date: 2026-06-03
origin: docs/brainstorms/2026-06-03-live-agent-activity-streaming-requirements.md
depth: deep
---

# feat: Live Agent Activity Streaming (Spaces thread)

Stream agent activity into the Spaces thread UI **live as it happens** — step groups (tool/skill/phase) appear in real time during a turn (Phase 1), then the answer text chunks in as it's generated (Phase 2) — instead of rendering everything only after the turn flips to `succeeded`.

Built on **Approach A** (see origin): Pi runtime emit seam → best-effort activity callback endpoint → `thread_turn_events` (durable, seq-ordered) → new `onThreadTurnStep(threadId)` AppSync subscription → the Spaces client's existing `turn.events[]` renderer. The decoupled fire-and-forget pipeline and durability are preserved.

---

## Problem Frame

While a turn runs, the thread shows only `Working… 21s · Manual chat · model · running` — zero per-step insight. The collapsible step groups and answer text appear all at once at finalize. For 30–60s+ turns the operator stares at a spinner; the reasoning trail exists but is withheld until it's no longer useful.

**Why withheld today (verified):** the Pi runtime (`packages/pi-runtime-core/src/agent-loop.ts:412-492`) already fires per-tool session callbacks but only accumulates them in-memory and logs to CloudWatch. The turn runs inside a fire-and-forget `Event`-mode Lambda (`packages/api/src/handlers/chat-agent-invoke.ts:1153-1160`) and POSTs a single finalize callback at the end; finalize flips status and the client (`onThreadTurnUpdated`) just refetches the whole thread.

**The plumbing mostly exists** (verified against the live tree): the `thread_turn_events` table (append-only, `(run_id, seq)`-ordered, `stream:"step"` already valid — no migration), `appendThreadTurnEvent()`, the `threadTurnEvents(runId, afterSeq, limit)` tail query, the `@aws_subscribe` notify-mutation bridge, and the client's incremental `turn.events[]` renderer. The gap is two missing links: an **emit seam** that pushes Pi's per-step events out mid-turn, and a **live transport** (a new subscription) from that emit point to the client.

---

## Requirements Traceability

Carried from origin (`docs/brainstorms/2026-06-03-live-agent-activity-streaming-requirements.md`):

| ID | Requirement | Units |
|----|-------------|-------|
| **G1** | Live steps appear within ~1s while `running` | U1–U6 |
| **G2** | Answer text chunks in (~250ms coalesced) | U7–U8 |
| **G3** | Clean convergence to the existing finalized grouped summary — no double-render/flicker | U6, U8 |
| **G4** | Turn correctness unaffected — activity emit is best-effort | U3, U5 |
| **G5** | Durable — reload/reconnect recovers in-flight activity | U6, U8 |
| **D1** | Best-effort, failure-isolated emit (never fails/delays the turn) | U5, U7 |
| **D2** | Finalize stays source of truth; client dedups live vs `usage.tool_invocations` | U6 |
| **D3** | Coalesced text, not tokens (no Lambda response streaming) | U7 |
| **D4** | Durable via `thread_turn_events`; replay by tailing `threadTurnEvents(afterSeq)` | U6, U8 |
| **D5** | Subscribe by `threadId` (like `onNewMessage`) | U1, U6 |
| **D6** | Phase the work (steps first, text fast-follow) | Phase 1 / Phase 2 split |

**Phase 2 gate (origin R4) — RESOLVED during planning.** `@earendil-works/pi-coding-agent@0.76.0` emits `message_update` events wrapping `text_delta` (`delta: string`); streaming is always on, no flag. The agent loop currently subscribes only to `tool_execution_start/_end`. Text streaming is viable — Phase 2 stays in scope.

---

## High-Level Technical Design

```mermaid
sequenceDiagram
    participant Pi as Pi runtime<br/>(agent-loop, in fire-and-forget Lambda)
    participant Act as chat-agent-activity<br/>(new HTTP handler)
    participant DB as thread_turn_events<br/>(Aurora)
    participant AS as AppSync
    participant Cli as Spaces client<br/>(turn.events[])

    Note over Pi: creds snapshotted at coroutine entry
    loop each tool/skill/phase (P1) + coalesced ~250ms text (P2)
        Pi->>Act: POST /api/threads/{id}/activity<br/>Bearer secret · best-effort, non-blocking
        Act->>DB: appendThreadTurnEvent(stream:"step", seq=max+1)
        Act-->>AS: notifyThreadTurnStep(payload)  (best-effort)
        AS-->>Cli: onThreadTurnStep(threadId) → reduce into turn.events[] by seq
    end
    Note over Cli: on mount/reconnect → threadTurnEvents(afterSeq) replay (durable catch-up)
    Pi->>Pi: turn ends
    Pi->>Act: (existing) finalize callback → status succeeded + usage_json
    Note over Cli: converge to finalized grouped view; dedup live events vs usage.tool_invocations
```

The push channel is a **latency optimization over a durable poll** — `thread_turn_events` is the source of truth, the subscription is the fast path, and `threadTurnEvents(afterSeq)` is the replay/recovery path (the AppSync client has no event replay; events landing while the socket is down are otherwise lost).

---

## Key Technical Decisions

**KTD1 — Carry the full step payload IN the subscription event, not a ping-and-refetch.** `apps/spaces` uses urql's document `cacheExchange`, not graphcache (`apps/spaces/src/lib/graphql-client.ts`), so a sibling subscription event does not invalidate the turn query, and refetch-per-step adds DB load per viewer. The `ThreadTurnStepEvent` mirrors the `thread_turn_events` row (`runId, threadId, tenantId, seq, eventType, stream, level, color, message, payload, createdAt`) and the client reduces it into local turn state. *(Ref: `docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md`.)*

**KTD2 — Durability rides on the event table, not the push.** Best-effort unawaited POSTs from inside the Pi Lambda are unverified under Lambda Web Adapter, and the AppSync client has no replay. G4/G5 are guaranteed by the durable `thread_turn_events` insert + `threadTurnEvents(afterSeq)` tail on focus/reconnect — the subscription push is never the sole delivery path. *(Ref: `docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md`.)*

**KTD3 — Snapshot callback creds at Pi coroutine entry.** Thread `THINKWORK_API_URL` + `API_AUTH_SECRET` into the emit seam at turn entry; never re-read `process.env` mid-turn. This callback shape has a known ~50%-intermittent env-shadowing failure. *(Ref: `docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`.)*

**KTD4 — Live event shape pinned to the dedup contract.** The live step event the client renders must match what the existing name-based dedup at `apps/spaces/src/components/workbench/TaskThreadView.tsx:3251-3273` expects (it already dedups live `turn.events[]` against `usage.tool_invocations`). Mismatch is the highest-likelihood UX bug (origin R1) — covered by explicit convergence tests. Log the actual Pi session-event shape once and pin it in a comment rather than guessing.

**KTD5 — No DB migration.** `thread_turn_events.stream` is free-text and already documents `"step"` (`packages/database-pg/src/schema/scheduled-jobs.ts:186`). Step and text-delta events are both rows in this table; no schema change.

**KTD6 — Substrate-first sequencing, codegen in the producing PR.** Land the GraphQL field + `schema:build` + `apps/spaces` codegen together (additive, low-risk, but codegen must move with the schema). Then the activity endpoint, then the Pi emit seam, then the client reducer. Inert stubs throw rather than silently no-op so intermediate states are operator-visible. *(Refs: `docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`, `docs/solutions/workflow-issues/platform-agent-space-runtime-refactor-autopilot-sequencing-2026-05-23.md`.)*

**KTD7 — Build on AppSync.** The 2026-04-30 REST/SSE cutover (`docs/plans/2026-04-30-001-refactor-rest-and-polling-cutover-plan.md`) is treated as abandoned (user ruling 2026-06-03); `onThreadTurnStep` is added to the existing subscription bridge. See Scope Boundaries for the migration note.

---

## Implementation Units

### Phase 1 — Step plane (live tool/skill/phase groups)

### U1. GraphQL substrate: `onThreadTurnStep` subscription + event type + notify mutation
- **Goal:** Add the subscription contract end-to-end so the client can subscribe and the server can publish.
- **Requirements:** G1, D5
- **Dependencies:** none
- **Files:**
  - `packages/database-pg/graphql/types/subscriptions.graphql` (add `ThreadTurnStepEvent` type, `notifyThreadTurnStep(...)` mutation in `extend type Mutation`, `onThreadTurnStep(threadId: ID!)` in `extend type Subscription` with `@aws_subscribe(mutations: ["notifyThreadTurnStep"])`)
  - `terraform/schema.graphql` (regenerated via `pnpm schema:build` — do not hand-edit)
  - `apps/spaces/src/lib/graphql-queries.ts` (add `ThreadTurnStepSubscription` document next to `NewMessageSubscription`)
  - regen: `pnpm --filter @thinkwork/spaces codegen`
- **Approach:** Mirror `onNewMessage`/`notifyNewMessage` exactly. The notify mutation's return type MUST end in `Event` and use no input objects (the `schema:build` `sed` at `scripts/schema-build.sh:63` matches `[A-Za-z]*Event`). `payload` is `AWSJSON`; `seq` is `Int!`. `threadId`-scoping keeps API-key auth (no special-case sed needed). `graphql-queries.ts` is excluded from typed codegen — the document works like `NewMessageSubscription` today.
- **Patterns to follow:** `NewMessageEvent` (subscriptions.graphql:18-29), `notifyNewMessage` (132-142), `onNewMessage` (231-232); `publishComputerThreadChunk` for the `AWSJSON` payload pattern (`notify.ts:168-185`).
- **Test scenarios:**
  - `pnpm schema:build` regenerates `terraform/schema.graphql` containing `onThreadTurnStep` + `notifyThreadTurnStep` with injected auth directives (assert presence).
  - Contract test: `packages/api/src/__tests__/graphql-contract.test.ts` asserts `notifyThreadTurnStep` is present in Mutation fields (mirror lines 547-550).
  - `pnpm --filter @thinkwork/spaces codegen` succeeds with the new schema.
- **Verification:** `terraform/schema.graphql` and the codegen output both contain the new subscription; typecheck clean.

### U2. Server publish helper `notifyThreadTurnStep`
- **Goal:** Server-side function to fire the subscription via AppSync.
- **Requirements:** G1
- **Dependencies:** U1
- **Files:** `packages/api/src/graphql/notify.ts`; `packages/api/src/graphql/notify.test.ts` (if a sibling test exists; else add)
- **Approach:** Mirror `notifyNewMessage` (`notify.ts:99-122`) + `publishComputerThreadChunk` for the JSON-stringified `payload` (`notify.ts:180`). Uses the shared `postToAppSync` helper; env `APPSYNC_ENDPOINT` + `APPSYNC_API_KEY` read at call-time (already wired in terraform). Best-effort — swallow/log errors (matches existing `notify.ts` discipline); a dropped notify costs latency, not data (KTD2).
- **Patterns to follow:** `notifyNewMessage`, `publishComputerThreadChunk`.
- **Test scenarios:**
  - Calls `postToAppSync` with the `notifyThreadTurnStep` mutation and JSON-stringified `payload`; `seq` passed as int.
  - Swallows a `postToAppSync` rejection without throwing (best-effort).
- **Verification:** Unit test green; helper exported and typed.

### U3. `chat-agent-activity` HTTP handler (persist + publish)
- **Goal:** The endpoint the Pi runtime POSTs each activity event to: append to `thread_turn_events`, then best-effort `notifyThreadTurnStep`.
- **Requirements:** G1, G4, D4
- **Dependencies:** U2
- **Files:**
  - `packages/api/src/handlers/chat-agent-activity.ts` (new)
  - `packages/api/src/handlers/chat-agent-activity.test.ts` (new)
  - `scripts/build-lambdas.sh` (add `build_handler "chat-agent-activity" …` — default externalized-SDK build; NOT in the bundled-AgentCore list)
  - `terraform/modules/app/lambda-api/handlers.tf` (add `"chat-agent-activity"` to the handler `for_each`; routes `POST` + `OPTIONS /api/threads/{threadId}/activity`)
- **Approach:** Copy the auth/validation skeleton from `packages/api/src/handlers/chat-agent-finalize.ts` (`extractBearerToken` + `validateApiSecret` → 401; UUID path validation; tenant/thread pinning defense-in-depth). Body carries one (or a small batch of) event(s): `{ eventType, stream:"step", message?, payload?, level?, color?, seq? }`. Append via `appendThreadTurnEvent(drizzleThreadTurnEventStore(), { tenantId, runId, agentId?, eventType, message, payload, stream:"step", … })` (`packages/api/src/lib/thread-turn-events.ts:67-91`) — `seq` is assigned server-side under the `lockThreadTurn` row lock; do not trust a client seq for ordering. Then call `notifyThreadTurnStep` with the inserted row (incl. server `seq`). **Payload cap:** `appendThreadTurnEvent` already asserts ≤64KB; reject/trim oversized payloads at the endpoint and rely on finalize for the full record (no silent truncation of the *finalized* view). Shared env block already provides `APPSYNC_*`, `API_AUTH_SECRET`, `DATABASE_URL` — no extra env wiring. **Missing the `build-lambdas.sh` entry blocks every deploy** (`filebase64sha256`) — both the script entry and the terraform handler/route are mandatory together.
- **Patterns to follow:** `chat-agent-finalize.ts` (auth/validation), `appendThreadTurnEvent`.
- **Test scenarios:**
  - **Happy path:** valid bearer + UUID threadId + body → appends a `stream:"step"` row with server-assigned `seq` and fires `notifyThreadTurnStep`.
  - **Auth:** missing/invalid bearer → 401, no DB write, no notify.
  - **Validation:** non-UUID threadId → 400; tenant/thread mismatch → rejected.
  - **Edge:** oversized payload (>64KB) → rejected/trimmed without 500; turn unaffected.
  - **Failure isolation (Covers G4):** a `notifyThreadTurnStep` rejection still returns 2xx (the durable append already succeeded).
  - **Integration:** append→notify ordering — notify receives the same `seq` that was persisted.
- **Verification:** Handler builds; routes resolve; a dev POST appends a row and fires the subscription.

### U4. Plumb activity-callback config into the Pi invoke payload
- **Goal:** Pass the activity endpoint URL + secret into the Pi container, mirroring the finalize callback.
- **Requirements:** G1
- **Dependencies:** U3
- **Files:** `packages/api/src/handlers/chat-agent-invoke.ts` (around 1108-1115, the `invokePayload` builder); `packages/api/src/handlers/chat-agent-invoke.test.ts`
- **Approach:** Add `activity_callback_url = ${THINKWORK_API_URL}/api/threads/${threadId}/activity` and `activity_callback_secret = THINKWORK_API_SECRET` (reuse the finalize secret) to the same payload that already carries `finalize_callback_url`/`finalize_callback_secret`. No new env.
- **Patterns to follow:** the existing `finalize_callback_*` plumbing in the same function.
- **Test scenarios:**
  - Invoke payload includes `activity_callback_url` (correct threadId path) + `activity_callback_secret`.
  - Absent `THINKWORK_API_URL`/secret → activity fields omitted/empty (Pi side gates on presence; turn still dispatches).
- **Verification:** Unit asserts the payload shape; existing invoke tests still green.

### U5. Pi runtime emit seam (tool/skill/phase events, best-effort)
- **Goal:** Fire an activity POST on each tool/skill/phase boundary mid-turn, failure-isolated.
- **Requirements:** G1, G4, D1, KTD3, KTD4
- **Dependencies:** U4
- **Files:**
  - `packages/pi-runtime-core/src/agent-loop.ts` (extend the existing `session.subscribe` handlers at 412-492 to invoke an injected `onActivity` listener; snapshot creds at entry)
  - `packages/pi-runtime-core/src/activity-client.ts` (new — `postActivityCallback`, mirroring `finalize-client.ts` Bearer/secret/URL-allowlist + backoff)
  - `packages/agentcore-pi/agent-container/src/server.ts` (pass `activity_callback_*` config + the listener into `runAgentLoop`)
  - `packages/pi-runtime-core/src/activity-client.test.ts` (new); `packages/pi-runtime-core/src/agent-loop.test.ts` (extend)
- **Approach:** Confirm the per-step hook surface in `runAgentLoop` — whether it already accepts a step/event listener or one must be threaded through (the finalize path only exposes end-of-turn hooks). Map `tool_execution_start`/`_end` (and skill/phase boundaries) to a live event whose shape matches KTD4's dedup contract (e.g. `tool_invocation_started`). POST is **non-blocking and best-effort** (D1) — never await in a way that extends turn wall-clock, never let a failure propagate into the turn. **Snapshot `THINKWORK_API_URL` + `API_AUTH_SECRET` at coroutine entry** (KTD3). Because best-effort unawaited POSTs are unverified under LWA (KTD2), prove delivery with a dev-stage sentinel during verification; durability is the event-table tail, not this push.
- **Execution note:** Pin the actual Pi session-event shape with a one-time log + comment before mapping to the live event (KTD4) — do not guess key names.
- **Patterns to follow:** `packages/pi-runtime-core/src/finalize-client.ts` (`postFinalizeCallback`: Bearer header, `callbackUrlAllowed`, backoff `[200,600,1500]ms`, presence gate).
- **Test scenarios:**
  - **Happy path:** a tool execution fires one `tool_execution_start` + one `_end` activity POST with the dedup-contract shape.
  - **Failure isolation (Covers G4/D1):** activity POST rejects/times out → the turn still completes and finalizes normally; no exception escapes the loop.
  - **Creds (KTD3):** the seam uses creds snapshotted at entry even if `process.env` is mutated mid-turn.
  - **Gate:** activity config absent → no POST attempted, turn unaffected.
  - **Edge:** rapid successive tool calls → events fire in order (the server assigns `seq`).
- **Verification:** Dev turn produces `stream:"step"` rows in `thread_turn_events` mid-turn (before finalize); sentinel confirms POST delivery.

### U6. Spaces client: live step rendering + replay + convergence
- **Goal:** Subscribe to `onThreadTurnStep`, render steps into the running turn live, recover on reconnect, and converge cleanly at finalize.
- **Requirements:** G1, G3, G5, D2, D4, KTD1
- **Dependencies:** U1 (subscription), U5 (events actually flow)
- **Files:**
  - `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx` (wire `useSubscription(ThreadTurnStepSubscription)`; reduce events into the running turn's `events[]` by `seq`; on mount/reconnect tail `threadTurnEvents(runId, afterSeq)` for catch-up)
  - `apps/spaces/src/components/workbench/TaskThreadView.tsx` (ensure live `turn.events[]` for chat turns render the same step groups; preserve the dedup at 3251-3273 so finalize convergence doesn't double-render)
  - `apps/spaces/src/components/workbench/TaskThreadView.test.tsx` (extend) / a new reducer test
- **Approach:** Reduce step events into local state keyed by `seq` (KTD1 — payload carried in the event, no refetch). On (re)connect, before trusting the live socket, replay via `threadTurnEvents(afterSeq)` from the last-seen `seq` (D4/G5 — the AppSync client has no replay). On completion, the existing name-based dedup against `usage.tool_invocations` must make live events and the finalized grouped view converge to one set (D2/G3). Coalesce any live refetches.
- **Patterns to follow:** the `onNewMessage` `useSubscription` wiring; the existing `turn.events[]` live-event rendering (`TaskThreadView.tsx:1547-1597`) and dedup (`:3251-3273`).
- **Test scenarios:**
  - **Happy path (Covers G1):** step events arriving while `running` render as live groups in order.
  - **Convergence (Covers G3, R1):** a tool shown as a live event AND present in the finalized `usage.tool_invocations` renders **once** after finalize — no duplicate row, no flicker.
  - **Replay (Covers G5):** mount/reconnect mid-turn → `threadTurnEvents(afterSeq)` backfills missed steps; no gaps, no dupes vs subsequent live events.
  - **Ordering:** out-of-order/duplicate AppSync delivery (at-least-once) is de-duplicated by `seq`.
  - **Edge:** turn with zero steps → no live group box; behaves as today.
- **Verification:** Dev turn shows groups streaming in live, survives a reload mid-turn, and collapses to the existing finalized summary with no duplicates.

---

### Phase 2 — Text plane (coalesced answer streaming)

### U7. Pi emit seam: coalesced assistant text deltas
- **Goal:** Stream the answer text as ~250ms-coalesced chunks over the same activity channel.
- **Requirements:** G2, D1, D3
- **Dependencies:** U5 (emit seam + creds snapshot)
- **Files:** `packages/pi-runtime-core/src/agent-loop.ts` (subscribe `message_update` → `text_delta`); `packages/pi-runtime-core/src/activity-client.ts` (reuse); `packages/pi-runtime-core/src/agent-loop.test.ts`
- **Approach:** Subscribe to `message_update` events and project `assistantMessageEvent.type === "text_delta"` (`delta: string`) — confirmed available in `@earendil-works/pi-coding-agent@0.76.0` (gate resolved). Buffer deltas and flush every ~250ms (and on `message_end`) as a single `text_delta`/`assistant_text` activity event carrying the accumulated chunk + a content index/offset for client ordering. Best-effort, non-blocking, creds snapshotted (D1, KTD3). **No silent caps** — finalize still carries the complete text (D2); coalescing only affects the *live* view. (Optionally also project `thinking_delta` later — out of scope here.)
- **Execution note:** Tune the 250ms cadence against feel + AppSync cost once live (origin open question).
- **Patterns to follow:** U5's emit seam; `finalize-client.ts` posting.
- **Test scenarios:**
  - **Happy path (Covers G2):** a sequence of `text_delta`s within a window flushes as one coalesced activity event ~every 250ms.
  - **Flush on end:** `message_end` flushes the remaining buffer immediately.
  - **Ordering:** coalesced chunks carry monotonic offsets so the client can order/append.
  - **Failure isolation (D1):** a failed text POST never interrupts generation; finalize text is still complete.
- **Verification:** Dev turn emits coalesced `text_delta` rows to `thread_turn_events` during generation; full text intact at finalize.

### U8. Spaces client: live answer-text streaming + reconcile
- **Goal:** Render coalesced text into the in-flight assistant bubble, then reconcile with the authoritative final text.
- **Requirements:** G2, G3, G5, D2, D4
- **Dependencies:** U6 (client step pipeline + replay), U7 (text events flow)
- **Files:** `apps/spaces/src/components/workbench/TaskThreadView.tsx` (render streaming text into the running assistant message); `apps/spaces/src/components/workbench/SpacesThreadDetailRoute.tsx` (route text-delta events through the same reducer); test files alongside
- **Approach:** Append coalesced text chunks (ordered by offset) into the in-flight assistant message bubble. On finalize, **replace** the streamed text with the authoritative final message text (D2 — finalize is source of truth) without a visible fl​icker/jump. Text-delta events are also persisted in `thread_turn_events`, so reconnect replay (U6's `threadTurnEvents(afterSeq)` tail) reconstructs partial text (D4/G5).
- **Patterns to follow:** existing assistant-message rendering in `TaskThreadView.tsx`; the U6 reducer.
- **Test scenarios:**
  - **Happy path (Covers G2):** coalesced chunks append in offset order into the running bubble.
  - **Reconcile (Covers G3, D2):** at finalize the bubble shows the authoritative final text; if streamed text diverged, final wins with no duplicate/garbled text.
  - **Replay (Covers G5):** reload mid-generation → partial text reconstructed from `threadTurnEvents`, then continues live.
  - **Edge:** turn with tool calls but a very short final answer → text streams and reconciles correctly alongside the step groups.
- **Verification:** Dev turn shows the answer chunking in live and resolving to the final text, surviving a mid-generation reload.

---

## Scope Boundaries

### In scope
- Phase 1 (step plane) + Phase 2 (text plane) as sequenced milestones, Spaces only (`apps/spaces`, web + desktop renderer).
- The new `onThreadTurnStep` subscription, the `chat-agent-activity` endpoint, the Pi emit seam, and the client reducer/replay/convergence.

### Deferred to follow-up work
- **Per-step expandable input/result detail** during the turn (the screenshot's `▸ navigate …` lines) — land once the step payload carries enough detail; the transport already supports it.
- **`thinking_delta` streaming** (reasoning trace) — same channel, later.
- **Cadence tuning** of the 250ms coalesce window after real-world measurement.
- **REST/SSE cutover migration note (KTD7):** if `docs/plans/2026-04-30-001-refactor-rest-and-polling-cutover-plan.md` is ever revived, `onThreadTurnStep` + `notifyThreadTurnStep` join the migration set with the other nine `notify*` helpers. Documented here so the new subscription is not silently orphaned.

### Out of scope (this product)
- **Mobile** (`apps/mobile`). The server-side event table + subscription are client-agnostic, so mobile can adopt the same feed later without rework.
- **True per-token text streaming / Lambda response streaming** (Approach C) — explicitly rejected (origin; D3).
- Changing the finalized grouped-summary rendering or the `usage`-derived labels.

---

## Risks & Mitigation

| ID | Risk | Mitigation | Units |
|----|------|------------|-------|
| **R1** | Double-render/flicker on convergence (live event also in final `usage`) | Pin live event shape to the dedup contract (KTD4); explicit convergence tests | U5, U6 |
| **R2** | Cost/throughput of mid-turn AppSync publishes (steps × viewers; text chunks) | Coalesce text (~250ms); cap payload size; best-effort drop ok (durable table backstops) | U3, U7 |
| **R3** | Best-effort unawaited POSTs unreliable under Lambda Web Adapter | Durability rides on the event-table insert, not the push (KTD2); dev sentinel proves delivery | U5 |
| **R4** | Env shadowing → empty callback creds (~50% intermittent) | Snapshot creds at coroutine entry (KTD3) | U5 |
| **R5** | `runAgentLoop` may not expose a mid-turn step hook | Confirm/thread a listener through early in U5 (deferred implementation detail) | U5 |

---

## System-Wide Impact

- **GraphQL schema** (additive): new subscription/mutation/type; `schema:build` + `apps/spaces` codegen must move in the same PR (KTD6). `packages/api` has no codegen script (consumes via Drizzle) — nothing to regen there.
- **New Lambda handler** (`chat-agent-activity`): build-script + terraform handler/route entries are mandatory together or deploys break.
- **Pi runtime / agentcore-pi container:** new emit seam + new outbound callback per turn (best-effort, non-blocking).
- **Deploy:** ship via PR to `main` (merge pipeline deploys); no `aws lambda update-function-code`. Watch the post-merge Deploy run (terraform apply happens post-merge).
- **No DB migration** (KTD5).

---

## Open Questions (deferred to implementation)

1. **Per-step hook surface in `runAgentLoop`** (R5) — does it accept a step/event listener, or must one be threaded through? Resolve at the start of U5.
2. **Exact live-event `eventType` strings** — confirm against the client dedup contract by logging the real Pi session-event shape once (KTD4).
3. **Coalesce cadence** — 250ms is a starting point; tune against feel + AppSync cost (U7).

---

## Sources & Research

- **Origin:** `docs/brainstorms/2026-06-03-live-agent-activity-streaming-requirements.md`
- **Pi SDK text-delta gate (RESOLVED):** `@earendil-works/pi-coding-agent@0.76.0` → `message_update`/`text_delta`; agent-loop subscribes only to tool events today.
- **Learnings:** urql doc-cache no live invalidation (`docs/solutions/integration-issues/spaces-urql-doc-cache-no-live-invalidation.md`); LWA in-flight promise lifecycle (`docs/solutions/runtime-errors/lambda-web-adapter-in-flight-promise-lifecycle-2026-05-06.md`); callback env shadowing (`docs/solutions/workflow-issues/agentcore-completion-callback-env-shadowing-2026-04-25.md`); inert-first seam-swap (`docs/solutions/architecture-patterns/inert-first-seam-swap-multi-pr-pattern-2026-05-08.md`); codegen-coupling staged migration (`docs/solutions/workflow-issues/platform-agent-space-runtime-refactor-autopilot-sequencing-2026-05-23.md`); event-stream shape discipline (`docs/solutions/best-practices/invoke-code-interpreter-stream-mcp-shape-2026-04-24.md`).
- **Conflicting (treated abandoned, KTD7):** `docs/plans/2026-04-30-001-refactor-rest-and-polling-cutover-plan.md`.
