---
date: 2026-06-20
topic: n8n-thinkwork-agent-step-bridge
linear: THNK-54
---

# n8n to ThinkWork Agent-Step Bridge

## Problem Frame

ThinkWork's n8n plugin makes n8n a managed workflow automation runtime that
agents can inspect and help maintain. The next product step is letting n8n use
ThinkWork as a durable agent step inside deterministic workflows: n8n owns the
visual workflow and state machine, while ThinkWork owns agent threads, memory,
policy, human review, and audit.

V1 should prove this with stock n8n HTTP Request and Wait nodes. A workflow
starts a ThinkWork agent step, hibernates at an n8n Wait node, and resumes only
when ThinkWork calls the n8n resume webhook with a structured result. This keeps
the contract webhook-first and node-later: the first value is the stable
start/resume/result semantics, not a custom n8n node or a second MCP control
surface.

---

## Actors

- A1. n8n workflow author: Builds deterministic workflows that call ThinkWork
  for enrichment, classification, drafting, or recommendation steps.
- A2. n8n runtime: Executes the workflow, hibernates at Wait nodes, and resumes
  when ThinkWork calls the supplied resume URL.
- A3. ThinkWork bridge: Authenticates the managed n8n call, creates or resumes
  the ThinkWork thread, tracks lifecycle state, and calls n8n back with the
  final result.
- A4. ThinkWork agent: Performs the agentic work inside the target Space using
  ThinkWork memory, policy, MCP tools, and thread context.
- A5. ThinkWork reviewer/operator: Resolves human-needed states inside
  ThinkWork when the agent cannot complete autonomously.
- A6. Downstream n8n steps: Consume the structured ThinkWork result and continue
  deterministic workflow branching.

---

## Key Flows

- F1. n8n starts a ThinkWork enrichment step
  - **Trigger:** A deterministic n8n workflow reaches a step that needs agentic
    enrichment, classification, drafting, or recommendation.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** The workflow calls the ThinkWork bridge using the tenant n8n
    bridge credential, passes structured input, correlation metadata, target
    Space context, timeout preference, and an n8n resume URL. ThinkWork creates
    or resumes a visible thread in the target Space, invokes the agent, and
    returns an accepted state to n8n. The n8n workflow then waits at its Wait
    node instead of polling.
  - **Outcome:** The deterministic n8n workflow is hibernating, and the agentic
    work is visible in ThinkWork as a normal Space thread.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8

- F2. ThinkWork resumes n8n with a successful result
  - **Trigger:** The ThinkWork agent completes the requested step.
  - **Actors:** A3, A4, A6
  - **Steps:** ThinkWork records the final thread outcome, assembles structured
    machine-readable output plus a compact human summary and thread/trace links,
    and calls the n8n resume URL. n8n resumes from the Wait node and branches
    using the structured result.
  - **Outcome:** n8n continues deterministically from an auditable ThinkWork
    agent result.
  - **Covered by:** R9, R13, R14, R15, R16

- F3. ThinkWork holds for human review before resuming n8n
  - **Trigger:** The agent cannot complete without human input or approval.
  - **Actors:** A3, A4, A5, A6
  - **Steps:** ThinkWork keeps the n8n workflow waiting, routes the review need
    through the normal ThinkWork thread/inbox experience, and resumes n8n only
    after the review resolves into success or failure.
  - **Outcome:** Workflow authors do not have to recreate ThinkWork's
    human-in-the-loop mechanics inside each n8n workflow.
  - **Covered by:** R10, R11, R13, R14, R15

- F4. A waiting bridge run expires
  - **Trigger:** A ThinkWork agent step exceeds the platform default timeout or
    an allowed per-call override.
  - **Actors:** A2, A3, A6
  - **Steps:** ThinkWork marks the bridge run expired, records the thread state,
    and calls the n8n resume URL with a structured expired/failed result plus
    summary and trace links.
  - **Outcome:** n8n workflows do not wait indefinitely, and stale work remains
    auditable in ThinkWork.
  - **Covered by:** R12, R13, R14, R15

