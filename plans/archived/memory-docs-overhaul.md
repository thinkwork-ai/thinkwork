# PRD: Memory Docs Overhaul

**Status:** Draft
**Owner:** Eric Odom
**Last updated:** 2026-04-12

---

## 1. Summary

ThinkWork's docs should tell one clean, durable story about context:

1. **Threads are the full record of work.**
2. **Memory is the harness-owned context layer that decides what from that record, plus other sources, gets surfaced into a turn.**
3. **Backends like Bedrock Knowledge Bases, AgentCore Memory, and Hindsight are implementation choices under that contract, not the conceptual center of the story.**

Today the docs are directionally close, but they still wobble between three frames:
- memory as a product concept,
- memory as a list of AWS-backed features,
- and knowledge as a sibling concept that sometimes sits inside memory and sometimes outside it.

This PRD proposes a documentation overhaul that makes the contract stable even if memory backends change later.

---

## 2. Problem

The current Memory docs are better than a generic RAG story, but they still have structural inconsistencies that make the mental model feel less crisp than the Threads docs.

The biggest issue is this: the docs often say the right thing, then immediately revert to backend-first explanations.

That creates three risks:
- readers confuse **thread history** with **memory**,
- readers confuse **memory** with **long-term memory only**,
- readers treat **AgentCore/Hindsight/Knowledge Bases** as the conceptual model instead of the current implementation.

The result is a docs section that is truthful in pieces, but not yet organized around one memorable, reusable story.

---

## 3. Goals

- Make the Memory docs read as one coherent product narrative.
- Establish a stable conceptual contract that survives backend changes.
- Keep ThinkWork honest about what is shipped now versus what is still roadmap.
- Clarify the relationship between threads, memory, retrieval, document knowledge, and optional backend choices.
- Reduce duplicate backend explanations spread across concepts pages.
- Give readers a recommended reading order that starts from product truth, not implementation detail.

---

## 4. Non-goals

- No low-level implementation plan for the runtime.
- No rewrite of the actual platform architecture.
- No commitment to a new memory engine or knowledge graph design.
- No attempt to fully document every retrieval heuristic unless the product surface actually exposes it.

---

## 5. Desired narrative

This should be the default story everywhere in docs:

### 5.1 Core story

- **Threads** are the canonical record of work.
- **Memory** is the harness-owned context layer that selects, recalls, and assembles useful context for the current turn.
- **Agents** act on the current turn using that assembled context.

### 5.2 What memory includes

Memory is not just one store.

It is the **context layer** across:
- selected thread history,
- document retrieval,
- retained cross-thread memories,
- and any future structured memory or graph-backed retrieval.

### 5.3 What memory does not mean

Memory is **not**:
- the full work record,
- a synonym for long-term memory only,
- or a promise that every backend is equally central to the product.

### 5.4 Backend framing

After the conceptual story is clear, docs can explain the current implementations:
- **Default shipped story:** thread history + document retrieval + AgentCore managed memory.
- **Optional add-on story:** Hindsight adds extra memory behavior alongside the default managed memory path.
- **Roadmap story:** knowledge graph / structured memory is future direction, not current product surface.

This order matters. Product contract first, backend second.

---

## 6. Current-state critique

### 6.1 README.md

**What works**
- Strong top-level line: "Threads run the work".
- "Knowledge Bases backed by Bedrock" is honest and concrete.
- Roadmap honesty is good.

**What is weak**
- README names "Knowledge" as a product module but does not anchor it to the thread/memory contract.
- It does not clearly say that threads are the full work record and memory is a selective context layer.
- It introduces Knowledge Bases as a shipped feature without explaining whether that is the concept or one backend.

**Required change**
- Add a short conceptual sentence in the What ships / positioning copy that says threads are the durable record and memory/knowledge features are the context layer.

### 6.2 docs/src/content/docs/index.mdx

**What works**
- The reading order already starts with Threads.

**What is weak**
- The Memory card says it is "the umbrella for document knowledge, long-term memory, retrieval context, and the emerging knowledge graph direction."
- That is close, but still sounds like a bucket of features rather than a product contract.

**Required change**
- Rephrase the card to describe Memory as the context layer that sits between threads and agents.

### 6.3 docs/src/content/docs/architecture.mdx

**What works**
- This is currently the clearest articulation of the high-level model.
- "Threads are the record of work" and "Memory surfaces useful context into a turn" is the right framing.

