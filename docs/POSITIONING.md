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
2. **AI work.** Not just chat. Threads carry conversational _and_ non-conversational work — automations, integration events, multi-step routines.
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

We are deliberately _not_ these things, and copy that drifts toward them is wrong:

- **Not an AI adoption journey or governance program.** That's consulting. The "AI adoption journey" framing is retired across all surfaces.
- **Not a hosted SaaS agent platform.** We do not run a multi-tenant control plane in our AWS. Even ThinkWork for Business deploys into the customer's AWS — we operate the runtime _in their account_, not ours. **Managed does not mean vendor-hosted.**
- **Not "AgentCore + glue."** AgentCore is one runtime adapter beneath the harness. The harness is a contract above it (Threads, Memory, Audit, Cost, Templates) that survives any single vendor service.
- **Not a chat product.** Threads carry every kind of work, not just chat. The thread shape is what makes audit, cost, and replay tractable across automations, integrations, and conversation.
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
- **Threads / Memory / Agents / Integrations / Automations / Control** — the canonical six components
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

## Company Brain positioning

Added 2026-07-22, following the Company Brain arc (THINK-325); product noun updated to **Company Brain** 2026-07-23 (user-directed reversal of the earlier Digital Twin decision). This section governs every surface that talks about the graph, the ontology, or company knowledge.

### The naming contract

Four terms, four jobs. Copy that blurs them is wrong.

- **Company Brain** (formerly Digital Twin) — the product noun. The living graph of the customer's business: entities, relationships, and operating knowledge, projected from their systems into Neptune in their account. When one name has to stand for the whole capability, this is it. "A company brain for your business" / "your company's brain" are the approved long forms.
- **Ontology** — the schema, never the product. The declared entity types, relationships, facets, and page sections that govern the brain. Always positioned as something the customer controls: "governed by an ontology you control." Never "ThinkWork is an ontology" — that names the map, not the territory, and invites a Palantir comparison we don't want to run head-on.
- **Knowledge** — the user-facing umbrella in the product UI (nav item; tabs Memory / Pages / KBs / Ontology). UI copy says Knowledge; marketing copy says Company Brain. Do not swap them.
- **Digital Twin** — retired product noun (2026-07-23). Do not use in new copy; a one-line "formerly Digital Twin" parenthetical is allowed where continuity matters. Runtime identifiers that carry `twin` (`twin-mapping/v1`, S3 prefixes, module paths, the `thinkwork twin` CLI command) are unaffected — identifier migration is a separate program.

**Banned:** "World Model" as a product noun or capability name. It is claimed by AI research for a different thing (video/simulation models) and will read as trend-chasing. Permissible once, lowercase, in explanatory body copy ("a working model of your company") — never as a heading, feature name, or label.

### The one-sentence positioning

> **ThinkWork builds a company brain for your business — a living graph of your entities, relationships, and operating knowledge — governed by an ontology you control, running in your own AWS account.**

