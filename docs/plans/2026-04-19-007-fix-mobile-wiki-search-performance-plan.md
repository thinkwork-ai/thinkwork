---
title: "fix: Mobile Wiki search performance — swap Hindsight recall for Postgres FTS"
type: fix
status: active
date: 2026-04-19
---

# fix: Mobile Wiki search performance — swap Hindsight recall for Postgres FTS

## Overview

The Mobile → Wiki tab is painfully slow. A search for a simple keyword like "Austin" takes ~10 seconds to return over a corpus of ~100 pages. Root cause: `mobileWikiSearch` routes every query through Hindsight's semantic recall (BM25 + vector + rerank across raw memory units), then reverse-joins back to compiled `wiki_pages` rows. The heavy, cross-memory semantic lift is wasted when users are actually searching compiled page titles/summaries ("Austin", "Dake's Shoppe").

The fix is to replace the mobile search implementation with a direct Postgres full-text query against `wiki_pages.search_tsv` (a GIN-indexed generated column already in the schema), mirroring the admin `wikiSearch` resolver. On ~100 rows this is <50ms. We also polish the mobile loading UX so the modal "Searching…" overlay only appears while an actual search is in flight, and confirm pull-to-refresh on an empty input cleanly returns the recent-pages path.

## Problem Frame

**User-observed symptoms (Marco test agent, 2026-04-19):**

1. Entering the Wiki tab shows a spinner / feels sluggish.
2. Typing "Austin" and submitting returns results after ~10 seconds.
3. Pull-to-refresh on an empty search input should just reload the latest wiki pages by updated date — user isn't confident that's what's happening.

**Technical diagnosis (from repo research):**

- `mobileWikiSearch` calls `recall.recall({ tenantId, ownerId, query, limit: 100–200 })` — an HTTP round-trip to the Hindsight recall endpoint that performs BM25 + vector search + reranking across the entire memory bank, with a 15s client timeout. This dominates latency (~8–12s observed).
- After recall, the resolver reverse-joins `wiki_section_sources` and `wiki_pages` to surface pages *citing* the recalled memory units. This is clever for deep semantic queries but overkill — and far slower — than a direct FTS over the compiled page corpus.
- `wiki_pages.search_tsv` is a `generatedAlwaysAs` `tsvector` column built from `title || summary || body_md`, GIN-indexed as `idx_wiki_pages_search_tsv`. It is already populated on every page. It is **not used** by the mobile path today.
- The admin `wikiSearch` resolver (`packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts`) already implements the exact FTS + alias-match pattern we need, with `plainto_tsquery('english', query)` and `ts_rank` scoring. It is the canonical reference implementation.
- The `recentWikiPages` resolver (empty-query path) is already a single indexed select ordered by `COALESCE(last_compiled_at, updated_at) DESC` — fast and correct; no changes needed there.
- The mobile `useMobileMemorySearch` hook is correctly paused on empty query (`pause: !agentId || trimmed.length === 0`), so tab-entry with no query does not fire a search. The modal overlay (`WikiList.tsx:100–133`) is gated on `isSearching && loading`, so it should not appear on an empty input. The perceived tab-entry slowness is almost certainly a previous search still in flight or the first real keyword search — both resolved by making the search itself fast.

## Requirements Trace

- **R1.** Mobile Wiki search returns results for a keyword like "Austin" in <200ms p95 against a ~100-page corpus (target: feels instant).
- **R2.** Pull-to-refresh on an empty search input returns the latest wiki pages sorted by updated/compiled date desc — no semantic recall, no modal overlay.
- **R3.** Search preserves tenant + owner scoping (v1 invariant: every page is strictly agent-scoped; never cross-agent, never cross-tenant).
- **R4.** Search supports multi-word inputs (e.g., "austin swim") via `plainto_tsquery` and ranks results reasonably.
- **R5.** Empty / whitespace-only query returns `[]` from the search resolver — the client continues to render the recent-pages list instead.
- **R6.** Backward-compatible GraphQL shape: `mobileWikiSearch` continues to return `{ page, score, matchingMemoryIds }` so the existing mobile client and any active TestFlight builds keep working. `matchingMemoryIds` is `[]` on the new path.

## Scope Boundaries

