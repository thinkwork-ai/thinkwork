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
   order data from the approved dispatch source map, then need a delegated
   optimization result and governed update back into P21.

The shared thesis is that individual systems may already expose their own MCP
servers or APIs. ThinkWork should not compete by being another raw connector
catalog or by becoming the primary frontier agent harness. ThinkWork's job is to
be the secure broker external agents call when company context, permissions,
memory, cross-system truth, rendered UI, and governed actions matter.

The MVP should let a user ask an external agent, such as Claude, Codex, Cursor,
Kody-style agents, or ChatGPT:

> What is blocking Acme onboarding?

or:

> Show the governed dispatch recommendation for today's northwest route.

For onboarding, ThinkWork responds through an MCP-accessible broker with a
rendered Customer Onboarding Command Center. The view leads with the most
critical blocker, shows confidence and evidence, includes source freshness and
conflicts, and offers ThinkWork-only actions.

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

## Connector Pitfall Alignment

The Forte Labs Claude Connectors guide reinforces the broker direction by
highlighting what goes wrong when users directly attach many connectors to an
agent:

- A connector can look complete while only exposing snippets, recent records, or
  narrow search paths.
- The agent usually samples from accessible data instead of reading everything,
  which can create false authority.
- The agent does not know which canonical sources are missing unless a human or
  system tells it.
- Multiple connectors can produce impressive dashboards that do not solve a
  real bottleneck.
- Private data, untrusted content, and external communication or write tools can
  combine into a high-risk security posture.

ThinkWork should turn those pitfalls into product requirements. The broker
should expose a task-scoped source bundle, not an attach-everything connector
menu. Every rendered work surface should show what sources were consulted, what
was unavailable, what was sampled or incomplete, and which actions require
approval. Write/delete/interactive tools should default to explicit approval and
policy validation. Untrusted external content should be treated as data, never
as instructions to the agent or broker.

Brad Groux's Codex permissions article adds the same idea at the operating-mode
level: the team should name the work mode before the agent starts and give that
mode only the access the task needs. Codex permission profiles are a useful
analogy, but they only govern local sandboxed command execution. ThinkWork must
apply the same least-privilege-per-task concept across the company-resource
surface: connectors, MCP tools, browser sessions, cloud actions, production
credentials, external communication, and system writebacks.

## Two-Surface Product Model

Tanay Jaipuria's "Build the Agent or Power the Agent?" framing clarifies the
product shape: ThinkWork should do both, but for different audiences.

- **ThinkWork-owned Agent UI:** For core and power users who live in ThinkWork
  for operational work. This surface owns full context, native workflows,
  source configuration, source maps, approvals, correction flows, privileged
  actions, and audit review.
- **MCP / API / CLI headless broker:** For everyone else who lives in a
  horizontal agent such as Claude, Codex, ChatGPT, Cursor, Copilot, or Kody.
  This surface lets those agents call ThinkWork for company data, context,
  recommendations, and governed actions without forcing every user to live in
  ThinkWork.

The surfaces are complementary. External agents should be able to initiate and
consume the broker result. ThinkWork-owned UI should remain authoritative when
the task requires privileged configuration, approval, correction, audit review,
or system writeback. In other words: ThinkWork powers the external agent for
edge users, while ThinkWork's own agent UI serves the core users who need native
workflow control.

---

## Actors

- A1. Customer onboarding coordinator: Core/power user who owns the onboarding
  process, needs one trusted blocker view, and takes the next internal action in
  ThinkWork or an approved external-agent surface.
- A2. Dispatcher or operations coordinator: Core/power user who owns route
  planning, needs a trusted route recommendation, and can approve governed
  dispatch updates through a ThinkWork-controlled approval surface.
- A3. External agent user: Edge or adjacent user who asks through a horizontal
  agent harness and expects a useful answer plus a rendered view, not raw system
  data.
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
    compiles a ranked blocker set led by the most critical blocker plus
    supporting evidence and returns both a concise model-readable answer and a
    rendered command center.
  - **Outcome:** A3 receives a clear answer and can inspect the evidence board
    without manually visiting every system.
  - **Covered by:** R1, R2, R3, R4, R5, R7, R8, R9, R12, R13, R28, R35, R40.

