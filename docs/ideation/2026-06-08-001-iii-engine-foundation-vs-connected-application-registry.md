---
title: "iii Engine foundation vs connected application registry"
date: 2026-06-08
status: active
topic: iii-engine-connected-applications
source_prompt: "Revisit whether ThinkWork should adopt iii Engine as the foundation for connected applications, or use it as inspiration for a purpose-built registry."
---

# iii Engine Foundation vs Connected Application Registry

## Framing

The reopened question is sharper than the earlier worker-contract discussion:
ThinkWork's managed applications are currently hub-and-spoke. ThinkWork deploys
and manages apps such as Cognee and Twenty, and it can expose their MCP tools to
agents, but the applications do not form a shared capability graph. iii Engine
is impressive because it makes every capability visible and callable through a
live Worker / Function / Trigger registry, so workers can discover and compose
other workers without bespoke integration wiring.

The strongest ThinkWork opportunity is not to make applications talk to each
other directly. The enterprise value is to make application capabilities
legible, authorized, observable, and composable through ThinkWork while keeping
ThinkWork as the policy, identity, audit, deployment, and agent orchestration
boundary.

## Grounding

### ThinkWork Context

- `docs/brainstorms/2026-06-06-aws-native-worker-contract-layer-requirements.md`
  and `docs/plans/2026-06-06-002-feat-worker-contract-tracer-bullet-plan.md`
  intentionally chose a thin static worker contract layer, not a live engine.
- `packages/deployment-runner/src/apps/registry.ts` models managed apps as
  deployment adapters with lifecycle, status, smoke contracts, and Terraform
  variables. It is an operations registry, not a runtime capability registry.
- `packages/api/src/lib/managed-mcp-applications.ts` reconciles Twenty CRM into
  a managed MCP server row when the app is running. This makes app tools
  available to agents through the existing MCP path, but it does not describe
  higher-level app events, entities, or cross-app composition semantics.
