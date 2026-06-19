---
date: 2026-06-19
topic: space-webhook-thread-start
---

# Space Webhook Thread Start

## Problem Frame

Space webhooks are documented as a way for external POSTs to create or wake work
inside a configured Space, but the current generic webhook path can create an
empty thread and then fail before any useful thread content appears. The live
Twenty Customer Stage webhook exposed the gap: the inbound event was accepted,
the webhook delivery row showed success, and a Customer Space thread was
created, but the thread had no opening message, no Customer Onboarding goal,
no linked tasks, and the agent wakeup failed on private-Space workspace access.

ThinkWork needs a clear product contract for Space webhooks: a webhook attached
to a Space is a configured machine principal for that Space. It should be able
to start a fresh Space thread, seed a visible system/trigger message, invoke the
tenant platform agent in that Space, and allow any automatic Space thread-start
workflow to initialize deterministically.

---

## Actors

- A1. Tenant operator: configures Space webhooks and can inspect delivery history.
- A2. External system: sends authenticated webhook POSTs, such as Twenty CRM when an opportunity reaches Customer stage.
- A3. Space participant: opens the resulting thread and expects a readable case record.
- A4. Tenant platform agent: runs in the Space context after the thread is created.
- A5. Space workflow starter: initializes deterministic workflow state, such as Customer Onboarding goals and checklist rows, when the Space is configured for it.

---

## Key Flows

- F1. Generic Space webhook creates an agent-ready thread
  - **Trigger:** An external system POSTs to a webhook configured on a Space.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** ThinkWork validates the webhook token or configured signature, resolves the configured Space, creates a fresh thread in that Space, writes an opening system/trigger message with a human-readable summary, stores the full payload in metadata/delivery history, and invokes the tenant platform agent with the full structured payload in Space context.
  - **Outcome:** Humans see a readable non-empty thread, and the agent sees the full event context without pretending a human sent the message.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7

- F2. Space workflow initializes on webhook-created thread
  - **Trigger:** A webhook creates a thread in a Space that has an automatic thread-start workflow configured.
  - **Actors:** A2, A3, A5
  - **Steps:** The webhook-created thread goes through the same Space thread-start behavior as a normal new Space thread. If the Space workflow exists, ThinkWork starts it deterministically, creating its expected thread metadata, goal state, checklist rows, and kickoff artifacts before or alongside the agent invocation.
  - **Outcome:** Workflow Spaces behave consistently across chat, email, schedule, and webhook entry points.
  - **Covered by:** R8, R9, R10, R11

- F3. Workflow initialization fails visibly
  - **Trigger:** The webhook-created thread is accepted, but the Space workflow starter fails.
  - **Actors:** A1, A2, A3
  - **Steps:** ThinkWork keeps the thread, writes a visible workflow-start failure into the thread, records the failure in webhook delivery history, and returns a successful accepted response with warning details.
  - **Outcome:** External systems do not retry into duplicate threads, and humans are not left with a silent "preparing" thread.
  - **Covered by:** R12, R13, R14

---

## Requirements

**Space webhook authority**

- R1. A webhook configured on a Space is authorized as a system trigger for that Space. It does not need to resolve to a human user to create or run work inside a private Space.
- R2. Private Space membership gates who can configure, view, or manage the webhook, not whether the webhook can run after an authorized operator configured it.
- R3. Inbound execution must still require the webhook to be enabled, the Space to be active, and the request to pass the webhook's configured authentication checks.

**Thread creation and opening record**

- R4. Each valid Space webhook call creates a fresh thread. V1 does not dedupe repeated payloads into an existing thread.
- R5. A webhook-created thread must not be empty. ThinkWork writes an opening system/trigger message before invoking the agent.
- R6. The opening message is attributed to the webhook/system trigger, not to a fake human, configured owner user, or untrusted external actor.
- R7. Humans see a readable configured summary in the opening message. The full raw payload is stored in metadata and webhook delivery history rather than dumped into the conversation.

**Agent invocation**

- R8. After creating the thread and opening message, ThinkWork invokes the tenant platform agent in the target Space.
- R9. The agent receives the full structured webhook payload in turn context even though humans see only the readable summary.
- R10. Async/no-human webhook invocations render Space context without `USER.md` or user-scoped memory context, following the no-user automation model from `docs/brainstorms/2026-05-22-one-platform-agent-spaces-runtime-requirements.md`.

**Space workflow behavior**

- R11. Webhook-created Space threads must participate in the same automatic Space thread-start workflow behavior as other newly created Space threads.
- R12. If a Space has a configured workflow such as Customer Onboarding, the webhook path starts that workflow deterministically instead of relying on the agent to infer and recreate workflow state from payload text.
- R13. Workflow initialization failures are visible in the thread and in webhook delivery history.
- R14. A webhook request that created a thread but encountered workflow initialization warnings returns a 201 or 202 response with warning details, not a non-2xx response that encourages external retries and duplicate threads.

**Twenty Customer Stage acceptance case**

