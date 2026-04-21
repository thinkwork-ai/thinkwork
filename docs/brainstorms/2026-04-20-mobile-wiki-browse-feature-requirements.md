---
date: 2026-04-20
topic: mobile-wiki-browse-feature
---

# Mobile Wiki Browse Feature

## Problem Frame

The mobile Wiki tab today defaults to a List view (`WikiList` backed by `useRecentWikiPages`), with the unlabeled force-directed constellation reachable via a header toggle. Neither surface supports real exploration: the List is a flat recency stream with no orientation signal, and the constellation has strong wow-factor but no labels, no cluster themes, and "tap a dot and hope" as its only navigation. Users can't rediscover pages they've forgotten, get a sense of which themes dominate their knowledge, or follow connections without blind tapping.

Users who return to the Wiki tab are overwhelmingly looking to be *reminded* of what their past self has been thinking about. Destination-known lookup is already served by the semantic search footer. The current Wiki tab gives users a pretty picture and no way to dig in.

**Users affected:** All ThinkWork mobile users with a non-trivial compiled wiki.

**What is changing:** The Wiki tab's landing surface is replaced by a Browse surface optimized for rediscovery and orientation. Both existing views — the default List (`useRecentWikiPages`) and the toggle-activated unlabeled constellation — are superseded. The constellation stays reachable behind a "View constellation" affordance; the fate of the current recency List is an open product question (see Outstanding Questions). The existing detail screen — which already has a labeled 1-hop subgraph shipped earlier in April 2026 — is reused as the navigation target for hub tiles.

## Browse Layout (visual aid)

```
┌────────────────────────┐
│ Marco ▾      ☰ ⏷ ⋯    │  header (unchanged)
│ [Threads] [ Wiki ]     │  segmented pill (unchanged)
│────────────────────────│
│ Your hubs              │  R1–R5: launchpad grid
│ ╭────╮ ╭────╮ ╭────╮   │
│ │ ⭐ │ │ ⭐ │ │ ⭐ │   │
│ │Q2  │ │Acme│ │Team│   │  auto + user-pinned,
│ │ 23 │ │ 18 │ │ 12 │   │  cluster-derived titles
│ ╰────╯ ╰────╯ ╰────╯   │  where possible (R11)
│ … more tiles scroll    │
│                        │
│ 🔥 Growing this week   │  R6: new-link signal
│ ─ Pricing memo  +4     │
│ ─ Marco call    +3     │
│                        │
│ 💤 Dormant             │  R7: stale-but-linked
│ ─ Onboarding v1 (42d)  │
│ ─ Q3 retro      (31d)  │
│                        │
│ [ View constellation ] │  R10: one-tap-away toggle
│────────────────────────│
│ [ Search wiki... ]     │  footer (unchanged, R12)
└────────────────────────┘
```

## Requirements

**Hub Launchpad (primary surface)**
- R1. The Browse landing shows a scrollable grid of 6–10 **hub tiles**, each representing a wiki page chosen for its structural importance in the user's graph.
- R2. Each hub tile shows a human-readable title (cluster-derived where possible — see R11), a size indicator (number of linked pages), and the page's type glyph (ENTITY / TOPIC / DECISION).
- R3. By default the system auto-selects hub tiles using graph-structural signals prioritizing both connectivity and recent growth. The existing persisted `wiki_pages.hubness_score` (maintained by `recomputeHubness` in `packages/api/src/lib/wiki/repository.ts`, formula = inbound_reference_links + 2×promoted_child_count + floor(avg(supporting_record_count)/10)) provides a strong starting signal; the exact formula — and whether and how to augment it with recent-growth weighting or super-hub exclusion — is a planning decision. Users with an empty graph see a first-run empty state pointing at the search footer.
- R4. Users can **pin** or **unpin** any wiki page as a personal hub from the page's detail screen. Pinned hubs occupy slots in order; remaining slots are auto-filled.
- R5. Tapping a hub tile navigates to that page's detail screen (which already includes a labeled 1-hop subgraph).

