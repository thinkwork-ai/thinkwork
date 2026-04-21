---
title: "Wiki Place capability — first-class places with hierarchy"
status: open
date: 2026-04-21
rewritten_on: 2026-04-21
rewritten_reason: "Previous version (columns-on-wiki_pages + record-metadata-only) produced self-edges not parent links (ADV-02 from plan review). Redesigned around a dedicated wiki_places table and Google Places API enrichment for hierarchy capture."
---

# Wiki Place capability — first-class places with hierarchy

## Problem

The wiki compile pipeline today has no first-class notion of a location. `parent-expander.ts` runs a regex over `place_address` strings to extract city names, then matches by title against other pages. That path works but is fragile:

- Country tokens get misclassified as cities (12 `deterministic:city:france` links proposed in GiGi's backfill run on 2026-04-21)
- Geo-suffix collisions required a special gate (`"Toronto" ≈ "Toronto Life"`, see PR #311)
- Structured place data already present in `memory_units.metadata` (Google `place_id`, lat/lon, full address) is discarded
- Map views, proximity search, and spatial features are impossible — no page carries coordinates
- The earlier attempt at place_id-based linking (see superseded plan `docs/plans/2026-04-21-004-feat-wiki-place-capability-plan.md`) had a fundamental design flaw: a record's `place_google_place_id` is the POI's own id, not a parent city's id, so it couldn't drive parent-linking

Concretely on GiGi this session: 48.6% → 49.7% entity linked% from running all existing backfill paths. ~50% of GiGi's 1,054 entity pages remain unlinked because the current algorithms can't extract a reliable parent from the unlinked tail.

The Google Places API key is now available (in `terraform/examples/greenfield/terraform.tfvars` as `google_places_api_key`, not yet plumbed to any Lambda). This unlocks a structural hierarchy approach: look up each POI's place hierarchy (city, state, country) via the API, materialize that hierarchy as first-class `wiki_places` rows, and link wiki pages to places via a proper foreign key.

## Goal

Make `Place` a first-class concept in the wiki domain. Every location — whether sourced from Google Places, from journal-import metadata, or created manually — becomes a row in a dedicated `wiki_places` table with canonical identity (id, name, coords, address, hierarchy). Wiki pages reference places via a nullable FK. The deterministic linker uses the hierarchy to emit high-confidence parent edges (POI page → city page; city page → state/country page where applicable) that don't rely on string-regex extraction.

## Architecture

### New table: `wiki_places`

Canonical location records. Scoped per `(tenant_id, owner_id)` like the rest of the wiki domain.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | our identifier — FK target for everything else |
| `tenant_id` | uuid NOT NULL | scope isolation |
| `owner_id` | uuid NOT NULL | scope isolation |
| `name` | text NOT NULL | display name |
| `google_place_id` | text NULLABLE | when known; unique per scope |
| `geo_lat`, `geo_lon` | numeric(9,6) | canonical coordinates |
| `address` | text | full address string when known |
| `parent_place_id` | uuid FK `wiki_places(id)` | hierarchy (self-ref); nullable at root |
| `place_kind` | text | `country` / `region` / `city` / `neighborhood` / `poi` / `custom` / null |
| `source` | text NOT NULL | `google_api` / `journal_metadata` / `manual` / `derived_hierarchy` |
| `source_payload` | jsonb | raw Google API response cache (when source=google_api), or user-provided data (manual) |
| `created_at`, `updated_at` | timestamptz | |

Constraints:
- Partial unique: `(tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL` — prevents duplicate Google-sourced places in a scope
- `parent_place_id` FK with `ON DELETE SET NULL` (losing a parent shouldn't cascade-nuke descendants)

### New column: `wiki_pages.place_id`

Nullable FK → `wiki_places(id)`. Zero or one place per page. Index on `place_id` for reverse lookup (page for a place).

### Relationship summary

- A `wiki_places` row is a pure location identity — name, coords, address, source-of-truth for "this place in the real world."
- A `wiki_page` is a semantic entity — title, sections, body, links.
- A page optionally references a place. Restaurant entity pages point to the restaurant's place. City topic pages point to the city's place. Non-located pages (people, decisions, abstract concepts) have `place_id = NULL`.
- Places may have a backing page (auto-created for hierarchy tiers; see below) or may not (if nothing ever cites them).

## Key decisions

### D1 — Google Places is nice-to-have, not required

A place is creatable without Google:
- **`source = 'google_api'`**: looked up via Google Places API, hierarchy captured, `source_payload` caches the raw response.
- **`source = 'journal_metadata'`**: compile found place data in record metadata but Google API was unavailable/rate-limited/key-missing. Minimal row with what we have (name, lat/lon, address, maybe google_place_id). No hierarchy.
- **`source = 'manual'`**: user or operator created it via script/admin (e.g., "Our Cabin in Vermont" — not in Google's index). Lat/lon and name required; hierarchy can be set explicitly by setting `parent_place_id`.
- **`source = 'derived_hierarchy'`**: created as a parent chain member when walking Google's `address_components` (e.g., "Paris" is created when any Parisian POI is enriched).

Compile never fails because Google is unavailable. Graceful degradation to metadata-only.

### D2 — Creation is lazy at compile time

When the compiler encounters a record with `place_google_place_id` it hasn't seen in scope:
- Already have a `wiki_places` row? → reuse, link `wiki_pages.place_id`.
- Don't have one? → call Google Places API if key is available; walk `address_components` to find-or-create parent chain; cache raw response in `source_payload`.
- Google unavailable/failed/disabled? → create minimal `wiki_places` row from record metadata (no hierarchy); mark `source='journal_metadata'`.

No separate enrichment lambda, no ingest-time change. Single pipeline stage, consistent with existing compile semantics.

### D3 — Hierarchy tiers: city, state, country (state US/CA only)

Walk Google's `address_components`, extract three tiers:
- Always: `locality` → **city**, and `country` → **country**
- Conditionally: `administrative_area_level_1` → **state**, but only when `country_code ∈ {US, CA}`. Europe and most other countries don't have a clean state equivalent; forcing one creates noise.

Edge cases:
- City-states (Singapore, Monaco) — no city component, the POI's parent is country directly
- Records about countries themselves (e.g., `place_kind='country'`, no POI) — `parent_place_id = NULL`
- Google returns unexpected shape — log, skip hierarchy, create POI place only; never fail compile

Raw `address_components` is preserved in `source_payload`, so if we later decide to materialize more tiers (neighborhood, administrative_area_level_2), no re-call is needed.

### D4 — Auto-create backing wiki_page for every hierarchy place

When a `wiki_places` row is created (POI or any hierarchy tier), also find-or-create a backing `wiki_page`:
- Dedup first: check for existing `wiki_page` matching by slug or fuzzy-alias (reuse `maybeMergeIntoExistingPage` machinery from PR #288). If found, just set its `place_id` FK.
- Else create: `type='topic'` for city/state/country; `type='entity'` for POI. `title` from Google's localized `long_name` when available, else record metadata name. `slug = slugifyTitle(title)`. One starter "Overview" section.
- Starter section body: Google's `formatted_address` + types-derived description when available, else static template `"Location hub for {name}"`.

Rationale: determinism over LLM-planner judgment. Every place has a backing page by rule, not by the planner's fuzzy "does Paris deserve a page" call. Empty-shell concern is manageable because aggregation pass enriches hub pages as records cite them.

### D5 — Linker edge depth: immediate parent only

Each page emits one parent-reference edge to its immediate parent in the hierarchy:
- POI page → city page
- City page → state page (where state exists)
- State page → country page

No redundant POI→state or POI→country direct edges. Hierarchy is traversable via `wiki_places.parent_place_id` chain OR via 2-3 hops in the link graph. Keeps `computeLinkNeighborhoods` counts clean and avoids inflating aggregation-planner drift.

Link context: `deterministic:place:<parent place's google_place_id or wiki_places.id>`. New metric: `links_written_place`.

Existing city-regex deterministic linker path coexists — records without `place_google_place_id` (freeform notes, non-journal sources) still use it. No deprecation.

### D6 — First-seen-wins conflict resolution

When a page's source records carry different `place_google_place_id` values (Google rotated ids, user revisited with different app version, etc.), the first non-null one persists. `COALESCE(existing_place_id, new_place_id)` semantics. No `place_metadata_source_date` column, no ordering, no date-tracking.

Matches the cross-page unique-index behavior (also first-seen-wins). Google place_id rotation is treated as Google noise, not user-asserted identity correction — explicit re-identification is an operator/admin action.

### D7 — Cache: frozen after first Google call

A `wiki_places` row with `source='google_api'` never re-calls Google automatically. `source_payload` is the frozen snapshot from first lookup.

Ops can force-refresh via `packages/api/scripts/wiki-places-refresh.ts` (to be added), accepting `--place-id`, `--scope`, or `--stale-before` arguments. Mirrors the existing `wiki-link-backfill.ts` pattern.

If refresh behavior proves insufficient, a TTL policy is a trivial additive change later. Starting strict minimizes API cost and keeps the system predictable.

## Requirements

### Schema & compile-time population

- **R1** `wiki_places` table exists with the shape described in Architecture. `source` enum-like text is the single source-of-provenance signal.
- **R2** `wiki_pages.place_id` nullable FK to `wiki_places.id` with ON DELETE SET NULL. Index present.
- **R3** Partial unique index on `(tenant_id, owner_id, google_place_id) WHERE google_place_id IS NOT NULL`. Prevents duplicate Google places in a scope.
- **R4** During compile, records with `place_google_place_id` in their metadata trigger find-or-create of `wiki_places` rows (POI + city + country always; state only when `country_code ∈ {US, CA}`). Google Places API is called when the key is available and the POI's id hasn't been seen. When the API call fails (timeout, rate limit, 5xx), falls back to metadata-only row creation; never fails compile.
- **R5** Each newly-created `wiki_places` row triggers find-or-create of a backing `wiki_page`. Find step checks existing pages by slug and fuzzy-alias. Create step uses Google's localized data when available, static template when not.

### Linking

- **R6** Deterministic linker walks `wiki_places.parent_place_id` for each affected page and emits a single reference edge to the backing page of the immediate parent. Edge context: `deterministic:place:<parent id>`. Metric: `links_written_place`.
- **R7** Existing city-regex deterministic path coexists for records without `place_google_place_id`. No deprecation, no behavior change on that path.

### Conflict resolution & cache

- **R8** `wiki_pages.place_id` population is first-seen-wins (`COALESCE(existing, new)`). Same for `wiki_places.google_place_id` de-facto via the partial unique index.
- **R9** Google API responses are cached in `source_payload`. No automatic re-call. Manual refresh script (`packages/api/scripts/wiki-places-refresh.ts`) for ops-triggered refresh.

### Operational

- **R10** Google Places API key plumbs from `terraform/examples/greenfield/terraform.tfvars` → Lambda env var or SSM param. Planning decides which (SSM is the hygiene-correct answer per `project_tfvars_secrets_hygiene.md`; env var is simpler for first iteration).
- **R11** API rate-limit / circuit-breaker behavior: compile tracks API calls per run; on N consecutive failures or quota-exceeded response, flip the remainder of the run to metadata-only. Reset on next compile invocation.

### Quality gates & success

- **R12** No regression on current link-quality: Marco's entity-linked% stays at or above its current 67.8%. No new deterministic false-positive patterns (no analog of the `"Toronto" ≈ "Toronto Life"` class).
- **R13** GiGi entity-linked% lift target: measured at planning time. The audit that determines the target: "For currently-unlinked GiGi entity pages, what fraction of their source records carry `place_google_place_id`?" That fraction × unlinked-page count = addressable ceiling. Planning commits a specific absolute-percentage-point target after running the audit. No speculative target in this brainstorm.
- **R14** Aggregation-planner drift budget: `≤ 10%` of pages whose `computeLinkNeighborhoods` inbound counts change see an unexpected section-promotion delta on post-deploy diff. Exact measurement mechanism (snapshot pre, diff post) specified at planning time with a named script.

## Non-goals (v1)

- **No new `WikiPageType`.** `type` stays `entity | topic | decision`. Place is a first-class table, not a new page shape.
- **No PostGIS, no `earthdistance` extension.** Proximity math deferred to future consumer. `numeric(9,6)` lat/lon + bounding-box filters handle map views.
- **No GraphQL exposure of geo fields** on `WikiPage` in v1. Lands with the first real consumer (map view, proximity resolver, debug surface).
- **No map rendering UI.** Enabled by this plan; built separately.
- **No Google Places Autocomplete at read-time.** Compile-time lookups only.
- **No automatic cache refresh / TTL.** Manual refresh script only.
- **No cross-tenant place sharing.** Each tenant/owner gets its own place rows even for identical Google place_ids.
- **No hierarchy deeper than country.** Neighborhoods, sub-locality, administrative_area_level_2+ ignored.

## Open questions (resolve during planning)

- **Backfill strategy for existing scopes.** GiGi's 1,054 pages and Marco's 227 pages were compiled before `wiki_places` existed. A Phase-C-like extension to `wiki-link-backfill.ts` can walk active pages, read source records, find-or-create places, link via `wiki_pages.place_id`, then emit the hierarchy edges. Confirm the script mechanics at planning.
- **Google Places API quota sizing.** Rough estimate: GiGi has ~3,121 memory_units, probably 500–800 unique place_ids. First-compile API cost ~$9–14 (one-time, frozen). Worth confirming Google Places Details pricing and quota bounds before wet-run.
- **Backfill link-emission sequencing.** After backfill populates `wiki_pages.place_id`, does the linker need to run over the affected pages, or do we trigger a full scope recompile? Planning picks based on cost.
- **`source_payload` schema contract.** We're storing raw Google API responses. Schema of that response can change between API versions; planning should decide whether to validate, normalize, or just store verbatim.
- **Terraform: env var vs. SSM param** for the API key. SSM is hygiene-correct; env var is simpler. Planning picks based on how the Lambda's IAM is already scoped.
- **Drift-budget measurement tooling.** R14 references a measurement script; its exact shape (pre-snapshot query, post-diff, thresholds) is a planning-time detail.
- **Rate-limit circuit-breaker constants.** "N consecutive failures" and "reset on next invocation" need specific values.
- **Place refresh policy for manually-edited rows.** If a user edits a `source='manual'` place's name/coords, should that be preserved across future compiles? Probably yes, but the rule deserves explicit statement.
- **What happens when the Google API returns a place_id different from the one the record carried?** (Rare: user's app version vs. current Google data.) Probably: trust the API response, record both ids in `source_payload`. Worth confirming.

## Sequencing and dependencies

- **Depends on nothing new.** Simplification work (plans #328, #329) merged 2026-04-21; the surface is clean.
- **Unblocked by**: current `wiki_page_links` dedup + `maybeMergeIntoExistingPage` patterns (#288, #320) which the auto-create logic reuses.
- **Enables**: map rendering in mobile/admin (mobile team has a map brainstorm pending); proximity-search resolver; geo-aware aggregation planner prompts; Google Places enrichment at read-time (future, optional).
- **Does not depend on**: user-scoped memory refactor (per saved memory `project_memory_scope_refactor.md`, memory/wiki MCP work is paused pending that refactor; this Place work operates within the existing per-owner model and is not blocked).

## Sources & evidence

- `packages/api/src/lib/wiki/journal-import.ts:64-74, 181-192, 311-324` — structured geodata ingest from `journal.place` into Hindsight metadata. Confirmed this session: 100% of `journal.idea` rows have place_id (6853/6853); 100% of `journal.place` rows have google_place_id AND geo_lat (6802/6802, unique per constraint).
- `packages/api/src/lib/memory/adapters/hindsight-adapter.ts` — adapter that surfaces memory_units; feasibility review on the superseded plan flagged a possible metadata-shape mismatch (`raw.*` vs top-level); planning should verify the actual key path at implementation time.
- `packages/api/src/lib/wiki/parent-expander.ts:318-358` — existing regex city extractor; stays as fallback for records without `place_google_place_id`.
- `packages/api/src/lib/wiki/deterministic-linker.ts` — linker where the new place-hierarchy path integrates. After PR #328, the `TRUSTED_REASONS` gate is gone; all candidate reasons are processed uniformly.
- `packages/api/src/lib/wiki/compiler.ts::computeLinkNeighborhoods` — feeds the aggregation planner's prompt; inbound counts will shift on geo-rich pages (R14 drift budget).
- `packages/database-pg/src/schema/wiki.ts` — target for schema additions (`wiki_places` table, `wiki_pages.place_id` column).
- `packages/database-pg/drizzle/0016_wiki_schema_drops.sql` — most recent migration precedent. The deploy workflow does NOT auto-run migrations (observed and applied manually for 0016); planning must document the same manual-apply step or wire up `drizzle-kit migrate` in CI first.
- `terraform/examples/greenfield/terraform.tfvars` — `google_places_api_key` is present here as plaintext. Planning must plumb it to the compile Lambda (env var or SSM) and respect the existing `project_tfvars_secrets_hygiene.md` preference for SSM when prod lands.
- **Coverage audit** (this session, 2026-04-21): `place_google_place_id` present in metadata for 85.9% of GiGi's memory_units, 30.9% of Marco's, 0% of Cruz's. This figure is over the full corpus; R13 requires measuring the unlinked-tail specifically at planning time.
- **Superseded plan** (do not use, preserved for context): `docs/plans/2026-04-21-004-feat-wiki-place-capability-plan.md` — design that used record metadata as parent-identification (broken) and required backfill to realize any lift (deferred). This brainstorm's redesign is architecturally sound because the hierarchy is materialized in `wiki_places` rather than inferred from record metadata.
- **Backfill validation on existing emitters** (this session, 2026-04-21): Marco at its ceiling (389 → 389 edges, 67.8% unchanged); GiGi near ceiling (+12 edges, 48.6% → 49.7%); Cruz at 100% linked. Current algorithms cannot close the remaining gap without new signal — place-hierarchy is that signal.

## Handoff to planning

This document is ready for `/ce:plan`. The planning session should:

1. Run the addressable-denominator audit (R13) as its first unit — queries Hindsight for `place_google_place_id` coverage on the memory_units backing currently-unlinked GiGi entity pages. The result sets R13's lift target.
2. Structure implementation as a small number of units (schema, lazy-at-compile logic, linker integration, auto-page-creation, backfill script).
3. Address the open questions explicitly, not as handwave deferrals.
4. Commit to a specific drift-budget measurement script before merging (R14).
5. Honor the "manual migration apply" operational reality or wire up CI migrations first.