- F2. Coordinator inspects onboarding evidence and conflicts
  - **Trigger:** A1 opens the rendered onboarding command center.
  - **Actors:** A1, A5, A6, A7.
  - **Steps:** The command center shows the current blocker, confidence, source
    freshness, and evidence grouped by source. If sources disagree, ThinkWork
    marks the blocker as lower confidence and explains the conflict instead of
    pretending certainty.
  - **Outcome:** A1 can verify why ThinkWork selected the blocker and decide
    what to do next.
  - **Covered by:** R5, R7, R8, R10, R11, R13, R29, R30, R39, R41.

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
  - **Covered by:** R17, R18, R21, R32, R35, R36, R37, R41.

- F4. Source data changes after a prior onboarding view
  - **Trigger:** P21, n8n, Work Items, or Company Brain state changes after a
    prior onboarding command center was viewed.
  - **Actors:** A1, A3, A5, A6, A7.
  - **Steps:** A later query or refresh causes ThinkWork to recompute the
    blocker from current source data. The command center highlights relevant
    changes since the previous known view when that history is available.
  - **Outcome:** The coordinator sees a fresh compiled truth view instead of a
    stale snapshot masquerading as current status.
  - **Covered by:** R7, R10, R22, R29, R30, R31, R39.

- F5. External agent asks for a governed dispatch recommendation
  - **Trigger:** A2 or A3 asks an external agent to optimize dispatch for a
    day, branch, route, customer set, or order set.
  - **Actors:** A2, A3, A4, A5, A7.
  - **Steps:** The external agent calls ThinkWork. ThinkWork resolves the
    caller, tenant, Space, dispatch scope, and policy context. ThinkWork gathers
    permitted driver, vehicle, and order information from sources such as P21,
    FleetIO, LastMile, and internal records. ThinkWork normalizes the inputs
    into a dispatch optimization request.
  - **Outcome:** ThinkWork has a governed, auditable input set for delegated
    route optimization.
  - **Covered by:** R1, R2, R3, R4, R6, R7, R8, R9, R12, R28, R35, R36, R40.

- F6. ThinkWork returns a dispatch optimization surface
  - **Trigger:** ThinkWork has enough dispatch inputs to request optimization.
  - **Actors:** A2, A4, A5, A7.
  - **Steps:** ThinkWork calls an approved optimization service such as
    LastMile MCP, receives the proposed routing solution, and renders a
    dispatch surface showing routes, drivers, vehicles, orders, constraints,
    exceptions, source freshness, and proposed P21 updates.
  - **Outcome:** A2 can inspect the route recommendation and understand why it
    was produced.
  - **Covered by:** R10, R11, R12, R14, R15, R16, R27, R47.

- F7. Dispatcher approves governed P21 update
  - **Trigger:** A2 accepts the routing solution or an edited version of it.
  - **Actors:** A2, A5, A7, A8.
  - **Steps:** ThinkWork validates the proposed update against current source
    state, policy, user permissions, required approvals, and stale-data checks.
    If valid, ThinkWork updates P21 with the accepted routing solution and
    records the full approval and writeback evidence.
  - **Outcome:** P21 receives the routing update through a governed ThinkWork
    action instead of an untracked agent-side write. For the MVP this flow is
    proven against the P21 sandbox/fixture writeback path; live customer
    writeback is a post-MVP gate (see Scope Boundaries).
  - **Covered by:** R19, R20, R21, R23, R32, R35, R37, R41, R46.

---

## Requirements

> **Wedge conditionality:** Most requirements below are wedge-agnostic core.
> Onboarding-conditional: R5, R13, R17, R18. Dispatch-conditional (either
> dispatch wedge): R6, R14, R47. Dispatch-writeback-conditional: R19, R20,
> R46, R58.
>
> **Wedge selection (decided 2026-07-01): onboarding blocker compilation
> ships first.** The onboarding-conditional cluster is binding for the MVP.
> The dispatch-conditional and dispatch-writeback-conditional clusters are
> second and third tranche respectively and must not produce implementation
> tickets in the first planning pass.

**Product identity**

- R1. ThinkWork must present this MVP as an External Agent Resource Broker: a
  cross-system truth, optimization, and workflow surface for external agents,
  not as a raw MCP connector catalog.
