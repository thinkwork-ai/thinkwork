---
title: "Handoff: mention cluster enrichment + Marco follow-ups"
type: handoff
status: open
date: 2026-04-20
parent_plan: docs/plans/2026-04-20-017-handoff-compile-reliability-and-read-surfaces.md
related:
  - docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md
---

# Handoff: mention cluster enrichment + Marco follow-ups

## Read this first

The 2026-04-20 second session closed out items #1, #2, and #3 from the prior handoff (`docs/plans/2026-04-20-017-handoff-compile-reliability-and-read-surfaces.md`). Three PRs merged in sequence:

| PR | What |
|---|---|
| #309 | Bedrock retry wrapper (`invokeClaudeJson` + `invokeClaudeWithRetry` + `BedrockRetryExhaustedError`). 3-attempt exp-backoff on transient SDK + JSON-parse failures. New `bedrock_retries` / `bedrock_retry_exhausted` metrics. |
| #311 | Deterministic parent-link recovery. `extractCityFromAddress` European-postcode fix + `extractCityFromSummary` Unicode fix + `PARENT_TITLE_FUZZY_THRESHOLD = 0.50` + geo-suffix gate. Recovered 14 net-new parent links on Marco (336 → 350), all precision-correct on spot check. Investigation script at `packages/api/scripts/wiki-parent-link-audit.ts` + record probe at `packages/api/scripts/wiki-record-expander-probe.ts`. |
| #312 | Mobile read surfaces. Six new `WikiPage` field resolvers (`sourceMemoryCount`, `sourceMemoryIds`, `parent`, `children`, `promotedFromSection`, `sectionChildren`) + the mobile UI for them. Validated end-to-end on the iOS simulator: Toronto Life shows "Based on 28 memories"; Austin Family-friendly Activities shows a PROMOTED CHILDREN section; Austin Outdoor Attractions shows a PROMOTED FROM breadcrumb; memory list cards show "Contributes to:" chips. |

**This handoff** covers one deferred plan item (Unit 6 mention cluster enrichment) plus four follow-ups surfaced during the 04-20 sessions. Each is self-contained — paste any section into a fresh session as a `/ce:work` prompt.

---

## Dev state pointers

Unchanged from the prior handoff except where noted. Kept here so this doc is self-contained.

- **Tenant (Eric)**: `0015953e-aa13-4cab-8398-2e70f73dda63`
- **Marco (rebuilt 2026-04-20, 221 active pages, 350 reference links)**: `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c` → Hindsight `bank_id = fleet-caterpillar-456`
- **GiGi (not rebuilt this session)**: `b6b241d5-c523-4b33-9de0-c495e1991a0d`
- **Cruz (small, untouched)**: `8bf36661-e24e-49dd-8c07-ab273abff9b5`
- **wiki-compile Lambda**: `thinkwork-dev-api-wiki-compile`
- **Dev RDS host**: `thinkwork-dev-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com`
- **Dev DB secret**: AWS Secrets Manager `thinkwork-dev-db-credentials`
- **Dev DB name**: `thinkwork`
- **SSL caveat**: tsx scripts need `sslmode=no-verify` in `DATABASE_URL`; `psql` uses `sslmode=require`.
- **Re-runnable audit tooling**:
  - `pnpm dlx tsx packages/api/scripts/wiki-parent-link-audit.ts --tenant … --owner …` — per-candidate exact + fuzzy distribution + threshold recall + neighbor precision
  - `pnpm dlx tsx packages/api/scripts/wiki-record-expander-probe.ts --bank <slug>` — record-based expander output against a bank

---

## #1 — Unit 6: mention cluster enrichment + cluster-aware promotion

### Why this matters

Mention clusters are where "I've mentioned 'Taberna do Pescador' 4 times across 3 compiles with no matching page" becomes "promote to a real topic page with evidence-backed sections." The schema slot (`wiki_unresolved_mentions.cluster jsonb`) exists; the promotion path does not.

After #312, mobile surfaces show "Contributes to:" chips for memories and children/parent hierarchy for pages — but cluster-backed topic pages would unlock a new hub-creation flow that today requires operator-driven `compileWikiNow` + LLM-planner prompting.

### Scope (per Unit 6 of `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`)

- Extend the `cluster` jsonb to carry:
  - `supporting_record_ids: string[]`
  - `candidate_canonical_titles: string[]`
  - `cluster_summary: string | null`
  - `ambiguity_notes: string | null`
  No migration — it's already a jsonb column.
