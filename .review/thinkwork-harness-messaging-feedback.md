# ThinkWork Harness Messaging Feedback

Date: 2026-04-25
Status: Working feedback / steering memo

## Executive take

The local rework is directionally stronger than production because it gives ThinkWork a more ownable category: **the open Agent Harness for Business**.

Production currently tells a safer, smoother story around AI adoption: start small, build trust, scale safely. That is true, but it is not differentiated enough. Many governance, agent, and enterprise AI vendors can say the same thing.

The new direction should be sharper:

> ThinkWork is the customer-owned agent harness that turns raw model capability into production-grade AI work — inside the customer’s AWS boundary.

The category matters because ThinkWork is not just an app, not just agent hosting, and not just governance. It is the engineered runtime around agents: threads, memory, sandboxing, tools, policy, budgets, evaluations, audit, and deployment ownership.

## Recommended positioning

### Primary message

**Production-grade AI work, on AWS you own.**

This is the strongest current homepage headline direction. It is plain, business-readable, and distinct. It immediately says:

- this is about production, not demos
- this is about work, not chat
- this runs inside the customer’s boundary
- ownership is central

### Category line

**ThinkWork is the open Agent Harness for Business.**

This should stay, but it needs a simple follow-up every time it appears early:

> The harness is the runtime around the model: threads, memory, sandboxing, tools, controls, cost, and audit — built in from day one.

Do not assume visitors know what “Agent Harness” means. Teach it quickly, then use it confidently.

### Core promise

> The harness stays yours.

This is the most compact strategic line. It carries the entire point: not rented from a black box, not trapped inside a vendor API, not separated from the customer’s AWS/account/data/work record.

Use it as a recurring refrain across homepage, docs, and deployment-model pages.

## Messaging hierarchy

The public story should follow this order:

1. **Outcome:** production-grade AI work inside your AWS.
2. **Category:** an open agent harness, not a black-box agent platform.
3. **Mechanism:** threads, memory, sandbox, controls.
4. **Proof:** reliability, efficiency, security, traceability.
5. **Choice:** self-host, operated by ThinkWork, or enterprise services.

This is stronger than leading with an “AI adoption journey.” Adoption is still useful, but it should become the rollout path, not the category.

## What is working in the local rework

### 1. The homepage has a more differentiated category

Local: **Agent Harness for Business**  
Production: **The AI Adoption Journey**

The local framing is better. “AI adoption journey” sounds like consulting, governance, or generic enterprise enablement. “Agent Harness” says ThinkWork has an architectural point of view.

### 2. The AWS ownership boundary is clear

“On AWS you own” is doing real work. Keep saying this in slightly different ways:

- runs in your AWS account
- inside your VPC
- your IAM, your network, your database
- no shared SaaS control plane
- no black-box hosted harness
- managed does not mean vendor-hosted

This is one of the strongest wedges against hosted agent platforms.

### 3. Threads, memory, sandbox, controls map well to harness mechanics

The local homepage’s “Inside the Harness” section is strong because it connects product primitives to the category.

Recommended mental model:

- **Threads** = work record, perception/history, audit substrate
- **Memory** = context layer, portable organizational learning
- **Sandbox** = deterministic execution surface for non-deterministic plans
- **Controls** = policy, cost, safety, evaluations, traceability

That set is concrete enough for operators and technical buyers.

### 4. The architecture docs are much stronger with harness mechanics

The added PPAF loop and harness explanation make the docs feel like a system, not a list of AWS resources.

This belongs in docs. It gives technical readers confidence that ThinkWork has a coherent model for production agents.

## What needs polish

### 1. Do not over-teach Harness Engineering on the homepage

The harness article is useful, but the homepage should not feel like a summary of the article.

Homepage visitors need the buyer promise first:

> Deploy production-grade agents in your AWS, with threads, memory, sandboxing, controls, cost, and audit built in.

Then the page can explain that this is the harness.

The docs can go deeper into PPAF, REST/operating anchors, control/data plane, state separation, and memory/token pipelines.

### 2. Be careful with “REST anchors”

Reliability, Efficiency, Security, and Traceability are excellent pillars. But “REST” is overloaded because REST already means APIs.

Recommendation:

- Homepage: **four operating guarantees** or **four harness guarantees**
- Docs: define **R/E/S/T anchors** if desired, but avoid making “REST” the customer-facing brand

Suggested homepage copy:

> Four operating guarantees, enforced in code: reliability, efficiency, security, and traceability.

### 3. Make “open” mean something concrete

“Open Agent Harness” is good, but it should be backed by specific claims:

- Apache 2.0 / open source
- deploys into customer AWS
- no shared control plane required
- portable memory/work record
- pluggable memory/runtime contracts over specific vendors
- same harness across self-hosted, operated, and enterprise models

Avoid letting “open” sound like a vibe.

### 4. Clarify “managed” vs “vendor-hosted”

This is an important distinction and should show up explicitly:

> ThinkWork for Business is operated by us, in your AWS. Managed does not mean vendor-hosted.

This should appear anywhere the deployment models are explained.

### 5. Avoid making AWS/AgentCore sound like the product

AWS is the boundary and deployment substrate. AgentCore is an execution adapter. The product is the harness.

Recommended language:

- Good: “sandboxed execution on AWS Bedrock AgentCore”
- Good: “AgentCore is one runtime adapter beneath the harness”
- Risky: “ThinkWork is an AgentCore platform”
- Risky: “AgentCore managed memory is the memory system”

