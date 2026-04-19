# Compounding Memory — Compiled Memory Layer (v1)

## Executive Summary

ThinkWork should add a **compiled memory layer above the built-in long-term memory layer**, not instead of it.

Today, ThinkWork already has the right foundation for durable recall: a ThinkWork-owned **normalized memory contract**, backed by one selected memory engine per deployment. In practice that means **Hindsight** today, with **AgentCore Memory** as a supported alternative path. That layer is good at recall, lookup, decomposition, and structured retrieval: *"has the user ever mentioned X?"* or *"what changed recently?"*

What it does **not** do as well is accumulate a readable, durable, cross-linked answer to a different kind of question: *"what does the company know about X as a whole?"* That is the gap this document addresses.

Karpathy's LLM-Wiki pattern, llm-wikid, and similar systems all point at the same missing layer: a **compiled knowledge view** that gets better as more work passes through the system. Cloudflare's new Agent Memory validates the opposite side of the stack, the **memory plane** itself: compaction-time extraction, persistent recall, shared profiles, and retrieval APIs. Those ideas strengthen this proposal. They do **not** replace it.

**Core call**: ThinkWork should treat long-term memory and compiled memory as two distinct layers:

1. **Threads / work record** = canonical work and session history
2. **Long-term memory engine** = canonical durable recall layer (Hindsight or AgentCore)
3. **Compiled memory layer** = topic, entity, and decision pages synthesized from normalized memory records
4. **Agent read path** = tools and selective retrieval that place compiled knowledge back into model context

That stack gives ThinkWork something stronger than generic "RAG" or "memory": a **company second brain** that compounds over time while staying grounded in canonical system-owned memory.

## Why this exists now

There is a wave of adjacent work hitting the same idea from different angles:

- **Cloudflare Agent Memory** validates that agents need a real persistent memory layer with compaction-aware ingestion, recall APIs, exportability, and shared profiles.
- **llm-wikid / Karpathy's wiki pattern** validates that compiled, cross-linked, human-readable knowledge pages are a useful way to accumulate understanding over time.
- **Compound Engineering** validates the higher-level loop: work should leave behind reusable structure that makes the next cycle better.
- **TrustGraph / context cores** validates that organizations want portable, versioned knowledge artifacts, not just ephemeral retrieval behavior.

These are not contradictory. They are different slices of the same emerging stack.

## Preferred framing

Public / product framing:
- **Compounding Memory**
- **Company Second Brain**

Technical framing:
- **Compiled Memory Layer**
- **Wiki compiler** as the implementation pattern, not the product category

"Wiki" is useful as an intuition pump, but it undersells the actual architecture. The important idea is not markdown. The important idea is that ThinkWork compiles recurring knowledge out of raw work and memory activity into durable, inspectable, reusable knowledge surfaces.

## The data warehouse analogy

This proposal gets clearer if we describe it like a data stack:

- **Raw inputs** = threads, messages, tool calls, docs, notes, external records
- **Normalized memory records** = ThinkWork's memory warehouse, backed by Hindsight or AgentCore
- **Compiled pages** = semantic marts / curated projections over that warehouse
- **Agent retrieval + injection** = serving layer that puts the right compiled knowledge back into runtime context

That is a better mental model than "RAG vs. wiki." The compiled layer is not a competing storage system. It is a **materialized knowledge view** over canonical memory.

## Architectural guardrails

These are load-bearing, not nice-to-have:

- **The compiled memory layer is strictly downstream and rebuildable.**
- **The selected long-term memory engine remains canonical for durable recall and inspectability.**
- **Loss or delay of a compile job must never threaten canonical memory retention.**
- **Compiled pages are a projection, not the source of truth.**
- **Markdown is an export and render format, not the operational database.**
- **The system must never silently turn agent output into canonical truth.**

## Goal

Add a compiled memory layer above the normalized long-term memory plane. Pages are compiled incrementally post-turn and linted nightly. Exposed to the app via GraphQL and to the runtime agent via tools; exported nightly to S3 as portable markdown vaults.

## Non-goals for v1

- Replace the selected long-term memory engine
- Treat markdown as operational truth
- Ship a full claims / confidence / supersession model before seeing real output patterns
- Add OpenSearch, Neptune, or a new vector database
- Automatically inject top-N wiki pages into every turn's context by default
- Support human markdown editing / Obsidian write-back in the primary path
- File every agent answer back into the compiled layer automatically

That last point matters. A company second brain should **not** absorb every generated answer. That is how you build a self-reinforcing pile of AI sludge. v1 should only compound:
- recurring topics
- durable entities
- accepted decisions
- validated syntheses
- reviewed patterns / learnings