- `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
  argues for a clean split: managed apps own infrastructure lifecycle; MCP
  servers own user OAuth and tool availability. That split is still right.

### iii Context

- iii's engine keeps a live registry of connected workers, registered
  functions, registered triggers, and trigger types, then routes invocations to
  the worker that owns the target function.
- Workers connect over WebSocket and can be deployed anywhere reachable by the
  engine. Connected workers expose callable functions and triggers to the whole
  system.
- iii supports discovery functions such as `engine::functions::list`,
  `engine::workers::list`, `engine::triggers::list`, and discovery events such
  as `engine::functions-available` and `engine::workers-available`.
- iii's registry packages workers as installable artifacts with versions,
  config, lockfile pins, supported platforms, functions, trigger types, and
  agent skills.
- iii production deployment is currently Docker/reverse-proxy oriented, with
  iii Cloud described as forthcoming. That matters for ThinkWork's AWS-native
  enterprise posture.

## Recommendation

Build a ThinkWork Connected Application Registry, heavily inspired by iii, and
make iii compatibility an explicit adapter target. Do not adopt iii Engine as
the foundation for ThinkWork's production control plane yet.

This is not the same as the earlier static worker contract plan. The earlier
plan is a useful first layer for internal ThinkWork services. The bigger move is
to extend that into an application capability graph:

- managed app lifecycle
- MCP tool surfaces
- entity and event contracts
- trigger contracts
- OAuth/user-auth requirements
- agent skills/prompts
- health/status/evidence
- audit and idempotency policy
- optional iii-compatible worker metadata

ThinkWork should remain the hub, but it should become a compositional hub rather
than a traffic hub. Applications do not need to know about each other directly;
their capabilities need to be described well enough that ThinkWork agents,
automations, and operators can compose them safely.

## Ranked Ideas

### 1. Connected Application Registry

**Summary:** Promote managed apps from deployment adapters into capability
publishers. Each app contributes an app manifest that describes lifecycle,
tools, functions, triggers, entities, events, OAuth scopes, smoke contracts,
status, and audit policy.

**Warrant:** Direct: ThinkWork already has `managedAppRegistry` for deployment
and a managed MCP reconciliation path for Twenty, but those are separate
surfaces. iii shows the missing abstraction: a live or queryable registry of
functions, triggers, and workers.

**Why it matters:** This lets ThinkWork answer questions like "what can Twenty
do?", "what events can Cognee consume?", "what agent skills become available
when this app is installed?", and "what cross-app automations are possible?"
without hard-coding app-specific hub logic.

**Shape:**

- `application.manifest.ts` or `application.yaml` per managed app.
- Canonical fields: app key, lifecycle adapter, runtime endpoints, MCP servers,
  function contracts, trigger contracts, entity schemas, event schemas, OAuth
  requirements, agent skills, smoke/evidence contracts.
- Registry API: list applications, list capabilities, resolve callable
  functions, resolve trigger bindings, inspect user-specific readiness.
- Runtime remains AWS-native: Aurora for durable registry, EventBridge/AppSync
  for events, AgentCore Pi for execution, MCP for tool calls.

**Meeting test:** This is the direction that most directly resolves the
hub-and-spoke concern without surrendering ThinkWork's enterprise control plane.

### 2. ThinkWork as Capability Graph, Not App Mesh

**Summary:** Keep apps unaware of each other. Make their capabilities first-class
nodes in a graph that ThinkWork agents and automations traverse.

**Warrant:** Reasoned: Enterprise systems usually need a policy and audit
boundary more than they need peer-to-peer app calls. Direct app-to-app
awareness would multiply auth, tenancy, and audit failure modes.

**Why it matters:** This preserves the clean enterprise story: ThinkWork owns
identity, policy, audit, and orchestration. Apps contribute capabilities.
Agents, automations, and operators compose them.

**Shape:**

- Nodes: app, function, trigger, entity, event, skill, credential, tenant,
  Space, agent template.
- Edges: provides, requires, can-trigger, consumes, emits, requires-auth,
  assigned-to-agent, available-in-space.
- Query examples: "show capabilities available to this user", "which app emits
  an event that can update this entity?", "which functions are unsafe without
  human approval?"

**Meeting test:** This gives ThinkWork the "applications can leverage each
other" property without making each application integrate with every other
application.

### 3. iii Compatibility Layer

**Summary:** Design ThinkWork capability contracts so a future adapter can
export selected functions/triggers as iii workers or import selected iii
registry workers into ThinkWork.

**Warrant:** Direct: iii function IDs, JSON Schema metadata, trigger
registrations, discovery functions, and worker manifests map closely to the
worker-contract vocabulary ThinkWork just adopted.

**Why it matters:** This keeps optionality. If iii's ecosystem becomes a useful
source of workers, ThinkWork can consume it. If enterprise customers want
on-prem or local worker packs later, iii compatibility may become a powerful
deployment story.

**Shape:**

- Add optional `iii` metadata to ThinkWork capability declarations.
- Build an offline importer that reads iii worker metadata and generates a
  ThinkWork review artifact.
- Later, build a bridge worker that exposes a bounded ThinkWork capability
  subset to an iii engine or exposes bounded iii functions to ThinkWork.
- Keep bridge boundaries explicit: tenant, auth, audit, timeout, payload
  redaction, and data residency.

**Meeting test:** This gives the team a low-regret path to iii interoperability
without betting the core platform on iii today.

### 4. Managed App Contract Packs

**Summary:** Each managed app ships a contract pack that includes lifecycle,
MCP, capabilities, OAuth, skills, and operational evidence.

**Warrant:** Direct: Twenty proved managed applications need both
infrastructure lifecycle and user OAuth/MCP readiness. Today these are wired
through app-specific code and docs.

**Why it matters:** Contract packs make adding the next app less bespoke. They
also make app capabilities legible to agents: the app is not just "running";
it publishes actions, events, schemas, user auth needs, and safe usage rules.

**Shape:**

- `packages/managed-apps/<app>/contract.ts`
- Contract pack sections:
  - deployment adapter
  - MCP servers and OAuth resources
  - tool/function contracts
  - trigger/event contracts
  - entity hints
  - skills exposed to agents
  - smoke/evidence checks
  - destructive operation policy

**Meeting test:** This is the most incremental implementation route toward the
larger Connected Application Registry.

### 5. Live Capability Availability Events

**Summary:** Add iii-style discovery events to ThinkWork: when an app is
deployed, parked, repaired, authenticated, or destroyed, publish capability
availability changes.

**Warrant:** Direct: iii has discovery events for workers/functions becoming
available. ThinkWork already has app lifecycle state, MCP row state, user OAuth
state, and AppSync/activity patterns.

**Why it matters:** Availability is not binary. Twenty can be deployed but
parked; MCP can be registered but missing user OAuth; a capability can be
available to one user but not another. Agents need this as live context.

**Shape:**

- Events such as `capability.available`, `capability.unavailable`,
  `credential.required`, `application.parked`, `application.destroyed`.
- Durable event records for audit and replay.
- AppSync or event stream for operator UI.
- Agent runtime fetches current availability before presenting or invoking
  tools.

**Meeting test:** This is where ThinkWork gets the "living system" feel of iii
without importing iii's engine.

### 6. Connected Application Observability

**Summary:** Build an operator and agent-readable observability layer around the
capability graph: every app capability invocation, MCP tool call, trigger,
agent action, workflow step, and managed-app lifecycle event should be traceable
as part of one cross-application execution graph.

**Warrant:** External: iii's Linkly observability tutorial shows the value of
end-to-end traces, logs, worker/function visibility, trace trees, and slow-call
queries as a system-level property. Direct: ThinkWork already has pieces of
this in `agentcore-phase-log`, `thread_turn_events`, managed-app evidence,
CloudWatch/X-Ray, AppSync activity, and audit events, but not a unified
application-capability waterfall.

**Why it matters:** This is the feature that makes the registry feel alive. An
operator should be able to click a ThinkWork turn or automation and see:
`agent::run -> twenty::opportunity.search -> cognee::memory.enrich ->
workspace::reconcile -> audit::record`, with timings, user/auth context,
redacted payload summaries, errors, retries, and evidence links.

**Shape:**

- A canonical `capability_invocations` or trace projection table keyed by
  trace ID, tenant ID, app key, function ID, trigger ID, status, duration, and
  redacted metadata.
- Traceparent propagation across GraphQL, Lambdas, AgentCore Pi, MCP calls,
  managed-app deployment jobs, EventBridge/SQS/AppSync, and audit writes.
- A "Capability Flow" UI in Spaces/admin showing live and historical waterfalls
  for turns, automations, and managed-app operations.
- Queryable views: slowest capabilities, failing functions, unavailable
  credentials, noisy apps, retry hotspots, and user-auth blockers.
- Agent-readable introspection tools: list functions, list triggers, list
  recent failures, explain why a capability is unavailable, and fetch a trace
  tree for a prior turn.

**Meeting test:** This is the strongest product reason to borrow from iii more
deeply. A registry without observability is just metadata; a registry with
traceable execution becomes an operating system for connected work.

### 7. iii Evaluation Sandbox

**Summary:** Run iii Engine as a lab substrate in a non-production ThinkWork
deployment to evaluate agentmemory, worker registry ergonomics, and live
discovery.

**Warrant:** Reasoned: iii is compelling enough that a paper-only evaluation is
not sufficient, but making it production foundation before an enterprise threat
model would be premature.

**Why it matters:** This creates real evidence. The team can measure startup,
observability, worker installation, bridge complexity, auth gaps, and agent
ergonomics.

**Shape:**

- Deploy iii in a dev-only ECS service or local sandbox.
- Register one ThinkWork bridge worker and one external worker such as memory.
- Test function discovery, invocation, trigger binding, traces, and failure
  behavior.
- Produce an adoption-readiness report, not production code.

**Meeting test:** This prevents both over-romanticizing iii and dismissing it
too early.

### 8. Edge iii, Core AWS

**Summary:** Consider iii as an optional edge/runtime pack for local, on-prem,
or customer-controlled extension environments, while ThinkWork's SaaS/control
plane remains AWS-native.

**Warrant:** Reasoned: iii's "workers can run anywhere reachable" model is
especially strong for mixed-runtime environments. ThinkWork's enterprise core
needs AWS-native identity, deployment evidence, compliance, and AgentCore.

**Why it matters:** This splits the problem cleanly. ThinkWork does not need
iii inside its core to benefit from iii as an interoperability substrate near
customer systems.

**Shape:**

- AWS ThinkWork core owns tenant, user, agent, audit, deployment.
- Customer-side iii edge runs optional local workers and exposes a bounded
  bridge to ThinkWork.
- ThinkWork treats the edge as one managed application or one capability
  provider with explicit contracts.

**Meeting test:** This may become the best on-prem story later, especially for
customers with local data and local models.

## Rejected or Lower-Ranked Ideas

### Adopt iii Engine as ThinkWork's production foundation now

Rejected for now. iii's model is excellent, but ThinkWork's current identity is
AWS-native enterprise agent infrastructure: Cognito, AgentCore, Bedrock, Aurora,
S3, EventBridge, AppSync, Terraform, and managed customer deployments. Making
iii the core control plane would introduce a second runtime, network protocol,
lifecycle manager, worker package manager, and observability surface before the
team has proven multi-tenant security, data residency, AWS integration, and
enterprise support semantics.

### Build an AWS-native clone of iii

Rejected. This is the "iii but worse and AWS-only" failure mode. The right move
is a purpose-built registry and capability graph for ThinkWork's product
surface, not a generic engine with custom queue, cron, stream, state, and worker
supervision.

### Keep current hub-and-spoke only

Rejected as insufficient. It is safe and understandable, but it leaves managed
apps as opaque deployments plus MCP tools. It does not give agents or operators
enough semantic understanding to compose application capabilities.

### Let applications call each other directly

Rejected. Direct app-to-app calls weaken ThinkWork's value as the policy and
audit center. They also create hard questions around user identity, tenant
boundaries, approval, data lineage, and revoke/park/destroy behavior.

### Treat MCP tool lists as the registry

Rejected as too narrow. MCP describes callable tools, but ThinkWork also needs
deployment state, user OAuth readiness, entity/event contracts, trigger
bindings, audit semantics, smoke evidence, and agent skills.

## Decision Frame

| Option                                   | Upside                                                                 | Risk                                                                         | Best Use                                     |
| ---------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| Adopt iii as foundation                  | Fast access to live registry, worker ecosystem, console, composability | Platform dependency, AWS enterprise mismatch, maturity and security unknowns | Lab or edge runtime, not production core yet |
| Build ThinkWork registry inspired by iii | Fits AWS/AgentCore/security model, directly supports managed apps      | Must avoid cloning generic engine                                            | Recommended core path                        |
| Stay hub-and-spoke                       | Lowest complexity                                                      | Apps stay semantically opaque                                                | Short-term operational baseline only         |
| Direct app mesh                          | Rich peer-to-peer composition                                          | Auth/audit/tenancy sprawl                                                    | Avoid                                        |

## Strongest Next Brainstorm

Use `ce-brainstorm` on:

> ThinkWork Connected Application Registry: a purpose-built capability graph for
> managed applications, MCP tools, worker contracts, triggers, skills, user auth,
> and operational evidence, with optional iii compatibility metadata.

The brainstorm should answer:

- What is the app capability manifest shape?
- Which v1 app proves the model: Twenty, Cognee, or both?
- How does the registry model user-specific readiness, not just tenant-level
  installation?
- What event/trigger contracts are needed before this becomes useful?
- What does connected observability look like: trace model, waterfall UI,
  capability logs, slow-call queries, and agent-readable debugging tools?
- What does iii compatibility mean concretely: import metadata, export worker,
  bridge runtime, or just aligned naming?
- What does ThinkWork explicitly refuse to own: worker process supervision,
  custom queues, custom cron, generic marketplace?

## Sources

- iii Engine protocol: `https://iii.dev/docs/sdk-reference/engine-sdk`
- iii Creating Workers overview: `https://iii.dev/docs/creating-workers`
- iii Workers docs: `https://iii.dev/docs/creating-workers/workers`
- iii Functions docs: `https://iii.dev/docs/creating-workers/functions`
- iii Triggers docs: `https://iii.dev/docs/creating-workers/triggers`
- iii Worker Registry docs: `https://iii.dev/docs/using-iii/workers-registry`
- iii Linkly observability tutorial:
  `https://iii.dev/docs/tutorials/linkly/observability`
- iii Deployment docs: `https://iii.dev/docs/using-iii/deployment`
- ThinkWork worker contract requirements:
  `docs/brainstorms/2026-06-06-aws-native-worker-contract-layer-requirements.md`
- ThinkWork worker contract plan:
  `docs/plans/2026-06-06-002-feat-worker-contract-tracer-bullet-plan.md`
- Managed app registry:
  `packages/deployment-runner/src/apps/registry.ts`
- Managed MCP application lifecycle:
  `packages/api/src/lib/managed-mcp-applications.ts`
- Managed app MCP/OAuth architecture pattern:
  `docs/solutions/architecture-patterns/managed-app-mcp-oauth-lifecycle-2026-06-06.md`
