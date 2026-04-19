# ThinkWork Memory Compounding Pipeline Deep Dive

## Executive summary

This document defines the actual compounding pipeline for ThinkWork memory, from raw interaction exhaust through normalized warehouse records into compiled higher-order knowledge.

The core architectural position is:

1. **Threads, events, and source artifacts** are the raw operational stream.
2. **Hindsight-backed normalized memory** is the canonical memory warehouse in v1.
3. **ThinkWork compounding** is a downstream compiler that turns canonical memory into durable pages, entities, decisions, and synthesized knowledge.
4. **Aurora is the primary operational store for compiled knowledge**, with markdown export as a portability layer.

This is deliberately not "just use Hindsight reflect" and not "just build a wiki." Hindsight is a strong substrate for retain, recall, and evidence-grounded observation formation. But ThinkWork still needs its own opinionated compounding pipeline to decide what becomes tenant knowledge, how pages are updated, how scope works, how rebuilds work, and how product-facing compiled knowledge is governed.

## Why this document exists

The other docs establish the product framing and implementation direction. This document is the meat of the process.

It answers:

- what enters the warehouse
- what the canonical memory record should look like
- how compounding jobs operate
- how page targets are chosen
- how updates differ from creates and promotions
- where Hindsight helps and where ThinkWork must own the logic
- why reflection is helpful but insufficient
- how we keep the compiled layer rebuildable and trustworthy

## Design stance

ThinkWork should adopt a warehouse-and-compiler architecture, not a monolithic memory blob.

The right mental model is closer to:

- **raw events** -> ingestion
- **canonical normalized memory warehouse** -> durable retained records
- **compounding jobs** -> materialized semantic projections
- **compiled pages and knowledge packages** -> agent and product read path

This aligns with three external patterns:

- **Hindsight**: separate retain, recall, and reflect; distinguish evidence from synthesized observations and beliefs
- **Karpathy / llm-wiki**: compiled knowledge beats re-deriving synthesis from raw retrieval on every query
- **Cloudflare Agent Memory**: compaction-aware ingestion and persistent memory are substrate concerns, not the whole knowledge product

GraphRAG and knowledge-packaging work are also useful here, but mainly as support for target selection, linking, and later richer retrieval. They are not the primary architecture.

## 1. Raw inputs, events, and source data

The compounding pipeline starts with raw operational inputs. These should be broader than chat turns.

### Primary raw sources

- user messages
- assistant messages
- tool calls and tool outputs
- task state transitions
- thread metadata
- uploaded documents and extracted passages
- notes, plans, briefs, PRDs, and work artifacts
- explicit user preferences
- accepted decisions and approvals
- contact, org, project, and account entities
- external system events that matter to ongoing work

### What should count as a source event

A source event should enter the pipeline if it changes durable understanding, not merely because it happened.

Good candidates:

- a user states a stable preference
- a project decision is made or revised
- a person, org, or project relationship becomes clearer
- a task outcome teaches something reusable
- multiple events together imply a higher-order pattern

Poor candidates:

- filler conversation
- one-off social niceties
- speculative assistant output without confirmation
- repeated restatements with no new evidence

### Opinionated rule

**Do not compile directly from transcript text as the main unit.** Compile from normalized memory records derived from transcript and artifact events. Raw transcripts are too noisy and too brittle as the direct substrate for compounding.

## 2. What belongs in the canonical memory warehouse

The canonical warehouse is the system-of-record for durable memory before compilation. In v1 that warehouse is ThinkWork's normalized memory contract backed by Hindsight.

The warehouse should contain retained memory records that are:

- attributable to a source
- scoped correctly
- deduplicable
- replayable
- good enough to rebuild the compiled layer from scratch

### Canonical warehouse contents

The warehouse should include:

- atomic facts and event facts
- experiential records from actual interactions
- extracted preferences and constraints
- observations that summarize repeated evidence
- entity references and aliases
- timestamps and recency markers
- provenance references back to source events/artifacts
- scope metadata: tenant, owner, shared vs private
- status metadata: active, stale, superseded, retracted

### What should not be canonical

The warehouse should not directly store:

- polished wiki prose as truth
- page layout decisions
- fully rendered markdown pages
- speculative joins with weak evidence
- arbitrary assistant summaries with no provenance

### Architectural line

**Canonical memory is normalized and evidence-oriented. Compiled memory is downstream and presentation-oriented.**

## 3. Normalized memory record shapes and categories

ThinkWork should use a small, explicit record taxonomy. Too many record types creates ontology drag. Too few loses useful distinctions.

## Recommended canonical record categories

### 3.1 EventFact

A concrete fact about something that happened.

Examples:

- user approved migration to Aurora
- customer meeting occurred on a given date
- project moved from draft to live

