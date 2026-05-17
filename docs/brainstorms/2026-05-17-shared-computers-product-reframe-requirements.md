---
date: 2026-05-17
topic: shared-computers-product-reframe
---

# Shared Computers Product Reframe

## Problem Frame

ThinkWork's current Computer model assumes a durable personal Computer for every user. That was a useful bridge away from user-specific Agents, but it risks recreating the workplace-agent problem seen in early personal-assistant products: every employee gets a bot, every bot needs maintenance, and Slack fills with overlapping personal assistants instead of a small set of trusted coworkers.

The new direction is **shared-only Computers for v1**. A Computer is a managed work capability such as Sales Computer, Finance Computer, Admin Computer, or Engineering Computer. Each shared Computer owns its capabilities, skills, runbooks, workspace, budget, and shared context. Users are assigned access based on role, team, or explicit membership. Personalization comes from attaching the invoking user's personal context and memory to each request, not from giving every user a separate Computer.

This changes the product center of gravity: ThinkWork no longer sells "one AI assistant per employee." It sells a governed roster of shared AI coworkers that many employees can invoke safely, with per-request personal context applied where it helps.

---

## Actors

- A1. End user: sends a request to an assigned shared Computer from Slack or a ThinkWork app surface.
- A2. Tenant operator: creates, configures, assigns, governs, and audits shared Computers.
- A3. Shared Computer: managed AI work capability with a defined role, tools, skills, runbooks, workspace, memory, and budget.
- A4. Requester context layer: loads the invoking user's personal memory/preferences/context for a single request without making the Computer personal.
- A5. Slack workspace participant: sees shared Computer responses in channels or threads, with requester attribution when relevant.
- A6. Planner/implementer: uses this document to rewrite the Computer model without preserving personal-Computer assumptions by accident.

---

## Key Flows

- F1. User sends a message to an assigned shared Computer
  - **Trigger:** A1 opens Slack or the ThinkWork app and chooses a Computer such as Finance Computer.
  - **Actors:** A1, A3, A4
  - **Steps:** The product shows only Computers A1 is allowed to use; A1 selects one and sends a prompt; the request is recorded with both the selected Computer and the invoking user; the runtime combines shared Computer context with requester context; the Computer answers or asks for clarification.
  - **Outcome:** A1 can route work to the right shared capability without needing a personal Computer.
  - **Covered by:** R1, R2, R3, R7, R8, R9

- F2. Shared Computer answers in Slack
  - **Trigger:** A1 invokes an assigned shared Computer from a Slack thread, channel, DM, slash command, or message action.
  - **Actors:** A1, A3, A4, A5
  - **Steps:** Slack resolves the invoking user and available Computers; A1 chooses or names the target Computer; the Computer receives the Slack context plus A1's requester context; the response posts back as the shared Computer, with attribution that A1 requested it.
  - **Outcome:** Slack gets a small roster of trusted team Computers rather than many personal assistants speaking in public.
  - **Covered by:** R2, R3, R6, R8, R10, R11

- F3. Operator manages one shared capability for a whole team
  - **Trigger:** A2 updates the Finance Computer's skills, tools, runbooks, or assignment policy.
  - **Actors:** A2, A3
  - **Steps:** A2 edits the shared Computer configuration once; assignment changes determine who can invoke it; future requests from assigned users all use the updated capability set.
  - **Outcome:** Capability improvement compounds across the team instead of being repeated across personal Computers.
  - **Covered by:** R4, R5, R12, R13

- F4. Personal context is applied without leaking into shared memory
  - **Trigger:** A1 asks a shared Computer for work that benefits from personal context, such as "draft this in my usual tone" or "use what you know about my priorities."
  - **Actors:** A1, A3, A4
  - **Steps:** The requester context layer retrieves relevant user memory for A1; the runtime clearly separates shared Computer context, request/channel context, and A1's personal context; the Computer uses only relevant context and does not permanently absorb private user memory into shared Computer memory unless the user explicitly chooses to share it.
  - **Outcome:** The answer feels personalized while preserving shared Computer continuity and privacy.
  - **Covered by:** R7, R8, R14, R15, R16

