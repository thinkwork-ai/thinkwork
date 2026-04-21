# Compounding Memory — Implementation Plan

## Context

Pick up `.prds/compounding-memory-implementation-plan.md` and execute it end to end, with one addition: seed the system with a real user's journal data (Amy, account `acct_q0qvp7wbae6qt1kzxf3hu42h`) that already sits in `journal.*` tables in ThinkWork dev Aurora. The seed gives us ~2,829 real memory records — enough signal to prove the compounding loop and evaluate planner/section-rewrite quality against something a human would recognize.

Ship all 5 phases. Target: dev stage, `eric's Workspace` tenant only, `GiGi` agent as owner. Everything flag-gated so other tenants are untouched.

### Scoping correction (2026-04-18)

The architect shipped `.prds/compounding-memory-scoping.md`: **v1 Compounding Memory is strictly agent-scoped**. Every compiled object — pages (including `entity`), sections, aliases, unresolved mentions, compile jobs, compile cursors — belongs to exactly one `(tenant_id, owner_id)` pair. No tenant-shared pages. No `owner_id IS NULL` escape hatch. Team/company scope is deferred to a future explicit scope model (e.g. `scope_type = agent | team | company`).

PR 1 schema and repository code were drafted against the old mixed-scope model and must be reworked before the migration applies (see "PR 1 rework" section below). The migration has not been applied to any environment yet, so this is free of production cost.

## Concept package — source of truth for product + architecture intent

This build plan is **downstream** of the following concept documents. If this plan and any of these conflict, the concept docs win; amend this plan rather than silently diverging. Re-read the relevant doc before making a non-obvious decision in code.

- `.prds/compounding-memory-scoping.md` — **authoritative v1 scope override**. Supersedes conflicting scope language in the other docs: every compiled object is owner-scoped in v1.
- `.prds/compounding-memory-implementation-plan.md` — phased delivery plan, epic breakdown, risk register, sequencing rules
- `.prds/compounding-memory-review.md` — human-readable review narrative and strongest takeaways from the concept work
- `.prds/compounding-memory-company-second-brain-prd.md` — product framing and business-facing articulation (what "compounding" is supposed to feel like for users)
- `.prds/compiled-memory-layer-engineering-prd.md` — engineering architecture direction for the compiled layer (schema intent, provenance model). Note: its tenant-shared entity scope is overridden by the scoping doc for v1.
- `.prds/thinkwork-memory-compounding-pipeline-deep-dive.md` — detailed pipeline logic, planner contract shape, section-patch strategy, unresolved-mention lifecycle
- `.prds/compounding-memory-visuals.md` — diagrams for architecture, type system, and lifecycle

Specific anchor points (where the concept docs drive code decisions):

| This plan section | Anchored in |
|---|---|
| **v1 scoping — every compiled object is owner-scoped; no tenant-shared pages** | **`compounding-memory-scoping.md` (authoritative)** |
| Page types (entity / topic / decision) — type describes shape, not sharing | `compiled-memory-layer-engineering-prd.md` + scoping doc |
| Planner JSON contract (update / create / hold / promote) | `thinkwork-memory-compounding-pipeline-deep-dive.md` |
| Section patch-only-changed strategy (no full-page rewrites) | `thinkwork-memory-compounding-pipeline-deep-dive.md` |
| Unresolved mention as first-class middle state | `compounding-memory-review.md`, pipeline deep-dive |
| Provenance at section level | `compiled-memory-layer-engineering-prd.md` |
| Phased delivery, "don't broaden page taxonomy" guardrail | `compounding-memory-implementation-plan.md` |
| v1 scope cuts (no Step Functions, no embeddings, no timeline pages, **no tenant-shared pages**) | `compounding-memory-implementation-plan.md` + scoping doc |

The concrete decisions in the "Settled decisions" table below are refinements of the above — not replacements. If an implementer feels the urge to invent a new page type, add a new compile trigger, or skip provenance, stop and re-read the concept package first.

## Settled decisions (from design conversation)

