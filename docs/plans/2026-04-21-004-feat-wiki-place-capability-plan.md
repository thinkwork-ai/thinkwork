---
title: "feat: Wiki Place capability — structured geodata as first-class signal"
type: feat
status: superseded
date: 2026-04-21
superseded_on: 2026-04-21
superseded_reason: "ADV-02 in document review caught a fundamental design issue: journal records' place_google_place_id is the POI's own id, not a parent's. The linker path as designed produces self-edges, not parent links, so R5's 10pp linked% target is unreachable by the described mechanism. User chose to defer (path b) and scope a new brainstorm that captures parent place_ids via live Google Places API calls (key now available in terraform.tfvars as google_places_api_key, not yet plumbed). Place to become a first-class concept — likely a dedicated wiki_places table + FK from wiki_pages."
origin: docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md
---

# feat: Wiki Place capability — structured geodata as first-class signal

> **⚠ SUPERSEDED 2026-04-21** — see frontmatter for reason. Do not execute this plan. The origin brainstorm is also partially invalidated pending a rewrite that incorporates (a) Google Places API availability for hierarchy lookup, (b) Place as a first-class concept (probably a dedicated `wiki_places` table, not just columns on `wiki_pages`). Preserved for archaeological context on what the reviewers caught.

## Overview

Stop discarding structured place data that journal-import already captures. Journal records carry Google `place_google_place_id` + `place_geo_lat/lon` + `place_address` for 85.9% of GiGi's memory units and 30.9% of Marco's (measured 2026-04-21 via `wiki_section_sources` → `hindsight.memory_units.metadata` join). The wiki compile pipeline today runs a pure-regex city extractor (`packages/api/src/lib/wiki/parent-expander.ts::extractCityFromSummary`) over the address string and ignores the already-resolved identifier and coordinates.

This plan treats "has structured geolocation" as a first-class page capability. Any `wiki_pages` row can carry `geo_lat`, `geo_lon`, `google_place_id`, `address` — populated opportunistically during compile from source record metadata, with a one-time Phase C backfill for scopes whose pages were compiled before the capability existed. The deterministic linker gains a high-confidence `place_id` path that matches record → parent by Google place_id lookup before the existing city-regex fallback. Records without `place_google_place_id` (freeform notes, non-journal sources, future ingestion paths) keep using today's path — the change is strictly a higher-confidence signal added in front of the existing emitter, not a replacement.

No map UI, no proximity-search resolver, no PostGIS, no `earthdistance` extension in v1. GraphQL exposure is deferred to the first consumer. Place is a capability, not a new `WikiPageType`.

## Problem Frame

See origin: `docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md`.

Short version: we ran the existing deterministic + co-mention emitters against Marco and GiGi this session. Marco is at its string-extraction ceiling (67.8% entity linked%, zero additional edges from backfill). GiGi is near ceiling (48.6% → 49.7% from backfill — only +1.1pp). **The current algorithms cannot close the remaining gap** because the signal they need is structured place_id + coordinates the pipeline currently throws away.

The user-visible consequence on GiGi: 50.3% of entity pages are unlinked, including ones that are clearly Paris restaurants or Toronto venues per their source metadata. A map view is impossible today — pages have no coordinates. Proximity queries are impossible — same reason. These are all downstream of one root issue: structured signal goes in, is discarded, LLM re-derives the worse version.

## Requirements Trace

Mirrors the origin doc's requirements, with R5 expanded per the doc's Quality Gates section:

- **R1** `wiki_pages` can carry structured geo metadata: `geo_lat`, `geo_lon`, `google_place_id`, `address`. All fields optional, all nullable. `place_category` deferred from v1.
- **R2** During compile, when a page's source records carry `place_google_place_id` + `place_geo_lat` + `place_geo_lon` in Hindsight metadata (read via `HindsightAdapter` → `ThinkWorkMemoryRecord.metadata`), the values are parsed from strings and promoted onto the wiki page row. Conflict resolution when sources disagree: **most-recent record wins** (by `occurred_at`/`event_date` with `created_at` tie-break).
- **R3** Deterministic linker matches record → parent page by `google_place_id` lookup as the highest-confidence path. Falls back to today's address/summary regex extraction when the record has no `place_google_place_id`. The new path is a `DerivedParentCandidate` with `reason: "place_id"` emitted by `parent-expander.ts` and trusted in `deterministic-linker.ts`.
- **R4** Columns are persisted in the database but GraphQL exposure is deferred to the first consumer task. No `WikiPage` resolver changes in v1.
- **R5** Quality gates (three parts, all must hold):
  - **Link-quality floor**: Marco's entity-linked% stays at or above 67.8%. Zero new deterministic false-positive patterns (the `"Toronto" ≈ "Toronto Life"`-class collisions the current geo-suffix gate was invented to catch).
  - **Aggregation-planner drift budget**: on GiGi, section-promotion decisions on pages whose `computeLinkNeighborhoods` inbound counts change are diffed pre/post. Budget: ≤ 10% of affected pages see an unexpected section-promotion delta without a defensible reason. Anything above that is a regression.
  - **Absolute lift target**: **GiGi entity linked% ≥ 59.7% post-deploy** (10 percentage points above current 49.7%). Non-negotiable falsifiable success criterion.