- R2. The first two user-facing questions are "what is blocking this customer
  onboarding?" and "show the governed dispatch recommendation for this
  route/order set."
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
  information from approved systems such as P21, FleetIO, LastMile, and only
  the internal records explicitly included in the use-case source map.
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
- R13. The onboarding command center must show the ranked blocker set led by
  the most critical blocker — or an explicit no-active-blocker state when
  onboarding is on track — plus confidence, source evidence, source freshness,
  conflicts, next internal actions, and links or references back to source
  records when policy allows. Multiple concurrent genuine blockers must be
  representable without arbitrarily promoting one to false certainty.
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
- R20. When dispatch writeback is in scope, it must be scoped to
  routing/dispatch fields approved for the MVP. It must not become broad P21
  mutation access, and any dispatcher-edited routing solution must re-run the
  same constraint and exception validation as optimizer output before it is
  eligible for approval.
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

**Connector safety, source coverage, and task permissions**

- R28. ThinkWork must not encourage users to attach every available connector
  directly to an external agent. It must expose task-scoped source bundles that
  are selected by use case, Space policy, user permissions, and data class.
- R29. Each work surface must show a source coverage summary: sources
  consulted, sources unavailable, stale sources, sampled or partial data, and
  known blind spots relevant to the answer or action.
- R30. If a canonical source required for a use case is missing, unauthorized,
  stale, or unreachable, ThinkWork must say so before presenting a blocker,
  route plan, or writeback as reliable.
- R31. ThinkWork must record what it searched and what it found before
  synthesis when the result is used to select a blocker, propose a dispatch
  route, or justify a writeback.
- R32. Write/delete/interactive tools must default to "needs approval" unless a
  narrower policy explicitly allows automatic execution for the current Space,
  user, data class, and use case.
- R33. Untrusted content from source systems, emails, documents, web pages, or
  customer-provided text must be treated as data. It must not be allowed to
  override broker policy, tool routing, approval rules, or system instructions.
- R34. ThinkWork should reject broad "connect everything and make a dashboard"
  requests unless they are narrowed to a business bottleneck, canonical source
  map, and reviewable work surface.
- R35. Every broker call must resolve an explicit task access posture before
  source access or action execution begins. The posture should include source
  scope, data classes, read/write capability, network or external-service
  access, approval mode, and denied sensitive paths or secrets where relevant.
- R36. ThinkWork should support named task modes for common broker use:
  read/inspect, compile/render, optimize/recommend, and approved-writeback. The
  names can change during implementation, but each mode must map to concrete
  policy behavior instead of prompt-only instructions.
- R37. ThinkWork must choose the narrowest task mode that can satisfy the
  request. Escalating to broader connector, network, browser, cloud, production,
  or writeback access must require a clear reason, policy allowance, and audit
  record.
- R38. ThinkWork must not treat Codex, Claude, or any host-level permission
  profile as sufficient protection for company resources. Host permissions are
  one layer; ThinkWork still owns controls for MCP tools, connectors, browser
  surfaces, cloud actions, production credentials, external communication, and
  writebacks.

**Two-surface product model and trust boundaries**

- R39. Each broker use case must have an operator-owned source map that defines
  canonical sources, optional sources, required fields, freshness thresholds,
  permitted sampling, blind-spot labels, and the owner or policy that can change
  those entries.
- R40. ThinkWork must expose two complementary product surfaces: a ThinkWork-owned
  Agent UI for core/power users and a headless MCP/API/CLI broker for edge users
  working inside horizontal agents.
- R41. The ThinkWork-owned Agent UI must be authoritative for privileged source
  configuration, source-map management, approvals, correction flows, audit
  review, and system writebacks.
- R42. The MCP/API/CLI broker must be the primary "power the agent" surface for
  external users. It should return model-readable context, renderable work
  surfaces when the host supports them, and fallback summaries when it does not.
- R43. Each use case must define a persona-channel map: who initiates from an
  external agent, who operates or approves inside ThinkWork, which surface is
  primary, what actions are allowed in-place, what deep-links or round trips to
  ThinkWork are required, and what result returns to the external agent.
