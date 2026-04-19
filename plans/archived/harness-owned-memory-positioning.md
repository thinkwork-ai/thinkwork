# PRD: Harness-owned memory positioning

## Summary

ThinkWork should position memory as part of its harness, not as a detachable memory plugin, not as a standalone memory database, and not as generic "AI personalization."

The durable idea is simple: **Threads hold the work record. The ThinkWork harness decides what context carries forward. Memory is how the harness makes work cumulative.**

This gives ThinkWork a stronger, more defensible story than "we support memory." It ties memory to the product's actual center of gravity: threads, controls, agents, and AWS-owned infrastructure.

The goal of this PRD is to sharpen that story before the market collapses "memory" into either commodity vector search or vendor-controlled black-box state.

## Problem

Current ThinkWork docs are directionally good, but the messaging is split across too many frames:

- "Memory" is used as an umbrella category for document knowledge, long-term memory, retrieval, and future knowledge graph work.
- "Knowledge" still appears as a top-level product module in the README, while docs rename the section to "Memory."
- Some pages separate knowledge and memory clearly, while others blend them back together.
- Hindsight is described as an optional add-on, but the broader product story does not yet explain why memory belongs to ThinkWork itself rather than to any individual backend.
- The strongest ThinkWork idea, threads as the universal work container, is not yet fully connected to the memory story.

That creates three risks:

1. **ThinkWork sounds like another RAG platform.**
2. **ThinkWork sounds like it depends on whichever memory backend is fashionable this quarter.**
3. **ThinkWork undersells its real value: owning the system that turns work history into usable context under your control.**

## Strategic framing

### Position to own

**ThinkWork is the harness for AI work. Memory is one of the harness's core jobs.**

Not because memory is trendy, but because any serious agent system has to answer the same questions:

- What is the canonical record of work?
- What context survives from earlier work?
- What gets retrieved into a turn?
- What is grounded in documents versus learned from interaction?
- What is visible, auditable, and controllable?

ThinkWork already has the right product primitives to answer those questions:

- **Threads** are the canonical record of work.
- **Memory** is the carry-forward layer selected from that work and other sources.
- **Agents** act on assembled context.
- **Control** governs how that system behaves.

That is the message. Not "we have memory features." Not "bring your own memory provider." Not "knowledge graph coming soon."

### Core thesis

**If you do not control the harness, you do not really control memory.**

For ThinkWork, that thesis should be translated into product language the market can trust:

- Memory is not just a database.
- Memory is not just retrieval.
- Memory is not just a chatbot preference store.
- Memory is the harness behavior that determines what prior work becomes usable context.

ThinkWork should make the ownership story concrete:

- your threads live in your system of record
- your context assembly runs in your AWS account
- your memory behavior is part of your deployed runtime
- your controls and audit trail stay attached to the same work system

### Why this fits ThinkWork specifically

ThinkWork is not selling a generic agent SDK. It is selling **open infrastructure for AI work**. The differentiator is not merely model access or tool calling. It is the combination of:

- one thread model for chats, tasks, automations, and connectors
- one control plane for policy, budgets, and auditability
- one deployment boundary inside the customer's AWS account
- one harness that decides how work turns into context

That makes ThinkWork's memory story stronger when it stays grounded in work, not intelligence theater.

## Product truth to preserve

The positioning must stay faithful to current product reality.

Today, ThinkWork most concretely supports:

- thread history as the durable work record
- document knowledge through Bedrock Knowledge Bases
- long-term memory through AgentCore Memory by default
- Hindsight as an optional add-on
- context assembly inside the managed runtime

That means the messaging should emphasize **harness ownership and conceptual clarity**, not pretend ThinkWork already ships a grand unified memory fabric.

## Current messaging inconsistencies

These should be fixed as part of the rollout.

### 1. README says "Knowledge" while docs say "Memory"

README lists six modules including **Knowledge**.
Docs homepage lists **Memory**.

This is the biggest naming wobble. It implies either:

- Knowledge is the product and Memory is a sub-area, or
- Memory replaced Knowledge but the repo has not caught up.

Recommendation: pick one top-level label and use it consistently. For the reasons below, use **Memory** as the external concept and treat document knowledge as one memory input.

### 2. Docs use "Memory" as umbrella, then later separate knowledge and memory again

The umbrella model is strategically useful. But some pages revert to:

- knowledge means docs
- memory means retained interaction state

That distinction is valid operationally, but it creates copy drift when both are presented as separate top-level ideas.

Recommendation: keep the umbrella externally, preserve the distinction internally:

- **Memory** = the full context carry-forward layer
- **Document knowledge** = one memory source
- **Long-term memory** = another memory source
- **Retrieval and context assembly** = the harness behavior that combines them

### 3. Current copy sometimes makes Memory sound passive

Phrases like "Memory decides what context gets surfaced into a turn" are solid, but many pages still read like a storage catalog.

ThinkWork should talk less about stores and more about the harness behavior:

- what gets retained
- what gets recalled
- what gets assembled
- what remains auditable in the thread

### 4. Knowledge graph language risks future-hype leakage

The current knowledge graph page is careful, which is good. But the broader category framing can still make readers assume ThinkWork is heading toward generic "memory platform" language.

Recommendation: keep graph messaging subordinate to work-centric retrieval. Graph is a possible future structure for work context, not the product identity.

## Messaging principles

### 1. Start from work, not memory

Do not lead with abstract claims about state, personalization, or intelligence.
Lead with the reality that work happens in threads, and useful systems carry context forward from that work.

### 2. Treat memory as harness behavior, not a bolt-on

ThinkWork can integrate multiple backends, but the product should never imply that the backend is the product.
The harness determines how memory is formed, read, and used.

### 3. Keep thread history and memory distinct

This distinction is one of ThinkWork's clearest ideas.

- **Threads** keep the full record.
- **Memory** carries forward what matters.

That is crisp, intuitive, and easy to repeat.

### 4. Keep document knowledge in the story, but demote RAG as the headline

ThinkWork should not let "knowledge base" language swallow the bigger message.
Document retrieval matters, but it is only one source of usable context.

### 5. Make control part of the memory story

Memory without auditability, policy, and ownership is not a trustworthy enterprise story.
ThinkWork should connect memory to:

- audit trail
- deployment ownership
- policy boundaries
- connector context
- operational control

### 6. Avoid hype words that flatten the product

Avoid language that makes ThinkWork sound like:

- a vector database wrapper
- a memory layer for any agent
- a personalization engine
- an AGI-style persistent brain

## Messaging architecture

### Category statement

**ThinkWork is the harness for AI work. It gives agents a durable work record, controlled context assembly, and memory that stays inside your system boundary.**

### Short positioning line options

1. **Threads run the work. Memory carries it forward.**
2. **Own the harness, own the memory.**
3. **Memory is not a plugin. It is how your work system stays cumulative.**
4. **ThinkWork turns thread history, retrieved knowledge, and retained context into usable memory under your control.**

Recommended primary line: **Threads run the work. Memory carries it forward.**

Reason: it sounds like ThinkWork, not like a response to a competitor blog post.

### Expanded message

ThinkWork keeps every conversation, task, automation run, and connector event in a thread. The harness then decides what context to bring forward, from recent history, documents, and retained memories, so agents can act with continuity without hiding the underlying work record. That is memory in ThinkWork: not a detached service, but part of the system that runs the work.

## What to say

### Core claims

- **ThinkWork memory is harness-owned.** It is part of how the platform runs agents, not a detached afterthought.
- **Threads are the source record.** Memory is the selective carry-forward layer, not a replacement for history.
- **Document knowledge and long-term memory feed the same harness.** One grounds agents in source material, the other carries forward what the system has learned from prior work.
- **Context assembly is a product capability.** ThinkWork decides how thread history, retrieval, memories, tools, and connector metadata become the next turn.
- **Memory stays inside your operational boundary.** The work record, context logic, and controls live in your AWS account.
- **ThinkWork is built for cumulative work, not one-shot demos.**