- R15. The existing Twenty Customer Stage webhook is the first acceptance case for this contract. A Customer-stage opportunity event should create a Customer Space thread with a readable system trigger message, start the Customer Onboarding workflow when the Space is configured for it, create the expected goal/checklist state, and invoke the agent in Customer Space context.
- R16. The current failure mode must not recur: a successful Twenty webhook delivery must not leave a thread with zero messages, zero goals, zero linked tasks, and a timed-out generic webhook turn.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3.** Given a private Customer Space with an enabled webhook configured by an authorized operator, when Twenty POSTs a valid Customer-stage opportunity event, then ThinkWork accepts the event as a system Space trigger even though no human user is present.
- AE2. **Covers R4, R5, R6, R7.** Given a valid Space webhook call, when ThinkWork creates the thread, then the thread contains an opening system/trigger message with a readable summary and the raw payload is available through metadata/delivery history rather than shown as raw JSON in chat.
- AE3. **Covers R8, R9, R10.** Given the thread is created from a webhook, when the platform agent runs, then it runs in the target Space context with the full structured payload and no fabricated user context.
- AE4. **Covers R11, R12, R15.** Given the Customer Space is configured for Customer Onboarding, when the Twenty Customer Stage webhook creates a thread, then the Customer Onboarding workflow initializes the expected goal and checklist state instead of the agent merely interpreting a generic webhook message.
- AE5. **Covers R13, R14.** Given a valid webhook creates a thread but workflow initialization fails, when ThinkWork responds to the external POST, then the response is 201 or 202 with warning details, and the thread and delivery history show the workflow-start failure.
- AE6. **Covers R16.** Given the live Twenty Customer Stage scenario from June 19, 2026, when the same class of event is delivered after this work ships, then the resulting thread is not stuck in an empty "preparing" state and the webhook delivery history distinguishes accepted, initialized, and degraded states.

---

## Success Criteria

- Operators can configure a webhook on a Space and trust that valid inbound events create useful, inspectable Space threads.
- Private Spaces support machine-triggered work without requiring fake user attribution or weakening human membership controls.
- Workflow Spaces behave consistently regardless of whether a thread starts from chat, email, schedule, or webhook.
- The Twenty Customer Stage flow becomes a reliable proof: Closed Won or Customer-stage CRM events create Customer Onboarding work, not empty generic webhook threads.
- A downstream planner can implement the contract without inventing authority semantics, attribution, payload visibility, failure behavior, or the first acceptance case.

---

## Scope Boundaries

- V1 always creates a fresh thread per valid webhook call. Event-level idempotency or "reuse thread by external id" is deferred.
- V1 does not require mapping webhook payloads to registered tenant users.
- V1 does not trust external actor identity for message attribution. Payload-provided owner/contact/requester data may be stored as metadata, but the opening message is still system-triggered.
- V1 does not require raw payload rendering in the chat transcript.
- V1 does not make every webhook workflow-only. Generic Space webhook thread creation remains valid.
- V1 does not redesign provider-specific routing rules across Slack, GitHub, email, or future integrations. It defines the Space webhook thread-start contract.

---

## Key Decisions

- **Space webhook as machine principal:** A configured webhook carries Space authority after operator setup. This matches the documented Space-trigger model and avoids fake user attribution.
- **Fresh thread per POST:** The first contract stays simple and avoids event-key configuration. Dedupe can come later when a concrete integration requires it.
- **System opening message:** The thread should be auditable and non-empty without pretending that a human sent the event.
- **Readable summary for humans, full payload for agent:** Humans get a clean thread; the agent still has the structured facts it needs.
- **Workflow starts as normal Space thread behavior:** Customer Onboarding should not be a webhook special case. If the Space has a thread-start workflow, webhook-created threads participate in it.
- **Degraded success on workflow failure:** Once a thread exists, a non-2xx response risks duplicate external retries. Warning details plus visible thread failure are the safer behavior.
- **Twenty as first acceptance case:** The live failing path keeps the generic requirements honest and proves the behavior against a real managed CRM workflow.

---

## Dependencies / Assumptions

- The Space access model already distinguishes human access from system/automation invocation paths, but current webhook/wakeup behavior does not yet apply that distinction consistently.
- Space workflow configuration exists or is expected to exist as automatic thread-start behavior for workflow Spaces such as Customer Onboarding.
- Webhook delivery history remains the durable audit surface for raw payload inspection and degraded execution warnings.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] Which existing authentication modes for generic webhooks should be retained, tightened, or extended for Space webhooks?
- [Affects R7][Technical] Where should the human-readable summary template live: webhook configuration, Space trigger configuration, or a Space workflow template?
- [Affects R11, R12][Technical] Which current thread creation paths already trigger Space workflows, and which helper should become the shared entry point for chat, email, schedule, and webhook starts?
- [Affects R13, R14][Technical] What exact warning shape should be returned to webhook callers and stored in delivery history?

---

## Next Steps

-> /ce-plan for structured implementation planning.
