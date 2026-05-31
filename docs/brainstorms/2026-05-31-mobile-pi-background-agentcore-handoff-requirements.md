---
date: 2026-05-31
topic: mobile-pi-background-agentcore-handoff
---

# Mobile Pi Background AgentCore Handoff

## Problem Frame

Mobile Pi turns currently run in the iOS app and persist only after the local
turn completes. If the app backgrounds, suspends, loses network, or is killed
during a long turn, the user can be left with a working indicator and no durable
continuation path.

ThinkWork needs a mobile-first handoff model where local Pi remains the default
host, but managed AgentCore Pi can continue the same logical turn after mobile
stops heartbeating. The user should not have to confirm while the app is
backgrounded; the system should infer host loss, continue safely, and preserve
trust through activity evidence.

---

## Actors

- A1. Mobile user: Starts an agent-enabled turn from iOS and may background or
  leave the app while work is running.
- A2. Mobile Pi host: Runs the Pi-compatible mobile agent loop, emits events,
  checkpoints safe progress, and heartbeats while alive.
- A3. Platform API: Owns durable turn leases, heartbeat freshness, handoff
  claiming, idempotency, and thread activity updates.
- A4. Server watchdog: Detects stale mobile leases and initiates managed
  continuation when mobile does not recover within the grace window.
- A5. Managed AgentCore Pi host: Continues a claimed mobile turn from the latest
  safe checkpoint and finalizes the visible assistant answer.

---

## Key Flows

- F1. Normal local completion
  - **Trigger:** A mobile user sends an agent-enabled message.
  - **Actors:** A1, A2, A3
  - **Steps:** Mobile creates a handoff-capable logical turn, starts the local
    Pi loop, heartbeats every 5 seconds, writes event transcript checkpoints,
    then finalizes locally before the lease becomes stale.
  - **Outcome:** The thread shows one user message and one assistant response
    from local Mobile Pi; no AgentCore continuation is dispatched.
  - **Covered by:** R1, R2, R3, R4, R10

- F2. Background grace and managed continuation
  - **Trigger:** The app backgrounds or heartbeats stop during an active mobile
    Pi turn.
  - **Actors:** A2, A3, A4, A5
  - **Steps:** Mobile signals background when possible, the server starts or
    continues the grace window, no heartbeat arrives for 30 seconds, the server
    claims handoff once, AgentCore Pi starts from the latest safe checkpoint,
    and the final assistant response is written as the same logical turn.
  - **Outcome:** The user sees one logical turn with activity phases showing
    local start, checkpointing, managed continuation, and completion.
  - **Covered by:** R2, R3, R5, R6, R7, R9, R10

- F3. Late mobile completion after claim
  - **Trigger:** Mobile resumes or finishes after the server has already claimed
    handoff for AgentCore.
  - **Actors:** A2, A3, A5
  - **Steps:** Mobile attempts to finalize, the server rejects it as no longer
    eligible for the visible answer, and the late completion is retained only as
    diagnostic evidence.
  - **Outcome:** No duplicate assistant answer appears; managed AgentCore is the
    authoritative finisher once handoff is claimed.
  - **Covered by:** R7, R8, R10

---

## Requirements

**Turn Ownership and Lease**

- R1. Every agent-enabled mobile Pi turn must be handoff-capable from the start,
  including simple prompts, tool-using prompts, and attachment prompts.
- R2. Mobile Pi must heartbeat active handoff-capable turns every 5 seconds
  while the local host is alive.
- R3. The platform must treat a mobile turn as stale after 30 seconds without a
  heartbeat and make that stale state eligible for managed continuation.
- R4. A mobile background signal must start or reinforce the server-side grace
  window, but it must not immediately dispatch AgentCore unless the stale
  threshold is reached.
- R5. The server watchdog must be the source of truth for stale detection and
  handoff claiming, because iOS background execution cannot be trusted to
  complete the final request.

**Checkpoint and Continuation**

- R6. Mobile Pi must persist event transcript checkpoints for active turns,
  including the user prompt, context identity, tool calls, tool results, runtime
  events, timestamps, and any assistant text fragments safe to carry forward.
- R7. Managed AgentCore Pi must continue from the latest safe checkpoint when a
  mobile lease is claimed, preserving one logical user turn rather than starting
  a second visible turn.
- R8. Once managed handoff is claimed, AgentCore owns the user-visible assistant
  answer; late mobile completions must be rejected for visible finalization and
  retained only as diagnostic evidence.
- R9. If the newest checkpoint contains an unsafe in-flight step, managed
  continuation must fall back to the last safe checkpoint and activity must note
  that the unsafe mobile step was not carried forward.

**Side Effects and Safety**

- R10. Read-only and local/ephemeral evidence may be trusted across handoff,
  including local bash output, workspace reads/searches, web search results, MCP
  reads, and model-visible transcript events.
- R11. Mutating tool effects must not be silently replayed or trusted as
  completed across handoff unless the server already has durable proof of the
  effect.
- R12. Mobile-only permissioned actions must not be reproduced by AgentCore
  without an explicit capability path; handoff should continue around them only
  from the last safe checkpoint.

