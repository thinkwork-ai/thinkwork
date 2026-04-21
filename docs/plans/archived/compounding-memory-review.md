# Compounding Memory Review

## Purpose

This is the running review document for the **Compounding Memory / Company Second Brain** concept.

It is not the implementation spec and not the polished product PRD. It is the living review artifact where we capture the strongest explanations, product language, architectural distinctions, and decision-quality takeaways that emerge during review sessions.

Use this to:
- sharpen messaging
- preserve the best conceptual summaries
- strengthen the product doc
- carry review insight forward without rereading full chats

Update this after each review session.

---

## Current core framing

### Product framing
- **Compounding Memory**
- **Company Second Brain**

### Technical framing
- **Compiled Memory Layer**
- **Wiki compiler** as an implementation pattern, not the main product story

### Core product idea
ThinkWork should not stop at memory retention. It should turn retained memory into **durable, readable, inspectable, compounding knowledge**.

The memory engine helps the system remember.
The compiled memory layer helps the company understand.

---

## Architectural stance

ThinkWork should have three distinct layers:

1. **Raw operational history**  
   Threads, messages, tool calls, artifacts, approvals, external events.

2. **Canonical memory warehouse**  
   ThinkWork-owned normalized memory contract, backed by one selected memory engine per deployment. In v1, this is **Hindsight-backed**.

3. **Compiled knowledge layer**  
   Entity, topic, and decision pages synthesized from normalized memory records.

### Clean stack
- **Aurora** = canonical app/work record + compiled pages
- **Hindsight** = canonical long-term memory warehouse in v1
- **AgentCore Memory** = alternative backend behind the same adapter contract, not a parallel truth
- **S3** = artifacts, exports, markdown vaults

### Non-negotiable guardrails
- canonical memory remains canonical
- compiled memory is downstream and rebuildable
- markdown is export, not operational truth
- the system must not silently turn generated prose into truth

---

## Best concise explanation so far

Raw history tells you **what happened**.
The warehouse tells you **what should be remembered**.
Compiled pages tell you **what we know overall**.

That is the core architecture.

---

## Running section summaries

### Section 1 — Raw inputs, events, and source data
The first big call is that compounding memory should start from **work**, not just chat. ThinkWork should look at messages, tool outputs, documents, approvals, state changes, and other meaningful artifacts, because that is where durable understanding actually comes from. But the compiler should not read transcript text directly as its main substrate. Raw transcripts are too noisy. The right flow is: **raw events -> retained normalized memory records -> compiled knowledge**. That keeps the compiler focused on knowledge formation instead of cleanup.

### Section 2 — What belongs in the canonical memory warehouse
The warehouse should contain **durable memory units**, not polished summaries and not finished pages. It is the layer that holds what was worth remembering in a form that is attributable, replayable, and rebuildable. Facts, preferences, experiences, observations, entity fragments, decisions, and unresolved mentions belong here. Finished wiki pages, giant fuzzy context blobs, and nice-sounding AI prose do not. The clearest line we found is: **the warehouse is the ingredients, the compiled layer is the dish**.

### Section 3 — Normalized memory record shapes and categories
This section clarified that there are really **two type systems** in the architecture. In the warehouse, ThinkWork should use a small set of canonical record types: EventFact, PreferenceOrConstraint, Experience, Observation, EntityProfileFragment, DecisionRecord, and UnresolvedMention. In the compiled layer, v1 should only have three page types: Entity, Topic, and Decision. That distinction matters because it keeps the warehouse from collapsing into the compiled layer. A topic is **not** a warehouse record type. It is a compiled page type. The strongest takeaway here is that **DecisionRecord** and **UnresolvedMention** do a lot of heavy lifting. They keep the system from becoming either forgetful or noisy.

### Section 4 — The compounding job stages
The pipeline should be a **staged system**, not one giant prompt. The shape we landed on is: raw event capture, retention into canonical memory, candidate selection, page-target planning, section-level compilation, link and alias resolution, quality checks, then export and serving. The point of staging it this way is to preserve separation of concerns. Retention decides what is worth remembering. Planning decides where knowledge should land. Compilation decides how pages change. Quality control decides whether the result is good enough to keep. If those blur together, the whole system turns into magic sludge.

### Section 5 — How page targets are chosen
This is one of the most important product decisions in the whole design. When a new memory arrives, the system needs to decide whether to update an existing page, create a new one, hold it in staging, or promote it later. The v1 page model stays intentionally tight: entity, topic, and decision. The most important mechanic here is the middle state between **"ignore this"** and **"make a page right now."** That middle state is **unresolved mentions / staging**. Without it, the system is forced into a bad tradeoff between losing emerging signal and creating clutter too early. This is one of the strongest product ideas in the entire concept.

### Section 6 — Merge/update logic vs create/promote logic
The knowledge lifecycle should be asymmetric. The system should be fairly willing to improve good existing pages, more cautious about creating new durable objects, and even stricter about promotion. In short: **updating should be easier than creating, and creating should be easier than promoting**. That bias creates compaction over proliferation. It is how the second brain gets richer over time without bloating into page sprawl.

### Section 7 — What can leverage Hindsight and what ThinkWork must own
This section draws the boundary that keeps us from accidentally outsourcing the product. Hindsight should be treated as the **memory substrate**. It is good at retain-time extraction, recall, observation formation, evidence-grounded retrieval, and temporal support. But when the question becomes "should this update a customer page, create a topic page, or stay unresolved?" we are no longer asking a memory-engine question. We are asking a **ThinkWork product question**. Hindsight can help the system remember. ThinkWork has to decide what that memory becomes.

