---
title: "feat: Make Compounding Memory actually compound"
type: feat
status: superseded
superseded_by: docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md
superseded_on: 2026-04-19
date: 2026-04-19
origin: .prds/compounding-memory-agent-brief.md
---

> **Superseded 2026-04-19.** Pressure-testing during `/ce:brainstorm` surfaced that this plan refines the leaf compiler (secondary need) rather than introducing the primary missing mechanism: **hierarchical aggregation with section-to-page promotion**, specified in [docs/plans/archived/compounding-memory-hierarchical-aggregation-plan.md](archived/compounding-memory-hierarchical-aggregation-plan.md) and diagnosed in [.prds/compounding-memory-aggregation-research-memo.md](../.prds/compounding-memory-aggregation-research-memo.md). The replacement direction lives at [docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md](../docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md). Sub-elements of this plan (alias fuzzy matching, continuation chaining, memory↔page backlink UI, compounding-health metrics) are folded into the replacement plan rather than dropped.

# feat: Make Compounding Memory actually compound

## Overview

The compile pipeline ships end-to-end (planner → section-writer → pages + sections + provenance + links), but early observations on partial data show it is not *compounding*: related memories produce duplicate or fragmented pages, pages stay thin (cite 2-3 memories out of 30 that should inform them), and the memory → page backlinks exist in the database but are invisible to the user. This plan tunes the existing loop to fix those three failure modes. No new infrastructure, no embeddings, no architectural rework.

Canonical "compounding" test case: Amy's ~2,829 journal records → GiGi's scope. If 30 memories reference Austin in various surface forms (Austin, Austin TX, ATX, "the Texas trip"), the system should land on **one** Austin page that cites all 30 and links each back to its source memory record.

## Problem Frame

ThinkWork's compounding-memory v1 compiles normalized memory records (via Hindsight) into owner-scoped wiki pages in Aurora. The architecture is settled (`.prds/compounding-memory-scoping.md`, PRs 1–5 in `.prds/compounding-memory-v1-build-plan.md`). Observations on a partial sample of real data show three concrete gaps:

1. **Fragmentation** — planner creates new pages for concepts that already have a page because the existing page fell out of its candidate list or the alias it used wasn't an exact match to an existing alias (see origin: `.prds/compounding-memory-agent-brief.md`).
2. **Thin pages** — planner sees only one batch of 50 records at a time (`RECORD_PAGE_SIZE = 50` in `packages/api/src/lib/wiki/compiler.ts`). Even if the same concept is hit across 6 batches, there is no step that re-synthesizes the page from the *full* cited-memory set. Sections grow incrementally, not holistically.
3. **Invisible compounding** — `wiki_section_sources` rows link memory → section → page, and `MemoryRecord.wikiPages` already exists in GraphQL (`packages/database-pg/graphql/types/memory.graphql`), but there's no UI on the memory detail screen that shows "Contributes to: [Austin]" and no count/drill-in of source memories on the wiki page detail screen.

The scoping doc's "agent-scoped first" rule is preserved throughout; nothing in this plan introduces cross-agent or tenant-shared compilation.

## Requirements Trace

