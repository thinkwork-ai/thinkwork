# Compounding Memory, Company Second Brain

## Executive Summary

ThinkWork should introduce a **compiled memory layer** that sits above the existing long-term memory system.

This gives us something more valuable than raw recall. It gives the company a **second brain**: a durable, readable, continuously improving knowledge surface built from the work already happening in ThinkWork.

The core idea is simple:

1. **Threads and work history** capture what happened.
2. **The memory engine** retains structured durable memory.
3. **Compiled memory** turns those retained records into higher-level pages about people, topics, and decisions.
4. **Agents and product surfaces** can then read from that compiled layer to answer better, with more continuity and less fragmentation.

This is not a replacement for the memory engine. It is a downstream layer that makes retained knowledge more useful, more inspectable, and more compounding over time.

## The product idea

The product framing should be:

- **Compounding Memory**
- **Company Second Brain**

Those names describe the actual value:

- the system gets better as more work flows through it
- the organization accumulates reusable understanding, not just logs
- agents can operate with continuity across time, not only immediate context windows

"Wiki" is a helpful implementation metaphor, but it should not be the primary product story. The important thing is not markdown pages. The important thing is that ThinkWork can continuously compile organizational knowledge out of day-to-day work.

## Memory engine vs. compiled memory

These are different layers and should stay different.

### Memory engine
The memory engine is the canonical durable recall layer.

Its job is to answer questions like:
- what happened?
- what has this user mentioned before?
- what changed recently?
- what memory fragments are relevant right now?

In ThinkWork, this is the normalized memory plane, backed by one selected engine per deployment, currently **Hindsight** and later also **AgentCore Memory**.

### Compiled memory
Compiled memory is the higher-level synthesized layer.

Its job is to answer questions like:
- what do we know about this person, topic, or decision overall?
- what has accumulated over time across many turns and records?
- what are the durable patterns, constraints, and conclusions?

This layer is:
- **downstream** of the memory engine
- **rebuildable** from canonical retained memory
- **inspectable** by humans and agents
- **portable** through markdown export

The memory engine stores retained facts and fragments. Compiled memory turns those into coherent knowledge surfaces.

## Why this matters now

Several adjacent trends are converging:

- persistent memory systems are becoming table stakes for serious agent products
- compiled, cross-linked knowledge views are proving useful in practice
- teams increasingly want reusable organizational intelligence, not just chat transcripts and retrieval APIs
- context windows are growing, but they still do not solve long-term accumulation, inspectability, or organizational continuity

This is the right moment for ThinkWork to define the stack clearly.

If we stop at memory retention, we get better recall.
If we add compiled memory, we get a product that **learns in a structured way**.

That distinction matters strategically.

## Product vision

ThinkWork should become the system where work leaves behind reusable intelligence.

Not just:
- chats
- notes
- extracted memories
- fragmented retrieval

But instead:
- living topic pages
- shared entity pages
- durable decision records
- linked knowledge that improves future work

Over time, this becomes a company second brain that compounds in value rather than decaying into history.

## Design principles

These principles are load-bearing.

- **Canonical memory stays canonical.**
- **Compiled memory is downstream and rebuildable.**
- **The system never treats generated text as truth just because it sounds polished.**
- **Provenance matters.** Compiled knowledge should stay grounded in retained records.
- **Exportability matters.** Markdown export is important for portability, even if it is not the primary operational store.
- **Product value comes from coherence and continuity, not from auto-generating more text.**
- **The system needs a middle state between "ignore this" and "make a page right now."** That middle state is unresolved mentions / staging.

## Goals for v1

- Create a compiled memory layer above the normalized memory plane.
- Produce readable, durable pages for the most important recurring knowledge types.
- Make those pages available to agents and product surfaces through a clean read path.
- Preserve clear separation between canonical memory and compiled knowledge.
- Support tenant-shared understanding where appropriate, especially for entities.
- Export the compiled layer as markdown so customers retain portability and inspectability.

## What should exist in v1

v1 should focus on three page types:

- **Entity pages** for shared real-world people or organizations
- **Topic pages** for recurring subjects
- **Decision pages** for accepted decisions and rationale

This is enough to prove whether compiled memory improves continuity and answer quality without overbuilding the ontology.

## Why unresolved mentions matter

This is one of the most important product mechanics in the whole design.

The system needs a middle state between:
- **ignore this**
- **make a page right now**

That middle state is **unresolved mentions** (or staging).

When the system sees a weak, ambiguous, or not-yet-durable mention, it should keep it in a holding area instead of either discarding it or eagerly creating a new page. That does two important things at once:

- it prevents real signal from being lost too early
- it prevents the second brain from filling up with premature clutter

Without this middle state, the system is forced into a bad tradeoff:
- be too conservative and miss emerging knowledge
- or be too eager and create page spam

This is especially important for product trust. A company second brain should feel like it is accumulating judgment, not just spraying new notes everywhere.

## Non-goals for v1

- replacing Hindsight or the selected memory engine
- making markdown the source of truth
- storing every agent answer in the compiled layer
- building a full confidence and claims system up front
- introducing new search infrastructure beyond what is needed
- automatic always-on wiki injection into every turn
- human markdown editing as the primary workflow

Especially important: **v1 should not absorb every model-generated answer into the second brain**. That would compound noise instead of knowledge.

## What should compound

The system should only compound higher-signal knowledge such as:

- recurring topics
- durable entities
- accepted decisions
- validated syntheses
- stable patterns and learnings

That keeps the second brain useful instead of turning it into a polished junk drawer.

## User and business value

If this works, ThinkWork gets several strategic benefits:

### Better agent answers
Agents can answer with more coherence because they can read synthesized knowledge, not only fragments.

### Better continuity across time
Knowledge compounds beyond a single thread or session.

### Better shared understanding
Entity pages can become shared tenant-level context rather than being trapped in one user’s thread history.

### Better inspectability
Operators can inspect what the system believes, how it is organizing knowledge, and what needs refinement.

### Better portability
Customers get a durable markdown export, which improves trust and reduces lock-in concerns.

## Product risks to manage

The main risks are not technical novelty. They are quality and trust.

### Risk: AI sludge
If the system stores too much generated output, quality decays quickly.

### Risk: false authority
Compiled pages can look more trustworthy than the evidence behind them.

### Risk: ontology sprawl
Too many page types or automatic stubs would create clutter instead of clarity.

The key mitigation is unresolved mentions / staging. The product should not jump directly from mention to page creation unless the evidence is strong enough.

### Risk: architectural confusion
If compiled memory starts competing with the canonical memory plane, the system becomes harder to reason about and harder to trust.

## Success criteria

v1 is successful if we can show:

- compiled pages are materially more coherent than raw memory fragments
- agents give better answers when using the compiled layer
- the architecture remains clearly downstream and rebuildable
- operators can inspect and export the resulting knowledge
- quality stays high enough that the system feels like an asset, not a liability

## Recommended framing for leadership

ThinkWork is not just building memory for agents.

ThinkWork is building the layer that turns work into **compounding organizational intelligence**.

The memory engine helps the system remember.
The compiled memory layer helps the company understand.

That is the product move.