---

## Requirements

**V1 product shape**

- R1. V1 must prove n8n calling ThinkWork as a durable agent step and waiting
  for a result, not n8n as only another generic event source.
- R2. The first acceptance example must be an enrichment, classification,
  drafting, or recommendation step inside a deterministic n8n workflow.
- R3. V1 must officially support stock n8n HTTP Request and Wait nodes only.
  ThinkWork Control MCP and a custom ThinkWork n8n node are deferred until the
  bridge contract is stable.
- R4. The v1 bridge assumes the managed n8n plugin context and uses one
  tenant-scoped n8n bridge credential rather than per-user OAuth or
  per-workflow credential setup.

**Start and wait contract**

- R5. Each bridge start request must carry enough structured context for audit
  and routing: target Space, task instructions, structured input, correlation
  id, n8n workflow identity, n8n execution identity, optional timeout override,
  and the n8n resume URL.
- R6. ThinkWork must attribute bridge calls to the managed n8n app plus
  workflow, execution, correlation, and request metadata. It must not attribute
  the work to a fabricated human user.
- R7. ThinkWork must create or resume a normal visible thread in the target
  Space for each accepted bridge run.
- R8. The v1 waiting model must be callback/resume-first: n8n hibernates at a
  Wait node, and ThinkWork calls the supplied resume URL when the agent step
  resolves. Polling is not the default v1 contract.
- R9. Bridge correlation must be stable enough that safe retries do not create
  duplicate visible ThinkWork threads for the same n8n workflow execution and
  agent step.

**Human review and expiry**

- R10. When an agent step needs human input, ThinkWork must hold the bridge run
  inside the ThinkWork thread/inbox flow instead of immediately resuming n8n
  with a `needs_human` terminal result.
- R11. ThinkWork must resume n8n only after human-needed work resolves to
  success, failure, or expiry.
- R12. V1 must apply a platform default timeout with bounded per-call override.
  Indefinite waiting must not be the default behavior.
- R13. On expiry, ThinkWork must resume n8n with a structured expired or failed
  result, compact human summary, and thread/trace links.

**Result and audit**

- R14. The resume payload must include structured JSON that n8n can branch on,
  including lifecycle status, output fields, errors when present, and stable
  identifiers.
- R15. The resume payload must also include a compact human-readable summary and
  links back to the ThinkWork thread and trace.
- R16. n8n must not have to scrape a ThinkWork thread URL to continue the
  workflow deterministically.
- R17. ThinkWork must retain enough bridge telemetry to connect a ThinkWork
  thread, n8n workflow, n8n execution, correlation id, resume result, timeout,
  and final status during operator review.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R3, R5, R8.** Given an n8n workflow needs an enrichment
  decision, when it calls the ThinkWork bridge through a stock HTTP Request node
  and then waits at a Wait node, then ThinkWork accepts the run and n8n
  hibernates instead of polling.
- AE2. **Covers R4, R6, R7.** Given the managed n8n plugin has a tenant bridge
  credential, when a workflow starts an agent step, then ThinkWork creates a
  visible target-Space thread attributed to the managed n8n app, workflow id,
  execution id, and correlation id rather than to a fake human.
- AE3. **Covers R10, R11, R14, R15.** Given the agent needs human review, when a
  reviewer resolves the request in ThinkWork, then ThinkWork resumes n8n with a
  success or failure payload containing structured fields, a compact summary,
  and thread/trace links.
- AE4. **Covers R12, R13.** Given a bridge run exceeds the platform default
  timeout or allowed override, when ThinkWork expires the run, then n8n is
  resumed with an expired or failed result and operators can inspect the
  ThinkWork thread and trace.
