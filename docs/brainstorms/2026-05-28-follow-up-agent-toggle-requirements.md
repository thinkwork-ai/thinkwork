---
date: 2026-05-28
topic: follow-up-agent-toggle
---

# Follow-Up Agent Toggle

## Problem Frame

Spaces Threads now support multiplayer collaboration, but the follow-up composer still treats every ordinary user message as a request for the agent to respond. That is right for agent-first work, but wrong for human-to-human coordination inside the same Thread. Users need a lightweight way to send one message as collaborator chat without waking the default agent, while still having an obvious way to invoke the agent when they want help.

---

## Actors

- A1. Thread participant: sends follow-up messages, sometimes to collaborators and sometimes to the agent.
- A2. Default Thread agent: receives ordinary agent-targeted follow-ups and `@agent` / `@think` mentions.
- A3. Mentioned collaborator: receives human mention behavior without automatically turning every message into an agent request.

---

## Key Flows

- F1. Send an agent-targeted follow-up by default
  - **Trigger:** A user opens the follow-up composer in a Thread.
  - **Actors:** A1, A2
  - **Steps:** The robot toggle is on by default. The user types a message and sends it without changing the toggle.
  - **Outcome:** The message is posted to the Thread and the default agent is eligible to respond, preserving today's agent-first behavior.
  - **Covered by:** R1, R2, R8

- F2. Send one human-only follow-up
  - **Trigger:** A user wants to update collaborators without waking the agent.
  - **Actors:** A1, A3
  - **Steps:** The user turns the robot toggle off, writes a message, and sends it.
  - **Outcome:** The message is posted to the Thread without dispatching the default agent, and the next composer send starts with the robot toggle on again.
  - **Covered by:** R1, R3, R4, R8

- F3. Invoke the agent with a mention shortcut
  - **Trigger:** A user wants to explicitly bring the agent into the message.
  - **Actors:** A1, A2
  - **Steps:** The user opens the mention picker, selects the special top item labeled `agent`, or types `@agent` / `@think`. The composer shows that the robot toggle is on before send.
  - **Outcome:** The sent message wakes the default Thread agent even if the robot toggle had previously been off.
  - **Covered by:** R5, R6, R7, R8

---

## Requirements

**Composer control**

- R1. The follow-up composer must include a robot/agent toggle in the footer, visually placed to the left of the existing mention and attachment controls.
- R2. The robot toggle must be on by default whenever the follow-up composer is ready for a new send.
- R3. Turning the robot toggle off must apply only to the next successfully sent message, not to the whole Thread or session. Failed sends preserve the current toggle state so the user can retry without rebuilding intent.
- R4. After a successful human-only send, the composer must reset the robot toggle to on.

**Mention shortcuts**

- R5. The mention picker must include a special top item labeled `agent` with a distinct agent/robot icon.
- R6. Selecting the special `agent` mention must insert an agent mention and turn the robot toggle on before send.
- R7. `@agent` and `@think` must be equivalent aliases for explicitly invoking the default Thread agent. Neither alias should expose or require the concrete agent's name.

**Send semantics**

- R8. A user follow-up must wake the default Thread agent when either the robot toggle is on or the message explicitly invokes `@agent` / `@think`.
- R9. A user follow-up must not wake the default Thread agent when the robot toggle is off and the message does not explicitly invoke `@agent` / `@think`.
- R10. Existing collaborator mentions and attachment behavior must continue to work whether the robot toggle is on or off.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R8.** Given a user opens a Thread follow-up composer, when they type "Can you summarize this?" and send without touching the footer, then the message posts and the default agent is dispatched.
- AE2. **Covers R3, R4, R9.** Given the robot toggle is on, when the user turns it off and sends "I handled the DocuSign package", then the message posts without default agent dispatch and the next empty composer shows the robot toggle on again.
- AE3. **Covers R5, R6, R7, R8.** Given the robot toggle is off, when the user selects the top mention picker item labeled `agent`, then the composer inserts an agent mention, flips the robot toggle on, and the sent message wakes the default Thread agent.
- AE4. **Covers R7, R8.** Given the user types either `@agent` or `@think` in the message, when they send it, then the default Thread agent is invoked without requiring the user to know the concrete agent name.
- AE5. **Covers R10.** Given the robot toggle is off and the user mentions a teammate or attaches a file, when they send the message, then the teammate/file behavior remains intact and the default agent is not dispatched unless `@agent` / `@think` is also present.

---

## Success Criteria

- Users can collaborate in a Thread without accidentally waking the agent for every human status update.
- Agent-first Threads keep their current default behavior, so the new control does not make normal agent usage slower.
- `@agent` and `@think` provide a memorable explicit invocation path that does not depend on knowing the default agent's actual name.
- Downstream planning can implement the behavior without re-deciding default state, reset behavior, mention labels, or agent-dispatch semantics.

---

## Scope Boundaries

- This does not introduce per-thread or per-user persistent agent mute preferences.
- This does not add smart content classification for deciding whether a message should wake the agent.
- This does not redesign collaborator mention semantics.
- This does not require exposing the default agent's concrete name in the composer.
- This does not change attachment upload, display, or download behavior beyond preserving compatibility with the toggle.
- This does not address mobile parity unless planning chooses to include it as part of the same implementation slice.

---

## Key Decisions

- **Default-on agent toggle:** Preserve the current agent-first behavior while giving users an escape hatch for multiplayer chatter.
- **One-send mute:** A successful human-only send resets back to agent-on so users do not accidentally leave the agent muted across later messages.
- **Special `agent` mention:** The mention picker gets a top, special item labeled `agent`; users do not need to know the backing agent's name.
- **Alias behavior:** `@agent` and `@think` are equivalent and always mean "invoke the default Thread agent."
- **Mention overrides toggle-off:** Selecting or typing the agent alias flips the robot toggle on before send so the UI reflects what will happen.

---

## Dependencies / Assumptions

- The current follow-up composer already supports mention and attachment controls in `apps/spaces/src/components/workbench/TaskThreadView.tsx`.
- Mention picker behavior already exists through `apps/spaces/src/components/spaces/MentionMenu.tsx`.
- The existing send path already distinguishes explicit agent mentions from default agent dispatch in `packages/api/src/graphql/resolvers/messages/sendMessage.mutation.ts`.
- The current product expectation remains that Spaces Threads are shared collaboration records for humans and agents.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R8, R9][Technical] Decide the exact transport shape for telling the backend whether the default agent was requested for this send.
- [Affects R5-R8][Technical] Decide where to normalize typed `@agent` / `@think` aliases so typed shortcuts and picker selection share the same dispatch behavior.
- [Affects R10][Technical] Verify whether the empty-thread composer needs the same control in the first implementation slice or whether this is follow-up-composer only.

---

## Next Steps

-> /ce-plan for structured implementation planning.