---

## Architecture Overview

After evaluating a file-first design (S3 markdown primary) versus an app-first design (Aurora primary), **Aurora primary wins**.

The reason is simple: the primary consumer of this layer is the agent/runtime and the product surface, not a human text editor. That means structured state should be the operational truth, and markdown should be a portable render/export layer. Migration is asymmetric: structured → markdown export is easy any time; markdown-primary → structured product model is painful.

```text
Chat turn → existing memory-retain Lambda
              ├── adapter.retainTurn()  [unchanged — selected memory adapter]
              └── enqueueWikiCompile()  [NEW]
                       ↓
                 wiki_compile_jobs row (dedupe_key = 5m bucket hash)
                       ↓
                 wiki-compile Lambda (async invoke, InvocationType: "Event")
                       ↓
              ┌────────┴─────────┐
              │ Bedrock Claude   │
              │ (Sonnet 4.6)     │
              │ classify + patch │
              └────────┬─────────┘
                       ↓
      Aurora: wiki_pages + wiki_page_sections + wiki_page_links
              + wiki_unresolved_mentions + wiki_section_sources
                       ↓
         (nightly) wiki-lint Lambda   — structural hygiene + promotion gates
         (nightly) wiki-export Lambda — Aurora → S3 markdown vault
                       ↓
              GraphQL read API + agent tools (searchWiki, readWikiPage)
```

**Why a job row + async invoke (not just async invoke)**: belt-and-suspenders. Fire-and-forget `InvocationType: "Event"` is appropriate because compilation is background work, not user-driven transactional state. The job row gives us retry, visibility, idempotency, and a cursor to recover from dropped invokes.

---

## Agent Read Path (inference time)

The whole project only pays off if compiled pages show up in the LLM's context when answering questions. Three plausible shapes:

- **(a) Explicit tool** — agent calls `searchWiki(query)` / `readWikiPage(slug)` on demand.
- **(b) Automatic top-N injection** — on every turn, retrieve top 1–3 wiki summaries for the user message, inject alongside existing recall output.
- **(c) Query-shape routing** — "tell me about X" routes to wiki, "has the user ever mentioned Y" routes to fragment recall.

**v1 picks (a); v1.1 evaluates (b) based on v1 signal.** Rationale:
- (a) is immediately testable and doesn't gate on vector infrastructure quality.
- (a) means v1 ships without an HNSW index and without a retrieval-quality eval loop.
- Once real pages exist in a real tenant, we can measure whether the agent is *finding* them via the tool. If it isn't, we add (b) with the `body_embedding` column already present on section rows (kept nullable in v1 for exactly this reason).

**Read path in v1**:
- New GraphQL `wikiSearch(query, pageType?, limit)` query using Postgres full-text search on a maintained tsvector over `title + summary_md + section body_md`.
- New agent tool `searchWiki({ query, pageType? })` registered in the AgentCore strands container; returns a ranked list of `{ slug, title, summary, score }`.
- New agent tool `readWikiPage({ slug })` returns rendered `bodyMd` + outbound/backlink edges.
- Agent system prompt updated to mention wiki availability: *"If the user asks about a topic, person, or past decision, consider `searchWiki` before answering."*

Vector search on sections is **out for v1**, but the `body_embedding` column is created anyway. Zero runtime cost if unindexed, cheap insurance against a v1.1 migration.

---

## Entity pages are tenant-shared; topic & decision pages are per-user

Care recipients, family members, care facilities, providers — all entity-type pages — represent one real-world thing that multiple caregivers in the same tenant should agree on. Topic pages (*"my preferences for mom's meals"*) and decision pages (*"we chose home care over SNF because…"*) are per-user because they encode caregiver-specific context and judgment.

**Rule in v1** (enforced by CHECK constraint on `wiki_pages`):
- `page_type='entity'` ⇒ `owner_id IS NULL`
- `page_type IN ('topic','decision')` ⇒ `owner_id IS NOT NULL`

The compiler writes to the correct scope based on classification. Entity pages are readable by all caregivers in the tenant; per-user pages are readable only by their owner. Tenant-shared writes take a per-tenant advisory lock (`pg_advisory_xact_lock(hashtext(tenant_id))`) to prevent two concurrent compiles from racing on the same entity.

---

## Trigger cadence: Lambda self-debounce

Compiling on every turn would waste Bedrock tokens for chatty sessions. Rather than adding EventBridge or trying to define a universal notion of "session end," the compile Lambda self-debounces:

- Every turn enqueues a `wiki_compile_jobs` row (subject to 5-minute bucket dedupe — see schema).
- Every turn async-invokes the compile Lambda.
- On entry, the Lambda checks: is there another `pending` job for the same `(tenant_id, owner_id)` with a strictly later `scheduled_at`? If yes, exit immediately — the later job will do the work.
- Otherwise, sleep 120 seconds, re-check, then drain all pending jobs for the scope.

Net behavior: a burst of N turns in 2 minutes results in **one** compile pass that sees all N turns' memories, not N passes.

---

## Quality, validation, and governance

This layer only becomes a real company second brain if it has guardrails against compounding nonsense.

### Required behaviors in v1

- **Every compiled page starts as machine-generated, not implicitly trusted.**
- **Every section carries provenance** back to normalized memory records.
- **Unresolved mentions do not become pages automatically.** They accumulate in a queue until promoted deliberately.
- **Entity, topic, and decision pages are different things** and should not be flattened into one generic note type.
- **Lint is allowed to flag, rank, and promote.** It is not allowed to quietly rewrite canonical memory.

### What we should explicitly avoid

- auto-stub sprawl
- filing every chat answer back into the wiki
- treating single-source claims as stable knowledge
- hiding confidence and provenance from the operator
- letting page polish outrun evidence quality

### Mental model

ThinkWork should be opinionated here:

- **memory** stores what happened and what was retained
- **compiled memory** summarizes what seems to matter
- **human or policy review** decides what becomes durable organizational knowledge

That distinction is the difference between a second brain and a very confident junk drawer.

---

## Normalized memory reader (new adapter method)

The compiler must read candidate memory records **through the normalized layer**, not Hindsight-native tables. This requires extending the memory adapter interface at `packages/api/src/lib/memory/types.ts`:

```ts
listRecordsUpdatedSince(args: {
  tenantId: string;
  ownerId?: string;
  cursor?: string;      // opaque, adapter-defined
  limit: number;
}): Promise<{ records: ThinkWorkMemoryRecord[]; nextCursor?: string }>;
```

- **Hindsight adapter** (`hindsight-adapter.ts`) implements it by querying memory_units with `updated_at > cursor_ts`.
- **AgentCore adapter** gets the same method signature; initial impl throws `NotImplemented` — v1 wiki compiler is feature-gated to Hindsight-backed deployments only. v1.1 lands the AgentCore cursor semantics.
- The compiler consumes `ThinkWorkMemoryRecord` values and nothing adapter-specific. Cursoring is defined at the normalized layer, even though the first implementation reads Hindsight under the hood.

---

## Aurora Schema (new tables)

All in a new schema file `packages/database-pg/src/schema/wiki.ts`, following the conventions in `packages/database-pg/src/schema/quick-actions.ts:17` (pgTable, uuid PK with `gen_random_uuid()`, `tenant_id` FK, snake_case, composite indexes, relations block).

### `wiki_pages`
| column | type | notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| tenant_id | uuid NOT NULL | FK → tenants.id |
| owner_id | uuid NULL | FK → users.id. NULL iff `page_type='entity'` (CHECK constraint below) |
| page_type | text NOT NULL | enum: `topic`, `entity`, `decision` (v1). `timeline` deferred. |
| slug | text NOT NULL | URL-safe |
| title | text NOT NULL | |
| summary_md | text NOT NULL DEFAULT '' | short LLM-generated abstract, shown in index listings |
| status | text NOT NULL DEFAULT 'active' | `active`, `stale`, `archived` |
| version | integer NOT NULL DEFAULT 1 | incremented on section changes |
| last_compiled_at | timestamp | last successful ingest touch |
| last_linted_at | timestamp | last successful lint pass |
| tsv | tsvector | full-text search over title + summary_md + concatenated section bodies, maintained by trigger |
| created_at / updated_at | timestamp default now() | |

Indexes:
- `UNIQUE(tenant_id, COALESCE(owner_id,'00000000-0000-0000-0000-000000000000'::uuid), slug)`
- `(tenant_id, page_type)`
- `(tenant_id, last_compiled_at)`
- GIN on `tsv`

CHECK: `(page_type='entity' AND owner_id IS NULL) OR (page_type IN ('topic','decision') AND owner_id IS NOT NULL)`