| Decision | Value |
|---|---|
| **v1 scoping** | **Strictly owner-scoped. `owner_id` is NOT NULL on every compiled-memory table. No tenant-shared pages. No `owner_id IS NULL` semantics.** |
| Cursor storage | Dedicated table `wiki_compile_cursors`, PK `(tenant_id, owner_id)` — both non-null |
| Post-turn dedupe window | 5 min per `(tenant_id, owner_id)` |
| Compile gating | Feature flag `tenants.wiki_compile_enabled`, OFF by default; ON for eric's Workspace |
| Adapter support | Hindsight only in v1; AgentCore adapter throws `NotImplemented` for `listRecordsUpdatedSince` |
| Planner + rewriter model | Claude Haiku 4.5 (both); model ID in env var for easy swap |
| Section embeddings | `body_embedding vector(1024)` column present, NULL in v1 |
| Search impl | Postgres FTS over title + summary + section bodies (tsvector + GIN) |
| Rollout | Dev stage only, eric's Workspace only |
| Bulk seed source | `journal.idea` in ThinkWork dev Aurora, joined to `journal.place` + `journal.journal` |
| Bulk target | tenant `0015953e-aa13-4cab-8398-2e70f73dda63`, agent `b6b241d5-c523-4b33-9de0-c495e1991a0d` (GiGi) |
| Bulk compile strategy | Suppress per-record enqueue during import; ONE terminal compile at end, bound to GiGi's scope |
| Import entry point | GraphQL admin mutation `bootstrapJournalImport(accountId, tenantId, agentId, limit?)` |
| Page types | entity / topic / decision — **all owner-scoped in v1**. Type describes page shape (sections, semantics), not sharing. |
| Unresolved promotion threshold (initial) | `mention_count >= 3 AND last_seen_at within 30 days`, configurable |
| Future shared scope | Deferred to explicit `scope_type = agent \| team \| company` model. Will **not** piggyback on `owner_id = NULL`. |

## Critical-path sequencing

Ship as stacked PRs; each PR leaves main green and feature-flagged off by default.

1. **PR 1 — Phase 1: Schema + repository** (Epic 1, 2)
2. **PR 2 — Phase 2: Adapter cursor + memory-retain enqueue** (Epic 3, 4)
3. **PR 3 — Phase 3: Compiler core + sections + unresolved mentions** (Epic 5, 6, 7)
4. **PR 4 — Phase 4: GraphQL + agent tools + nightly lint/export** (Epic 8, 9, 10)
5. **PR 5 — Phase 5: Replay + bulk journal import + rollout hardening** (Epic 11, 12 + import epic)

---

## PR 1 — Schema + repository

### Files to create

- `packages/database-pg/src/schema/wiki.ts` — all wiki_* tables
- `packages/database-pg/drizzle/NNNN_wiki_compound_memory.sql` — generated migration
- `packages/api/src/lib/wiki/repository.ts` — DB access helpers

### Files to modify

- `packages/database-pg/src/schema/index.ts` — export new schema namespace
- `packages/database-pg/src/schema/core.ts` (or wherever `tenants` lives) — add `wiki_compile_enabled boolean not null default false`

### Schema (Drizzle, snake_case, uuid PKs, timestamptz)