**Signal Strips (secondary surfaces)**
- R6. A **Growing** strip below the hub grid shows up to 5 pages that gained new backlinks in the last 7 days, each tagged with the new-link count (e.g. "+3"). Sorted by count descending.
- R7. A **Dormant** strip below Growing shows up to 5 pages that have not been re-compiled in 30+ days but still have ≥2 links, ordered by oldest `last_compiled_at`.
- R8. Each strip row shows page title, type glyph, and its signal-specific metric ("+3 links", "42d dormant"). Strip rows are compact (single-line where possible).
- R9. Tapping a strip row navigates to the page detail screen.

**Constellation Access**
- R10. A persistent **View constellation** affordance at the bottom of the Browse surface opens the existing full-screen unlabeled force-directed graph. The constellation itself is unchanged in v1 — no new labels, no new interactions beyond what ships today.

**Cluster-labeled Hub Titles**
- R11. Where a hub represents a dense sub-graph of related pages, its tile displays a **cluster-derived theme label** alongside or in place of the raw page title. Raw title is the fallback. Exact label-synthesis mechanism (community detection, LLM summarization) is a planning decision — see *Deferred to Planning*.

**Search Coexistence**
- R12. The existing `Search wiki…` footer input and its search behavior are preserved. (Note: today's `mobileWikiSearch` resolver is Postgres FTS on `search_tsv`, not semantic recall — the Browse surface makes no new assumptions about search backend.) When a search is active, the Browse surface is replaced by a flat result list (matching today's List-view behavior). Browse returns when the query is cleared. The footer's dual-mode (search vs capture/add) behavior via `CaptureFooter` is preserved as-is; how the add-mode toast coexists with Browse is a planning detail.

**Tab Taxonomy**
- R13. Browse replaces the current Wiki tab's landing contents. The top-level Threads/Wiki pill is unchanged; "Wiki" now opens the Browse surface instead of the constellation graph. No new top-level tab is added.

## Success Criteria

- A user who has not opened the app in a week can open the Wiki tab and, within ~10 seconds, identify at least one page worth re-reading — without typing into search.
- Detail-page visit rate from the Wiki tab increases measurably over the current graph-only baseline.
- Users still open the constellation view at some non-zero rate (signals that orientation/wow is still valued), but not as the primary navigation path.
- Qualitative: users describe the Wiki tab as *useful*, not only *pretty*.

## Scope Boundaries

- **Not** a search feature. Lookup-with-known-destination is already covered by the semantic-search footer.
- **Not** a cluster-labeled whole-graph view. Labels on the full constellation are deliberately out of scope; it remains the pretty map.
- **Not** a recency-sorted feed. Pure recency was deprioritized in favor of graph-native signals; "recently compiled" is not a v1 strip.
- **Not** a weekly digest or push-notification surface. That is a potential compounding follow-up, not part of v1.
- **Not** an admin-web equivalent. v1 is mobile-only.
- **Not** a redesign of the existing page detail screen or its embedded 1-hop subgraph. Those shipped 2026-04-20 and are reused as-is.

## Key Decisions

- **Hub-launchpad chosen over Living-map and Pulse-feed.** The detail-screen labeled 1-hop subgraph already solves the "labeled navigable graph" problem; hub tiles lean on it rather than solving whole-graph labeling. This also gives users a stable, pinnable home for their knowledge.
- **Rediscovery is the primary job-to-be-done; lookup is explicitly out of scope.** Search already works for known-destination lookups.
- **Graph-native signals only in v1.** Pure recency was deprioritized. v1 surfaces only signals that require the link graph to compute — growing links, dormant-but-linked, structural hubs. This differentiates Browse from a generic notes feed.
- **Auto + user override for hub selection.** Default gives a useful first-run; pin/unpin gives power users control without forcing curation on casual users.
- **Constellation preserved but demoted.** Removing it entirely would throw away the user's #2 intent (map orientation). But it is not a navigation tool and should not pretend to be.
- **"Forgotten" reframed as "Dormant".** Originally conceived as "pages the user hasn't viewed in a while", but the schema has no per-user page-view tracking. Dormant uses `last_compiled_at` staleness instead, which is computable today and a reasonable proxy without new infra.