### `wiki_page_sections`
The surgical-edit unit. A page's rendered markdown = sections ordered by `position`.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid NOT NULL | FK → wiki_pages.id ON DELETE CASCADE |
| section_slug | text NOT NULL | stable identifier for surgical updates |
| heading | text NOT NULL | H2 text |
| body_md | text NOT NULL | markdown body (sans heading) |
| position | integer NOT NULL | ordering within page |
| body_embedding | vector(1024) NULL | column exists, **no HNSW index in v1**. Forward-compat for v1.1 automatic injection. |
| last_source_at | timestamp | newest memory contributing to this section |
| created_at / updated_at | timestamp | |

Indexes: `(page_id, position)`, `(page_id, section_slug)` unique.

### `wiki_page_links`
Backlinks live as rows, not inferred from markdown. Referential integrity at write time.

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| from_page_id | uuid NOT NULL | FK → wiki_pages.id ON DELETE CASCADE |
| from_section_id | uuid NULL | FK → wiki_page_sections.id |
| to_page_id | uuid NOT NULL | FK → wiki_pages.id |
| anchor_section_slug | text NULL | |
| context_excerpt | text NULL | ~200-char surrounding text for display |
| created_at | timestamp | |

Indexes: `(from_page_id)`, `(to_page_id)` (backlink lookup), `(from_page_id, to_page_id)` unique.

### `wiki_page_aliases`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid NOT NULL | |
| page_id | uuid NOT NULL | FK → wiki_pages.id ON DELETE CASCADE |
| alias | text NOT NULL | |

Unique `(tenant_id, alias)`. Used by the compiler to resolve "Mrs. Johnson" → existing entity page before creating a new one.

### `wiki_unresolved_mentions` *(replaces auto-stub creation)*

When the compiler sees an alias it cannot resolve, it records a mention here rather than auto-creating a stub page (stub sprawl is a known failure mode — neat-sounding and destructive).

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid NOT NULL | |
| owner_id | uuid NULL | scope of the mention (NULL = tenant-shared) |
| alias | text NOT NULL | the unresolved name/phrase |
| mention_count | integer NOT NULL DEFAULT 1 | incremented on repeat |
| first_seen_at | timestamp NOT NULL | |
| last_seen_at | timestamp NOT NULL | |
| sample_context | text NULL | one representative excerpt |

UNIQUE `(tenant_id, COALESCE(owner_id,'00000000-0000-0000-0000-000000000000'::uuid), alias)`. **Promotion to a real page is a deliberate lint-job policy decision** (threshold: `mention_count >= 3` or classifier confidence above a configured bar), **never an automatic side-effect of ingest.**

### `wiki_section_sources`
Provenance: which memory records contributed to a section. Lets us explain *why* a claim is in the wiki.

| column | type | notes |
|---|---|---|
| section_id | uuid NOT NULL | FK → wiki_page_sections.id ON DELETE CASCADE |
| source_kind | text NOT NULL | `memory_record`, `thread_message`, `manual` |
| source_ref | text NOT NULL | normalized record id (e.g., `memory:<record_id>`), `thread:<thread_id>:<message_id>` |
| first_seen_at | timestamp NOT NULL | |

PK: `(section_id, source_kind, source_ref)`.

### `wiki_compile_jobs`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid NOT NULL | |
| owner_id | uuid NULL | |
| trigger_kind | text NOT NULL | `post_turn`, `manual`, `backfill` |
| trigger_ref | text NULL | e.g., `thread:<id>`, `batch:<id>` |
| dedupe_key | text NOT NULL | see below |
| status | text NOT NULL DEFAULT 'pending' | `pending`, `running`, `succeeded`, `failed` |
| attempt_count | integer NOT NULL DEFAULT 0 | |
| last_error | text NULL | |
| scheduled_at | timestamp NOT NULL default now() | |
| started_at / finished_at | timestamp NULL | |

**Dedupe key construction** (deliberate, not clever): computed at insert time as
```
sha256(
  tenant_id || ':' ||
  coalesce(owner_id::text, '_') || ':' ||
  trigger_kind || ':' ||
  coalesce(trigger_ref, '_') || ':' ||
  floor(extract(epoch from now()) / 300)::text   -- 5-minute bucket
)
```
This gives a real short-window idempotency key, handles `owner_id IS NULL` deterministically, and is testable. **Do not try to do short-window dedupe with a composite unique constraint alone** — NULL semantics in Postgres will silently bite you.

Indexes: `UNIQUE(dedupe_key)` (the idempotency guarantee), `(tenant_id, status, scheduled_at)` for the drain query.

### Migration notes
- New migration: `packages/database-pg/drizzle/0006_wiki_compiler.sql` — generated via `pnpm -C packages/database-pg drizzle-kit generate`, then hand-edited to prepend the extension and check constraints drizzle-kit won't emit.
- pgvector is **not currently enabled**. The migration must include `CREATE EXTENSION IF NOT EXISTS vector;` as its first statement.
- Re-export from `packages/database-pg/src/schema/index.ts`.

