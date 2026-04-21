# Compiled Memory Layer, Engineering Implementation PRD

## Summary

This document describes the engineering design for ThinkWork's **compiled memory layer**.

The compiled layer sits **above** ThinkWork's normalized long-term memory plane. It is **downstream, rebuildable, and non-canonical**. Canonical durable recall remains owned by the selected memory engine, currently Hindsight and later AgentCore Memory.

The compiled layer produces structured pages for entities, topics, and decisions, stores them in Aurora as the operational source of truth, exposes them through GraphQL and agent tools, and exports nightly markdown vaults to S3 for portability.

## Architectural position

The stack is:

1. **Threads / work record** as canonical interaction history
2. **Normalized memory layer** as canonical durable recall, backed by Hindsight or AgentCore
3. **Compiled memory layer** as synthesized pages derived from normalized memory records
4. **Agent read path** that retrieves compiled knowledge into runtime context when useful

Guardrails:

- compiled memory is strictly downstream and rebuildable
- loss or delay of compile jobs must never affect canonical memory retention
- compiled pages are projections, not source of truth
- Aurora is primary for operational reads and writes
- markdown is export format, not operational database
- model output must not become canonical truth without grounding and policy constraints

## Why Aurora primary

Aurora primary is the correct v1 design.

Reasons:
- main consumers are the product surface and runtime agent path, both of which want structured reads
- referential integrity, scoped visibility, and partial updates are easier in Aurora than markdown-primary storage
- GraphQL and tooling want relational state
- markdown export remains easy and preserves portability

This keeps the system app-first while still giving users a portable markdown vault.

## End-to-end architecture

```text
Chat turn → existing memory-retain Lambda
              ├── adapter.retainTurn()  [unchanged]
              └── enqueueWikiCompile()  [NEW]
                       ↓
                 wiki_compile_jobs row
                       ↓
                 wiki-compile Lambda (async invoke)
                       ↓
              ┌────────┴─────────┐
              │ Bedrock Claude   │
              │ classify + patch │
              └────────┬─────────┘
                       ↓
      Aurora: wiki_pages + wiki_page_sections + wiki_page_links
              + wiki_unresolved_mentions + wiki_section_sources
                       ↓
         (nightly) wiki-lint Lambda
         (nightly) wiki-export Lambda
                       ↓
              GraphQL read API + agent tools
```

Important detail: async invoke is paired with a persisted job row. The async invoke gives low-latency fire-and-forget behavior. The job table provides retry, idempotency, observability, and recovery if an invoke is dropped.

## Page model and scope

v1 page types:
- `entity`
- `topic`
- `decision`

Scope rules:
- `entity` pages are tenant-shared and therefore `owner_id IS NULL`
- `topic` and `decision` pages are per-user and therefore `owner_id IS NOT NULL`

This is enforced with a CHECK constraint on `wiki_pages`.

Tenant-shared entity writes should take a per-tenant advisory lock to avoid race conditions during concurrent compile passes.

## Normalized memory read path

The compiler must read via the normalized memory adapter interface, not Hindsight-native tables.

New method in `packages/api/src/lib/memory/types.ts`:

```ts
listRecordsUpdatedSince(args: {
  tenantId: string;
  ownerId?: string;
  cursor?: string;
  limit: number;
}): Promise<{ records: ThinkWorkMemoryRecord[]; nextCursor?: string }>;
```

Implementation plan:
- Hindsight adapter implements it using `memory_units` and `updated_at > cursor_ts`
- AgentCore adapter exposes the same signature but throws `NotImplemented` in v1
- compiler consumes only `ThinkWorkMemoryRecord`
- feature gate compiler to Hindsight-backed deployments for v1 until AgentCore cursor semantics exist

## Database schema

New schema file: `packages/database-pg/src/schema/wiki.ts`

### `wiki_pages`
Purpose: logical page record.

