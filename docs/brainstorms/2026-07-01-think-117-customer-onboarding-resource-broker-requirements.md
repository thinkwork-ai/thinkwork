---
date: 2026-07-01
topic: think-117-external-agent-resource-broker-use-cases
linear_issue: THINK-117
origin: docs/ideation/2026-07-01-think-117-delegated-agent-framework-ideation.md
---

# External Agent Resource Broker Use Cases

## Problem Frame

ThinkWork should prove the External Agent Resource Broker thesis through two
concrete customer-facing use cases:

1. Customer onboarding: fragmented onboarding truth across calls, emails,
   waiting on people, Work Items, Company Brain, Epicor P21, and workflow
   status.
2. Dispatch: operational routing decisions that need driver, vehicle, and
   order data from systems such as P21, FleetIO, LastMile, and related internal
   sources, then need a routing solution and governed update back into P21.

The shared thesis is that individual systems may already expose their own MCP
servers or APIs. ThinkWork should not compete by being another raw connector
catalog or by becoming the primary frontier agent harness. ThinkWork's job is to
be the secure broker external agents call when company context, permissions,
memory, cross-system truth, rendered UI, and governed actions matter.

The MVP should let a user ask an external agent, such as Claude, Codex, Cursor,
Kody-style agents, or ChatGPT:

> What is blocking Acme onboarding?

or:

> Optimize today's dispatch plan for the northwest route.

For onboarding, ThinkWork responds through an MCP-accessible broker with a
rendered Customer Onboarding Command Center. The view leads with one canonical
blocker, shows confidence and evidence, includes source freshness and conflicts,
and offers ThinkWork-only actions.

For dispatch, ThinkWork responds with a rendered Dispatch Optimization Surface.
The surface shows the source driver, vehicle, and order inputs, invokes route
optimization through an approved service such as LastMile MCP, previews the
recommended routing solution, highlights constraint violations or confidence
gaps, and, after explicit approval and policy validation, can update P21 with
the accepted routing solution.

This is not a state-machine product. The MVP may use deterministic workflow
semantics to explain blocker selection, routing constraints, approvals, and
allowed actions, but the product value is cross-system truth compilation,
domain-specific work surfaces, policy-governed actions, memory, and audit for
external agents.

---

## Actors

- A1. Customer onboarding coordinator: Owns the onboarding process, needs one
  trusted blocker view, and takes the next internal action.
- A2. Dispatcher or operations coordinator: Owns route planning, needs a
  trusted route recommendation, and can approve governed dispatch updates.
- A3. External agent user: Asks through an external agent harness and expects a
  useful answer plus a rendered view, not raw system data.
- A4. External agent harness: Calls ThinkWork through MCP and renders the
  returned text, structured result, and compatible UI.
- A5. ThinkWork Resource Broker: Authenticates the caller, gathers permitted
  source data, compiles use-case-specific truth, renders the work surface,
  validates actions, and records evidence.
- A6. Company Brain: Provides shared customer and operational context, prior
  decisions, commitments, memories, and source evidence.
- A7. Source systems: ThinkWork Work Items, Epicor P21, n8n workflow status,
  FleetIO, LastMile MCP, and other approved internal systems.
- A8. Operator/admin: Configures source eligibility, policies, user/tenant
  credentials, writeback permissions, and audit review.

---

## Key Flows

- F1. External agent asks for onboarding status
  - **Trigger:** A3 asks an external agent what is blocking a customer
    onboarding.
  - **Actors:** A3, A4, A5, A6, A7.
  - **Steps:** The external agent calls ThinkWork. ThinkWork resolves the
    caller, tenant, Space, customer, and policy context. ThinkWork gathers
    permitted data from Work Items, Company Brain, P21, and n8n. ThinkWork
    compiles one canonical blocker plus supporting evidence and returns both a
    concise model-readable answer and a rendered command center.
  - **Outcome:** A3 receives a clear answer and can inspect the evidence board
    without manually visiting every system.
  - **Covered by:** R1, R2, R3, R4, R7, R8, R11.