**What is weak**
- The architecture page currently carries some of the best memory explanation, which means the concepts section is not fully owning its own story.
- The "Where state lives" table includes "Memories (managed) | Aurora Postgres", which may overstate storage certainty or at minimum muddy the managed-memory story.
- The page mixes conceptual model and AWS mapping before the Memory docs have fully stabilized the contract.

**Required change**
- Keep architecture as a concise summary page, but move the canonical memory contract to the Concepts section and link to it.
- Audit any storage wording that implies details the open-source product docs do not need to assert so strongly.

### 6.4 docs/src/content/docs/concepts/knowledge.mdx

**What works**
- The page explicitly says threads keep the full record and memory decides what context gets surfaced.
- It tries to separate threads, memory, and agents.

**What is weak**
- The page title is "Memory" but the path is `/concepts/knowledge/`, which leaks an older taxonomy.
- The page says "Memory is the umbrella" while its cards split into Document Knowledge, Long-term Memory, Retrieval and Context, and Knowledge Graph Direction. That structure still teaches readers to think in feature buckets first.
- "AWS AgentCore LongTerm memory by default, plus Hindsight as an alternative memory engine" is inconsistent with `memory.mdx`, which says Hindsight runs alongside managed memory, not instead of it.
- The "Current reality" section is backend-heavy too early.

**Required change**
- Rewrite this page into the canonical conceptual overview.
- Stop describing Hindsight as an alternative engine on this page.
- Make this page define the memory contract first, then point to backend-specific pages second.
- Consider changing visible navigation/title language from "Knowledge" to "Memory & Context" while preserving URL if needed for stability.

### 6.5 docs/src/content/docs/concepts/knowledge/memory.mdx

**What works**
- Strong distinction between thread history and long-term memory.
- Good explanation that memory starts from what happened in threads.
- Good note that managed memory is always on and Hindsight is optional.

**What is weak**
- The page title "Long-term Memory" narrows the concept too quickly.
- It treats explicit tools like `remember()` / `recall()` as central before the docs establish the higher-level contract.
- It still reads partly like deployment behavior documentation rather than a product contract page.

**Required change**
- Recast this page as either:
  1. a backend-agnostic **Memory contract** page, or
  2. a backend-specific **Managed and optional memory backends** page.

Recommendation: split these concerns. The conceptual contract should move to a new page, and this page should become implementation-focused.

### 6.6 docs/src/content/docs/concepts/knowledge/retrieval-and-context.mdx

**What works**
- Correctly shows that turns are assembled from multiple context sources.
- Useful simple context formula.

**What is weak**
- This page currently does some of the work that a Memory contract page should own.
- "Memory provides retrieved context, including documents and long-term memory" is close, but still not crisp enough about harness ownership.
- The "Current reality" section again shifts into backend inventory.

**Required change**
- Keep this page focused on turn assembly mechanics.
- Remove most backend summary from here and link out.
- Make the page answer: "How does context get assembled for a turn?" not "Which memory products exist?"

### 6.7 docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx

**What works**
- Honest roadmap framing.
- Correctly warns users not to plan around this yet.

**What is weak**
- The page name suggests a product surface larger than what exists.
- The content is really a roadmap note, not a concept page on equal footing with current shipped concepts.

**Required change**
- Rename/reframe this page as a future-direction page, not a current core concept page.
- It should hang off the memory story as "future structured memory", not feel like a sibling to shipped pages.

### 6.8 docs/src/content/docs/concepts/knowledge/document-knowledge.mdx

**What works**
- Strong practical explanation of Bedrock Knowledge Bases.
- Good contrast: documents answer organizational knowledge, memory answers learned context.
- Good cost honesty.

**What is weak**
- The name "Document Knowledge" is understandable, but it continues the knowledge-vs-memory split in a way that makes the taxonomy feel unstable.
- This page is really about a current retrieval backend and content source, not a separate top-level concept.

**Required change**
- Keep the content, but frame it explicitly as the current document retrieval backend/source under the memory/context layer.

### 6.9 docs/src/content/docs/concepts/agents/managed-agents.mdx

**What works**
- Good separation note between knowledge and memory.

**What is weak**
- "Optional memory behavior" is misleading because AgentCore managed memory is described elsewhere as always on.
- The page says knowledge and memory are separate concepts, while other pages say memory is an umbrella for documents plus long-term memory.

**Required change**
- Update wording so the page does not contradict the new contract.
- Recommended wording: memory is always part of the managed-agent turn path; what is optional is additional memory configuration or optional add-ons.

### 6.10 docs/src/content/docs/roadmap.mdx

