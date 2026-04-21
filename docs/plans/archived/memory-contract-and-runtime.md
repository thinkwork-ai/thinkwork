# PRD: Memory Contract and Runtime

## Summary

ThinkWork needs a real, harness-owned Memory Contract that is stable above any specific backend.

Right now, the product truth is split across three layers that do not cleanly agree:

- the **agent runtime** auto-retains and recalls memory in `packages/agentcore/agent-container/memory.py`
- the **Strands tool layer** exposes `remember`, `recall`, and `forget` plus optional Hindsight tools in `packages/agentcore-strands/agent-container/memory_tools.py` and `server.py`
- the **API/UI layer** exposes memory config, record listing, search, and graph views through GraphQL resolvers

The result is workable, but the contract is implicit, backend-leaky, and inconsistent. AgentCore Memory is treated as the default truth in some places, Hindsight is treated as a richer add-on in others, and the UI already exposes concepts like graph and merged search without a single product-level definition of what is guaranteed versus what is backend-specific.

This PRD defines that contract.

The core recommendation is:

**ThinkWork should own memory as a harness contract with five first-class verbs: retain, recall, reflect, compact, and inspect.**

It should also expose that contract through a **ThinkWork Memory API** and, optionally, a **ThinkWork Memory MCP surface** for interoperability.

Backends may implement those verbs differently, but the harness must define:

- what gets written
- what identifiers are stable
- what recall returns
- how memory enters turn assembly
- what the user and admin can inspect
- how memory can be exported or migrated

AgentCore Memory and Hindsight should become backend implementations of the same contract, not competing product stories.

Near-term, ThinkWork should be more opinionated than the current docs and runtime are:

- **Threads in the app database remain the canonical record of work**
- **Hindsight should become the first-class memory reference plane** for durable, inspectable, portable memory units
- **AgentCore Memory should remain a managed ingestion and extraction helper**, not the primary product truth exposed to users, API consumers, or MCP clients

## Memory mission

**ThinkWork Memory turns past work into portable, inspectable context so agents can keep moving without rereading everything.**

## User promises memory must keep

### 1. Continuity

Users should not have to re-explain important things every time. Memory should carry forward what matters across turns, threads, and time.

### 2. Inspectability

Users and admins should be able to see what was remembered, why it was remembered, and where it came from.

### 3. Control

Memory should be correctable, deletable, exportable, and governable.

### 4. Portability

Memory should survive backend changes. The contract belongs to ThinkWork, not to AgentCore, Hindsight, or any one model/runtime vendor.

## Simplified conceptual model

ThinkWork should keep four layers mentally separate:

- **Threads** = the full record of work
- **Memory** = selective carry-forward context
- **Document knowledge** = reference material
- **Context assembly** = the harness behavior that chooses what enters a turn

A lot of confusion disappears if those four layers are not blended together.

## Why a standalone Memory API should exist

ThinkWork currently has backend endpoints and partial GraphQL surfaces, but not one portable product contract for memory.

For example:
- `HINDSIGHT_ENDPOINT` is a real runtime detail
- AgentCore Memory is provisioned as infrastructure and accessed through AWS SDK calls
- GraphQL exposes pieces of inspectability and search
- the runtime directly calls backend-specific logic

That works internally, but it weakens the portability story externally.

ThinkWork should introduce a standalone **Memory API** at the harness layer so the platform can honestly say:

- your memory belongs to your ThinkWork deployment, not to a single backend
- your memory can be accessed through a stable contract even if the backend changes
- your memory can be exposed to other agents and systems through API and MCP surfaces

### Strong recommendation

ThinkWork should treat:
- the **Memory API** as the canonical external/system contract
- **MCP** as an optional interoperability adapter layered on top of that API
- backend URLs like Hindsight as internal implementation details, not the primary user-facing portability surface

That means the stack should become:

```txt
ThinkWork harness semantics
  -> ThinkWork Memory API
    -> optional ThinkWork Memory MCP adapter
      -> backend adapters (AgentCore, Hindsight, future engines)
```

not this:

```txt
UI / agents / external systems
  -> direct backend URLs or backend-specific tools
```

MCP is valuable here, but it should not become the primary internal runtime contract. It is the right ecosystem surface, not the lowest-level memory abstraction.

## Problem statement

ThinkWork already has the right high-level product idea: threads are the canonical work record, and memory is the carry-forward layer. But the shipped implementation has three gaps.

### 1. The runtime contract is implicit instead of explicit

The code clearly implements behavior, but the platform does not define a stable Memory Contract. Examples:

- `memory.store_turn_pair()` auto-emits a `CreateEvent` after every turn
- `memory.retrieve_implicit_memory()` retrieves recalled memories and formats them into a text block
- `memory_tools.remember()` writes immediately to AgentCore and also dual-writes to Hindsight if enabled
- `memorySearch.query.ts` merges AgentCore and Hindsight search results into one response
- `memoryGraph.query.ts` only works for Hindsight and silently returns empty on managed memory

These behaviors are useful, but they are not a coherent contract.

### 2. Backend details leak into user-facing semantics

The repo currently exposes backend-specific assumptions in multiple places:

- AgentCore namespaces are `assistant_<actorId>`, `preferences_<actorId>`, `session_<sessionId>`, and `episodes_<actorId>/<sessionId>`
- Hindsight recall keys on `bank_id`, which is usually the agent slug, not the UUID
- GraphQL search must thread both `agent.id` and `agent.slug` because the two backends key differently
- `memoryGraph` is documented as a memory graph view, but it is only backed by Hindsight SQL tables

This is a portability hazard. It also makes the product story harder to explain.

### 3. The current surface mixes shipped features with aspirational ones

The repo is careful in some places, but still blends current reality and future direction:

- `memory.py` contains `FUTURE_NAMESPACES` that are explicitly not yet migrated
- `recall(scope="graph")` references `graph_search`, but the required implementation is not present in the inspected file set
- docs discuss Hindsight entity graph and reflection, but only Hindsight actually exposes those today
- the GraphQL graph view assumes Hindsight schema tables and returns nothing otherwise

ThinkWork should stop implying that graph is part of the universal memory contract today. Graph is backend-specific inspectability for Hindsight, not a stable platform guarantee.

## Proposed Memory API and MCP surfaces

## 1. ThinkWork Memory API

ThinkWork should define a stable API around the harness-owned memory verbs.

Recommended top-level operations:

- `retain`
- `recall`
- `reflect`
- `compact`
- `inspect`
- `export`
- `import` (post-MVP if needed)
- `capabilities`

This API should not mirror backend calls. It should mirror the ThinkWork memory contract.

Example shape:

```txt
POST /v1/memory/retain
POST /v1/memory/recall
POST /v1/memory/reflect
POST /v1/memory/compact
GET  /v1/memory/records
GET  /v1/memory/graph
GET  /v1/memory/capabilities
POST /v1/memory/export
POST /v1/memory/import
```

The exact transport can be GraphQL, REST, or both. The important part is the contract, not the transport religion.

## 2. ThinkWork Memory MCP adapter

On top of the API, ThinkWork should optionally expose memory as MCP tools.

That would let external agents and harnesses interact with ThinkWork memory through a standard tool surface while preserving ThinkWork as the system of contract.

Example MCP tools:

- `memory_recall`
- `memory_retain`
- `memory_reflect`
- `memory_inspect_record`
- `memory_list_records`
- `memory_export`

This is useful for:
- portability story
- cross-agent interoperability
- customer-owned automation flows
- external assistants reading or writing ThinkWork memory safely

## 3. Product rule

The UI should not advertise raw backend URLs like Hindsight as the primary memory interface.

If a settings page exposes anything, it should prefer concepts like:
- Memory API
- Memory MCP endpoint
- Enabled memory backends
- Inspectability capabilities
- Export status

Hindsight URLs, if shown at all, should be framed as deployment internals or advanced diagnostics.

## Recommended role split

This PRD recommends a cleaner role split than the current implementation and docs imply.

### Thread database

Role:
- canonical record of work
- audit trail
- exact replay and provenance source

The thread database is not the memory engine. It is the source record that memory is derived from.

### Hindsight

Role:
- first-class memory reference plane
- durable memory units for retrieval and inspection
- graph/reflection/export surface where supported
- primary source for normalized Memory API and MCP results

If Hindsight is effectively required for the richer memory story, ThinkWork should stop treating it like a decorative add-on in product thinking.

### AgentCore Memory

Role:
- managed event retention and extraction helper
- runtime-side convenience for automatic capture
- ingestion path that can help produce memory units

AgentCore Memory is useful, but it should not be the primary external memory truth. If a memory can affect the agent durably, it should be representable through the ThinkWork Memory contract and inspectable through the canonical memory plane.

## Current architecture, as shipped

## 1. Canonical work record

The canonical record of work is still the thread plus message history.

This is visible in:

- docs: retrieval and context page says threads hold the canonical work record
- `chat-agent-invoke.ts`, which loads prior thread messages and sends them into the AgentCore invocation payload
- the runtime, which uses recent thread history directly and uses memory as a selective carry-forward layer

This is correct and should remain the foundation.

## 2. Runtime-side retention

The container auto-retains every turn.