- R44. Every external MCP/API caller must be a registered tenant-approved
  client. Broker calls must carry audience-bound, scoped authorization tied to
  the human user, tenant, Space, client, task mode, expiry, and revocation state.
  Missing or expired consent must return a structured denial.
- R45. Rendered MCP App resources, ThinkWork UI envelopes, and fallback
  summaries must enforce fetch-time authorization, tenant/Space/user binding,
  short-lived resource handles, no embedded credentials, data-class redaction,
  no-policy caching, sanitized source content, and action callbacks that return
  through ThinkWork server-side validation.
- R46. External agents may propose writebacks but cannot attest approval.
  Dispatch writeback must require a ThinkWork-captured or session-bound
  approval artifact from an authorized dispatcher, bound to the source view
  version, exact diff or payload, target P21 fields, actor, timestamp, expiry,
  idempotency key, and audit record.
- R47. Approved optimization services such as LastMile MCP must receive only the
  minimum necessary fields for the task and no secrets. Optimizer outputs must
  be treated as untrusted recommendations until validated against source state
  and constraints; unavailable or inconsistent service responses must fail
  closed and be audited.
- R48. User, tenant, and source-system credentials must stay in the approved
  secrets store, encrypted in transit and at rest, scoped by tenant, user,
  source, and task mode, separated by environment, rotatable and revocable,
  audited on use, and never exposed to external hosts, render payloads,
  model-readable context, memory, or application logs.
- R49. Broker memory and audit retention must classify retained fields,
  minimize raw payloads, redact secrets and unnecessary PII, define retention,
  deletion, and legal-hold behavior, enforce tenant and Space isolation, and
  prefer references or hashes when full source payloads are not required.

**Compilation integrity, render targets, and approval provenance**

- R50. The MVP must name at least one concrete external demonstration host and
  render path plus the ThinkWork-owned UI envelope as the render targets
  thesis validation is measured against. Decided 2026-07-01: the demonstration
  target is Claude web + Desktop via MCP Apps custom connectors, with ChatGPT
  as the standards-compliant fast-follow. Fallback-summary delivery does not
  count as proving the rendered-surface differentiation.
- R51. Governed writeback approval must not be finalizable purely through an
  action callback from an unattested external host: at the transport layer an
  LLM-initiated tool call is indistinguishable from a human click. Approval
  capture requires a ThinkWork-authenticated surface (MCP App resource or
  ThinkWork-owned UI) or a fresh step-up re-authentication that ThinkWork
  verifies independently of the calling host. Text-only fallback hosts are
  read-only for approval actions and must route the approver to a qualifying
  surface.
- R52. Model-readable context and text answers returned to external hosts are
  subject to the same data-class redaction and minimum-necessary-data
  discipline as rendered resources (R45), because they enter a host context
  ThinkWork does not control that may hold independent exfiltration-capable
  tools.
- R53. Blocker and recommendation compilation must be validated against
  known-ground-truth cases from the target customer before answers are
  presented as canonical, and coordinator/dispatcher corrections must be
  captured and measurable, with correction rate as the working accuracy
  signal.
- R54. Each compiled use case must have an operator-owned, declarative process
  definition (steps, dependencies, owners, completion signals) alongside the
  source map (R39) that blocker compilation reasons over. The definition is
  data the compiler reads, not an executable workflow engine, preserving R25
  by construction.
- R55. Task access postures (R35, R36) must be enforced structurally:
  compile/render modes must be incapable of invoking write or
  external-communication tools at the code level, not merely denied by policy
  lookup, because the broker internally combines untrusted source content,
  credentials, and action capability.
