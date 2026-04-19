# Compounding Memory — Agent Briefing

Use this brief to onboard a new agent into the Compounding Memory work.

## What this is

ThinkWork is defining a product and architecture called **Compounding Memory**.

The product idea is that ThinkWork should not stop at raw chat history or raw long-term recall. It should turn retained memory into a **durable, readable, inspectable, continuously improving knowledge layer**.

Externally, the framing is:
- **Compounding Memory**
- **Company Second Brain**

Internally, the technical term is still:
- **compiled memory layer**

The important distinction is that this is **not just memory recall** and **not just a wiki**.
It is a downstream compilation system that converts normalized memory into durable higher-order knowledge.

## Core goals

The goals are:
- turn work history into reusable organizational intelligence
- give agents better continuity across time
- create readable pages about people, topics, and decisions
- keep the system inspectable and grounded in evidence
- make the compiled layer rebuildable from canonical memory
- preserve exportability through markdown without making markdown the source of truth

## Core architecture

The settled architecture is:

1. **Threads / work history** are the operational record of what happened.
2. **Normalized long-term memory** is the canonical durable memory plane.
3. **Compounding / compilation** is a downstream pipeline that turns normalized memory into compiled pages.
4. **Aurora** stores compiled pages as the operational source of truth.
5. **Markdown export** is downstream portability, not the primary database.

### Canonical memory vs compiled memory

These are different layers.

**Canonical memory**:
- evidence-oriented
- normalized
- durable
- replayable
- backed by one selected memory engine per deployment

**Compiled memory**:
- synthesized
- page-oriented
- downstream
- rebuildable
- grounded in canonical memory records

The shorthand is:

**raw events -> normalized memory warehouse -> compiled knowledge**

## Memory backend stance

ThinkWork should support a pluggable long-term memory backend, but only **one active engine per deployment**.

Current v1 position:
- **Hindsight** is the canonical long-term memory warehouse in v1
- **AgentCore Memory** is an alternative backend behind the same adapter contract, not a second simultaneous truth

ThinkWork owns the normalized memory contract. Backends plug into that contract.

## What Compounding Memory is trying to produce

The compiled layer should create durable pages of three v1 types:
- `entity`
- `topic`
- `decision`

These are compiled page types, not warehouse record types.

The canonical warehouse record taxonomy is separate and currently includes 7 normalized record types:
- `EventFact`
- `PreferenceOrConstraint`
- `Experience`
- `Observation`
- `EntityProfileFragment`
- `DecisionRecord`
- `UnresolvedMention`

Important distinction:
- warehouse stores durable memory units
- compiled layer stores synthesized pages

Do **not** call everything a topic.
`topic` is just one compiled page type.

## Pipeline / process

The compounding pipeline is staged. It is not one giant prompt.

High-level flow:

1. raw events, artifacts, and work history are captured
2. retention turns them into normalized memory records
3. candidate records are selected for compilation
4. the system chooses page targets
5. sections are updated or created
6. links / aliases / unresolved mentions are updated
7. quality checks run
8. compiled pages are exported / served

Important principles:
- compile from **normalized memory**, not directly from transcripts
- use **section-level rewrites**, not full-page rewrites by default
- preserve **provenance** at the section level
- prefer **updating existing pages** over creating new ones
- be even stricter about **promotion** than creation

## Reflection vs compilation

This is a critical distinction.

**Reflection** = query-time synthesis. The system looks at memory and answers well right now.

**Compilation** = durable knowledge formation. The system decides what deserves a lasting home and updates compiled knowledge over time.

Reflection can make the system sound smart.
Compilation is what makes the system **become smarter over time**.

So: reflect is useful, but reflect alone is not enough.

## Unresolved mentions are load-bearing

There must be a middle state between:
- ignore this
- make a page right now

That middle state is **unresolved mentions**.

Unresolved mentions let the system hold weak or emerging concepts without immediately creating junk pages. This is one of the most important mechanics in the whole design.

## Quality and governance stance

The compiled layer should not become confident garbage.

Key controls:
- every compiled section should be backed by evidence/provenance
- raw transcripts should not become compiled truth directly
- page creation thresholds should be stricter than update thresholds
- promotion thresholds should be stricter than creation thresholds
- staleness / supersession need to exist over time
- operators should be able to inspect what changed and why

Strong line:

**the second brain should be harder to add to than it is to read from**