In `packages/agentcore/agent-container/memory.py`:

- `store_turn()` and `store_turn_pair()` send AgentCore `create_event` calls
- reasoning blocks are stripped before storage
- retention is best-effort and never raises
- actor identity comes from `_ASSISTANT_ID`
- session identity comes from the thread ID

This is the real current retain path for managed memory.

Important implementation truth:

- auto-retention is **event-based**, not record-based
- AgentCore strategies asynchronously extract memory records later
- the system already distinguishes raw events from extracted records

That distinction matters. The contract must define both event retention and derived memory materialization.

## 3. Runtime-side recall and context assembly

In `memory.py`, `build_converse_messages()` currently assembles context in this order:

1. retrieved implicit memory block
2. raw thread events
3. new user message

Implicit memory retrieval currently:

- calls `search_memories()`
- prefers Hindsight recall when Hindsight is configured
- otherwise returns nothing meaningful for semantic search because the current `search_memories()` implementation is Hindsight-oriented despite the older AgentCore naming
- merges selected results into a formatted text block by strategy
- greedily fits them into a shared token budget

This is the most important architectural issue in the current codebase:

**the runtime contract for recall is no longer backend-neutral, but the function names still imply that it is.**

`search_memories()` now says “PRD-41B: Replaces AgentCore Memory with Hindsight multi-strategy recall,” while the docs and Terraform still say AgentCore managed memory is always on. That means the harness behavior is partially switched, but the product contract is not.

## 4. Tool-level explicit memory actions

In `packages/agentcore-strands/agent-container/memory_tools.py`:

- `remember()` writes directly to AgentCore semantic namespace for immediate searchability
- `remember()` also emits a `CreateEvent` for strategy processing
- `remember()` also dual-writes to Hindsight when Hindsight is available
- `recall()` calls `search_memories()` and optionally knowledge or graph paths
- `forget()` tries to archive a matched record by moving it to `/archived/actors/{actor_id}/`

This layer exposes useful intent, but the semantics are inconsistent:

- `remember()` is immediate and dual-write
- auto-retention is async and event-derived
- `recall()` is merged and scopeful
- `forget()` assumes updateable records and an archival namespace model that is more explicit-record-centric than the auto-retention flow

In other words, the write paths and deletion paths are not built on one clean abstraction.

## 5. Optional Hindsight add-on

Hindsight is wired as a runtime add-on, not a replacement deployment path.

Visible in:

- `terraform/modules/app/hindsight-memory/README.md`
- docs `memory.mdx`
- `server.py`, where Hindsight tools are added when `HINDSIGHT_ENDPOINT` is set

Hindsight currently provides:

- vendor retain tool
- custom wrapped `hindsight_recall`
- custom wrapped `hindsight_reflect`
- direct GraphQL search integration
- direct GraphQL graph inspection via Aurora `hindsight` schema

This is real and shipped.

What is not universal:

- graph traversal
- graph visualization
- reflection as a backend capability
- entity ontology semantics

These must remain optional backend capabilities until ThinkWork itself normalizes them.

## 6. API/UI inspectability

The API currently exposes four meaningful surfaces:

- `memorySystemConfig.query.ts`: which backends are wired up
- `memorySearch.query.ts`: merged semantic search across backends
- `memoryRecords.query.ts`: merged record listing, but only cross-thread semantic and preferences from AgentCore
- `memoryGraph.query.ts`: Hindsight-only graph view

This is already enough to infer the desired product direction: the API wants a unified memory plane, but the contract is still stitched together ad hoc.

## Current architecture critique

## 1. Agent identity is inconsistent across backends

This is the single biggest portability flaw.

- AgentCore uses `actorId`, sourced from `_ASSISTANT_ID`, which is the agent UUID
- Hindsight uses `bank_id`, which defaults to the agent slug or instance ID
- API resolvers have to map both on every request

This should not leak past the backend adapter boundary.

**Recommendation:** define a harness-level `memory_owner_id` and require adapters to map it internally.

The stable owner should be the agent UUID, not the slug. Slugs are mutable product identifiers; UUIDs are durable.

## 2. The current memory API mixes event history, extracted memory, and search hits

The runtime correctly distinguishes raw thread events from extracted records, but the product surface does not.

There are really three different artifacts:

1. **thread events**: canonical conversational history
2. **memory units/records**: extracted durable items
3. **recall results**: ranked retrieval outputs for a query

ThinkWork should expose these as distinct concepts. Right now they blur together, which makes retention, inspectability, and export harder.

## 3. Managed memory is documented as always on, but the main recall path is drifting toward Hindsight-first behavior

This is visible in `memory.py`:

- function names still refer to generic memory search
- implementation comments say Hindsight replaces AgentCore search for recall
- docs still present AgentCore as the default long-term memory system

That mismatch is dangerous because it makes behavior hard to predict.

**Recommendation:** choose a clean rule.

Recommended rule:

- AgentCore remains the required baseline retention backend
- harness recall becomes adapter-based and can query one or many backends in a deterministic order
- Hindsight is not “the new recall path,” it is an additional adapter with richer capabilities

## 4. Context assembly is currently text-block-based and under-specified

`retrieve_implicit_memory()` groups memories into labeled text blocks and injects them as a fake user/assistant pair before thread history.

That works, but it is not a robust contract. It leaves unspecified:

- whether retrieved memory should include provenance
- whether results should be query-scoped or turn-scoped
- whether the model sees raw facts, summaries, or synthesized reflections
- how backend-specific metadata should be carried
- how token budgets are divided between thread history, memory, and knowledge retrieval

ThinkWork should own a formal context assembly spec.

## 5. There is no canonical memory access surface above the backends yet

This is exactly why the portability story is weaker than it should be.

Today:
- runtime code calls backend-specific logic
- GraphQL exposes some memory functions
- Hindsight has a direct endpoint
- there is no single Memory API that defines portability at the ThinkWork layer

That should change.

## 6. Inspectability is backend-fragmented

The admin/API layer already exposes inspectability, but only partially:

- AgentCore records list only semantic and preferences namespaces in the flat records view
- session summaries and episodes are not surfaced there
- graph view disappears when Hindsight is absent
- `memorySystemConfig` only exposes two booleans rather than a capabilities model

This makes the UI honest but weak. Users cannot tell what memory actually exists, what was retained automatically, or what is inspectable versus only retrievable.

## 6. Forget/archive semantics are not trustworthy enough yet

`forget()` currently assumes a record can be semantically matched and moved into an archive namespace. That may be workable for explicit records, but it is not a complete deletion policy for a system whose main retention path is async event ingestion.

A harness-owned contract must define what forgetting means across:

- explicit memories
- derived records from auto-retained turns
- reflected or compacted outputs
- mirrored copies in multiple backends

Right now, that policy is not clear.

## Target architecture

ThinkWork should define one Memory Runtime owned by the harness.

The target shape should be:

```txt
Threads DB (canonical work record)
  -> Memory ingest / extraction orchestration
     - AgentCore event retention
     - explicit remember flows
     - future ingestion paths
  -> Canonical memory plane
     - Hindsight first-class in the near term
     - future engines behind the same contract
  -> ThinkWork Memory API (portable contract)
     -> optional ThinkWork Memory MCP adapter
  -> Context assembler and admin inspectability
```

Key rule:
- the harness owns semantics
- the API owns portability
- MCP owns ecosystem interoperability
- backends own storage and retrieval implementation details


## Core principle

**Backends store memory. The harness defines memory behavior.**

That means the harness owns:

- memory lifecycle verbs
- stable identifiers
- turn assembly rules
- inspectability surfaces
- export/import format
- retention and deletion semantics

Backends only implement the storage and retrieval mechanics.

## Proposed logical architecture

```text
Thread store / connector events / documents
        ↓
Harness Memory Runtime
  - retain policy
  - extraction policy
  - recall orchestration
  - reflection / compaction scheduling
  - inspectability registry
  - portability/export layer
        ↓
Ingestion + extraction helpers
  - AgentCore event retention
  - explicit remember tools
  - future background processors
        ↓
Canonical memory plane
  - Hindsight in the near term
  - future engines behind the same contract
        ↓
ThinkWork Memory API / MCP
        ↓
Context Assembler
  - recent thread history
  - document retrieval
  - recalled memory units
  - optional reflection summaries
  - tool/policy context
        ↓
Model input
```

Important implication:

- API/MCP should resolve against normalized ThinkWork memory units from the canonical memory plane
- agent turn assembly should move toward consuming that same normalized recall service
- AgentCore should help create memory, not silently become a parallel user-invisible memory truth

## Explicit Memory Contract

The contract should define five verbs and three artifact types.

### Artifact types

#### 1. MemoryEvent

A retained source event from which memory may later be derived.

Required fields:

- `event_id`
- `owner_id` (stable ThinkWork agent UUID)
- `thread_id` nullable
- `source_type` (`thread_turn`, `explicit_remember`, `connector_event`, `system_reflection`, `compaction`)
- `occurred_at`
- `content`
- `role` nullable
- `backend_refs[]`
- `provenance`

Notes:

- Thread messages remain canonical in the thread store. MemoryEvent is a memory-runtime view of what was retained or mirrored into memory systems.
- AgentCore `CreateEvent` maps naturally here.