- **Not changing** `recentWikiPages` — it is already fast and correct.
- **Not changing** the admin `wikiSearch` resolver or the admin Wiki module.
- **Not removing** the Hindsight recall service or its adapter. Other surfaces (e.g., deeper memory-unit search tools) still use it.
- **Not building** a "FTS + Hindsight fallback" or parallel-merge strategy. FTS-only is the chosen mobile search behavior (see Key Technical Decisions).
- **Not introducing** client-side debounce. CaptureFooter already submits search on Enter, not per keystroke — adding debounce would be noise.
- **Not adding** alias-table lookups on mobile in this PR. The mobile wiki surface doesn't expose aliases yet; doing the reverse-join adds complexity without a visible UX gain here. Flag as a deferred follow-up if users start searching by alternate names.

### Deferred to Separate Tasks

- **Alias-aware search on mobile**: port the `alias_hits` CTE from `wikiSearch` once the mobile UI surfaces aliases.
- **Search result highlighting**: `ts_headline` snippets are a future UX polish, not in scope here.

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts` — current Hindsight-based resolver to replace.
- `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts` — **canonical FTS pattern to mirror** (`plainto_tsquery`, `ts_rank`, GIN index usage, tenant+owner scoping).
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — unchanged; already fast; cited as the empty-query baseline.
- `packages/database-pg/src/schema/wiki.ts:93–94, 136` — `search_tsv` generated column + `idx_wiki_pages_search_tsv` GIN index. Already in the schema and deployed.
- `packages/api/src/lib/wiki/repository.ts` — shared repository helpers; check whether an FTS helper can be reused or whether we inline the SQL in the resolver (admin `wikiSearch` inlines it — we'll follow suit).
- `packages/react-native-sdk/src/graphql/queries.ts:263–279` — `MobileMemorySearchQuery` GraphQL document; schema stays the same, no client change required.
- `packages/react-native-sdk/src/hooks/use-mobile-memory-search.ts` — pause logic and `cache-and-network` policy are correct; keep as-is.
- `apps/mobile/components/wiki/WikiList.tsx` — overlay gating (`showSearchOverlay = isSearching && loading`), pull-to-refresh wiring (`refreshing={loading && !isSearching}`, `onRefresh={refetch}`). Already correct by inspection; verify empirically post-change.
- `apps/mobile/app/(tabs)/index.tsx:232–479, 542–551` — Wiki tab rendering and `CaptureFooter` search-query wiring. No changes expected.

### Institutional Learnings

- `docs/solutions/` — no directly related prior solution; compounding-memory search stack is recent.
- **GraphQL Lambda deploys via PR** (memory): do not `aws lambda update-function-code graphql-http` directly — merge through the pipeline. Applies to this change because it edits the `graphql-http` handler.
- **Verify wire format empirically** (memory): before assuming the mobile client's GraphQL shape, curl the live `mobileWikiSearch` response once on current `main` and once against the new resolver to confirm the response JSON is byte-for-byte compatible on `{ page, score, matchingMemoryIds }`.
- **Evals scoring stack** (memory): this change does not touch the evals stack — noting only to preclude over-reach.

### External References

External research was intentionally skipped (see Phase 1.2 heuristic): the codebase has a direct, recently-written, convention-matching reference implementation in `wikiSearch.query.ts`. External docs for Postgres FTS add no practical value over that reference.

## Key Technical Decisions

- **Use Postgres FTS (`search_tsv` + `plainto_tsquery`) exclusively for mobile Wiki search.** *Rationale:* the `search_tsv` GIN index already exists and is populated; on ~100 rows FTS is <50ms; the user's actual queries are page-title/keyword matches, which FTS handles perfectly. Hindsight semantic recall was architecturally over-qualified for this surface and is the sole source of 10s latency. User explicitly chose FTS-only over FTS+fallback.
- **Inline the SQL in the resolver**, matching the admin `wikiSearch` style, rather than extracting a shared helper in `packages/api/src/lib/wiki/repository.ts`. *Rationale:* two call sites is not yet a helper-worthy duplication; extracting prematurely risks dragging admin-specific alias logic into the mobile path. Revisit if a third caller appears.
- **Preserve the `mobileWikiSearch` GraphQL schema** (`{ page, score, matchingMemoryIds }`). *Rationale:* the mobile app is on TestFlight; changing the schema would require a client release. `matchingMemoryIds` simply becomes `[]` on the new path — the existing mobile UI does not render anything special off it.
- **Skip alias lookups on mobile for now.** *Rationale:* the mobile UI doesn't surface aliases, and the admin alias CTE joins `wiki_page_aliases` which adds noise. Deferred.
- **Keep `recentWikiPages` exactly as-is.** *Rationale:* it's already a single indexed query over ~100 rows; it meets R2. No justification for touching it.
- **No client-side debounce.** *Rationale:* `CaptureFooter` already submits on Enter/tap, not per keystroke. Adding debounce would be solving a problem that doesn't exist.

## Open Questions

### Resolved During Planning

- **Should mobile search also consult Hindsight for conceptual queries?** No — user chose FTS-only. If we later see users typing conceptual prompts like "places I've been near the water", we'll revisit with usage data, not speculation.
- **Do we need a new GSI or column for sorting recent pages?** No — `idx_wiki_pages_last_compiled` + `idx_wiki_pages_tenant_owner_type_status` already cover the empty-query path, and ~100 rows never needs more.
- **Do we need to change the mobile client?** No — the GraphQL response shape is preserved.

### Deferred to Implementation

- Whether the new resolver should also explicitly filter `type IN ('entity','topic','decision')` or just trust `status = 'active'`. Look at what pages exist in practice and match `wikiSearch` behavior.
- Exact `LIMIT` clamp — the existing mobile resolver caps at ~20. Keep that or align with admin `wikiSearch`'s `DEFAULT_LIMIT = 20` / `MAX_LIMIT = 50`. Minor detail, decide in implementation.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
BEFORE (current, ~10s):
  mobile → GraphQL → mobileWikiSearch resolver
                      → HTTP POST hindsight/recall (8–12s)
                      → DB: reverse-join wiki_section_sources → wiki_pages
                      → in-memory rank/dedupe
                      → return hits

AFTER (target, <200ms p95):
  mobile → GraphQL → mobileWikiSearch resolver
                      → DB: SELECT ... FROM wiki_pages
                           WHERE tenant_id=? AND owner_id=? AND status='active'
                             AND search_tsv @@ plainto_tsquery('english', query)
                           ORDER BY ts_rank(...) DESC, last_compiled_at DESC NULLS LAST
                           LIMIT N
                      → map rows → { page, score, matchingMemoryIds: [] }
                      → return hits
```

