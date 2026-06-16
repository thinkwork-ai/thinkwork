---
date: 2026-06-16
topic: thread-event-sources
---

# Thread Event Sources

## Problem Frame

ThinkWork Threads should be able to receive structured events from approved
external producers, append those events as thread context, and trigger the
normal agent wake loop when policy allows. The first proof is customer
onboarding with Twenty: an existing closed-won opportunity webhook starts the
Customer Space Thread, the agent creates onboarding tasks in Twenty through
Twenty MCP, and later Twenty task status changes or task comments flow back into
the owning Thread.

The product bet is broader than Twenty. ThinkWork needs a generic Thread Event
Sources contract so future producers can send events in the correct structure.
Twenty is the first producer and linked task events are the first resolved
resource type. The feature should not become a CRM-specific linkage model, a
fuzzy routing engine, or a duplicate task system.

---

## Actors

- A1. External producer: A system that emits a structured event payload to
  ThinkWork. V1 producer is Twenty.
- A2. ThinkWork Thread: The durable conversation and execution context that
  receives external event messages and wakes its assigned agent.
- A3. ThinkWork agent: The agent assigned to the Thread; it decides how to
  respond based on existing Thread, Space, and agent instructions.
- A4. Customer-facing user: Works in Twenty and updates task status or adds
  task comments during onboarding.
- A5. ThinkWork workflow owner/operator: Configures and verifies the customer
  onboarding workflow and producer integration.

---

## Key Flows

- F1. Customer onboarding creates linked Twenty tasks
  - **Trigger:** The existing customer onboarding path creates or reopens a
    Thread after a Twenty opportunity is won.
  - **Actors:** A2, A3
  - **Steps:** The onboarding agent creates required onboarding tasks in
    ThinkWork and mirrors the relevant tasks into Twenty through Twenty MCP.
    When Twenty returns task identifiers, ThinkWork records those external task
    identities on the corresponding linked task rows.
  - **Outcome:** Future events for those Twenty tasks can resolve back to the
    owning ThinkWork Thread and task.
  - **Covered by:** R1, R2, R6, R9

- F2. Linked Twenty task update wakes the Thread
  - **Trigger:** A customer-facing user changes the status of a ThinkWork-created
    Twenty task.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Twenty emits the standard external event payload. ThinkWork
    verifies and deduplicates the event, resolves it to the linked task, records
    the linked task event, appends a compact external-event message to the
    Thread, and triggers the normal agent wake loop when the Thread's wake
    policy allows linked task events.
  - **Outcome:** The agent sees the task update as normal Thread context and
    responds according to its instructions.
  - **Covered by:** R3, R4, R5, R7, R8, R10, R11

- F3. Linked Twenty task comment wakes the Thread
  - **Trigger:** A customer-facing user adds a comment or note to a
    ThinkWork-created Twenty task.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** Twenty emits the comment event through the same producer path.
    ThinkWork resolves it to the linked task, records the event, appends a
    concise human-readable message with structured metadata, and triggers the
    normal agent wake loop when allowed.
  - **Outcome:** Human context entered in Twenty appears in the Thread and can
    influence the agent's next turn.
  - **Covered by:** R3, R4, R5, R7, R8, R10, R11

- F4. Unmatched external event is retained without waking an agent
  - **Trigger:** ThinkWork receives an event that cannot be resolved to a known
    linked task.
  - **Actors:** A1, A5
  - **Steps:** ThinkWork verifies and deduplicates the event, records it as
    unmatched for diagnostics/querying, and does not append it to a Thread or
    wake an agent.
  - **Outcome:** Events are not silently lost, but v1 avoids fuzzy routing and
    user-facing triage scope.
  - **Covered by:** R12, R13, R14

---

## Requirements

**Generic event intake**

- R1. ThinkWork must define a generic external event payload shape that can be
  produced by approved systems, with Twenty as the first implemented producer.
- R2. The payload must be producer-neutral enough to represent source, event
  type, subject/resource identity, actor, occurrence time, summary, structured
  metadata, and any routing or correlation information needed for v1.
- R3. ThinkWork must verify producer authenticity and deduplicate external
  events before they can affect a Thread or task state.
- R4. V1 must implement Twenty task status updates and Twenty task comments or
  notes as the first producer event types.

**Linked task resolution**

- R5. V1 routing must resolve external events only through known linked task
  identity, not through fuzzy matching, titles, customer names, opportunity
  names, or broader CRM context.
- R6. When ThinkWork creates a Twenty task during customer onboarding, it must
  record the returned Twenty task identity on the corresponding ThinkWork linked
  task so future events can route automatically.
- R7. When a Twenty task event resolves to a linked task, ThinkWork must record
  a linked task event and update task status or metadata when the event
  represents a state change.
- R8. The external event must route to the owning Thread of the linked task.
  Goal effects happen through the Thread's existing goal/progress model, not
  through separate v1 Goal routing.

**Thread wake behavior**

- R9. Each Thread or workflow must have a simple wake policy for linked task
  events: append-only or append-and-wake.
- R10. Resolved linked task events must append a compact human-readable
  external-event message to the Thread.
- R11. Resolved linked task events must include structured metadata for the
  agent/runtime, but the visible Thread message must not dump raw producer
  payloads by default.
- R12. When wake policy allows it, the event must trigger a normal agent turn.
  The feature must not hardcode event-specific response behavior; the agent's
  existing instructions determine what happens next.

**Unmatched events and scope control**

