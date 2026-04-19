---
title: "Compounding Memory — Hierarchical Aggregation (v1 refinement)"
date: 2026-04-19
status: ready-for-planning
related-plans:
  - plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md  # superseded by this direction
canonical-sources:
  - plans/compounding-memory-hierarchical-aggregation-plan.md
  - .prds/compounding-memory-aggregation-research-memo.md
  - .prds/compounding-memory-agent-brief.md
  - .prds/compounding-memory-scoping.md
  - .prds/compounding-memory-v1-build-plan.md
---

# Compounding Memory — Hierarchical Aggregation (v1 refinement)

## Problem

The compile pipeline ships end-to-end but does not *compound*. On partial real data the observed failures are fragmentation (same concept as multiple pages), thin pages (2-3 memories cited instead of 30), and invisible compounding (memory ↔ page backlinks exist in SQL but not in UI). A first pass refinement ([plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md](../../plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md)) focused on the leaf compiler — alias fuzzy match, evidence recompile, backlink UI, metrics. Pressure-testing surfaced that those improvements are secondary: the primary missing mechanism is **hierarchical aggregation with section-to-page promotion**, already specified in [plans/compounding-memory-hierarchical-aggregation-plan.md](../../plans/compounding-memory-hierarchical-aggregation-plan.md) and diagnosed in [.prds/compounding-memory-aggregation-research-memo.md](../../.prds/compounding-memory-aggregation-research-memo.md).

This document captures the product-level decisions needed before a revised implementation plan lands.

## What "compounding" should produce

The canonical acceptance test is the Austin restaurants walkthrough:

1. **Leaves.** Each restaurant memory creates or reinforces a leaf entity page (Franklin Barbecue, Uchi, Suerte, Nixta, …).
2. **Hub section accumulation.** Those same memories also reinforce a `Restaurants` section on the `Austin` entity page. The section contains a short summary, notable patterns, and backlinks to the leaf pages.
3. **Section promotion.** Once the `Restaurants` section on Austin is dense, coherent, and persistent enough, the system promotes it to a new `Austin Restaurants` topic page. Austin's restaurants section becomes a short summary + top highlights + explicit link to the promoted page (**extract + summarize**, not **move + hollow out**).
4. **Recursive promotion.** As `Austin Restaurants` grows, its own sub-sections (Mexican, BBQ, Coffee) can promote again. `Austin Mexican Restaurants` emerges when justified.

The user should be able to open the Austin page and see a meaningful synthesis + navigable hierarchy, not a flat list of 30 leaf restaurants and nothing else.

## Core model

- **Promotion unit is a section**, not a record, not a mention, not a raw link count.
- A single memory can simultaneously (a) update a leaf page, (b) reinforce a parent-page section, (c) feed an unresolved mention cluster, (d) trigger a promotion check.
- **Promotion requires multiple signals aligned** — linked child pages, supporting record count, temporal spread, coherence, persistence. Not a single-threshold trigger.
- **Deterministic parent expansion happens before the LLM** — `journal_id` → candidate trip topic, `place.city` → candidate city page, recurring `place_types=restaurant` under a city → candidate restaurants collection. The model does not rediscover containment every batch.
- **Tags are processor hints**, not ontology law. Lightweight, tenant-definable, influence candidate selection and promotion confidence; never force a page into existence.
- **Hub entities** (Austin, Mexico, Paris) are a behavior mode on top of the existing `entity` type — they accumulate sections and sponsor promotions. The v1 page taxonomy (`entity`, `topic`, `decision`) does not grow.
- **Hysteresis**: once a section promotes, it stays promoted. No flapping.

## v1 scope

### In scope