- **R6** New `links_written_place_id` metric on `wiki_compile_jobs.metrics`, peer of `links_written_deterministic` and `links_written_co_mention`. Increments per edge emitted by the place_id path. Purpose: measure the capability's lift independently of the regex/fuzzy path.
- **R7** A Phase C backfill extension to `scripts/wiki-link-backfill.ts` populates geo on existing pages whose source records carry place metadata. Running it against GiGi is the mechanism by which R5's 10pp lift is realized on existing pages.

## Scope Boundaries

- **No new `WikiPageType`.** `type` stays `entity | topic | decision`.
- **No PostGIS, no `earthdistance`, no new Postgres extensions.**
- **No GraphQL exposure** of the new fields on `WikiPage` in v1.
- **No map rendering UI.**
- **No proximity-search resolver.**
- **No Google Places API calls** at compile or read time.
- **No non-journal ingestion paths.** V1 only consumes what `journal-import.ts` already writes into `memory_units.metadata`.
- **No `place_category` enum.**
- **No runtime branching on a place-category-like field.** If a future feature needs "treat country pages differently from POI pages," that's its own plan.

### Deferred to Separate Tasks

- **GraphQL exposure of geo fields** on `WikiPage`: lands with the first consumer task (mobile/admin map view or debug surface) — DB already has the data, no recompile needed.
- **Nested-POI place_id collision handling** (same physical location, different place_ids): count the rate empirically during execution; if meaningfully nonzero, propose a lat/lon proximity-merge rule in a follow-up.
- **Google Places API enrichment at compile time** for records without a source place_id: separate feature with separate cost and privacy implications.
- **Data-trajectory audit** (what % of new `memory_units` in the last 30 days carry place_id, and is it growing vs. shrinking): observability sweep, not blocking this plan.
- **Graph-level merge** of wiki pages that end up sharing the same `google_place_id`: R3 only emits links; dedup should reuse `maybeMergeIntoExistingPage` in a follow-up that picks the canonical page.

## Context & Research

### Relevant code and patterns

- `packages/api/src/lib/wiki/journal-import.ts:64-74, 181-192, 311-324` — writes `place_google_place_id`, `place_geo_lat`, `place_geo_lon`, `place_address` into `memory_units.metadata`. Values are stringified per Hindsight's `Dict[str, str]` constraint (see `journal-import.ts:288-297`). This plan reads those same keys back out, parses the numeric ones with `parseFloat`, and persists them on wiki pages.
- `packages/api/src/lib/wiki/parent-expander.ts::deriveParentCandidates` — record-based candidate extractor. This plan adds a new branch that emits `reason: "place_id"` candidates when a record carries `place_google_place_id`.
- `packages/api/src/lib/wiki/parent-expander.ts::extractCityFromSummary` (lines 318-358) — pure-regex city extractor that runs over `place_address` strings. Stays in place as the fallback for records without `place_google_place_id`.
- `packages/api/src/lib/wiki/deterministic-linker.ts::emitDeterministicParentLinks` — today resolves candidates via a `lookupParentPages` callback keyed on `title`. This plan extends it with a parallel `lookupParentPagesByPlaceId` callback keyed on `google_place_id` — wired up in `compiler.ts` and `scripts/wiki-link-backfill.ts`.
- `packages/api/src/lib/wiki/repository.ts::findPagesByExactTitle` and `findPagesByFuzzyTitle` — patterns for the new `findPageByGooglePlaceId` lookup to mirror.
- `packages/api/src/lib/wiki/link-backfill.ts::runLinkBackfill` — this plan adds a Phase C that populates geo on existing pages. Phases A and B stay unchanged.
- `packages/api/src/lib/wiki/compiler.ts::upsertPage` (or equivalent page-write path — implementer picks the exact seam) — needs to accept the new geo fields as optional inputs.
- `packages/database-pg/src/schema/wiki.ts` — schema declaration for `wiki_pages`. Add the four new columns alongside existing optional fields.
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — most recent migration precedent. The migration for this plan will follow the same style: single `.sql` file, applied manually via psql (there is no CI migration runner; see Documentation notes).

### Institutional learnings

- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — instrument before tuning. The candidate-pool audit for this plan (85.9%/30.9%/0% coverage) was exactly that pattern applied to the Place feature question.
- Plan `docs/plans/2026-04-20-012-refactor-wiki-pipeline-simplification-plan.md` (merged 2026-04-21) — recent deletion-first work that cleared dead `cluster` and `body_embedding` columns. This plan's additive columns ship into that cleaner surface.
- Plan `plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` — the "no new page types" non-goal this plan respects by treating Place as a capability.

### Adversarial-review findings integrated into this plan

From the 5-reviewer pass on the origin doc (coherence, feasibility, product-lens, scope-guardian, adversarial-document):

- "Strictly additive" framing was overstated — link neighborhoods feed the aggregation planner prompt. This plan's R5 includes an aggregation-planner drift budget as a hard quality gate.
- GiGi lift target must be a falsifiable number, not "direction up." R5's `≥ 10pp` target is that number.
- Hindsight boundary: metadata comes as strings, needs `parseFloat` with parse-failure handling. Unit 2's Approach calls this out.
- `earthdistance` is not installed; PostGIS is not installed. Neither is added here.
- Records with place metadata but no matching page already exists — **do not** auto-create pages. This is already product-decided in the origin doc's Resolved section.

