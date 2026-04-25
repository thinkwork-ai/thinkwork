# ThinkWork Positioning

Source-of-truth doc for the Agent Harness for Business positioning. Sibling to `docs/STYLE.md`. Every public surface — homepage, pricing, services, docs, README, GitHub, npm, social, deck — measures against this doc. Edits that drift from it should drift the doc first, not the surface.

This is the durable artifact derived from the 2026-04-25 messaging-feedback memo (`.review/thinkwork-harness-messaging-feedback.md`) and the rebrand work shipped on `feat/agent-harness-for-business`. Treat it as the contract.

---

## Category

**ThinkWork is the open Agent Harness for Business.**

The harness is the engineered runtime around the model — threads, memory, sandboxing, tools, controls, cost, evaluations, and audit, deployed in the customer's AWS account. It turns raw model capability into production-grade agent work.

We are not an AI app. Not an agent-hosting service. Not a governance product. Not a Bedrock wrapper. Not "AgentCore + glue." The category we own is the harness — the engineered structure that sits between the model and the business work, and that gives operators the controls and traces they need to run agents in production.

## Promise

> **Production-grade AI work, on AWS you own.**

That's the headline promise. Three load-bearing parts:

1. **Production-grade.** Not demos, not chat. The harness ships every operating guarantee on day one: Reliability, Efficiency, Security, Traceability.
2. **AI work.** Not just chat. Threads carry conversational *and* non-conversational work — automations, connector events, multi-step routines.
3. **On AWS you own.** Inside the customer's AWS boundary. Their VPC, their IAM, their Aurora, their S3 audit log. No shared SaaS control plane. The runtime stays in their account across all three operating models.

The strategic refrain: **The harness stays yours.**

## Audience

**Primary** — AWS-shop platform / CTO buyers who:
- Already operate AWS at production scale (Bedrock, Aurora, IAM, VPC discipline)
- Need governance + cost control + audit, not just agent execution
- Reject SaaS control planes for AI work for sovereignty / compliance / data-residency reasons
- Have a team that will operate or run the runtime — directly, with us as ThinkWork for Business, or with us via Enterprise services

**Secondary** — OSS contributors evaluating the open Agent Harness on GitHub. The README is their first surface; their decision to read further depends on the same category clarity the website provides. Apache 2.0, no shared control plane, portable memory contract.

**Tertiary** — Operators inside enterprise teams running the runtime day-to-day (the people who live in the admin web). They are not the buyer but they live with the choice; the docs serve them.

**Out of segment** — pre-AWS teams, K8s-only shops, individual developers / hobbyists looking for a personal AI assistant, vendors looking to white-label.

## Anti-positioning

We are deliberately *not* these things, and copy that drifts toward them is wrong:

- **Not an AI adoption journey or governance program.** That's consulting. The "AI adoption journey" framing is retired across all surfaces.
- **Not a hosted SaaS agent platform.** We do not run a multi-tenant control plane in our AWS. Even ThinkWork for Business deploys into the customer's AWS — we operate the runtime *in their account*, not ours. **Managed does not mean vendor-hosted.**
- **Not "AgentCore + glue."** AgentCore is one runtime adapter beneath the harness. The harness is a contract above it (Threads, Memory, Audit, Cost, Templates) that survives any single vendor service.
- **Not a chat product.** Threads carry every kind of work, not just chat. The thread shape is what makes audit, cost, and replay tractable across automations, connectors, and conversation.
- **Not a Bedrock wrapper.** The harness is the durable layer; Bedrock is one execution surface. AgentCore Memory and Hindsight are interchangeable adapters under one ThinkWork memory contract.
- **Not for K8s shops.** AWS-only is a positioning commitment, not a limitation. Trying to be cloud-neutral dilutes the wedge against hosted SaaS platforms.

If a paragraph could describe any AI vendor with a few words swapped out, it isn't ThinkWork.

## Approved phrases

The vocabulary the rest of the surface should pull from. Use these verbatim where they fit; rephrase only when copy demands it.

- **Agent Harness for Business** — the category line
- **The harness stays yours** — the strategic refrain
- **Production-grade AI work, on AWS you own** — the headline promise
- **One harness, three ways to run it** — the deployment-ladder framing
- **Managed does not mean vendor-hosted** — the For Business clarifier
- **The harness is the runtime around the model** — the teaching line
- **Runs in your AWS / inside your AWS boundary / your IAM / your account** — ownership reinforcers
- **Reliability, Efficiency, Security, Traceability** — spelled out, on first use everywhere
- **Operating guarantees** — collective shorthand for the four
- **Threads / Memory / Agents / Connectors / Automations / Control** — the canonical six components
- **Pilot. Visible work. Expansion. Operate.** — the rollout path
- **PPAF agent loop (Perception, Planning, Action, Feedback)** — docs only
- **Self-host / operated / enterprise services** — the three doors
- **"If ThinkWork the company disappears tomorrow, your deployment keeps working."** — the durability line; do not paraphrase

## Banned traps

CI-enforced and review-enforced. Edits that introduce these fail the build or fail review.

**Acronym + metaphor traps:**
- **"REST anchors"** in customer-facing surfaces (HTTP REST homonym). Use "operating guarantees" or spell the four out. Docs may use "R/E/S/T" as internal shorthand, never as the customer-facing brand.
- **"horse / reins / wild horse"** outside `docs/src/content/docs/architecture.mdx` — single-use rule, CI-enforced via `.github/workflows/lint.yml`. The metaphor lives in one Aside callout and one body intro paragraph; nowhere else.

**SaaS-ambiguity traps:**
- **"Skip the infrastructure"** / **"fully managed"** without "in your AWS" attached. Both quietly imply the customer doesn't have the runtime; both are wrong for the For Business tier.
- **"Use ThinkWork without running the platform"** — same trap. The For Business tier is "we operate it, in your AWS," not "we host it for you."

**Generic-platform traps:**
- **"AI platform" / "AI infrastructure"** without "agent harness" anchoring it. Generic descriptors that describe any vendor.
- **"AI adoption journey"** — retired category framing. The rollout-path framing replaced it.
- **"AgentCore platform"** — AgentCore is an adapter, not the product.
- **"AgentCore managed memory is the memory system"** — memory is a contract above adapters; AgentCore Memory and Hindsight are interchangeable.

**Voice traps (CI-enforced):**
- **Banned verbs:** transform, unlock, empower, leverage (verb form), seamlessly. The CI grep at `.github/workflows/lint.yml` fails the build on any of these in `.mdx`/`.md` content. Rephrase rather than exclude — if the prose needs them, the prose is wrong.
- **"journey"** — banned. Use "rollout path," "adoption arc" only in services-leadership copy, or specific phase names.
- **Stacked adjectives:** "powerful, flexible, reliable" — cut two.
- **Verticals:** no healthcare-specific / finance-specific / legal-specific marketing. The harness is vertical-agnostic.
- **Unearned compliance badges:** no SOC2 / HIPAA / ISO without certification.

## How to use this doc

- **Before writing copy** for any new public surface: read this doc top-to-bottom.
- **During code review** of copy changes: check against the Approved phrases / Banned traps lists.
- **When the doc and a surface disagree:** edit the doc first, then the surface — never the other way around.
- **CI is a gate, not the only gate.** The grep hooks catch the banned-word traps; everything else (anti-positioning, audience, generic-platform language) needs reviewer attention.
- **The 2026-04-25 messaging-feedback memo is the rationale for everything in this doc.** When something seems arbitrary, the memo at `.review/thinkwork-harness-messaging-feedback.md` is the why.
