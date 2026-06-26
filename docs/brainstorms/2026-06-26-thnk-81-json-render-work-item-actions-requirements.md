---
date: 2026-06-26
topic: thnk-81-json-render-work-item-actions
linear_issue: THNK-81
---

# json-render Work Item Status Actions

## Problem Frame

ThinkWork Threads can now render validated `data-json-render` UI parts with
durable action controls, but those controls only create an audit-like user
message today. They do not yet perform bounded product mutations. THNK-81 should
connect generated UI approval controls to native Work Item status updates while
preserving the existing `ask_user_question` path for blocking conversational
approval/deny moments.

The product distinction matters: a blocking HITL question is how an agent parks
and resumes a turn; a generated UI action is how an inline card performs a
validated first-party action immediately.

---

## Actors

- A1. End user: Reviews an approval surface in a Thread and either answers a
  blocking question or clicks an inline generated UI action.
- A2. Thread agent: Chooses whether the moment calls for `ask_user_question` or
  a generated `data-json-render` approval UI, then updates Work Item state
  through the appropriate path.
- A3. Web Thread renderer: Displays question cards and json-render parts,
  submits user actions, and reflects the resulting Thread and Work Item state.
- A4. ThinkWork platform: Validates source Thread context, tenant access,
  durable action descriptors, idempotency, and Work Item status mutations.
- A5. Planner/implementer: Adds the bounded bridge without creating arbitrary
  callback, URL, browser execution, or agent-tool execution authority.

---

## Key Flows

- F1. Blocking HITL approval updates a Work Item
  - **Trigger:** The agent needs the user's answer before continuing its plan.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The agent calls `ask_user_question` with approve/deny options,
    the Thread parks, the user answers through the question card, the agent
    resumes with the answer, and the agent updates the referenced Work Item
    through the existing Work Item status path.
  - **Outcome:** The Thread shows the question, selected answer, resumed agent
    action, and Work Item status/event history.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. Generated UI action updates a Work Item immediately
  - **Trigger:** A persisted `data-json-render` part displays an inline review
    card or action form with a durable approve/reject/submit action.
  - **Actors:** A1, A3, A4
  - **Steps:** The user clicks the rendered action, the platform revalidates the
    source assistant message and part, checks the durable action descriptor and
    idempotency key, routes a recognized Work Item status action to the native
    Work Item status update path, and records a Thread audit message.
  - **Outcome:** The Work Item status changes without waking the agent for an
    arbitrary callback, and repeated clicks do not duplicate the mutation or
    audit message.
  - **Covered by:** R6, R7, R8, R9, R10, R11, R12

- F3. Display-only generated UI remains non-mutating
  - **Trigger:** The agent renders a json-render card meant only for review or
    explanation.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The part omits durable mutation descriptors; the renderer displays
    the UI, and no Work Item mutation path is exposed.
  - **Outcome:** Safe generated UI remains useful without implying every card is
    actionable.
  - **Covered by:** R13, R14

---

## Requirements

**Approval path distinction**

- R1. Blocking approval/deny questions must continue to use
  `ask_user_question` when the agent needs to pause, receive the answer as a
  tool result, and continue its plan.
- R2. A HITL approval answer must allow the resumed agent to update the
  referenced Work Item through the existing Work Item status capability.
- R3. HITL approval history must remain visible in the Thread: pending question,
  selected answer, and follow-up agent action.
- R4. HITL Work Item status changes must preserve Work Item event history with
  thread provenance.
- R5. The generated UI action path must not replace or collapse the blocking
  question primitive.

**Generated UI Work Item action adapter**

- R6. Generated UI durable actions may perform first-party mutations only
  through recognized adapter targets; THNK-81's v1 adapter target is Work Item
  status update.
- R7. A Work Item status action must identify the Work Item and the desired
  status outcome using the existing Work Item status model, including supported
  categories such as todo, active, blocked, done, and skipped.
- R8. Approve/deny labels do not hardcode global status outcomes; each durable
  action descriptor carries the intended status category or status id. Test
  fixtures may use approve -> done and deny -> blocked as the proving example.
- R9. The server must preserve existing generated UI source validation:
  requester auth, thread visibility, assistant source message, source part id,
  `data-json-render` validation, spec hash match, params equality, disabled
  action rejection, idempotency, and rate limiting.
- R10. Unknown adapter targets, missing required Work Item adapter params, stale
  source parts, invalid specs, disabled actions, and tampered params must fail
  closed without mutating Work Item state.
- R11. Successful generated UI actions must still write a Thread audit message
  with `jsonRenderAction` metadata, augmented where useful with the mutation
  result.
- R12. Generated UI actions must not dispatch arbitrary agent tools, arbitrary
  callbacks, browser URLs, or free-form server execution.