- F2. Coordinator inspects onboarding evidence and conflicts
  - **Trigger:** A1 opens the rendered onboarding command center.
  - **Actors:** A1, A5, A6, A7.
  - **Steps:** The command center shows the current blocker, confidence, source
    freshness, and evidence grouped by source. If sources disagree, ThinkWork
    marks the blocker as lower confidence and explains the conflict instead of
    pretending certainty.
  - **Outcome:** A1 can verify why ThinkWork selected the blocker and decide
    what to do next.
  - **Covered by:** R5, R6, R8, R9, R10, R12.

- F3. Coordinator takes a ThinkWork-only onboarding action
  - **Trigger:** A1 chooses an allowed action from the command center.
  - **Actors:** A1, A5, A8.
  - **Steps:** ThinkWork validates the action against the command center state,
    user permissions, Space policy, and action constraints. The action may
    create a follow-up Work Item, request missing information, update a
    ThinkWork-owned checklist item, or open a source record link. ThinkWork does
    not write back to P21 or other external systems for the onboarding MVP.
  - **Outcome:** A1 advances coordination inside ThinkWork while external
    onboarding source systems remain read-only.
  - **Covered by:** R13, R14, R15, R17.

- F4. Source data changes after a prior onboarding view
  - **Trigger:** P21, n8n, Work Items, or Company Brain state changes after a
    prior onboarding command center was viewed.
  - **Actors:** A1, A3, A5, A6, A7.
  - **Steps:** A later query or refresh causes ThinkWork to recompute the
    blocker from current source data. The command center highlights relevant
    changes since the previous known view when that history is available.
  - **Outcome:** The coordinator sees a fresh compiled truth view instead of a
    stale snapshot masquerading as current status.
  - **Covered by:** R6, R9, R18, R19.

- F5. External agent asks for a dispatch plan
  - **Trigger:** A2 or A3 asks an external agent to optimize dispatch for a
    day, branch, route, customer set, or order set.
  - **Actors:** A2, A3, A4, A5, A7.
  - **Steps:** The external agent calls ThinkWork. ThinkWork resolves the
    caller, tenant, Space, dispatch scope, and policy context. ThinkWork gathers
    permitted driver, vehicle, and order information from sources such as P21,
    FleetIO, LastMile, and internal records. ThinkWork normalizes the inputs
    into a dispatch optimization request.
  - **Outcome:** ThinkWork has a governed, auditable input set for route
    optimization.
  - **Covered by:** R1, R2, R5, R6, R8, R9, R20.

- F6. ThinkWork returns a dispatch optimization surface
  - **Trigger:** ThinkWork has enough dispatch inputs to request optimization.
  - **Actors:** A2, A4, A5, A7.
  - **Steps:** ThinkWork calls an approved optimization service such as
    LastMile MCP, receives the proposed routing solution, and renders a
    dispatch surface showing routes, drivers, vehicles, orders, constraints,
    exceptions, source freshness, and proposed P21 updates.
  - **Outcome:** A2 can inspect the route recommendation and understand why it
    was produced.
  - **Covered by:** R10, R11, R12, R13, R14.

- F7. Dispatcher approves governed P21 update
  - **Trigger:** A2 accepts the routing solution or an edited version of it.
  - **Actors:** A2, A5, A7, A8.
  - **Steps:** ThinkWork validates the proposed update against current source
    state, policy, user permissions, required approvals, and stale-data checks.
    If valid, ThinkWork updates P21 with the accepted routing solution and
    records the full approval and writeback evidence.
  - **Outcome:** P21 receives the routing update through a governed ThinkWork
    action instead of an untracked agent-side write.
  - **Covered by:** R16, R17, R18, R20, R21.

---

## Requirements

**Product identity**

- R1. ThinkWork must present this MVP as an External Agent Resource Broker: a
  cross-system truth, optimization, and workflow surface for external agents,
  not as a raw MCP connector catalog.
