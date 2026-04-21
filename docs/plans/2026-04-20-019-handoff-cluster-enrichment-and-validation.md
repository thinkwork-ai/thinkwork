---
title: "Handoff: cluster enrichment + wikiBacklinks dedup + post-#318 validation"
type: handoff
status: open
date: 2026-04-20
parent_plan: docs/plans/2026-04-20-018-handoff-cluster-enrichment-and-followups.md
related:
  - docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md
  - docs/solutions/best-practices/probe-every-pipeline-stage-before-tuning-2026-04-20.md
---

# Handoff: cluster enrichment + wikiBacklinks dedup + post-#318 validation

## Read this first

The 2026-04-20 third session closed out handoff items **#3** (summary-expander → deterministic linker wiring) and **#4.1** (dotted-abbreviation extractor fix) via PR #318. Supersedes `docs/plans/2026-04-20-018-handoff-cluster-enrichment-and-followups.md`.

### What shipped (session total: 6 PRs)

| PR | What | Impact |
|---|---|---|
| #309 | Bedrock retry wrapper (`invokeClaudeJson` + `invokeClaudeWithRetry`, exp-backoff, typed `BedrockRetryExhaustedError`) | Bootstrap chains survive ~15% flake rate |
| #311 | Deterministic parent-link recovery (European extractor + accent regex + threshold + geo-suffix gate) | Marco +14 net parent links on backfill |
| #312 | Mobile read surfaces (6 new `WikiPage` field resolvers + mobile UI) | Validated end-to-end on iOS sim |
| #316 | Handoff doc refresh | Discoverable via `docs/plans/` grep |
| #317 | Compound learnings (audit methodology + JS `\b` gotcha) | Future-session reference |
| #318 | Summary-expander → linker + dotted-abbreviation fix | Marco "Gto." → "San Miguel De Allende" (support=32); live-compile jump pending validation |

### Dev state pointers (unchanged unless noted)

