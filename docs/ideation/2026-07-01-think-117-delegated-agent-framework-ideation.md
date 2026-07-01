---
date: 2026-07-01
topic: think-117-delegated-agent-framework
focus: Linear THINK-117 and ThinkWork as a secure delegated framework for external agent harnesses
mode: repo-grounded
linear: THINK-117
external:
  - https://executor.sh/
  - https://github.com/kentcdodds/kody
  - https://github.com/kentcdodds/kody/blob/main/docs/contributing/project-intent.md
  - https://github.com/kunchenguid/firstmate
  - https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview
  - https://agentgateway.dev/
  - https://blog.cloudflare.com/code-mode-mcp/
  - https://modelcontextprotocol.io/extensions/apps/overview
  - https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
  - https://github.com/agentic-community/mcp-gateway-registry
  - https://github.com/thesysdev/openui
---

# Ideation: THINK-117 Delegated Agent Framework

## Grounding Context

### Codebase Context

`THINK-117` frames the strategic question clearly: ThinkWork should not try to
be the primary assistant when Claude, Codex, Kody-style agents, and other
frontier harnesses will keep improving. ThinkWork can instead become the secure
company-resource layer those harnesses call when they need enterprise context,
memory, governed access, delegated work, or audit.

The current repo already has several primitives that make this plausible:

- `docs/src/content/docs/api/context-engine.mdx` documents Context Engine as a
  read-only orchestration layer for workspace files, wiki pages, Brain,
  Hindsight memory, approved MCP tools, source agents, and diagnostics.
- `packages/api/src/handlers/mcp-context-engine.ts` already exposes
  `/mcp/context-engine` with tools such as `query_context`,
  `query_memory_context`, `query_brain_context`, `query_wiki_context`,
  `list_context_providers`, and admin policy tools.
- `docs/src/content/docs/concepts/mcp-tools.mdx` and
  `docs/src/content/docs/applications/admin/mcp-servers.mdx` already define
  tenant MCP registration, assignment to agents/templates/Spaces, per-user
  OAuth, tenant API key auth, cached tool lists, runtime logging, and managed
  app-owned MCP rows.
- `docs/src/content/docs/applications/mobile/integrations-and-mcp-connect.mdx`
  already separates tenant infrastructure registration from user-owned OAuth
  grants, which is exactly the split external agents will need.
- `docs/src/content/docs/concepts/knowledge/memory.mdx` establishes Hindsight as
  the canonical user and Space memory substrate. Compiled wiki pages are derived
  projections, not the memory source of truth.
- `packages/database-pg/src/schema/compliance.ts` already has an append-only
  audit-event model with event prefixes for `auth`, `agent`, `mcp`, `policy`,
  `approval`, `data`, `skill`, `output`, and `plugin`.
- `docs/solutions/architecture-patterns/first-party-provider-tools-stay-behind-policy-facades-2026-06-14.md`
  is the key architectural guardrail: model-visible affordances should stay
  behind policy facades instead of exposing raw provider/backend paths.

The biggest current gap is product shape. ThinkWork has internal/admin docs for
MCP servers, memory, Context Engine, approvals, plugins, and audit, but it does
not yet present them as one external-agent-facing contract.

### External Context

Executor is already using the simple market language: one MCP gateway endpoint
for agent hosts such as Claude Code, Cursor, and Codex. Its strongest lesson is
not just "gateway"; it is compact discovery: expose one small surface and load
large tool schemas only when needed.

Kody is adjacent because it is MCP-first but intentionally personal-assistant
oriented. Its project intent says the public MCP surface should stay small while
large capability complexity hides behind discovery/execution tools, and it
explicitly does not optimize for organization tenancy, fine-grained delegation,
or enterprise SSO. That leaves an enterprise-shaped opening.

FirstMate is adjacent in a different way: it shows the ergonomic value of one
front-door agent supervising delegated workers in isolated worktrees. For
ThinkWork, the useful idea is not the local tmux implementation; it is
policy-bound delegation to subordinate work units behind a single interface.

Google Agent Gateway and agentgateway validate the broader infrastructure
category: governed client-to-agent and agent-to-anywhere traffic, policy
enforcement, MCP/A2A support, and observability. Cloudflare Code Mode validates
the compact fixed-token pattern for large APIs. The current MCP authorization
spec also makes OAuth 2.1, protected resource metadata, resource indicators,
audience-bound tokens, and scope challenges first-class concerns.

MCP Apps sharpen the opportunity because they let an MCP server return an
interactive UI resource, not just text. Current MCP Apps docs describe tools
that point at `ui://` resources through metadata, with hosts fetching and
rendering those resources in sandboxed iframes. ThinkWork already has local
evidence in this direction: the MCP App host-context bridge in
`apps/web/src/components/workbench/`, the `data-json-render` thread UI envelope
in `docs/src/content/docs/applications/web/thread-generative-ui.mdx`, and the
LastMile MCP App output-template solution doc, which proved that a successful
tool call is not enough if the host does not resolve and render the UI resource.
OpenUI is relevant as a possible render grammar/runtime, but should be treated
as an adapter target rather than the core product contract.