Suggested shape:

```ts
{
  id,
  recordType: "event_fact",
  tenantId,
  ownerId?,
  subjectRefs: [entityRef | topicRef | projectRef],
  fact,
  occurredAt,
  sourceRefs: [],
  confidence,
  status
}
```

### 3.2 PreferenceOrConstraint

A durable user, org, or project preference or rule.

Examples:

- prefers markdown export
- do not auto-inject wiki into every turn
- Aurora-primary is a design constraint

### 3.3 Experience

An interaction-derived record about what the system or user actually did.

Examples:

- attempted implementation path failed due to schema mismatch
- user repeatedly asks for concise PRDs

### 3.4 Observation

A synthesized but still evidence-grounded pattern built from multiple lower-level records.

Examples:

- memory architecture direction consistently favors normalized canonical upstream, compiled downstream
- this user values rebuildability over cleverness

This is where Hindsight is especially useful.

### 3.5 EntityProfileFragment

An extracted fragment about a person, company, project, repo, or other entity.

Examples:

- ThinkWork is a product/system
- Aurora is the primary store for compiled memory
- Hindsight is current v1 memory substrate

### 3.6 DecisionRecord

A confirmed decision plus rationale.

Examples:

- entity pages are tenant-shared, topic and decision pages are per-user
- markdown is export, not operational truth

### 3.7 UnresolvedMention

A candidate entity/topic mention that is not yet strong enough for promotion.

This should stay first-class in the warehouse or compiler staging layer. It is the critical middle state between **"ignore this"** and **"make a page right now."** Without it, the system either loses emerging signal or creates clutter too early. It prevents stub-spam and makes promotion a deliberate product decision instead of an accidental side effect.

## Required common fields

Every canonical record should carry:

- stable id
- tenant scope
- owner scope if applicable
- source refs
- created/updated timestamps
- confidence or strength
- freshness or trend
- supersession / stale marker
- evidence count where applicable
- subject refs and related refs

## 4. The compounding job stages

Compounding should be a staged pipeline, not a single giant prompt.

## Stage A. Raw event capture

Raw user, assistant, tool, and artifact events are recorded in the normal system of record.

## Stage B. Memory retention into canonical warehouse

Hindsight or the selected substrate performs retain-time extraction into normalized memory records.

This is where we leverage:

- fact extraction
- temporal indexing
- entity-aware storage
- evidence grouping
- observation formation
- recall-friendly indexing

## Stage C. Candidate set selection for compounding

A compounding run selects changed canonical records since the last cursor for a given scope.

Selection inputs:

- records updated since cursor
- records explicitly marked high-signal
- unresolved mentions crossing threshold
- decisions recently confirmed
- entities with repeated activity

## Stage D. Page-target planning

The planner decides whether each candidate record should:

- update an existing page
- create a new page
- contribute only to a staging queue
- promote an unresolved mention
- merge into a shared entity page
- do nothing

This should be a structured planning output, not a direct prose rewrite.

## Stage E. Section-level compilation

For each target page, ThinkWork rewrites only affected sections.

That means:

- classify impacted sections
- gather evidence bundle
- generate section patch or replacement
- preserve unaffected sections
- record provenance for each changed section

Full-page rewrites should be avoided in v1. They create drift and reduce inspectability.

## Stage F. Link and alias resolution

After section generation:

- resolve aliases to known pages
- create explicit links
- record unresolved mentions
- prevent accidental duplicate entities

## Stage G. Quality checks and persistence

Before commit:

- verify scope rules
- verify provenance exists
- reject unsupported page types
- detect oversize or low-evidence changes
- increment version and compiled timestamps

## Stage H. Export and serving

Persist in Aurora, then expose to:

- GraphQL/product read path
- agent tools
- markdown export jobs

## 5. How page targets are chosen

Target selection is one of the most important product decisions. If target selection is weak, the whole system becomes cluttered.

The single most important mechanic here is the existence of a middle state: **unresolved mention / staging**. That middle state lets the system preserve signal without prematurely creating durable objects.

## Recommended v1 page types

- **Entity pages**: person, company, product, repo, customer, team
- **Topic pages**: recurring subject or workstream
- **Decision pages**: accepted design or product decisions

That is enough for v1.

## Target selection logic

### Update existing page when

- subject/entity match is strong
- alias resolves confidently
- record reinforces an already-established topic
- decision adds rationale, consequences, or status change

### Create new page when

- repeated evidence points to a durable new subject
- no existing page is a good fit
- the subject is important enough to deserve its own durable object

### Hold in staging when

- mention is weak or ambiguous
- evidence conflicts and needs more support
- event is transient and not yet durable

### Promote when