Core columns:
- `id` uuid PK
- `tenant_id` uuid not null
- `owner_id` uuid null
- `page_type` text not null (`topic`, `entity`, `decision`)
- `slug` text not null
- `title` text not null
- `summary_md` text not null default `''`
- `status` text not null default `'active'`
- `version` integer not null default `1`
- `last_compiled_at` timestamp null
- `last_linted_at` timestamp null
- `tsv` tsvector
- timestamps

Indexes and constraints:
- unique on `(tenant_id, COALESCE(owner_id, zero-uuid), slug)`
- index on `(tenant_id, page_type)`
- index on `(tenant_id, last_compiled_at)`
- GIN on `tsv`
- CHECK enforcing entity shared scope vs topic/decision per-user scope

### `wiki_page_sections`
Purpose: surgical update unit for partial rewrites.

Core columns:
- `id`
- `page_id`
- `section_slug`
- `heading`
- `body_md`
- `position`
- `body_embedding vector(1024) null`
- `last_source_at`
- timestamps

Notes:
- page markdown is rendered by concatenating sections ordered by `position`
- `body_embedding` exists in v1 but remains unindexed and nullable
- unique `(page_id, section_slug)`

### `wiki_page_links`
Purpose: explicit backlink and outbound-link graph.

Core columns:
- `id`
- `from_page_id`
- `from_section_id`
- `to_page_id`
- `anchor_section_slug`
- `context_excerpt`
- `created_at`

Backlinks should be derived from rows, not inferred from markdown at read time.

### `wiki_page_aliases`
Purpose: alias resolution for linking and entity resolution.

Core columns:
- `id`
- `tenant_id`
- `page_id`
- `alias`

Unique `(tenant_id, alias)`.

### `wiki_unresolved_mentions`
Purpose: queue unknown aliases instead of auto-creating stub pages.

Core columns:
- `id`
- `tenant_id`
- `owner_id`
- `alias`
- `mention_count`
- `first_seen_at`
- `last_seen_at`
- `sample_context`

Unique on scope plus alias using `COALESCE(owner_id, zero-uuid)`.

Policy: no automatic stub page creation during ingest. Promotion is handled deliberately by lint policy.

### `wiki_section_sources`
Purpose: provenance from compiled section back to normalized source records.

Columns:
- `section_id`
- `source_kind`
- `source_ref`
- `first_seen_at`

PK on `(section_id, source_kind, source_ref)`.

### `wiki_compile_jobs`
Purpose: background job ledger for idempotent compile scheduling.

Core columns:
- `id`
- `tenant_id`
- `owner_id`
- `trigger_kind`
- `trigger_ref`
- `dedupe_key`
- `status`
- `attempt_count`
- `last_error`
- `scheduled_at`
- `started_at`
- `finished_at`

`dedupe_key` should be built from tenant, owner scope, trigger fields, and a 5-minute time bucket. Unique on `dedupe_key`.

## Migration notes

New migration:
- `packages/database-pg/drizzle/0006_wiki_compiler.sql`

Requirements:
- include `CREATE EXTENSION IF NOT EXISTS vector;` at the top
- hand-edit generated migration for CHECK constraints and any unsupported emitted details
- re-export schema from `packages/database-pg/src/schema/index.ts`

## Compile trigger wiring

Modify `packages/api/src/handlers/memory-retain.ts`.

After `adapter.retainTurn()` completes:
1. insert `wiki_compile_jobs` row with dedupe protection
2. async invoke `wiki-compile` Lambda using `InvocationType: "Event"`
3. wrap wiki enqueue/invoke in try/catch and never fail the retain path on wiki errors

Feature gate:
- `WIKI_COMPILER_ENABLED === "true"`
- default off until first tenant opt-in

## `wiki-compile` Lambda

File:
- `packages/api/src/handlers/wiki-compile.ts`