- **Tenant (Eric)**: `0015953e-aa13-4cab-8398-2e70f73dda63`
- **Marco**: `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c` → bank `fleet-caterpillar-456` (386 reference links after #318 backfill; was 350 at start of session)
- **GiGi (not rebuilt this session)**: `b6b241d5-c523-4b33-9de0-c495e1991a0d`
- **Dev RDS**: `thinkwork-dev-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com`, secret `thinkwork-dev-db-credentials`, DB `thinkwork`
- **SSL**: tsx scripts need `sslmode=no-verify`; `psql` uses `sslmode=require`
- **Re-runnable tooling**:
  - `packages/api/scripts/wiki-parent-link-audit.ts` — full pipeline audit
  - `packages/api/scripts/wiki-record-expander-probe.ts` — record-based expander output
  - `packages/api/scripts/wiki-link-backfill.ts` — backfill parent + co-mention links

---

## #1 — Validate #318 live-compile wiring on Marco (TOP PRIORITY)

### Why this matters

PR #318 claims the next Marco recompile should show `links_written_deterministic` jump from ~14/batch to **+30-60** because the summary-expander is now wired into the live compile path (not just the backfill). This is a **testable prediction** — if the number doesn't move, the wiring has a bug unit tests missed.

Validating this first protects the rest of the handoff: if #318 is broken, everything built on top of it compounds the error.

### Scope (small — single session start)

1. **Trigger a scoped recompile on Marco** with a small deliberate change to force new batch records:
   - Option A (safest): insert a marker record into Hindsight for Marco, then enqueue `trigger='manual'` compile job. Marker should have a `place_address` that resolves to Toronto (e.g., `"200 Yonge St, Toronto, ON M5B 0C1, Canada"`) so the city candidate fires through both expanders.
   - Option B (cheaper): enqueue a `trigger='manual'` job without new records. The compiler will still scan candidatePages via the summary-expander; even without record-based candidates, the summary-based path should fire.
2. **Check CloudWatch logs** for the compile job:
   - `[deterministic-linker] fuzzy parent match: ...` — should appear more than record-only runs
   - `[deterministic-linker] fuzzy parent rejected (no geo suffix): ...` — precision gate working
3. **Query `wiki_compile_jobs.metrics.links_written_deterministic`** on the resulting row. Expect > 30 if the batch is large enough, or > 0 if it's a small batch. Any 0 is a **red flag** — wiring isn't reaching summary candidates.
4. **Spot-check 10 parent-leaf pairs** in `wiki_page_links` with `context LIKE 'deterministic:city:%'` created after the recompile. Confirm none are false positives (Toronto Life, Austin Reggae Fest).

### Exit criteria

One Marco compile job post-#318 emits `links_written_deterministic > 0` with summary-based candidates visibly firing in logs, all 10 spot-checked pairs precision-correct.

### Files

Read-only — this is validation, not code. If a bug surfaces, cut a fix PR citing the specific symptom.

### Execution note

If you trigger a manual compile job, it runs via the `thinkwork-dev-api-wiki-compile` Lambda. Payload pattern from prior sessions: `{"jobId":"<uuid>"}`. Insert into `wiki_compile_jobs` with unique `dedupe_key` then `aws lambda invoke --invocation-type Event`.

---

## #2 — Unit 6 mention cluster enrichment (biggest remaining item)

Unchanged from the previous handoff — see `docs/plans/2026-04-20-018-handoff-cluster-enrichment-and-followups.md` section #1 for the full scope. Summary: add `mentionClusterEnrichments[]` to the aggregation planner's output, implement cluster-as-topic-promotion gate (`mention_count ≥ 3` + `cluster_summary` + `≥ 2 agreeing canonical titles`), plumb 3 new metrics.

### One decision to surface up-front before coding

The aggregation planner's JSON schema for `mentionClusterEnrichments[]` is the biggest open design decision. Two reasonable shapes:

**Option A — planner emits per-cluster enrichment rows:**
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
Cleanest schema. Planner writes each cluster independently. Applier gate is straightforward.

**Option B — planner proposes page promotions inline:**
```json
{
  "promotions": [
    { "source": "cluster", "clusterId": "...", "newPage": { ... }, "supportingRecordIds": [...] }
  ]
}
```
Reuses the existing `promotions[]` shape but adds `source: "cluster"`. Fewer new fields, less schema churn.

**Recommend Option A.** Cleaner separation, easier to spot-check, doesn't mix "promote this existing section" (current `promotions`) with "promote this unresolved cluster" (new) in the same array. Applier then reads `mentionClusterEnrichments[]` separately and fans out to the same promotion machinery.

If you go Option A, this is a good `/ce:brainstorm` moment before `/ce:work` — 15 minutes to agree on the shape prevents a rework loop.

### Files

- Modify: `packages/api/src/lib/wiki/aggregation-planner.ts` (prompt + validator)
- Modify: `packages/api/src/lib/wiki/compiler.ts` (`applyAggregationPlan` — promotion applier)
- Modify: `packages/api/src/lib/wiki/repository.ts` (metrics interface)
- Add: `packages/api/src/__tests__/wiki-cluster-enrichment.test.ts`
- Seed fixture: pick an agent with ≥ 3 unresolved mentions in same alias family. Cruz is small; GiGi may have candidates.

### Exit criteria

`cluster_promotions_executed > 0` on a Marco or GiGi recompile after a seeded cluster is present. The new page's summary is sourced from `cluster.cluster_summary` and its aliases include `candidate_canonical_titles`.

---

## #3 — `wikiBacklinks` dedup (warm-up, <1 hour)

Unchanged from prior handoff — see `docs/plans/2026-04-20-018-handoff-cluster-enrichment-and-followups.md` section #2.

Root cause reminder: `listBacklinks` at `packages/api/src/lib/wiki/repository.ts:1496` doesn't dedup by target page id, so pages with BOTH a `reference` and `parent_of` link appear twice in REFERENCED BY on mobile (surfaces the React key-collision warning we saw on the iOS sim).

Fix: `selectDistinct` or `GROUP BY wikiPages.id`. Model on the pattern in `findMemoryUnitPageSources` at `repository.ts:723`.

Test fixture: seed two link rows for the same `(from_page_id, to_page_id)` pair, one kind=`reference`, one kind=`parent_of`. Assert `listBacklinks(to)` returns one row.

---

## #4 — Trivial grab-bag (remaining items)

### `wipeWikiScope` FK dependency

Still open. `wiki_unresolved_mentions.promoted_page_id_wiki_pages_id_fk` blocks `packages/api/scripts/wiki-wipe-and-rebuild.ts` when any mention has been promoted. Fix: null out `promoted_page_id` (or delete) inside the wipe transaction before archiving pages.

### Aggregation-applier split

Still open. `compiler.ts:applyAggregationPlan` is now 1300+ lines. Original plan (`docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` Unit 4) called for a separate `aggregation-applier.ts` module. Not a bug; just debt. **Good candidate to split as part of #2** since cluster-promotion logic will add another 100-200 lines to this function.

---

## Relevant feedback memos

Same load-bearing feedback memos as prior handoffs. Call out specifically for this session:

- `feedback_worktree_isolation.md` — always `.claude/worktrees/<name>` off `origin/main`.
- `feedback_cleanup_worktrees_when_done.md` — remove worktree + branch after merge.
- `feedback_pr_target_main.md` — never `gh pr create --base feat/…`.
- `feedback_verify_wire_format_empirically.md` — **especially relevant for #1** (validate #318 live path, don't trust unit tests alone for pipeline wiring).
- `feedback_graphql_deploy_via_pr.md` — graphql-http Lambda deploys via PR merge only.

## Starting command

```text
/ce:work docs/plans/2026-04-20-019-handoff-cluster-enrichment-and-validation.md
```

### Recommended order

1. **#1 first** — validates that #318 actually shipped what it promised. Cheap (no new code), high-signal. If broken, fix before compounding more changes on top.
2. **#3 (wikiBacklinks)** — warm-up PR after validation, small observable win.
3. **#2 (cluster enrichment)** — biggest remaining item. Tackle with a fresh session and 15-min brainstorm on the JSON shape first.
4. **#4** — grab-bag, bundle with #2 or cherry-pick.