- R1. The same concept seen across batches consolidates into a single page — measurable via `avg_sources_per_page` and `duplicate_candidate_count` health metrics.
- R2. A page with ≥ N cited memories is re-synthesized holistically so its sections reflect the full evidence set, not just the most recent batch.
- R3. Alias surface-form variance (punctuation, abbreviations, suffixes) does not create duplicate pages or duplicate unresolved-mention rows below a `pg_trgm` similarity threshold of 0.85 (matches Hindsight's established threshold — see `packages/agentcore-strands/agent-container/hindsight_recall_filter.py:46`).
- R4. From any memory record, the user can see which compiled pages cite it. From any compiled page, the user can see how many memories cite it and drill into them.
- R5. A bootstrap-scale compile (~2,829 records) completes via auto-chained jobs without manual re-trigger.
- R6. V1 scope rule preserved: every read and write stays strictly `(tenant_id, owner_id)`-scoped; no new cross-agent or tenant-shared surface is introduced.

## Scope Boundaries

- No embeddings layer (`body_embedding` stays NULL in v1 as the scoping doc already specifies).
- No rethink of the batch/cursor model — still a record-first cursor; the aggregation pass runs *alongside* it, not instead of it.
- No cross-agent merging, no tenant-shared pages, no admin inspect UI beyond what already exists.
- No manual page-editing UI.
- No new page types beyond `entity`, `topic`, `decision`.
- No changes to the Hindsight retain path.

### Deferred to Separate Tasks

- Production rollout + CloudWatch alarm tuning: follow-up PR, after dev evaluation shows health metrics moving in the expected direction.
- Full Amy → GiGi bootstrap validation (all 2,829 records + human-eyed page quality review): separate task once this plan lands; smoke-test with 100–200 records is part of this plan's verification.
- Replacing `pg_trgm` with embedding-based similarity when v1 proves trigram precision is insufficient (reviewed later via health metrics, not pre-empted here).

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/wiki/compiler.ts` — orchestration loop (batches, plan apply, cursor advance, cap handling). Canonical place to add aggregation pass + continuation chaining.
- `packages/api/src/lib/wiki/planner.ts` — Bedrock planner prompt + parser. `buildPlannerUserPrompt` lists candidate pages with summary truncated to 200 chars and aliases capped at 8.
- `packages/api/src/lib/wiki/repository.ts` — all DB primitives. `listPagesForScope` orders by `last_compiled_at DESC` and caps at 200; `findAliasMatches` does exact-normalized lookup only; `upsertUnresolvedMention` buckets by exact `alias_normalized`.
- `packages/api/src/lib/wiki/section-writer.ts` — narrow section rewriter. Reused in the aggregation pass.
- `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts` — existing reverse-path query (memory hit → sections → pages). Proven pattern to mirror for `memoryCitedByPages`.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — existing agent-scoped listing; model for read-only resolvers.
- `packages/database-pg/graphql/types/memory.graphql:30` — `MemoryRecord.wikiPages` GraphQL surface already exists; confirm resolver is implemented and exercised end-to-end.
- `packages/database-pg/src/schema/wiki.ts` — Drizzle schema; additions go here.

### Institutional Learnings

- `pg_trgm` with similarity threshold 0.85 is the established bar for fuzzy string match in this repo (Hindsight recall filter). Reuse rather than inventing a new threshold.
- The Hindsight tool pattern (`async def`, fresh client per call, `aclose()` in `finally`, retry with exponential backoff) is the required shape for any new async tool surface — see memory `feedback_hindsight_async_tools.md`.
- Fire-and-forget `LambdaClient.send(InvokeCommand, InvocationType: 'Event')` must stay wrapped in try/catch and never fail the caller — precedent in `packages/api/src/handlers/scheduled-jobs.ts` and already followed in `packages/api/src/lib/wiki/enqueue.ts`.
- OAuth-federated tenant resolution: GraphQL resolvers must use `resolveCallerTenantId(ctx)` fallback, not `ctx.auth.tenantId` alone (see `feedback_oauth_tenant_resolver.md`). `mobileWikiSearch.query.ts` already does this — follow that pattern.
- Scope-isolation test step from PR 5 risk register (cross-agent leak check) must be re-run after this plan lands.

### External References

Intentionally none — this plan lives inside existing patterns; the relevant docs are internal PRDs and the repo itself. `pg_trgm` is stock Postgres.

## Key Technical Decisions

- **`pg_trgm` similarity ≥ 0.85 for fuzzy alias match.** Reuses the Hindsight-calibrated threshold. Precision over recall — better to leave a true duplicate than collapse distinct concepts.
- **Aggregation pass runs *after* the per-batch apply inside the same compile job, not as a separate cron.** Keeps the loop simple and gives eventual consistency per compile tick; staleness-based gating (`last_resynth_at`) keeps cost bounded.
- **Holistic page re-synthesis is section-level, not full-page rewrite.** Re-plans sections given the full cited-memory set, then section-writer rewrites each changed section. Preserves the pipeline's "no full-page rewrites" invariant.
- **Backlink queries stay on the existing `wiki_section_sources` reverse-join.** No new join tables; no denormalization. Already proven in `mobileWikiSearch`.
- **Continuation chaining uses `enqueueCompileJob` with the *next* dedupe bucket.** No new queue primitive; re-uses the 5-minute bucket. For bootstrap the importer still does a single enqueue; the compiler self-chains when it hits a cap with records remaining.
- **Compounding-health metrics live in `wiki_compile_jobs.metrics` JSON + a small admin GraphQL query.** No new metrics store; reuses observability path already wired up.

## Open Questions

### Resolved During Planning

- Trigram threshold → 0.85, matching Hindsight's established value.
- Where the aggregation pass runs → inline after per-batch apply, same compile job, same cursor loop (simpler than a separate nightly lint).
- How memory → page backlinks are surfaced → existing `MemoryRecord.wikiPages` GraphQL field + new mobile UI component; no new index needed.
- Bootstrap completion → compiler auto-enqueues a continuation job when it hits record or section caps *and* the cursor is not drained.

### Deferred to Implementation

- Exact thresholds for triggering holistic recompile (`min_cited_memories`, `stale_days`). Start with `min_cited_memories = 5`, `stale_days = 7`; tune from the first real run's health metrics. Exposed as env-var constants so tuning doesn't require a code change.
- Whether `pg_trgm` needs `CREATE EXTENSION` — check the existing migration state. Hindsight uses it already in the same database, so the extension is likely present; the migration will `CREATE EXTENSION IF NOT EXISTS pg_trgm;` as a no-op safeguard.
- Final shape of `WikiCompoundingHealth` query fields — first cut can be aggregates only; drill-downs added if the admin needs more detail.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```text
                   ┌────────────────────────────────────────────┐
                   │ runCompileJob(job)                         │
                   │                                            │
                   │  per-batch loop (existing):                │
                   │   ┌───────────────────────────────────┐    │
                   │   │ adapter.listRecordsUpdatedSince    │    │
                   │   │           ↓                        │    │
                   │   │ findCandidatePagesForBatch (NEW)   │    │
                   │   │   = recent pages ⊕ alias-prematch  │    │
                   │   │           ↓                        │    │
                   │   │ runPlanner                         │    │
                   │   │           ↓                        │    │
                   │   │ applyPlan                          │    │
                   │   │   • fuzzy-dedupe newPages (NEW)    │    │
                   │   │   • bucket unresolved by trgm (NEW)│    │
                   │   └───────────────────────────────────┘    │
                   │                                            │
                   │  aggregation phase (NEW):                  │
                   │   listPagesNeedingResynth(scope,           │
                   │     minSources=5, staleDays=7)             │
                   │           ↓                                │
                   │   for each page (capped N):                │
                   │     read all cited memories                │
                   │     runPageRecompilePlanner                │
                   │     section-writer per changed section     │
                   │     mark last_resynth_at                   │
                   │                                            │
                   │  continuation (NEW):                       │
                   │   if cap_hit && cursor_not_drained:        │
                   │     enqueueCompileJob(next bucket)         │
                   └────────────────────────────────────────────┘

Read path (for UI compounding visibility):

  memory/[file] ──▶ MemoryRecord.wikiPages (existing field)
                       │
                       └── list of pages this memory contributes to
                            (rendered as "Contributes to:" section)

  wiki/[type]/[slug] ──▶ WikiPage.sourceCount + sourceMemoryIds (NEW)
                           │
                           └── "Based on N memories" + drill-in list
```

## Implementation Units

- [ ] **Unit 1: Planner-input enrichment (alias pre-match, fuller candidate context)**

**Goal:** Stop fragmenting concepts by making sure the planner always *sees* an already-existing page whose alias matches anything in the current record batch, even when that page is outside the top-N most-recently-compiled window. Also give the planner enough summary to decide "update" over "create."

**Requirements:** R1, R3

**Dependencies:** None

**Files:**
- Modify: `packages/api/src/lib/wiki/compiler.ts`
- Modify: `packages/api/src/lib/wiki/planner.ts`
- Modify: `packages/api/src/lib/wiki/repository.ts`
- Test: `packages/api/src/__tests__/wiki-planner-context.test.ts`

**Approach:**
- New repository helper `findAliasCandidatesForBatch({ tenantId, ownerId, recordTexts })`: extract short proper-noun-like tokens from records (cheap JS-side), then match them against `wikiPageAliases.alias` via `pg_trgm` similarity ≥ 0.85 on a normalized form. Returns the full alias + parent page rows.
- In `compiler.ts`, merge alias-matched pages into the planner's `candidatePages` input ahead of the recency slice; de-dupe by page id.
- Raise summary truncation from 200 → 500 chars in `buildPlannerUserPrompt`, and include the page's current section slugs so the planner can target existing sections instead of inventing new ones.
- Keep the overall candidate-page cap but increase the alias-matched slice to at most 50 extra pages beyond the recency window, so a trimmed scope remains bounded.

**Patterns to follow:**
- `listPagesForScope` in `repository.ts` — mirror its alias-batch hydration pattern.
- `mobileWikiSearch.query.ts` `inArray` join — same shape for the alias→page join.

**Test scenarios:**
- Happy path: batch contains "Austin" in record text and an Austin page already exists far down the recency list → alias pre-match surfaces it → planner context includes it → `applyPlan` takes the update path, not newPage.
- Edge case: no alias hits at all → candidate list matches today's recency-only behavior (no regression).
- Edge case: multiple aliases on one record map to distinct pages → all surfaced, planner chooses.
- Error path: `pg_trgm` unavailable (local dev without extension) → helper returns empty array, compiler proceeds without pre-match (logged warning, never throws).
- Integration: feed a fixture of 3 batches where batch 3 contains a record whose only signal is the alias → assert same page updated, no duplicate created.

**Verification:**
- Unit tests pass; compiler still completes an end-to-end fixture run.
- New metric `alias_prematch_hits` appears on job metrics.

- [ ] **Unit 2: Fuzzy alias resolution and on-write page-merge guard**

**Goal:** Turn the alias layer into a soft-matching layer so surface-form variance ("Austin, TX" vs "Austin" vs "ATX") resolves to the same page at write time — preventing duplicate pages even if the planner still emits them.

**Requirements:** R1, R3

**Dependencies:** Unit 1 (lands the trigram helper; this unit extends it to write-time guards).

**Files:**
- Modify: `packages/api/src/lib/wiki/repository.ts` (new `findSimilarAlias` + `findPageByFuzzyAlias`)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (fuzzy-dedupe step in `applyPlan` before creating a newPage)
- Create: `packages/database-pg/drizzle/NNNN_wiki_trigram_indexes.sql` — `CREATE EXTENSION IF NOT EXISTS pg_trgm;` plus GIN trgm indexes on `wiki_page_aliases.alias` and `wiki_unresolved_mentions.alias_normalized`.
- Modify: `packages/database-pg/src/schema/wiki.ts` (note the generated indexes so Drizzle snapshot stays consistent — either add `sql.raw` index expressions or accept hand-edited migration per PR 1 precedent)
- Test: `packages/api/src/__tests__/wiki-alias-fuzzy.test.ts`

**Approach:**
- `findSimilarAlias({ tenantId, ownerId, candidateAliasNormalized })` → returns `{ pageId, existingAlias, similarity }[]` where `similarity(alias, candidate) ≥ 0.85`.
- In `applyPlan`'s `newPages` loop, before insert: compute `seedAliasesForTitle(np.title) ∪ np.aliases` → for each alias, call `findSimilarAlias`. If any match hits an existing page, route this `newPage` onto the existing page as an **update** (append novel sections or reinforce existing ones) plus register the new alias forms as additional aliases on the existing page.
- Preserve the exact-match fast path; only fall through to trigram on miss.
- Decision gate: if the planner's `newPage.type` disagrees with the matched page's `type` (e.g., `topic` vs `entity`), treat as non-match and proceed with creation — type difference signals a genuinely distinct concept.

**Patterns to follow:**
- Existing exact `findAliasMatches` signature — keep the new helper symmetric.
- Hindsight's trigram threshold precedent for consistent UX.

**Test scenarios:**
- Happy path: planner proposes newPage "Austin, TX" when a page with alias "austin" exists → compiler routes to update, registers "austin tx" as new alias on the existing page.
- Edge case: similarity 0.80 (just below threshold) → two pages remain separate.
- Edge case: matched page is archived → do **not** resurrect silently; log + treat as no-match.
- Edge case: type mismatch (`topic` Austin vs `entity` Austin) → separate pages, logged as `type_mismatch_candidate`.
- Error path: pg_trgm call fails → fall back to exact-match-only behavior, log, don't fail the job.
- Integration: compile 3 fixture batches emitting "Austin", "Austin TX", "ATX" as distinct newPages → final state has exactly one page.

**Verification:**
- Job metric `fuzzy_dedupe_merges` reflects expected merges on fixtures.
- Scope-isolation test from PR 5 verification re-passes (no cross-agent leaks via alias match).

- [ ] **Unit 3: Unresolved-mention fuzzy bucketing**

**Goal:** Stop unresolved mentions from fragmenting by surface form. "Austin" + "Austin, TX" + "ATX" should accumulate on one mention row so the ≥ 3 promotion threshold actually triggers.

**Requirements:** R1, R3

**Dependencies:** Unit 2 (trigram index migration lands in the same migration file — can ship together).

**Files:**
- Modify: `packages/api/src/lib/wiki/repository.ts` (`upsertUnresolvedMention`)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (pass trigram-found mentionId through the loop so `sample_contexts` append to the bucket, not a new row)
- Test: `packages/api/src/__tests__/wiki-unresolved-fuzzy.test.ts`

**Approach:**
- In `upsertUnresolvedMention`: before the existing exact-match lookup, run a trigram similarity query against open mentions in the same `(tenant, owner)` scope. If a match ≥ 0.85 is found, bump *that* row's count and append the new `sample_context` (capped at 5). Otherwise insert a new open row.
- Record the pre-bucket alias verbatim in `sample_contexts` so the promoted page can carry all surface forms as aliases at promotion time.
- Extend `listPromotionCandidates` unchanged — it already keys on count + recency.

**Test scenarios:**
- Happy path: 3 mentions ("Austin", "Austin, TX", "ATX") across 3 batches → one open mention row at count = 3, `sample_contexts` has 3 entries.
- Edge case: a mention hits a `promoted` row (status != open) → creates a new open row (don't reopen a promoted concept via fuzzy match).
- Edge case: two open rows both fuzzy-match the new alias → use the higher-similarity row; tie-break on `mention_count DESC`.
- Integration: a promoted page inherits all surface-form aliases on registration.

**Verification:**
- Unit test coverage across similarity bands.
- Job metric `fuzzy_bucket_hits` populated.

- [ ] **Unit 4: Holistic page re-synthesis (aggregation pass)**

**Goal:** Make pages actually compound. After per-batch apply, scan for pages whose full cited-memory set hasn't been re-synthesized recently; re-plan their sections from the *entire* evidence set and re-write changed sections. This is the unit that turns 30 Austin memories into a dense synthesized Austin page.

**Requirements:** R2, R6

**Dependencies:** Unit 1 (sharpens planner input quality so recompile outputs don't regress).

**Files:**
- Create: `packages/api/src/lib/wiki/page-recompiler.ts` (orchestration for single-page holistic recompile)
- Modify: `packages/api/src/lib/wiki/planner.ts` (new prompt variant `buildPageRecompilePrompt` — same section-patch contract, but primed on "you are re-synthesizing a page from its full evidence set")
- Modify: `packages/api/src/lib/wiki/compiler.ts` (aggregation phase invoked after the per-batch loop drains or hits a cap)
- Modify: `packages/api/src/lib/wiki/repository.ts`:
  - `listPagesNeedingResynth({ tenantId, ownerId, minCitedMemories, staleDays, limit })`
  - `listCitedMemoryIds(pageId)` (via `wiki_section_sources → memory refs`)
  - `markPageResynthesized(pageId)`
- Create: `packages/database-pg/drizzle/NNNN_wiki_add_last_resynth_at.sql` — new column `wiki_pages.last_resynth_at timestamptz NULL` + index `(tenant_id, owner_id, last_resynth_at)`.
- Modify: `packages/database-pg/src/schema/wiki.ts`
- Test: `packages/api/src/__tests__/wiki-page-recompile.test.ts`

**Approach:**
- Env-tunable defaults: `min_cited_memories = 5`, `stale_days = 7`, `max_page_recompiles_per_job = 5`. Small enough to bound cost per job; generous enough to let bootstrap chain through all qualifying pages across several jobs.
- Recompile flow per page:
  1. `listCitedMemoryIds(pageId)` via `wiki_section_sources → source_ref` reverse join (memory_unit kind only in v1).
  2. Re-hydrate records via `adapter.getRecord(id)` (batched; use existing adapter surface or add a small helper if missing).
  3. Call the page-recompile planner with existing sections + full memory set + page templates. Planner returns **section updates only** (no newPage/promotion/pageLinks — that's the per-batch planner's job).
  4. Section-writer per changed section (using `isMeaningfulChange` the same way).
  5. Mark `last_resynth_at = now()`.
- Hard bail: if the total cited memory bodies exceed the planner input token budget (say 32k chars), sample by recency + diversity (every Nth) and record `resynth_sampled = true` on the page's section metrics. Do not silently drop evidence.
- Scope invariants: every repo call uses the job's `(tenant_id, owner_id)`. The page-recompile planner prompt never mentions other agents.

**Execution note:** Start this unit with a failing integration test that ingests a fixture of 30 synthetic "Austin" memories into a single page, runs one compile, and asserts the page's section bodies reflect the full set. Test-first here because the pass/fail line is the whole point of this plan.

**Test scenarios:**
- Happy path: page with 10 cited memories and `last_resynth_at = null` → recompile runs, sections change, `last_resynth_at` set.
- Happy path: page with 4 cited memories → below threshold, skipped; metric `resynth_skipped_below_min` increments.
- Edge case: page with 10 cited memories but `last_resynth_at` within 7 days → skipped.
- Edge case: cited memory count > 200 → sampling triggers; no empty-input planner call.
- Edge case: recompile planner returns no changes → no writes, `last_resynth_at` still advances (so we don't re-check the same page next job).
- Error path: planner failure on one page does not abort the whole compile job — log, skip page, continue; job metric increments `resynth_failed`.
- Integration: 30-memory Austin fixture → one compile → page `body_md` contains references derived from all 30 memories and `wiki_section_sources` count ≈ 30.

**Verification:**
- Integration test passes; metrics show `pages_resynthesized`, `resynth_skipped_below_min`, `resynth_skipped_fresh`, `resynth_sampled`, `resynth_failed`.
- Smoke-run on dev with 100–200 seeded records; spot-check at least one dense page by hand.

- [ ] **Unit 5: Compile-job continuation chaining**

**Goal:** Make bootstrap-scale compiles (thousands of records) actually finish without manual re-triggers. When a job hits a record cap (or a recompile cap) but the cursor is not drained, enqueue the next bucket.

**Requirements:** R5

**Dependencies:** Unit 4 (recompile also contributes to cap budget accounting).

**Files:**
- Modify: `packages/api/src/lib/wiki/compiler.ts`
- Modify: `packages/api/src/lib/wiki/enqueue.ts` (optional helper to compute the next dedupe bucket explicitly, so continuation can't self-dedupe itself to death)

**Approach:**
- Detect continuation condition at end of `runCompileJob`: `metrics.records_read` reached `MAX_RECORDS_PER_JOB` *and* the last batch returned a `nextCursor` (i.e., more records remain). Or a `cap_hit` reason indicates the inner loop bailed with a non-drained cursor.
- Enqueue a fresh compile via `enqueueCompileJob`, but compute the dedupe key from `Date.now() + DEDUPE_BUCKET_SECONDS` so it lands in the *next* 5-minute bucket and definitely doesn't collide with the current one.
- Attempt async-invoke; swallow errors (job sits pending for the next worker or lint sweep to pick up, same as today).
- Keep `MAX_RECORDS_PER_JOB` at 500 for incremental memory-retain triggers; introduce a separate `MAX_RECORDS_PER_BOOTSTRAP_JOB = 1000` gated by `job.trigger === 'bootstrap_import'` for the terminal bootstrap compile — cuts the number of continuation hops without blowing Lambda timeout (480 s budget, Haiku planner batches land ~30–60 s each on small batches per PR 3 budget notes).

**Test scenarios:**
- Happy path: 2000-record fixture, bootstrap trigger → first job processes 1000, enqueues continuation, second job processes the rest, final state consistent.
- Edge case: cursor drained exactly at cap boundary → **no** continuation enqueued.
- Edge case: continuation enqueue dedupe-collides (impossible with next-bucket strategy; test regression guard anyway).
- Error path: continuation invoke fails → pending row still present for any other worker.
- Integration: trigger one bootstrap → observe N continuation jobs; sum of `records_read` equals input count.

**Verification:**
- Bootstrap smoke-run of ~200 records completes without manual re-trigger.
- `wiki_compile_jobs` ledger shows the expected chain.

- [ ] **Unit 6: Memory ↔ Wiki backlink visibility in mobile UI**

**Goal:** Make compounding visible. From any memory record screen, show "Contributes to: [page list]". From any wiki page screen, show "Based on N memories" + a link to the contributing list.

**Requirements:** R4

**Dependencies:** None (independent from compile changes — can land in parallel).

**Files:**
- Modify: `packages/database-pg/graphql/types/wiki.graphql` — add `WikiPage.sourceMemoryCount: Int!` and `WikiPage.sourceMemoryIds(limit: Int = 10): [ID!]!` (or return lightweight `MemoryRef` records with id + preview text).
- Modify: `packages/api/src/graphql/resolvers/wiki/wikiPage.query.ts` and `mappers.ts` — resolve `sourceMemoryCount` + `sourceMemoryIds` via `wiki_section_sources` reverse-join, bounded by the page's owner scope.
- Verify/implement: `MemoryRecord.wikiPages` resolver wired end-to-end (field exists in schema; confirm it returns non-empty where expected).
- Modify: `apps/mobile/app/memory/[file].tsx` — render "Contributes to:" list linking to `/wiki/[type]/[slug]`.
- Modify: `apps/mobile/app/wiki/[type]/[slug].tsx` — render "Based on N memories" badge + tap-through list.
- Modify: `packages/react-native-sdk/src/graphql/queries.ts` and hooks — extend `MemoryRecord` fragment to include `wikiPages { id type slug title }` on the memory-detail query.
- Test: `packages/api/src/__tests__/wiki-backlinks.test.ts` + small RN snapshot for the new components.

**Approach:**
- Follow `mobileWikiSearch.query.ts` for the reverse-join shape. Owner-scope guard on every resolver — an admin viewing another agent is gated behind the existing admin auth check (`auth.ts`).
- Keep payloads lean: `sourceMemoryIds` returns IDs + a short preview string (≤ 240 chars), not full records. Full detail comes from the existing memory read path.
- Don't preload `sourceMemoryIds` on list surfaces (`wikiSearch`, `recentWikiPages`) — only the detail page needs them.

**Test scenarios:**
- Happy path: memory with 2 citing pages returns both in `wikiPages`; both are reachable on the memory screen.
- Happy path: page with 30 cited memories returns `sourceMemoryCount = 30`; `sourceMemoryIds(limit: 10)` returns 10 ordered by memory `updated_at DESC`.
- Edge case: memory with zero citing pages → empty array, UI renders nothing (no error banner).
- Edge case: admin of another agent → respects existing auth rules; memory across scopes never cites a page from a different scope (v1 invariant).
- Error path: page owner mismatch at resolver boundary → throw existing auth error, not silent empty list.
- Integration: compile a fixture, then navigate from memory to page to memory on the mobile client → round-trip works.

**Verification:**
- Manual mobile check with a real seeded page.
- Resolver tests green.

- [ ] **Unit 7: Compounding-health metrics + admin query**

**Goal:** Give us eyes on whether compounding is actually compounding, run over run. The same metrics become the signal we use to tune Unit 4's thresholds.

**Requirements:** R1, R2, R5

**Dependencies:** Units 1, 2, 3, 4, 5 (this unit reports on what they do).

**Files:**
- Modify: `packages/api/src/lib/wiki/compiler.ts` — extend `metrics` with: `alias_prematch_hits`, `fuzzy_dedupe_merges`, `fuzzy_bucket_hits`, `pages_resynthesized`, `resynth_skipped_below_min`, `resynth_skipped_fresh`, `resynth_sampled`, `resynth_failed`, `continuation_enqueued`.
- Create: `packages/api/src/graphql/resolvers/wiki/wikiCompoundingHealth.query.ts` — admin-only aggregates across pages in scope: `totalPages`, `pagesWithAtLeastFiveSources`, `avgSourcesPerPage`, `duplicateCandidates` (pairs of pages whose titles trigram-match ≥ 0.85 — a retrospective duplication signal).
- Modify: `packages/database-pg/graphql/types/wiki.graphql` — add `WikiCompoundingHealth` type and `wikiCompoundingHealth(tenantId, ownerId)` admin query.
- Modify: `packages/api/src/graphql/resolvers/wiki/index.ts` and `auth.ts` — require admin role (same as other cross-scope admin queries).
- Test: `packages/api/src/__tests__/wiki-health.test.ts`

**Approach:**
- Metrics are just JSON fields on the existing `wiki_compile_jobs.metrics` column. No schema change.
- Health query is read-only, no writes. Cap at `limit` pages for the duplicate-candidate detector; don't cross-product unbounded.
- Expose the query under admin role first; a mobile health surface can land in a later PR if Eric wants.

**Test scenarios:**
- Happy path: run a fixture compile → all new metric fields populate.
- Happy path: admin health query returns expected aggregates against the fixture; `duplicateCandidates` identifies the seeded collision and is zero after fuzzy dedupe (Unit 2) cleans up.
- Edge case: scope with zero pages → all fields zero, no div-by-zero.
- Error path: non-admin caller → resolver throws existing admin-auth error.

**Verification:**
- Health query returns sensible values on the 100–200 record smoke run.
- Metrics visible in CloudWatch logs via `metrics jsonb` field.

## System-Wide Impact

- **Interaction graph:** `memory-retain` enqueue → `wiki-compile` Lambda (now self-chaining) → planner + section-writer → repository writes. Mobile read path gains `MemoryRecord.wikiPages` and `WikiPage.sourceMemoryCount`. Admin read path gains `wikiCompoundingHealth`.
- **Error propagation:** per-page recompile failures must not abort the whole compile job; metrics count them. Continuation invoke failures must not fail the terminating job; the ledger row is sufficient for any worker to pick up.
- **State lifecycle risks:** holistic recompile rewrites section bodies. In v1 there is no manual-edit path, so no in-place edits are at risk. If/when manual edit lands, recompile must become opt-in per-page.
- **API surface parity:** GraphQL gets `WikiPage.sourceMemoryCount` / `sourceMemoryIds` and `wikiCompoundingHealth`. Agent tools (`search_wiki`, `read_wiki_page`) are unchanged — the new fields are mobile/admin only.
- **Integration coverage:** scope-isolation test (PR 5 verification step 9) must pass after Units 1, 2, 3 land — cross-agent alias match or cross-agent memory citation must remain impossible.
- **Unchanged invariants:** still strictly `(tenant, owner)`-scoped, no `owner_id = NULL`, no tenant-shared pages. Page types stay `entity | topic | decision`. No embeddings. No full-page rewrites (recompile is still section-level, driven by the same section-patch contract).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Fuzzy alias match over-collapses distinct concepts ("Austin" vs "Austin Powers") | Threshold 0.85 pinned to Hindsight precedent; type-mismatch gate in Unit 2; `fuzzy_dedupe_merges` metric + duplicate-candidate health view catch regressions on real data. |
| Holistic recompile cost spike on a dense page (500 cited memories) | Sampling cap in Unit 4 (explicit `resynth_sampled` flag; never silent drop); `max_page_recompiles_per_job` hard cap; `last_resynth_at` prevents repeat recompile within stale window. |
| Continuation chain loops forever on a persistent error | Job ledger records attempts; completion status always written (`failed` includes metrics); a worker sweeping stale `pending` rows is out of scope for this plan and should be added later if observed. |
| `pg_trgm` extension not installed in some dev env | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the new migration; Unit 1 fallback returns empty pre-match (log warn, continue). |
| Mobile backlink query adds N+1 under memory list views | `sourceMemoryIds` only resolved on detail; list surfaces continue to use `sourceMemoryCount` only (single scalar, cheap join). |
| Planner cost rises with fuller summaries + recompile calls | Metrics capture input/output tokens per call already; keep recompile cap at 5 per job initially; review after first real bootstrap. |
| Bulk import re-triggers fuzzy dedupe on ingest and slows retain | Dedupe runs in the compile job, not in `retain` — retain path is untouched. Bootstrap importer's single terminal compile absorbs the cost once. |

## Documentation / Operational Notes

- Update `.prds/compounding-memory-runbook.md` (once it lands per PR 5) with:
  - How to read the new health metrics.
  - How to tune `min_cited_memories` / `stale_days` via env vars.
  - How to force a recompile of a single page (via `resetWikiCursor` + `compileWikiNow` — existing admin path).
- CloudWatch alarm on `resynth_failed > 0` over 1h: follow-up PR at prod rollout time, not this plan.

## Sources & References

- Origin document: [.prds/compounding-memory-agent-brief.md](../../.prds/compounding-memory-agent-brief.md)
- Authoritative scope: [.prds/compounding-memory-scoping.md](../../.prds/compounding-memory-scoping.md)
- Build plan (v1 phased PRs): [.prds/compounding-memory-v1-build-plan.md](../../.prds/compounding-memory-v1-build-plan.md)
- Pipeline deep dive: [.prds/thinkwork-memory-compounding-pipeline-deep-dive.md](../../.prds/thinkwork-memory-compounding-pipeline-deep-dive.md)
- Engineering architecture: [.prds/compiled-memory-layer-engineering-prd.md](../../.prds/compiled-memory-layer-engineering-prd.md)
- Existing reverse-join precedent: `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts`
- Trigram threshold precedent: `packages/agentcore-strands/agent-container/hindsight_recall_filter.py:46`