- **Aggregation planner** emits `mentionClusterEnrichments[]` when a cluster has `≥ 3 entries` AND `last_seen_at` is within 30 days. Output shape lives next to `sectionPromotions` in the planner JSON schema.
- **Promotion applier** accepts a cluster as a topic-page candidate when ALL of:
  - `mention_count ≥ 3`
  - `cluster_summary` non-null
  - `≥ 2 candidate_canonical_titles` agree (same normalized form after `slugifyTitle`)
- **New metrics** on `wiki_compile_jobs.metrics`:
  - `cluster_enrichments` — planner emitted an enrichment this run
  - `cluster_promotions_executed` — applier turned one into a topic page
  - `cluster_promotion_deferred` — gate failed (so operators see why)

### Test plan

- Seed a fixture: 3 `wiki_unresolved_mentions` rows with aliases `"Taberna do Pescador" / "taberna pescador" / "Taberna do Pescador (Lisbon)"` all sharing a recent `last_seen_at`. Run a compile, expect one new topic page `Taberna do Pescador` with summary derived from `cluster_summary`.
- Seed a negative fixture: 3 mentions but `cluster_summary = null`. Expect `cluster_promotion_deferred += 1` and no page created.
- Seed a negative fixture: 2 mentions (below threshold). Expect no enrichment emission.

### Exit criteria

`cluster_promotions_executed > 0` on a Marco recompile after seeding a plausible cluster, with the new page's summary sourced from `cluster.cluster_summary` and its aliases populated from `candidate_canonical_titles`.

### Patterns to follow

- `packages/api/src/lib/wiki/aggregation-planner.ts` — existing planner-emits-new-fields shape.
- `packages/api/src/lib/wiki/compiler.ts` `applyAggregationPlan` section-promotion branch — the closest analog for "applier takes a planner-emitted row and writes a new page."
- `packages/api/src/lib/wiki/promotion-scorer.ts` — precedent for "multi-signal gate before promoting."

### Files

- Modify: `packages/api/src/lib/wiki/aggregation-planner.ts`
- Modify: `packages/api/src/lib/wiki/compiler.ts` (`applyAggregationPlan`)
- Modify: `packages/api/src/lib/wiki/repository.ts` (metrics declarations)
- Add: `packages/api/src/__tests__/wiki-cluster-enrichment.test.ts`

### Execution note

Best tackled in a single session with a real fixture (pick an agent with ≥ 3 unresolved mentions in the same alias family). `/ce:plan` first if the planner prompt shape for `mentionClusterEnrichments` isn't obvious — it's the biggest open design decision.

---

## #2 — `wikiBacklinks` dedup follow-up (small, good warm-up)

### Why this matters

Surfaced while validating #312 on the iOS simulator. On the "Austin Outdoor Attractions" detail screen, the REFERENCED BY section listed `"Austin Family-friendly Activities"` twice, and React logged `Encountered two children with the same key add236ce-…`. Root cause:

- `wiki_page_links` has both a `reference` row AND a `parent_of` row from parent → child for promoted pairs.
- `listBacklinks` in `packages/api/src/lib/wiki/repository.ts:1496` does `SELECT … FROM wikiPageLinks JOIN wikiPages ON from_page_id = id WHERE to_page_id = pageId` — no `DISTINCT`.
- `listConnectedPages` (sibling function) already dedups on target; `listBacklinks` didn't get the same treatment.

### Fix

Add `selectDistinct` (or a `GROUP BY wikiPages.id`) to `listBacklinks`. Same-shape PR as the `findMemoryUnitPageSources` use of `selectDistinct` at `repository.ts:723`.

### Verification

- Recompile or refresh the Austin Outdoor Attractions detail screen on mobile; "REFERENCED BY" should show `"Austin Family-friendly Activities"` exactly once.
- Unit test: seed two link rows (one `reference`, one `parent_of`) with the same `(from_page_id, to_page_id)`; assert `listBacklinks(to)` returns one row.

### Files

- Modify: `packages/api/src/lib/wiki/repository.ts` (`listBacklinks`)
- Add: `packages/api/src/__tests__/wiki-repository-backlinks.test.ts`

---

## #3 — Summary-based expander → deterministic linker path (medium)

### Why this matters

The 04-20 audit revealed `deriveParentCandidatesFromPageSummaries` produces **91 candidates** on Marco's corpus — including cities the record-based expander misses (Toronto 32 refs, Seattle 7, Honolulu 7, etc.). But the deterministic linker only consumes `deriveParentCandidates(records)`, so those 60+ candidates never become links even after #311.

### Scope