Scoping invariant preserved in WHERE clause: `(tenant_id, owner_id)` derived from `ctx` + `agentId`. No cross-agent visibility possible.

## Implementation Units

- [ ] **Unit 1: Rewrite `mobileWikiSearch` resolver to use Postgres FTS**

**Goal:** Replace the Hindsight-recall body of the resolver with a direct FTS query against `wiki_pages.search_tsv`, preserving the GraphQL response shape.

**Requirements:** R1, R3, R4, R5, R6.

**Dependencies:** None — `search_tsv` + GIN index are already live.

**Files:**
- Modify: `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts`
- Test: `packages/api/src/graphql/resolvers/memory/__tests__/mobileWikiSearch.query.test.ts` (create if absent; check existing __tests__ layout under `packages/api/src/graphql/resolvers/memory/` before choosing path)

**Approach:**
- Resolve tenant from `ctx` and the agent row from `agents` table by `args.agentId` (same auth shape as current resolver; keep tenant+owner assertion).
- Trim the input; if empty, return `[]` immediately.
- Execute a single SQL query patterned on `wikiSearch.query.ts`: `SELECT ... ts_rank(search_tsv, plainto_tsquery('english', :q)) AS score ... WHERE tenant_id=? AND owner_id=? AND status='active' AND search_tsv @@ plainto_tsquery('english', :q) ORDER BY score DESC, last_compiled_at DESC NULLS LAST LIMIT :limit`.
- Map rows to the existing response shape: `{ page: toGraphQLPage(row, { sections: [], aliases: [] }), score: row.score, matchingMemoryIds: [] }`.
- Drop the `getMemoryServices().recall` call, the `wiki_section_sources` reverse-join, and the in-memory aggregation loop.
- Keep the resolver export surface identical (`mobileWikiSearch` async function with the same signature).

**Execution note:** Verify wire format empirically before merging — curl the live Lambda once against current `main`, once against the rebuilt resolver, and diff the JSON shape on a known query + an empty query. Preserve byte-for-byte compatibility on `{ page, score, matchingMemoryIds }`.

**Patterns to follow:**
- `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts` — SQL shape, row type, `ts_rank` + `plainto_tsquery` usage, row→GraphQL mapper.
- `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts` — tenant + agent resolution, `cappedLimit` clamping idiom.