- R2. The first two user-facing questions are "what is blocking this customer
  onboarding?" and "what is the best dispatch plan for this route/order set?"
- R3. The MVP must make clear that individual source-system MCP servers can
  already exist; ThinkWork's value is compiling, explaining, governing,
  rendering, and safely acting across systems.
- R4. The MVP must optimize first for customer onboarding coordinators and
  dispatchers while remaining readable to adjacent roles such as sales, account
  owners, finance, and operations leaders.

**Source set and truth compilation**

- R5. The onboarding source set is ThinkWork Work Items, Company Brain, Epicor
  P21, and n8n workflow status.
- R6. The dispatch source set must support driver, vehicle, and order
  information from approved systems such as P21, FleetIO, LastMile, and related
  internal records.
- R7. ThinkWork must show source freshness and provenance for the data used to
  select an onboarding blocker or dispatch route recommendation.
- R8. ThinkWork must use Company Brain to provide the shared aggregated
  customer and operational picture: customer context, prior decisions,
  commitments, memories, route preferences, constraints, and source-backed
  notes relevant to the task.
- R9. ThinkWork must compile source data into use-case-specific read models:
  an onboarding blocker model and a dispatch optimization input/output model.
- R10. When sources conflict, are stale, or lack required fields, ThinkWork must
  lower confidence, surface the issue, and avoid presenting the answer or route
  plan as certain.
- R11. The evidence/input board must show enough source detail for a coordinator
  or dispatcher to challenge, correct, or approve the recommendation.

**Rendered work surfaces**

- R12. The response to an external agent must include both model-readable
  context and a renderable work surface, not only plain text.
- R13. The onboarding command center must show the canonical blocker,
  confidence, source evidence, source freshness, conflicts, next internal
  actions, and links or references back to source records when policy allows.
- R14. The dispatch optimization surface must show route recommendations,
  drivers, vehicles, orders, constraints, exceptions, source freshness, and a
  preview of proposed P21 updates.
- R15. The render target should support MCP App hosts and ThinkWork-owned UI
  envelopes. OpenUI-compatible output may be an adapter target, but OpenUI is
  not the product contract.
- R16. The work surfaces must degrade gracefully for hosts that cannot render
  the full UI by providing a concise answer and fallback summary.

**Actions and writeback**

- R17. The onboarding MVP may include ThinkWork-only actions: create follow-up
  Work Items, request missing information, update ThinkWork-owned checklist
  status, add an internal note, or open a permitted source record link.
- R18. The onboarding MVP must not write back to P21, n8n-managed systems,
  DocuSign, D&B, credit systems, tax systems, or other external systems.
- R19. The dispatch MVP may update P21 with an accepted routing solution only
  after user approval, policy validation, stale-data checks, and writeback audit
  capture.
- R20. Dispatch writeback must be scoped to routing/dispatch fields approved
  for the MVP. It must not become broad P21 mutation access.
- R21. Any action from a work surface must be validated server-side against the
  source view, current user, Space policy, action constraints, and required
  approvals before it is accepted.

**Memory, audit, and stickiness**

- R22. ThinkWork should retain useful onboarding observations, dispatch
  decisions, route exceptions, approvals, and operational preferences in Company
  Brain or memory when retention policy allows.
- R23. ThinkWork must record audit evidence for broker calls: caller context,
  source systems consulted, data classes displayed, recommendation or blocker
  decision, confidence/conflict state, optimization request/response references,
  approval state, and accepted actions or writebacks.
- R24. The MVP should make the sticky layer visible: normalization maps, render
  templates, source policies, Company Brain context, Work Item history, route
  constraints, approvals, writeback rules, and audit evidence accumulate in
  ThinkWork rather than in the external agent harness.

**Non-state-machine workflow stance**

- R25. The MVP must not require ThinkWork to become a full deterministic
  workflow state-machine product.