- Run summary-based expander inside the linker path (currently only aggregation pass consumes it).
- **Resolve the id-semantics mismatch**: `deriveParentCandidatesFromPageSummaries` puts page ids in `sourceRecordIds`; `emitDeterministicParentLinks` expects memory-record ids (keys the `leavesByRecord` map). Two options:
  - **Option A** (cleaner): add a second emitter path `emitSummaryBasedParentLinks` that treats the candidate's "leaves" as pages whose summary mentioned the candidate token. No shared map with record-based.
  - **Option B** (smaller): tag candidates with a `sourceKind: "record" | "summary"` and branch the leaf resolution inside `emitDeterministicParentLinks`.
- Gate with the existing `PARENT_TITLE_FUZZY_THRESHOLD = 0.50` and geo-suffix gate so precision stays at the bar #311 set.

### Exit criteria

Recompile Marco after wiring → `links_written_deterministic` goes from 14 (record-only) to somewhere in the **50–90 range**, still with zero false positives on a 10-pair spot check.

### Execution note

Risk: `deriveParentCandidatesFromPageSummaries` over-produces on noisy summaries (`"Gto."` / `"Q.R."` / `"AI Assistant Powered By ThinkWork"` / `"Prospect Interested In The Full PVL Product Line"` all surfaced in the audit). Before wiring it in, tighten the expander's candidate filter — drop titles with `length > 4 words` or trailing-dot abbreviations.

### Files

- Modify: `packages/api/src/lib/wiki/parent-expander.ts` (candidate filter)
- Modify: `packages/api/src/lib/wiki/deterministic-linker.ts` or add `summary-based-linker.ts`
- Modify: `packages/api/src/lib/wiki/compiler.ts` (call site)
- Add: `packages/api/src/__tests__/wiki-summary-parent-linker.test.ts`

---

## #4 — Trivial extractor fixes + operational follow-ups

All small, can be bundled in one PR or cherry-picked.

### `extractCityFromAddress` dotted-abbreviation bug

Surfaced in the 04-20 audit output:

```
city "Gto." (support=32, sectionSlug=restaurants)   ← Guanajuato, Mexico
city "Q.R." (support=22, sectionSlug=restaurants)   ← Quintana Roo, Mexico
```

Addresses like `"… 37700 San Miguel de Allende, Gto., Mexico"` walk to `"Gto."` instead of `"San Miguel de Allende"` because `Gto.` matches `^[A-Z]{2,4}(\s|$)` — the dot doesn't block the region-code gate.

**Fix**: after matching the region-code slot, also require the matched part is NOT just a short dotted abbreviation. Simplest: `if (/^[A-Z]{2,4}\.?$/.test(parts[i]) && parts[i].length <= 5) continue` — walk past abbreviations without consuming the city slot.

### `wipeWikiScope` FK dependency

`wiki_unresolved_mentions.promoted_page_id_wiki_pages_id_fk` blocks `packages/api/scripts/wiki-wipe-and-rebuild.ts` when any mention has been promoted in the target scope. Workaround this session was manual `DELETE FROM wiki_unresolved_mentions WHERE owner_id=X` before running the wipe.

**Fix**: `wipeWikiScope` should null out `promoted_page_id` (or delete the mentions) inside its transaction before archiving the pages.

### Aggregation applier split

`compiler.ts:applyAggregationPlan` is now 1300+ lines. Original plan called for a separate `aggregation-applier.ts` module. Not a bug; just debt. Worth splitting when the next large change lands in this area (good candidate: #1 above, since cluster-promotion logic lives in this function).

---

## Relevant feedback memos

Same load-bearing feedback memos as the prior handoff:

- `feedback_worktree_isolation.md` — always `.claude/worktrees/<name>` off `origin/main`.
- `feedback_cleanup_worktrees_when_done.md` — remove worktree + branch after merge.
- `feedback_pr_target_main.md` — never `gh pr create --base feat/…`.
- `feedback_verify_wire_format_empirically.md` — before bulk field-name refactors, curl/psql the live surface.
- `feedback_graphql_deploy_via_pr.md` — graphql-http Lambda deploys via PR merge only.
- `feedback_read_diagnostic_logs_literally.md` — diagnostic asymmetry IS the bug, not noise.

## Starting command

```text
/ce:work docs/plans/2026-04-20-018-handoff-cluster-enrichment-and-followups.md
```

Pick the next subsection based on appetite. All four items are independent:

- #1 (cluster enrichment) — one dedicated session, biggest remaining plan item.
- #2 (wikiBacklinks dedup) — warm-up PR, <1 hour.
- #3 (summary expander wiring) — medium, biggest precision/recall dial left on the linker.
- #4 (extractor + wipe + applier-split) — grab-bag, each independent.