**What works**
- Honest distinction between stable, beta, and not-in-v1.
- Knowledge graph is clearly listed as not in v1.

**What is weak**
- The roadmap page is more honest about the knowledge graph than the concepts IA around it.

**Required change**
- Align the concepts IA so roadmap-only capabilities do not feel first-class in the same way as shipped concepts.

---

## 7. Key inconsistencies to resolve

These are the specific inconsistencies the overhaul must fix.

1. **Hindsight is described as an alternative engine in `knowledge.mdx`, but as an add-on alongside managed memory in `memory.mdx` and deploy docs.**
   - Correct answer: docs should consistently describe Hindsight as an optional add-on alongside the default managed memory story.

2. **Memory is sometimes the umbrella for documents + long-term memory, while elsewhere knowledge and memory are described as separate concepts.**
   - Correct answer: document retrieval belongs inside the broader context layer story. "Knowledge" may remain as legacy navigation language, but the docs should make clear that it is a content-source/backend slice inside the memory/context layer.

3. **Some pages say threads are the record of work, but other pages still read as if memory is where prior work lives.**
   - Correct answer: threads are always the full record; memory is always selective carry-forward and retrieval.

4. **The Concepts section is backend-heavy, while the Architecture page currently carries cleaner conceptual framing.**
   - Correct answer: the Concepts section should own the contract, and Architecture should summarize it.

5. **Knowledge Graph is placed like a core shipped concept even though docs correctly say it is roadmap.**
   - Correct answer: demote it to a future-direction note under memory/context.

6. **Managed agents describe memory as optional behavior even though managed memory is documented as always on.**
   - Correct answer: optionality should refer only to additional configuration or add-ons, not to the existence of memory as part of the turn path.

---

## 8. Proposed information architecture

### 8.1 Principle

Organize the docs by **product truth first**, then by **current implementation choices**.

### 8.2 Recommended IA

Keep the current `/concepts/knowledge/` URL family if changing URLs is costly, but change the visible story and page structure.

#### Concepts nav label
- **Current:** Knowledge
- **Recommended:** Memory & Context

If nav label changes are expensive right now, keep the URL slug but change page titles and descriptions immediately.

#### Proposed page map

1. **Overview page**
   - Path: `/concepts/knowledge/`
   - New title: **Memory & Context**
   - Purpose: canonical conceptual overview

2. **New page**
   - Path: `/concepts/knowledge/memory-contract/`
   - Title: **Memory Contract**
   - Purpose: define exactly what memory means in ThinkWork

3. **Rename / rewrite existing `memory.mdx`**
   - Current title: Long-term Memory
   - New title: **Managed Memory and Backends**
   - Purpose: explain AgentCore managed memory as the default shipped behavior and Hindsight as an optional add-on

4. **Rewrite existing `document-knowledge.mdx`**
   - New title: **Document Retrieval**
   - Purpose: explain uploaded documents + Bedrock Knowledge Bases as a current retrieval source/backend

5. **Keep existing `retrieval-and-context.mdx`, but tighten scope**
   - Title may stay **Retrieval and Context**
   - Purpose: how a turn gets assembled from sources

6. **Rename / reframe existing `knowledge-graph.mdx`**
   - New title: **Structured Memory (Future Direction)**
   - Purpose: roadmap note only

### 8.3 Recommended reading order

1. Threads
2. Memory & Context overview
3. Memory Contract
4. Retrieval and Context
5. Document Retrieval
6. Managed Memory and Backends
7. Structured Memory (Future Direction)

This makes the product contract legible before readers hit AWS- or backend-specific detail.

---

## 9. Specific page changes

### 9.1 `README.md`

**Change**
- Add one short paragraph in the opening section or "What ships in v1" area:
  - Threads are the durable record of work.
  - Memory/context features surface useful information into each turn.
  - Knowledge Bases and managed memory are current implementations of that context layer.

**Why**
- The repo landing page should reinforce the same core story as the docs.

### 9.2 `docs/src/content/docs/index.mdx`

**Change**
- Rewrite the Memory card copy to say:
  - Memory is the context layer between threads and agents.
  - It includes selected thread history, document retrieval, retained memory, and future structured context.

**Why**
- Home page cards set the taxonomy for the whole docs site.

### 9.3 `docs/src/content/docs/architecture.mdx`

**Change**
- Keep the conceptual model section, but shorten repeated backend detail.
- Link explicitly to the new Memory Contract page as the canonical definition.
- Audit storage/state claims for managed memory so docs do not over-assert hidden implementation details unless verified and necessary.