- R56. The broker must expose a compact, stable tool surface (on the order of
  search-resources, query-context, render-resource-view, request-action,
  remember-outcome, plus policy explanation and structured denials) with
  progressive discovery for larger schemas, rather than one tool per source
  system or capability (per the origin ideation doc's Resource Broker MVP).
- R57. Company Brain retrieval is subject to the same task-scoped,
  data-class-governed filtering as external source pulls (R28, R35):
  aggregated memories are filtered by the calling user's permissions and data
  class before inclusion in any compiled view.
- R58. P21 writeback approval must use a distinct, higher-friction,
  diff-reviewed confirmation interaction, not the same approval treatment used
  for ThinkWork-only actions such as creating a Work Item or adding a note.

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
- AE10. **Covers R28, R29, R30, R31.** Given the onboarding command center is
  missing the canonical P21 account source, when ThinkWork answers what is
  blocking onboarding, then the answer shows the missing source and does not
  present the blocker as fully reliable.
- AE11. **Covers R32, R33.** Given a dispatch order note contains text that
  attempts to instruct the agent to bypass approval, when ThinkWork renders the
  dispatch surface, then the note is shown only as source data and any P21
  routing update still requires policy validation and approval.
- AE12. **Covers R34.** Given a user asks an external agent to connect every
  available business system and create a generic dashboard, when the agent calls
  ThinkWork, then ThinkWork responds with a source audit or asks for a specific
  workflow bottleneck instead of producing an authoritative-looking generic
  dashboard.
- AE13. **Covers R35, R36, R37, R38.** Given a user asks an external agent to
  review onboarding blockers, when the agent calls ThinkWork, then ThinkWork
  uses a compile/render task mode without external writeback access; given the
  user later approves a dispatch routing update, then ThinkWork escalates only
  to the approved-writeback mode required for the P21 routing fields and records
  the reason.
- AE14. **Covers R40, R41, R42, R43.** Given an adjacent sales or operations
  user asks Claude for onboarding or dispatch status, when the agent calls
  ThinkWork, then the user receives a brokered answer in the external host;
  given a coordinator or dispatcher needs privileged approval, correction, or
  source-map work, then the flow uses the ThinkWork-owned Agent UI as the
  authoritative surface and returns the final result to the external agent.
- AE15. **Covers R39, R44, R45.** Given an external host calls ThinkWork for a
  broker result, when the host is not tenant-approved or the scoped user consent
  is expired, then ThinkWork returns a structured denial; given consent is
  valid, then rendered resources are short-lived, source-map-aware, redacted,
  and fetch-authorized.
- AE16. **Covers R46, R47.** Given a dispatch route recommendation comes from
  LastMile MCP or an approved equivalent, when the dispatcher approves it, then
  ThinkWork validates the optimizer output, records the minimum necessary data
  shared with the optimizer, binds the approval artifact to the exact P21 update
  payload, and only then performs scoped writeback.
- AE17. **Covers R48, R49.** Given ThinkWork uses source credentials and retains
  broker evidence, when the broker completes the call, then credentials never
  appear in external-host payloads, render resources, memory, or logs, and
  retained evidence is minimized, redacted, tenant-isolated, and governed by the
  retention policy.

---

## Success Criteria

- A customer onboarding coordinator can get one trusted blocker answer and
  inspect the cross-system evidence without manually reconciling calls, emails,
  P21, workflow status, and internal tasks.
- A dispatcher can get a route recommendation from approved cross-system inputs,
  inspect the route optimization surface, and approve a governed P21 routing
  update without handing raw write access to the external agent. The MVP proof
  of this criterion runs against the P21 sandbox/fixture writeback path; live
  customer P21 writeback is a post-MVP gate.
- An external agent can use ThinkWork as the company-resource authority without
  receiving raw, ungoverned access to every source system.
- Core/power users can use ThinkWork's owned Agent UI for privileged workflows,
  approvals, corrections, source-map management, and audit review, while edge
  users call ThinkWork from the horizontal agents they already use.
- The work surfaces demonstrate the product distinction: ThinkWork is not the
  connector; ThinkWork is the cross-system truth compiler, optimization broker,
  governed action layer, and rendered workflow surface.
- Users can see source coverage and known gaps before trusting an answer,
  recommendation, or writeback.
- Compiled answers meet an agreed accuracy bar on known-ground-truth cases from
  the target customer, and coordinator/dispatcher corrections are captured so
  the correction rate serves as the ongoing accuracy signal.
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
- Full feature parity between ThinkWork-owned Agent UI and every external host.
- Live P21 dispatch writeback until the approval artifact, source-map,
  credential, and sandbox requirements are satisfied.

### Outside this product's identity

- A raw MCP connector marketplace where ThinkWork competes by offering the most
  individual system connectors.
- A user-managed attach-everything connector panel where external agents decide
  source scope and write authority without ThinkWork policy.
- A horizontal general-purpose agent that tries to replace Claude, Codex,
  ChatGPT, Cursor, Copilot, or similar frontier agent experiences.
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
- **First wedge (decided 2026-07-01):** Onboarding blocker compilation ships
  first — read-only, lowest security surface, purest test of cross-system
  truth. Dispatch read-only recommendation is the second tranche; governed P21
  writeback is the third.
- **Discovery customer (decided 2026-07-01):** TEI (LastMile orbit). Runs
  Epicor P21; proves the onboarding wedge now and is the natural dispatch
  second-tranche partner (FleetIO, LastMile MCP).
- **Primary pain:** Fragmented cross-system operational truth, not connector
  absence.
- **Primary actors:** Customer onboarding coordinator and dispatcher.
- **Onboarding source set:** ThinkWork Work Items, Company Brain, Epicor P21,
  and n8n workflow status.
- **Dispatch source set:** Driver, vehicle, and order data from approved
  systems such as P21, FleetIO, LastMile, and source-map-approved internal
  records.
- **Truth posture:** Lead onboarding with a ranked blocker set headed by the
  single most critical blocker — including an explicit no-active-blocker state
  when onboarding is on track — and dispatch with one recommended routing
  solution, each with confidence and an evidence or input board underneath.
- **Surface posture:** ThinkWork has two product surfaces. The owned Agent UI is
  for core/power users, privileged workflows, approvals, corrections, source
  configuration, and audit. The MCP/API/CLI broker is for everyone else calling
  ThinkWork from horizontal agents.
- **Connector posture:** Do not ask users to attach every connector to the
  external agent. ThinkWork exposes task-scoped source bundles, source coverage,
  gaps, and policy-bounded actions.
- **Task-permission posture:** Use least privilege per task. Each broker call
  resolves a named access posture before work starts, and broader source,
  network, browser, cloud, production, or writeback access requires policy and a
  recorded reason.
- **Action posture:** Onboarding includes ThinkWork-only actions. Dispatch can
  include governed P21 routing writeback only after approval provenance,
  source-map, credential, optimizer-boundary, and sandbox requirements are met.
- **Workflow posture:** Do not build a state-machine product. Use workflow
  semantics only to support blocker explanation, dispatch constraints,
  approvals, next actions, and source evidence.
- **Render posture:** Return model-readable context plus a renderable work
  surface. External hosts are the headless audience; ThinkWork-owned UI is the
  authoritative surface for privileged core-user workflows and approvals.

---

## Dependencies / Assumptions

- Representative P21 data or a credible P21 fixture is available for onboarding
  and dispatch planning.
- n8n can expose enough workflow status for onboarding dependency/readiness
  signals without requiring ThinkWork to own every integration.
- Dispatch planning can access credible driver, vehicle, and order fixtures
  from P21, FleetIO, LastMile, or source-map-approved internal records.
- LastMile MCP or an equivalent approved route optimization service can accept
  normalized dispatch inputs and return a route solution suitable for rendering.
- A safe P21 sandbox, fixture, or mock writeback path exists for validating
  dispatch update behavior before any real customer environment is touched.
- Company Brain has or can receive enough customer onboarding and dispatch
  context to make the shared picture useful.
- Existing MCP App work is host-side (ThinkWork rendering external apps inside
  its own web app) and `data-json-render` is consumed by ThinkWork's own
  clients; serving renderable surfaces to external MCP hosts is a net-new
  broker output path whose delivery shape must be designed during planning.
- The existing customer-onboarding substrate (the spaces customer-onboarding
  workflow with its P21 customer id and account-setup blocker fields, the
  work-items customer-onboarding helpers, space checklist items, the
  coordinator agent, and LastMile linked-task mirroring) is the expected
  foundation for the onboarding blocker model and the R17 action set; planning
  must extend it rather than build a parallel onboarding state model.
- Current manual workaround is assumed to be calls, emails, waiting on people,
  and ad hoc reconciliation across systems; this must be validated against a
  target customer, role, or account before implementation tickets are created.

---

## Outstanding Questions

### Resolve Before Planning

- The next planning pass may proceed only as a discovery-first plan. It must not
  produce implementation tickets until the first planning milestone resolves the
  validation gates below.

### Must Resolve Before Implementation Tickets

- **RESOLVED 2026-07-01** [Affects R1, R2, R4, R40, R43][Product] First
  learning wedge: onboarding blocker compilation ships first; dispatch
  read-only recommendation is second tranche; governed writeback is third.
  Recorded in Key Decisions and the wedge-conditionality note.
- **TARGET SELECTED 2026-07-01** [Affects R1, R2, R4, R43][Product] Discovery
  customer: TEI (LastMile orbit) — runs Epicor P21 and covers both the
  onboarding wedge now and the dispatch tranche later. Still to gather in
  discovery: the current workaround, problem frequency/cost, the onboarding
  coordinator role/owner, the source-system inventory, why ThinkWork beats
  direct connectors or the horizontal agent alone, and the R17
  action-boundary validation.
- [Affects R39, R44, R45][Security] What is the first source map and external
  client consent model for the chosen wedge?
- [Affects R40, R41, R42, R43][Design] Which interactions happen inside the
  external host, which require ThinkWork-owned UI, and what result returns to
  the external agent?
- [Affects R46, R47, R48, R49][Security] If dispatch writeback is in the first
  tranche, which sandbox, approval artifact, credential lifecycle, optimizer
  boundary, and retention policy make it safe?
- **RESOLVED 2026-07-01** [Affects R9, R10, R53][Technical] Compilation
  substrate: labeled hybrid, weighted heavily deterministic — pure-code
  gather/normalize, deterministic blocker-selection rules over the R54 process
  definition, and exactly three labeled LLM synthesis slots. Latency budget:
  p50 ≤ 2.5 s / p95 ≤ 8 s / hard cap 15 s, served from pre-warmed P21/n8n
  mirrors, with evidence-board `origin` discriminators (source_fact /
  derived_rule / llm_synthesis). Full design:
  `docs/brainstorms/2026-07-01-think-117-compilation-substrate-design-note.md`.
- **RESOLVED 2026-07-01** [Affects R12, R15, R16, R50][Product] Empirical host
  MCP App render support: Claude web + Desktop (paid plans, custom connectors
  — no directory approval), ChatGPT (implements the ratified standard;
  developer mode privately, directory publicly), VS Code Copilot Chat
  (stable), Cursor 2.6+, and Microsoft 365 Copilot all render MCP Apps today.
  Text-fallback surfaces are the coding CLIs (Claude Code, Codex), Claude
  mobile (flaky viewer), and Claude Free tier — not the majority desktop/web
  experience. R50's named demonstration target is Claude web + Desktop, with
  ChatGPT as the fast-follow. The real adoption friction is enterprise admin
  enablement (ChatGPT Enterprise apps off by default; M365 admin app upload) —
  planning should include a per-host admin-enablement runbook.
- [Affects R40, R41, R42][Product] How does the ThinkWork-owned Agent UI relate
  to the existing product (Pi agent, threads, Spaces, live tenants): are the
  command centers new surfaces inside the current app, is the internal agent
  the broker's first client so internal and external callers share one policy
  enforcement path, and what does the broker repositioning mean for existing
  tenant deployments?
- [Affects R17, R18][Product] For the target customer, do the ThinkWork-only
  actions in R17 meaningfully advance the majority of recurring onboarding
  blockers, or does the trusted answer alone save quantified reconciliation
  time? If neither holds, the onboarding action boundary must be revisited
  before implementation tickets.

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
- [Affects R28, R29, R30, R31][Technical] What is the minimum source coverage
  schema needed to represent consulted sources, missing canonical sources,
  stale sources, sampled data, and blind spots?
- [Affects R32, R33][Security] Which data classes and tool types are considered
  private data, untrusted content, and external communication or write channels
  for the first two use cases?
- [Affects R35, R36, R37, R38][Security] What are the first named ThinkWork task
  modes, and how do they map to source bundles, data classes, approval policy,
  network/browser/cloud access, and writeback rights?
- [Affects R15, R16][Technical] Which render output should be the first
  implementation target: MCP App resource, ThinkWork `data-json-render`, or a
  dual-path adapter?
- [Affects R23][Technical] Which existing audit event types should be reused
  and which new event names are needed for broker calls, displayed data classes,
  optimization calls, approvals, and P21 writebacks?

---

## Next Steps

-> /ce-plan for structured implementation planning.