- AE5. **Covers R3, R16, R17.** Given a workflow author reviews the v1 bridge
  recipe, when they implement it, then they can use stock n8n nodes and
  structured resume data without a ThinkWork Control MCP, custom n8n node, or
  thread-scraping step.

---

## Success Criteria

- A workflow author can build the first ThinkWork agent-step bridge using only
  stock n8n HTTP Request and Wait nodes.
- n8n workflows can hibernate while ThinkWork performs long-running or
  human-reviewed agent work, avoiding polling-first workflow pressure.
- Every bridge run is auditable as a normal ThinkWork Space thread with
  n8n workflow/execution/correlation metadata.
- n8n resumes with structured output that can drive deterministic branches and
  with human-readable links for operator review.
- Planning can proceed without inventing the product stance on waiting,
  credentialing, human review, result shape, visibility, timeout behavior, or
  v1 authoring surface.

---

## Scope Boundaries

- V1 does not include a custom ThinkWork n8n node.
- V1 does not include a ThinkWork Control MCP surface for n8n or other workflow
  engines.
- V1 does not make polling the baseline workflow pattern.
- V1 does not expose per-user n8n-to-ThinkWork OAuth delegation.
- V1 does not require per-workflow bridge credential setup.
- V1 does not hide successful bridge work as trace-only background runs.
- V1 does not ask every n8n workflow to implement ThinkWork's human-review flow
  itself.
- V1 does not cover ThinkWork agents discovering and running selected n8n
  workflows as tools; that bidirectional tool-factory direction is a follow-up.
- V1 does not replace the generic Space webhook thread-start contract or Thread
  Event Sources. Those remain adjacent ingress patterns, while THNK-54 covers
  n8n using ThinkWork as an agent step inside a deterministic workflow.

---

## Key Decisions

- **Webhook-first, node-later:** The stable start/resume/result contract matters
  more than a custom node in v1.
- **Wait/resume, not polling:** n8n should hibernate using Wait node semantics
  and resume through a callback from ThinkWork.
- **ThinkWork owns human review:** Human-needed states stay inside the normal
  ThinkWork thread/inbox model until resolved.
- **Normal visible threads:** Bridge runs are first-class ThinkWork threads in a
  target Space, not hidden trace-only executions.
- **Tenant machine credential:** V1 uses the managed n8n tenant bridge
  credential with explicit workflow/execution attribution.
- **Structured plus readable result:** n8n gets deterministic JSON; humans get a
  summary and thread/trace links.

---

## Dependencies / Assumptions

- THNK-50 provides the managed n8n plugin foundation and tenant service
  credential direction captured in
  `docs/brainstorms/2026-06-19-n8n-application-plugin-requirements.md`.
- The generic Space webhook and Thread Event Sources contracts remain relevant
  adjacent patterns, documented in
  `docs/brainstorms/2026-06-19-space-webhook-thread-start-requirements.md` and
  `docs/brainstorms/2026-06-16-thread-event-sources-requirements.md`.
- Current n8n documentation describes Wait nodes as pausing execution,
  offloading execution data, and resuming from a webhook-style condition. The
  planner should confirm the exact production constraints for ThinkWork's
  deployed n8n version.
- Existing ThinkWork thread, Space, inbox, trace, and timeout primitives are
  expected to be reusable, but planning must verify the least invasive substrate
  changes.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R14][Technical] Define the exact request and resume payload
  fields, including status names, output shape, error shape, and trace/thread
  link fields.
- [Affects R8, R13][Technical] Define callback authentication, retry behavior,
  and idempotency for calls to the n8n resume URL.
- [Affects R9][Technical] Decide where bridge correlation state is stored and
  how duplicate start attempts are detected.
- [Affects R12][Product/technical] Select the default timeout duration and
  allowed per-call override bounds.
- [Affects R17][Technical] Decide how bridge telemetry appears in thread detail,
  traces, and any n8n plugin evidence surfaces.

---

## Next Steps

-> /ce-plan for structured implementation planning.