- R26. Workflow semantics are allowed only where they explain blocker
  selection, dispatch constraints, source status, owner, approval, next action,
  or source evidence.
- R27. n8n and LastMile can remain lower-level workflow/orchestration or
  optimization layers; ThinkWork owns the cross-system business read model,
  policy, memory, rendered work surface, and governed action boundary.

---

## Acceptance Examples

- AE1. **Covers R1, R2, R5, R9, R12.** Given a coordinator asks Claude
  "what is blocking Acme onboarding?", when Claude calls ThinkWork, then
  ThinkWork returns a concise answer naming the current blocker and a rendered
  command center assembled from Work Items, Company Brain, P21, and n8n status.
- AE2. **Covers R7, R10, R11, R13.** Given Work Items say onboarding is waiting
  on credit approval but P21 shows the account is ready, when ThinkWork renders
  the command center, then the view shows the conflict, lowers confidence, and
  shows both source facts instead of declaring certainty.
- AE3. **Covers R8, R22, R24.** Given Company Brain contains a prior decision
  that this customer requires special tax handling, when ThinkWork compiles the
  onboarding view, then that decision appears as relevant context with
  provenance and can affect the blocker explanation when policy allows.
- AE4. **Covers R17, R18, R21.** Given the command center shows missing
  customer information as the blocker, when the coordinator chooses "request
  missing info", then ThinkWork creates or updates a ThinkWork-owned follow-up
  item and does not write to P21 or an external system.
- AE5. **Covers R2, R6, R9, R14.** Given a dispatcher asks an external agent to
  optimize today's dispatch plan, when the agent calls ThinkWork, then
  ThinkWork gathers approved driver, vehicle, and order inputs, runs route
  optimization through LastMile MCP or an approved equivalent, and renders a
  dispatch surface with recommended routes and exceptions.
- AE6. **Covers R19, R20, R21, R23.** Given the dispatcher approves the proposed
  routing solution, when ThinkWork validates permissions and current source
  state, then ThinkWork updates only the approved P21 routing fields and records
  the approval, update payload, and evidence.
- AE7. **Covers R10, R14, R19.** Given FleetIO vehicle capacity conflicts with
  the P21 order load, when ThinkWork renders the dispatch surface, then it
  highlights the conflict and requires correction or approval before any P21
  update is allowed.
- AE8. **Covers R15, R16.** Given the external host supports MCP Apps, when the
  broker returns either work surface, then the host can render the rich view;
  given the host cannot render it, then the user still receives a useful text
  answer and fallback summary.
- AE9. **Covers R25, R26, R27.** Given a plan proposes building a new generic
  workflow state-machine engine for onboarding or dispatch, when reviewed
  against this requirements doc, then that plan is rejected as outside the MVP
  identity.

---

## Success Criteria

- A customer onboarding coordinator can get one trusted blocker answer and
  inspect the cross-system evidence without manually reconciling calls, emails,
  P21, workflow status, and internal tasks.
- A dispatcher can get a route recommendation from approved cross-system inputs,
  inspect the route optimization surface, and approve a governed P21 routing
  update without handing raw write access to the external agent.
- An external agent can use ThinkWork as the company-resource authority without
  receiving raw, ungoverned access to every source system.
- The work surfaces demonstrate the product distinction: ThinkWork is not the
  connector; ThinkWork is the cross-system truth compiler, optimization broker,
  governed action layer, and rendered workflow surface.
- Planning can proceed without inventing the first use cases, source sets, v1
  actions, render contract stance, writeback boundary, or state-machine
  boundary.

---

## Scope Boundaries

### Deferred for later

- Onboarding writeback to P21, DocuSign, D&B, credit, tax, CRM, or n8n-managed
  systems.
- Dispatch writeback beyond approved P21 routing/dispatch fields.
- Additional sources beyond the minimum onboarding and dispatch source sets.
- Role-specific command centers for sales, operations, finance, customer
  success, fleet management, or warehouse teams beyond making the first
  coordinator/dispatcher views readable to them.