The durable product concept is the portable ThinkWork contract above vendor-specific services.

## Homepage steering recommendations

### Hero

Keep the current direction, but tighten the explanatory line.

Possible hero:

> **Production-grade AI work, on AWS you own.**
>
> ThinkWork is the open Agent Harness for Business: threads, memory, sandboxing, controls, cost, and audit built into the runtime — self-hosted in your AWS or operated there by us.

Alternative punchier version:

> **The agent harness stays yours.**
>
> Deploy production-grade AI work inside your AWS boundary — with threads, memory, sandboxing, controls, cost, and audit built in.

My recommendation: keep “Production-grade AI work, on AWS you own” as the headline because it is clearer for first contact. Use “The harness stays yours” as a refrain/section line.

### Top proof cards

Current local cards around Reliability / Efficiency / Security / Traceability are good. Adjust the label from framework-speak to outcome-speak.

Possible cards:

- **Recoverable by design** — checkpoints, retries, idempotent writes, consistent turn records
- **Cost stays visible** — token budgets, per-agent spend caps, cost next to the decision that caused it
- **Capability-gated** — approved tools, sandboxed execution, PII/injection filtering
- **Traceable every turn** — tool calls, model calls, outcomes, evals, and audit in the thread

### Rollout path

Keep “Pilot → Visible work → Expansion → Operate.” This is better than “Start small → Build trust → Scale safely” because it feels more operational.

Position it as:

> The harness is production-grade on day one. The rollout path is about expanding what you trust it to do.

That line is strong. It separates product maturity from adoption maturity.

### Inside the harness

Keep the four primitives, but consider adding Connectors somewhere nearby. The docs say six components: Agents, Threads, Memory, Connectors, Automations, Control. The homepage says four primitives: Threads, Memory, Sandbox, Controls.

That is okay if intentional, but the mapping should be crisp:

- Homepage primitives = what makes the harness understandable
- Docs components = full system model

Suggested section intro:

> Four primitives explain the harness. Six components implement it.

Maybe too clever for homepage, but useful internally.

### Deployment models

This is strategically important and should be near the bottom but not buried.

Recommended copy:

> One harness, three ways to run it.
>
> **Open:** self-host the Apache 2.0 harness in your AWS.  
> **For Business:** same harness, operated by ThinkWork in your AWS.  
> **Enterprise:** strategy, launch, managed operations, and support around either path.  
>
> The runtime boundary does not change. The harness stays yours.

## Docs steering recommendations

### Docs homepage

The local docs homepage is strong. It should explicitly own this definition:

> ThinkWork is a Terraform-deployed agent harness that stands up a production-grade runtime inside your AWS account.

Then immediately explain the six components.

The “If ThinkWork disappears tomorrow, your deployment keeps working” line is excellent. Keep it. It is unusually direct and believable.

### Getting Started

The getting-started guide is practical and strong. The opening should connect the deployment commands to the strategic promise:

> In five commands, you get the same harness used in production: threads, memory, agents, connectors, automations, and controls — deployed into your account.

The guide should make sure “doctor” feels like part of the harness promise: validation, not just a CLI helper.

### Architecture

The local architecture page should become the canonical explanation of the harness.

Recommended structure:

1. What the harness is
2. PPAF loop
3. Four operating guarantees
4. State separation: model is stateless compute, harness owns state
5. System components
6. AWS deployment topology
7. Data flows
8. Security/multi-tenancy

Add this idea explicitly:

> ThinkWork treats the model as stateless compute. Durable state lives in the harness: threads, memory, audit, cost, policies, and execution records.

That is one of the cleanest ways to explain why the product exists.

### Concepts pages

Each concept page should answer the same four questions:

1. What harness problem does this solve?
2. What user/operator surface does it create?
3. What state does it own?
4. Which operating guarantees does it support?

This keeps the docs from becoming feature inventory.

## Language to use more

- agent harness
- customer-owned harness
- AWS boundary
- work record
- thread-native work
- portable memory
- inspectable memory
- auditable turns
- capability-gated agents
- policy enforced in code
- cost next to decisions
- same harness, different operating model
- managed in your AWS, not hosted in ours
- the harness stays yours

## Language to use carefully

- “AI adoption journey” — useful as rollout framing, weak as category
- “REST anchors” — good internally/docs, overloaded publicly
- “platform” — generic; use only after the harness category is established
- “managed agents” — clarify managed runtime vs vendor-hosted control plane
- “AgentCore” — important adapter/substrate, not the product category
- “memory graph” — good feature detail, but the bigger promise is portable/inspectable memory

## Suggested north-star copy block

> ThinkWork is the open Agent Harness for Business.
>
> It deploys into your AWS account and gives agents the runtime they need to do production work: durable threads, portable memory, sandboxed execution, approved tools, budgets, evaluations, and audit trails.
>
> Self-host it, have us operate it, or wrap it with enterprise services. The operating model can change. The harness stays yours.

## Final recommendation

Adopt the local rework as the baseline direction, but polish it around one simple idea:

> ThinkWork makes agent infrastructure easy without handing the harness to a black-box vendor.

The homepage should sell the outcome and category. The docs should prove the engineering philosophy. The deployment model should make the ownership boundary impossible to miss.

If this lands, ThinkWork stops sounding like another AI governance/productivity platform and starts sounding like the open infrastructure layer for governable agent work.