---

## Requirements

**Product ontology**

- R1. Shared Computers replace personal Computers as the default and v1-only Computer model.
- R2. A Computer represents a managed shared work capability, not a private assistant owned by one human.
- R3. Users may send messages to multiple Computers, but only to Computers they are assigned or otherwise authorized to use.
- R4. Tenant operators manage shared Computers centrally, including name, role, template, skills, runbooks, tool access, workspace behavior, budgets, and lifecycle.
- R5. Improvements to a shared Computer's capabilities benefit all assigned users without per-user replication.

**Assignment and access**

- R6. The product must expose an assigned-Computers list wherever users can start work, including Slack-facing invocation and the ThinkWork app composer.
- R7. Every request to a shared Computer records both the selected Computer and the invoking user as distinct identities.
- R8. If a user has access to multiple Computers, the user must be able to choose the target Computer before or during message submission.
- R9. If a user has no assigned Computers, the product must fail closed with a clear access/request-assignment path rather than creating a personal Computer.
- R10. Slack public-channel responses must be attributed to the shared Computer, with requester attribution such as "Finance Computer, requested by Eric" when helpful.

**Requester context and memory**

- R11. A shared Computer request may include request context from Slack or the app surface, but it must not gain ambient channel access merely because it is shared.
- R12. The requester context layer injects the invoking user's personal memory, preferences, and relevant history per request.
- R13. Requester context is a scoped overlay, not a mutation of the shared Computer's identity, role, or default memory.
- R14. Personal context must not be written into shared Computer memory or exposed to other users unless the invoking user explicitly shares it or the action is otherwise governed by tenant policy.
- R15. Audit records must make it answerable which shared Computer acted, which user requested the work, what context class was used, and what capabilities were exercised.

**Migration away from personal Computers**

- R16. v1 does not keep a private "My Computer" as a first-class product surface.
- R17. Existing personal Computer state must be migrated, archived, or remapped into shared Computers and user memory without silently orphaning important threads, schedules, workspace files, or credentials.
- R18. Product docs, navigation, and Slack behavior must stop teaching users that one human equals one Computer.

---

## Acceptance Examples

- AE1. **Covers R1, R3, R6, R8.** Given Eric is assigned to Finance Computer and Admin Computer, when he opens the composer, then both appear as selectable targets and no personal "Eric's Computer" target appears.
- AE2. **Covers R3, R9.** Given a user has not been assigned any shared Computer, when they try to send a request, then the product blocks the request and points them to the tenant assignment path instead of creating a personal Computer.
- AE3. **Covers R7, R10, R15.** Given Eric invokes Finance Computer in a Slack thread, when Finance Computer replies, then Slack shows the response as Finance Computer with requester attribution, and audit records both Finance Computer and Eric.
- AE4. **Covers R12, R13, R14.** Given Eric asks Sales Computer to draft a response "in my usual tone," when the Computer answers, then it may use Eric's personal writing preferences for that request, but those preferences do not become shared Sales Computer memory for other users.
- AE5. **Covers R4, R5.** Given an operator adds a new renewal-prep runbook to Sales Computer, when any assigned sales user next invokes Sales Computer, then the new capability is available without updating per-user assistants.
- AE6. **Covers R16, R17, R18.** Given a tenant had personal Computers before the migration, when shared-only v1 ships, then the primary product surfaces, docs, and Slack invocation no longer present those personal Computers as active targets, while important prior state remains reachable through the migration path.

---

## Success Criteria