**Agent and UI guidance**

- R13. Agent/runtime guidance must make actionable approval UI descriptor
  completeness explicit: the rendered component's action reference must match a
  durable action descriptor.
- R14. Display-only generated UI remains allowed and should not require a durable
  action descriptor when no mutation is intended.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R4.** Given an agent needs a blocking Work Item
  decision, when it asks through `ask_user_question` and the user selects
  Approve, then the agent resumes, updates the Work Item to the configured
  approved status, and the Thread shows both the answer and follow-up action.
- AE2. **Covers R6, R7, R8, R9, R11.** Given a persisted `data-json-render` part
  contains an approve durable action targeting a linked Work Item with status
  category done, when the user clicks Approve, then the source part validates,
  the Work Item moves to the appropriate done/final status, and one
  `jsonRenderAction` audit message is recorded.
- AE3. **Covers R8, R10.** Given a reject durable action targets the same Work
  Item with status category blocked, when the user clicks Reject, then the Work
  Item moves to a blocked status; if the submitted params are changed client-side
  before submission, no mutation occurs.
- AE4. **Covers R10, R12.** Given a durable action uses an unknown target or
  tries to encode an arbitrary callback, when submitted, then the server returns
  a bad-input style failure and does not route to agent execution or browser
  execution.
- AE5. **Covers R13, R14.** Given an agent renders an approval card without a
  matching durable action descriptor, when the card appears, then it is
  display-only or rejected as incomplete according to renderer validation; the
  agent guidance/tests prevent this from being the expected approval path.

---

## Success Criteria

- Users can prove both approval modes end to end: a blocking question resumes an
  agent that updates a Work Item, and an inline generated UI action updates a
  Work Item immediately.
- Work Item status, event history, and Thread history agree after either path.
- Planning can proceed without re-deciding whether generated UI actions should
  become arbitrary callbacks, whether HITL questions are still distinct, or
  whether deny means one global status.

---

## Scope Boundaries

- Do not collapse generated UI actions and `ask_user_question` into one
  mechanism.
- Do not add arbitrary callback URLs, browser-side effect authority, or free-form
  tool execution to generated UI.
- Do not create a generic first-party mutation bus beyond the Work Item status
  adapter in this issue.
- Do not require every generated UI part to be actionable; display-only
  json-render remains valid.
- Do not redesign the Work Items status model or add new global status
  categories as part of this work.
- Do not require mobile-native json-render action support in this issue; mobile
  fallback behavior may remain display-oriented unless planning finds an already
  supported path.

---

## Key Decisions

- Keep two product paths: `ask_user_question` is for blocking turn-resume
  moments; generated UI durable actions are for immediate bounded UI mutations.
- Use first-party adapters only: generated UI may request a named ThinkWork
  mutation target, not arbitrary code execution.
- Make status outcome descriptor-driven: approve/reject labels are UX language;
  the durable action descriptor defines the actual Work Item status target.
- Preserve audit on both ledgers: Work Item events prove durable state changes,
  and Thread messages prove what the user clicked or answered.

---

## Dependencies / Assumptions

- Verified context: `apps/web/src/components/workbench/json-render/use-json-render-action.ts`
  submits generated UI durable actions to `handleJsonRenderAction`.
- Verified context:
  `packages/api/src/graphql/resolvers/messages/handleJsonRenderAction.mutation.ts`
  validates source parts and records `jsonRenderAction` messages but does not
  yet mutate Work Items.
- Verified context:
  `packages/api/src/lib/work-items/work-item-service.ts` exposes
  `updateWorkItemStatus`, records Work Item events, and resolves status category
  through the existing Space status model.
- Verified context: `packages/pi-extensions/src/task-status.ts` exposes
  `set_work_item_status` for agent-driven Work Item status updates.
- Verified context: `docs/brainstorms/2026-06-09-ask-user-question-requirements.md`
  defines `ask_user_question` as the blocking clarification/HITL primitive.
- Verified context:
  `docs/brainstorms/2026-06-26-thnk-77-json-render-shadcn-foundation-requirements.md`
  establishes `data-json-render` as the generated UI carrier.
- Assumption: the end-to-end proof can use a single linked test Work Item with
  approve -> done and deny -> blocked mappings.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6, R7, R11][Technical] Decide whether the adapter calls the GraphQL
  resolver wrapper or the shared Work Item service directly so auth, event
  metadata, and mutation result metadata stay coherent.
- [Affects R13][Technical] Identify the runtime/system-prompt and fixture tests
  that should enforce durable action descriptor completeness for natural
  approval prompts.
- [Affects R10][Technical] Decide exact GraphQL error codes/messages for adapter
  validation failures while preserving current generated UI action failure
  behavior.

---

## Next Steps

-> `/ce-plan` for structured implementation planning.