- R13. If an external event cannot be resolved to a known linked task, ThinkWork
  must retain it as unmatched event data for diagnostics/querying.
- R14. Unmatched events must not wake an agent in v1.
- R15. V1 must not include fuzzy routing, manual attach, subject matching,
  broad CRM record routing, user-facing unmatched-event inbox UI, or non-task
  Twenty events beyond linked task status/comment events.

**Twenty producer path**

- R16. The preferred Twenty producer path is a native Twenty app logic function
  that emits the standard ThinkWork external event payload.
- R17. A Twenty webhook producer is an acceptable fallback if the native app
  package path is not ready enough for the first proof.
- R18. The first end-to-end demo must prove both a status change and a
  comment/note on a ThinkWork-created Twenty task flowing back to the same
  Thread and triggering the wake loop when enabled.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R4, R16.** Given a Twenty task update producer is
  configured, when a user marks a ThinkWork-created Twenty onboarding task
  complete, then Twenty sends a structured event that ThinkWork can parse as a
  generic external event, not as a CRM-only special case.
- AE2. **Covers R5, R6, R7, R8.** Given the onboarding agent created a Twenty
  task and stored its external task identity on a linked task, when a matching
  task status event arrives, then ThinkWork resolves the event to that linked
  task and owning Thread without title or customer-name matching.
- AE3. **Covers R10, R11, R12.** Given a resolved Twenty task comment event
  arrives and the Thread wake policy is append-and-wake, when ThinkWork records
  the event, then the Thread receives a concise external-event message with
  structured metadata and the assigned agent gets a normal wakeup turn.
- AE4. **Covers R13, R14, R15.** Given a valid Twenty task event arrives for a
  task that ThinkWork did not create or cannot identify, when ThinkWork
  processes it, then the event is retained as unmatched and no Thread or agent
  is woken.
- AE5. **Covers R17, R18.** Given the native Twenty app logic-function path is
  blocked during planning or implementation, when the team uses Twenty webhooks
  as the fallback producer, then the first demo still proves both task status
  and task comment events flowing into the Thread wake loop through the same
  generic event contract.

---

## Success Criteria

- A customer onboarding Thread can receive activity from Twenty tasks that were
  created by the ThinkWork agent, without a human manually attaching those
  tasks to the Thread.
- A status change and a comment/note made in Twenty appear as compact Thread
  messages and can trigger a normal agent turn.
- The implementation direction remains generic enough for future producers
  while the v1 proof stays limited to Twenty linked task events.
- Planning can proceed without inventing routing rules, wake behavior,
  unmatched-event behavior, or v1 scope boundaries.

---

## Scope Boundaries

- V1 uses the existing customer onboarding webhook path to start the Thread; it
  does not move opportunity-won startup into Thread Event Sources.
- V1 routes external events to Threads only. It does not introduce direct Goal
  routing.
- V1 resolves events only through known linked task identity. No fuzzy routing,
  matching by title, matching by customer, or subject matching.
- V1 does not support manually attaching pre-existing Twenty tasks to ThinkWork
  linked tasks.
- V1 stores unmatched events for diagnostics/querying but does not include a
  user-facing unmatched-event inbox or attach/dismiss UI.
- V1 does not include broad CRM record events such as opportunity notes,
  company updates, person updates, or opportunity status changes after Thread
  creation unless they are represented as linked task status/comment events.
- V1 does not hardcode agent behavior for specific event types. Agent
  instructions determine the response after wakeup.

---

## Key Decisions

- **Thread Event Sources is the feature name.** It keeps the product frame
  generic while v1 remains scoped to linked task events.
- **Generic contract, Twenty implementation.** The payload and intake behavior
  should be producer-neutral; Twenty task events are the first concrete proof.
- **Automatic linkage only in v1.** A Twenty task is routable when ThinkWork
  created it and stored the returned external task identity on a linked task.
- **No fuzzy routing.** Unresolved events are retained but do not wake agents.
- **Normal agent turns.** External task events create Thread messages and wake
  the agent through the existing wake loop rather than branching into
  event-specific agent behavior.
- **Native Twenty producer preferred.** Twenty app logic functions are the
  preferred producer, with webhooks as a fallback for the proof.

---

## Dependencies / Assumptions

- ThinkWork's existing linked task and linked task event model is the right
  place to represent the first resource binding for external task events.
- The customer onboarding workflow already creates a Thread from a closed-won
  Twenty opportunity, so Thread Event Sources does not need to own startup in
  v1.
- Twenty task creation through MCP can return stable task identifiers that
  ThinkWork can persist and later use for event resolution.
- Twenty app logic functions can emit the needed task update/comment payloads;
  if that assumption does not hold, Twenty webhooks are the accepted fallback.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R1-R4][Technical] What exact normalized event fields are required
  for the standard external event payload?
- [Affects R3][Technical] What producer authentication/signature mechanism
  should v1 use for native Twenty app logic functions and webhook fallback?
- [Affects R6-R7][Technical] What minimal changes are needed to support Twenty
  as a linked task provider and map Twenty statuses/comments into existing
  linked task status/event types?
- [Affects R9-R12][Technical] Which existing wakeup mechanism should receive
  the external-event Thread message so the agent turn behaves like other normal
  Thread activity?
- [Affects R13-R14][Technical] What durable store or existing event table should
  retain unmatched events for diagnostics/querying?

---

## Next Steps

-> /ce-plan for structured implementation planning.