## Key Technical Decisions

- **Conflict resolution: most-recent-wins.** When multiple source records for a page carry different `place_google_place_id` values, the most recent record (by `occurred_at` / `event_date`, with `created_at` as tie-break) wins. Matches the mental model of journal-import writes — the newest record represents the user's latest understanding of the place. Alternative (majority-vote) was rejected because it weights historical data equally with recent corrections, which is wrong for place identity.
- **Linker path: new `DerivedParentCandidate` with `reason: "place_id"`, emitted by `parent-expander.ts`.** Integrates into the existing candidate pipeline rather than a pre-resolution branch inside `emitDeterministicParentLinks`. Honors the existing architecture and keeps the linker a dumb coordinator.
- **Schema indexing: partial unique index** on `wiki_pages(tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL`. Prevents two pages in the same scope from claiming the same Google place_id (the compile-time promotion will detect this via insert conflict and merge per `maybeMergeIntoExistingPage`, future follow-up). Nullable rows are excluded from the constraint so existing pages without geo don't trip it.
- **Parse defensively.** `parseFloat` on `place_geo_lat` / `place_geo_lon` strings from Hindsight metadata. On parse failure: skip this record for geo promotion and log. Do not fail the compile.
- **Backfill: Phase C extension of `wiki-link-backfill.ts`**, not a sibling script. The adversarial review on the simplification plan specifically preserved `link-backfill.ts` as a module because `wiki-lint` Lambda is a plausible second consumer. Extending the module with Phase C honors that decision and keeps all backfill orchestration in one place.
- **`links_written_place_id` is a peer metric, not a discriminant on `links_written_deterministic`.** Two reasons: (a) the existing metric is already being written by city/journal paths and changing its meaning would confuse historical data; (b) the new metric is strictly growable — it starts at 0 and climbs.
- **GraphQL exposure deferred.** Columns exist in the DB but are not in any resolver until a real consumer (map view, proximity filter, debug surface) needs them. Shipping the read surface ahead of consumers is the anti-pattern plan 012 just finished cleaning up.

## Open Questions

### Resolved during planning

- **Conflict resolution policy**: most-recent-wins (see Key Technical Decisions).
- **Linker path shape**: `DerivedParentCandidate` with `reason: "place_id"` (see Key Technical Decisions).
- **Backfill location**: Phase C in `packages/api/src/lib/wiki/link-backfill.ts` (see Key Technical Decisions).
- **`place_category` deferral**: confirmed deferred in origin doc; no column, no enum, no runtime branching.
- **Auto-create-page for geo-bearing records with no matching page**: confirmed NO per origin doc. Page creation still goes through leaf-planner / aggregation-planner paths.
- **Indexing strategy**: partial unique on `(tenant_id, owner_id, google_place_id) WHERE NOT NULL` (see Key Technical Decisions).
- **Cross-plan 012 integration**: 012 merged 2026-04-21. Schema is clean; no overlap with this plan's additions.

### Deferred to implementation

- **Exact page-write seam for geo promotion.** `compiler.ts` has multiple page-write paths (`upsertPage`, `applyAggregationPlan.newPages`, possibly leaf-planner newPages). Implementer picks the narrowest seam that captures all page creates+updates sourced from journal records. Characterization test captures current outputs before wiring geo in.
- **Phase C aggregation query shape.** Given `(tenant_id, owner_id)` and N active pages, the query to pull per-page source-record metadata can be one big join + group-by or iterated per page. Implementer picks based on EXPLAIN; on GiGi's ~1077 pages × ~3121 memory_units the iteration is bounded.
- **Partial unique index: enforce now or log-and-defer?** If the backfill finds any scopes with existing duplicate `(tenant_id, owner_id, google_place_id)` tuples, the index creation will fail. Implementer: query for duplicates first; if zero, create the index unconditionally; if nonzero, log the offending rows and create the index once duplicates are merged or nulled. This is a pre-migration audit, not a design decision.
- **`wiki-link-backfill.ts` Phase C invocation shape.** Add a `--phase c` flag, or run all three phases by default, or make Phase C opt-in with `--with-geo`. Implementer picks based on operational feel. Phase A and B stay idempotent either way.
- **Aggregation-planner drift budget measurement mechanism.** Pre-deploy: snapshot `wiki_page_sections.aggregation` for pages that will have `computeLinkNeighborhoods` inbound counts change. Post-deploy: diff. The exact tooling (one-off script, extension of an existing audit script, or manual psql) is an implementation choice.
- **Nested-POI collision frequency on real data.** Query during execution: "count distinct google_place_id values sharing the same (lat_round_5dec, lon_round_5dec)." If > 0 rows, surface in the PR description and scope a follow-up. Do not block v1.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

Record → Page geo promotion flow:

```
journal.place row
  │  (LEFT JOIN at journal-import time)
  ▼
memory_units.metadata (Hindsight, Dict[str, str])
  { place_google_place_id: "ChIJ...",
    place_geo_lat: "48.8566",
    place_geo_lon: "2.3522",
    place_address: "..." }
  │
  │  (HindsightAdapter → ThinkWorkMemoryRecord.metadata, still strings)
  ▼
parent-expander.ts::deriveParentCandidates
  │  If metadata has place_google_place_id:
  │    emit DerivedParentCandidate {
  │      reason: "place_id",
  │      sourceKind: "record",
  │      parentGooglePlaceId: "ChIJ...",
  │      sourceRecordIds: [...]
  │    }
  │
  ├──▶ deterministic-linker.ts::emitDeterministicParentLinks
  │      calls new lookupParentPagesByPlaceId({tenantId, ownerId, googlePlaceId})
  │      on match: emit reference edge with context "deterministic:place_id:<id>"
  │      on miss: fall through (no other reason to try)
  │      increments metric: links_written_place_id
  │
  └──▶ compiler.ts (page-write seam, same batch)
        aggregate records per page, pick most-recent record with non-null geo,
        parseFloat(place_geo_lat/lon), UPDATE wiki_pages SET geo_lat=..., geo_lon=...,
                                        google_place_id=..., address=...
        (first write takes the column; subsequent records only override if strictly
         more recent per occurred_at/event_date)
```

One-time existing-page promotion (Phase C, separate from live compile):

```
scripts/wiki-link-backfill.ts --tenant X --owner Y [--with-geo]
  Phase A: existing — parent-links from page summaries (unchanged)
  Phase B: existing — co-mention links (unchanged)
  Phase C: new — geo promotion
    for each active page in scope:
      find source memory_units via wiki_section_sources
      aggregate by most-recent-record, pick non-null place_google_place_id
      if found: UPDATE wiki_pages SET geo_lat, geo_lon, google_place_id, address
                (ON CONFLICT idempotent; re-runs are no-ops)
```

## Implementation Units

### Phase 1 — schema + compile-time promotion (ships together as PR A)

- [ ] **Unit 1: Add geo columns + partial unique index to `wiki_pages`**

**Goal:** Create the four opt-in nullable columns and the uniqueness guarantee for `google_place_id` within scope. No behavior change — pure schema addition.

**Requirements:** R1

**Dependencies:** None.

**Files:**
- Modify: `packages/database-pg/src/schema/wiki.ts` (add `geo_lat`, `geo_lon`, `google_place_id`, `address` to the `wikiPages` table; declare the partial unique index)
- Create: `packages/database-pg/drizzle/0017_wiki_place_columns.sql` (hand-written migration — repo has no CI migration runner, see Documentation section)
- Create: `packages/database-pg/drizzle/meta/0017_snapshot.json` (drizzle-generated via `pnpm --filter @thinkwork/database-pg db:generate`; verify it correctly reflects only the column additions)
- Modify: `packages/database-pg/drizzle/meta/_journal.json` (add the new entry; match 2-space indentation)

**Approach:**
- Columns: `geo_lat numeric(9,6)`, `geo_lon numeric(9,6)`, `google_place_id text`, `address text`. All nullable. `numeric(9,6)` gives ~11cm precision at equator and matches Google Places API-returned precision.
- Partial unique index: `CREATE UNIQUE INDEX idx_wiki_pages_scope_google_place_id ON wiki_pages (tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL;`.
- Pre-migration audit: `SELECT tenant_id, owner_id, google_place_id, count(*) FROM wiki_pages WHERE google_place_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1;` — must return zero rows before the index creates (it will on day one since no column exists yet, but the audit is the pattern future Phase C + compile-time writes must respect).
- Migration SQL follows 0016's style: leading comment explaining intent, `DO $$ ... $$` guards unneeded here (additive only, no data loss risk), `ALTER TABLE` + `CREATE UNIQUE INDEX IF NOT EXISTS`.
- Run `pnpm db:generate` and verify the generated snapshot/migration match the intended SQL; hand-edit if drizzle generates anything extra (pattern from simplification PR 2's snapshot handling).

**Patterns to follow:**
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — migration file style (leading comment, explicit IF EXISTS / IF NOT EXISTS).
- Existing nullable-column declarations on `wikiPages` in `packages/database-pg/src/schema/wiki.ts` (e.g., `summary`, `body_md`).

**Test scenarios:**
- Test expectation: none — pure schema addition, no behavioral change.
- Smoke: after applying the migration against dev, `\d wiki_pages` shows the four new columns; `SELECT * FROM wiki_pages LIMIT 1` succeeds with NULL in all four; `EXPLAIN SELECT * FROM wiki_pages WHERE google_place_id = 'x'` uses the new index.

**Verification:**
- Migration applies cleanly against dev.
- Full api test suite passes post-migration (no references to the new columns yet, so behavior is unchanged).
- Schema snapshot matches live DB (verified by `drizzle-kit introspect` or equivalent).

---

- [ ] **Unit 2: Compile-time place promotion from record metadata to page row**

**Goal:** During compile, when a page's sources include records with `place_google_place_id` + lat/lon in metadata, promote those onto the wiki_pages row using most-recent-wins.

**Requirements:** R1, R2, R5 (link-quality floor)

**Dependencies:** Unit 1.

**Files:**
- Modify: `packages/api/src/lib/wiki/repository.ts` — add a helper like `selectPlaceMetadataFromRecords` that, given a list of `ThinkWorkMemoryRecord`, returns `{geoLat, geoLon, googlePlaceId, address} | null` using most-recent-wins. Pure function. Also extend the page upsert path(s) to accept these fields.
- Modify: `packages/api/src/lib/wiki/compiler.ts` — wire the helper into the page-write seam(s). The exact seam is deferred to implementation (see Open Questions), but the behavior is: whenever a page is created or its sections rewritten from records, compute place metadata from those records and include in the upsert.
- Modify: `packages/api/src/__tests__/wiki-compiler.test.ts` — cover the new promotion behavior end-to-end via the compile-job fixture pattern already established.
- Create: `packages/api/src/__tests__/wiki-place-promotion.test.ts` — focused unit test for the `selectPlaceMetadataFromRecords` helper.

**Approach:**
- Input records carry metadata as a flat `Record<string, string | number>` after `HindsightAdapter` normalization. The helper should:
  - Filter records whose metadata has a non-empty `place_google_place_id` AND parseable `place_geo_lat` AND parseable `place_geo_lon`.
  - Sort by `occurred_at` desc, `created_at` desc.
  - Return the first record's `(place_google_place_id, parseFloat(place_geo_lat), parseFloat(place_geo_lon), place_address)` as the page's geo tuple.
  - Return `null` if no record qualifies (page keeps whatever geo it had, or NULL).
- `parseFloat` must handle strings like "48.8566". On `NaN`, skip that record (do not error).
- Empty-string `place_google_place_id` is treated as absent (not a valid id).
- The page-write path must NOT clobber existing non-null geo with a null — i.e., if the new batch's records produce `null`, the page's existing `google_place_id` stays. Only overwrite when the new batch's winning record is strictly more recent than whatever populated the page (implementer's call on how to track that — a `place_metadata_source_date` column, or always-overwrite when new records have geo). Simplest: always set when new-batch geo exists; accept that a stale record re-compiled later could in theory override a newer one (rare and benign given journal-import time ordering).
- Same partial unique index rule applies: if two pages in scope would end up with the same `google_place_id`, insert fails. This is EXPECTED and caught in Unit 2's tests — the failure path documents the "two pages think they're the same place" scenario; resolution (merge) is a separate follow-up.