**User Experience and Observability**

- R13. The user-facing thread must show one logical turn with execution phases,
  not a failed local turn followed by a separate cloud turn.
- R14. Handoff provenance should be visible in the activity/timeline only:
  mobile started, checkpoint saved, background grace started, AgentCore claimed,
  and managed completion. No modal or blocking confirmation is required for v1.
- R15. The normal thread status and working indicator must continue to reflect
  the active logical turn while ownership moves between mobile and AgentCore.

---

## Acceptance Examples

- AE1. **Covers R1-R5, R13-R15.** Given a mobile user starts a simple
  agent-enabled turn and backgrounds the app for 10 seconds, when the app
  foregrounds and heartbeats resume before 30 seconds, then the local mobile
  turn remains owner and no AgentCore handoff occurs.
- AE2. **Covers R2-R9, R13-R15.** Given a mobile user starts a long turn and the
  app is backgrounded or killed, when no heartbeat arrives for 30 seconds, then
  the server claims handoff once, AgentCore continues from the latest safe
  checkpoint, and only one assistant answer is visible in the thread.
- AE3. **Covers R8.** Given AgentCore has claimed handoff and mobile later
  finishes the original local loop, when mobile attempts to record the assistant
  answer, then the platform rejects it as visible finalization and stores it
  only as diagnostic evidence.
- AE4. **Covers R9-R12.** Given the latest checkpoint is inside a mutating tool
  call, when AgentCore claims continuation, then it resumes from the previous
  safe read-only/local checkpoint and the activity timeline records that the
  unsafe in-flight step was not carried forward.

---

## Success Criteria

- Mobile users can background the app during a long agent turn without losing
  the turn or needing to manually resubmit the prompt.
- The thread remains understandable: one user message, one logical running turn,
  one final assistant answer, and activity evidence showing any host transition.
- Duplicate assistant answers are prevented even when mobile recovers after
  AgentCore has claimed the turn.
- Downstream planning can implement the feature without inventing handoff
  semantics, stale timing, user-visible behavior, or side-effect policy.

---

## Scope Boundaries

- V1 is mobile Pi only, but the lease/checkpoint vocabulary should be generic
  enough for desktop local Pi to adopt later.
- V1 does not require human confirmation, modal approval, or push notification
  policy for background handoff.
- V1 does not attempt to serialize or migrate active local process state, such
  as a running bash process.
- V1 does not silently replay mutating tool calls.
- V1 does not make every local host or BYOB runtime participate in the handoff
  contract.
- V1 does not redesign the whole mobile Pi runtime; it adds durable ownership,
  checkpoints, and managed continuation around the existing mobile Pi host.

---

## Key Decisions

- **Lightweight checkpoint over restart:** Managed AgentCore should continue
  from event transcript checkpoints instead of restarting from the original
  user message.
- **Read-only continuation boundary:** Read-only and local evidence may carry
  forward; mutating effects require durable proof or are not trusted.
- **Activity-only transparency:** Handoff is visible in activity/timeline, not
  as a blocking modal or inline banner.
- **Hybrid trigger:** Mobile background signals start the grace window when
  possible, but the server watchdog owns the actual stale claim.
- **Uniform eligibility:** Every agent-enabled mobile Pi turn is
  handoff-capable.
- **One logical turn:** Host transfer is an execution phase, not a second user
  turn.
- **Managed wins after claim:** Once AgentCore claims handoff, mobile can no
  longer produce the visible assistant answer.
- **Timing:** Heartbeat every 5 seconds; stale after 30 seconds without a
  heartbeat.
- **Mobile-first scope:** Solve mobile first, but avoid mobile-only naming where
  a future desktop convergence path is cheap.

---

## Dependencies / Assumptions

- Existing mobile Pi turns already emit agent events and can produce an event
  transcript checkpoint.
- Existing platform turn lifecycle can represent running/failed/cancelled
  states and activity phases closely enough for a one-logical-turn handoff
  model.
- Managed AgentCore Pi can accept enough context to continue from a checkpoint
  without depending on mobile-only runtime state.
- iOS background execution is unreliable enough that server-side stale
  detection must be authoritative.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6-R9][Technical] Decide the exact durable storage shape for mobile
  checkpoints and whether to extend existing turn activity/result fields or add
  a dedicated checkpoint ledger.
- [Affects R5][Technical] Decide whether stale detection runs from an existing
  scheduled/reconciler path, a new lightweight watchdog, or an opportunistic
  claim during thread reads plus a scheduled safety net.
- [Affects R10-R12][Technical] Classify each current mobile tool as read-only,
  local/ephemeral, mutating-with-durable-proof, or unsafe-across-handoff.
- [Affects R13-R15][Design] Decide exact activity labels and iconography for
  host transfer phases.
- [Affects R1-R15][Testing] Extend the mobile Pi smoke matrix with background,
  stale heartbeat, managed continuation, late mobile completion, and unsafe
  checkpoint cases.

---

## Next Steps

-> /ce-plan for structured implementation planning.