### Section 8 — Reflection vs compilation
Reflection and compilation are not the same kind of intelligence. Reflection is query-time synthesis: look at memory and answer well right now. Compilation is durable knowledge formation: decide what deserves a lasting home and how it should evolve over time. Reflection can make the system sound smart in the moment. Compilation is what makes the system actually **become smarter over time**. That is why reflect alone is not enough. It can help draft, summarize, or evaluate evidence, but it does not by itself create a governed, rebuildable, compounding second brain.

### Section 9 — Compounding quality controls and governance
This section is about how to keep the second brain from turning into confident garbage. The main idea is that quality controls are not a cleanup pass, they are part of the architecture. Every compiled section needs evidence and provenance. Scope discipline has to be strict. Raw transcript text should not jump straight into compiled knowledge. Unknown signals should go into unresolved mentions, not uncontrolled stub pages. Section-level patching is preferred over whole-page rewrites because it makes drift easier to spot and trust easier to maintain. Stronger thresholds should be required for create and promote than for reinforce and update. Staleness and supersession markers matter because the system should not pretend old knowledge is eternally current. And finally, operator inspectability is non-negotiable. The strongest line from this section is: **the second brain should be harder to add to than it is to read from**.

### Section 10 — Batch cadence, triggers, replay, and rebuild story
This section explains how the pipeline should run over time. The right default is incremental compounding: process what changed since the last cursor, not full rebuilds on every turn. Nearline triggers keep the compiled layer fresh, while nightly maintenance handles linting, alias cleanup, stale-page checks, promotion checks, and exports. Manual admin triggers matter because operators need a way to force compiles, debug odd cases, or replay specific scopes. Replay matters because the compiler should be able to re-run over canonical memory after logic changes. Rebuild matters because the compiled layer is only trustworthy if it can be regenerated from the warehouse. The strongest takeaway is that **rebuildability is part of the product’s trust model, not just an engineering convenience**.

### Section 11 — Recommended v1 pipeline vs later evolutions
This section is the discipline section. v1 should be small, opinionated, and rebuildable. The goal is not to ship a grand unified memory platform on day one. The goal is to prove the compounding loop. In v1, raw operational history flows into normalized memory, the ThinkWork compiler reads changed records, maps them to entity/topic/decision targets, patches compiled pages in Aurora, and exports markdown on cadence. Agents read the compiled layer through explicit tools rather than always-on injection. If that works, then later evolutions like richer claims models, graph traversal, knowledge packages, selective auto-injection, and procedural memory extraction can be added on top. The strongest takeaway is: **v1 should prove the compounding loop, not try to finish the whole vision**.

---

## Enrichment stance

The pipeline should support enrichment, but through a **controlled enrichment step**, not random agent browsing.

### External research
Use for prospects and broader context.
Treat as **contextual evidence**, not first-party truth.

### Internal operational systems
ERP, CRM, ticketing, product usage, contract systems are different.
Treat as **authoritative enrichment**.

Important rule:
Enrichment should first become **evidence**, not page text.
Then evidence may become memory, and memory may become compiled knowledge.

Concise rule:
- **external research = contextual enrichment**
- **ERP/CRM/product data = authoritative enrichment**

---

## Hindsight stance

Hindsight is valuable, but it is not the whole compounding engine.

### Hindsight is good for
- retain-time extraction
- recall
- observation formation
- evidence-grounded retrieval
- temporal memory support
- reflection as a helper

### Hindsight is not enough for
- page target selection
- merge/create/promote policy
- page lifecycle rules
- section-level patching
- unresolved mention handling
- export model
- governance model
- product-facing compiled knowledge behavior

Strong line:
**Use Hindsight to help remember. Use ThinkWork to decide what that memory becomes.**

### Reflection vs compilation
Reflection is query-time synthesis.
Compilation is durable knowledge materialization.

Reflection helps, but it is not enough by itself.

---

## Orchestration stance

The compounding pipeline is **state-machine-shaped**, but v1 should **not** start with Step Functions.

Recommended v1:
- Aurora job table
- post-turn enqueue
- worker Lambda claims and runs stages
- separate nightly jobs for lint/export if needed

Step Functions can come later if branching, retries, resumability, or observability become painful.

Strong line:
Start simpler than Step Functions. Keep the door open for them later.

---

## Best messaging lines worth reusing

- ThinkWork should not stop at memory retention. It should turn retained memory into **durable, readable, inspectable, compounding knowledge**.
- The memory engine helps the system remember. The compiled memory layer helps the company understand.
- ThinkWork is not just building memory for agents. It is building the layer that turns work into **compounding organizational intelligence**.
- The system needs a middle state between **"ignore this"** and **"make a page right now."**
- The warehouse is the ingredients. The compiled layer is the dish.
- Use Hindsight to help remember. Use ThinkWork to decide what that memory becomes.

---

## Open threads for next review sessions

- exact normalized record schema
- enrichment policy and source registry design
- timeline behavior vs general page behavior
- confidence/supersession strategy for later versions
- when compiled knowledge should be retained vs fetched live
- how this gets translated into outward-facing product messaging and visuals

---

## Review log

### 2026-04-18 — Session 1
Main outcomes:
- reviewed and summarized Sections 1 through 11 in human-readable form
- split product framing from engineering framing
- clarified warehouse vs compiled layer distinction
- reinforced Hindsight-as-substrate, not full compounding engine
- identified unresolved mentions as a critical product mechanic
- clarified that v1 should start with Lambda + job table, not Step Functions
- captured enrichment stance: controlled, policy-driven, evidence-first