#### 2. MemoryUnit

A durable memory item used for retrieval.

Required fields:

- `memory_unit_id` (harness ID)
- `owner_id`
- `thread_id` nullable
- `kind` (`semantic`, `preference`, `summary`, `episode`, `reflection`, `instruction`, `other`)
- `text`
- `created_at`
- `updated_at`
- `source_event_ids[]`
- `backend_refs[]`
- `visibility`
- `status` (`active`, `archived`, `deleted`, `superseded`)

Optional fields:

- `confidence`
- `occurred_start`
- `occurred_end`
- `tags[]`
- `metadata`

Notes:

- AgentCore extracted memory records map here.
- Hindsight `memory_units` map here.
- The harness must own `kind`, even if a backend uses `fact_type` or strategy IDs.

#### 3. RecallHit

A ranked retrieval result for a specific query.

Required fields:

- `memory_unit_id` or `synthetic_result_id`
- `owner_id`
- `text`
- `kind`
- `score`
- `backend`
- `why_recalled`
- `provenance`

Optional fields:

- `thread_id`
- `occurred_at`
- `evidence[]`
- `debug`

Notes:

- A RecallHit is not itself a stored memory. It is a query-time result.

## Contract verbs

### 1. retain()

Purpose: ingest source information into memory processing.

Stable harness semantics:

- accepts source content plus owner and provenance
- may create a MemoryEvent immediately
- may create one or more MemoryUnits immediately or asynchronously
- must be idempotency-aware
- must strip non-user-facing reasoning blocks before storage
- must support both automatic and explicit retention

What may vary by backend:

- sync vs async extraction
- dedup behavior
- extraction quality
- namespace layout
- cost and latency

Strong recommendation:

- keep auto-retention on every turn as the default harness behavior
- route all explicit `remember()` requests through the same retain contract instead of special-casing them as a partially separate write path

### 2. recall()

Purpose: retrieve relevant MemoryUnits for a query and return RecallHits.

Stable harness semantics:

- query in, ranked hits out
- results always normalized to harness kinds and IDs
- provenance always attached
- adapters may be queried singly or merged
- recall policy decides budgets, caps, and merge order

What may vary by backend:

- retrieval strategy: semantic, BM25, graph, temporal, reranking
- score distribution
- recall latency
- supporting metadata

Strong recommendation:

- make recall adapter-based with explicit per-backend capabilities, not implicit env-var branching inside `memory.py`

### 3. reflect()

Purpose: synthesize higher-order memory from many MemoryUnits.

Stable harness semantics:

- consumes a query, scope, or time window
- outputs a MemoryUnit of kind `reflection` or returns a synthesized response for inspectable use
- reflections must carry source provenance
- reflection is optional by backend, but the harness verb is real

What may vary by backend:

- whether reflection is backend-native or harness-executed
- synthesis quality
- compute cost

Current reality:

- Hindsight supports this
- AgentCore managed memory does not expose an equivalent inspected reflection API in the repo

Therefore:

- reflect is a contract verb
- reflect is not a guaranteed capability for every backend today

### 4. compact()

Purpose: compress or supersede prior memory without losing inspectability.

This verb is missing as an explicit concept today, but ThinkWork needs it.

Use cases:

- roll many session summaries into a durable project summary
- supersede stale preference variants
- reduce token-heavy recall candidates into compact carry-forward units
- keep memory useful without pretending raw history should all be recalled forever

Stable harness semantics:

- compact creates a new MemoryUnit with links to superseded units
- compact never destroys the canonical thread record
- compact operations are inspectable and reversible at the metadata level

What may vary by backend:

- where compaction runs
- whether compacted outputs are stored in the same store or sidecar store

Strong recommendation:

- implement compact in the harness even if no backend offers it natively

### 5. inspect()

Purpose: make memory behavior visible to users and admins.

Stable harness semantics:

- list memory units by owner and optionally by thread
- search memory with provenance
- show backend availability and capabilities
- explain why a memory was recalled when possible
- expose memory sources, status, and timestamps
- distinguish canonical thread history from derived memory

What may vary by backend:

- graph view availability
- explanation richness
- deep metadata fields

Strong recommendation:

- treat inspectability as part of the contract, not as an admin-only convenience

## What should be stable across backends

The following must be stable, regardless of backend.

### 1. Owner identity

Use agent UUID as the stable `owner_id`.

Never require callers above the adapter layer to know whether a backend uses:

- UUID
- slug
- instance ID
- bank ID

### 2. Memory kinds

Normalize to a ThinkWork enum:

- `semantic`
- `preference`
- `summary`
- `episode`
- `reflection`
- `instruction`
- `other`

Do not expose backend-native strategy or fact types as the primary product contract.

### 3. Provenance

Every MemoryUnit and RecallHit must preserve provenance:

- source thread if any
- source event(s)
- backend refs
- timestamps
- whether it was explicit, automatic, reflected, or compacted

### 4. Status lifecycle

Stable statuses:

- `active`
- `archived`
- `deleted`
- `superseded`

### 5. Turn assembly inputs

The context assembler must accept normalized inputs:

- recent history
- document retrieval hits
- recall hits
- optional reflections/compactions
- tool/policy context

No backend should format its own final injected prompt text directly.

### 6. Inspectability surface

The GraphQL and UI surface should expose normalized memory records and capabilities regardless of backend mix.

## What can vary by backend

These are valid backend differences.

### 1. Extraction mechanism

- AgentCore: event ingestion plus background strategies
- Hindsight: retained memory units and richer retrieval/indexing behavior

### 2. Retrieval method

- semantic-only
- semantic plus BM25
- semantic plus graph
- temporal reranking
- cross-encoder reranking

### 3. Native inspectability richness

- AgentCore may expose records without graph
- Hindsight may expose entities and cooccurrence graph

### 4. Latency and freshness

- immediate explicit write availability
- delayed strategy extraction
- periodic reflection jobs

### 5. Cost profile

- per-event extraction cost
- per-search cost
- reflection compute cost

These differences should be surfaced as capabilities and runtime traits, not allowed to leak into core semantics.

## Backend abstraction plan

Implement a real adapter boundary.

## New internal interfaces

### MemoryAdapter

Required methods:

- `retain(event: RetainRequest): RetainResult`
- `recall(query: RecallRequest): RecallResult`
- `inspectRecords(query: InspectQuery): InspectResult`
- `capabilities(): MemoryCapabilities`
- `forget(request: ForgetRequest): ForgetResult`

Optional methods:

- `reflect(request: ReflectRequest): ReflectResult`
- `compact(request: CompactRequest): CompactResult`
- `inspectGraph(request: GraphInspectRequest): GraphResult`

### MemoryOrchestrator

Harness-owned orchestration layer that:

- calls one or many adapters
- normalizes outputs into harness artifacts
- applies merge/dedup rules
- owns scoring normalization and caps
- owns fallback rules
- provides context assembly inputs

This should replace ad hoc branching in `memory.py`, `memory_tools.py`, and GraphQL resolvers.

## Concrete mapping plan

### AgentCore adapter

Maps:

- `CreateEvent` to `retain`
- `ListMemoryRecords` / `RetrieveMemoryRecords` to `inspectRecords` / `recall`
- raw `list_events` to event inspection only, not as interchangeable memory search

Capabilities:

- `automaticRetention: true`
- `explicitRemember: true`
- `semanticRecall: true`
- `graphInspect: false`
- `reflect: false`
- `compact: false`

### Hindsight adapter

Maps:

- retain endpoint to `retain`
- recall endpoint to `recall`
- reflect endpoint to `reflect`
- Aurora `memory_units` queries to `inspectRecords`
- Aurora `entities` / `entity_cooccurrences` to `inspectGraph`

Capabilities:

- `automaticRetention: false` unless harness explicitly feeds it
- `explicitRemember: true`
- `semanticRecall: true`
- `graphInspect: true`
- `reflect: true`
- `compact: false` initially unless implemented by harness

### Dual-write policy

Current dual-write in `remember()` should move into the orchestrator, not remain tool-local.

Rule:

- explicit remember can fan out to multiple adapters by policy
- automatic retain should also be policy-driven, not hidden in one backend path
- fanout outcomes must be recorded so inspectability can show partial success

## Context assembly plan

ThinkWork should formalize turn assembly as a harness pipeline.

## Recommended turn assembly order

```text
1. current user message
2. recent thread history window
3. recalled memory hits
4. document retrieval hits
5. optional compacted summary / reflection block
6. tool and skill instructions
7. policy / guardrail context
```

The exact model input layout may vary by runtime, but this logical order should be stable.

## Strong recommendations

### 1. Stop injecting backend-formatted memory strings directly from adapters

`retrieve_implicit_memory()` currently creates grouped text blocks. Replace this with normalized RecallHits and let the context assembler decide formatting.

### 2. Make budgets explicit

The harness should own separate budgets for:

- recent thread history
- recalled memory
- document retrieval
- reflection/summary carry-forward

Today memory uses one shared token budget internally. That is too narrow and too hidden.

### 3. Prefer raw recall hits over synthesis by default

Default context should use factual recall hits first.