## Dependencies / Assumptions

- **Verified:** `wiki_page_links.created_at` exists — Growing signal is computable from existing schema (`packages/database-pg/drizzle/0013_motionless_white_queen.sql`).
- **Verified:** `wiki_pages.last_compiled_at` exists — Dormant signal is computable from existing schema (same file).
- **Verified:** `wiki_pages.hubness_score` exists and is actively maintained per page (`packages/database-pg/drizzle/0014_wiki_aggregation.sql`, `recomputeHubness` in `packages/api/src/lib/wiki/repository.ts` lines 1846-1896). Hub auto-selection starts from this column rather than re-deriving degree.
- **Verified:** The existing `wikiGraph` resolver already returns per-node `edge_count` ordered descending (`packages/api/src/graphql/resolvers/wiki/wikiGraph.query.ts`). The degree component of hub selection is already in-client for the graph view — a sibling resolver for Browse may still be preferable for payload-shape reasons, but is not required by data availability.
- **Verified absence:** No per-user wiki-page view-tracking table exists. Surfacing "unviewed by user" would require new infra; v1 uses `last_compiled_at` staleness (the Dormant signal) as a proxy — see Outstanding Questions for whether this proxy actually tracks the intended meaning.
- **Verified:** `WikiDetailSubgraph` (labeled 1-hop graph on the detail screen) shipped earlier in April 2026 and is reused as the navigation target for R5/R9.
- Assumes the GraphQL `wikiGraph` resolver can be extended — or a sibling `wikiBrowseLanding` resolver added — to return hub candidates + signal-strip rows in one call. Specific backend shape (extend vs new resolver, payload size, index strategy for the Growing window) is a planning question.

## Outstanding Questions

### Resolve Before Planning

_(none — all product decisions are resolved)_

### Deferred to Planning

- [Affects R3][Technical] Exact default-hub selection formula. Starting point is `ORDER BY hubness_score DESC`; open questions are whether to augment with a recent-growth term, whether to apply super-hub exclusion (avoid "Notes index"-style pages that dominate the graph), and how to stabilize selection across sessions (hysteresis so tiles don't churn on every new link). Needs a look at the actual hubness-score distribution on a real tenant.
- [Affects R4][Technical] Where does "pin this hub" live — detail-screen header, overflow menu, long-press on a hub tile, or a combination? Storage location for pin state (local device vs server) also undecided.
- [Affects R6][Technical] Growing window: fixed 7d vs rolling vs configurable. Efficient count computation — likely a per-page rolling aggregate to avoid full-scan on every Browse render.
- [Affects R7][Technical] Dormant threshold: 30d may be too short for slow-moving wikis. Planning should inspect the tenant's actual `last_compiled_at` distribution and tune.
- [Affects R11][Needs research] Cluster-derived hub title synthesis. Options: (a) graph community detection (Louvain / Leiden) + heuristic labeling, (b) LLM prompt over a hub's 1-hop titles, (c) ship raw titles for v1 and defer cluster labels to a follow-up. (b) likely simplest; planning should spike cost and latency.
- [Affects R13][Technical] Fate of the existing List/Graph segmented toggle inside the Wiki tab. Planning should decide whether it is removed, repurposed, or retained.
- [Affects R1][Technical] Hub tile layout: horizontal scroll strip vs vertical grid vs 2-row grid. Depends on final tile size and how many hubs are displayed at once.

## Next Steps

`-> /ce:plan` for structured implementation planning.