Every term in that sentence is load-bearing: _living_ (freshness is tracked, staleness is visible), _governed_ (changes go through approved change sets, not silent mutation), _you control_ (the ontology is the customer's), _your own AWS account_ (the brain never leaves their boundary).

### The narrative: the model is a commodity; the brain is the asset

The market conversation has arrived where we already are. Enterprises are realizing two things at once:

1. **The AI layer is interchangeable.** Models converge in capability; harnesses and copilots can be swapped. Whatever sits at the top of the stack today will be replaced by something better within quarters.
2. **The context is not.** The tribal knowledge, the decision history, the relationships between accounts and people and projects — the operating reality of the business — is the one durable asset. Whoever holds it, contextualized and retrievable, holds the value.

The objection this raises — "I'm paying for tokens and the vendor is learning my business" — is real, and most vendors can only mitigate it. We answer it structurally: **there is no ThinkWork in the data path.** The brain lives in Neptune in the customer's account; the harness runs in their VPC; the model is a Bedrock endpoint they can swap. The customer's operating knowledge accumulates in an asset they hold title to, and the intelligence layer rents itself to that asset — not the other way around.

The strategic refrain extends: **The harness stays yours. So does the brain.**

This does not demote the harness category. The harness is what makes a brain more than a database: it is the machinery that builds the brain from live systems, keeps it current, governs who and what may read it, and puts it to work in agent turns. Brain without harness is a data project; harness without brain is a commodity. We sell the pair.

### Differentiators (in the order that wins)

1. **In your account.** The full answer to the IP objection, not a mitigation. No shared control plane, no vendor-side copy of the graph, no data path through us. "If ThinkWork the company disappears tomorrow, your brain keeps working" — the durability line applies here verbatim.
2. **Governed, including when not to act.** Ontology changes ship through approved change sets. Writes are asymmetric — agents cannot silently author identity mappings. Access is scoped: security-group visibility on nodes and edges means the brain can hold HR-sensitive material without exposing it to every caller, human or agent. Most of the market demos retrieval; almost nobody demos governance. This is the demo we win.
3. **Live, and honest about freshness.** Every projected fact carries provenance and cache age. Stale data says it is stale. A brain that cannot tell you what has degraded is a wiki with a graph rendering.
4. **Model-agnostic by construction.** The brain is the durable layer; Bedrock models are execution surfaces beneath it. Swapping the model is an operational change, not a migration.

### Objection handling

- **"Isn't this Palantir's ontology?"** Palantir proved the category. The difference is deployment shape and buyer: Foundry is Palantir's platform holding your data; ThinkWork is a brain in _your_ AWS account, governed by _your_ ontology, with the harness as an Apache-2.0 contract you could operate without us. We ride the category validation; we do not fight the brand.
- **"We already bought everyone Claude licenses."** Seats teach people to use a model; they build no asset. Every prompt that pastes context is context the company reconstructs by hand, forever. The brain is what makes the seats compound: the same model, given the brain, does account-aware work on the first turn. Seats are spend; the brain is capital.
- **"We already connected our tools to [assistant] via connectors."** Connectors fetch documents; they do not resolve identity across systems, track freshness, encode relationships, or govern visibility. "Search my Drive" and "traverse from this customer to their past-due invoices and low tanks across three systems" are different capabilities. The brain is the second one.
- **"Is this just a knowledge graph project?"** No standing graph team required. The ontology is declared, projection is automated from live systems, and drift shows up as visible staleness — not as a quarterly re-ingestion project.

### Approved phrases (Company Brain addendum)

- **A company brain for your business** — the long-form product line
- **A living graph of your entities, relationships, and operating knowledge** — the teaching line
- **Governed by an ontology you control** — the schema line
- **The harness stays yours. So does the brain.** — the extended refrain
- **The model is a commodity; the brain is the asset** — the narrative line
- **No ThinkWork in the data path** — the IP-objection answer
- **Seats are spend; the brain is capital** — the Claude-licenses counter
- **Knows when not to act / who may not see** — the governance framing

### Banned traps (Company Brain addendum)

- **"World Model"** as noun, heading, or feature name (see naming contract)
- **"Digital Twin"** in new copy — retired product noun; "formerly Digital Twin" continuity parentheticals only
- **"Second brain" / "hive mind" / "LLM wiki"** — SMB/prosumer register; wrong audience
- **"Your data is the moat"** verbatim — the phrase is commodity discourse by now; use the narrative line instead
- **"Ontology" as the product name** — schema only, always possessed by the customer
- **Palantir comparisons we start** — answer the objection when raised; never lead with the comparison

## How to use this doc

- **Before writing copy** for any new public surface: read this doc top-to-bottom.
- **During code review** of copy changes: check against the Approved phrases / Banned traps lists.
- **When the doc and a surface disagree:** edit the doc first, then the surface — never the other way around.
- **CI is a gate, not the only gate.** The grep hooks catch the banned-word traps; everything else (anti-positioning, audience, generic-platform language) needs reviewer attention.
- **The 2026-04-25 messaging-feedback memo is the rationale for everything in this doc.** When something seems arbitrary, the memo at `.review/thinkwork-harness-messaging-feedback.md` is the why.
