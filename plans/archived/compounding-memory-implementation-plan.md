# Compounding Memory Implementation Plan

## Purpose

This document turns the Compounding Memory package into buildable implementation work.

It does **not** restate the concept docs. It converts the settled direction into a phased execution plan for ThinkWork.

## Context documents

This implementation plan should be read alongside the concept and review package.

Primary references:
- `.prds/compounding-memory-review.md` — human-readable review narrative and strongest takeaways from the concept work
- `.prds/compounding-memory-company-second-brain-prd.md` — product framing and business-facing articulation
- `.prds/compiled-memory-layer-engineering-prd.md` — engineering architecture direction for the compiled layer
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md` — detailed pipeline logic, warehouse model, and compounding stages
- `.prds/compounding-memory-visuals.md` — simple diagrams for the architecture, type systems, and lifecycle
- `.prds/compounding-memory-messaging-brief.md` — outward-facing language and reusable product/messaging blocks
- `.prds/compounding-memory-planning-handoff.md` — short handoff summary of what is settled and ready for implementation planning

This plan assumes those documents are the source of conceptual truth. It should stay tightly aligned with them rather than silently redefining the product.

## Settled implementation line

This plan assumes the following is already decided:

- v1 uses a **Hindsight-backed normalized warehouse** as canonical memory input
- the **compiled layer is downstream and rebuildable**
- **Aurora is the primary operational store** for compiled pages
- **markdown export is a portability layer**, not source of truth
- **unresolved mentions are a first-class middle state**
- orchestration starts with **Lambda + job table**, not Step Functions
- v1 page types are only **entity**, **topic**, and **decision**

## What to build first in v1

The first thing to build is the **minimum end-to-end compounding loop**:

1. read changed normalized memory records from the Hindsight-backed adapter
2. enqueue and run compile jobs from the existing `memory-retain` path
3. write compiled pages + sections + unresolved mentions into Aurora
4. expose a basic read path through GraphQL and agent tools
5. export markdown snapshots downstream

If this loop works, the product has proven the architecture. If it does not, richer governance and retrieval features will not matter.

## v1 scope

### Must ship in v1

- compile job ledger and async compile trigger
- Hindsight adapter support for listing changed normalized records by cursor
- Aurora schema for pages, sections, links, aliases, provenance, unresolved mentions, compile jobs
- compiler planner + section patch flow
- unresolved mention accumulation and promotion path
- GraphQL read queries for compiled pages/search/backlinks
- agent tools for explicit wiki search/read
- nightly lint and markdown export jobs
- feature flags, replay hooks, and verification coverage

### Explicitly not required for v1

- Step Functions orchestration
- timeline page type
- automatic top-N compiled context injection into every turn
- human-primary markdown editing workflow
- confidence/claims graph as a full subsystem
- AgentCore memory parity for compile cursors
- embedding-powered retrieval as a core dependency
- contradiction engine that mutates state automatically

## Phased delivery plan

## Phase 0, repo exploration and design freeze

Goal: remove ambiguity before schema and handler work starts.

### Outcomes

- confirm exact normalized memory shapes available from `ThinkWorkMemoryRecord`
- confirm where cursor state should live
- confirm handler registration and Lambda packaging pattern
- confirm GraphQL type/resolver conventions
- confirm agent-container tool registration pattern
- confirm whether existing scheduled-job infrastructure should be reused only for nightly jobs, not post-turn compile execution

### Required repo exploration

- `packages/api/src/lib/memory/types.ts`
- `packages/api/src/lib/memory/adapter.ts`
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
- `packages/api/src/handlers/memory-retain.ts`
- `packages/database-pg/src/schema/index.ts`
- `packages/database-pg/drizzle/`
- `packages/api/src/graphql/resolvers/index.ts`
- `packages/agentcore-strands/agent-container/server.py`
- `terraform/modules/app/lambda-api/handlers.tf`
- `packages/database-pg/src/schema/scheduled-jobs.ts`

### Key decisions to freeze at end of phase

- compile cursor storage model
- exact page scope rules in schema
- whether unresolved mention promotion runs in lint only or can also be admin-triggered
- compile event payload contract
- section model shape and render strategy

## Phase 1, foundation and schema

Goal: establish the durable data model and job ledger.

### Epic 1. Aurora compiled-memory schema

Build:

- `wiki_pages`
- `wiki_page_sections`
- `wiki_page_links`
- `wiki_page_aliases`
- `wiki_unresolved_mentions`
- `wiki_section_sources`
- `wiki_compile_jobs`

Implementation notes:

- add new schema file under `packages/database-pg/src/schema/`
- export it from `packages/database-pg/src/schema/index.ts`
- add migration and drizzle metadata updates
- enforce page scope at the DB layer where possible
- include indexes for page lookup, search, compile recency, and unresolved mention lookup

### Epic 2. Compiler repository primitives

Build repository helpers for:

- job enqueue / claim / status updates
- page lookup by scope + slug
- section upsert and ordered render
- alias lookup and resolution
- unresolved mention upsert
- provenance inserts
- compile cursor read/write

### Dependencies

- no upstream dependency beyond schema clarity
- blocks compiler logic, GraphQL read path, lint, and export

## Phase 2, normalized-memory read path and compile trigger

Goal: connect the existing memory system to the compiled layer without disturbing canonical retention.

### Epic 3. Memory adapter cursor support

Build:

- `listRecordsUpdatedSince(...)` on the adapter interface
- Hindsight implementation against normalized memory backing data
- AgentCore stub that throws `NotImplemented` cleanly in v1
- compiler feature gate to Hindsight-backed deployments only

### Epic 4. Post-turn compile enqueue

Modify `packages/api/src/handlers/memory-retain.ts` so that after `retainTurn()` succeeds it:

- creates or dedupes a `wiki_compile_jobs` row
- invokes `wiki-compile` asynchronously
- never fails the memory-retain path if compile enqueue fails

### Dependencies

- depends on Phase 1 schema/repository primitives
- blocks all real compile behavior

### Build directly vs prototype

Build directly:

- adapter interface extension
- Hindsight cursor implementation
- compile job insertion and async invoke

Prototype first:

- dedupe key strategy and debounce window, using sample turn traffic if available

## Phase 3, compiler core and unresolved mention lifecycle

Goal: ship the minimum compounding engine.

### Epic 5. Planner and compiler orchestration

Build:

- `wiki-compile` handler
- compiler orchestration library under `packages/api/src/lib/wiki/`
- candidate loading by cursor/scope
- self-debounce and job claiming
- page-target planning output with only:
  - update existing page
  - create page
  - hold as unresolved mention
  - promote unresolved mention

### Epic 6. Section patch pipeline

Build:

- page skeleton templates for entity/topic/decision
- section responsibility rules per page type
- diffing logic so only changed sections rewrite
- renderer that concatenates sections into page markdown/body
- provenance tracking at section level

### Epic 7. Link, alias, and unresolved mention handling

Build:

- alias resolution against known pages
- unresolved alias accumulation instead of stub page creation
- promotion thresholds and promotion flow
- explicit page link rows

### Dependencies

- depends on Phase 1 and 2
- blocks GraphQL usefulness, export usefulness, and agent value

### Build directly vs prototype

Prototype first:

- planner prompt shape and JSON contract
- section rewrite prompt shape
- unresolved mention promotion thresholds
- page creation heuristics for entity vs topic

Build directly:

- compile orchestration
- DB writes and transactions
- provenance recording
- explicit no-full-page-rewrite guardrails

## Phase 4, read path, lint, and export

Goal: make compiled memory usable and inspectable.

### Epic 8. GraphQL delivery

Build:

- schema additions for compiled pages/search/backlinks
- resolver module under `packages/api/src/graphql/resolvers/wiki/`
- admin mutation for `compileWikiNow`
- visibility rules matching tenant/shared entity and owner-scoped topic/decision behavior

### Epic 9. Agent runtime tools

Build:

- `search_wiki`
- `read_wiki_page`
- tool registration in `packages/agentcore-strands/agent-container/`
- prompt guidance so agents use compiled memory explicitly when relevant

### Epic 10. Nightly lint and export

Build:

- `wiki-lint` Lambda for hygiene-only v1 rules
- `wiki-export` Lambda for markdown vault generation
- EventBridge schedules and S3 export bucket wiring

Lint should cover:

- broken links
- duplicate aliases
- stale/orphan pages
- unresolved mention promotion checks
- oversize page warnings

Export should cover:

- markdown render by page type
- frontmatter with metadata/provenance refs
- vault zip and retention policy

### Dependencies

- depends on compiler core producing stable page data

### Build directly vs prototype

Build directly:

- GraphQL queries/mutation
- search/read tools
- markdown export pipeline

Prototype first:

- final markdown vault shape and frontmatter fields, with a sample tenant export review

## Phase 5, replay, rollout, and hardening

Goal: make the system safe to enable on real tenants.

### Epic 11. Replay and rebuild controls

Build:

- admin-triggered compile-now entrypoint
- tenant/owner replay pathway from cursor or date range
- documented rebuild runbook

### Epic 12. Verification and rollout

Build:

- unit tests for diffing, unresolved mentions, alias resolution, render output, dedupe
- integration tests with mocked Bedrock/classifier output
- end-to-end test on dev using real retained turns
- feature-flag rollout by tenant
- operational dashboard/logging for compile failures and lag

### Milestone exit criteria

- one tenant can retain memory, compile pages, search/read pages, and receive nightly export
- replay can rebuild compiled output from canonical memory without manual DB surgery
- failure in compile path does not affect chat or memory retention

## Workstreams / epics summary

1. **Schema and storage**
   - Aurora tables, migration, indexes, constraints, repository helpers
2. **Memory adapter and cursoring**
   - changed-record listing, cursor semantics, feature gating
3. **Compile orchestration**
   - job ledger, enqueue, debounce, claim, retries, compile handler
4. **Planner and section compiler**
   - target selection, page creation/update logic, section patching
5. **Entity resolution and unresolved mentions**
   - alias lookup, mention accumulation, thresholds, promotion
6. **Read path and product access**
   - GraphQL queries, admin mutation, visibility rules
7. **Agent consumption**
   - explicit search/read tools and prompt usage guidance
8. **Nightly hygiene and portability**
   - lint, markdown export, S3 retention
9. **Verification and rollout**
   - tests, replay tooling, feature flags, observability

## Sequencing and dependencies

### Critical path

1. repo exploration and design freeze
2. Aurora schema + migration + repository layer
3. memory adapter changed-record read path
4. compile job enqueue from `memory-retain`
5. compile handler + planner + section patch writes
6. unresolved mention lifecycle and promotion rules
7. GraphQL + agent read tools
8. nightly lint/export
9. replay + rollout hardening

### Dependency rules

- do **not** start GraphQL or agent tools before page/schema shapes are stable
- do **not** start export before section render format stabilizes
- do **not** broaden page taxonomy before entity/topic/decision quality is proven
- do **not** add Step Functions until Lambda + job-table pain is real and specific

## Risks and unknowns that need spikes

### Spike A. Hindsight cursor semantics

Question:
Can `updated_at` on the current Hindsight-backed path reliably drive incremental compilation without missing updates or causing noisy reprocessing?

Why it matters:
This determines replay safety and incremental correctness.

### Spike B. Planner contract quality

Question:
Can a compact structured planner reliably choose between update, create, unresolved, and promote without excessive page spam?

Why it matters:
This is the highest-leverage quality risk in the system.

### Spike C. Section model and patch granularity

Question:
What section schema for entity/topic/decision pages gives stable targeted rewrites instead of drift?

Why it matters:
Poor section boundaries will force noisy rewrites and reduce inspectability.

### Spike D. Unresolved mention thresholds

Question:
What thresholds and signals should promote mentions without creating clutter too early?

Why it matters:
This is central to product trust.

### Spike E. Search shape for v1

Question:
Is Postgres FTS over title/summary/sections enough for initial read-path quality, or are embeddings needed sooner?

Why it matters:
This affects scope control and implementation speed.

### Spike F. Bedrock cost envelope

Question:
What is the real per-tenant cost of planner + section rewrite jobs under realistic turn volume?

Why it matters:
This determines debounce settings, batch sizing, and model choices.

## What can be deferred

- AgentCore compile-read parity
- automatic compiled context injection into general chat
- additional page types like timeline/project/package
- embeddings as a required retrieval layer
- contradiction resolution workflows that write state automatically
- manual page editing UI
- knowledge package generation
- richer claims/support/supersession graph
- Step Functions orchestration
- admin UI beyond minimal trigger/debug affordances

## Suggested milestones and checkpoints

### Milestone 1. Data model ready

Checkpoint:
- schema merged
- migrations run locally
- repository helpers working
- open questions on scope/constraints resolved

### Milestone 2. Post-turn compile loop alive

Checkpoint:
- `memory-retain` enqueues compile jobs
- compile handler claims jobs and reads changed records
- no user-facing path regresses when compile fails

### Milestone 3. First pages materialize

Checkpoint:
- entity/topic/decision pages created in Aurora
- section patching works on second pass
- unresolved mentions accumulate instead of creating junk pages

### Milestone 4. Readable product surface

Checkpoint:
- GraphQL queries work
- agent tools can search and read pages
- a real workflow shows answer quality improvement

### Milestone 5. Trust and portability

Checkpoint:
- nightly lint runs
- markdown export generated and reviewed
- replay/rebuild tested on a dev tenant

### Milestone 6. Controlled tenant rollout

Checkpoint:
- feature flag enabled for first tenant
- cost, lag, and quality metrics reviewed after one week
- v1 follow-up list created from real usage

## Where existing ThinkWork code needs exploration before implementation

### Memory layer

- `packages/api/src/lib/memory/types.ts`
  - current normalized contract is generic and may need metadata conventions for compiler-friendly record categorization
- `packages/api/src/lib/memory/adapter.ts`
  - add changed-record listing without destabilizing recall/inspect/export
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
  - confirm direct SQL vs API read path, cursor semantics, and bank/owner mapping
- `packages/api/src/lib/memory/adapters/agentcore-adapter.ts`
  - confirm safe v1 stub behavior

### Trigger path

- `packages/api/src/handlers/memory-retain.ts`
  - exact insertion point for enqueue/invoke and error swallowing
- existing async invoke patterns in API handlers
  - reuse established best-effort invocation conventions

### Database / migrations

- `packages/database-pg/src/schema/index.ts`
  - export pattern for new schema modules
- `packages/database-pg/drizzle/` and `meta/_journal.json`
  - migration naming and snapshot update flow
- existing schema files with relations/index patterns
  - copy local conventions rather than inventing a new style

### GraphQL

- `packages/api/src/graphql/resolvers/index.ts`
  - root resolver registration pattern
- `packages/database-pg/graphql/types/`
  - type definition conventions
- `packages/api/src/graphql/resolvers/memory/`
  - best comparison point for tenant-scoped read APIs

### Agent runtime

- `packages/agentcore-strands/agent-container/server.py`
  - tool registration and prompt wiring path
- existing memory tools in `packages/agentcore-strands/agent-container/`
  - best reference for compiled-memory tools

### Infra

- `terraform/modules/app/lambda-api/handlers.tf`
  - Lambda packaging, env vars, IAM, naming conventions
- `terraform/modules/app/crons/` and related storage modules
  - nightly job and export bucket patterns
- `packages/database-pg/src/schema/scheduled-jobs.ts`
  - reference only for nightly scheduling patterns, not for post-turn compile orchestration

## What should be prototyped vs built directly

### Prototype first

- planner JSON contract
- section templates and patch strategy
- unresolved mention promotion heuristics
- debounce window and dedupe behavior
- markdown export shape
- cost envelope for planner + rewrite prompts

### Build directly

- Aurora schema and migrations
- adapter interface addition
- compile job ledger
- `memory-retain` enqueue hook
- compile/lint/export handlers
- GraphQL read path
- explicit agent tools
- replay hooks and tests

## Recommended team execution order

If this is split across multiple engineers, divide it like this:

- **Engineer A:** schema, repository, migrations, GraphQL types
- **Engineer B:** memory adapter cursoring, enqueue flow, compile job orchestration
- **Engineer C:** planner, section compiler, unresolved mention logic
- **Engineer D:** agent tools, export, lint, rollout verification

Keep one owner across all four for page taxonomy, target-selection policy, and unresolved mention rules. Those decisions should not fragment.

## Final recommendation

Treat v1 as a focused proof of the compounding loop, not a broad memory platform launch.

The winning sequence is:

- make the normalized-memory -> compile-job -> Aurora-page loop real
- make unresolved mentions trustworthy
- make compiled pages readable through GraphQL and agent tools
- make the layer rebuildable and exportable
- defer everything that does not directly improve trust, inspectability, or continuity