---

## Lambda: `wiki-compile`

**File**: `packages/api/src/handlers/wiki-compile.ts`

**Invocation**: async (`InvocationType: "Event"`) from the memory-retain handler, after the existing `adapter.retainTurn()` call at `packages/api/src/handlers/memory-retain.ts:65`. The existing `scheduled-jobs.ts:77` LambdaClient.InvokeCommand pattern is the template.

**Event shape**:
```ts
{ tenantId: string, ownerId?: string, triggerKind: "post_turn", triggerRef: string }
```

**Handler flow** (thin orchestrator; real work in `packages/api/src/lib/wiki/compiler.ts`):

1. **Self-debounce** — check for a later pending job on the same scope; if present, exit. Otherwise wait 120s and proceed.
2. **Claim jobs** — `SELECT … FROM wiki_compile_jobs WHERE tenant_id = $1 AND status = 'pending' ORDER BY scheduled_at LIMIT 5 FOR UPDATE SKIP LOCKED` → mark `running`.
3. **Load candidate memories** — call `memoryAdapter.listRecordsUpdatedSince({ tenantId, ownerId, cursor, limit: 100 })`. Consumes `ThinkWorkMemoryRecord` only. **Read-only** — canonical memory is not mutated.
4. **Classify (Bedrock call 1)** — single prompt: *"Given these N memory fragments and this catalog of existing wiki pages (slug, title, summary), which pages does each fragment affect? Propose new pages for fragments that don't fit. Distinguish topic / entity / decision."* Returns a JSON plan:
   ```ts
   {
     pageUpdates: [{ slug, sectionPatches: [{ sectionSlug, intent, sourceRefs }] }],
     newPages:    [{ pageType, titleHint, initialSections: [...] }],
     unresolvedMentions: [{ alias, sampleContext }]
   }
   ```
   **The model returns *intent*, not final DB mutations.** The repository layer remains responsible for slug allocation, alias resolution, link validation, and transactional writes. The classifier never steers persistence rules — this guardrail is load-bearing for operational sanity.
5. **Apply plan** (`lib/wiki/repository.ts`):
   - For each `pageUpdate`, acquire the appropriate lock (per-tenant advisory lock for entity pages; per-user for others), load page + sections, run `diffSections(existing, plan)`, and **for each changed section** call a second, narrower Bedrock prompt that rewrites *just that section* given the new fragments + the prior section body. Full-page rewrites are forbidden in v1.
   - For each `newPage`, allocate a slug (check `wiki_page_aliases` first), insert `wiki_pages` row with the correct scope (`owner_id=NULL` for entities, per-user otherwise), + initial sections.
   - Resolve outbound links: scan `[[alias]]` patterns against `wiki_page_aliases` and upsert `wiki_page_links` rows. **Unresolved aliases upsert into `wiki_unresolved_mentions` with `mention_count` incremented.** No stub page creation.
   - For each unresolved-mention returned by the classifier, upsert into `wiki_unresolved_mentions`.
   - (v1.1) Embed updated sections via Bedrock Titan `amazon.titan-embed-text-v2:0`. **v1 leaves `body_embedding` NULL**.
   - Insert `wiki_section_sources` rows for provenance.
6. **Commit + finalize** — single transaction per page; update `last_compiled_at`; mark job `succeeded`. On exception, increment `attempt_count`, store `last_error`, requeue if `attempt_count < 3`.

**Drain loop**: handler runs until no pending jobs remain for the tenant (Lambda timeout guard: 8 minutes).

---

## Lambda: `wiki-lint` (nightly)

**File**: `packages/api/src/handlers/wiki-lint.ts`
**Trigger**: EventBridge scheduled rule, once per day per tenant (piggybacks on the existing automations / job-schedule-manager pattern).

**v1 scope: structural hygiene only.**
- Orphan pages (no inbound links, no recent compile activity) → mark `stale`.
- Broken links (links whose target page no longer exists).
- Duplicate aliases.
- Overgrown pages (section count or byte-length above thresholds → flag for manual split).
- Rebuild `wiki_page_aliases` from entity-type page titles.
- Promote `wiki_unresolved_mentions` rows with `mention_count >= 3` into real entity pages (single deliberate path for page creation outside of classifier intent).

**Contradiction detection is experimental in v1** — behind a feature gate, logs findings to CloudWatch only, no table, no UI. We measure false-positive rate on real data before investing in any resolution workflow. **Do not treat this as a core v1 deliverable.**

