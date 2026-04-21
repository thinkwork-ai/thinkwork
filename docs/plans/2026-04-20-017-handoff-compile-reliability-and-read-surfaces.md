---
title: "Handoff: compile reliability + read surfaces (post-Marco-rebuild)"
type: handoff
status: open
date: 2026-04-20
parent_plan: docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md
related:
  - docs/plans/2026-04-20-014-feat-compile-link-densification-plan.md
  - docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md
---

# Handoff: compile reliability + read surfaces (post-Marco-rebuild)

## Read this first

The 2026-04-20 session shipped **10 PRs** to land Phase 1 + Phase 2 + Phase 3 PR A of `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md` (the hierarchical-aggregation plan). Refreshed plan status — what's still open vs what shipped — lives at the top of that file in its "Implementation Status (2026-04-20 refresh)" section. **Read that section before doing anything else.**

Outcome: Marco's wiki was wiped and rebuilt from scratch via bootstrap_import continuation chain. Final dev state — **221 active pages, 336 reference links, 72.9% linked, 0 cross-type duplicate titles, 8 continuation hops executed cleanly before the chain tripped on unrelated Bedrock flakes**.

This handoff covers **four follow-ups** that were not built during the 04-20 session:

1. **Bedrock reliability: retry around parseJsonResponse** (small, highest leverage)
2. **Audit `links_written_deterministic = 0`** (investigation — why the parent linker isn't matching)
3. **Unit 8: mobile backlink UI + WikiPage GraphQL read surfaces** (user-visible, biggest payoff)
4. **Unit 6: evidence-backed mention clusters + cluster-aware promotion** (can defer)

Each is self-contained below. Paste any section into a fresh session as a `/ce:work` prompt, or work interactively.

---

## What shipped on 2026-04-20

10 PRs, all merged to `main`. Listed in merge order with squash commits on `main`:

| PR | Commit | What |
|---|---|---|
| #285 | `714ef70` | Compile-pipeline link densification: two deterministic link emitters, `WIKI_DETERMINISTIC_LINKING_ENABLED` flag, R5 canary, baseline + backfill scripts |
| #288 | `aadfada` | Trigram-fuzzy alias dedupe on newPages (pg_trgm ≥ 0.85, same-type gate, `fuzzy_dedupe_merges` metric) |
| #290 | `5969330` | `upsertUnresolvedMention` race fix — survives SELECT-then-INSERT window |
| #291 | `d3690e5` | Compounding-memory docs refresh |
| #293 | `03638b0` | Hierarchical-aggregation plan refresh — captures what actually shipped vs 2026-04-19 spec |
| #294 | `5db21a7` | Compile ops readiness (Units 3b, 3c, 9, 10): section-activity bump, continuation chaining, cross-type dup guard, trigram-fallback parent lookup |
| #295 | `702e9a1` | Fix continuation trigger on any early loop exit (not just records cap) |
| #296 | `e1999d6` | Anchor continuation bucket on `job.created_at` (superseded) |
| #299 | `_` | **Final continuation fix** — parse bucket out of `dedupe_key`, enqueue at `(parentBucket + 1) * DEDUPE_BUCKET_SECONDS`. See `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` for the full narrative. |
| #305 | `b6759ea` | Learning doc + `compounding-memory-pipeline.mdx` addendum for the continuation chain |

## Dev state pointers

Handy for any follow-up session that needs to query or recompile:

- **Tenant (Eric)**: `0015953e-aa13-4cab-8398-2e70f73dda63`
- **Marco (bootstrapped 2026-04-20)**: `c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c`
- **GiGi (NOT rebuilt this session — still on pre-refactor data)**: `b6b241d5-c523-4b33-9de0-c495e1991a0d`
- **Cruz (small, untouched)**: `8bf36661-e24e-49dd-8c07-ab273abff9b5`
- **wiki-compile Lambda**: `thinkwork-dev-api-wiki-compile`
- **Dev RDS host**: `thinkwork-dev-db-1.cmfgkg8u8sgf.us-east-1.rds.amazonaws.com`
- **Dev DB secret**: AWS Secrets Manager `thinkwork-dev-db-credentials` (username/password JSON)
- **Dev DB name**: `thinkwork`

**SSL caveat**: the tsx scripts (baseline reporter, backfill) need `sslmode=no-verify` in `DATABASE_URL` because the RDS cert isn't in Node's trust store by default. `psql` can use `sslmode=require`. Mixed-mode connection string will fail.

**Enqueuing compile jobs manually**: insert directly into `wiki_compile_jobs` with `trigger='bootstrap_import'` (gets the 1000-record cap) and a unique `dedupe_key`, then `aws lambda invoke --invocation-type Event --function-name thinkwork-dev-api-wiki-compile --payload '{"jobId":"<uuid>"}'`. Continuation chain takes over from there.

**Wiping a scope**: `pnpm dlx tsx packages/api/scripts/wiki-wipe-and-rebuild.ts --tenant X --owner X` — note the `wiki_unresolved_mentions.promoted_page_id` FK will block the wipe if any mentions were promoted; clear them first with `DELETE FROM wiki_unresolved_mentions WHERE owner_id=X` (an operational bug worth its own follow-up, see Known Risks).

---

## #1 — Bedrock retry wrapper

### Why this matters

Marco's rebuild chain broke twice (2 of 13 jobs = 15% failure rate) on:
- `parseJsonResponse: empty response` — Bedrock returned empty body
- `Expected ',' or '}' after property value in JSON at position 2585` — truncated response, likely output-token budget or transient

Every compile-job crash today kills the continuation chain (the error propagates through `applyPlan` → `runCompileJob`'s outer try/catch → status=failed → continuation block never runs). Even with Unit 3c shipped, bootstrap imports will stop mid-chain until someone notices and manually re-enqueues.

One retry wrapper fixes this for all three Bedrock call sites.

### Where to put it

`packages/api/src/lib/wiki/bedrock.ts` is the shared Bedrock client. Wrap `invokeClaude` (or add a sibling `invokeClaudeWithRetry`) with exponential backoff.

### Scope

- **Retry only transient JSON failures**: empty response, truncated JSON, `ThrottlingException`. Do NOT retry on auth errors, invalid-model errors, or payload-too-large.
- **3 attempts, 1s / 2s / 4s backoff** with jitter (±25%).
- **New metric keys** on `wiki_compile_jobs.metrics`:
  - `bedrock_retries` (count)
  - `bedrock_retry_exhausted` (count — times all 3 attempts failed)
- **Emit a warn log** on every retry, including attempt number and error message truncated to 200 chars.
- **Preserve existing behavior on success** — no new latency on the happy path.

### Test plan

Write a vitest test that mocks `BedrockRuntimeClient.send` to return empty payloads on attempts 1 and 2 then succeed on attempt 3. Assert: one final successful return + two retry attempts + metrics show `bedrock_retries = 2`.

### Post-merge validation

Re-trigger a bootstrap job on GiGi (biggest corpus, most likely to hit LLM reliability issues). Expect `bedrock_retries > 0` on at least one job without any job failing. If a job DOES fail with `bedrock_retry_exhausted`, investigate whether the prompt needs shrinking or the model needs swapping.

---

## #2 — Audit `links_written_deterministic = 0`

### Why this matters

Parent-expander derives candidates every compile but the deterministic linker has never written a single link on dev — zero across 13 Marco jobs + the earlier densification validation runs. Two emitter paths that should have fired on Marco's data but didn't:

- **Exact title match** — `findPagesByExactTitle(candidate.parentTitle)`. Candidate title `Paris` should match the `Paris, France` topic via fuzzy fallback. `links_written_deterministic` stays 0 → not matching.
- **Trigram fallback** (Unit 10) — `findPagesByFuzzyTitle` at similarity ≥ 0.85. Shipped in #294, still 0 links.

### Likely causes (investigation-first, not fix-first)

1. **Similarity threshold too strict for city variants.** `similarity('Paris', 'Paris, France')` in Postgres `pg_trgm` is often around 0.4–0.6, not 0.85, because trigram similarity penalizes length delta. Same for `Portland` vs `Portland, Oregon`.
2. **Parent-expander not producing the candidates you'd expect.** `deriveParentCandidates(records)` walks memory metadata for city/journal fields. Marco's records may have city data in a shape the expander doesn't recognize.
3. **`affectedPages.sourceRecordIds` doesn't intersect `candidate.sourceRecordIds`.** Emitter only fires on leaves whose source records back the candidate — if that overlap is empty, no emission.

### Investigation steps (before writing code)

```sql
-- 1. What do actual city titles look like for Marco?
SELECT title, similarity(title, 'Paris') AS sim_paris,
       similarity(title, 'Portland') AS sim_portland
FROM wiki_pages
WHERE owner_id = 'c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c'
  AND type = 'topic'
  AND status = 'active'
ORDER BY sim_paris DESC LIMIT 20;

-- 2. Are there any candidates the expander SHOULD derive? Run the expander
-- against a sample batch and log its output. Add a console.log at
-- compiler.ts applyPlan's `const candidates = deriveParentCandidates(records)`
-- line and inspect a dev-compile run.
```

If (1) turns out true, the fix is a *lower* similarity threshold for parent-title fuzzy lookup **specifically** (keep 0.85 for alias-dedupe, which has different precision needs). Propose `PARENT_TITLE_FUZZY_THRESHOLD = 0.55` and add a same-type gate + a hard cap on matches per candidate. Test with the Marco corpus.

If (2), either the expander needs additional metadata fields or the records themselves need better ingestion from Hindsight.

### Exit criteria

`links_written_deterministic > 0` on a GiGi or Marco recompile, with the selected parent titles audited for precision (spot-check 10 parent-leaf pairs to confirm they're semantically correct).

---

## #3 — Unit 8: mobile backlink UI + WikiPage read surfaces

### Why this matters

Compounding Memory is now observably real in the database — 221 Marco pages, 336 reference links, parent/child hierarchy — but the mobile app only surfaces a flat page list and a force-graph. Users can't see the compounding relationships. This is the highest user-visible payoff remaining in the hierarchical-aggregation plan.

### Scope (per Unit 8 of `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`)

**GraphQL layer** — add field resolvers in `packages/api/src/graphql/resolvers/wiki/`:

- `WikiPage.sourceMemoryCount: Int!` — count rows from `wiki_section_sources` joined across this page's sections.
- `WikiPage.sourceMemoryIds(limit: Int = 10): [String!]!` — bounded list, capped at 50 server-side.
- `WikiPage.parent: WikiPage` — resolve `parent_page_id`.
- `WikiPage.children: [WikiPage!]!` — reverse lookup on `parent_page_id`.
- `WikiPage.promotedFromSection: WikiPromotedFromSection` — resolve `promoted_from_section_id` → section → parent page.
- `WikiPage.sectionChildren(sectionSlug: String!): [WikiPage!]!` — read from `wiki_page_sections.aggregation.linked_page_ids` (denormalized join; Unit 4's shipped shape).

**Schema** — extend `packages/database-pg/graphql/types/wiki.graphql`.

**Verify `MemoryRecord.wikiPages` end-to-end.** The field is declared but never confirmed wired in this scope. Test on real data.

**Mobile screens** — `apps/mobile/app/`:

- `memory/[file].tsx`: "Contributes to:" chip section when `wikiPages` is non-empty; tap navigates to `/wiki/[type]/[slug]`.
- `wiki/[type]/[slug].tsx`: parent breadcrumb, "Based on N memories" badge with drill-in, "Promoted from:" linkage, children-list section grouped by parent section slug.

**Do NOT preload `sourceMemoryIds` on list screens** (`wikiSearch`, `recentWikiPages`). Detail screens only — avoids N+1 on list views.

### Patterns to follow

- `packages/api/src/graphql/resolvers/memory/mobileWikiSearch.query.ts` — reverse-join + tenant/owner guard pattern.
- `packages/api/src/graphql/resolvers/wiki/recentWikiPages.query.ts` — agent-scoped listing.
- `packages/react-native-sdk/src/graphql/queries.ts` + `use-recent-wiki-pages.ts` — hook structure.

### Verification

- Seed a fixture where memory M is sourced on 2 pages; memory detail shows both chips.
- Seed a promoted page and navigate parent → promoted child → back to a memory that contributed.
- Scope-isolation spot-check: admin viewing another agent's scope should not cross-leak.

---

## #4 — Unit 6: mention cluster enrichment + cluster-aware promotion

### Why this matters

Mention clusters are where "I've mentioned 'Taberna do Pescador' 4 times across 3 compiles with no matching page" becomes "promote to a real topic page with evidence-backed sections." The schema slot (`wiki_unresolved_mentions.cluster jsonb`) exists; the promotion path does not.

Lower urgency than #1–#3 because:

- The `cluster` jsonb shape is skeletal — needs additional keys before the promotion path can land.
- Mention-backed hub creation is a *nice-to-have* for compounding; the compile pipeline works without it today.
- Pattern-wise, once Unit 8 surfaces mention counts in the mobile UI, a user can eyeball whether clusters are worth promoting manually via the admin `compileWikiNow`.

### Scope (per Unit 6 of `docs/plans/2026-04-19-002-feat-hierarchical-aggregation-plan.md`)

- Extend the `cluster` jsonb to carry `supporting_record_ids`, `candidate_canonical_titles`, `cluster_summary`, `ambiguity_notes`. No migration needed — it's already a jsonb column.
- Aggregation planner emits `mentionClusterEnrichments[]` when a cluster has ≥ 3 entries and `last_seen_at` is within 30 days.
- Promotion applier accepts a cluster as a topic-page candidate when: `mention_count ≥ 3` AND `cluster_summary` non-null AND ≥ 2 candidate canonical titles agree.
- New metrics: `cluster_enrichments`, `cluster_promotions_executed`, `cluster_promotion_deferred`.

Can land after #1–#3 without blocking anything. Best tackled in a single session with a real fixture (pick an agent with ≥ 3 unresolved mentions in the same alias family).

---

## Known risks to surface in the next session

### Pre-existing bugs exposed this session that still exist

1. **`wipeWikiScope` FK dependency** — the script crashes on `wiki_unresolved_mentions_promoted_page_id_wiki_pages_id_fk` when any mentions have been promoted. Workaround in this session was `DELETE FROM wiki_unresolved_mentions WHERE owner_id = X` before running the wipe. Real fix: `wipeWikiScope` should null out `promoted_page_id` (or delete the mentions) as part of its transaction. Small PR when convenient.

2. **Bedrock JSON flakes** — see #1 above. Happens ~15% of the time on real corpora.

3. **Aggregation applier cross-type duplicate guard (Unit 9) doesn't always fire** — on Marco's fresh rebuild, 0 cross-type dups were created, so the guard worked there. But PR #294's test coverage is lighter than ideal; a future bootstrap might still trip it. Worth an integration test against a seeded fixture where an entity title exactly matches a proposed topic title.

### Architectural debt

1. **Aggregation applier is inlined in `compiler.ts:applyAggregationPlan`** (1300+ lines). The original plan (Unit 4) called for a separate `aggregation-applier.ts` module. Not a bug; just debt. Worth splitting when the next large change lands in this area.

2. **Denormalized `aggregation.linked_page_ids` vs `wiki_section_children` table** — the schema shipped with the jsonb array; the original plan proposed a normalized join table. Denormalized is fine for v1, but queries like "which sections claim this leaf?" require jsonb containment (`@>`) instead of indexed joins. If Unit 8's `sectionChildren` resolver becomes a bottleneck, the migration is a follow-up: backfill a `wiki_section_children` view from `aggregation.linked_page_ids`.

3. **`links_written_deterministic` is 0 on every run** — see #2 above. Not a bug per se (the code path is correct), but a dead feature until the threshold/audit work lands.

## Relevant feedback memos

From prior sessions, treat as load-bearing for this work:

- `feedback_worktree_isolation.md` — use `.claude/worktrees/<name>` off `origin/main` for every PR.
- `feedback_pr_target_main.md` — never `gh pr create --base feat/…`; always `--base main`.
- `feedback_verify_wire_format_empirically.md` — before bulk refactors touching field shapes (e.g., `aggregation.linked_page_ids`), query the live DB and verify. Bit this session twice on the continuation bucket math.
- `feedback_read_diagnostic_logs_literally.md` — diagnostic asymmetry (`metric shows 1 on some rows, absent on others`) IS the bug signature, not noise.
- `feedback_cleanup_worktrees_when_done.md` — delete worktrees + branches after merge.
- `feedback_graphql_deploy_via_pr.md` — any Lambda that serves GraphQL deploys via PR merge, never `aws lambda update-function-code` directly. Applies here because Unit 8 will touch `graphql-http`.

## Starting command

```text
/ce:work docs/plans/2026-04-20-017-handoff-compile-reliability-and-read-surfaces.md
```

Pick the next subsection based on scope + appetite. All four items are independent — can ship in any order. If context is tight, `/ce:work` with a specific pointer like `docs/plans/2026-04-20-005-handoff…#1-bedrock-retry-wrapper` still reads the section cleanly.