- **Section aggregation metadata** on `wiki_page_sections`: linked child pages, supporting record count, first/last seen, observed tags, promotion status, promotion candidate score, parent page link.
- **Parent-section updates** on every compile: a memory that reinforces a leaf also reinforces the parent-page section for that leaf's containing entity (city, trip, category).
- **Deterministic parent expansion** before planner call: inject candidate parent pages from journal/place/tag metadata so the LLM sees them in context.
- **Promotion scoring and promotion pass**: evaluate sections after each compile; promote when the multi-signal rule trips; leave an extract+summary on the parent; create the child page with seeded sub-sections when clear sub-grouping exists.
- **Mention clusters** (evidence-backed): upgrade unresolved mentions to carry representative contexts, top supporting records, co-mentioned entities, candidate parents, candidate canonical titles, ambiguity notes. Promotion produces a real aggregate page, not a bare leaf.
- **Parent ↔ child page relationships**: first-class, navigable in both directions (breadcrumb up from child, pointer section down from parent).
- **Lightweight tag hints**: tenant-definable, influence candidate selection and cluster scoring. No ontology lock-in.
- **Backlink visibility** (from the superseded plan, still required): memory record surfaces "Contributes to: [page list]"; pages surface "Based on N memories" with drill-in.
- **Health metrics** for compounding signal quality: hub scores, promotion rate, section density, duplicate-candidate count.

### Explicit non-goals for v1

- No new formal page types. Hierarchy emerges from links, parent/child, and section promotion; the taxonomy stays `entity | topic | decision`.
- No embeddings layer. `body_embedding` stays NULL in v1 per the scoping doc.
- No cross-agent aggregation. Strictly agent-scoped per [`.prds/compounding-memory-scoping.md`](../../.prds/compounding-memory-scoping.md). Every new table or field carries `(tenant_id, owner_id)`.
- No tenant-shared hub pages. An "Austin" page for GiGi is not visible to any other agent's scope.
- No manual page editing UI. Compounding is programmatic only in v1.
- No automatic merge of already-promoted pages. Merging is an operator-driven follow-up.
- No full-page rewrites. Section-level writes only, same as v1 build plan.
- No rethink of the Hindsight retain path.
- No ontology imposed via tags. Tags remain soft hints.

### Deferred to separate tasks

- Operator UI for reviewing promotion candidates, merges, or duplicates.
- Cross-agent, team, or tenant-scoped hubs (explicit future scope model, not v1).
- Replacing `pg_trgm` with embedding similarity once trigram precision proves insufficient.
- Production rollout + CloudWatch alarms; lands alongside or after v1 bootstrap validation.
- Full Amy → GiGi bootstrap quality review (all 2,829 records, human-eyed); smoke-run on 100–200 records is part of v1 acceptance.

## Acceptance criteria

The refined pipeline is working when all of the following are true on the Amy → GiGi smoke run (100–200 records):

1. **Leaf pages exist** for the obvious concrete entities (restaurants, venues, places) without fragmentation across surface-form variants (Austin / Austin, TX / ATX collapse to one).
2. **At least one hub page has a populated aggregation section** with ≥ 5 backlinked child pages and a summary grounded in those children.
3. **At least one section promotion has occurred** on the data (e.g., `Austin.restaurants` → `Austin Restaurants` page) *if* the data supports it. If the smoke run's data density does not support a promotion, the promotion scoring must still be observable and defensible: the health metrics show which sections are approaching threshold.
4. **Promoted parent section is a summary + pointer**, not hollowed out. Readable on its own.
5. **Memory → page backlinks are visible in the mobile UI**: "Contributes to:" on memory detail, "Based on N memories" on page detail.
6. **Duplicate-candidate metric trends to zero** across a replay on the same data (i.e., repeated compiles do not produce duplicates of the same concept).
7. **Scope isolation holds**: a second agent in the same tenant sees zero overlap in pages, sections, or mentions.
8. **Bootstrap-scale compile completes without manual re-trigger** on a 200-record smoke run (continuation chaining works).
9. **Aggregation pass is observable** as its own metrics slice (pages updated as parents, promotion candidates scored, promotions executed) — distinct from leaf compilation.

## Resolved product decisions