- Agent-asked access workflows for requesting new connector approvals or
  time-boxed grants.
- Durable dashboard scheduling, sharing, and recurring refresh workflows.
- Cross-host certification across every external agent harness.

### Outside this product's identity

- A raw MCP connector marketplace where ThinkWork competes by offering the most
  individual system connectors.
- A generic ERP front end or replacement UI for P21.
- A generic fleet management or transportation management system.
- A new full deterministic workflow state-machine product.
- An OpenUI-only product contract. OpenUI is an adapter option beneath the
  broker, not the broker itself.
- A chatbot-only answer path that never returns a rendered work surface.

---

## Key Decisions

- **First proof points:** Customer onboarding and dispatch, not a generic P21
  viewer.
- **Primary pain:** Fragmented cross-system operational truth, not connector
  absence.
- **Primary actors:** Customer onboarding coordinator and dispatcher.
- **Onboarding source set:** ThinkWork Work Items, Company Brain, Epicor P21,
  and n8n workflow status.
- **Dispatch source set:** Driver, vehicle, and order data from approved
  systems such as P21, FleetIO, LastMile, and related internal records.
- **Truth posture:** Lead onboarding with one canonical blocker and dispatch
  with one recommended routing solution, each with confidence and an evidence or
  input board underneath.
- **Action posture:** Onboarding includes ThinkWork-only actions. Dispatch can
  include governed P21 routing writeback after approval and validation.
- **Workflow posture:** Do not build a state-machine product. Use workflow
  semantics only to support blocker explanation, dispatch constraints,
  approvals, next actions, and source evidence.
- **Render posture:** Return model-readable context plus a renderable work
  surface. MCP Apps are a target; ThinkWork UI envelopes and OpenUI-compatible
  adapters are compatible paths.

---

## Dependencies / Assumptions

- Representative P21 data or a credible P21 fixture is available for onboarding
  and dispatch planning.
- n8n can expose enough workflow status for onboarding dependency/readiness
  signals without requiring ThinkWork to own every integration.
- Dispatch planning can access credible driver, vehicle, and order fixtures
  from P21, FleetIO, LastMile, or equivalent internal records.
- LastMile MCP or an equivalent approved route optimization service can accept
  normalized dispatch inputs and return a route solution suitable for rendering.
- A safe P21 sandbox, fixture, or mock writeback path exists for validating
  dispatch update behavior before any real customer environment is touched.
- Company Brain has or can receive enough customer onboarding and dispatch
  context to make the shared picture useful.
- Existing MCP App and `data-json-render` work gives ThinkWork a viable
  rendered-output foundation, but the exact delivery shape should be validated
  during planning.
- Current manual workaround is assumed to be calls, emails, waiting on people,
  and ad hoc reconciliation across systems.

---

## Outstanding Questions

### Resolve Before Planning

- None.

### Deferred to Planning

- [Affects R5, R9][Needs research] What minimum P21 fields are required to
  prove customer onboarding blocker visibility?
- [Affects R5, R9][Needs research] What n8n workflow-status shape is available
  or easiest to fixture for the first onboarding proof?
- [Affects R6, R9, R14][Needs research] What minimum driver, vehicle, and order
  fields are required for a credible dispatch optimization proof?
- [Affects R6, R14][Needs research] What exact LastMile MCP request and response
  shape should ThinkWork normalize to?
- [Affects R19, R20, R21][Technical] Which P21 routing fields are safe and
  valuable enough for first dispatch writeback?
- [Affects R15, R16][Technical] Which render output should be the first
  implementation target: MCP App resource, ThinkWork `data-json-render`, or a
  dual-path adapter?
- [Affects R23][Technical] Which existing audit event types should be reused
  and which new event names are needed for broker calls, displayed data classes,
  optimization calls, approvals, and P21 writebacks?

---

## Next Steps

-> /ce-plan for structured implementation planning.
