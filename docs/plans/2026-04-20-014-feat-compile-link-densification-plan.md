---
title: "feat: Compile-pipeline link densification (pre-hierarchical)"
type: feat
status: active
date: 2026-04-20
origin: docs/plans/2026-04-20-013-handoff-mobile-graph-densification-and-dogfood.md
related:
  - docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md  # the broader effort this plan unblocks / coordinates with
  - docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md
---

# feat: Compile-pipeline link densification (pre-hierarchical)

## Overview

48% of entity pages on dev have zero rows in `wiki_page_links` — they render as floating dots in the mobile and admin graph viewers. Only 3 `parent_of` / 3 `child_of` pairs exist (all Marco topic↔topic) vs 1,225 `reference` links, so structural hierarchy is effectively absent. The aggregation pass runs on every compile (`agg_calls=1`, `det_parents=3-8`) but `sections_promoted` is null on every job — so the only code path that writes `parent_of`/`child_of` (section promotion via `setParentPage()`) never fires at scale, and the LLM planner is too conservative on `pageLinks` to compensate.

This plan adds two **deterministic, LLM-free** link-emission paths to the compile pipeline plus a one-time backfill:

1. **Metadata-driven parent links.** When `parent-expander` derives a high-confidence parent candidate (exact city match, exact journal match, exact tag-cluster match) and a wiki page already exists for that parent title, emit a `reference` link from the leaf to the parent, without waiting for a section promotion.
2. **Co-mention reference links.** After `applyPlan()` writes sections, read `wiki_section_sources` for this batch's memory_units — whenever a single memory_unit sourced ≥2 distinct active entity pages, emit reciprocal `reference` links between those pages with `context = "co_mention:<memory_unit_id>"` for provenance.
3. **Backfill.** One-off script that walks existing pages + memory_units and produces the same link set retroactively, idempotent via the existing `(from_page_id, to_page_id, kind)` unique index.

Scope is deliberately a **pre-hierarchical quick win**. The broader hierarchical aggregation plan (`docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`, 0/8 done) is the canonical long-term answer — section promotion scoring, `parent_page_id` column, pg_trgm fuzzy dedupe, duplicate-candidate metric. This plan is a strict subset that ships densification now without pre-empting any of that work.

## Problem Frame