### Supportive proof points

- one thread model across chat, automation, email, and connector events
- memory connected to the same audit trail and control plane
- managed default memory plus optional alternate engine support
- no need to pretend one storage backend defines the user experience
- clear distinction between full history and reused context

## What not to say

- Do not say ThinkWork is a "memory platform."
- Do not say memory is a "plugin" or "bring-your-own memory layer" as the lead story.
- Do not reduce the story to RAG, embeddings, or vector search.
- Do not imply knowledge graph is the center of the current value proposition.
- Do not imply memory is autonomous magic that improves itself without governance.
- Do not imply backend optionality is the strategic message. Optionality is useful, but ownership of the harness matters more.
- Do not frame memory as replacing threads. Threads are the system of work.
- Do not use vague phrases like "unified context intelligence layer" or "enterprise memory fabric."

## Naming and terminology recommendations

### Top-level product term

Use **Memory** as the top-level concept in website nav, docs, and product messaging.

Reason:

- It is the more strategically important term in the current market.
- It better captures the harness argument.
- It can cleanly contain document knowledge, long-term memory, and context assembly.
- "Knowledge" is too easily read as just RAG or document indexing.

### Internal structure

Use this vocabulary consistently:

- **Threads**: the canonical record of work
- **Memory**: the carry-forward context layer
- **Document knowledge**: source material retrieved from uploaded documents
- **Long-term memory**: retained context learned from prior work
- **Context assembly**: how the harness builds the next turn
- **Knowledge graph**: future roadmap direction for structured knowledge, not current category identity

### Terms to reduce or retire

- Reduce top-level use of **Knowledge** as a standalone module label
- Avoid **memory engine** as the main user-facing abstraction unless discussing configuration
- Avoid **personalization** as the lead concept unless the use case is explicitly user preference retention
- Avoid **stateful agents** as the homepage-level phrasing; it is accurate but less product-shaped than cumulative work

## Website copy direction

### Homepage

Current homepage already has the right skeleton:

- Threads
- Memory
- Connectors
- Control

Improve the Memory card so it speaks in harness language, not category language.

Recommended replacement:

**Memory**
The context layer for AI work. ThinkWork carries forward what matters from thread history, documents, and retained memories, inside the same harness that runs the work.

### Hero / subhero ideas

Current hero is strong, but memory is not visible enough as a differentiator.

Possible supporting sentence below the hero:

**Threads keep the record. Memory carries context forward. Control keeps it auditable.**

Or:

**Not a chatbot wrapper and not a black-box agent API. ThinkWork gives you the harness that owns work history, memory, and control inside your AWS account.**

### Architecture page

Lean harder into this line:

- Threads are the record of work
- Memory is the context layer
- Agents are the execution layer

This is already present. It should become a repeated company-level frame, not just an architecture explanation.

## Docs copy direction

### Memory overview page

Current page is close, but should be sharpened from descriptive taxonomy into product posture.

Add a stronger opening such as:

> In ThinkWork, memory is not a separate add-on. It is the part of the harness that turns prior work into usable context.

Then keep the current thread / memory / agent distinction.

### Long-term memory page

Current page is operationally clear but too backend-forward in parts.

Refine emphasis:

- first explain why long-term memory exists in a thread-centric system
- then explain current backend reality
- keep AgentCore and Hindsight as implementation choices under the harness, not the center of the story

### Retrieval and context page

This page should become one of the strongest messaging pages in the docs.

It should explicitly say:

- retrieval is not separate from the harness
- context assembly is a first-class ThinkWork capability
- the reason ThinkWork separates threads, memory, and agents is to make this behavior legible and controllable

### Threads page

Add one sentence that makes the memory relationship unforgettable:

> Threads are where work lives. Memory is how useful parts of that work show up again later.

### Managed agents page