**Execution note:** Characterization-first. Capture wiki-compiler.test.ts output on existing fixtures before wiring the helper; after wiring, verify no assertions change for fixtures without place metadata, and new assertions cover fixtures that do.

**Patterns to follow:**
- `packages/api/src/lib/wiki/repository.ts::findAliasMatchesFuzzy` and similar pure helpers — pattern for "given input data, return structured result, no DB side effects."
- `packages/api/src/lib/wiki/compiler.ts::upsertPage` invocation sites — wire the new fields alongside existing optional fields.

**Test scenarios:**
- Happy path: record with `place_google_place_id="ChIJxxxxx"`, `place_geo_lat="48.8566"`, `place_geo_lon="2.3522"`, `place_address="..., Paris"` → page row gets all four fields populated after compile.
- Happy path: two records, newer has `place_google_place_id="ChIJnewer"`, older has `"ChIJolder"` → page gets `ChIJnewer` (most-recent-wins).
- Edge case: record has `place_google_place_id` but `place_geo_lat=""` (empty string from Hindsight) → record skipped for geo, page geo stays unchanged.
- Edge case: record has `place_geo_lat="not_a_number"` → `parseFloat` returns NaN, record skipped, no error thrown.
- Edge case: no records with place metadata → page has NULL for all four columns (or retains pre-existing values, if any).
- Edge case: record has place metadata but different `place_google_place_id` than another already-compiled page in the same scope → insert fails with unique-violation (documented in error path; follow-up handles merge).
- Error path: `parseFloat` fails on lat AND lon for all records in the batch → no geo promotion, compile otherwise unchanged, no error raised.
- Integration: full compile job on a Marco-style fixture with journal-sourced records produces page rows with expected geo populated, matches the dry-run numbers before the code change for all OTHER behaviors (link counts, page counts, aggregation output) — drift budget check.
- Integration: full compile job on a Cruz-style fixture with ZERO journal records produces page rows with NULL geo, byte-identical to pre-change output elsewhere.

**Verification:**
- Unit tests for `selectPlaceMetadataFromRecords` pass.
- `wiki-compiler.test.ts` integration tests pass including new geo assertions.
- Manual dev compile on Cruz (0 place_id coverage): no geo rows written, no errors.
- Manual dev compile on a small new Marco scope (if available): geo rows written matching the source record metadata.

---

- [ ] **Unit 3: Deterministic linker `place_id` path**

**Goal:** Add a high-confidence record-to-parent lookup by `google_place_id`. When a record carries `place_google_place_id` and a page in scope has that id, emit a reference edge with context `deterministic:place_id:<id>` and increment `links_written_place_id`.

**Requirements:** R3, R6

**Dependencies:** Units 1 + 2 (need columns and compile-time promotion live so pages actually carry place_id to match against).