Core orchestrator logic should live in:
- `packages/api/src/lib/wiki/compiler.ts`
- `packages/api/src/lib/wiki/repository.ts`
- `packages/api/src/lib/wiki/prompts.ts`
- `packages/api/src/lib/wiki/render.ts`
- `packages/api/src/lib/wiki/types.ts`

### Event shape

```ts
{ tenantId: string, ownerId?: string, triggerKind: "post_turn", triggerRef: string }
```

### Flow

1. **Self-debounce**
   - if a later pending job exists for the same scope, exit
   - otherwise wait 120 seconds, re-check, then proceed

2. **Claim jobs**
   - drain pending jobs for the scope with `FOR UPDATE SKIP LOCKED`
   - mark them `running`

3. **Load candidate memories**
   - call `memoryAdapter.listRecordsUpdatedSince(...)`
   - read-only access to normalized memory

4. **Classify via Bedrock**
   - one prompt receives memory fragments and existing page catalog
   - returns JSON plan with:
     - `pageUpdates`
     - `newPages`
     - `unresolvedMentions`
   - model returns intent, not final DB mutations

5. **Apply plan**
   - lock page scope appropriately
   - load page plus sections
   - run `diffSections(existing, plan)`
   - for each changed section only, call narrower rewrite prompt
   - forbid full-page rewrites in v1
   - allocate slugs and create new pages when needed
   - resolve `[[alias]]` links through aliases table
   - unresolved aliases upsert into `wiki_unresolved_mentions`
   - insert provenance rows into `wiki_section_sources`
   - leave `body_embedding` null in v1

6. **Finalize**
   - transaction per page
   - update `last_compiled_at`
   - mark job `succeeded`
   - on failure, increment attempts, store error, retry if attempts < 3

Drain loop should continue until no pending jobs remain for the tenant, subject to an 8-minute Lambda timeout guard.

## Bedrock helper

New file:
- `packages/api/src/lib/bedrock.ts`

Needed because existing runtime LLM flows go through AgentCore, while background compile/lint/export need direct prompt and model control.

Helper surface:

```ts
invokeClaude({ model, system, messages, cacheSystem: true, maxTokens, toolConfig? })
invokeTitanEmbedding({ inputText })
```

Rules:
- direct Bedrock is allowed only for background compile, lint, and export workflows
- conversational runtime remains on the main AgentCore path
- default model for classify and rewrite is Claude Sonnet 4.6
- Titan embedding deferred to v1.1 use
- use prompt caching on stable system context such as page catalog blocks

Cost target:
- compile pass under $0.02 per tenant per day at steady state

## Lint job

File:
- `packages/api/src/handlers/wiki-lint.ts`

Trigger:
- nightly EventBridge schedule

v1 scope is structural hygiene only:
- mark orphan pages stale
- detect broken links
- detect duplicate aliases
- flag oversized pages for manual split
- rebuild aliases from entity titles
- promote unresolved mentions with sufficient threshold into real entity pages

Contradiction detection is experimental only in v1, behind a feature flag, and should log to CloudWatch without affecting state.

## Export job

File:
- `packages/api/src/handlers/wiki-export.ts`

Trigger:
- nightly EventBridge schedule

Behavior:
- render active Aurora pages to markdown files organized by page type
- prepend frontmatter with slug, aliases, version, compiled timestamp, and source refs
- build `index.md` and `log.ndjson`
- zip vault and upload to `s3://thinkwork-<stage>-wiki-exports/tenants/<tenantId>/vault.zip`
- retain last 7 nightly exports via lifecycle rule

This gives portability and inspectability without making markdown operational truth.

## GraphQL API

New file:
- `packages/database-pg/graphql/types/wiki.graphql`

Queries:
- `wikiPages`
- `wikiPage`
- `wikiBacklinks`
- `wikiSearch`

Mutation:
- `compileWikiNow` for admin-triggered enqueue

Resolvers in:
- `packages/api/src/graphql/resolvers/wiki/`