Strengthen the line that ThinkWork supplies the surrounding system. That surrounding system is the harness, and memory is part of it.

## Product copy direction

### Admin UI / product surfaces

Where possible, avoid exposing backend-specific labels before user-level concepts.

Prefer:

- Memory
- Document knowledge
- Long-term memory
- Context sources

Over:

- AgentCore Memory
- Hindsight retrieval engine
- memory namespace strategy

Backend names belong in advanced settings, deploy docs, and architecture docs.

### CLI / deploy docs

Keep implementation honesty, but frame it under the harness model.

Example:

- "ThinkWork deploys managed long-term memory by default"
- "Enable Hindsight when you need expanded retrieval behavior"

Not:

- "Choose your memory platform"

## Rollout phases

### Phase 1: Naming cleanup

- Align README, docs homepage, and concept taxonomy on **Memory** as the top-level concept
- Demote **Knowledge** to **Document knowledge** where applicable
- Audit nav labels, module lists, page descriptions, and cross-links

### Phase 2: Core messaging rewrite

- Update homepage Memory card
- Update Memory overview intro
- Update Retrieval and Context page intro and framing
- Add thread-memory relationship sentence to Threads page
- Tighten Managed Agents copy around harness ownership

### Phase 3: Narrative reinforcement

- Publish a blog post or launch note on ThinkWork's view: memory belongs to the harness that runs the work
- Contrast ThinkWork with black-box hosted agent APIs without picking petty vendor fights
- Use real examples from threads, automations, and connectors rather than abstract memory talk

### Phase 4: Product surface alignment

- Align admin labels and onboarding copy to the new vocabulary
- Ensure docs screenshots and UI text do not reintroduce "Knowledge" as the dominant top-level term unless it specifically means documents
- Make future roadmap items, including graph work, subordinate to the main harness story

## Risks

### 1. Overcorrecting into abstraction

If the copy gets too philosophical, it will stop helping buyers understand what ships.

Mitigation: every high-level claim should tie back to current product primitives: threads, document knowledge, long-term memory, controls, AWS deployment.

### 2. Confusing users who expect knowledge base terminology

Some users search for RAG, knowledge base, and document retrieval.

Mitigation: keep **Document knowledge** explicit in docs and SEO-facing copy. Do not hide it, just place it under the broader Memory story.

### 3. Letting backend names dominate the narrative

AgentCore and Hindsight are useful proof, but if they lead the story, ThinkWork sounds dependent on vendors and interchangeable components.

Mitigation: put harness behavior first, backend configuration second.

### 4. Promising more than current retrieval orchestration supports

The market is moving fast, and memory language can easily outrun the shipped product.

Mitigation: say clearly that ThinkWork owns context assembly and memory behavior conceptually, while being explicit about the current implementation surface.

### 5. Losing the thread-centric advantage

If memory becomes the headline without threads, ThinkWork starts sounding generic.

Mitigation: pair memory with threads in major copy. The winning pair is not memory alone. It is **threads plus memory plus control**.

## Recommended final positioning

If ThinkWork needs one opinionated stance to carry through the site and docs, it should be this:

**ThinkWork is the harness for AI work. Threads are the system of record. Memory is how the harness carries useful context forward. Control keeps the whole thing auditable and owned inside your AWS account.**

That is stronger than a feature story, more durable than a backend story, and more specific than generic memory-platform hype.

## Appendix: example copy blocks

### 1. Homepage Memory card

**Memory**
The context layer for AI work. ThinkWork carries forward what matters from thread history, documents, and retained memories in the same harness that runs your agents.

### 2. Memory overview intro

ThinkWork memory is not a detached add-on. It is the part of the harness that turns prior work into usable context. Threads keep the full record. Memory carries forward the parts that matter for the next turn.

### 3. Threads page bridge line

Threads are where work lives. Memory is how useful parts of that work show up again later.

### 4. Short product blurb

ThinkWork gives you a thread-native harness for AI work. It keeps the record, carries context forward, and lets you control how agents use memory inside your own AWS account.