- A user can describe ThinkWork simply: "Our company has shared Computers for Finance, Sales, Admin, and Engineering; I use the ones assigned to me, and they understand my context when I ask."
- Slack becomes quieter and more legible: a small number of shared Computers speak with clear role identity and requester attribution.
- Operators maintain a capability once for a team rather than managing many personal assistants.
- Requester memory creates useful personalization without turning shared Computers into privacy leaks or per-user forks.
- A downstream planner can implement the model without preserving the "one active Computer per user" assumption except as explicit migration compatibility.

---

## Scope Boundaries

### Deferred for later

- Private personal Computers as an optional advanced feature.
- Team self-service creation of arbitrary new Computers without operator governance.
- A marketplace of shared Computer templates.
- Fully automatic routing that chooses a Computer without the user naming or selecting one.
- Organization-wide conversational memory learned passively from Slack channels.
- Slack Connect and external-org shared-channel handling.

### Outside this product's identity

- ThinkWork is not a fleet of personal assistants that mirror each employee's personality.
- ThinkWork is not a Slack chatbot swarm.
- Shared Computers are not generic group chats with an LLM; they are governed work capabilities with assignments, skills, tools, memory boundaries, and audit.
- Requester context is not a way to bypass a shared Computer's permissions or capability boundaries.

---

## Key Decisions

- **Shared-only v1:** The product should make a clean break from personal Computers rather than keeping a private "My Computer" escape hatch in the main experience.
- **Personalization by context injection:** The invoking user's Hindsight/user memory provides per-request personalization without creating one Computer per user.
- **Assignments are the user-facing routing primitive:** Users choose from Computers assigned to them by role, team, or explicit grant.
- **Slack attribution shifts to shared roles:** Public Slack replies should read as Finance Computer or Sales Computer acting for a requester, not a private assistant speaking into a team room.
- **Shared Computer maintenance is centralized:** The operational win comes from updating one managed shared capability and having the whole assigned group benefit.

---

## Dependencies / Assumptions

- The current Computer model is verified to require `owner_user_id` and a unique active Computer per owner in `packages/database-pg/src/schema/computers.ts`; planning must remove or compatibility-wrap that assumption.
- The current GraphQL Computer contract exposes `ownerUserId` as required in `packages/database-pg/graphql/types/computers.graphql`; planning must update client and API contracts accordingly.
- Existing Computer task records already carry `created_by_user_id`, which is directionally aligned with separate requester attribution, but planning must verify whether it is sufficient.
- Hindsight/user memory can provide requester context at invocation time without requiring every shared Computer to own or copy that memory.
- Existing template, skills, runbooks, and customization work can become the configuration surface for shared Computers rather than personal Computers.
- The May 16 Slack workspace app requirements and plan should be superseded or rewritten around shared Computers before implementation hardens personal-Computer assumptions.

---

## Outstanding Questions

### Resolve Before Planning

None.

### Deferred to Planning

- [Affects R1, R16, R17][Technical] What is the safest data migration from required personal Computer ownership to shared Computer ownership without losing existing threads, tasks, schedules, runbooks, artifacts, or workspace state?
- [Affects R3, R6, R8][Technical] What assignment model should v1 use: direct user assignment, tenant role assignment, team assignment, template assignment, or a minimal combination?
- [Affects R7, R12, R15][Technical] What exact task envelope separates Computer identity, requester identity, surface context, requester memory, and shared Computer context?
- [Affects R12, R14][Technical] Where should requester-memory filtering happen so personal memory is relevant, bounded, and auditable before it reaches the shared Computer?
- [Affects R10][UX] What is the exact Slack selection pattern for multiple assigned Computers: command text, modal picker, app home default, mention syntax, or a combination?
- [Affects R17][Technical] How should existing personal Computer workspaces be mapped: archived as historical user workspaces, copied into role Computers, left as read-only, or selectively promoted?
- [Affects R18][Technical] Which docs, app routes, generated GraphQL clients, and tests encode "one Computer per user" and must be rewritten in the same plan?

---

## Next Steps

-> /ce-plan for structured implementation planning.
