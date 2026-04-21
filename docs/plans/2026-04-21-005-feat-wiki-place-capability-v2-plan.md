---
title: "feat: Wiki Place capability v2 — first-class wiki_places table with Google Places hierarchy"
type: feat
status: active
date: 2026-04-21
origin: docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md
supersedes: docs/plans/2026-04-21-004-feat-wiki-place-capability-plan.md
---

# feat: Wiki Place capability v2 — first-class `wiki_places` table with Google Places hierarchy

## Overview

Introduce `Place` as a first-class entity in the wiki domain. A new `wiki_places` table carries canonical location identity (name, Google `place_id`, lat/lon, address, `parent_place_id` self-FK, `place_kind`, source provenance). `wiki_pages.place_id` is a nullable FK. During compile, every POI record triggers a find-or-create that (a) calls Google Places API to resolve parent city/state/country, (b) materializes the parent chain as `wiki_places` rows, and (c) auto-creates a backing `wiki_page` for every hierarchy tier. The deterministic linker walks `parent_place_id` and emits one reference edge per page to its immediate parent — POI→city, city→state, state→country.

When the Google API is unavailable (key missing, rate-limited, 5xx, network), compile degrades gracefully to metadata-only rows (no hierarchy) and never fails. First-seen-wins for conflicts. Frozen cache after first lookup (D7 — see ToS risk in Risks table). Existing city-regex deterministic path (`parent-expander.ts::extractCityFromSummary`) stays for records without `place_google_place_id` — no deprecation.

This plan supersedes the design in `docs/plans/2026-04-21-004-feat-wiki-place-capability-plan.md`, which tried to use record-metadata place_ids as parent identifiers (a record carries its POI's own id, not a parent city's id — the linker would have emitted self-edges). The redesign captures hierarchy structurally via live Google API lookups and materializes parents, not by inference.

## Problem Frame

See origin: `docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md`.

Short version: we ran every existing backfill algorithm against GiGi this session — 48.6% → 49.7% entity linked% (+1.1pp). Marco is at its 67.8% ceiling (+0pp). ~50% of GiGi's 1,054 entity pages remain unlinked because the current regex/fuzzy path can't extract a reliable parent from the unlinked tail. Structured Google `place_id` data sits in `memory_units.metadata` for 85.9% of GiGi's records and is thrown away. The Google Places API key is now available in `terraform/examples/greenfield/terraform.tfvars` (as `google_places_api_key`), unplumbed. This plan puts that signal to work.

Cross-cutting consequence: the wiki has no geo anywhere today. Every downstream capability the mobile and admin teams want — map views, proximity search, geo-aware aggregation — waits on this.

## Requirements Trace

Mirrors the origin doc's requirements numbering.