### Sharpened Product Shape

The concrete product is **External Agent Resource Broker**:

> Let employees use Claude, Codex, Cursor, Kody-style, ChatGPT, or future agent
> harnesses against company systems without giving those harnesses direct,
> ungoverned access to company systems.

The broker has four jobs:

1. **Access:** authenticate the external harness and resolve the human, Space,
   client, credential subject, and policy context.
2. **Resource translation:** connect to legacy and modern systems such as
   Epicor P21, CRM, ERP, ticketing, docs, Slack, GitHub, and internal apps using
   the user's or tenant's approved credentials.
3. **Presentation:** normalize raw system data into both model-readable context
   and a renderable UI envelope, such as an MCP App resource, ThinkWork
   `data-json-render` part, analytics display payload, or an OpenUI-compatible
   component description.
4. **Control:** apply permission checks, approvals, redaction, write gates,
   memory retention, and audit evidence before anything reaches the host.

Example user flow:

```text
User in Claude: "Show me the open P21 orders at risk for Acme."
Claude calls ThinkWork MCP.
ThinkWork authenticates the caller and Space.
ThinkWork queries Epicor P21 through approved user/tenant auth.
ThinkWork normalizes orders, customer, margin, inventory, and risk fields.
ThinkWork returns:
  - a short text answer for the model,
  - structured data with provenance and redaction metadata,
  - a renderable MCP App / UI envelope showing the orders table, filters,
    risk badges, and allowed actions.
Claude renders the UI; any action goes back through ThinkWork policy.
ThinkWork records the access, displayed data class, and action attempts.
```

The value proposition is therefore sharper than "MCP gateway":

> Bring your own agent. ThinkWork makes company systems safe, memorable,
> auditable, and visually usable inside that agent.

The stickiness is not the endpoint URL. Stickiness comes from the accumulated
enterprise substrate: approved connectors, user OAuth grants, Space policies,
legacy-system normalization maps, render templates, memory, approval history,
audit evidence, and domain-specific capability cards. If ThinkWork only proxies
tools, it is replaceable. If ThinkWork becomes the translation, policy, memory,
and rendered-work layer for company systems, switching costs become real.

## Ranked Ideas

### 1. ThinkWork Resource Broker MVP

**Description:** Productize ThinkWork as a host-agnostic external MCP endpoint
for company context, resource lookup, UI-returning system access, and
capability discovery. The first version should expose a compact surface:
`search_resources`, `query_context`, `render_resource_view`, `request_action`,
`remember_outcome`, policy explanation, and structured denials. External agents
should see a small stable API while ThinkWork routes internally through
Space/user policy, provider eligibility, credentials, memory scope, render
adapters, and audit.

**Warrant:** `direct:` `THINK-117` says ThinkWork should be an MCP that helps
with access, memory, and adjacent Executor-like delegation. The repo already
has `/mcp/context-engine`. `external:` Executor, Kody, and Cloudflare Code Mode
all validate compact MCP surfaces with progressive discovery.

**Rationale:** This is the smallest strategic shift that honors the thesis
without abandoning ThinkWork's existing platform. It turns already-shipped
Context Engine/MCP work into a product surface external harnesses can use, and
it makes clear that the broker returns usable work surfaces rather than just
text snippets.

**Downsides:** Requires careful naming and client compatibility work. A
read-only MVP may feel less dramatic than the full delegated-action vision.

**Confidence:** 92%

**Complexity:** Medium

**Status:** Unexplored

### 2. Legacy System UI Translation Layer

**Description:** Make ThinkWork the translator between legacy systems and
agent-native UI. A request against Epicor P21, an ERP, a CRM, or a custom app
should not return only raw JSON or a textual summary. ThinkWork should fetch
through approved auth, normalize the raw records into a governed resource
model, apply redaction and provenance, then emit a renderable view: MCP App
resource, ThinkWork `data-json-render`, analytics display payload, or
OpenUI-compatible component description depending on the host.

**Warrant:** `direct:` ThinkWork already has a web MCP App host-context bridge,
a validated Thread `data-json-render` envelope with mobile fallback, and a
documented LastMile fix showing MCP App output templates must be resolved with
`readResource()` before the host can render the app. `external:` MCP Apps define
`ui://` UI resources linked from tool metadata and rendered by hosts in
sandboxed frames.

**Rationale:** This is where the Resource Broker becomes visibly valuable.
Enterprise systems like P21 are not agent-native; they have awkward APIs,
legacy auth, dense records, and UI semantics humans still need. ThinkWork can
turn those systems into safe, composable, displayable work surfaces inside
Claude, Codex, CoWork, or any host that can render MCP Apps or compatible UI
parts.