**Test scenarios:**
- **Happy path** — search "Austin" over a fixture of 5 pages with 3 matches in title/summary/body returns the 3 matches, sorted by descending `ts_rank`, each row has `page`, numeric `score`, and `matchingMemoryIds: []`.
- **Happy path** — multi-word search "austin swim" uses `plainto_tsquery` semantics (AND of lexemes) and returns pages matching both stems.
- **Edge case** — empty string query returns `[]` without hitting SQL.
- **Edge case** — whitespace-only query (`"   "`) returns `[]`.
- **Edge case** — query with no matches returns `[]` (not an error, not null).
- **Edge case** — `limit` above the max is clamped; below 1 is clamped to 1.
- **Error path** — unknown `agentId` raises the same auth/ownership error as current resolver; caller cannot see pages for an agent they don't own.
- **Error path** — tenant mismatch (ctx.tenantId ≠ agent.tenant_id) fails the same way it does today.
- **Integration** — row ordering: a page whose title matches exactly outranks a page that only mentions the term deep in `body_md` (validates `ts_rank` over the composed tsvector).
- **Integration** — the resolver does NOT invoke `getMemoryServices().recall` (assert via mock or service-spy). Prevents regression to the slow path.

**Verification:**
- p95 latency on a fixture with 100 pages and a single-word query is under ~100ms in a local test loop (sanity check; production target is <200ms p95 end-to-end including network).
- Running the resolver against the local stack returns results for "Austin" in under one second wall-clock.

- [ ] **Unit 2: Confirm mobile loading UX is correct post-fix (no code change unless verified bug)**

**Goal:** Empirically verify the two UX concerns from the user report are resolved once the backend is fast. Only edit `WikiList.tsx` if verification surfaces an actual flicker or misbehavior.

**Requirements:** R2.

**Dependencies:** Unit 1 deployed to the dev/staging GraphQL endpoint the simulator hits.

**Files:**
- (Potential) Modify: `apps/mobile/components/wiki/WikiList.tsx` — only if verification finds a real issue.

**Approach:**
- Run the app against the updated backend and reproduce the original scenarios:
  1. Cold-launch the mobile app, tap **Wiki** tab, observe: no modal "Searching…" overlay appears with an empty input. List populates via `recentWikiPages`.
  2. Pull-to-refresh on the Wiki tab with empty input — the list refetch fires, modal overlay does NOT appear, and results reload via `recentWikiPages`.
  3. Type "Austin" in `Search wiki…`, submit — overlay appears briefly (<500ms) and results populate.
  4. Clear the search input — list returns to recent pages; no stale overlay.
- If any of these misbehave, narrow the fix in `WikiList.tsx`:
  - The overlay is gated on `isSearching && loading` (line 54). If it persists with `isSearching=false`, look at how `trimmedQuery` is reset when the input is cleared.
  - Pull-to-refresh ties `refreshing` to `loading && !isSearching` and `onRefresh` to `refetch`. If `refetch` is binding to `search.refetch` when `isSearching` is false, re-examine the `const { ... refetch } = isSearching ? search : recent` destructuring.
- Expected outcome: no change required. Record the verification result in the PR description.

**Execution note:** This unit is verification-first. Do not preemptively rewrite the overlay logic; fix only what empirically misbehaves. This mirrors the "diagnostic logs literal" lesson — read what's actually happening before editing.

**Patterns to follow:**
- `apps/mobile/components/wiki/WikiList.tsx` existing overlay and RefreshControl wiring.

**Test scenarios:**
- Test expectation: none — manual simulator verification. If a bug is found and code changes, add a unit test that renders `WikiList` with `isSearching=false`, `loading=true` and asserts the modal overlay is NOT in the tree.

**Verification:**
- All four reproduction steps above behave per the "observe" bullet.
- If the empty-query pull-to-refresh ever showed the modal "Searching…" overlay, that behavior is gone.

- [ ] **Unit 3: Smoke-test end-to-end against the dev backend + TestFlight build**

**Goal:** Confirm the user-reported latency is gone in a real device context before shipping to TestFlight.

**Requirements:** R1, R2, R4.

**Dependencies:** Unit 1 merged to main and deployed via the GraphQL pipeline.

**Files:**
- Modify: none (verification only).

**Approach:**
- On the simulator (or a physical device pointed at dev), sign in as Eric → agent "Marco" (the agent in the screenshot).
- Measure:
  - Cold tab-entry time from tap to list visible (should be ≲500ms after backend warmth).
  - Time from pressing Enter on "Austin" to results visible (target <1s including network on dev; <200ms server-side p95).
  - Time from pressing Enter on a multi-word query like "austin swim" to results visible.
- Capture a screen recording for the PR, side-by-side with a "before" clip if available.