Use reflection only when:

- the query needs synthesis
- a compacted summary is already available
- the token budget favors summary over many raw items

### 4. Preserve provenance in the prompt assembly model

Each recalled item should still know where it came from, even if the final model text omits all metadata.

## User and admin inspectability

Inspectability is a product requirement.

## Required inspect views

### 1. Backend capability view

Replace `memorySystemConfig` booleans with a capabilities object:

- available adapters
- features supported
- freshness caveats
- indexing mode
- graph support
- reflection support

### 2. Memory records view

Expand current `memoryRecords` into a normalized cross-backend listing that can show:

- kind
- text
- owner
- source thread
- created/updated timestamps
- source type
- backend
- status
- tags
- confidence
- provenance count

Also include optional filters for thread, kind, backend, and status.

### 3. Search view

Keep merged search, but add:

- backend source
- why recalled
- raw score plus normalized score
- capability flags when a result is graph-derived or reflection-derived

### 4. Event-derived view

Add a separate inspection path for retained events versus extracted memory units.

This matters because AgentCore retention is event-first and asynchronous.

### 5. Graph view

Keep graph view, but relabel it honestly:

- not “memory graph” as a universal concept
- instead “graph inspection (Hindsight)” until ThinkWork has a real cross-backend graph contract

## End-user inspectability

Users should eventually be able to answer:

- what do you remember about me?
- where did that memory come from?
- forget this specific thing
- what preferences are currently active?

The current admin-centric APIs are a base, but not enough.

## Portability and export

ThinkWork should treat portability as a first-class product promise because the whole memory story depends on harness ownership.

## Export format

Define a backend-neutral export bundle containing:

- manifest with schema version
- owners
- memory events
- memory units
- backend ref mappings
- deletion tombstones
- compaction/supersession links
- capabilities metadata at export time

Recommended format: newline-delimited JSON for records plus a manifest JSON file.

## Import/migration principles

### 1. Export must never require backend-native IDs alone

Always include harness IDs and backend refs.

### 2. Migration can be lossy in backend-specific enrichments, but not in core semantics

Allowed to lose:

- Hindsight entity graph tables
- backend-native rank scores
- extraction internals

Not allowed to lose:

- owner linkage
- text
- kind
- timestamps
- provenance links
- status lifecycle

### 3. Graph is exportable as enrichment, not required core state

Do not make graph required for portability.

### 4. Threads remain the ultimate recovery source

Because threads are canonical, ThinkWork can always rebuild parts of memory from the thread record. This should be part of the migration story.

## Phased implementation plan

## Phase 1: Define and normalize the contract

Deliverables:

- add internal `MemoryUnit`, `MemoryEvent`, `RecallHit`, and `MemoryCapabilities` types
- add `MemoryAdapter` and `MemoryOrchestrator`
- normalize owner ID to agent UUID at the orchestrator layer
- remove slug/UUID leakage from callers above adapters

Code targets:

- `packages/agentcore/agent-container/memory.py`
- `packages/agentcore-strands/agent-container/memory_tools.py`
- GraphQL memory resolvers

Success criteria:

- one normalization layer maps AgentCore and Hindsight outputs to stable shapes
- no resolver directly knows both backend identity schemes

## Phase 2: Refactor retain and recall to use orchestrator

Deliverables:

- route auto-retention through orchestrator
- route `remember()` through orchestrator fanout policy
- route `recall()` and implicit memory retrieval through orchestrator
- keep current behavior but make backend ordering explicit and testable

Success criteria:

- `memory.py` no longer hardcodes Hindsight-first search logic under generic names
- recall output is a normalized hit list before prompt formatting

## Phase 3: Formalize context assembly

Deliverables:

- implement a dedicated context assembly module
- define budgets for history, memory, docs, and reflection
- stop injecting backend-built strings directly
- add provenance-aware formatting helpers

Success criteria:

- prompt assembly can be explained and tested independently of any backend

## Phase 4: Upgrade inspectability APIs

Deliverables:

- expand `memorySystemConfig` to capabilities
- split event inspection from memory-unit inspection
- enrich `memorySearch` with recall metadata
- relabel graph view as backend-specific capability

Success criteria:

- admin UI can accurately explain what memory exists and how it was produced

## Phase 5: Add compact verb in harness

Deliverables:

- create compacted memory unit type
- add supersession links
- implement compaction job or on-demand compaction flow

Success criteria:

- long-running agents accumulate usable memory without uncontrolled recall sprawl

## Phase 6: Portability/export

Deliverables:

- backend-neutral export schema
- export API and CLI path
- import/migration tooling for at least AgentCore-to-AgentCore and mixed-backend export