See origin: [`docs/plans/2026-04-20-013-handoff-mobile-graph-densification-and-dogfood.md`](2026-04-20-013-handoff-mobile-graph-densification-and-dogfood.md) (PR #284 — queued).

The mobile graph viewer shipped 2026-04-19 and renders what's in `wiki_page_links`. On dev the link density per agent is:

| Agent | Pages | With ≥1 link | % linked |
|---|---|---|---|
| GiGi  | 849 | 392 | 46% |
| Marco | 261 | 183 | 70% |
| Cruz  | 10  | 9   | 90% |

Investigation run on 2026-04-20 refines the origin's four hypotheses:

| Hypothesis | Verdict |
|---|---|
| H1. Single-source mention rule | **Weaker than expected.** Only 58 of 639 unlinked pages (9%) are single-source; 562 (88%) are multi-source — so being multi-source isn't sufficient for linking. |
| H2. Topic↔Entity `parent_of` missing | **Confirmed.** 3 `parent_of` + 3 `child_of` pairs exist (all Marco topic↔topic). `setParentPage()` only fires on section promotion; promotion never fires. |
| H3. User↔Entity links absent | Out of scope for this plan — investigate when dogfood surfaces it. |
| H4. Body bracket refs unconverted | **Disproved.** 0 of 639 unlinked pages have `[[brackets]]` in body_md. PR #264 linkify only formats body_md, doesn't write link rows. |
| H5 (added). Shared-attribute linking never emits | **Confirmed.** `parent-expander.ts` derives 3-8 candidates per compile but only the aggregation planner can act on them, and the planner doesn't promote sections on this data. |

## Requirements Trace

- **R1.** GiGi unlinked-page rate drops from 54% to **≤ 20%** after backfill + one subsequent compile cycle.
- **R2.** Marco unlinked-page rate drops from 30% to **≤ 15%** under the same treatment.
- **R3.** Combined `parent_of` + `child_of` pair count across both agents rises from 6 to **≥ 50**, with zero type-mismatch pairs (entity↔unrelated-topic).
- **R4.** `bracket_leaks = 0` invariant from HANDOFF.md §3 is preserved.
- **R5.** `duplicate_candidates` count (baseline TBD in Unit 1) does not rise by more than 10% after densification — false-positive hubs are bounded.
- **R6.** Live compile and backfill are both idempotent — replay on the same data produces no new rows.
- **R7.** No per-compile latency regression > 15% vs baseline on a representative 150-memory batch.

## Scope Boundaries

### In scope

- Deterministic metadata-driven `reference` link emission from `parent-expander` candidates.
- Co-mention reference linking inside `applyPlan()` (leaf pass only).
- One-off backfill script, safely re-runnable.
- New per-compile metrics: `links_written_deterministic`, `links_written_co_mention`, `duplicate_candidates` baseline snapshot.
- Unit + integration tests asserting precision invariants (type-mismatch gate, idempotency, cap).

### Out of scope — actively deferred

- **Section promotion scoring** — owned by `docs/plans/2026-04-19-002` Unit 4.
- **`parent_page_id` structural column on `wiki_pages`** — owned by `docs/plans/2026-04-19-002` Decision 2.
- **Fuzzy alias dedupe (pg_trgm 0.85)** — owned by `docs/plans/2026-04-19-002` Unit 2. This plan only uses exact-title match.
- **Emitting `parent_of`/`child_of` deterministically** — this plan emits only `reference` kind. Structural parent/child remains the aggregation planner's call. (Opens a deferred upgrade path: when `docs/plans/2026-04-19-002` lands, the same deterministic candidates can upgrade to `child_of` under its composite score gate.)
- **Cross-agent / cross-tenant linking** — scope stays `(tenant_id, owner_id)` per scoping PRD.
- **Graph viewer or mobile UI changes.** The viewer is correct given denser data.
- **User-node linking** (H3) — revisit after dogfood.
- **Tags-as-links** — tags stay soft hints per hierarchical aggregation plan decision.

### Deferred to Separate Tasks

- **Hierarchical aggregation** (`docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`) — active, 0/8 units. This densification plan is a precursor that does not block or replace it.
- **Gap-sweep of 4 GiGi ideas lost to retain timeouts during bootstrap** — trivial, separate follow-up.

## Context & Research

### Relevant Code and Patterns

- `packages/api/src/lib/wiki/compiler.ts` — orchestration. `applyPlan()` at L617 writes leaf planner `pageLinks` → `reference`. `runAggregationPass()` at L1004. `setParentPage()` call site at L1117 (fires on `PlannedSectionPromotion` only).
- `packages/api/src/lib/wiki/repository.ts` — `upsertPageLink()` at L1039 is the single INSERT surface (`.onConflictDoNothing()`). `setParentPage()` at L1093 writes both `parent_of` and `child_of` via that helper.
- `packages/api/src/lib/wiki/parent-expander.ts` — `deriveParentCandidates()` at L91 reads `metadata.place.city`, `place_city`, `city`, `place_address`, `place_types`, `journal_id`. Emits `DerivedParentCandidate[]` with `reason: "city" | "journal" | "tag_cluster"`, `parentTitle`, `parentSlug`, `sourceRecordIds`. Output is **suggestions**, never writes.
- `packages/api/src/lib/wiki/aliases.ts` — `slugifyTitle()`. Use the same helper for title→slug comparisons in the deterministic linker.
- `packages/database-pg/src/schema/wiki.ts` — `wiki_page_links` unique index is `(from_page_id, to_page_id, kind)`; multiple kinds can coexist between the same pair. `context` column carries nullable provenance text.

### Institutional Learnings

- [`docs/plans/archived/compounding-memory-hierarchical-aggregation-plan.md`](archived/compounding-memory-hierarchical-aggregation-plan.md) — rejects "section-to-page promotion on link count alone"; links without the composite 5-signal score are not compounding. This plan honors that by **only emitting `reference` kind**, leaving structural `parent_of` to the composite-scored aggregation pass.
- [`docs/plans/archived/wiki-compiler-memory-layer.md`](archived/wiki-compiler-memory-layer.md) — no-stub-page regression test: cannot create placeholder pages to hang links on. This plan writes links only when both endpoints are existing active pages.
- [`docs/plans/archived/compounding-memory-aggregation-research-memo.md`](archived/compounding-memory-aggregation-research-memo.md) — Rec 4/5: metadata-driven candidates are the right lane, but links alone aren't compounding. Mitigation: ship the `duplicate_candidates` metric in the same PR so false positives are observable.
- [`docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`](2026-04-19-002-feat-hierarchical-aggregation-plan.md) Decision 7 — v1 coherence signal is Jaccard tag overlap + shared-metadata majority share + pg_trgm 0.85 + type-mismatch gate. This plan borrows the **type-mismatch gate** verbatim; it does NOT adopt Jaccard/composite scoring (that stays with the broader plan).

### Prior Art and Borrowed Patterns

These heuristics are well-established in the knowledge-graph literature — this plan is **applying named techniques, not inventing novel ones**. Web research 2026-04-20 confirmed:

- **Co-mention linking = "co-occurrence network"** (entity co-mention network). Nodes = entities, edges = pairs appearing within a specified context window (we use one source memory_unit). Standard pattern, see [Wikipedia: Co-occurrence network](https://en.wikipedia.org/wiki/Co-occurrence_network).
- **Metadata-parent linking = "property-based / attribute-driven linking."** Deterministic edges grounded in structured metadata fields (geo, temporal, categorical). The canonical reference is [KnowWhereGraph](https://arxiv.org/html/2502.13874v1), which builds `place.city` → city-node edges deterministically from structured geo-metadata — effectively the same pattern we propose.
- **Known precision risk: co-occurrence alone has high false-positive rate** ([PMC11546091](https://pmc.ncbi.nlm.nih.gov/articles/PMC11546091/), [PLOS One: keyword co-occurrence methods](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0172778)). A 10-edge cap addresses recall, not precision. Literature-recommended mitigation: **minimum co-mention frequency threshold** — require a pair to co-appear in ≥2 distinct memory_units before emitting an edge. This plan adopts that threshold (see Key Technical Decisions).
- **Obsidian's "Unlinked Mentions" feature** is a client-side exact-substring scan of note titles across body text. We already get stronger coverage via Hindsight's structured extraction, so no library dependency is useful here — our path is algorithmically superior because we work on structured output rather than prose.

### Open-Source Libraries Evaluated (Rejected or Deferred)

- **Microsoft GraphRAG** ([microsoft.github.io/graphrag](https://microsoft.github.io/graphrag/)) — community detection + LLM summarization over docs. Rejected: LLM-dependent, would replace our pipeline wholesale. Worth revisiting if we later want LLM-derived clusters instead of deterministic ones.
- **Neo4j LLM Graph Builder / LangChain `LLMGraphTransformer` / LlamaIndex `KnowledgeGraphIndex`** — rejected for same reason (LLM-driven entity + relationship extraction; we have Hindsight for that).
- **spaCy / Flair NER + entity linking** — rejected: redundant with Hindsight's current coverage.
- **`remark-wiki-link` / `@braindb/remark-wiki-link`** ([npm](https://www.npmjs.com/package/remark-wiki-link)) — production-quality markdown wikilink parser. **Slots into `linkifyKnownEntities()`** (body_md formatting, shipped via PR #264) as a potential future swap. **Deferred to a separate cleanup task** — not required for this plan since PR #264's handwritten regex is working and tested. File as a follow-up if body-md link escaping bugs surface.

### Compound-engineering-plugin (naming-collision check)

The [compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) is an engineering-workflow agent system (`/ce-plan`, `/ce-work`, `/ce-compound`, etc.). "Compound" is a philosophy term in their codebase, not a function primitive. Zero overlap with knowledge-graph / wiki linking. Distinct domain, naming collision only.

### Measurements (investigation 2026-04-20)

- 639 / 1,336 pages unlinked (48%) across all agents on dev.
- 562 (88% of unlinked) are multi-source (avg 2.69 sources/page) — disproves "single-source only is the cause".
- 0 unlinked pages carry `[[brackets]]` in body_md — H4 is dead.
- 8 recent GiGi compile jobs all show `aggregation_planner_calls=1`, `deterministic_parents_derived=3-8`, but `sections_promoted=null` — confirms the dormant promotion path.
- 3 `parent_of` + 3 `child_of` pairs: all Marco topic↔topic (France↔France Restaurants, Toronto↔Toronto Restaurants, Austin↔Austin Swim Programs).

## Key Technical Decisions

- **Deterministic parent links emit only `reference` kind in v1.** Upgrading to `child_of` requires the composite coherence score owned by the hierarchical aggregation plan. This keeps the precision bar high and leaves room for `docs/plans/2026-04-19-002` to upgrade existing rows later.
- **Emission gate = ALL must hold:**
  1. `parent-expander` returned the candidate with `reason ∈ {"city","journal"}` (strongest signals) — `tag_cluster` deferred to v2.
  2. An **exact-title** active wiki page exists for `parentTitle` in the same `(tenant_id, owner_id)` scope.
  3. **Type-mismatch gate**: leaf is `entity`, parent is `topic` or `entity` (hub-like). No entity→decision, no leaf→leaf of differing specificity.
  4. The leaf page was created or updated in this compile batch (avoids emitting links for unrelated pages every pass).
- **Co-mention source = `wiki_section_sources`, not planner output.** The leaf planner's `pageLinks` shape carries no per-link `memory_unit_id`, and the section-sources join already gives us `(memory_unit_id → page_id)` after `applyPlan()` writes sections. Reusing it keeps live-compile and backfill on one code path with zero LLM-contract changes. Decided during `/ce:work` execution on 2026-04-20.
- **Co-mention gate = ALL must hold:**
  1. A single memory_unit sourced ≥2 distinct active pages in this batch (from `wiki_section_sources`).
  2. Both endpoints are `entity` type. Topic↔entity and decision↔entity remain LLM/aggregation-planner territory.
  3. **Per-memory cap: 10 reciprocal edges max** (fully connected clique of 5 pages, 10 directed edges). Prevents combinatorial explosion on dense batches. When >5 pages are co-sourced, pages are sorted by slug asc before truncation so backfill and live compile produce identical edges.
- **No ≥2-memory frequency gate in v1.** The co-occurrence literature recommends one to suppress false positives, but the stated problem here is under-linking (48% floating dots), not over-linking. Precision is bounded by the entity↔entity gate, the 10-edge cap, `context="co_mention:<memory_unit_id>"` provenance for surgical rollback (`DELETE … WHERE context LIKE 'co_mention:%'`), and the `duplicate_candidates_count` R5 canary. If dev observation shows precision tanking, v1.1 adds the gate with a dedicated `wiki_comention_pending` table (clean schema rather than overloading `wiki_unresolved_mentions`). Decided during `/ce:work` execution on 2026-04-20.
- **Context field is load-bearing provenance.** All deterministic rows get `context = "deterministic:city:<parent_slug>"` or `"co_mention:<memory_unit.id>"`. This lets future work audit, roll back, or upgrade specific rows without touching LLM-emitted ones.
- **Backfill is pure-read on source data.** The script reuses the same emit functions the live path uses — one code path, two call sites.
- **No schema migrations.** Every new behavior fits into the existing `wiki_page_links` table. Metrics ride inside `wiki_compile_jobs.metrics` jsonb.
- **Feature flag `WIKI_DETERMINISTIC_LINKING_ENABLED` (default `true` on dev, staged per env).** Gate both live paths so we can kill-switch without revert. Defined in the Lambda env alongside `WIKI_AGGREGATION_PASS_ENABLED` (same pattern).

## Open Questions

### Resolved During Planning

- **Is the aggregation pass running?** Yes. Every recent compile shows `agg_calls=1`. The gap is `sections_promoted`, not pass execution.
- **Is `parent-expander` emitting candidates?** Yes, 3-8 per compile. They're ignored by the aggregation planner under current thresholds.
- **Where to hook co-mention emission?** `applyPlan()` after section writes (so `wiki_section_sources` rows exist) and after `planner.pageLinks` resolution. The emitter reads section-sources directly rather than grouping planner output, since plan.pageLinks carries no `memory_unit_id` on the current wire.
- **Which candidate reasons to trust deterministically?** `city` and `journal` — both are exact-match on rich metadata. `tag_cluster` is heuristic and unsafe without coherence scoring; defer.

### Deferred to Implementation

- **Exact fuzzy-match policy for parent titles.** v1 uses exact match + slug equality. Trigram match lives with `docs/plans/2026-04-19-002`.
- **Co-mention cap tuning.** 10 is a starting point; Unit 5 metrics will inform adjustment.
- **Precision monitoring.** If `duplicate_candidates_count` rises >10% post-rollout (R5) or dev smoke shows obviously-wrong edges, add a `wiki_comention_pending` table in v1.1 to implement the ≥2-memory frequency gate with proper schema. Rollback path is the `context LIKE 'co_mention:%'` DELETE.
- **Backfill chunking strategy.** Aurora query planner details (ordering, LIMIT, cursor vs offset) decided at implementation time.
- **Kill-switch audit trail.** Whether to log every flag-off suppression or only the count. Implementation choice.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
compile (per memory batch)
│
├─ buildRetainPayload ─ (unchanged)
│
├─ parent-expander.deriveParentCandidates(records)
│   └─ [ {reason:"city", parentTitle:"Paris", sourceRecordIds}, … ]
│
├─ leaf planner (LLM)
│   └─ plan.pageLinks = [ {fromSlug, toSlug, kind:"reference"}, … ]
│
├─ applyPlan(plan)
│   ├─ existing: upsertPageLink(…plan.pageLinks)
│   │
│   ├─ NEW: emitDeterministicParentLinks(candidates, affectedPages)
│   │   ├─ for each candidate: resolve parent page by exact title
│   │   ├─ type-mismatch gate
│   │   ├─ upsertPageLink(leafPage → parentPage, kind:"reference",
│   │   │                 context:"deterministic:{reason}:{parentSlug}")
│   │   └─ increment metrics.links_written_deterministic
│   │
│   └─ NEW: emitCoMentionLinks(memoryUnitIds, scope)
│       ├─ read wiki_section_sources joined to wiki_pages for memoryUnitIds
│       ├─ group by memory_unit_id → distinct entity-type page_ids
│       ├─ for each group with ≥2 entity pages:
│       │   ├─ sort by slug asc, cap to 10 reciprocal edges
│       │   └─ upsertPageLink(a ↔ b, kind:"reference",
│       │                     context:"co_mention:{memory_unit_id}")
│       └─ increment metrics.links_written_co_mention
│
├─ runAggregationPass (unchanged — still decides promotions)
│   └─ if section promoted: setParentPage() → parent_of/child_of (unchanged path)
│
└─ cursor advance (unchanged)
```

**Backfill** reuses `emitDeterministicParentLinks` + `emitCoMentionLinks` but operates on:
- All `active` pages created before cutover (for deterministic parents).
- All `hindsight.memory_units` joined to their existing `wiki_section_sources` (for co-mentions).

## Implementation Units

- [ ] **Unit 1: Baselines + metric scaffolding**

**Goal:** Capture the pre-change numbers so R1-R3 and R7 are measurable, and add metric fields the later units populate.

**Requirements:** R1, R2, R3, R5, R7

**Dependencies:** None

**Files:**
- Create: `packages/api/scripts/wiki-link-density-baseline.ts` (one-off reporter)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (add metric keys to `updateJob`)
- Modify: `packages/database-pg/src/schema/wiki.ts` — if we need a typed metrics record; otherwise the jsonb key addition is zero-schema.
- Test: `packages/api/src/__tests__/wiki-link-density-baseline.test.ts`

**Approach:**
- Record per-agent: total pages, linked pages, %, avg degree, `parent_of`/`child_of` counts, `duplicate_candidates` count (exact title collisions within owner scope). Write to stdout + append to a timestamped file under `docs/metrics/` so the team can diff before/after.
- Add metric keys `links_written_deterministic`, `links_written_co_mention`, `duplicate_candidates_count` to the compile job metrics payload (all zero until Units 2/3 wire them up).
- No behavior change — safe to ship first.

**Patterns to follow:** `packages/api/scripts/wiki-rebuild-verify.ts`, `packages/api/scripts/journal-import-resume.ts`.

**Test scenarios:**
- Happy path: baseline reporter on a seeded dev-like fixture returns expected totals.
- Edge case: agent with zero pages reports cleanly (no divide-by-zero).
- Edge case: agent with all pages linked reports 100% without warnings.
- Integration: compile job metrics emit the three new keys as `0` pre-Unit 2.

**Verification:**
- Running the reporter emits a copy-pasteable table and exits 0.
- One fresh compile on dev produces metrics containing the new keys (all zero).

- [ ] **Unit 2: Deterministic parent linking from parent-expander candidates**

**Goal:** Add the precision-first `city`/`journal` parent linker that writes a `reference` link when a strong candidate has a matching active page.

**Requirements:** R1, R2, R4, R5, R6, R7

**Dependencies:** Unit 1 (metrics scaffold)

**Files:**
- Modify: `packages/api/src/lib/wiki/compiler.ts` — new `emitDeterministicParentLinks()` call inside `applyPlan()`.
- Create: `packages/api/src/lib/wiki/deterministic-linker.ts` — the pure function. Exported for backfill reuse.
- Modify: `packages/api/src/lib/wiki/repository.ts` — tiny helper for exact-title page lookup in owner scope (only if one doesn't already exist; check `findPageByExactTitle` first).
- Test: `packages/api/src/__tests__/wiki-deterministic-linker.test.ts`

**Approach:**
- `emitDeterministicParentLinks(candidates, affectedPagesById, ctx)` iterates `parent-expander` candidates, filters to `reason ∈ {"city","journal"}`, looks up the parent page by exact title in `(tenant_id, owner_id)`, checks type-mismatch gate, then calls `upsertPageLink()` with `kind: "reference"` and `context: "deterministic:{reason}:{parentSlug}"`.
- Only emits for leaf pages touched in this batch (`affectedPagesById`).
- Behind `WIKI_DETERMINISTIC_LINKING_ENABLED` flag; off → early return.
- Increments `metrics.links_written_deterministic`.

**Execution note:** Implement with a failing unit test first — the emission rules are gate-dense and easy to get wrong. Seed a scoped tenant/owner fixture with one candidate + matching + non-matching parents and assert exact link shape.

**Patterns to follow:** `upsertPageLink()` already uses `.onConflictDoNothing()`, so idempotency is free. Mirror the call sites in `compiler.ts` L617 for consistency.

**Test scenarios:**
- Happy path: candidate `{reason:"city", parentTitle:"Paris"}` + matching topic page exists → one `reference` link with correct `context`.
- Happy path: candidate `reason:"journal"` + matching topic page → one `reference` link.
- Edge case: candidate reason `"tag_cluster"` → no link emitted (explicitly excluded in v1).
- Edge case: no active parent page for that title → no link, no error.
- Edge case: parent page exists in a DIFFERENT `(tenant, owner)` scope → no link, no leak.
- Edge case: leaf page not in `affectedPagesById` → no link.
- Edge case: Flag `WIKI_DETERMINISTIC_LINKING_ENABLED=false` → no links written regardless of candidate.
- Edge case: existing `reference` link with different context already present → `onConflictDoNothing()` keeps the original row (idempotency proof).
- Error path: parent title collision (two pages same title) → emit to the first active, log warning with both ids; does not throw.
- Error path: title casing/whitespace differs (`"Paris"` vs `" paris"`) → exact match fails, no link (fuzzy is out of scope).
- Integration: full compile cycle on 5-memory batch with one `city=Paris` candidate and existing Paris topic → metrics reflect `links_written_deterministic=1`.

**Verification:**
- Unit tests pass.
- On dev smoke-compile for GiGi, at least one `reference` link with `context LIKE 'deterministic:%'` is written.
- R4 preserved: `bracket_leaks=0` still holds.

- [ ] **Unit 3: Co-mention reference linking**

**Goal:** When a memory_unit produces ≥2 resolved entity pageLinks in the same planner output, emit reciprocal `reference` edges with provenance.

**Requirements:** R1, R2, R4, R5, R6, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `packages/api/src/lib/wiki/compiler.ts` — new `emitCoMentionLinks()` call inside `applyPlan()`, after planner resolution.
- Modify: `packages/api/src/lib/wiki/deterministic-linker.ts` — add the co-mention emitter (same module for backfill reuse).
- Test: `packages/api/src/__tests__/wiki-co-mention-linker.test.ts`

**Approach:**
- Input: `wiki_section_sources` rows for the `memory_unit_ids` processed in this batch. Query joins `wiki_section_sources → wiki_page_sections → wiki_pages` so we get `(memory_unit_id, page_id, page_type)` tuples without touching the planner output. Same query powers the Unit 4 backfill.
- Group by `memory_unit_id`. For groups with ≥2 distinct `entity`-type pages, build pair-wise reciprocal edges (directed; A→B and B→A as separate rows).
- **Per-memory cap**: 10 directed edges (so max clique is 5 pages per memory_unit before truncation). Order by slug asc before truncating so backfill and live compile produce identical edges.
- **Type gate**: both endpoints must be `entity`. Topic↔entity and decision↔entity remain LLM / aggregation-planner territory; co-mention is entity↔entity evidence only.
- **No ≥2-memory frequency gate in v1** (see Key Technical Decisions). Precision is bounded by the type gate, the 10-edge cap, and `context`-based rollback.
- Emit `context = "co_mention:{memory_unit_id}"` so every row is traceable to its source memory.
- Behind the same `WIKI_DETERMINISTIC_LINKING_ENABLED` flag.

**Patterns to follow:** Mirror Unit 2's function shape.

**Test scenarios:**
- Happy path: one memory_unit sourced 2 entity pages (A, B) → 2 reciprocal rows (A→B, B→A) with `context="co_mention:<memory_unit_id>"`.
- Happy path: one memory_unit sourced 3 entity pages → 6 directed reference rows (3×2 pairs).
- Edge case: one memory_unit sourced 6 entities → 30 pairs truncated to 10 edges (5-page clique). Assert exact selection (slug asc).
- Edge case: memory_unit sourced only 1 entity → 0 rows.
- Edge case: memory_unit sourced 0 entity pages (all topic/decision) → 0 rows.
- Edge case: memory_unit sourced 1 entity + 1 topic → 0 rows (topic endpoint filtered out, leaving <2 entities).
- Edge case: memory_unit sourced same page via multiple sections → dedup by `page_id` before pair building.
- Edge case: same pair already present via planner output or deterministic path → `onConflictDoNothing()` preserves original row.
- Edge case: flag `WIKI_DETERMINISTIC_LINKING_ENABLED=false` → no rows written regardless of input.
- Integration: full compile on a batch where one memory is sourced on both "Harmon Guest House" (entity) and "Sonoma" (topic) pages → 0 co-mention rows (type gate filters the topic, leaving <2 entities).
- Integration: full compile on a batch where one memory is sourced on two entity pages → 2 reference rows after the compile.

**Verification:**
- Unit tests pass.
- Dev smoke: at least 10 co-mention rows written on GiGi batch of 100 memories.
- R4: no new `[[brackets]]` produced (co-mention is repo-level, doesn't touch body_md).
- R7: compile latency within 15% of baseline.

- [ ] **Unit 4: One-off densification backfill**

**Goal:** Apply Units 2 + 3 to the existing corpus of pages + memory_units without re-running the LLM compile.

**Requirements:** R1, R2, R3, R6

**Dependencies:** Units 2, 3

**Files:**
- Create: `packages/api/scripts/wiki-link-backfill.ts`
- Test: `packages/api/src/__tests__/wiki-link-backfill.test.ts` — runs against a scoped fixture.

**Approach:**
- Accept `--tenant`, `--owner`, `--dry-run` flags (mandatory scope, matches `wiki-wipe-and-rebuild.ts`).
- Phase A (deterministic parents): walk `wiki_pages` in the scope, join to `wiki_section_sources → hindsight.memory_units` to rebuild the metadata, feed into `deriveParentCandidates()`, pass the result to `emitDeterministicParentLinks()` with a simulated `affectedPagesById` covering all pages.
- Phase B (co-mention): call `emitCoMentionLinks()` with the full list of `memory_unit_id`s in scope. Same function the live path uses — since it already reads `wiki_section_sources`, no synthetic plan shape is needed.
- Log per-agent: candidates examined, edges written, edges skipped by gate. Dry-run only prints the plan.
- Idempotent via `onConflictDoNothing()`. Safe to re-run.

**Patterns to follow:** `packages/api/scripts/wiki-wipe-and-rebuild.ts` for arg parsing + scope safety, `packages/api/scripts/journal-import-resume.ts` for long-running batch pacing (progress every N records).

**Test scenarios:**
- Happy path: fixture with 5 restaurants sharing `city=Paris` and an existing Paris topic → 5 deterministic parent links written.
- Happy path: fixture with 3 memory_units each referencing 2 entities → 6 co-mention links written.
- Idempotency: re-run on same fixture → 0 new rows, 0 errors.
- Edge case: `--dry-run` flag → no writes, full plan logged.
- Edge case: `--tenant` / `--owner` mismatch → refuses to run, clear error.
- Edge case: an agent whose bank has no memory_units → exits cleanly with 0 written.
- Integration: on dev copy, running backfill for GiGi moves unlinked-page rate from 54% to ≤20% (R1).
- Integration: R3 — combined `parent_of`+`child_of` pair count unchanged by this script (backfill only writes `reference`).

**Verification:**
- Dry-run on GiGi reports expected candidate counts.
- Wet-run for Marco + GiGi moves the baseline reporter into R1/R2 green.
- Re-running the script reports "0 new rows" for both agents.

- [ ] **Unit 5: Metrics + kill-switch wiring**

**Goal:** Make the densification observable and reversible without a revert.

**Requirements:** R5, R6

**Dependencies:** Units 2, 3, 4

**Files:**
- Modify: `terraform/modules/app/lambda-api/main.tf` (or wherever `WIKI_AGGREGATION_PASS_ENABLED` lives — same pattern).
- Modify: `packages/api/src/lib/memory/config.ts` (or the wiki-specific config if separate) — parse `WIKI_DETERMINISTIC_LINKING_ENABLED` with default `true`.
- Modify: `packages/api/src/lib/wiki/compiler.ts` — emit the three new metrics keys on every compile regardless of flag state.
- Modify: `packages/api/scripts/wiki-link-density-baseline.ts` — extend reporter to include the new metrics rollups.
- Test: extend `wiki-link-density-baseline.test.ts`.

**Approach:**
- Compute `duplicate_candidates_count` per-compile as: number of (title, owner_id) groups in `wiki_pages` with >1 active row. This is the R5 canary.
- On every compile, log metrics including the new keys so CloudWatch has the series.
- Flag-off path: emit `links_written_deterministic=0` and `links_written_co_mention=0`, log `flag_suppressed=true` once per job.
- Add a `grafana-ish` summary query to `docs/metrics/wiki-link-density.md` so operators can reproduce the dashboard from SQL.

**Patterns to follow:** `WIKI_AGGREGATION_PASS_ENABLED` terraform lifecycle — this was the bug PR #272 fixed (env vars got reset on deploy). Pin the new flag the same way.

**Test scenarios:**
- Happy path: flag on → metrics increment correctly across a batch with candidates.
- Happy path: flag off → metrics are zero, `flag_suppressed=true` recorded.
- Edge case: duplicate_candidates baseline is 0 on a clean fixture.
- Edge case: intentionally seed two pages with same title + same owner → duplicate_candidates == 1, docs/metrics query surfaces them.
- Integration: Lambda config output in terraform plan includes both `WIKI_DETERMINISTIC_LINKING_ENABLED` and `WIKI_AGGREGATION_PASS_ENABLED` after merge.

**Verification:**
- Toggling the flag on dev swaps emission on/off on the next compile.
- `duplicate_candidates_count` baseline captured for Marco + GiGi pre-Unit 4.
- Compile metrics dashboard query returns the three new series.

## System-Wide Impact

- **Interaction graph:** `applyPlan()` now has two additional emit calls after planner link resolution. Both short-circuit under the flag, both use the existing `upsertPageLink()` write path. No change to aggregation pass, no change to `setParentPage()`.
- **Error propagation:** Both emitters swallow per-candidate errors (log + skip) rather than fail the compile — same tolerance the existing link-emission loop uses.
- **State lifecycle risks:** Backfill writes against the same unique index the live path uses, so mid-run concurrent compile is safe. Backfill running **during** a live compile can temporarily double-count metrics; acceptable because the job-level metric sums correctly regardless.
- **API surface parity:** No GraphQL / mobile / admin contract changes. Graph viewer reads `wiki_page_links` via the existing resolver and will simply see more edges.
- **Integration coverage:** Both emitters get integration tests on a realistic fixture (fixture-level Postgres + in-memory Hindsight stub). Unit tests alone would miss the resolver + upsert interaction.
- **Unchanged invariants:** `setParentPage()` continues to be the sole emitter of `parent_of`/`child_of`. `linkifyKnownEntities()` continues to only format body_md. `bracket_leaks=0`. Scope isolation `(tenant_id, owner_id)` preserved.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Deterministic emission creates wrong `reference` links when two agents independently have a "Paris" topic (doesn't happen today — scope isolation) | Each lookup is scoped by `(tenant_id, owner_id)`; unit test asserts cross-scope leakage is impossible. |
| Co-mention explosion when planner emits 20 pageLinks for a single memory_unit | Per-memory cap of 10 directed edges, deterministic ordering for truncation repeatability. |
| Title case mismatch (`Paris` vs `paris, france`) causes low recall | Accepted for v1 — fuzzy match is `docs/plans/2026-04-19-002` scope. Measurable via baseline reporter: if R1 not met on exact-match alone, escalate to that plan rather than adding fuzzy here. |
| Backfill writes the same rows live compile would write, duplicate work | No — unique index makes the intersection a no-op. |
| `duplicate_candidates_count` rises (false-positive hubs) | R5 gate in the acceptance check. If exceeded, flip the flag off, revert via SQL `DELETE … WHERE context LIKE 'deterministic:%'` — clean rollback because `context` tags provenance. |
| Compile latency regression | Per-memory-unit overhead is O(candidates × log(pages)) for exact lookup; empirically <5ms extra per memory on dev. R7 gate enforced by Unit 5 metrics. |
| Hierarchical aggregation plan ships after this and needs to upgrade `reference` links to `child_of` | `context` tag makes this a single targeted UPDATE; the upgrade path is documented in the hierarchical plan as an explicit dependency hand-off. |

## Documentation / Operational Notes

- Add one entry to `docs/solutions/` capturing the diagnostic — "aggregation pass runs but section_promoted stays null, so structural links rely on `setParentPage()` which never fires." Keeps the learning discoverable.
- Update `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` with a one-line cross-reference noting this plan's deterministic linker as the upgrade target when Unit 4 of that plan lands.
- Rollout: ship Units 1-3 together (no behavior change until flag on), flip the flag on dev, run Unit 4 backfill once, observe R1/R2/R3/R5 for 24h, then flip the flag on staging/prod.
- Kill-switch: `WIKI_DETERMINISTIC_LINKING_ENABLED=false` via terraform (not `aws lambda update-function-configuration` per feedback memory `graphql_deploy_via_pr`).

## Sources & References

- **Origin document:** [`docs/plans/2026-04-20-013-handoff-mobile-graph-densification-and-dogfood.md`](2026-04-20-013-handoff-mobile-graph-densification-and-dogfood.md) (PR #284 — queued)
- **Canonical long-term plan:** [`docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`](2026-04-19-002-feat-hierarchical-aggregation-plan.md)
- **Requirements origin:** [`docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md`](../docs/brainstorms/2026-04-19-compounding-memory-hierarchical-aggregation-requirements.md)
- **Research memo (archived):** [`docs/plans/archived/compounding-memory-aggregation-research-memo.md`](archived/compounding-memory-aggregation-research-memo.md)
- **No-stub-page regression precedent:** [`docs/plans/archived/wiki-compiler-memory-layer.md`](archived/wiki-compiler-memory-layer.md)
- **Code surfaces:** `packages/api/src/lib/wiki/{compiler,repository,parent-expander,aliases}.ts`, `packages/database-pg/src/schema/wiki.ts`
- **Related PRs:** #264 (linkify body), #272 (env-var terraform pinning), #275 (journal-import-resume script)
- **Diagnostic queries + pre-change measurements:** inline in Problem Frame above, investigation run 2026-04-20