**Why**
- Architecture should summarize, not be the primary place where the memory story becomes clear.

### 9.4 `docs/src/content/docs/concepts/knowledge.mdx`

**Rewrite goal**
- Make this the one page a new reader can read to understand the whole context model.

**Must include**
- Threads are the complete work record.
- Memory is the harness-owned context layer.
- Agents consume assembled context, they do not own it.
- Backends are current implementations of pieces of that layer.

**Must remove or change**
- Remove "Hindsight as an alternative memory engine".
- Reduce backend inventory in the top half of the page.

### 9.5 `docs/src/content/docs/concepts/knowledge/memory.mdx`

**Rewrite/rename goal**
- Stop making this page carry the full conceptual burden.
- Turn it into a "current implementation" page for managed memory and optional add-ons.

**Must include**
- Default shipped behavior: AgentCore managed memory is always on.
- Hindsight is optional and additive.
- Explicit tools and strategies are implementation details under the broader memory contract.

### 9.6 `docs/src/content/docs/concepts/knowledge/retrieval-and-context.mdx`

**Rewrite goal**
- Make this page operational/mechanical.

**Must include**
- How current message, selected history, documents, retained memory, tools, and policy context combine into a turn.
- The harness owns assembly.
- The mix may vary by template/config.

**Must remove or reduce**
- Repeated backend inventory language that belongs on backend pages.

### 9.7 `docs/src/content/docs/concepts/knowledge/document-knowledge.mdx`

**Rewrite/rename goal**
- Frame this page as the current document retrieval source, not a competing top-level concept.

**Must include**
- Uploaded docs become retrievable context.
- Bedrock Knowledge Bases are the current shipped implementation.
- Cost and operational notes remain.

### 9.8 `docs/src/content/docs/concepts/knowledge/knowledge-graph.mdx`

**Rewrite/rename goal**
- Demote to roadmap framing.

**Must include**
- This is future structured memory direction.
- Not in v1.
- Readers should plan around threads + current memory/context + document retrieval today.

### 9.9 `docs/src/content/docs/concepts/agents/managed-agents.mdx`

**Change**
- Replace "Optional memory behavior" with wording that distinguishes:
  - always-present memory/context path,
  - optional memory add-ons or tuning.

**Why**
- Prevent contradiction with deploy/configuration and memory docs.

### 9.10 `docs/src/content/docs/deploy/configuration.mdx`

**Change**
- Keep the deploy truth mostly as-is.
- Add one sentence linking to the new Memory Contract page for conceptual framing.

**Why**
- Deployment docs should not become the main conceptual explainer.

---

## 10. Proposed new page: Memory Contract

### 10.1 Why this page should exist

Right now the conceptual definition of memory is spread across:
- `architecture.mdx`
- `knowledge.mdx`
- `memory.mdx`
- `retrieval-and-context.mdx`

That makes the docs harder to trust because no single page is clearly authoritative.

A dedicated **Memory Contract** page fixes that.

### 10.2 What this page should define

The page should answer five questions clearly:

1. **What is memory in ThinkWork?**
   - The harness-owned context layer for assembling useful context into a turn.

2. **What is not memory?**
   - Not the full work record. Threads are.

3. **What inputs can feed memory/context?**
   - Selected thread history, document retrieval, retained memory, future structured retrieval.

4. **Who owns the behavior?**
   - The ThinkWork harness/runtime, not the agent prompt alone.

5. **Where do backends fit?**
   - Backends implement parts of the contract; they do not define the concept.

### 10.3 Suggested outline

- Memory contract in one paragraph
- Threads versus memory
- Memory versus document retrieval
- Memory versus long-term memory
- What the harness assembles into a turn
- Current shipped backends
- What is roadmap only
- Links to deeper implementation pages

---

## 11. Default story versus optional backend story

This distinction must be explicit everywhere.

### 11.1 Default shipped story

For a reader deploying ThinkWork today, the default story should be:

- work lands in threads,
- the harness selects relevant thread history,
- uploaded documents can be retrieved through Bedrock Knowledge Bases,
- AgentCore managed memory is always on for retained context,
- the current turn is assembled from those sources.

This is the default mental model and should be the first thing every reader learns.

### 11.2 Optional backend story

Optional backend language should come later:

- Hindsight can be enabled as an additional memory backend/add-on,
- it adds explicit retain/recall/reflect behavior and richer retrieval options,
- it does not replace the conceptual contract,
- and it should not be presented as equally central to every deployment.