Success criteria:

- ThinkWork can credibly say memory is harness-owned and portable

## Risks

## 1. Over-normalizing and losing backend strengths

If the contract becomes too minimal, ThinkWork will flatten Hindsight into “semantic search plus records” and undersell its richer capabilities.

Mitigation:

- keep optional capability surfaces like graph and reflect
- normalize core semantics, not every advanced feature

## 2. Incomplete deletion semantics

Because auto-retention is event-first, deletion is more complex than archiving a top search result.

Mitigation:

- define deletion policy before promising user-visible forget controls
- support tombstones and supersession metadata
- keep canonical thread deletion policies distinct from memory deletion

## 3. Migration complexity

Existing code already mixes UUID and slug ownership across backends.

Mitigation:

- normalize at read time first
- delay write-path migrations until adapter boundary exists
- maintain backward-compatible backend refs during transition

## 4. Prompt quality regressions during context assembly refactor

The current text-block approach may be crude but stable enough in production.

Mitigation:

- keep formatter behavior compatible in the first refactor
- add replay tests using representative threads and recall outputs

## 5. UI confusion if graph is reframed

Relabeling graph as backend-specific may feel like a step backward.

Mitigation:

- be honest now instead of pretending graph is universally available
- later promote graph when ThinkWork owns a true cross-backend graph abstraction

## Resolved direction from this gut check

The simplest durable rule is:

**Threads store what happened. Memory stores what should carry forward.**

From that rule, the near-term product direction is:

- thread DB remains the canonical record of work
- Hindsight becomes the canonical memory plane for durable memory units
- AgentCore remains a managed ingestion/extraction helper
- Memory API and MCP resolve against normalized ThinkWork memory records
- the agent should gradually consume that same normalized recall service instead of a backend-specific parallel path

## Product and UI implication

Once the Memory API exists conceptually, ThinkWork should update product surfaces accordingly.

Examples:
- docs can say memory is available through a stable ThinkWork contract
- enterprise customers can be told memory is portable through API and MCP, not locked into a vendor-specific engine
- the settings screen can replace a naked `Hindsight` URL row with something like:
  - Memory backends: Managed, Hindsight
  - Memory API: enabled
  - Memory MCP: optional / enabled

That is a much stronger story than exposing backend hostnames.

## Open questions

## 1. Should the canonical Memory API live as GraphQL, REST, or both?

Recommendation:

- treat the contract as the important part and support whichever transport is operationally cleanest first
- expose MCP from the same contract layer, not from backend-specific implementations

## 2. Which Memory API operations should be available through MCP in MVP versus later?

Recommendation:

- MVP: `recall`, `retain`, `inspect`, `capabilities`
- later: `reflect`, `compact`, `export`, `import`

## 3. Should Hindsight receive automatic per-turn retention by default when enabled?

Current repo truth:

- AgentCore auto-retains every turn
- Hindsight is mainly explicit-tool and API-integrated today
- `remember()` dual-writes, but routine turns are not clearly dual-retained through the same harness path in the inspected files

Recommendation:

- yes, eventually, but only after orchestrator-based fanout exists and partial-failure reporting is inspectable

## 2. What is the canonical harness memory ID strategy?

Recommendation:

- generate ThinkWork-owned `memory_unit_id` values and preserve backend refs separately
- do not reuse raw backend IDs as the primary product identifier

## 3. Should session summaries and episodes appear in the default admin records view?

Current resolver skips them for practical fanout reasons.

Recommendation:

- yes, but behind filters or thread-scoped views
- the platform should not hide major memory kinds just because one backend makes them awkward to enumerate globally

## 4. Where should compaction run?

Recommendation:

- in the harness, not inside any one backend
- compaction is a ThinkWork behavior, not a storage engine feature

## 5. Should reflect be a first-class user-facing term?

Recommendation:

- yes in the contract, no as the main UX label at first
- expose it as synthesis or briefing behavior in product copy, while keeping `reflect` as the internal runtime verb

## Final recommendation

ThinkWork should stop treating memory as “AgentCore by default plus optional Hindsight extras” at the contract level.

That is a deployment fact, not the product architecture.

The right architecture is:

- **threads are the canonical record**
- **the harness owns the memory contract**
- **adapters implement backend-specific storage and retrieval**
- **context assembly consumes normalized memory artifacts**
- **inspectability and export are part of the contract, not afterthoughts**

Most importantly, ThinkWork should define memory around five verbs:

- retain
- recall
- reflect
- compact
- inspect

That gives the product a durable memory architecture that matches the repo’s real direction, fixes current backend leakage, and avoids pretending unshipped graph ontology work is already the universal platform model.