## Rebuildability and operations

The compiled layer is only trustworthy if it can be replayed and rebuilt.

Operational stance:
- incremental compile by default
- nightly maintenance for lint/export/hygiene
- manual triggers for debug and replay
- rebuild from canonical memory if needed

Strong line:

**rebuildability is part of the product’s trust model, not just an engineering convenience**

## v1 scoping and privacy correction

This is important.

The current intended v1 behavior is:

**Compounding Memory is agent-scoped first.**

That means v1 should compound memory for **one agent at a time**, not aggregate knowledge across all agents in a tenant.

So in v1:
- compiled pages are scoped by `(tenant_id, owner_id)`
- compile jobs are scoped by `(tenant_id, owner_id)`
- compile cursors are scoped by `(tenant_id, owner_id)`
- aliases, unresolved mentions, GraphQL reads, agent tools, and markdown exports are all owner-scoped
- all page types, including `entity`, are owner-scoped in v1

Future team/company/shared compounding can exist later, but it should be an **explicit scope model**, not an accidental side effect of nullable owner fields.

Important note:
Some earlier docs discussed tenant-shared entity pages. That is **not** the intended privacy model for v1 anymore. The scoping correction supersedes that for initial implementation.

## v1 implementation stance

The recommended v1 proves the minimum real loop:

**changed normalized memory records -> compile jobs -> Aurora compiled pages -> GraphQL/agent read path -> markdown export**

Infrastructure stance for v1:
- use **Lambda + job table** first
- do **not** start with Step Functions
- keep the system small, opinionated, and rebuildable
- prove the compounding loop before broadening page types or clever retrieval behavior

## Current important docs

These are the key docs in `.prds/` and how they fit together.

### Core concept docs
- `.prds/compounding-memory-company-second-brain-prd.md`
  - product framing, value, narrative
- `.prds/compiled-memory-layer-engineering-prd.md`
  - engineering architecture for the compiled layer
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
  - detailed process/pipeline logic and conceptual mechanics
- `.prds/wiki-compiler-memory-layer.md`
  - earlier architecture exploration / precursor document

### Review / synthesis docs
- `.prds/compounding-memory-review.md`
  - human-readable section-by-section summary of the concept work
- `.prds/compounding-memory-visuals.md`
  - simple diagrams for the architecture, type system, and lifecycle
- `.prds/compounding-memory-messaging-brief.md`
  - outward-facing language and reusable product framing
- `.prds/compounding-memory-planning-handoff.md`
  - bridge from concept package into implementation planning

### Implementation docs
- `.prds/compounding-memory-implementation-plan.md`
  - phased implementation plan tied to repo realities
- `.prds/compounding-memory-v1-build-plan.md`
  - more concrete build/PR sequencing plan for v1 implementation
- `.prds/compounding-memory-scoping.md`
  - important v1 course correction: make compounding strictly agent-scoped initially

## If you are joining fresh, your mental model should be

ThinkWork is building a **compiled memory layer** on top of normalized long-term memory.

The product goal is a **second brain** that compounds over time.
The engineering goal is a **rebuildable, inspectable, evidence-grounded projection** of canonical memory.
The v1 privacy goal is **agent-scoped compounding first**.

Do not collapse these distinctions:
- threads/work history != long-term memory
- long-term memory != compiled memory
- reflection != compilation
- page type != scope
- export markdown != source of truth

## Quick starter prompt for a new agent

Use this if you want to hand the work to another agent directly:

> Read these docs first:
> - `.prds/compounding-memory-agent-brief.md`
> - `.prds/compounding-memory-review.md`
> - `.prds/compounding-memory-company-second-brain-prd.md`
> - `.prds/compiled-memory-layer-engineering-prd.md`
> - `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md`
> - `.prds/compounding-memory-scoping.md`
> - `.prds/compounding-memory-implementation-plan.md`
> - `.prds/compounding-memory-v1-build-plan.md`
>
> Context you should preserve:
> - Compounding Memory is the product framing
> - Company Second Brain is the outcome framing
> - compiled memory is downstream of canonical normalized memory
> - Hindsight is the canonical memory warehouse in v1
> - Aurora is primary for compiled pages
> - markdown export is downstream portability
> - unresolved mentions are a required middle state
> - section-level rewrites are preferred over full-page rewrites
> - v1 compounding should be strictly agent-scoped
>
> Then help with the next step without undoing those decisions.