```ts
// wiki_pages — compiled pages (strictly owner-scoped in v1)
{
  id uuid PK
  tenant_id uuid NOT NULL
  owner_id uuid NOT NULL               // v1: always set; references agents.id
  type text NOT NULL                    // 'entity' | 'topic' | 'decision' (shape, not scope)
  slug text NOT NULL                    // lowercase, dash-separated
  title text NOT NULL
  summary text NULL                     // short blurb for search + agent context
  body_md text NULL                     // rendered from sections, denormalized for fast read
  search_tsv tsvector                   // generated from title + summary + body_md
  status text NOT NULL DEFAULT 'active' // 'active' | 'archived'
  last_compiled_at timestamptz NULL
  created_at, updated_at

  // NO check constraint on type vs owner — scope is uniform
  UNIQUE (tenant_id, owner_id, type, slug)
  INDEX (tenant_id, owner_id, type, status)
  INDEX GIN (search_tsv)
}

// wiki_page_sections — one row per section
{
  id uuid PK
  page_id uuid NOT NULL → wiki_pages
  section_slug text NOT NULL            // 'overview', 'visits', 'notes', etc.
  heading text NOT NULL
  body_md text NOT NULL
  position int NOT NULL
  body_embedding vector(1024) NULL      // present but NULL in v1
  last_source_at timestamptz NULL
  created_at, updated_at
  UNIQUE (page_id, section_slug)
  INDEX (page_id, position)
}

// wiki_page_links — explicit page-to-page references
{
  id uuid PK
  from_page_id uuid NOT NULL → wiki_pages
  to_page_id uuid NOT NULL → wiki_pages
  context text NULL
  created_at
  UNIQUE (from_page_id, to_page_id)
  INDEX (to_page_id)
}

// wiki_page_aliases — alternate names that resolve to a page
{
  id uuid PK
  page_id uuid NOT NULL → wiki_pages
  alias text NOT NULL                   // lowercased for matching
  source text NOT NULL                  // 'compiler' | 'manual' | 'import'
  created_at
  UNIQUE (page_id, alias)
  INDEX (alias)                         // for reverse lookup by alias
}

// wiki_unresolved_mentions — middle-state aliases not yet promoted
{
  id uuid PK
  tenant_id uuid NOT NULL
  owner_id uuid NOT NULL                // v1: always set
  alias text NOT NULL
  alias_normalized text NOT NULL        // lowercased, punctuation-stripped, whitespace-collapsed
  mention_count int NOT NULL DEFAULT 1
  first_seen_at, last_seen_at
  sample_contexts jsonb                 // up to 5 recent quoted contexts
  suggested_type text NULL              // 'entity' | 'topic' | 'decision'
  status text NOT NULL DEFAULT 'open'   // 'open' | 'promoted' | 'ignored'
  promoted_page_id uuid NULL            // set when status flips to 'promoted'
  UNIQUE (tenant_id, owner_id, alias_normalized, status)
  INDEX (tenant_id, owner_id, status)
}

// wiki_section_sources — provenance
{
  id uuid PK
  section_id uuid NOT NULL → wiki_page_sections ON DELETE CASCADE
  source_kind text NOT NULL             // 'memory_unit' | 'artifact' | 'journal_idea'
  source_ref text NOT NULL              // normalized memory record id
  first_seen_at timestamptz NOT NULL DEFAULT now()
  UNIQUE (section_id, source_kind, source_ref)
  INDEX (source_kind, source_ref)       // reverse lookup: which sections cite this record?
}

// wiki_compile_jobs — job ledger (idempotency + observability)
{
  id uuid PK
  tenant_id uuid NOT NULL
  owner_id uuid NOT NULL                // v1: always set — one scope per job
  dedupe_key text NOT NULL              // `${tenant}:${owner}:${floor(created_epoch_s/300)}`
  status text NOT NULL DEFAULT 'pending' // 'pending'|'running'|'succeeded'|'failed'|'skipped'
  trigger text NOT NULL                 // 'memory_retain' | 'bootstrap_import' | 'admin' | 'lint'
  attempt int NOT NULL DEFAULT 0
  claimed_at, started_at, finished_at timestamptz NULL
  error text NULL
  metrics jsonb NULL                    // { records_read, pages_upserted, sections_rewritten, latency_ms, cost_usd }
  created_at
  UNIQUE (dedupe_key)
  INDEX (tenant_id, owner_id, status, created_at)
}

// wiki_compile_cursors — one row per (tenant, owner) scope
{
  tenant_id uuid NOT NULL
  owner_id uuid NOT NULL                // v1: always set
  last_record_updated_at timestamptz NULL
  last_record_id text NULL              // tiebreaker for same-timestamp records
  updated_at timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (tenant_id, owner_id)
}
```

### Repository helpers (`packages/api/src/lib/wiki/repository.ts`)

Drop-in primitives consumed by later PRs:

- `enqueueCompileJob({ tenantId, ownerId, trigger })` — `ON CONFLICT(dedupe_key) DO NOTHING` returning inserted/existing row
- `claimNextCompileJob(workerId, limit=1)` — `SELECT … FOR UPDATE SKIP LOCKED` + transition to running
- `completeCompileJob(jobId, { status, metrics, error? })`
- `getCursor(tenantId, ownerId)` / `setCursor(tenantId, ownerId, { updatedAt, recordId })`
- `findPageBySlug(tenantId, ownerId, type, slug)`
- `upsertPage({ … })` / `upsertSections(pageId, sections[])` — compute body_md and update `search_tsv`
- `findAliasMatches(tenantId, ownerId, aliasNormalized)` — returns `{ pageId, aliasId }[]`
- `upsertUnresolvedMention({ tenantId, ownerId, alias, context, suggestedType })`
- `recordSectionSources(sectionId, sources[])`

### Verification

- `pnpm db:generate` produces migration SQL that matches the schema above
- `pnpm tsx -e "import * as s from '@thinkwork/database-pg/schema'; console.log(Object.keys(s))"` lists the new tables
- Unit tests on repo helpers (hit local Postgres via existing test harness)
- Merge with feature flag OFF everywhere — no runtime effect

---

## PR 2 — Adapter cursor + memory-retain enqueue

### Files to modify