- **Hierarchical aggregation is v1, not v2.** Ships in the same agent-scoped window as the current build plan, before broader rollout.
- **Page taxonomy does not grow.** Hub behavior is a mode on existing `entity` / `topic` types.
- **Promotion is multi-signal, not single-threshold.** At minimum: linked child count, supporting record count, temporal spread, coherence/persistence. Exact numbers are tuning parameters for planning.
- **Parent keeps a summary on promotion.** "Extract + summarize" behavior is the mandatory shape.
- **Tags are soft hints only.** Tenant-definable, optional, never load-bearing on correctness.
- **Deterministic rollups run before the LLM.** The model sees candidate parents in its context, rather than rediscovering them.
- **Earlier refinement plan is superseded.** [plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md](../../plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md) is archived as a direction note; its useful sub-elements (alias fuzzy matching, continuation chaining, backlink UI, health metrics) are folded into the replacement plan rather than dropped.

## Open questions for planning

These are the technical and sequencing decisions that belong in `/ce:plan`, not here:

- **Promotion score function**: weights for linked-child count, supporting-record count, temporal spread, coherence, persistence. Start simple; tune from the smoke run.
- **Initial promotion thresholds**: placeholder numbers per the hierarchical-aggregation plan (linked pages ≥ 20, supporting records ≥ 30, temporal spread ≥ 30 days). Final numbers wait on real data.
- **Section aggregation metadata shape**: new fields on `wiki_page_sections` vs a sidecar table; how promotion status is represented.
- **Parent ↔ child schema**: explicit `parent_page_id` column vs encoding it purely in `wiki_page_links` with a relationship kind.
- **Mention cluster representation**: extension of `wiki_unresolved_mentions` vs a new `wiki_mention_clusters` table.
- **Where deterministic parent expansion runs**: in the adapter, in the compiler pre-planner step, or in a dedicated module.
- **Aggregation pass placement**: inline after per-batch apply, at end of compile job, or on a nightly schedule (or all three).
- **Hub scoring**: how inbound-link-density / distinct-children / temporal-spread combine into a single score for hub detection.
- **Coherence signal**: cheap heuristic (shared tags, shared metadata) in v1; LLM-scored coherence later.
- **How to fold the superseded plan's sub-elements** (fuzzy aliases, continuation chaining, backlink UI, metrics) cleanly under the aggregation pass without duplicating work.

## References

- **Primary architectural source:** [plans/compounding-memory-hierarchical-aggregation-plan.md](../../plans/compounding-memory-hierarchical-aggregation-plan.md) — canonical specification for the aggregation model, promotion signals, and recommended compiler behavior changes.
- **Diagnosis and root causes:** [.prds/compounding-memory-aggregation-research-memo.md](../../.prds/compounding-memory-aggregation-research-memo.md) — why the current pipeline under-aggregates and what muscles are missing.
- **Product framing:** [.prds/compounding-memory-agent-brief.md](../../.prds/compounding-memory-agent-brief.md) — what Compounding Memory is and what it should produce.
- **Scope rule (non-negotiable):** [.prds/compounding-memory-scoping.md](../../.prds/compounding-memory-scoping.md) — strict agent-scoping for every compiled object in v1.
- **Existing build plan to extend:** [.prds/compounding-memory-v1-build-plan.md](../../.prds/compounding-memory-v1-build-plan.md) — the phased PR sequence this work sits alongside.
- **Pipeline logic source of truth:** [.prds/thinkwork-memory-compounding-pipeline-deep-dive.md](../../.prds/thinkwork-memory-compounding-pipeline-deep-dive.md) — planner contract, section-patch strategy, unresolved-mention lifecycle.
- **Engineering architecture:** [.prds/compiled-memory-layer-engineering-prd.md](../../.prds/compiled-memory-layer-engineering-prd.md) — compiled layer schema intent and provenance model.
- **Superseded prior direction:** [plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md](../../plans/2026-04-19-001-feat-compounding-memory-refinement-plan.md) — first-pass leaf-compiler refinement. Useful sub-elements (alias fuzzy matching, backlink UI, continuation chaining, health metrics) are absorbed into the replacement plan, not discarded.