**Patterns to follow:**
- Manual smoke flow used when verifying prior mobile Wiki plans (plans 005, 006).

**Test scenarios:**
- Test expectation: none — manual smoke test with measurements attached to the PR.

**Verification:**
- "Austin" and "austin swim" return in well under 10s on dev; the original user complaint is visibly resolved.
- Empty search input shows the latest pages list and never shows the modal overlay.

## System-Wide Impact

- **Interaction graph:** `mobileWikiSearch` is called by the mobile app via GraphQL. No other consumers today — a grep for the query name confirms the mobile SDK is the only caller. Admin uses the separate `wikiSearch` resolver.
- **Error propagation:** Tenant/owner auth errors continue to surface as the same GraphQL errors. Removing the Hindsight call also removes a class of 15s-timeout / 5xx errors from recall — an unambiguous reliability win.
- **State lifecycle risks:** None. No writes, no background jobs, no caches invalidated. `search_tsv` is a generated column — always in sync with `title/summary/body_md`.
- **API surface parity:** `mobileWikiSearch` keeps its name, arguments, and response shape. Mobile clients (including live TestFlight builds) continue working without update.
- **Integration coverage:** The resolver no longer depends on the Hindsight adapter. A regression here means a page isn't found; it cannot cause cross-agent leakage because the SQL has explicit `tenant_id` + `owner_id` predicates mirroring the existing scoping invariant.
- **Unchanged invariants:** v1 compounding-memory scoping rule (every page strictly agent-scoped; `owner_id NOT NULL`; no tenant-shared escape hatch) is preserved by the WHERE clause. The `recentWikiPages` resolver is untouched. The Hindsight adapter and any non-mobile callers are untouched.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `plainto_tsquery('english', …)` stems differently than users intuit (e.g., plural vs singular). | English stemming is what the GIN index was built for, and the admin `wikiSearch` already uses the same config — so behavior matches the admin tool users see. If a specific miss is reported, evaluate `websearch_to_tsquery` as a separate tweak. |
| Dropping Hindsight recall loses semantic matching for queries that don't match the page corpus verbatim (e.g., "places near water" finds no "water" lexeme). | Out of scope per the user's chosen strategy. If conceptual-query UX regresses, revisit with real usage data, not speculation. A follow-up could add a "Deep search" affordance that invokes Hindsight on demand. |
| Schema still returns `matchingMemoryIds` but we always send `[]`. A future client could assume non-empty. | The existing mobile client treats it as optional. Field stays in the schema for compatibility; flag in the PR description so future work knows `[]` is load-bearing, not missing. |
| `search_tsv` generated column was never populated on some rows (edge case if historical rows predate the column). | The column is `generatedAlwaysAs` — Postgres populates it on every row automatically. No backfill risk. Verify by spot-checking one old row's `search_tsv` is non-null. |
| Deploying the resolver via the monorepo pipeline (not direct Lambda update, per memory). | Follow the "GraphQL Lambda deploys via PR" rule: merge through `main`; let the pipeline deploy. |

## Documentation / Operational Notes

- No user-facing doc changes.
- PR description should include a before/after latency measurement and a screen recording of the Wiki search working under a second.
- Post-merge, monitor CloudWatch for `graphql-http` Lambda p95 — it should drop noticeably on the `mobileWikiSearch` route.

## Sources & References

- Current slow resolver: `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts`
- Canonical FTS reference: `packages/api/src/graphql/resolvers/wiki/wikiSearch.query.ts`
- Empty-query path (unchanged): `packages/api/src/graphql/resolvers/memory/recentWikiPages.query.ts`
- Schema + indexes: `packages/database-pg/src/schema/wiki.ts` (lines 76–140)
- Mobile UI: `apps/mobile/components/wiki/WikiList.tsx`, `apps/mobile/app/(tabs)/index.tsx`
- Mobile SDK: `packages/react-native-sdk/src/hooks/use-mobile-memory-search.ts`, `packages/react-native-sdk/src/hooks/use-recent-wiki-pages.ts`, `packages/react-native-sdk/src/graphql/queries.ts`
- Related in-flight plans: `docs/plans/2026-04-19-006-feat-mobile-wiki-force-graph-plan.md` (graph view — independent), `docs/plans/2026-04-19-005-refactor-mobile-memories-to-wiki-plan.md` (completed — establishes Wiki tab structure)
- Memories referenced: GraphQL Lambda deploys via PR; Verify wire format empirically; Read diagnostic logs literally