- `packages/api/src/lib/memory/adapter.ts` — add `listRecordsUpdatedSince(request)` to interface (optional method pattern, like `forget`/`update`)
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` — implement via SQL `SELECT … FROM hindsight.memory_units WHERE bank_id = ? AND (updated_at, id) > (?, ?) ORDER BY updated_at, id LIMIT ?`
- `packages/api/src/lib/memory/adapters/agentcore-adapter.ts` — throw `NotImplemented` (explicit, documented)
- `packages/api/src/handlers/memory-retain.ts` — after successful `retainTurn()`, attempt `enqueueCompileJob` and best-effort `LambdaClient.send(InvokeCommand, InvocationType: 'Event')` to `wiki-compile`. Swallow errors; never fail memory-retain.

### Adapter contract addition

```ts
interface MemoryAdapter {
  // … existing methods …
  listRecordsUpdatedSince?(req: {
    tenantId: string;
    ownerId: string;             // v1: required (agent scope)
    sinceUpdatedAt?: Date;
    sinceRecordId?: string;      // tiebreaker
    limit: number;
  }): Promise<{ records: ThinkWorkMemoryRecord[]; nextCursor: { updatedAt: Date; recordId: string } | null }>;
}
```

### Enqueue shape

- Check `tenants.wiki_compile_enabled` — if false, skip silently
- Check adapter capabilities — if not Hindsight, skip silently
- `ownerId` is resolved from the retained turn's agent (required). If memory-retain can't identify an owner, skip enqueue (log + move on).
- Insert job with `dedupe_key = \`${tenantId}:${ownerId}:${Math.floor(now_epoch_s / 300)}\``
- If insert skipped (conflict), a job is already in flight in this 5-min bucket — don't invoke
- If inserted, async-invoke `wiki-compile` Lambda (fire-and-forget, wrap in try/catch, log failure)

### Verification

- Unit test: mock adapter returns records with `updated_at`; cursor iteration walks them correctly including same-timestamp tiebreaks
- Integration test: call `memory-retain` handler with flag OFF → no job row; flag ON → job row inserted; second call within 5 min → no second row
- Manual: retain a real turn via dev, confirm job row appears; no compile handler exists yet so status stays `pending`

---

## PR 3 — Compiler core + sections + unresolved mentions

### Files to create

- `packages/api/src/handlers/wiki-compile.ts` — Lambda entrypoint
- `packages/api/src/lib/wiki/compiler.ts` — orchestration
- `packages/api/src/lib/wiki/planner.ts` — Bedrock planner prompt + JSON parser
- `packages/api/src/lib/wiki/section-writer.ts` — per-section rewrite prompt
- `packages/api/src/lib/wiki/templates.ts` — page skeletons per type
- `packages/api/src/lib/wiki/aliases.ts` — normalize/lookup/resolve
- `packages/api/src/lib/wiki/mentions.ts` — unresolved accumulation + promotion logic
- `terraform/modules/app/lambda-api/handlers.tf` — add `wiki-compile` to handler set (timeout 480s, memory 1024 MB, env `BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0`)

### Compiler orchestration (one `(tenant, owner)` scope per job)

```
1. Claim job (FOR UPDATE SKIP LOCKED). Job has (tenant_id, owner_id) — both non-null.
2. Read cursor for (tenant, owner). That is the only scope this job operates in.
3. Call adapter.listRecordsUpdatedSince({ tenantId, ownerId, ...cursor }) in pages of 100
4. For each page of records:
   a. Call planner with record batch + candidate existing pages from this scope
      only (slug + aliases + summaries). No cross-agent lookup, no tenant-wide merge.
   b. Planner returns JSON: { pageUpdates[], newPages[], unresolvedMentions[], promotions[] }
   c. For each pageUpdate: load page + sections, diff proposed vs current, call
      section-writer only for changed sections, upsert, record provenance
   d. For each newPage: apply page-type template, call section-writer for each
      seeded section, insert page + sections + aliases (all within this scope),
      record provenance
   e. For each unresolvedMention: upsert row within this scope (incrementing count)
   f. For each promotion: create page from unresolved row within this scope, mark
      row status='promoted'
5. Advance cursor to max(updated_at, id) seen
6. Complete job with metrics
```

**Scope invariants enforced at the compiler layer:**
- Planner prompt only receives pages / aliases / mentions from the job's `(tenant, owner)` scope.
- Every write (page upsert, section upsert, alias insert, mention upsert, link insert, provenance insert) goes through the repository with the job's `ownerId` — no "null-owner" code path.
- Cross-agent linking is out of scope for v1. If an alias matches a page owned by another agent in the same tenant, it is treated as unresolved (not a cross-scope link).

### Planner prompt contract (prototype first — lives in a versioned prompt template)

```json
{
  "pageUpdates": [
    { "pageId": "uuid", "sections": [{ "slug": "overview", "rationale": "why", "proposed_body_md": "…" }] }
  ],
  "newPages": [
    { "type": "entity|topic|decision", "slug": "taberna-dos-mercadores", "title": "Taberna dos Mercadores", "aliases": ["…"], "sections": [{ "slug":"overview", "heading":"Overview", "body_md":"…" }] }
  ],
  "unresolvedMentions": [
    { "alias": "Chef João", "suggestedType": "entity", "context": "mentioned when describing …" }
  ],
  "promotions": [
    { "mentionId": "uuid", "reason": "seen 4 times across 3 threads" }
  ]
}
```

### Section templates (initial, iterate in prototyping)

- **Entity**: `overview`, `notes`, `visits`, `related` (last renders from `wiki_page_links`)
- **Topic**: `summary`, `highlights`, `related_entities`, `recent`
- **Decision**: `context`, `decision`, `rationale`, `consequences`