**Downsides:** Requires per-system semantic mapping, render templates, host
compatibility testing, and strict data-class redaction. It should start with a
small number of high-value read views before adding actions.

**Confidence:** 90%

**Complexity:** Medium-High

**Status:** Unexplored

### 3. Portable Company Memory Sidecar

**Description:** Make ThinkWork memory available to external agents as governed
read, reflect, and writeback surfaces. External harnesses stay primary, while
ThinkWork owns durable user memory, Space memory, compiled wiki/page
projections, source evidence, and reviewed retention. A Claude/Codex/Kody user
could switch harnesses without losing the company's memory substrate.

**Warrant:** `direct:` Hindsight is already the canonical user and Space memory
substrate in `docs/src/content/docs/concepts/knowledge/memory.mdx`. `direct:`
`THINK-117` names memory as a major component.

**Rationale:** Memory is one of the strongest reasons to route through
ThinkWork because it compounds across harness churn. Frontier harnesses may
build excellent local memories, but a company needs scoped, auditable, portable
memory independent of any one agent app.

**Downsides:** Writeback can pollute durable memory if not gated by evidence,
scope, source-harness tags, confidence, and review. This should start with
read/reflect and only then add writeback.

**Confidence:** 89%

**Complexity:** Medium-High

**Status:** Unexplored

### 4. Governed Writeback Lane

**Description:** Add an approval-gated action lane for CRM, ERP, internal apps,
and managed applications. External agents can propose or request actions;
ThinkWork validates policy, gathers approval if required, executes downstream
through approved connectors, and records evidence. Think of this as branch
protection for business actions.

**Warrant:** `direct:` `/mcp/context-engine` is intentionally read-only today,
while email first-send approval and routine approvals show ThinkWork already has
side-effect gating patterns. `external:` Google Agent Gateway frames governed
egress to tools, APIs, MCP servers, and third-party endpoints as a first-class
gateway mode.

**Rationale:** Read-only context is the wedge, but enterprise value eventually
requires safe writes. This is also where ThinkWork can differentiate from
simple MCP registries: it can broker the intent, approval, downstream call, and
audit record as one controlled operation.

**Downsides:** Highest risk area. The first version should support a narrow set
of action classes and avoid arbitrary mutating tool calls.

**Confidence:** 84%

**Complexity:** High

**Status:** Unexplored

### 5. Capability Registry With Policy Cards

**Description:** Give every external-agent-visible capability a reviewable card:
owner, source system, supported resource types, render views, data class,
read/write posture, auth mode, Space eligibility, model/client requirements,
approval requirements, audit events, and examples. Agents search the registry;
operators govern the cards. Tool and UI visibility becomes a deterministic
result of these cards plus runtime policy.

**Warrant:** `direct:` ThinkWork already has tenant MCP servers, context-safe
MCP tool rows, plugin manifests, skill trust records, and capability-catalog
seeds. `external:` MCP gateway registry projects are converging on governed
catalogs with OAuth, dynamic tool discovery, tool-level access control, and
audit trails.

**Rationale:** A broker needs an inspectable inventory, otherwise access policy
becomes invisible configuration. Policy cards also create the bridge between
operator UI, runtime enforcement, audit evidence, and external-agent
descriptions.

**Downsides:** Can become metadata-heavy if it is not tied directly to runtime
enforcement and test evidence.

**Confidence:** 86%

**Complexity:** Medium

**Status:** Unexplored

### 6. Agent-Asked Access And Denial Recovery

**Description:** When an external agent lacks access, ThinkWork should return a
structured denial with next steps: ask the user to connect OAuth, ask an
operator to approve a connector, request a time-boxed grant, narrow the Space,
or continue without that source. The agent should be able to initiate a
governed access request without receiving broader standing permissions.

**Warrant:** `direct:` MCP docs already skip unavailable OAuth servers and note
common repair cases. Managed-app/MCP lifecycle docs already separate operator
lifecycle from per-user token state.

**Rationale:** The broker becomes much more usable if it converts access
failures into repair workflows. A plain `403` makes external-agent integration
feel brittle; a structured denial lets the host agent recover safely.

**Downsides:** Needs abuse prevention so agents cannot spam admins, confuse
users into over-granting, or socially escalate privileges.

**Confidence:** 82%

**Complexity:** Medium

**Status:** Unexplored

### 7. Delegated ThinkWork Services Behind MCP

**Description:** Expose ThinkWork-managed sub-services as callable units:
summarize account context, prepare a CRM change plan, run policy verification,
perform internal research, compile memory, or create a governed work item. The
external harness delegates company-specific work rather than receiving raw
tools only.