- **R1** `wiki_places` table exists with `(id, tenant_id, owner_id, name, google_place_id, geo_lat, geo_lon, address, parent_place_id, place_kind, source, source_payload, created_at, updated_at)`. `source` is text with sentinel values `'google_api' | 'journal_metadata' | 'manual' | 'derived_hierarchy'`.
- **R2** `wiki_pages.place_id` nullable FK → `wiki_places.id` with `ON DELETE SET NULL`. Index present.
- **R3** Partial unique index `(tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL`. Hand-edited SQL migration (Drizzle DSL can't emit partial uniques — see `packages/database-pg/drizzle/0007_unique_external_task_id.sql` precedent).
- **R4** Compile-time find-or-create of `wiki_places` rows when a record carries `place_google_place_id`. Calls Google Places API (New) when the key is available; walks `addressComponents` to materialize city/state/country parents (state only when `country_code ∈ {US, CA}`). On API failure (429/5xx/network), degrades to metadata-only row; compile never fails because of Google.
- **R5** Each newly-created `wiki_places` row triggers find-or-create of a backing `wiki_page`. Find step checks existing pages by exact slug match then fuzzy alias (reusing alias-lookup machinery extracted from `maybeMergeIntoExistingPage`). Create step uses Google's localized `displayName` + `formattedAddress` when available; static template `"Location hub for {name}"` when not.
- **R6** Deterministic linker walks `wiki_places.parent_place_id` for each affected page's place and emits a single reference edge to the backing page of the immediate parent. Edge kind: `'reference'`. Edge context: `deterministic:place:<parent wiki_places.id>`. Metric: `links_written_place`.
- **R7** Existing city-regex deterministic path (`parent-expander.ts::extractCityFromSummary`) coexists for records without `place_google_place_id`. No deprecation, no behavior change on that path.
- **R8** `wiki_pages.place_id` population is first-seen-wins (`COALESCE(existing_place_id, new_place_id)`). The partial unique index enforces first-seen-wins at the scope level for `wiki_places.google_place_id`.
- **R9** Google API responses are cached verbatim in `source_payload` jsonb. No automatic re-call. Manual refresh script `packages/api/scripts/wiki-places-refresh.ts` accepts `--place-id`, `--scope`, `--stale-before`.
- **R10** API key plumbed from `terraform.tfvars` → **SSM SecureString** at `/thinkwork/<stage>/google-places/api-key`, fetched in Lambda init, cached in-process. IAM: `ssm:GetParameter` on the parameter ARN + `kms:Decrypt` on the parameter's KMS key.
- **R11** Rate-limit / circuit-breaker: per-call retry with exponential backoff on `429`/`5xx` (500ms → 1s → 2s → 4s, max 3 attempts). Per-compile-run breaker: after **5 consecutive failures** OR any `RESOURCE_EXHAUSTED` response, flip the remainder of the run to metadata-only (no Google calls). Breaker state resets on next compile invocation (lives in-process on the Lambda, not persisted).
- **R12** Regression guard: Marco's entity-linked% stays at or above 67.8%. No new deterministic false-positive patterns (no `"Toronto" ≈ "Toronto Life"`-class collisions).
- **R13** GiGi entity-linked% lift target: **measured as Unit 1 of this plan** via `packages/api/scripts/wiki-places-audit.ts`. The audit queries `wiki_section_sources` → Hindsight `memory_units.metadata.raw` for currently-unlinked GiGi entity pages and computes the fraction carrying `place_google_place_id`. That fraction × 1,054 unlinked pages = addressable ceiling. Lift target = the resulting absolute-percentage-point delta, recorded in the PR B description before Phase C runs.
- **R14** Aggregation-planner drift budget: **≤ 10%** of pages whose `computeLinkNeighborhoods` inbound counts change see an unexpected section-promotion delta on post-deploy diff. Measurement tool: `packages/api/scripts/wiki-places-drift-snapshot.ts`, defined in Unit 1, runs pre-deploy + post-deploy and diffs `wiki_page_sections.aggregation` on affected pages.

## Scope Boundaries

- No new `WikiPageType`. `type` stays `entity | topic | decision`. Place is a table, not a page shape.
- No PostGIS, no `earthdistance` extension. `numeric(9,6)` lat/lon only.
- No GraphQL exposure of geo fields on `WikiPage` in v1.
- No map rendering UI.
- No Google Places Autocomplete at read-time; compile-time lookups only.
- No automatic cache refresh / TTL (manual only).
- No cross-tenant place sharing.
- No hierarchy deeper than country. Neighborhood, sublocality, `administrative_area_level_2` ignored.
- No change to `parent-expander.ts::extractCityFromSummary`'s current behavior (see the "Deferred" note on the Hindsight adapter bug).

### Deferred to Separate Tasks

- **GraphQL `WikiPage` geo resolver** — lands with the first consumer (mobile map view or admin debug surface). Data already in DB, no recompile needed.
- **Proximity search / geo-aware aggregation** — separate plan; enabled by the columns this plan ships.
- **Parent-expander `metadata.raw.*` vs top-level bug fix** — the live `parent-expander.ts:104` reads `r.metadata.place_address` but Hindsight nests it under `r.metadata.raw.place_address` (see Context). Fixing that would retroactively change the existing city-regex baseline for Marco and GiGi — a measurable shift independent of this plan's work. Scoped as a follow-up bug-fix PR so the two changes don't entangle in the R12 regression guard.
- **Nested-POI / rotated place_id merge pass** — when two `wiki_places` rows in the same scope end up pointing at the same physical location via different place_ids (Google rotated the id, or two records carry different versions). Count the frequency during Phase C execution; if meaningfully nonzero, propose a lat/lon proximity-merge rule in a follow-up.
- **Per-unit auto-PR migration runner** — `.github/workflows/deploy.yml` does not run `drizzle-kit migrate`. Unit 2's migration applies manually. A separate "wire up migrations in CI" ticket remains unblocked.

## Context & Research

### Relevant Code and Patterns

- `packages/database-pg/src/schema/wiki.ts` — target for the `wiki_places` table declaration and `wiki_pages.place_id` column. Self-FK pattern at lines 84–86 (`wiki_pages.parent_page_id`) is the template for `wiki_places.parent_place_id` — needs the `AnyPgColumn` typed cast.
- `packages/database-pg/drizzle/0007_unique_external_task_id.sql` — precedent for a hand-edited migration that adds a partial unique index Drizzle can't emit. Pattern: declare a plain `index()` in the TS schema, hand-edit the migration to upgrade it to `CREATE UNIQUE INDEX ... WHERE`.
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — most recent migration. Shows style (leading comment, `DO $$ ... $$` guards, explicit `IF EXISTS`/`IF NOT EXISTS`).
- `packages/api/src/lib/wiki/compiler.ts:223, 506, 660, 742, 805, 1215, 1352, 1455, 1512, 1824` — seven page-write call sites, all funneling through `repository.ts::upsertPage(924)`. Wiring `place_id` into `upsertPage` covers every path.
- `packages/api/src/lib/wiki/compiler.ts::maybeMergeIntoExistingPage` (1728–1859) — file-private alias-lookup + merge. Unit 5 extracts a smaller `findExistingPageByTitleOrAlias` helper the place creator can reuse without the merge semantics.
- `packages/api/src/lib/wiki/compiler.ts::emptyMetrics` (1586) — where `links_written_place` initializer lands.
- `packages/api/src/lib/wiki/parent-expander.ts` — `ParentCandidateReason` union at line 20 gets `"place"` added. `DerivedParentCandidate` at 30–57 stays shape-compatible; hierarchy edges do NOT go through this path (see Unit 7 — dedicated `emitPlaceHierarchyLinks`).
- `packages/api/src/lib/wiki/deterministic-linker.ts::LINKABLE_LEAF_TYPES` (line 22) = `{entity}` today. Widening it to include `topic` would make every topic page a linking leaf for every candidate, not just place ones — load-bearing. Unit 7 adds a dedicated `emitPlaceHierarchyLinks` function that bypasses this gate and walks `wiki_places.parent_place_id` directly.
- `packages/api/src/lib/wiki/journal-import.ts:298-340` — writes `place_google_place_id` + `place_geo_lat`/`lon`/`address` into `memory_units.metadata` as flat strings. Load-bearing: Hindsight rejects nested objects with HTTP 422.
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts:406-420` — `mapUnit()` nests the raw dict as `metadata.raw`. The place-service code (Unit 5) reads `r.metadata?.raw?.place_google_place_id` (not `r.metadata?.place_google_place_id`). A tiny helper `readPlaceMetadata(record)` localizes the convention.
- `packages/api/src/lib/wiki/repository.ts::upsertPage(924)`, `findAliasMatches(1101)`, `findAliasMatchesFuzzy(1134)`, `upsertPageLink(1484)` — existing helpers. Unit 5 adds `findPageByGooglePlaceId`, `upsertPlace`, `findPlaceByGooglePlaceId`. Unit 7 adds `findPageByPlaceId`.
- `packages/api/src/lib/wiki/link-backfill.ts::runLinkBackfill` (141 lines) + `packages/api/scripts/wiki-link-backfill.ts` (212 lines) — phased orchestrator + CLI. Phase C extension pattern proven.
- `terraform/modules/app/lambda-api/handlers.tf:14-55, 60-79, 122, 144-145, 463-475` — five-layer env plumbing precedent (shared env + handler-extra env + SSM parameter creation). `wiki-compile` entry at 71–75 is where `GOOGLE_PLACES_SSM_PARAM_NAME` gets added.
- `terraform/examples/greenfield/terraform.tfvars` — `google_places_api_key` lives here as plaintext. Unit 4 adds the plumbing through 5 layers to SSM.
- `packages/api/scripts/wiki-parent-link-audit.ts` — shape precedent for `wiki-places-audit.ts` + `wiki-places-drift-snapshot.ts` + `wiki-places-refresh.ts`.
- `packages/api/src/__tests__/wiki-compiler.test.ts:498-724` — `scriptAdapter` + `mockRepo` pattern is the template for place-integrated compile tests. Mock the Google Places client like the planner is mocked today.

### Institutional Learnings

- `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md` — commit an audit script alongside the feature (Unit 1). Zeros at the tail almost always mean an upstream stage produced nothing; don't start by tuning thresholds.
- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` — every `onConflictDoNothing()` site must log a `console.warn` with the conflict key when `inserted=false`. Applied to `upsertPlace` and `upsertPage` calls emitted by the place service.
- `docs/solutions/best-practices/js-word-boundary-is-ascii-only-2026-04-20.md` — place names cover the full Unicode range (Bogotá, São Paulo, München). Any trailing regex anchor on place-name strings must use `(?=[^\p{L}]|$)`, not `\b`. Slug builders and fuzzy-alias normalizers for place rows must be Unicode-safe. Include Bogotá/São Paulo/München in test fixtures.
- Memory: `project_tfvars_secrets_hygiene.md` — tfvars is plaintext; migrate to SSM when prod lands. This plan forces SSM for Google Places key, establishing the pattern.
- Memory: `feedback_pnpm_in_workspace.md` — pnpm only. Scripts in `packages/api/scripts/` invoked via `tsx`.
- Memory: `feedback_avoid_fire_and_forget_lambda_invokes.md` — refresh script (Unit 9) uses `RequestResponse` if it invokes a Lambda, surfaces errors.
- Memory: `feedback_graphql_deploy_via_pr.md` — no `aws lambda update-function-code` for wiki-compile; terraform-apply on merge handles it.
- Memory: `feedback_diff_against_origin_before_patching.md` — fetch + diff wiki.ts vs `origin/main` before the schema PR (recent #328/#329 churn).

### External References

- Places API (New) Place Details: https://developers.google.com/maps/documentation/places/web-service/place-details
- Places API billing: https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
- Places policies & caching: https://developers.google.com/maps/documentation/places/web-service/policies
- AWS SSM Parameter Store + Lambda: https://aws.amazon.com/blogs/compute/choosing-the-right-solution-for-aws-lambda-external-parameters/

### Adversarial Signals Integrated

- **ToS vs D7**: Google Places ToS permits caching `place_id` indefinitely and lat/lon for 30 days; `addressComponents` is NOT permitted beyond short windows. D7 (frozen cache in `source_payload`) is technically a ToS violation. User chose "accept risk" at planning time; Risks table documents it explicitly.
- **Linker type-gate risk**: widening `LINKABLE_LEAF_TYPES` to include `topic` would affect every candidate, not just place ones. Plan uses a dedicated `emitPlaceHierarchyLinks` function that bypasses the candidate pipeline (see Unit 7).
- **Auto-create collision risk**: `findPagesByExactTitle` logs-and-picks-first on collisions. The place-creator pre-checks via the extracted `findExistingPageByTitleOrAlias` helper.
- **Aggregation planner drift**: place-hierarchy edges change inbound counts on affected pages, feeding the aggregation planner. R14 budget + Unit 1's drift-snapshot script catch this before PR B merges.

## Key Technical Decisions

- **Lazy-at-compile-time find-or-create.** No separate enrichment Lambda, no ingest-time change. Single pipeline stage matches existing compile semantics (see brainstorm D2).
- **Google Places API (New), raw `fetch`, no SDK.** The older `@googlemaps/google-maps-services-js` is legacy-only; the new `@googlemaps/places` is gRPC/service-account-oriented and adds cold-start cost. Place Details is one endpoint; a ~50-line typed `fetch` wrapper keeps the bundle trim and tests simple. FieldMask header is mandatory.
- **Hierarchy tiers: city, state (US/CA only), country.** Walk `addressComponents`, match `locality` → city (fallback: `postal_town`), `administrative_area_level_1` → state iff `country_code ∈ {US, CA}`, `country` → country. City-states (Singapore, Monaco, Vatican) skip the city tier — POI's parent is country directly.
- **Auto-create backing `wiki_page` for every hierarchy tier.** Determinism over LLM judgment (see brainstorm D4). Uses extracted `findExistingPageByTitleOrAlias` helper for dedup. New place-type mapping: `country`/`state`/`city` → `topic`; `poi` → `entity`.
- **Dedicated `emitPlaceHierarchyLinks` function, not a new candidate reason.** Avoids widening `LINKABLE_LEAF_TYPES` and avoids inventing `sourceKind: "place"` candidates. Walks `wiki_places.parent_place_id` chain for affected pages; one reference edge per page to its immediate parent. Edge kind = `'reference'` (matches existing parent-edge emission). Edge context = `deterministic:place:<parent wiki_places.id>`.
- **First-seen-wins** for both `wiki_pages.place_id` (via `COALESCE`) and `wiki_places.google_place_id` (via partial unique index throwing `UniqueViolation` on conflict — caught + logged at the place service boundary).
- **Frozen cache; manual refresh only.** `source_payload` is written once, never auto re-fetched. ToS risk documented (see Risks) — user accepted at planning.
- **Circuit breaker on Google Places: in-process, per-compile-run.** 5 consecutive failures OR any `RESOURCE_EXHAUSTED` → metadata-only for the rest of the run. State resets on next invocation. No external breaker infra.
- **SSM SecureString over env var** for the API key. IAM grant scoped to `/thinkwork/<stage>/google-places/*`.
- **Backfill emits hierarchy edges directly** (no recompile trigger). Phase C walks `parent_place_id` for each enriched page and calls `upsertPageLink` in the same pass. Mirrors Phase A's pattern.
- **Parent-expander metadata bug stays unfixed in this PR.** The `metadata.raw.*` vs `metadata.*` mismatch is real and live. Fixing it retroactively changes the baseline for R12. Scoped as a follow-up.

## Open Questions

### Resolved During Planning

- **ToS vs D7**: Keep D7 as-is. Accept risk. Documented in Risks.
- **API key storage**: SSM SecureString at `/thinkwork/<stage>/google-places/api-key`.
- **Backfill edge emission**: direct emission inside Phase C, no recompile trigger.
- **Rate-limit breaker constants**: 3 retries (500ms/1s/2s/4s backoff), 5 consecutive failures → breaker flip, state resets per invocation.
- **`source_payload` schema contract**: store the verbatim Place Details (New) response. No normalization at write-time; callers re-parse on read via a typed helper. Schema drift between Google API versions surfaces at read-time as parse failures, not data loss.
- **Manual-edit preservation**: `source='manual'` rows are never overwritten by the refresh script. Refresh only targets `source IN ('google_api', 'derived_hierarchy')`.
- **Google returns a different place_id than the record carried**: trust the API response as canonical. `source_payload` retains both ids (Google's response is verbatim; the record's original id is in the audit log line emitted at the find-or-create call site).

### Deferred to Implementation

- **Exact write ordering when find-or-create happens inside `applyPlan`**. Three page-write seams in `applyPlan` each need the place_id. Cleanest to compute `place_id` once per batch and include it in every `upsertPage` call, but the implementer may find a narrower seam. Characterization test (Unit 6) captures current compile output first.
- **R13 addressable-denominator number**. Concrete lift target is the output of Unit 1, recorded in PR B's description. Do not speculate in this plan.
- **Breaker state representation**. In-process module-level counter is simplest; a closure over the compile-job object is also fine. Pick the smaller surface at implementation.
- **`wiki-places-refresh.ts` flag shape**: `--place-id`, `--scope <tenant/owner>`, `--stale-before <ISO date>`. Whether flags are OR'd or require exactly one is the implementer's call. Dry-run supported by default.
- **Test fixture Unicode coverage**: include Bogotá + São Paulo + München in at least one place-creation test (per institutional learning). Implementer decides which unit tests cover these vs which rely on slug-normalizer unit tests.

## Output Structure

New files (repo-relative):

    packages/database-pg/
      drizzle/
        0017_wiki_places.sql                              # hand-edited migration
        meta/0017_snapshot.json                           # drizzle-generated, hand-verified

    packages/api/src/lib/wiki/
      google-places-client.ts                             # thin fetch wrapper + circuit breaker
      places-service.ts                                   # find-or-create + hierarchy walk + auto-page-create
      readPlaceMetadata.ts                                # localized metadata.raw.* reader

    packages/api/scripts/
      wiki-places-audit.ts                                # Unit 1 R13 audit
      wiki-places-drift-snapshot.ts                       # Unit 1 R14 drift tool
      wiki-places-refresh.ts                              # Unit 9 manual refresh

    packages/api/src/__tests__/
      wiki-places-service.test.ts
      wiki-google-places-client.test.ts
      wiki-place-hierarchy-linker.test.ts

Modified files (repo-relative):

    packages/database-pg/src/schema/wiki.ts               # wiki_places table + wiki_pages.place_id
    packages/database-pg/drizzle/meta/_journal.json       # +0017

    packages/api/src/lib/wiki/compiler.ts                 # integrate places-service into applyPlan + metrics
    packages/api/src/lib/wiki/repository.ts               # findPageByGooglePlaceId, findPageByPlaceId, upsertPlace, findPlaceByGooglePlaceId
    packages/api/src/lib/wiki/deterministic-linker.ts     # emitPlaceHierarchyLinks export
    packages/api/src/lib/wiki/parent-expander.ts          # +"place" in ParentCandidateReason union (for context string only)
    packages/api/src/lib/wiki/link-backfill.ts            # Phase C addition
    packages/api/src/handlers/wiki-compile.ts             # wire SSM fetch for API key at init

    packages/api/scripts/wiki-link-backfill.ts            # CLI wiring for Phase C

    packages/api/src/__tests__/wiki-compiler.test.ts      # place-enabled integration scenarios
    packages/api/src/__tests__/wiki-link-backfill.test.ts # Phase C scenarios
    packages/api/src/__tests__/wiki-deterministic-linker.test.ts # emitPlaceHierarchyLinks tests

    terraform/examples/greenfield/main.tf                 # variable declaration + pass-through
    terraform/examples/greenfield/terraform.tfvars        # (already has google_places_api_key)
    terraform/modules/thinkwork/variables.tf              # +google_places_api_key
    terraform/modules/thinkwork/main.tf                   # pass-through
    terraform/modules/app/lambda-api/variables.tf         # +google_places_api_key
    terraform/modules/app/lambda-api/handlers.tf          # SSM param creation + env plumbing for wiki-compile
    terraform/modules/app/lambda-api/main.tf              # IAM policy for ssm:GetParameter + kms:Decrypt

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Compile-time flow (new pages):**

```
compile batch of records for scope (tenant_id, owner_id)
  │
  ▼
for each record with metadata.raw.place_google_place_id:
  │
  ▼  places-service.ts::resolvePlaceForRecord
  │   1. findPlaceByGooglePlaceId(scope, place_id)  →  hit? use it; miss? continue
  │   2. if Google breaker not tripped + API key present:
  │        fetchPlaceDetails(place_id, fieldMask)
  │        walk addressComponents:
  │          country → find-or-create place (kind=country, source=derived_hierarchy)
  │          state   → if country_code ∈ {US,CA}: find-or-create (kind=state)
  │          city    → find-or-create (kind=city, locality|postal_town)
  │        insert POI place (kind=poi, source=google_api, parent=city|state|country)
  │        source_payload = verbatim response
  │      else:
  │        insert POI place (kind=poi, source=journal_metadata, parent=NULL)
  │   3. for each place created, auto-create backing wiki_page:
  │        findExistingPageByTitleOrAlias(title, scope)
  │          hit → set page.place_id (COALESCE-guarded)
  │          miss → upsertPage({type, title, slug, summary, place_id, aliases})
  │   4. return { poiPlaceId, pageIdsCreated, metrics }
  │
  ▼  compiler.ts (page-write seam in applyPlan)
  │   for each new page being upserted, compute place_id from record batch
  │   (first non-null POI place_id wins — first-seen-wins)
  │   pass place_id into upsertPage
  │
  ▼  deterministic-linker.ts::emitPlaceHierarchyLinks
  │   for each affectedPage with place_id:
  │     place = findPlaceById(page.place_id)
  │     parent_place_id = place.parent_place_id
  │     if parent_place_id:
  │       parent_page = findPageByPlaceId(parent_place_id)
  │       if parent_page:
  │         upsertPageLink(kind='reference', from=page, to=parent_page,
  │                        context=`deterministic:place:${parent_place_id}`)
  │         metrics.links_written_place++
```

**Graceful-degradation matrix:**

| Precondition | Outcome |
|---|---|
| API key missing from SSM | Every record → `source='journal_metadata'`, no hierarchy, no fail |
| Google returns 429 (first time) | Retry with backoff (3 attempts); on exhaust: metadata-only for this record |
| 5 consecutive Google failures this run | Breaker flips; rest of run is metadata-only |
| `RESOURCE_EXHAUSTED` response | Breaker flips immediately |
| `NOT_FOUND` (rotated place_id) | Fall back to record's native metadata, source='journal_metadata' |
| `addressComponents` shape unexpected | Log, skip hierarchy, create POI only; never fail |
| Partial unique index collision on upsert | Caught; read existing row; link page to it; log collision |

**Phase C backfill flow (one-time per scope):**

```
for each active wiki_page in scope:
  if page.place_id is null:
    records ← fetch source memory_units via wiki_section_sources
    for each record with metadata.raw.place_google_place_id:
      resolvePlaceForRecord(record)                       # same as live compile
    pick first resolved POI place; UPDATE page.place_id (COALESCE guard)
  if page.place_id IS NOT NULL:
    emit hierarchy edge (same walk as emitPlaceHierarchyLinks)
```

**Sequencing diagram (PR rollout):**

```
PR A: Units 1-7 merge → manual apply 0017_wiki_places.sql → terraform apply
      → one dev compile cycle (small GiGi subset) → verify metrics, zero errors
      → wet-run wiki-places-audit.ts on GiGi → record R13 lift target
PR B: Units 8-9 merge → wet-run Phase C backfill on GiGi
      → measure linked% before/after → verify R13 met, R14 drift ≤ 10%
      → backfill Marco (small lift expected; confirms R12 floor)
```

## Implementation Units

Two PRs. PR A (Units 1–7) ships the table, API plumbing, live compile path, and linker. PR B (Units 8–9) ships the backfill + refresh tools.

---

### Phase 1 — Schema, API plumbing, live compile (ships as PR A)

- [ ] **Unit 1: Audit + drift-snapshot scripts (R13, R14 tooling)**

**Goal:** Produce two committed, runnable scripts: one that measures R13's addressable ceiling (% of currently-unlinked GiGi entity pages whose source records carry `place_google_place_id`), and one that snapshots `wiki_page_sections.aggregation` + inbound-link counts for drift comparison. Run the audit against GiGi; record the number in the PR description.

**Requirements:** R13, R14

**Dependencies:** None.

**Files:**
- Create: `packages/api/scripts/wiki-places-audit.ts`
- Create: `packages/api/scripts/wiki-places-drift-snapshot.ts`
- Create: `packages/api/src/__tests__/wiki-places-audit.test.ts` (smoke-level only)

**Approach:**
- `wiki-places-audit.ts --tenant <uuid> --owner <uuid>` queries `wiki_pages` for `status='active' AND type='entity'` with no inbound `wiki_page_links` (proxy for "unlinked"). Joins `wiki_section_sources` → Hindsight `memory_units.metadata` (via adapter) → checks `metadata.raw.place_google_place_id` presence. Outputs: `{ unlinked_entity_pages, pages_with_place_id, addressable_ceiling_pct, projected_lift_pp }`.
- `wiki-places-drift-snapshot.ts --tenant --owner --output <path>` writes a JSONL file keyed on `page_id` with `{ aggregation, inbound_link_count, inbound_link_ids[] }`. Second invocation accepts `--compare <path>` and diffs, reporting pages with aggregation deltas alongside inbound-count changes. Threshold: ≤10% of affected pages with deltas = pass.
- Mirror `packages/api/scripts/wiki-parent-link-audit.ts` shape — `tsx` shebang, argv parsing, dotenv loading, explicit exit codes.

**Patterns to follow:**
- `packages/api/scripts/wiki-parent-link-audit.ts` — CLI + Hindsight adapter usage + output formatting.

**Test scenarios:**
- Happy path (audit): fixture with 10 unlinked pages, 6 with place-carrying sources → output reports `addressable_ceiling_pct = 60%`, `projected_lift_pp = 5.7` (6/1054).
- Edge case (audit): scope with 0 unlinked entity pages → reports `addressable_ceiling_pct = 0%`, exits cleanly.
- Happy path (drift): two snapshots on a fixture scope, one page's inbound count changes from 2→5; diff command reports that page.
- Edge case (drift): identical snapshots → diff reports 0 changes.

**Verification:**
- Running `pnpm --filter @thinkwork/api tsx scripts/wiki-places-audit.ts --tenant <GiGi-tenant> --owner <GiGi-owner>` produces a numeric R13 target recorded in the PR description.
- Running the drift-snapshot tool pre-deploy (to be invoked in Unit 8's rollout) produces a baseline JSONL file.

---

- [ ] **Unit 2: `wiki_places` schema + `wiki_pages.place_id` FK + partial unique index**

**Goal:** Land the table, FK, and indexes. No behavior change yet — purely schema additions and declarative Drizzle updates.

**Requirements:** R1, R2, R3

**Dependencies:** None (can ship standalone; Unit 6+ depend on it).

**Files:**
- Modify: `packages/database-pg/src/schema/wiki.ts` — declare `wikiPlaces` table and add `place_id` to `wikiPages`; add `relations()` entries.
- Create: `packages/database-pg/drizzle/0017_wiki_places.sql` — hand-edited migration, including the partial unique index (Drizzle can't emit it).
- Create: `packages/database-pg/drizzle/meta/0017_snapshot.json` — drizzle-generated via `pnpm --filter @thinkwork/database-pg db:generate`; hand-verify no unrelated drift.
- Modify: `packages/database-pg/drizzle/meta/_journal.json` — add `0017` entry (match 2-space indent).

**Approach:**
- Table columns per brainstorm Architecture table: `id uuid PK default gen_random_uuid()`, `tenant_id uuid NOT NULL`, `owner_id uuid NOT NULL`, `name text NOT NULL`, `google_place_id text NULL`, `geo_lat numeric(9,6) NULL`, `geo_lon numeric(9,6) NULL`, `address text NULL`, `parent_place_id uuid NULL` (self-FK with `ON DELETE SET NULL`, use `AnyPgColumn` cast per `wiki_pages.parent_page_id:84-86`), `place_kind text NULL` (check constraint: `IN ('country','region','state','city','neighborhood','poi','custom')`), `source text NOT NULL` (check constraint: `IN ('google_api','journal_metadata','manual','derived_hierarchy')`), `source_payload jsonb NULL`, `created_at`/`updated_at timestamptz DEFAULT now()`.
- Indexes: `CREATE INDEX ON wiki_places (tenant_id, owner_id)`, `CREATE INDEX ON wiki_places (parent_place_id)`, `CREATE UNIQUE INDEX idx_wiki_places_scope_google_place_id ON wiki_places (tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL`.
- In `wiki.ts`, declare the unique index using Drizzle's plain `index()` (not `uniqueIndex()`), because Drizzle can't emit the `WHERE` clause. Hand-edit the migration to promote it to `UNIQUE` with the `WHERE`. Add a comment in the TS schema explaining the divergence so the next author doesn't "fix" it.
- `wiki_pages.place_id uuid NULL REFERENCES wiki_places(id) ON DELETE SET NULL`. Index on `(place_id) WHERE place_id IS NOT NULL`.
- Pre-migration audit (Unit 2 PR notes must mention this): `SELECT tenant_id, owner_id, google_place_id, count(*) FROM wiki_places WHERE google_place_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) > 1;` — must return zero rows before the UNIQUE index creates. On day one, zero rows exist because the table is new; the pattern stands as an invariant for future loaders.
- Migration style follows `0016_wiki_schema_drops.sql`: leading comment, explicit `IF NOT EXISTS`, no `DO $$` blocks needed for additive-only.

**Execution note:** No CI migration runner. Operator applies `0017_wiki_places.sql` manually via psql after PR A merges, before any code that references `wiki_places` runs in production. Document the step in the PR A description.

**Patterns to follow:**
- `packages/database-pg/drizzle/0007_unique_external_task_id.sql` — partial unique + Drizzle DSL divergence pattern.
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — migration style.
- `packages/database-pg/src/schema/wiki.ts:60-130, 416-525` — table + relations block structure.

**Test scenarios:**
- Test expectation: none — pure schema addition, no behavioral change tested at this unit.
- Smoke (post-migration): `\d wiki_places` shows all columns + indexes; `\d wiki_pages` shows `place_id` + FK + index; `EXPLAIN SELECT * FROM wiki_places WHERE google_place_id = 'x'` uses the partial unique index; `INSERT INTO wiki_places (..., google_place_id) VALUES (..., 'X')` twice for same scope raises unique-violation.

**Verification:**
- `pnpm --filter @thinkwork/database-pg db:generate` produces a clean snapshot matching expectation.
- Migration applies cleanly against a dev DB.
- Full `pnpm -w test` passes post-migration (no references to new columns yet).
- `drizzle-kit introspect` shows no drift between schema and DB.

---

- [ ] **Unit 3: `readPlaceMetadata` helper — localized `metadata.raw.*` reader**

**Goal:** Contain the Hindsight-adapter metadata-nesting quirk in one place. All downstream place code (Units 5, 7, 8) reads records through this helper, which knows that journal-import's flat keys (`place_google_place_id`, etc.) live at `record.metadata.raw.*`, not at `record.metadata.*`. Does not modify existing parent-expander behavior.

**Requirements:** R4 (correctness prerequisite)

**Dependencies:** None.

**Files:**
- Create: `packages/api/src/lib/wiki/readPlaceMetadata.ts`
- Create: `packages/api/src/__tests__/wiki-read-place-metadata.test.ts`

**Approach:**
- Export `readPlaceMetadata(record: ThinkWorkMemoryRecord): { googlePlaceId?: string; geoLat?: number; geoLon?: number; address?: string; name?: string; types?: string[] } | null` that returns null if no place fields are present.
- Reads `record.metadata?.raw?.place_google_place_id`, `place_geo_lat`, `place_geo_lon`, `place_address`, `place_name`, `place_types` (CSV → array).
- `parseFloat` on lat/lon; on NaN, skip the field (but don't null the whole result).
- Empty-string `place_google_place_id` is treated as absent.
- Does not read from `record.metadata.place_*` (the buggy-expander path). Explicit comment documents why: "Hindsight nests journal-import flat dict under `metadata.raw`; the existing parent-expander.ts reads the wrong path — tracked as a separate follow-up. This helper reads the correct path."
- No side effects. Pure function.

**Patterns to follow:**
- `packages/api/src/lib/wiki/aliases.ts::normalizeAlias` — small, pure, single-purpose helper.

**Test scenarios:**
- Happy path: record with `metadata.raw.place_google_place_id='ChIJ123'`, `place_geo_lat='48.8566'`, `place_geo_lon='2.3522'`, `place_address='…, Paris'` → returns typed object with parsed floats.
- Happy path: record with Hindsight adapter shape exactly as `mapUnit()` at `hindsight-adapter.ts:406-420` produces → helper correctly extracts place fields.
- Edge case: record with `metadata.raw` missing → returns null (no false positives).
- Edge case: record with `metadata.place_google_place_id` at the wrong level → returns null (explicitly does NOT accept the buggy path).
- Edge case: `place_geo_lat='not_a_number'` → lat is undefined but other fields still populated.
- Edge case: `place_google_place_id=''` → returns null.
- Edge case: record with Unicode place name (São Paulo) → name field passes through verbatim.

**Verification:**
- Unit tests pass; no changes to live compile behavior observable (this helper has no call sites yet).

---

- [ ] **Unit 4: Google Places API key plumbing + thin `fetch` client + circuit breaker**

**Goal:** Plumb the API key from tfvars → SSM SecureString → Lambda init; ship a typed `fetchPlaceDetails` client with retry + circuit breaker.

**Requirements:** R10, R11

**Dependencies:** None.

**Files:**
- Create: `packages/api/src/lib/wiki/google-places-client.ts`
- Create: `packages/api/src/__tests__/wiki-google-places-client.test.ts`
- Modify: `packages/api/src/handlers/wiki-compile.ts` — fetch API key from SSM at init; store in module-scope; pass to places-service via compile-job options.
- Modify: `terraform/examples/greenfield/main.tf` — declare `variable "google_places_api_key"`; pass through to `module "thinkwork"`.
- Modify: `terraform/modules/thinkwork/variables.tf` — `variable "google_places_api_key"` declaration.
- Modify: `terraform/modules/thinkwork/main.tf` — pass through to `module "lambda_api"`.
- Modify: `terraform/modules/app/lambda-api/variables.tf` — variable declaration.
- Modify: `terraform/modules/app/lambda-api/handlers.tf` — `aws_ssm_parameter` resource creation (type = SecureString); add `GOOGLE_PLACES_SSM_PARAM_NAME` to `wiki-compile`'s `handler_extra_env`.
- Modify: `terraform/modules/app/lambda-api/main.tf` — `aws_iam_role_policy` granting `ssm:GetParameter` on the parameter ARN + `kms:Decrypt` on the parameter's KMS key (default `alias/aws/ssm`).

**Approach:**
- Client exposes `createGooglePlacesClient({ apiKey, logger }): { fetchPlaceDetails(placeId): Promise<PlaceDetailsResponse | null>, breakerState(): BreakerState }`.
- `fetchPlaceDetails` calls `GET https://places.googleapis.com/v1/places/{placeId}?languageCode=en` with `X-Goog-Api-Key` + `X-Goog-FieldMask: id,displayName,formattedAddress,addressComponents,types` headers.
- Retry: 3 attempts with backoff 500ms/1s/2s/4s on `429` + `5xx`. No retry on `4xx` other than 429.
- Breaker: closure over a counter + state enum (`closed`, `tripped`). `tripped` when 5 consecutive non-retryable+retry-exhausted failures occur, OR when any response carries `RESOURCE_EXHAUSTED`. `closed` → `tripped` is one-way per client instance. When tripped, `fetchPlaceDetails` returns `null` without calling Google.
- `NOT_FOUND` (rotated place_id) returns `null`, does NOT advance the breaker counter (expected behavior for rare-but-known upstream state).
- Response types declared locally (~20 lines, per research brief) — no `@googlemaps/*` SDK dependency. Verify response shape uses camelCase (`longText`/`shortText`/`addressComponents`) not legacy snake_case.
- Lambda init (wiki-compile handler): reads `process.env.GOOGLE_PLACES_SSM_PARAM_NAME`; fetches via AWS SSM SDK (`@aws-sdk/client-ssm`) on first invocation; caches in module scope. On SSM failure, logs at error level and proceeds with null key (compile continues with all records → `source='journal_metadata'`).
- Tests use `vi.fn()` mocks for `fetch` — no live API calls.

**Patterns to follow:**
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` — module-scope state pattern.
- `packages/api/src/handlers/*.ts` existing init patterns — how env vars are consumed today.
- `terraform/modules/app/lambda-api/handlers.tf:463-475` — SSM parameter creation style.
- AWS blog on SSM + Lambda init (cited in References).

**Test scenarios:**
- Happy path (client): mock `fetch` returns 200 + valid body → helper returns typed object; breaker stays `closed`; retry count = 0.
- Retry path (client): mock `fetch` returns 429 once, then 200 → helper retries, returns object; retry count = 1.
- Exhaust path (client): mock `fetch` returns 500 four times → after 3 retries, helper returns null; breaker counter increments.
- Breaker trip (client): 5 consecutive exhausts → breaker flips to `tripped`; 6th call returns null without invoking fetch.
- Breaker trip on quota (client): mock `fetch` returns 429 + `RESOURCE_EXHAUSTED` body → breaker flips immediately on first occurrence.
- NOT_FOUND (client): mock `fetch` returns 404 `NOT_FOUND` → helper returns null; breaker counter NOT incremented.
- Permission denied (client): mock `fetch` returns 403 → helper returns null; breaker counter incremented (non-retryable, counts as failure).
- Integration (Lambda init): mock SSM SDK; init path reads the SSM param and instantiates the client with the key.

**Verification:**
- Unit tests pass.
- Terraform plan against `greenfield` shows the SSM parameter + IAM policy + env var added; no unrelated changes.
- Deploy-style smoke (manual, post-merge): wiki-compile Lambda starts and logs "Google Places client initialized" or "Google Places key not available — all records will use metadata-only source".

---

- [ ] **Unit 5: Extract `findExistingPageByTitleOrAlias` helper + implement `places-service.ts`**

**Goal:** Extract a small alias-lookup helper from `maybeMergeIntoExistingPage` that the place-service can reuse without pulling in merge mechanics. Implement `places-service.ts::resolvePlaceForRecord` — find-or-create the POI place, walk `addressComponents` to materialize parent chain, auto-create a backing `wiki_page` for each tier.

**Requirements:** R1 (uses), R4, R5

**Dependencies:** Units 2, 3, 4.

**Files:**
- Create: `packages/api/src/lib/wiki/places-service.ts`
- Create: `packages/api/src/__tests__/wiki-places-service.test.ts`
- Modify: `packages/api/src/lib/wiki/compiler.ts` — extract `findExistingPageByTitleOrAlias` from `maybeMergeIntoExistingPage` (lines 1728-1859); export both.
- Modify: `packages/api/src/lib/wiki/repository.ts` — add `upsertPlace`, `findPlaceByGooglePlaceId`, `findPageByGooglePlaceId`, `findPlaceById`, `findPageByPlaceId`.

**Approach:**
- `findExistingPageByTitleOrAlias(scope, { type, title }): Promise<WikiPageRow | null>` wraps `findAliasMatches` (exact) → `findAliasMatchesFuzzy` at threshold `FUZZY_ALIAS_THRESHOLD=0.85`; same-type preference. Pure lookup, no upsert side effects. The existing `maybeMergeIntoExistingPage` refactors to use this helper internally (behavior-preserving).
- `resolvePlaceForRecord(record, ctx): Promise<{ place: WikiPlaceRow; pageIdsCreated: WikiPageRow[] } | null>`:
  1. `readPlaceMetadata(record)` → if null, return null.
  2. `findPlaceByGooglePlaceId(scope, googlePlaceId)` → if hit, return that place (no re-call to Google).
  3. If `ctx.googlePlacesClient` is null OR breaker tripped → `upsertPlace({ name, google_place_id, geo_lat, geo_lon, address, source: 'journal_metadata', parent_place_id: null, place_kind: 'poi' })`; skip hierarchy; skip auto-page-create for the POI (handled by the compiler's normal page write — no separate topic page); return result.
  4. Otherwise call `client.fetchPlaceDetails(googlePlaceId)`:
     - On null response (NOT_FOUND / breaker trip / total fail) → fall back to step 3.
     - On success: walk `addressComponents`:
       - Find `country` component; `findPlaceByGooglePlaceId(country.place_id_if_present)` OR fall back to name-based find via `findPlaceByTitleAndKind(name, 'country')`. If miss, `upsertPlace({ kind: 'country', source: 'derived_hierarchy', parent_place_id: null })`.
       - Find `administrative_area_level_1` iff country's `shortText ∈ {'US','CA'}`; repeat find-or-create with `kind: 'state'` and `parent_place_id = country.id`.
       - Find `locality` OR `postal_town` OR `sublocality_level_1` (first non-null); skip for city-states (Singapore, Monaco, Vatican) where no city-level component exists. `kind: 'city'`, `parent_place_id = state ?? country`.
       - Insert POI: `upsertPlace({ kind: 'poi', source: 'google_api', source_payload: verbatim response, parent_place_id = city ?? state ?? country })`.
     - For each newly-created `wiki_places` row (country, state, city, POI): auto-create backing `wiki_page`:
       - `findExistingPageByTitleOrAlias({ type: mapKindToType(kind), title })` → hit? `UPDATE wiki_pages SET place_id = COALESCE(place_id, <new>)`.
       - Miss → `upsertPage({ type, title, slug: slugifyTitle(title), summary: "Overview: " + (formattedAddress || `Location hub for ${name}`), place_id: new_place_id, aliases: [name] })` with one starter section.
  5. Log each `onConflictDoNothing` hit (including `upsertPlace` partial-unique-violation catch) with `console.warn({ event, scope, google_place_id })` per learnings.
- Slug normalization: use existing `slugifyTitle` from `packages/api/src/lib/wiki/aliases.ts`; if it uses `\b`, replace with `(?=[^\p{L}]|$)` as a drive-by Unicode fix. Add Bogotá / São Paulo / München fixtures to the test for that helper.
- First-seen-wins on page place_id is enforced by the `COALESCE(place_id, new)` in the UPDATE clause.
- `mapKindToType`: country/state/city → `topic`; poi → `entity`.

**Execution note:** Test-first for `resolvePlaceForRecord` — the matrix of API-available/unavailable/breaker-tripped/collision paths has ≥8 branches; write the happy path + degradation paths as failing tests first, then implement.

**Patterns to follow:**
- `packages/api/src/lib/wiki/repository.ts::findAliasMatches*` — exact/fuzzy helper pattern.
- `packages/api/src/lib/wiki/compiler.ts::maybeMergeIntoExistingPage` — merge mechanics (stay intact; just extract the lookup half).
- `packages/api/src/lib/wiki/compiler.ts::upsertPage` → `upsertSections` flow — how a brand-new page is seeded.

**Test scenarios:**
- Happy path (full Google): record with Paris POI → resolves 4 places (country=France, city=Paris, POI=<POI>) + 3 backing pages (no state for France). Each place's `parent_place_id` chains up. Pages auto-created with one starter section. Metrics incremented.
- Happy path (US POI with state): record with Austin, TX POI → 4 places (country=US, state=TX, city=Austin, POI), 4 pages, `parent_place_id` chains correctly.
- Happy path (city-state): Singapore POI → 2 places (country=Singapore, POI), no city tier, POI's `parent_place_id = country.id`.
- Happy path (UK postal_town fallback): London POI without `locality`, with `postal_town=London` → resolves city via postal_town. `administrative_area_level_1=England` NOT materialized (country=UK, not US/CA).
- Edge case (existing place): second record with same `place_google_place_id` → `findPlaceByGooglePlaceId` hit, no Google call, no dup upsert; returns existing row.
- Edge case (page exists for city): record that would create a city page "Paris" when a Paris entity page already exists → `findExistingPageByTitleOrAlias` hit by type≠`topic` but fuzzy-alias matches — per same-type-preference logic, create new topic page OR update existing entity (pick: create new topic; existing entity stays). Logged.
- Edge case (API unavailable / key missing): `ctx.googlePlacesClient` is null → POI place created with `source='journal_metadata'`, `parent_place_id=null`. No hierarchy pages. No backing topic pages.
- Edge case (API breaker tripped mid-batch): first record resolves fully via API; 5 consecutive failures trip breaker; 7th record uses metadata-only.
- Edge case (rotated place_id / NOT_FOUND): client returns null due to NOT_FOUND → treated as API-unavailable for this record; logged.
- Edge case (unexpected addressComponents shape): empty components array → POI-only place written, hierarchy skipped, no throw.
- Edge case (partial unique violation on upsert): two parallel compile runs try to insert the same Google place → second catches `UniqueViolation`, reads the row, proceeds. Logged with scope + place_id.
- Error path (Google 403 forbidden): client returns null; record falls back to metadata-only; compile continues.
- Unicode: Bogotá, São Paulo, München — slugs are stable and non-truncated; pages found via fuzzy alias on accented variant.
- Integration (compiler test): running a compile job with 3 records carrying different place_ids produces the expected `wiki_places` + `wiki_pages` rows in the correct hierarchy.

**Verification:**
- Unit tests pass, including the degradation matrix.
- `findExistingPageByTitleOrAlias` usage in `maybeMergeIntoExistingPage` preserves existing behavior (characterization-first — `wiki-compiler.test.ts` assertions unchanged).
- Manual dev compile on a small GiGi subset produces the expected place rows, observable via psql.

---

- [ ] **Unit 6: Integrate `places-service` into compile pipeline**

**Goal:** Wire `resolvePlaceForRecord` into `compiler.ts::applyPlan`. Each new page being written gets its `place_id` computed from the batch's records (first-seen-wins). Existing pages keep their `place_id` via COALESCE.

**Requirements:** R4, R8

**Dependencies:** Unit 5.

**Files:**
- Modify: `packages/api/src/lib/wiki/compiler.ts` — in `applyPlan` and `applyAggregationPlan`, before each `upsertPage` call, resolve the batch's place_id and pass it.
- Modify: `packages/api/src/lib/wiki/repository.ts::upsertPage` — accept optional `place_id` parameter; on UPDATE path, `place_id = COALESCE(place_id, :new_place_id)`.
- Modify: `packages/api/src/__tests__/wiki-compiler.test.ts` — add scenarios covering place-integrated compile.

**Approach:**
- Add a `resolveBatchPlace(records, ctx): Promise<{ placeId: string } | null>` helper: iterates records, calls `resolvePlaceForRecord` in order, returns the first non-null `place.id`. Later records in the same batch are ignored for place_id purposes (but each still triggers find-or-create for their own POI — only the page's `place_id` takes the first).
- Before each `upsertPage` invocation in `applyPlan` and `applyAggregationPlan`, call `resolveBatchPlace(sourceRecords)` for that page's record set; pass `place_id` to `upsertPage`.
- `upsertPage` signature gains `place_id?: string | null`. On UPDATE: `SET place_id = COALESCE(wiki_pages.place_id, EXCLUDED.place_id)`. On INSERT: `place_id = EXCLUDED.place_id`.
- Auto-created backing pages (from Unit 5) set `place_id` directly — no COALESCE needed (fresh insert).
- `resolveBatchPlace` does NOT call Google for pages that already have a non-null `place_id` — early-exits.
- Compile-job `ctx` gets the `googlePlacesClient` reference (injected at `runCompileJob` boundary from the Lambda handler's init path).

**Execution note:** Characterization-first. Run the current `wiki-compiler.test.ts` and record the expected `mockRepo.upsertPage.mock.calls` snapshot. After integrating, verify that fixtures with no place metadata produce byte-identical `upsertPage` calls (apart from the new `place_id: undefined` arg).

**Patterns to follow:**
- `packages/api/src/lib/wiki/compiler.ts:756, 1247, 1486` — existing `upsertPage` call sites. Wire the new parameter alongside the existing args.
- `packages/api/src/lib/wiki/compiler.ts::runCompileJob` ctx-building — where to inject `googlePlacesClient`.

**Test scenarios:**
- Happy path: compile a fixture with 1 new page + 2 source records, one carrying place metadata → page gets `place_id` set; auto-created hierarchy pages (country/city) exist.
- Edge case (no place metadata on records): pages compiled as today; `place_id` stays null; no API calls.
- Edge case (page already exists with place_id): re-compile with different records carrying different place_ids → first-seen-wins preserved via COALESCE; `place_id` unchanged.
- Edge case (Cruz-style scope, zero journal records): byte-identical to pre-Unit-6 output for all `upsertPage` calls; zero API calls.
- Edge case (two pages in batch with different place_ids): each page gets its own resolved place_id; pages can co-exist without conflict.
- Error path (breaker trips mid-job): remaining pages in the job get `place_id` from find-in-DB path only (no new API calls); compile completes cleanly.
- Integration: compile job → `wiki_pages.place_id` populated for pages with place-carrying records; `wiki_places` rows exist with correct hierarchy; metric `links_written_place` NOT yet incremented (Unit 7).
- Integration: existing compile-job fixture without place data → `links_written_deterministic` / `links_written_co_mention` unchanged (no regression).

**Verification:**
- `wiki-compiler.test.ts` passes including new scenarios.
- Existing fixtures without place metadata produce byte-identical `upsertPage` calls (modulo new `place_id` arg).
- Manual dev compile on a small GiGi subset produces `wiki_pages.place_id` populated rows.

---

- [ ] **Unit 7: `emitPlaceHierarchyLinks` + `links_written_place` metric**

**Goal:** Emit one reference edge per page to the backing page of its immediate place parent. Update metrics interface + initializer.

**Requirements:** R6

**Dependencies:** Units 5, 6.

**Files:**
- Modify: `packages/api/src/lib/wiki/deterministic-linker.ts` — add exported `emitPlaceHierarchyLinks({ scope, affectedPages, findPageByPlaceId, findPlaceById, writeLink, logger }): Promise<{ count: number }>`.
- Modify: `packages/api/src/lib/wiki/parent-expander.ts:20` — extend `ParentCandidateReason` union with `"place"` so existing type exhaustiveness checks pass wherever `deterministic:<reason>:...` context strings are switched on. (The expander itself does NOT produce `place` candidates — the union extension is for the linker's context-string writer only.)
- Modify: `packages/api/src/lib/wiki/compiler.ts` — call `emitPlaceHierarchyLinks` after `emitDeterministicParentLinks` in `applyPlan`. Add `links_written_place` to the metrics interface (lines 107-183) and to `emptyMetrics()` (line 1586). Increment from the return value.
- Modify: `packages/api/src/lib/wiki/repository.ts` — implement `findPageByPlaceId(scope, placeId): Promise<WikiPageRow | null>`, `findPlaceById(scope, placeId): Promise<WikiPlaceRow | null>`.
- Modify: `packages/api/src/__tests__/wiki-deterministic-linker.test.ts` — add scenarios for the new emitter.
- Modify: `packages/api/src/__tests__/wiki-compiler.test.ts` — integration scenarios.

**Approach:**
- `emitPlaceHierarchyLinks` iterates `affectedPages`:
  - Skip page if `page.place_id` is null.
  - `place = findPlaceById(scope, page.place_id)`; if `place.parent_place_id` is null, skip (top-of-hierarchy page).
  - `parentPage = findPageByPlaceId(scope, place.parent_place_id)`; if null, skip + log (the parent place lacks a backing page — shouldn't happen if Unit 5 auto-created, worth knowing).
  - `writeLink({ from: page.id, to: parentPage.id, kind: 'reference', context: \`deterministic:place:${place.parent_place_id}\` })` (via `upsertPageLink` with ON CONFLICT DO NOTHING).
  - On CONFLICT DO NOTHING hit, DO NOT increment the metric (it would double-count re-runs). Only increment when the write actually inserts.
- Does NOT go through `deriveParentCandidates` / `emitDeterministicParentLinks` — dedicated path. This avoids widening `LINKABLE_LEAF_TYPES` (which would affect every existing candidate) and keeps hierarchy-edge logic localized.
- `links_written_place` initializer = 0 in `emptyMetrics()`.
- Context string uses `wiki_places.id`, not `google_place_id`, because `manual` / `derived_hierarchy` places have no google_place_id.

**Execution note:** Ensure `upsertPageLink` returns a boolean indicating whether the insert actually happened (not just conflict), so the metric is accurate. If the current repository helper doesn't expose that, extend it (small additive change) rather than counting attempts.

**Patterns to follow:**
- `packages/api/src/lib/wiki/deterministic-linker.ts::emitDeterministicParentLinks` — public surface shape.
- `packages/api/src/lib/wiki/deterministic-linker.ts::emitCoMentionLinks` — pattern for a parallel emitter.

**Test scenarios:**
- Happy path (POI → city): affected page with `place_id = <POI>`, POI has `parent_place_id = <city>`, city-page exists → edge emitted; metric = 1.
- Happy path (chain): compile affected 3 pages — Paris POI, Paris city page, France country page. Emits 2 edges: POI→Paris, Paris→France. Metric = 2.
- Edge case (top-of-hierarchy page): country page with no parent → skipped cleanly.
- Edge case (missing parent backing page): POI's parent city has no backing page (Unit 5 was skipped or failed for it) → skipped + log; no throw.
- Edge case (already-written edge): re-run linker on the same affected page → `upsertPageLink` returns "conflict" → metric not incremented (no double-count).
- Edge case (page with NULL place_id): skipped cleanly.
- Error path (`findPlaceById` throws): emitter catches, logs, continues with other pages.
- Integration: compile a fixture where Unit 5 created country + city + POI pages → Phase 1's linker pass emits the 2 hierarchy edges; `metrics.links_written_place = 2`.
- Integration (Marco fixture, no journal records): emitter walks affected pages, finds none with place_id; metric = 0; `links_written_deterministic` unchanged (R12 floor).
- Integration (Cruz fixture): metric = 0; byte-identical linker behavior elsewhere.

**Verification:**
- `wiki-deterministic-linker.test.ts` passes with new scenarios.
- `wiki-compiler.test.ts` integration tests pass.
- Manual dev compile on a small GiGi subset: `wiki_page_links.context LIKE 'deterministic:place:%'` returns expected rows; spot-check 10 for correctness.
- No new deterministic false-positive patterns (R12) — sample 20 `deterministic:place:%` edges and verify the child-page's sources actually refer to the parent place.

---

### Phase 2 — Backfill + manual refresh (ships as PR B after PR A merge + terraform apply + one clean dev compile cycle)

- [ ] **Unit 8: Phase C backfill — populate `place_id` on existing pages + emit hierarchy edges**

**Goal:** For each active `wiki_page` without `place_id`, fetch source records, resolve a place, set `place_id`, and emit the hierarchy edge. Mechanism that realizes R13's lift on pages compiled before Unit 5 existed.

**Requirements:** R13, R14, backfill deliverable

**Dependencies:** PR A merged; manual migration applied; terraform apply rolled out; one clean dev compile cycle verified.

**Files:**
- Modify: `packages/api/src/lib/wiki/link-backfill.ts` — add `runPhaseCPlaceBackfill({ scope, pageLister, sourceRecordFetcher, placesService, linker, writeLink, logger, dryRun })`.
- Modify: `packages/api/scripts/wiki-link-backfill.ts` — add `--phase-c` flag (defaults on, `--no-phase-c` to opt out); wire live implementations.
- Modify: `packages/api/src/__tests__/wiki-link-backfill.test.ts` — Phase C scenarios.

**Approach:**
- For each `wiki_page` with `status='active'` in scope:
  1. If `place_id IS NOT NULL`, skip to step 4 (emit hierarchy edge).
  2. `records = sourceRecordFetcher(page.id)` — fetches `memory_units` via `wiki_section_sources`.
  3. Iterate: call `placesService.resolvePlaceForRecord(record)`; first non-null → `UPDATE wiki_pages SET place_id = COALESCE(place_id, $new) WHERE id = $page.id` (COALESCE re-check defends against concurrent writes).
  4. If `page.place_id IS NOT NULL`, invoke the same walk as `emitPlaceHierarchyLinks` (one-page version) — look up place, parent, parent-page, `writeLink`.
- Dry-run: `writeLink` is a logging no-op; place-service calls are REAL (they cache to `wiki_places` + auto-create backing pages). Alternative: dry-run short-circuits the place service too (safer). **Pick: full dry-run — short-circuits place service via `dryRun` ctx flag, no Google API calls, no DB writes. Reports expected counts only.**
- Idempotent: second run produces zero changes (place_id already set; hierarchy edge conflicts on `ON CONFLICT DO NOTHING`).
- Partial-unique-index collision: caught + logged + skipped per page, scope continues.
- Rate-limit awareness: Phase C shares the same circuit breaker as live compile. On trip, remaining pages fall back to metadata-only and NO hierarchy edges for those POIs (city/state/country are never created, so no parent to link to).
- Metrics output: JSON summary written to stdout: `{ pages_processed, pages_enriched, hierarchy_edges_written, collisions, breaker_tripped }`.

**Execution note:** Before wet-run on GiGi, run `wiki-places-drift-snapshot.ts --output pre.jsonl`. After wet-run, run the same script `--compare pre.jsonl`. R14 budget: ≤10% of affected pages with `aggregation` delta = pass.

**Patterns to follow:**
- `packages/api/src/lib/wiki/link-backfill.ts::runLinkBackfill` Phase A/B — orchestration shape.
- `packages/api/scripts/wiki-link-backfill.ts` — CLI argument parsing, dry-run, dotenv.

**Test scenarios:**
- Happy path: scope with 10 active pages, 6 with place-carrying sources → Phase C enriches 6; hierarchy edges written; re-run is no-op.
- Happy path (enriched page): page already has `place_id` from live compile → Phase C skips enrichment, emits hierarchy edge (if missing).
- Edge case (page with no sources): page has zero `wiki_section_sources` rows → skipped cleanly.
- Edge case (Cruz-style scope, 0% place coverage): Phase C runs, enriches 0 pages, writes 0 edges, no errors.
- Edge case (collision): two pages would claim the same `google_place_id` → second UPDATE fails partial-unique, caught + logged + skipped.
- Edge case (breaker trip during Phase C): first 20 pages enrich fully; breaker trips; next 100 pages fall back to metadata-only (no hierarchy); backfill completes.
- Dry-run: same scope in dry-run mode → zero DB writes, zero Google calls, logs match wet-run count expectations.
- Integration: seeded fixture modeling a GiGi-subset → Phase C enriches N pages matching the audit (Unit 1) projection.

**Verification:**
- Unit tests pass.
- Dry-run against dev GiGi: output matches Unit 1's audit projection ±5%.
- Wet-run against dev GiGi: `links_written_place` post-backfill matches dry-run projection.
- **R13**: GiGi entity linked% measured pre + post → delta ≥ Unit 1's R13 target. Recorded in PR B description.
- **R14**: drift-snapshot diff post-backfill → ≤10% of affected pages show aggregation delta.
- **R12**: Marco wet-run shows linked% ≥ 67.8% (expected ~67.8% baseline, with small positive lift from the 30.9% Marco place coverage).
- Post-run `psql`: sample 20 `wiki_page_links.context LIKE 'deterministic:place:%'` rows + verify child→parent place relationship.

---

- [ ] **Unit 9: `wiki-places-refresh.ts` manual refresh script**

**Goal:** Ship the operator escape-hatch to re-fetch Google data for a place (or scope, or stale-before date). Never auto-runs; only triggered by hand.

**Requirements:** R9

**Dependencies:** Units 4, 5.

**Files:**
- Create: `packages/api/scripts/wiki-places-refresh.ts`
- Create: `packages/api/src/__tests__/wiki-places-refresh.test.ts`

**Approach:**
- Flags: `--place-id <uuid>` (single row), `--tenant <uuid> --owner <uuid>` (scope-wide), `--stale-before <ISO>` (filter by `source_payload_fetched_at < X` — see note below). Exactly one of `place-id` / `scope` must be provided; `stale-before` composable with scope. Default `--dry-run` OFF; `--apply` required to actually write.
- For each candidate place where `source IN ('google_api','derived_hierarchy')`:
  - Call `client.fetchPlaceDetails(google_place_id)`.
  - On success: UPDATE `wiki_places SET source_payload = <new>, name = <new.displayName>, geo_lat = ..., geo_lon = ..., address = <new.formattedAddress>, updated_at = now() WHERE id = <id>`. Hierarchy parents NOT re-walked — a refresh updates this row's direct data only. If the user wants a hierarchy re-walk, they can null the place and re-compile.
  - On `NOT_FOUND`: log, flag the row (add a `last_refresh_error` log line; no schema change to capture it in v1).
  - On breaker trip: abort the batch, log remaining pending.
- Skip all rows where `source IN ('manual','journal_metadata')` — respects user-edited data and metadata-only fallback state (these have no Google payload to refresh).
- Note: the brainstorm's schema doesn't include a `source_payload_fetched_at` column. For `--stale-before`, use `updated_at` as the proxy (set every time a place row is touched). Sufficient for v1 ops use-cases; a dedicated `fetched_at` column is a trivial follow-up if the proxy proves too coarse.

**Patterns to follow:**
- `packages/api/scripts/wiki-link-backfill.ts` — CLI arg parsing, dotenv, exit codes.
- Unit 4's `google-places-client.ts` — injected, mocked in tests.

**Test scenarios:**
- Happy path: `--place-id <uuid> --apply` → single UPDATE, logged outcome.
- Happy path: `--tenant --owner --stale-before 2026-01-01 --apply` → iterates matching places, UPDATEs all.
- Edge case: `source='manual'` row in scope → skipped with log line; not re-fetched.
- Edge case: `source='journal_metadata'` row → skipped (no google_place_id to fetch against, or explicit skip).
- Edge case: `NOT_FOUND` response → row unchanged; `last_refresh_error` logged.
- Edge case: breaker trips mid-batch → remaining pending reported; exit code nonzero.
- Dry-run: same scope without `--apply` → zero writes, log matches expected UPDATEs.
- Error path: missing flags → usage printed, exit nonzero.

**Verification:**
- Unit tests pass.
- Manual sanity: `wiki-places-refresh.ts --place-id <dev-uuid> --apply` on a dev row updates `source_payload` without side effects elsewhere.

## System-Wide Impact

- **Interaction graph:** compile pipeline (leaf planner → parent expander → deterministic linker → applier → metrics) gains a new pre-write step (`resolveBatchPlace`) and a new post-write step (`emitPlaceHierarchyLinks`). `computeLinkNeighborhoods` inbound counts shift upward on pages that gain hierarchy edges, feeding the aggregation planner's prompt — R14 drift budget. A new Lambda cold-start SSM read is added. No new queue, no new observers.
- **Error propagation:** Google API failures → null response → metadata-only place row; never raise. Partial unique violations at `upsertPlace` → caught, log, read existing row. Hindsight fetch failures in Phase C → log, skip page, continue. Lambda init SSM failure → log, proceed without API key (all records → metadata-only). `parseFloat` NaN on lat/lon → skip field, not whole record.
- **State lifecycle risks:** Partial unique index is one-way — once scope has `google_place_id='X'`, no other row can claim it until first is merged/nulled. No data loss. Two places that SHOULD be one stay as two until a follow-up dedup. `source_payload` is frozen after first write (D7), raising a ToS risk that's documented but accepted.
- **API surface parity:** GraphQL `WikiPage` resolver unchanged in v1. Mobile + admin clients keep their current shape. The new `place_id` column is opaque to them until a follow-up ships.
- **Integration coverage:** compile + backfill + linker + Google client must be exercised end-to-end. Unit tests alone cannot prove: (a) Hindsight `metadata.raw` path works against a live adapter, (b) hierarchy walk on a real `addressComponents` response produces the right 3-level chain, (c) partial-unique collision is caught not thrown. Integration tests in `wiki-compiler.test.ts` for (a) and (c); a one-time manual wet-run on dev GiGi for (b).
- **Unchanged invariants:** `WikiPageType` enum, `parent-expander.ts::extractCityFromSummary` (stays as fallback), `maybeMergeIntoExistingPage` behavior (refactored to call the extracted helper but behaviorally equivalent), `wiki_compile_jobs.metrics` jsonb schemaless-ness, `wiki_page_links` unique constraint, Phase A + Phase B backfill behavior, tenant/owner scope isolation, `LINKABLE_LEAF_TYPES` set.

## Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google Places ToS violation (addressComponents cached indefinitely in `source_payload`) | Medium | Medium (no enforcement at small volume but is a deliberate ToS breach) | **Accepted by user at planning time.** Documented explicitly. Enforcement rare at compile volumes (5k+ calls/mo free, this plan stays well under). If enforcement surfaces, migrate to derive-and-discard as a follow-up — schema is forward-compatible (set `source_payload = NULL` across the board). |
| Aggregation planner output drifts on pages whose inbound-edge counts change | High | Medium | R14 drift budget (≤10% unexpected section-promotion deltas); pre/post snapshot via `wiki-places-drift-snapshot.ts` gates PR B merge; rollback = revert `emitPlaceHierarchyLinks` call in `applyPlan` without schema changes. |
| SSM cold-start fetch adds latency to wiki-compile Lambda | Low | Low | One-time per cold start (~20-50ms); module-scope cache handles warm invocations. If measurable, migrate to Parameters-and-Secrets Lambda Extension (additive). |
| Auto-created backing `wiki_page` for a city collides with an existing unrelated entity page of the same name (e.g., "Paris" entity page already exists for unrelated POI) | Medium | Low | `findExistingPageByTitleOrAlias` respects type; city is `topic`, not `entity`. Collisions within `topic` are handled by fuzzy-alias preference. Logged at place-service boundary for post-hoc audit. |
| Breaker state is in-process, Lambda may cold-start mid-batch | Low | Low | Breaker resets on invocation boundary per design (R11). A cold start mid-job means the breaker was never tripped on that instance; up to 5 more failures allowed. Acceptable — breaker is a protection against runaway, not an SLA. |
| Partial unique index creation fails on duplicate rows (day 1: impossible because table is new) | Very Low | High if triggered | Pre-migration audit query in Unit 2 + audit re-runs before any future load paths that populate the column. |
| Hindsight metadata format changes (nested objects become allowed) | Low | Medium | `readPlaceMetadata.ts` encapsulates the read path; a schema change would touch that one helper. |
| Phase C shows < R13 lift target on GiGi | Low | High (plan success criterion) | Indicates an upstream miss — backing parent pages not created, or linker walk not matching. Institutional learning: probe every stage before tuning. Unit 1's audit gives the projected number; a miss > 20% below projection triggers investigation, not threshold tuning. |
| Parent-expander `metadata.raw` bug fix lands in parallel and changes the R12 baseline | Low | Medium | Explicitly scoped to a separate PR; this plan's PR A description will request the reviewer to not bundle that fix. Deferred in Scope Boundaries. |
| Terraform 5-layer plumbing introduces a typo; env var missing at runtime | Medium | Low | Lambda init's "Google Places key not available" log line surfaces this immediately; compile continues in metadata-only mode — visible in metrics. Post-deploy smoke check: verify log line states key-loaded. |
| Nested-POI collision (same location, different place_ids) | Unknown | Low | Log `google_place_id` + lat/lon in `source_payload`; count frequency during Phase C; if >5% of pages affected, scope a proximity-merge follow-up. |

## Documentation / Operational Notes

- **Manual migration apply.** `0017_wiki_places.sql` applies via psql against the stage DB after PR A merges. Command: `psql "$DATABASE_URL" -f packages/database-pg/drizzle/0017_wiki_places.sql`. Verify with `\d wiki_places`. Document in PR A body.
- **Terraform apply for API key plumbing.** Unit 4's terraform changes deploy on next `main` push via `.github/workflows/deploy.yml`'s `terraform-apply`. The wiki-compile Lambda's env var + SSM parameter materialize post-deploy.
- **Rollout sequence.**
  1. PR A merges → `main` deploy → terraform applies SSM + env var → manual migration apply → verify Lambda logs "Google Places client initialized"
  2. One dev compile cycle on a small GiGi subset (1-5 pages) → verify no errors, sample `wiki_places` rows in psql
  3. Run `wiki-places-audit.ts` → record R13 target in PR B description
  4. Run `wiki-places-drift-snapshot.ts --output /tmp/gigi-pre.jsonl`
  5. PR B merges → wet-run Phase C backfill on GiGi → measure linked% → R13 check
  6. Run `wiki-places-drift-snapshot.ts --compare /tmp/gigi-pre.jsonl` → R14 check
  7. If both pass, backfill Marco (expect small positive lift, confirms R12 floor)
- **Observability.** `links_written_place` metric on `wiki_compile_jobs.metrics`. `wiki_page_links.context LIKE 'deterministic:place:%'` for retroactive count. CloudWatch log scan for `google_places.*error` and `google_places.breaker_tripped` weekly for the first month.
- **ToS posture.** Documented in Risks. If enforcement surfaces, follow-up PR nulls all `source_payload` rows and switches to derive-and-discard. Forward-compatible today (no code path depends on long-term retention of `source_payload`).
- **Commit messages (suggested).**
  - PR A:
    - Unit 1: `feat(wiki): places audit + drift-snapshot scripts`
    - Unit 2: `feat(wiki): wiki_places table + wiki_pages.place_id FK`
    - Unit 3: `feat(wiki): readPlaceMetadata helper for Hindsight raw dict`
    - Unit 4: `feat(wiki): Google Places client + SSM key plumbing`
    - Unit 5: `feat(wiki): places-service + extracted page-lookup helper`
    - Unit 6: `feat(wiki): integrate places-service into compile pipeline`
    - Unit 7: `feat(wiki): emitPlaceHierarchyLinks + links_written_place metric`
  - PR B:
    - Unit 8: `feat(wiki): Phase C place backfill`
    - Unit 9: `feat(wiki): wiki-places-refresh script`

## Sources & References

- **Origin document:** `docs/brainstorms/2026-04-21-wiki-place-capability-requirements.md`
- **Superseded plan (do not execute):** `docs/plans/2026-04-21-004-feat-wiki-place-capability-plan.md`
- **Related shipped PRs:** #311 (Toronto/Toronto Life gate), #320 (fuzzy-alias merging), #328 (TRUSTED_REASONS removal), #329 (schema drops: body_embedding, cluster)
- **Related plans:**
  - `docs/plans/2026-04-20-012-refactor-wiki-pipeline-simplification-plan.md` — schema cleanup this plan builds on
  - `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` — "no new page types" invariant
- **Code references:**
  - `packages/database-pg/drizzle/0007_unique_external_task_id.sql` — partial unique + Drizzle DSL precedent
  - `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — recent migration style
  - `packages/api/src/lib/wiki/compiler.ts` (seams at 223, 506, 660, 742, 805, 1215, 1352, 1455, 1512, 1728, 1824)
  - `packages/api/src/lib/wiki/parent-expander.ts` (ParentCandidateReason at 20, candidate shape at 30-57, buggy read at 104)
  - `packages/api/src/lib/wiki/deterministic-linker.ts` (LINKABLE_LEAF_TYPES at 22, context assembly at 387)
  - `packages/api/src/lib/wiki/journal-import.ts:298-340` — place metadata keys
  - `packages/api/src/lib/memory/adapters/hindsight-adapter.ts:406-420` — metadata.raw nesting
  - `packages/api/src/lib/wiki/link-backfill.ts` (runLinkBackfill pattern)
  - `terraform/modules/app/lambda-api/handlers.tf:14-55, 60-79, 122, 463-475`
- **External docs:**
  - https://developers.google.com/maps/documentation/places/web-service/place-details
  - https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
  - https://developers.google.com/maps/documentation/places/web-service/policies
  - https://aws.amazon.com/blogs/compute/choosing-the-right-solution-for-aws-lambda-external-parameters/
- **Institutional learnings:**
  - `docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md`
  - `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md`
  - `docs/solutions/best-practices/js-word-boundary-is-ascii-only-2026-04-20.md`
- **Baseline measurements (this session, 2026-04-21):**
  - GiGi: 48.6% → 49.7% from full backfill; 85.9% `place_google_place_id` coverage across full corpus (R13 requires unlinked-tail measurement)
  - Marco: 67.8%, at ceiling; 30.9% coverage
  - Cruz: 100% linked; 0% coverage (unaffected by this plan)