### Guardrails

- `MAX_PLANNER_TOKENS_PER_BATCH = 16384`
- `MAX_SECTIONS_REWRITTEN_PER_JOB = 100` (bail + re-enqueue if hit)
- `MAX_NEW_PAGES_PER_JOB = 25` (prevents page-spam from bad planner output)
- Full-page rewrites forbidden: only section-level writes allowed

### Verification

- Unit: section diff returns correct changed slugs on representative fixtures
- Unit: alias normalization (lowercase, strip punctuation, collapse whitespace) works
- Unit: unresolved upsert increments count on repeat alias
- Integration: feed 10 synthetic records through a mocked Bedrock → verify pages + sections + provenance rows appear
- E2E on dev: flip flag on for your tenant, retain ~20 turns in a test thread, observe real compiled pages

---

## PR 4 — GraphQL + agent tools + nightly lint/export

### Files to create

- `packages/database-pg/graphql/types/wiki.graphql` — types + query/mutation extensions
- `packages/api/src/graphql/resolvers/wiki/index.ts` — aggregator
- `packages/api/src/graphql/resolvers/wiki/wikiPage.query.ts`
- `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts`
- `packages/api/src/graphql/resolvers/wiki/wikiBacklinks.query.ts`
- `packages/api/src/graphql/resolvers/wiki/compileWikiNow.mutation.ts`
- `packages/agentcore-strands/agent-container/wiki_tools.py` — `search_wiki` + `read_wiki_page`
- `packages/api/src/handlers/wiki-lint.ts`
- `packages/api/src/handlers/wiki-export.ts`
- `terraform/modules/app/lambda-api/handlers.tf` — add wiki-lint + wiki-export handlers and two `aws_scheduler_schedule` resources (lint at 02:00 UTC, export at 03:00 UTC)
- S3 bucket `thinkwork-${stage}-wiki-exports` via existing storage module pattern

### GraphQL

```graphql
extend type Query {
  wikiPage(tenantId: ID!, ownerId: ID!, type: WikiPageType!, slug: String!): WikiPage
  wikiSearch(tenantId: ID!, ownerId: ID!, query: String!, limit: Int = 20): [WikiSearchResult!]!
  wikiBacklinks(pageId: ID!): [WikiPage!]!
}
extend type Mutation {
  compileWikiNow(tenantId: ID!, ownerId: ID!): WikiCompileJob!   # admin only
}
```

Resolvers enforce tenant via `ctx.auth.tenantId`. **`ownerId` is required** on every v1 read. The resolver verifies:
- `ctx.auth.tenantId === tenantId`, AND
- the caller is either the owning agent itself OR has the tenant-admin role

There is no tenant-wide wiki read in v1. Cross-agent inspection is an admin-only path (only unlocked via admin role; not exposed to normal agents). `wikiBacklinks(pageId)` resolves the page's owner scope internally and checks the same visibility rule.

### Agent tools (follow Hindsight pattern — `async def`, fresh client per call, `aclose` in `finally`)

- `search_wiki(query: str) -> str` — wraps `wikiSearch`; resolves `ownerId` from the caller's own agent identity (never passed by the model)
- `read_wiki_page(slug: str, type: str = "entity") -> str` — wraps `wikiPage`; same owner-derivation
- Register in `packages/agentcore-strands/agent-container/server.py` alongside `hindsight_recall`/`hindsight_reflect`

The tools must never expose another agent's compiled knowledge within the same tenant. Owner scope is derived from the agent's own identity at tool-call time (not from a model-supplied argument).

### Lint (hygiene only in v1)