---

## Lambda: `wiki-export` (nightly)

**File**: `packages/api/src/handlers/wiki-export.ts`
**Trigger**: EventBridge, nightly.

**Job**: render Aurora → markdown vault → zip → S3.
- For each tenant, for each active page, concatenate sections by position, prepend frontmatter (slug, aliases, version, compiled_at, source refs), produce `pages/<page_type>/<slug>.md`.
- Build `index.md` and `log.ndjson` from compile-job history.
- Zip, upload to `s3://thinkwork-<stage>-wiki-exports/tenants/<tenantId>/vault.zip`.
- Retain last 7 nightly exports (S3 lifecycle rule).

**This satisfies portability and inspectability without putting markdown on the operational read/write path.**

---

## Bedrock client helper (new)

**File**: `packages/api/src/lib/bedrock.ts`

The API package has **no existing Bedrock client** — runtime LLM calls currently route through AgentCore. The wiki compiler needs direct control over prompts, caching, and model choice, so a thin wrapper is justified:

```
invokeClaude({ model, system, messages, cacheSystem: true, maxTokens, toolConfig? })
invokeTitanEmbedding({ inputText }) → number[]   // v1.1 only
```

**Rule (explicit boundary, stated now so it doesn't get muddy later)**: direct Bedrock calls are allowed **only for background compile / lint / export workflows**. Runtime conversational agent orchestration continues to flow through the main runtime path (AgentCore strands container). This prevents ThinkWork from accreting two overlapping LLM plumbing layers for the same job.

- Uses `@aws-sdk/client-bedrock-runtime`.
- **Prompt caching on system block** (the page-catalog context is stable across sections within a compile pass — big cache hit ratio expected).
- Default model: **Claude Sonnet 4.6** (`claude-sonnet-4-6`) for both classify + section-rewrite. Opus only if/when we enable lint contradiction resolution. Cost target: compile pass < $0.02 per tenant per day at steady state — validate on dev before scaling.
- Region from `process.env.AWS_REGION` (same pattern as existing AgentCore invoke).

---

## Wiring into `memory-retain`

**File**: `packages/api/src/handlers/memory-retain.ts`

Change is small and additive. After line 65's `adapter.retainTurn(…)` completes (line ~72 per the exploration report):

1. `INSERT INTO wiki_compile_jobs (tenant_id, owner_id, trigger_kind, trigger_ref, dedupe_key) … ON CONFLICT (dedupe_key) DO NOTHING` — dedupes rapid-fire turns within the 5-minute bucket.
2. Fire the `wiki-compile` Lambda: `lambdaClient.send(new InvokeCommand({ FunctionName: process.env.WIKI_COMPILE_FUNCTION_NAME, InvocationType: "Event", Payload: … }))`.
3. **Never block or fail the retain path on wiki errors.** Wrap in try/catch, log, continue.

**Architectural spine (restated)**: the wiki compiler is strictly downstream and rebuildable. Loss or delay of a compile job must never threaten canonical memory retention.

Feature gate: `process.env.WIKI_COMPILER_ENABLED === "true"`. Off by default until the first tenant opts in.

---

## GraphQL read API

New `.graphql` file: `packages/database-pg/graphql/types/wiki.graphql`. Follow the pattern at `packages/database-pg/graphql/types/memory.graphql:82` and `packages/api/src/graphql/resolvers/memory/memoryRecords.query.ts:47`.

```graphql
type WikiPage {
  id: ID!
  slug: String!
  title: String!
  pageType: String!
  summaryMd: String!
  bodyMd: String!          # rendered from stored sections
  status: String!
  version: Int!
  lastCompiledAt: DateTime
  sections: [WikiPageSection!]!
  outboundLinks: [WikiPageLink!]!
  backlinks: [WikiPageLink!]!
}
type WikiPageSection { id: ID! slug: String! heading: String! bodyMd: String! position: Int! lastSourceAt: DateTime }
type WikiPageLink    { fromPageId: ID! toPageId: ID! anchorSectionSlug: String contextExcerpt: String }
type WikiSearchHit   { slug: String! title: String! pageType: String! summary: String! score: Float! }

extend type Query {
  wikiPages(pageType: String, limit: Int = 50, cursor: String): WikiPageConnection!
  wikiPage(slug: String!): WikiPage
  wikiBacklinks(slug: String!): [WikiPageLink!]!
  wikiSearch(query: String!, pageType: String, limit: Int = 5): [WikiSearchHit!]!
}
extend type Mutation {
  compileWikiNow: Boolean!  # admin-only manual trigger, enqueues a compile job for ctx.auth.tenantId
}
```

Resolvers in `packages/api/src/graphql/resolvers/wiki/`:
- `wikiPages.query.ts`, `wikiPage.query.ts`, `wikiBacklinks.query.ts`, `wikiSearch.query.ts`, `compileWikiNow.mutation.ts`, `index.ts`.
- All scoped by `ctx.auth.tenantId` (application-layer WHERE, matching existing convention — no RLS).
- `wikiSearch` uses Postgres full-text (`tsv @@ plainto_tsquery(...)`), filtered by `tenant_id = ctx.auth.tenantId AND (owner_id = ctx.userId OR owner_id IS NULL)` for visibility — tenant-shared entity pages are visible to all caregivers; per-user pages only to owner.

---

## Agent tools (new)

Registered in the AgentCore strands container (`packages/agentcore-strands/agent-container/`):

- `searchWiki({ query, pageType? })` → wraps GraphQL `wikiSearch`, returns ranked hits.
- `readWikiPage({ slug })` → wraps GraphQL `wikiPage`, returns rendered `bodyMd` + edge metadata.

Agent system prompt addition: *"If the user asks about a topic, person, or past decision, consider `searchWiki` before answering. These are compiled summaries of recurring subjects with provenance."*

---

## Terraform changes

1. **Register new Lambda handlers** in `terraform/modules/app/lambda-api/handlers.tf` `for_each` set (line 67–133): add `wiki-compile`, `wiki-lint`, `wiki-export`.
2. **New S3 bucket**: `terraform/modules/app/storage/wiki-exports.tf` — `aws_s3_bucket.wiki_exports` + lifecycle rule (7-day retention on `tenants/*/history/*`, indefinite on `tenants/*/vault.zip`).
3. **Env vars**: `WIKI_COMPILE_FUNCTION_NAME`, `WIKI_EXPORT_BUCKET`, `WIKI_COMPILER_ENABLED` added to handlers.tf env block (lines 14–50).
4. **IAM**: extend the lambda role with (a) `lambda:InvokeFunction` on the three new lambdas, (b) `bedrock:InvokeModel` on Sonnet 4.6 model ARN (Titan embed deferred to v1.1), (c) `s3:PutObject` + `s3:GetObject` on the new bucket.
5. **EventBridge schedules** for `wiki-lint` and `wiki-export` — follow the existing automations EventBridge pattern.
6. **Aurora extension**: `CREATE EXTENSION IF NOT EXISTS vector;` lives in the Drizzle migration (not Terraform).

---

## Files to create / modify

**Create**:
- `packages/database-pg/src/schema/wiki.ts`
- `packages/database-pg/drizzle/0006_wiki_compiler.sql` (generated + hand-edited for CHECK + extension)
- `packages/database-pg/drizzle/meta/0006_snapshot.json` (generated)
- `packages/database-pg/graphql/types/wiki.graphql`
- `packages/api/src/lib/bedrock.ts`
- `packages/api/src/lib/wiki/types.ts`
- `packages/api/src/lib/wiki/repository.ts`
- `packages/api/src/lib/wiki/compiler.ts`
- `packages/api/src/lib/wiki/render.ts`
- `packages/api/src/lib/wiki/prompts.ts`
- `packages/api/src/handlers/wiki-compile.ts`
- `packages/api/src/handlers/wiki-lint.ts`
- `packages/api/src/handlers/wiki-export.ts`
- `packages/api/src/graphql/resolvers/wiki/{wikiPages,wikiPage,wikiBacklinks,wikiSearch}.query.ts`
- `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts`
- `packages/api/src/graphql/resolvers/wiki/index.ts`
- `packages/agentcore-strands/agent-container/tools/search_wiki.py`
- `packages/agentcore-strands/agent-container/tools/read_wiki_page.py`
- `terraform/modules/app/storage/wiki-exports.tf`

**Modify**:
- `packages/database-pg/src/schema/index.ts` — re-export wiki schema
- `packages/database-pg/drizzle/meta/_journal.json` — updated by drizzle-kit
- `packages/api/src/lib/memory/types.ts` — add `listRecordsUpdatedSince` to the memory adapter interface
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` — implement `listRecordsUpdatedSince`
- `packages/api/src/lib/memory/adapters/agentcore-adapter.ts` — stub `listRecordsUpdatedSince` (throws `NotImplemented` in v1)
- `packages/api/src/handlers/memory-retain.ts` — add enqueue + async invoke after `adapter.retainTurn()` (line ~72)
- `packages/api/src/graphql/resolvers/index.ts` — register wiki resolvers
- `packages/agentcore-strands/agent-container/server.py` — register new agent tools
- `terraform/modules/app/lambda-api/handlers.tf` — add 3 new handlers + env vars + IAM

---

## Verification

### Worktree
Do the work in `.claude/worktrees/wiki-compiler/` off `origin/main` — not in the main checkout, which has in-flight work.

### Unit
- `lib/wiki/render.ts` → pure function `sectionsToMarkdown()`: snapshot tests on section ordering, frontmatter, link rendering.
- `lib/wiki/compiler.ts` → pure function `diffSections(existing, plan)`: asserts we only rewrite changed sections.
- **Link resolver regression test**: `[[alias]]` → either `wiki_page_links` rows or `wiki_unresolved_mentions` upsert. **Assert no code path creates a stub page.**
- Dedupe: inserting two jobs with identical `(tenant, owner, trigger_kind, trigger_ref)` within 5 minutes collapses to one row via `dedupe_key`.
- Entity scope constraint: inserting `page_type='entity'` with non-null `owner_id` fails the CHECK.
- Entity scope constraint: inserting `page_type='topic'` with null `owner_id` fails the CHECK.

### Integration (local Postgres + mocked Bedrock)
- Seed 10 normalized memory records across 3 topics for a test tenant via the Hindsight adapter.
- Invoke `wiki-compile` handler directly with a fake event.
- Assert: `wiki_pages` has 3 rows, each with ≥1 section, `wiki_section_sources` links to the seeded records, outbound links resolve or become `wiki_unresolved_mentions` rows.
- Re-run with 5 more memories touching the same topics → assert sections are *updated in place* (same `section_slug`, new `updated_at`), not duplicated.
- **Entity-scoping end-to-end**: seed a memory referring to a care recipient; assert the compiled entity page has `owner_id IS NULL` and is visible to a second test caregiver in the same tenant via `wikiSearch`.
- **Unresolved mention promotion**: seed 3 memories referencing the same unresolved alias; run compile + lint; assert the alias is promoted to an entity page.

### End-to-end on a dev tenant
- Feature-flag `WIKI_COMPILER_ENABLED=true` on dev.
- Run 5 real chat turns in the mobile app on a known topic (e.g., a care recipient).
- Query `wikiPage(slug: …)` and `wikiSearch(query: …)` via GraphQL; confirm the rendered markdown reads cleanly and includes provenance pointing to real normalized memory records.
- Compare: ask the agent the same question *with* and *without* the `searchWiki` tool enabled. Measure whether the wiki version gives a more coherent, less-fragmented answer. **This is the primary v1 go/no-go signal.**

### Terraform
- `terraform plan` in the app module: clean, only the expected new resources, no drift on existing ones.

### Cost sanity check
- After 24h of real usage on dev, pull CloudWatch metrics for Bedrock token usage from `wiki-compile`; confirm per-tenant-per-day cost is within the < $0.02 target. If not, investigate prompt-cache hit rate before scaling.

---

## Explicit v1.1 deferrals (do not build now)

- `wiki_page_claims` table (confidence, supersession, contradicting-source tracking) — wait until we see what Claude actually proposes to model here. Pre-modeling is speculative.
- `wiki_lint_findings` table + admin UI — v1 lint logs contradiction findings to CloudWatch only.
- **Automatic top-N wiki injection** into every turn's context (read path option (b)). Section `body_embedding` column exists in v1 but has no HNSW index; adding retrieval in v1.1 is a query-layer change, not a schema migration.
- `timeline` page type.
- **AgentCore adapter's `listRecordsUpdatedSince`** — v1 compiler is feature-gated to Hindsight-backed deployments until AgentCore implements cursor semantics.
- Human markdown editing / Obsidian write-back — export-only in v1.

---

## Open questions to resolve during implementation (not blockers)

1. Where does the compile cursor live — a dedicated `wiki_compile_cursors` table, or derived from `max(wiki_pages.last_compiled_at)` per scope? (Default: dedicated table, clearer semantics.)
2. What's the right Bedrock `maxTokens` per section rewrite to keep the compile budget tight? (Calibrate on dev.)
3. Does the lint pass need Opus 4.6 for contradiction detection when we eventually enable it, or does Sonnet suffice? (Measure on real findings first.)
4. Tsvector maintenance — stored column refreshed by trigger on section insert/update, or `GENERATED ALWAYS AS`? (Likely trigger, because it needs to aggregate across child `wiki_page_sections` rows.)