**Warrant:** `direct:` `THINK-117` says ThinkWork may run a set of agents to
manage access and memory. `external:` FirstMate demonstrates the value of a
front-door agent routing work to isolated subordinate agents and returning
plain outcomes.

**Rationale:** This is what prevents ThinkWork from becoming a commodity MCP
proxy. The stronger product is not just "call CRM"; it is "ask ThinkWork to do
company-scoped, policy-bound work and return evidence."

**Downsides:** Easy to overbuild. This should follow the broker, memory, and
writeback foundation rather than lead the first slice.

**Confidence:** 77%

**Complexity:** High

**Status:** Unexplored

### 8. External-Agent Audit And Control Portal

**Description:** Add an operator surface for connected external clients,
sessions, grants, denials, approvals, memory writes, downstream calls, policy
evaluations, rendered views, displayed data classes, downstream resource reads,
and audit exports. The portal turns invisible MCP traffic into governed
enterprise operations.

**Warrant:** `direct:` the compliance schema already supports append-only audit
events across auth, agent, MCP, policy, approval, data, skill, output, and
plugin prefixes. `direct:` Security Center has guardrail and audit direction,
but not external-agent control yet.

**Rationale:** Enterprise buyers need to see and govern the delegated layer,
not just configure endpoints. This gives the Resource Broker operational weight
and closes the loop with audit/compliance.

**Downsides:** The portal should not lead the work; it should materialize once
events, policy decisions, external-client records, and grants exist.

**Confidence:** 80%

**Complexity:** Medium-High

**Status:** Unexplored

## Rejection Summary

| # | Idea | Reason Rejected |
|---|------|-----------------|
| 1 | Consent and credential continuity broker | Folded into Resource Broker MVP and Agent-Asked Access. |
| 2 | Tool sprawl compressor | Folded into Resource Broker MVP and Capability Registry. |
| 3 | Space-scoped company context router | Folded into Resource Broker MVP. |
| 4 | Resource access ledger | Folded into Audit and Control Portal. |
| 5 | Automatic least-privilege tool view | Important runtime detail inside Resource Broker MVP, not a standalone survivor. |
| 6 | Host-agnostic session passport | Useful implementation contract, but lower-level than the product directions. |
| 7 | Access repair autopilot | Folded into Agent-Asked Access and Denial Recovery. |
| 8 | ThinkWork is the enterprise resource plane | Reframing, not an actionable product idea by itself. |
| 9 | MCP server plus embedded sub-agents | Folded into Delegated ThinkWork Services. |
| 10 | Policy facade over everything | Architectural guardrail that applies to all survivors. |
| 11 | External harnesses become clients | Folded into Resource Broker MVP compatibility requirements. |
| 12 | ThinkWork-owned data diodes | Folded into read/write/admin lane separation across survivors. |
| 13 | Delegation evaluations | Essential verification detail, but supports all survivors rather than standing alone. |
| 14 | Hosted compatibility test matrix | Important execution detail under Resource Broker MVP. |
| 15 | Agent-to-company memory feedback loop | Folded into Portable Company Memory Sidecar. |
| 16 | Okta for agents | Strong go-to-market analogy, not a product direction. |
| 17 | Cloudflare for agent traffic | Useful framing, not a standalone idea. |
| 18 | Branch protection for business actions | Folded into Governed Writeback Lane. |
| 19 | Data catalog for agent resources | Folded into Capability Registry. |
| 20 | Air traffic control for multi-agent work | Too future-oriented for THINK-117 first exploration. |
| 21 | Package manager for enterprise capabilities | Useful long-term registry direction, broader than this issue. |
| 22 | Zero native agents | Good strategy stress test, but subject-replacement if treated literally. |
| 23 | One tool only | API design variant, not a product idea by itself. |
| 24 | No standing access | Policy stance inside Governed Writeback Lane. |
| 25 | Bring any harness | Compatibility principle inside Resource Broker MVP. |
| 26 | Company-controlled memory, user-controlled agents | Strong positioning line, folded into Portable Company Memory Sidecar. |
| 27 | Agent market without tool market | Strategy principle, not an implementation direction. |
| 28 | OpenUI as the product contract | Too specific; OpenUI is better treated as one possible render adapter beneath the Resource Broker. |

## Suggested Brainstorm Seed

The strongest seed for `ce-brainstorm` is:

> ThinkWork should become a host-agnostic enterprise resource broker for external
> MCP-capable agents: a compact endpoint that lets Claude, Codex, Kody-style,
> Cursor, ChatGPT, and future harnesses query company context, use portable
> ThinkWork memory, access legacy systems like Epicor P21 through approved
> user/tenant auth, receive renderable MCP App or compatible UI views instead of
> plain text, request governed access, and eventually execute approved business
> actions through ThinkWork's policy, credential, approval, and audit layers.