- Broken links (target page missing/archived)
- Duplicate aliases across different pages in same scope
- Stale pages (no update in 90d, no recent provenance activity)
- Oversize pages (>8000 tokens — surface warning)
- Promotion sweep: scan `wiki_unresolved_mentions` where `count >= 3 AND last_seen >= now()-30d`, enqueue promotion via next compile job (don't mutate directly)

### Export (per-agent bundle)

- **One export bundle per `(tenant, owner)`**. No tenant-wide vault in v1.
- For each page: render frontmatter (tenant, owner, type, slug, title, last_compiled_at, provenance refs, aliases) + page body
- Tree inside bundle: `<type>/<slug>.md`
- Upload as zip to `s3://thinkwork-${stage}-wiki-exports/<tenant_slug>/<owner_slug>/<yyyy-mm-dd>/vault.zip`
- Retention: keep 30 days
- The nightly export Lambda iterates `(tenant, owner)` pairs that have `wiki_compile_enabled=true` and at least one compiled page.

### Verification

- GraphQL: `pnpm playground` queries for wikiSearch on seeded data, visibility enforced
- Agent tools: new chat thread with GiGi references a page by name, observe `search_wiki` call in traces, response cites page
- Lint: run locally against seeded data, expect clean output (no broken links initially)
- Export: manual invoke → zip appears in S3, unzip + spot-check a few pages render

---

## PR 5 — Replay + bulk journal import + rollout hardening

### Files to create

- `packages/api/src/graphql/resolvers/admin/bootstrapJournalImport.mutation.ts` — admin-only import entry point
- `packages/api/src/graphql/resolvers/admin/resetWikiCursor.mutation.ts` — admin-only replay control
- `packages/api/src/lib/wiki/journal-import.ts` — ingest logic
- `packages/database-pg/graphql/types/admin.graphql` — extend with new mutations

### `bootstrapJournalImport(accountId, tenantId, agentId, limit?)`

Flow:

1. Validate tenant + agent exist, caller is admin
2. Stream `journal.idea` rows for `account_id = $1` via denormalizing query:
   ```sql
   SELECT i.*, p.name AS place_name, p.address AS place_address, p.geo_lat AS place_lat, p.geo_lon AS place_lon,
          p.google_place_id, p.types AS place_types, p.metadata AS place_metadata,
          j.title AS journal_title, j.description AS journal_description, j.start_date, j.end_date, j.tags AS journal_tags
   FROM journal.idea i
   LEFT JOIN journal.place p ON p.id = i.place_id
   LEFT JOIN journal.journal j ON j.id = i.journal_id
   WHERE i.account_id = $1
   ORDER BY i.created NULLS LAST, i.id
   ```
3. For each row, build a `RetainRequest` with:
   - `content.text` = rendered prose (templated — idea body + place context + journal context)
   - `content.summary` = idea body truncated to 240 chars, or synthesized from place+tags if body empty
   - `metadata = { idea: { external_id, tags, is_visit, is_favorite, images, created, geo_lat, geo_lon }, place: { … joined fields + place_metadata }, journal: { … joined fields }, import: { account_id, journal_idea_id } }`
   - `kind = "event"`
   - `sourceType = "journal_idea"`
   - `provenance.sourceEventIds = [\`journal:idea:${idea.id}\`]`
4. Call `adapter.retain(request)` directly (NOT `retainTurn` — no conversational extraction; this is already a distilled memory unit)
5. **Suppress compile enqueue**: import sets a `suppressCompile` flag in the flow; memory-retain's enqueue path is skipped
6. Progress logging every 100 records
7. On completion: single `enqueueCompileJob({ tenantId, ownerId: agentId, trigger: 'bootstrap_import' })` that drains the full cursor range in one pass
8. Return `{ recordsIngested, compileJobId }`

### Prose template (initial)

```
{{idea.body || "Visited."}}{{#if journal.title}}

From journal "{{journal.title}}"{{#if journal.start_date}} ({{journal.start_date}}{{#if journal.end_date}}–{{journal.end_date}}{{/if}}){{/if}}.{{/if}}{{#if place.name}}

Place: {{place.name}}{{#if place.address}} — {{place.address}}{{/if}}{{#if place.types}} [{{place.types | join ", "}}]{{/if}}.{{/if}}{{#if idea.tags}}

Tags: {{idea.tags | join ", "}}.{{/if}}
```

### `resetWikiCursor(tenantId, ownerId)` — admin replay

`ownerId` is required. Clears cursor row → next compile re-reads from beginning for that agent scope. Optionally also sets `wiki_pages.status='archived'` for full rebuild (flagged, destructive, requires `force: true`). Never resets across multiple agents in one call — replay is always one agent at a time.

### Rollout hardening

- Operational dashboard/logs: CloudWatch metric filter on compile job `status='failed'`, latency, and cost_usd from `metrics` jsonb
- Feature flag enable: `UPDATE tenants SET wiki_compile_enabled = true WHERE id = '0015953e-...'`
- Runbook in-repo: `.prds/compounding-memory-runbook.md` (short — how to trigger compile, inspect state, rebuild)

### Verification (the proof — GiGi can read GiGi's compiled brain)

1. Deploy PR 5 to dev
2. Flip feature flag ON for eric's Workspace
3. Admin mutation: `bootstrapJournalImport(accountId: "acct_q0qvp7wbae6qt1kzxf3hu42h", tenantId: "0015953e-...", agentId: "b6b241d5-...")` with `limit: 50` first (smoke test). All records attach to GiGi's scope.
4. Inspect: ~50 records in Hindsight under GiGi's bank, 1 compile job with `owner_id = GiGi`, some pages materialize owned by GiGi
5. Validate cost: check `wiki_compile_jobs.metrics->>'cost_usd'` stays <$0.50 for 50 records
6. Re-run with no limit — 2,829 records; expect <$20 compile cost, 200+ entity pages, 20+ topic pages, <20 decision pages, **all owned by GiGi**
7. Open GraphQL playground, run `wikiSearch(tenantId, ownerId: GiGi, query: "tacos")` → relevant restaurants come back
8. New chat with GiGi: "What Portuguese restaurants has Amy been to?" → GiGi calls `search_wiki`/`read_wiki_page` (owner derived from GiGi's identity), returns real content with provenance
9. **Scope-isolation check:** create a second agent in the same tenant, run the same search — returns empty (no leakage across agents)
10. Trigger `wiki-export` manually, download vault zip at `s3://.../eric-workspace/gigi/<date>/vault.zip`, spot-check ~10 pages render cleanly
11. `resetWikiCursor(tenant, GiGi)` + `compileWikiNow(tenant, GiGi)` → identical page output (replay works)

---

## Phase 0 — exploration summary (already done)

| Question | Answer |
|---|---|
| `ThinkWorkMemoryRecord` shape | Lives at `packages/api/src/lib/memory/types.ts:46-69`; has tenant/owner/kind/content/provenance/metadata/backendRefs |
| Cursor state location for compile | NEW table `wiki_compile_cursors` (decided) |
| Lambda packaging | `toset([...])` in `terraform/modules/app/lambda-api/handlers.tf:73-115`; add new name → auto-bundled by `scripts/build-lambdas.sh` |
| GraphQL convention | `queryResolvers`/`mutationResolvers` aggregate in `packages/api/src/graphql/resolvers/index.ts`; per-domain folders; types in `packages/database-pg/graphql/types/*.graphql` |
| Agent tool pattern | `async def` + fresh client + `aclose()` in `finally`; 3-retry exponential backoff; see `packages/agentcore-strands/agent-container/server.py` hindsight_recall at ~line 627 |
| Scheduled-jobs reuse | Reference-only for nightly jobs (`scheduled-jobs.ts`); post-turn compile is Lambda async-invoke, not scheduled |

## Critical reuse (don't reinvent)

- Fire-and-forget invoke pattern: `packages/api/src/handlers/scheduled-jobs.ts:431-435` (copy for memory-retain → wiki-compile)
- Sync invoke pattern: `packages/api/src/handlers/chat-agent-invoke.ts:494-498` (copy for admin mutation → wiki-compile)
- Tenant-scoped resolver pattern: `packages/api/src/graphql/resolvers/memory/memoryRecords.query.ts:48-72`
- Drizzle table conventions: `packages/database-pg/src/schema/scheduled-jobs.ts` (three-table ledger, UUID PK, timestamptz, jsonb payloads)
- Hindsight async client pattern: `server.py` hindsight_recall/reflect (lines 627–846)
- Secrets + Aurora access: `scripts/db-push.sh` (Terraform outputs → Secrets Manager → psql URL)

## Explicit non-goals for this implementation

- **Tenant-shared / team-shared / company-shared compiled pages** (deferred to an explicit future scope model with its own promotion + privacy rules — will NOT piggyback on `owner_id = NULL`)
- **Cross-agent page lookup, alias resolution, or entity merge** within the same tenant
- **Tenant-wide wiki search or read paths** (admin-only inspect path may be added later but is not part of v1)
- Step Functions orchestration (Lambda + job table is sufficient)
- AgentCore adapter parity for `listRecordsUpdatedSince`
- timeline / project / package page types
- Automatic compiled-context injection into every chat turn
- Claims graph / contradiction engine
- Manual page editing UI
- Production rollout (dev only; prod rollout is a Phase-5-style follow-up PR with its own runbook and feature-flag flip)

## PR 1 rework — required before migration applies

PR 1 code was drafted against the old mixed-scope model. The migration has not yet been applied to any environment. Rework steps (executed as the first task after plan approval):

### Schema (`packages/database-pg/src/schema/wiki.ts`)

1. **`wikiPages`**
   - `owner_id`: drop `.references(() => agents.id)`-on-nullable; make `.notNull()`
   - Remove the `check("wiki_pages_scope_check", ...)` constraint entirely
   - Replace `uniqueIndex("uq_wiki_pages_scope_slug").on(tenant_id, sql\`coalesce(owner_id, zero-uuid)\`, type, slug)` with `uniqueIndex("uq_wiki_pages_tenant_owner_type_slug").on(tenant_id, owner_id, type, slug)`
   - Update `idx_wiki_pages_tenant_type_status` to `(tenant_id, owner_id, type, status)` to match read-path access
   - Keep `idx_wiki_pages_last_compiled`, `idx_wiki_pages_search_tsv`, `idx_wiki_pages_owner` — still useful
2. **`wikiUnresolvedMentions`**
   - `owner_id`: `.notNull()`
   - Replace `uq_wiki_unresolved_mentions_scope_alias_status` with plain `(tenant_id, owner_id, alias_normalized, status)` (no COALESCE)
3. **`wikiCompileJobs`**
   - `owner_id`: `.notNull()`
4. **`wikiCompileCursors`**
   - `owner_id`: `.notNull()`
   - Replace `uq_wiki_compile_cursors_scope` (COALESCE unique index) with a composite primary key on `(tenant_id, owner_id)` — drizzle's `primaryKey({ columns: [...] })` helper

### Migration regeneration

1. Delete `packages/database-pg/drizzle/0012_groovy_speed.sql`
2. Delete `packages/database-pg/drizzle/meta/0012_snapshot.json`
3. Revert the `0012` entry in `packages/database-pg/drizzle/meta/_journal.json`
4. Run `pnpm --filter @thinkwork/database-pg db:generate` to emit a fresh `0012_*.sql`
5. Hand-edit the new migration to:
   - Prepend `CREATE EXTENSION IF NOT EXISTS vector;` (drizzle doesn't emit this for us)
   - Append the catch-up `ALTER TABLE "threads" DROP COLUMN IF EXISTS …` statements (drizzle snapshot already reflects the Task-strip removal from commit c4b92d2; the DB still has them)

### Repository (`packages/api/src/lib/wiki/repository.ts`)

1. Narrow every exported type's `ownerId: string | null` → `ownerId: string`. Affected:
   - `WikiCompileJobRow.owner_id`
   - `WikiCompileCursorRow.owner_id`
   - `WikiPageRow.owner_id`
   - `UpsertPageInput.owner_id`
   - `UpsertUnresolvedInput.owner_id`
2. Drop every `ownerId === null ? sql\`IS NULL\` : eq(...)` branch. Every query becomes a plain `eq(owner_id, ownerId)`. Affected functions:
   - `enqueueCompileJob` (dedupe key), `getCursor`, `setCursor`, `resetCursor`
   - `findPageBySlug`
   - `upsertPage` transaction body
   - `findAliasMatches` — also drop the "entity pages are visible regardless of owner" join clause; aliases resolve only within the caller's owner scope
   - `upsertUnresolvedMention`
   - `listPromotionCandidates` — remove the `args.ownerId === undefined ? sql\`1=1\` : …` branch; owner is required
3. Update `buildCompileDedupeKey` to drop the `ownerId ?? 'shared'` fallback — signature becomes `{ tenantId: string; ownerId: string }`
4. No other public surface changes.

### Downstream expectations

- `memory-retain` (PR 2): must resolve `ownerId` from the agent that owns the retained turn. If absent, skip enqueue rather than falling back to a shared-scope compile.
- Compiler (PR 3) prompt templates: planner context should list only pages owned by the job's agent, never cross-agent.
- GraphQL (PR 4): `ownerId` is a required GraphQL arg on `wikiPage`, `wikiSearch`, `compileWikiNow`. Visibility rule: caller must be the owning agent OR admin.
- Agent tools (PR 4): `search_wiki`/`read_wiki_page` resolve `ownerId` from the calling agent's identity. The model never names a different agent.
- Export (PR 4): one bundle per `(tenant, owner)`; no tenant-wide vault.

### Verification of rework

- Typecheck clean on `@thinkwork/database-pg` + `@thinkwork/api`
- Fresh migration SQL inspected: `wiki_pages.owner_id NOT NULL`, no CHECK constraint, unique index uses plain `(tenant_id, owner_id, type, slug)`, `wiki_compile_cursors` has composite PK
- All 209 existing api tests still pass
- Schema export list still shows all 8 wiki tables + their `*Relations` (16 symbols)

## Risk register (monitor during execution)

| Risk | Mitigation |
|---|---|
| Planner produces junk new pages | `MAX_NEW_PAGES_PER_JOB`; visible in metrics; iterate on prompt |
| Unresolved mentions never promote | Manual `compileWikiNow` with promotions-only mode; adjust threshold |
| 5-min dedupe too tight under bulk | Bulk path already bypasses; not an issue for import. Monitor for real-chat bursts |
| Hindsight `updated_at` not monotonic on replay | Tiebreaker is `(updated_at, record_id)`; cursor persists both |
| Bedrock cost runaway | Metrics per job in `wiki_compile_jobs.metrics`; CloudWatch alarm on daily sum |
| Section embeddings column migration cost later | Column is added now (nullable), no backfill needed if/when we populate |
| Future shared-scope migration painful | Out-of-scope in v1 but noted: when we add `scope_type`, prefer a new `wiki_scopes` table + FK rather than mutating `wiki_pages.owner_id` semantics |
| Cross-agent data leakage via GraphQL or agent tool | `ownerId` required on every read; tools derive owner from caller identity, never from model input; add scope-isolation test step in PR 5 verification |