**Files:**
- Modify: `packages/api/src/lib/wiki/parent-expander.ts` — add `"place_id"` to the `ParentCandidateReason` union; in `deriveParentCandidates`, when a record has `place_google_place_id`, emit a `DerivedParentCandidate` with `reason: "place_id"`, `sourceKind: "record"`, `parentGooglePlaceId` (new optional field on the interface), and `sourceRecordIds`.
- Modify: `packages/api/src/lib/wiki/deterministic-linker.ts` — extend the call signature to accept an optional `lookupParentPagesByPlaceId` callback; in the candidate loop, when `candidate.reason === "place_id"` and the callback is provided, resolve via place_id; on match, emit with context `deterministic:place_id:<id>`.
- Modify: `packages/api/src/lib/wiki/repository.ts` — add `findPageByGooglePlaceId({tenantId, ownerId, googlePlaceId})` mirroring the shape of `findPagesByExactTitle`.
- Modify: `packages/api/src/lib/wiki/compiler.ts` — wire the new callback into the `emitDeterministicParentLinks` call site.
- Modify: `packages/api/src/lib/wiki/compiler.ts` — add `links_written_place_id` to the metrics interface and its initialization; increment when the linker's result carries the new context.
- Modify: `packages/api/src/__tests__/wiki-parent-expander.test.ts` — add test scenarios for the new `reason: "place_id"` candidates.
- Modify: `packages/api/src/__tests__/wiki-deterministic-linker.test.ts` — add scenarios for place_id lookup, miss, and fallback.
- Modify: `packages/api/src/__tests__/wiki-compiler.test.ts` — integration scenario: record with place_id + page with matching place_id → link written with `deterministic:place_id:...` context + metric increments.

**Approach:**
- Candidate shape: `DerivedParentCandidate` gains one optional field `parentGooglePlaceId?: string`. `parentTitle` may stay as the page title (for logging/display), but the actual lookup key is `parentGooglePlaceId` when `reason === "place_id"`.
- Linker precedence: the candidate list produced by `deriveParentCandidates` already has an order (today sorted by `supportingCount` desc). `place_id` candidates can land at any position — they succeed or fail on their own key, orthogonal to the city/journal path. The linker tries place_id lookup first for place_id candidates, then city lookup for city candidates, etc. No candidate is "tried twice."
- Metric: `links_written_place_id` initialized to 0; incremented inside `emitDeterministicParentLinks` return-shape digestion in `compiler.ts`. Existing `links_written_deterministic` continues to aggregate city/journal; the new metric is strictly additive.
- Fallback: if a record has `place_google_place_id` AND a `place_address` that the city extractor would also match, the linker emits BOTH candidates. Deduplication happens at `upsertPageLink` (ON CONFLICT DO NOTHING on `(from, to, kind)`). This is expected — the two candidates are testing different parent pages (place_id → the exact POI; city → the city topic).

**Patterns to follow:**
- `packages/api/src/lib/wiki/deterministic-linker.ts::lookupParentPagesFuzzy` callback pattern — mirror for `lookupParentPagesByPlaceId`.
- `packages/api/src/lib/wiki/repository.ts::findPagesByFuzzyTitle` — repo-level shape for the new finder.

**Test scenarios:**
- Happy path (parent-expander): record with `metadata.place_google_place_id="ChIJ123"` → `deriveParentCandidates` emits a candidate with `reason: "place_id"` and `parentGooglePlaceId: "ChIJ123"`.
- Happy path (linker): candidate with `reason: "place_id"` and a page in scope with matching `google_place_id` → edge emitted with context `deterministic:place_id:ChIJ123`, metric increments.
- Edge case (linker): candidate with `reason: "place_id"` but no page in scope has a matching `google_place_id` → no edge emitted, metric unchanged, no error.
- Edge case (parent-expander): record with both `place_google_place_id` AND address→city-extractable → both candidates emitted; each resolves independently; one record can emit links to both parent pages.
- Error path (linker): `lookupParentPagesByPlaceId` callback throws → linker catches, logs, proceeds with other candidates. Metric unchanged.
- Error path (linker): candidate carries `reason: "place_id"` but `parentGooglePlaceId` is missing/empty string → linker skips this candidate.
- Integration (compile): Marco fixture with records that have `place_google_place_id` for "Austin, Texas" → link count delta matches expectation, `links_written_place_id > 0`, no regression in `links_written_deterministic` for non-journal-sourced records.
- Integration (compile): Cruz fixture with zero journal records → `links_written_place_id = 0`, all other metrics byte-identical to pre-Unit-3 behavior.

**Verification:**
- Full api test suite passes.
- Manual dev compile on Marco produces non-zero `links_written_place_id` for records with journal-sourced place metadata.
- No new false-positive patterns observable in `wiki_page_links.context LIKE 'deterministic:place_id:%'` rows (spot-check via psql: for 20 random new rows, verify the child page's source records do reference the parent page's `google_place_id`).

---

### Phase 2 — existing-page backfill (ships separately as PR B after Phase 1 + one compile cycle)

- [ ] **Unit 4: Phase C backfill in `wiki-link-backfill.ts` — populate geo on existing pages**

**Goal:** Populate `geo_lat`, `geo_lon`, `google_place_id`, `address` on existing active wiki pages whose source records carry journal-sourced place metadata. Mechanism by which the GiGi R5 10pp lift is realized (the live compile path in Unit 2 only enriches NEW compiles; existing pages stay unenriched without this backfill).

**Requirements:** R2, R5 (absolute lift target), R7