- unresolved mention crosses threshold
- a recurring cluster becomes coherent enough for a page
- a decision has been explicitly accepted

## Selection heuristics

Use a mix of:

- alias and entity resolution
- page type constraints
- mention frequency
- recency
- evidence count
- novelty vs reinforcement
- whether the knowledge would plausibly be retrieved later as a unit

## Opinionated rule

**Do not auto-create pages for every noun phrase.** A page should exist because it improves future reasoning, not because a model noticed a name.

## 6. Merge/update logic vs create/promote logic

These flows should be distinct.

## Merge or update logic

Use when the system already knows the target object.

Expected behavior:

- fetch page and sections
- compare incoming evidence against existing section responsibilities
- patch or append only where needed
- preserve existing wording if the new evidence changes nothing material
- mark stale or superseded claims when contradicted

This is mostly a maintenance path.

## Create logic

Use when durable new knowledge deserves a new page immediately.

Create should require:

- sufficient evidence
- a stable title/slug candidate
- clear page type
- initial section template
- scope assignment

## Promote logic

Use when the system has seen enough unresolved or staged material to elevate it.

Promotion should be policy-based, not ad hoc model whim.

Examples:

- unresolved mention count >= threshold
- decision confidence crosses threshold after explicit acceptance
- topic cluster appears across multiple threads or artifacts

## Demote or archive logic

Compounding also needs the inverse direction.

Pages may become:

- stale
- merged
- superseded
- archived

The system should not delete history eagerly. It should preserve rebuildability and version history.

## 7. What can leverage Hindsight and what ThinkWork must own

Hindsight is valuable, but it is not the whole stack.

## What Hindsight can do well for ThinkWork

- retain raw signals as memory records
- separate facts, experiences, observations, and higher-level beliefs
- support recall over temporal, semantic, keyword, and graph-like dimensions
- ground observations in source evidence
- support reflect-style reasoning over the retained warehouse
- help with deduplication and trend/freshness interpretation

## What ThinkWork must own

ThinkWork must own the product-specific compiler logic:

- canonical normalized memory contract
- scope rules for tenant-shared vs per-user knowledge
- page types and section schema
- target selection and promotion policy
- compiled page storage in Aurora
- section-level patch application
- alias governance and unresolved mention policy
- rebuild and replay semantics
- GraphQL and agent read path
- markdown export format
- admin/operator controls

## Hard position

**Hindsight is the warehouse input layer and evidence substrate. It is not the compiled memory product.**

Even if Hindsight reflect can synthesize useful answers or observations, ThinkWork still needs an owned compounding layer because product semantics matter:

- what counts as a page
- who can see it
- when it should be updated
- what gets promoted
- how to rebuild it
- how to export it

Those are ThinkWork concerns, not generic memory-engine concerns.

## 8. Reflection vs compilation, and why reflect alone is not enough

Reflection and compilation are related but different.

## Reflection

Reflection is on-demand or nearline reasoning over memory.

Useful for:

- answering questions
- synthesizing observations
- detecting patterns
- generating candidate updates
- interpreting evidence under mission/directive constraints

## Compilation

Compilation is the durable act of writing selected synthesis into stable, inspectable, downstream knowledge objects.

Useful for:

- persistent pages
- reusable decision records
- cross-thread continuity
- shared knowledge surfaces
- markdown export and operator audit

## Why reflect alone is insufficient

Reflect alone fails as the full product because:

1. **it is ephemeral**: answers happen at query time and are not necessarily turned into durable objects
2. **it is expensive to re-run forever**: the same synthesis work gets repeated
3. **it lacks product semantics**: reflect does not decide page ownership, structure, or governance
4. **it hides drift**: if synthesis only appears in answers, operators cannot easily inspect how knowledge changed over time
5. **it weakens rebuildability**: there is no stable compiled artifact layer to regenerate, diff, or export

The right relationship is:

- Hindsight reflect can help propose or enrich compilation
- ThinkWork compilation decides what becomes durable product knowledge

## 9. Compounding quality controls and governance

Without governance, compounding becomes sludge.

## Required v1 quality controls

### Evidence and provenance

Every compiled section should link back to source canonical records.

### Scope control

Entity pages may be tenant-shared. Topic and decision pages may be per-user. Scope must be enforced at write time.

### No transcript-to-page free-for-all

Do not let a single prompt read a giant transcript and rewrite the world.

### No uncontrolled stub creation

Unknown mentions should go to unresolved mention queues, not immediately become pages.

### Section-level patching

Prefer targeted updates to reduce hallucinated drift.

### Change thresholds

Require stronger evidence for create/promote than for update/reinforce.

### Staleness and supersession markers

Outdated claims should be marked, not silently overwritten.

### Human/operator inspectability

Operators should be able to see:

- what changed
- why it changed
- which records supported it
- whether the page is stale or contested

## Recommended governance loop

- post-turn compile jobs for incremental updates
- nightly lint for hygiene, alias cleanup, and promotion checks
- periodic audits for contradiction hot spots and oversized pages
- explicit rebuild tooling when schema or policy changes

## 10. Batch cadence, triggers, replay, and rebuild story

This system should support both incremental compounding and full rebuild.

## Incremental cadence

### Post-turn / nearline trigger

After retain completes, enqueue a compile job for the affected scope.

Use debouncing so bursts collapse into one compile pass.

### Nightly maintenance jobs

Nightly jobs should:

- lint links and aliases
- promote eligible unresolved mentions
- mark stale pages
- export markdown snapshot

### Manual admin triggers

Admins should be able to:

- compile now
- rebuild tenant
- rebuild owner scope
- replay from a cursor or date range

## Replay story

Replay must work from canonical warehouse records, not from compiled pages.

That means:

- the canonical warehouse is sufficient to regenerate compiled memory
- compile jobs are deterministic enough to re-run under current policy
- page storage can be dropped and rebuilt if needed
- exports are downstream artifacts, not the source of truth

## Rebuild story

Rebuild is essential because:

- schemas will evolve
- page taxonomy will evolve
- prompt/compiler logic will improve
- alias rules will change

If the system cannot rebuild, it will calcify around old mistakes.

## 11. Recommended v1 pipeline vs later evolutions

## Recommended v1 pipeline

### V1 architecture

- **Raw system events** in existing ThinkWork operational history
- **Retain into Hindsight-backed normalized memory**
- **ThinkWork compiler reads changed normalized records**
- **Planner maps records to entity/topic/decision targets**
- **Section-level rewrite only for changed sections**
- **Aurora stores pages, sections, links, aliases, provenance**
- **Nightly markdown export** for portability
- **Agent read path via explicit search/read tools**, not automatic always-on injection

### Why this is the right v1

It is:

- concrete
- rebuildable
- inspectable
- modest enough to ship
- aligned with current docs
- compatible with future vector or graph augmentation without changing the core model

## What libraries/frameworks can help in v1

### Good places to leverage external systems

- **Hindsight** for retain/recall/observation substrate
- **LLM classification and patch generation** for page-target planning and section synthesis
- **Postgres/Aurora FTS** for initial compiled page search
- **basic embedding support** as latent future field, not required for v1 behavior

### What should stay custom product logic

- canonical ThinkWork memory contract
- record taxonomy and scope semantics
- page type model
- section schemas and templates
- promotion thresholds
- unresolved mention handling
- merge vs create policy
- compile job orchestration
- rebuild tooling
- export semantics

## Later evolutions

These are good v1.1+ directions, but should not distort v1.

### Confidence and claims layer

A richer claims table with support, contradiction, and supersession edges.

### Better graph traversal

Use explicit typed relationships and graph-aware retrieval for impact analysis and dependency exploration.

### Knowledge packages / context cores

Generate compact reusable packages for specific workflows, not just pages. Example: "customer brief", "project state packet", "decision history packet".

### Auto-injection where retrieval proves reliable

Once compiled retrieval quality is measured, selectively inject top compiled context automatically.

### Procedural memory extraction

Extract workflows, playbooks, and recurring operating patterns from repeated decisions and outcomes.

## Final recommendation

ThinkWork should ship a **warehouse-first, compiler-second** memory architecture.

In v1:

- Hindsight is the canonical memory substrate and ingestion warehouse
- ThinkWork owns the compounding compiler
- the compiled layer is downstream, rebuildable, and Aurora-primary
- markdown is export, not source of truth
- entity, topic, and decision pages are the only page types
- unresolved mentions and promotion rules prevent page sprawl
- reflection informs compilation, but does not replace it

That is the right line.

It gives ThinkWork a real compounding memory pipeline instead of either extreme:

- not just raw recall
- not just polished wiki generation

It creates a durable second brain that can actually get better over time while remaining governable, explainable, and rebuildable.

## Appendix: concise grounding from external patterns

- **Hindsight** supports retain, recall, and reflect, distinguishes facts from synthesized observations, and emphasizes evidence-grounded observations and temporal/entity-aware retrieval. That makes it a strong canonical memory substrate.
- **Karpathy / llm-wiki** reinforces that compiled knowledge should be updated incrementally rather than re-derived from raw source chunks on every query.
- **Cloudflare Agent Memory** reinforces that compaction-time ingestion and persistent context blocks are critical substrate capabilities, but they still sit below product-specific compiled knowledge.
- **GraphRAG-style approaches** are most useful here as retrieval and linking enhancements after a clean canonical-to-compiled pipeline exists.