### 11.3 Roadmap story

Roadmap-only language should be clearly separated:

- structured memory / knowledge graph is future direction,
- not in v1,
- not a required part of understanding current ThinkWork.

---

## 12. Content guidelines for all affected docs

### 12.1 Use this terminology consistently

Preferred terms:
- **Threads are the full record of work**
- **Memory is the context layer**
- **The harness assembles context**
- **Document retrieval** instead of implying documents are a separate conceptual universe
- **Managed memory** for current default implementation
- **Optional add-on** for Hindsight
- **Future direction** for structured memory / graph

### 12.2 Avoid these patterns

- Do not describe Hindsight as an alternative to managed memory unless that is truly how the shipped product behaves.
- Do not imply thread history and memory are interchangeable.
- Do not make roadmap pages look like equal peers of shipped product pages.
- Do not let deploy docs carry conceptual burden that belongs in Concepts.
- Do not use "knowledge" and "memory" as unstable sibling concepts without clarifying the relationship.

### 12.3 Writing style rules

- Concept pages should start with product truth, not AWS components.
- Backend names should appear after the concept is established.
- If a capability is roadmap-only, say so in the first screenful.
- If a behavior is always on, do not label it optional elsewhere.
- Favor one-sentence distinctions, for example:
  - Threads preserve everything.
  - Memory carries forward what matters.

---

## 13. Migration plan

### Phase 1: Establish the canonical contract

- Rewrite `concepts/knowledge.mdx` into **Memory & Context** overview.
- Create the new **Memory Contract** page.
- Update docs home card copy and README summary language.

### Phase 2: Re-scope the implementation pages

- Rewrite `memory.mdx` into **Managed Memory and Backends**.
- Rewrite `document-knowledge.mdx` into **Document Retrieval**.
- Tighten `retrieval-and-context.mdx` to turn assembly only.

### Phase 3: Demote roadmap material appropriately

- Rewrite `knowledge-graph.mdx` into **Structured Memory (Future Direction)**.
- Cross-link to `roadmap.mdx` for roadmap truth.

### Phase 4: Sweep for consistency

- Update `architecture.mdx`, `managed-agents.mdx`, deploy docs, getting started, and any nav/sidebar copy.
- Search for these phrases and fix them everywhere:
  - "alternative memory engine"
  - "optional memory behavior"
  - unstable uses of knowledge vs memory

### Phase 5: QA pass

- Read the docs in this order: index → Threads → Memory overview → Memory Contract → Retrieval and Context → Document Retrieval → Managed Memory and Backends → Architecture.
- Confirm the same story holds across every page without contradiction.

---

## 14. Acceptance criteria

This overhaul is complete when all of the following are true:

1. A new reader can explain ThinkWork's context model in one sentence:
   - threads are the record, memory is the context layer, agents act on assembled context.

2. No page in Concepts describes Hindsight as replacing the default managed memory path unless product behavior changes to make that true.

3. No page implies that memory is the full historical record of work.

4. The Memory overview page is conceptual first, backend second.

5. There is one clearly authoritative page defining the Memory contract.

6. The Retrieval and Context page focuses on turn assembly, not backend inventory.

7. The document retrieval page clearly explains Bedrock Knowledge Bases as the current implementation, not the whole concept.

8. The knowledge graph page is unmistakably roadmap/future direction.

9. Managed Agents no longer calls memory optional in a way that contradicts always-on managed memory.

10. README and docs home reinforce the same core story as the Concepts section.

11. The docs are honest about shipped versus roadmap:
   - shipped: threads, document retrieval, managed memory, optional Hindsight add-on,
   - roadmap: structured memory / knowledge graph.

---

## 15. Risks

- The biggest risk is keeping the old `/knowledge/` taxonomy while trying to tell a memory-first story. That is acceptable short-term, but the visible labels must compensate.
- Another risk is over-correcting into abstraction and losing the concrete AWS-backed story. The fix is not to hide implementation, only to put it second.
- A third risk is asserting implementation details too strongly in architecture/storage docs when the real product promise is conceptual, not backend-internal.

---

## 16. Bottom line

The docs should stop teaching Memory as a pile of features and start teaching it as a stable contract.

The contract is simple:
- **Threads keep the full work record.**
- **Memory is the harness-owned context layer.**
- **Backends implement that layer.**

If the docs hold that line consistently, ThinkWork can keep evolving its memory backends without rewriting the product story every time.