**Dependencies:** Units 1-3 merged + one dev compile cycle verified clean. (Running backfill before the live path is live would enrich pages that then get re-overwritten on the next compile without the `place_id` linker — works but wastes a cycle.)

**Files:**
- Modify: `packages/api/src/lib/wiki/link-backfill.ts` — add a `runGeoPromotion` (or `phaseC`) function that, given scope + fetchers, iterates active pages and promotes geo.
- Modify: `packages/api/scripts/wiki-link-backfill.ts` — wire the new phase into the CLI. Default behavior adds Phase C; a `--no-geo` flag skips if needed for debugging.
- Modify: `packages/api/src/__tests__/wiki-link-backfill.test.ts` — add scenarios covering the new phase.
- Modify: `packages/api/src/lib/wiki/repository.ts` — add a helper to fetch per-page source records' metadata in bulk (query shape deferred to implementation).

**Approach:**
- For each active page in `(tenant_id, owner_id)` scope:
  1. Fetch `memory_unit` ids via `wiki_section_sources WHERE source_kind = 'memory_unit' AND section_id IN (page's section ids)`.
  2. Fetch those `memory_units` rows from Hindsight.
  3. Apply `selectPlaceMetadataFromRecords` (same helper as Unit 2).
  4. If result is non-null AND the page currently has NULL geo OR the result is strictly newer than page's existing source-date (implementer decision per Unit 2), UPDATE the page row.
- Idempotent: running twice produces the same result on the second run (zero net changes).
- Partial unique index collision handling: if a page's computed `google_place_id` matches another page's existing id, UPDATE fails. Phase C **catches and logs** the collision with scope + page ids + conflicting id, skips that page, continues with the rest. Log line should be structured enough to drive a follow-up merge pass.
- Dry-run mode (already supported by `wiki-link-backfill.ts`): print what WOULD be updated, including row-count summary + collision summary. No writes.

**Execution note:** Ship this as PR B after PR A (Units 1-3) has been merged AND one live dev compile cycle has confirmed no regressions. Running backfill against dev against GiGi is the R5 verification step — treat this unit's PR as including the operator run + the metrics-diff report in the PR description.

**Patterns to follow:**
- `packages/api/src/lib/wiki/link-backfill.ts::runLinkBackfill` — overall orchestration pattern for Phase A + B; Phase C is a peer.
- `packages/api/scripts/wiki-link-backfill.ts` — CLI entry point style, idempotency guarantees.

**Test scenarios:**
- Happy path: scope with 10 active pages, 5 of which have source records with `place_google_place_id` → Phase C updates those 5 pages with their geo tuple; re-running is a no-op.
- Edge case: page already has non-null `google_place_id` matching what Phase C would compute → UPDATE is a no-op (idempotent check).
- Edge case: two pages in scope would both claim the same `google_place_id` → partial unique index rejects the second UPDATE; Phase C logs the collision, skips, continues.
- Edge case: page with no source memory_units (e.g. orphaned or aggregation-created without citations) → skipped cleanly.
- Error path: Hindsight fetch fails for one page's records → log, skip this page, continue with the rest of the scope.
- Dry-run: same happy-path scenario in dry-run mode prints an update-plan summary and writes zero rows; post-dry-run, the DB state is unchanged.
- Integration: run against a seeded fixture that mimics a subset of GiGi (pages + mentions + sources) → produces geo writes matching expectations.