Visibility rules:
- filter by `tenant_id = ctx.auth.tenantId`
- allow `owner_id IS NULL` for tenant-shared entity pages
- allow `owner_id = ctx.userId` for per-user topic and decision pages
- application-layer scoping, consistent with existing conventions

`wikiSearch` should use Postgres full-text search over page title, summary, and section bodies through maintained `tsv`.

## Agent tools

Register in `packages/agentcore-strands/agent-container/`:
- `search_wiki.py`
- `read_wiki_page.py`

Capabilities:
- `searchWiki({ query, pageType? })`
- `readWikiPage({ slug })`

Prompt update:
- tell the agent to consider `searchWiki` when the user asks about a topic, person, or past decision

v1 chooses explicit tool use over automatic top-N page injection. Automatic injection can be evaluated in v1.1 once real retrieval behavior is measured.

## Terraform

Changes required:

1. add handlers in `terraform/modules/app/lambda-api/handlers.tf`
   - `wiki-compile`
   - `wiki-lint`
   - `wiki-export`

2. add storage in `terraform/modules/app/storage/wiki-exports.tf`
   - S3 bucket for exports
   - lifecycle rules

3. add env vars
   - `WIKI_COMPILE_FUNCTION_NAME`
   - `WIKI_EXPORT_BUCKET`
   - `WIKI_COMPILER_ENABLED`

4. extend IAM
   - `lambda:InvokeFunction`
   - `bedrock:InvokeModel`
   - S3 read/write for export bucket

5. add EventBridge schedules for lint and export

Aurora vector extension belongs in the migration, not Terraform.

## Files to create

- `packages/database-pg/src/schema/wiki.ts`
- `packages/database-pg/drizzle/0006_wiki_compiler.sql`
- `packages/database-pg/drizzle/meta/0006_snapshot.json`
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

## Files to modify

- `packages/database-pg/src/schema/index.ts`
- `packages/database-pg/drizzle/meta/_journal.json`
- `packages/api/src/lib/memory/types.ts`
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts`
- `packages/api/src/lib/memory/adapters/agentcore-adapter.ts`
- `packages/api/src/handlers/memory-retain.ts`
- `packages/api/src/graphql/resolvers/index.ts`
- `packages/agentcore-strands/agent-container/server.py`
- `terraform/modules/app/lambda-api/handlers.tf`

## Verification plan

### Unit
- `sectionsToMarkdown()` snapshot coverage
- `diffSections(existing, plan)` only rewrites changed sections
- link resolver test proves unresolved aliases create mention rows, not stub pages
- compile job dedupe test validates 5-minute collapse behavior
- page scope CHECK constraint tests for entity vs topic/decision ownership rules

### Integration
- seed normalized memories via Hindsight adapter
- run compile handler with mocked Bedrock
- assert pages, sections, provenance, and link behavior
- rerun with additional memories and assert updates happen in place
- verify entity pages are tenant-shared and visible to a second caregiver in same tenant
- verify unresolved mention promotion after compile plus lint

### End-to-end
- enable feature flag on dev
- generate real turns on known topic
- inspect `wikiPage` and `wikiSearch`
- compare answer quality with and without wiki tool access

### Infra
- run `terraform plan`
- confirm expected resources only
- inspect Bedrock usage after 24 hours and validate cost target

## v1.1 deferrals

Do not build yet:
- claims/confidence/supersession table
- persistent lint findings table and admin UI
- automatic top-N wiki injection into every turn
- timeline page type
- AgentCore adapter cursor implementation
- markdown write-back or human-primary editing flow

## Open implementation questions

- where compile cursor state should live
- ideal max token budget for section rewrites
- whether future contradiction detection needs Sonnet or Opus
- whether tsvector refresh should use trigger or generated strategy

## Recommendation

Proceed with Aurora-primary compiled memory as a downstream layer over normalized memory, with explicit agent tools in v1 and markdown export as a nightly portability path.

This preserves the architecture already established in the original PRD while making the implementation tractable, inspectable, and safe.