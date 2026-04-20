---
title: "Handoff: Unit 6 mention cluster enrichment + applier split (fresh session)"
type: handoff
status: open
date: 2026-04-20
parent_plan: plans/2026-04-20-007-handoff-cluster-enrichment-and-validation.md
related:
  - plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md
  - docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md
---

# Handoff: Unit 6 mention cluster enrichment + applier split (fresh session)

## Read this first

The 2026-04-20 fourth session closed out handoff items **#1** (validated #318 live-compile wiring on Marco) and **#3** (`wikiBacklinks` dedup). Supersedes `plans/2026-04-20-007-handoff-cluster-enrichment-and-validation.md`. Starting a **fresh session** for Unit 6 is recommended — it's the biggest remaining plan item and benefits from a cold context + a 15-min `/ce:brainstorm` before writing code.

### What shipped across the 2026-04-20 sessions (8 PRs total)

| PR | What |
|---|---|
| #309 | Bedrock retry wrapper |
| #311 | Deterministic parent-link recovery (European extractor + accent regex + threshold + geo-suffix gate) |
| #312 | Mobile read surfaces (6 new `WikiPage` field resolvers + mobile UI) |
| #316 | Handoff doc refresh (007 predecessor) |
| #317 | Compound learnings (audit methodology + JS `\b` gotcha) |
| #318 | Summary-expander → linker + dotted-abbreviation fix |
| #319 | Handoff doc 007 |
| #320 | `wikiBacklinks` source-page dedup |

### #318 live-compile validation (completed 2026-04-20 late session)

Triggered a manual compile on Marco post-deploy. Results:

- `links_written_deterministic = 18` (was 0 on pre-#318 jobs → **wiring confirmed firing**)
- CloudWatch showed summary-based candidates firing: `[deterministic-linker] fuzzy parent match: "Austin" ≈ "Austin, Texas" (sim=0.538)` accepted, `"Toronto" ≈ "Toronto Life" (sim=0.615)` rejected by geo-suffix gate, `"Muskoka" ≈ "Muskoka Brewery" (sim=0.500)` rejected
- All 13 pre-existing `deterministic:city:*` link rows in Marco's DB spot-checked precision-correct (Paris×9 restaurants, Austin, Texas×2, Zilker Park×2). Zero false positives.
- The 18 compile-job writes were idempotent against those 13 existing rows — wiring semantically correct; new links would land on fresh scopes (GiGi, Cruz) or new Marco scope cohorts.

### Dev state pointers (2026-04-20 end)

- **Tenant (Eric)**: `0015953e-aa13-4cab-8398-2e70f73dda63`
- **Marco**: `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c` → bank `fleet-caterpillar-456`
- **GiGi (never rebuilt this session — the cleanest fresh-scope target for #2 cluster fixture work)**: `b6b241d5-c523-4b33-9de0-c495e1991a0d`
- **Cruz (small, untouched)**: `8bf36661-e24e-49dd-8c07-ab273abff9b5`
- **Dev RDS**: `thinkwork-dev-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com`
- **Dev DB secret**: `thinkwork-dev-db-credentials` (SecretsManager)
- **Lambda**: `thinkwork-dev-api-wiki-compile` — payload `{"jobId":"<uuid>"}` for manual triggers
- **SSL caveat**: tsx scripts need `sslmode=no-verify`; `psql` uses `sslmode=require`
- **Re-runnable tooling**:
  - `packages/api/scripts/wiki-parent-link-audit.ts`
  - `packages/api/scripts/wiki-record-expander-probe.ts`
  - `packages/api/scripts/wiki-link-backfill.ts`

---

## #1 — Unit 6 mention cluster enrichment (the main event)

### Why this matters

Mention clusters are where **"I've mentioned 'Taberna do Pescador' 4 times across 3 compiles with no matching page"** becomes **"promote to a real topic page with evidence-backed sections."** The schema slot (`wiki_unresolved_mentions.cluster jsonb`) exists; the promotion path does not.

After today's work (read surfaces in #312, summary-expander wiring in #318, backlinks dedup in #320), mobile users can now see the compounding graph. Cluster-backed topic promotion would unlock a new class of hub creation that today requires operator-driven `compileWikiNow` + LLM-planner prompting.

### Scope (per Unit 6 of `plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`)

- Extend the `cluster` jsonb to carry:
  - `supporting_record_ids: string[]`
  - `candidate_canonical_titles: string[]`
  - `cluster_summary: string | null`
  - `ambiguity_notes: string | null`

  No migration — it's already a jsonb column.
- **Aggregation planner** emits `mentionClusterEnrichments[]` when a cluster has `mention_count ≥ 3` AND `last_seen_at` within 30 days.
- **Promotion applier** accepts a cluster as a topic-page candidate when ALL:
  - `mention_count ≥ 3`
  - `cluster_summary` non-null
  - `≥ 2` candidate_canonical_titles agree (same normalized form after `slugifyTitle`)
- **New metrics** on `wiki_compile_jobs.metrics`:
  - `cluster_enrichments`
  - `cluster_promotions_executed`
  - `cluster_promotion_deferred`

### Design decision — brainstorm this first before writing code

The aggregation planner's JSON schema for `mentionClusterEnrichments[]` is the biggest open design decision.

**Option A (recommended) — separate enrichment rows:**
```json
{
  "mentionClusterEnrichments": [
    {
      "clusterId": "unresolved-mention-id-from-wiki_unresolved_mentions",
      "candidateCanonicalTitles": ["Taberna do Pescador", "Taberna Do Pescador (Lisbon)"],
      "clusterSummary": "A Portuguese seafood restaurant in Lisbon's Alfama district...",
      "ambiguityNotes": null,
      "supportingRecordIds": ["mem-uuid-1", "mem-uuid-2", "mem-uuid-3"]
    }
  ]
}
```
Cleanest separation, easier to spot-check, doesn't mix "promote existing section" (current `promotions`) with "promote unresolved cluster" (new) in the same array. Applier reads `mentionClusterEnrichments[]` separately and fans out to the shared promotion machinery.

**Option B — inline with existing `promotions[]`:**
```json
{
  "promotions": [
    { "source": "cluster", "clusterId": "...", "newPage": {...}, "supportingRecordIds": [...] }
  ]
}
```
Fewer new fields, less schema churn. But mixes two different promotion contracts behind one shape.

**Recommend Option A.** Worth a `/ce:brainstorm` to confirm before writing the planner prompt — 15 minutes up front beats a rework loop after the applier is half-built.

### Seed fixture strategy

Pick an agent with ≥ 3 unresolved mentions in the same alias family:

- **Marco** has 2260 records + 386 reference links but has already been compiled heavily — may or may not have pending unresolved-mention clusters. Query `wiki_unresolved_mentions WHERE owner_id=…` first.
- **Cruz** is small (`8bf36661-e24e-49dd-8c07-ab273abff9b5`) — fast to seed, predictable outputs.
- **GiGi** (`b6b241d5-c523-4b33-9de0-c495e1991a0d`) hasn't been rebuilt in this session — cleanest fresh-scope target, would also get a free validation of the #318 live-compile wiring boost on Toronto/Seattle/Honolulu hubs.

Suggested approach: seed 3–4 fake `wiki_unresolved_mentions` rows on Cruz with intentionally-similar aliases (`"Taberna do Pescador"`, `"Taberna Do Pescador (Lisbon)"`, `"taberna do pescador"`) and a `last_seen_at` within 30 days. Trigger compile. Verify `cluster_promotions_executed > 0` + the new page's summary sourced from `cluster.cluster_summary`.

### Exit criteria

- `cluster_promotions_executed > 0` on a seeded scope recompile
- New page's `summary` is sourced from `cluster.cluster_summary`
- New page's aliases include every `candidate_canonical_title` the planner emitted
- Negative-fixture test: 2 mentions (below threshold) → `cluster_promotion_deferred += 1`, no page created

### Files to touch

- Modify: `packages/api/src/lib/wiki/aggregation-planner.ts` (prompt additions + validator)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (`applyAggregationPlan` — new cluster branch)
- Modify: `packages/api/src/lib/wiki/repository.ts` (cluster interface type + 3 new metric fields on `RunJobResult.metrics`)
- Add: `packages/api/src/__tests__/wiki-cluster-enrichment.test.ts` — unit test fixtures covering happy path, 3 gate-failure paths (below threshold, null summary, < 2 titles agreeing), and the new metrics
- Optional: `packages/api/scripts/wiki-cluster-seed.ts` — reusable fixture-seeder tsx script (follow `wiki-parent-link-audit.ts` shape). Committed so the next operator can re-seed against GiGi/Cruz without rebuilding intuition.

### Patterns to follow

- `packages/api/src/lib/wiki/aggregation-planner.ts` — planner-emits-new-fields shape, validator pattern
- `packages/api/src/lib/wiki/compiler.ts::applyAggregationPlan` section-promotion branch — closest analog for "applier takes a planner-emitted row and writes a new page"
- `packages/api/src/lib/wiki/promotion-scorer.ts` — precedent for multi-signal gate before promoting
- The `fuzzy_dedupe_merges` metric at `repository.ts` — pattern for metric declaration + initialization in `emptyMetrics()`

### Execution note

`applyAggregationPlan` is **1300+ lines** in `compiler.ts`. Original aggregation plan (`plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` Unit 4) called for a separate `aggregation-applier.ts` module. **Strong candidate to split as PART OF this PR** since cluster-promotion logic would add another 100–200 lines to the already-oversized function. See #2 below.

---

## #2 — Aggregation-applier module split (bundle with #1)

### Why bundle

`applyAggregationPlan` is 1300+ lines. Unit 6 adds another 100–200. Post-unit-6 it'd be 1500+ and near-impossible to reason about or safely modify. Better to split BEFORE adding.

### Scope

- Create `packages/api/src/lib/wiki/aggregation-applier.ts`
- Move `applyAggregationPlan` + its private helpers (`applyParentSectionUpdates`, `applyAggregationPageLinks`, `applySectionPromotions`, `applyNewPages` from the aggregation branch, etc.) into the new module
- Keep compile orchestration (budget checks, metric accumulation, cap-hit returns) in `compiler.ts::runCompileJob` — only the applier body moves
- Add `applyMentionClusterEnrichments` as a NEW named function in the new module (this is where the Unit 6 cluster-promotion body lives)

### Execution note

This is **pure refactor** — move code without behavior change. Run the full test suite after the split to confirm no regressions. Then add the cluster-enrichment logic as a new function, with its own tests, without touching the rest of the module.

Two-commit PR shape:
1. `refactor(wiki): extract aggregation-applier.ts from compiler.ts` — pure move
2. `feat(wiki): mention cluster enrichment + cluster-aware promotion` — new logic in the extracted module

Commits bundled in one PR land together (avoiding a "broken state" intermediate on main), but the first commit is reviewable as a mechanical extraction.

---

## #3 — `wipeWikiScope` FK dependency (deferrable, ~30 min)

Still open. `wiki_unresolved_mentions.promoted_page_id_wiki_pages_id_fk` blocks `packages/api/scripts/wiki-wipe-and-rebuild.ts` when any mention has been promoted. Workaround during today's sessions was `DELETE FROM wiki_unresolved_mentions WHERE owner_id=X` before the wipe.

**Fix**: null out `promoted_page_id` (or delete the mentions) inside `wipeWikiScope`'s transaction before archiving pages. Same transaction boundaries as the existing wipe.

**Why deferrable**: not blocking any PR, surfaces only during destructive ops. Ship as a standalone cleanup when convenient. Sibling PR to #1/#2 if they touch the same area.

---

## Relevant feedback memos

- `feedback_worktree_isolation.md` — always `.claude/worktrees/<name>` off `origin/main`.
- `feedback_cleanup_worktrees_when_done.md` — remove worktree + branch after merge.
- `feedback_pr_target_main.md` — never `gh pr create --base feat/…`.
- `feedback_verify_wire_format_empirically.md` — especially for #1; the planner's JSON shape must be verified against real LLM output, not trusted from a spec.
- `feedback_graphql_deploy_via_pr.md` — graphql-http Lambda deploys via PR merge only.

## Starting command

```text
/ce:work plans/2026-04-20-008-handoff-cluster-enrichment-and-applier-split.md
```

### Recommended approach

1. **`/ce:brainstorm`** on the `mentionClusterEnrichments[]` JSON shape (Option A vs B) — 15 min. Decide before writing planner code.
2. **Commit #1**: extract `aggregation-applier.ts` from `compiler.ts` — pure refactor, run full test suite to confirm no regression.
3. **Commit #2**: add `applyMentionClusterEnrichments` + planner prompt changes + the 3 new metric fields + tests.
4. **Seed fixture on Cruz** (smallest scope). Trigger compile. Verify `cluster_promotions_executed > 0` with spot-checked precision.
5. Open PR, note the fixture steps in the PR description so future re-runs are reproducible.

Stop after #1 lands merged. Leave #3 (`wipeWikiScope` FK) for a future session or pair with the next scope-wipe incident.