**Verification:**
- Unit tests for `runGeoPromotion` pass.
- Dry-run against dev on GiGi: output shows the number of pages that will be enriched, the collision count if any, and no DB changes.
- Wet-run against dev on GiGi: the promised pages are enriched; re-running is a no-op.
- **R5 measurement (this is the plan's success bar)**: query `wiki_pages` before and after wet-run for GiGi entity-linked%. The live `place_id` linker path from Unit 3 has been exercising itself on new compiles since PR A merged; Phase C backfills the existing pages; the combination lifts GiGi's entity linked% from 49.7% to at or above 59.7%.
- Aggregation-planner drift check: snapshot `wiki_page_sections.aggregation` for pages whose `computeLinkNeighborhoods` inbound counts change post-backfill; diff post-next-compile-cycle; ≤ 10% of affected pages show unexpected section-promotion deltas (R5 drift budget).

## System-Wide Impact

- **Interaction graph:** Compile pipeline (leaf planner → parent expander → deterministic linker → applier → metrics) gains a new candidate reason and a new link-emission path. `computeLinkNeighborhoods` inbound counts will shift upward on geo-rich pages, which feeds the aggregation planner's prompt. Section-promotion decisions for affected pages may change — tracked under R5's drift budget. No new middleware, no new observers.
- **Error propagation:** `parseFloat` failures and Hindsight fetch failures are logged and skipped, never raise. Partial-unique-index collisions during live compile raise `UniqueViolation` at the DB layer — Unit 2 must catch and log cleanly, not fail the whole compile job. Phase C catches and logs same.
- **State lifecycle risks:** Partial unique index is a one-way correctness guarantee — once a page has a `google_place_id`, another page in the same scope cannot claim the same id without explicit merge. No data loss risk; two pages that SHOULD be one stay as two until a follow-up dedup pass runs. Acceptable for v1.
- **API surface parity:** GraphQL `WikiPage` resolver does NOT gain fields in v1 — future consumer work lands them. No parity concerns.
- **Integration coverage:** Compile pipeline + backfill script must be exercised end-to-end on a seeded fixture with journal-sourced metadata. Unit tests alone cannot prove the place_id column carries through from record metadata → page row → linker lookup → reference edge — integration tests required on at least Unit 2 and Unit 3.
- **Unchanged invariants:** `WikiPageType` enum, existing city/journal linker path, `parent-expander.ts::extractCityFromSummary` (stays as fallback), `wiki-link-backfill.ts` Phase A and Phase B behaviors, all existing metrics, tenant/owner scope isolation. The pgvector extension is also untouched (irrelevant post-simplification).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Aggregation-planner output drifts on pages whose inbound-edge counts change | R5 drift budget (≤ 10% unexpected section-promotion deltas); pre/post snapshot diff on affected pages before the PR merges; rollback is available via revert of Unit 3 (linker path) without touching schema |
| Same physical location has multiple Google place_ids (nested POI) → pages split instead of merge | Partial unique index only prevents DUPLICATE place_ids within scope, not SPLIT (which would be two DIFFERENT place_ids for the same location). Acknowledged known miss for v1; Phase C logs raw `google_place_id` + lat/lon so a follow-up proximity-merge pass has the data. Count the frequency during execution — if > ~5% of pages, escalate to a v1 fix |
| Hindsight metadata format changes (e.g. nested objects become allowed) | Defensive parsing (parseFloat with NaN skip); existing `journal-import.ts:288-297` comment documents the `Dict[str, str]` constraint as load-bearing; a change to that would be its own plan |
| Partial unique index creation fails due to existing duplicate rows | Unit 1's pre-migration audit query catches this; on day one no rows have `google_place_id` set so impossible; if it ever fails, implementer resolves duplicates before creating the index |
| Phase C finds a scope where all existing pages have journal-sourced place metadata but the GiGi R5 lift still comes in < 10pp | Indicates a deeper mismatch: either the parent pages for the enriched child pages don't exist, or the linker isn't finding them. Investigation work, not a rollback — place data is still correctly persisted, the gap is in the linking. Follow-up plan. |
| `parseFloat` performance on very large backfill runs | Bounded: on GiGi's ~1077 pages × ~3121 memory_units, the total parse calls are in the thousands; negligible |
| Metric `links_written_place_id` gets added to `wiki_compile_jobs.metrics` but no dashboard reads it | Acceptable. Plan 012's deferred metric pruning includes this kind of audit as a separate sweep; the metric's purpose here is R5 measurement in the backfill run, not ongoing observability |

## Documentation / Operational Notes

- **No CI migration runner exists.** The deploy workflow deploys Lambda code + terraform but does not run `drizzle-kit migrate` or apply migration SQL files. This was observed during plan 012 rollout: migration 0016 had to be applied manually via psql after merge. Unit 1's migration (0017) will require the same manual apply step. Worth scoping a separate ticket to add `drizzle-kit migrate` to deploy.yml (or document the manual process explicitly in AGENTS.md) — not blocking this plan.
- **Rollout**: Phase 1 (Units 1-3) merges first as PR A → manual migration apply → one dev compile cycle to confirm no errors → Phase 2 (Unit 4) merges as PR B → Phase C backfill runs on GiGi → R5 measurement → if pass, backfill Marco and any other journal-sourced scope → done.
- **Observability post-ship:** the `links_written_place_id` metric is the primary signal; `wiki_page_links.context LIKE 'deterministic:place_id:%'` gives retroactive volume counts. CloudWatch log scan for `parseFloat` errors on a weekly basis for the first month to catch unexpected metadata format drift.
- **Commit messages per unit:**
  - PR A:
    - Unit 1: `feat(wiki): add geo columns + unique place_id index to wiki_pages`
    - Unit 2: `feat(wiki): compile-time place promotion from record metadata`
    - Unit 3: `feat(wiki): deterministic linker place_id path`
  - PR B:
    - Unit 4: `feat(wiki): Phase C backfill — populate geo on existing pages`

## Sources & References

- **Origin document:** [docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md](docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md)
- **Predecessor plan (merged this session):** [docs/plans/2026-04-20-012-refactor-wiki-pipeline-simplification-plan.md](docs/plans/2026-04-20-012-refactor-wiki-pipeline-simplification-plan.md) — deletion-first cleanup; this plan's additive columns land on the cleaner surface
- **Parent architectural plan:** [plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md](plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md) — "no new page types" non-goal this plan respects
- **Candidate-pool audit** (this session, 2026-04-21): 85.9% GiGi / 30.9% Marco / 0% Cruz `place_google_place_id` coverage, measured via `wiki_section_sources` → `hindsight.memory_units.metadata` join
- **Backfill validation run** (this session, 2026-04-21): Marco at ceiling (389 → 389 edges, zero lift); GiGi near ceiling (+1.1pp from backfill, reached 49.7%); Cruz at 100% linked%
- **Reviewer findings integrated into origin:** coherence + feasibility + product-lens + scope-guardian + adversarial-document (all completed 2026-04-21 on the origin doc)
- **Related shipped PRs:** #328 (Units 1-3 of simplification), #329 (Units 4-5 schema drops)
