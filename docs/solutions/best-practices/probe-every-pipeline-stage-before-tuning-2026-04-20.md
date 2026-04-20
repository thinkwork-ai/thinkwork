---
title: Probe every pipeline stage before tuning the last knob
date: 2026-04-20
category: best-practices
module: wiki-parent-linking
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - A pipeline metric reads zero or near-zero
  - Plan or ticket hypothesizes a fix at the final stage (threshold, filter, ranker)
  - Multi-stage pipeline exists (extract → candidate-gen → match → filter)
  - Input data is heterogeneous (international, legacy, user-generated)
tags:
  - methodology
  - debugging
  - pipeline-audit
  - root-cause-analysis
  - wiki
related_components:
  - packages/api/scripts/wiki-parent-link-audit.ts
  - packages/api/src/lib/wiki/parent-expander.ts
  - packages/api/src/lib/wiki/deterministic-linker.ts
  - packages/api/src/lib/wiki/repository.ts
---

# Probe every pipeline stage before tuning the last knob

## Context

The 2026-04-20 handoff plan (`plans/2026-04-20-005-handoff-compile-reliability-and-read-surfaces.md`, item #2) flagged `links_written_deterministic = 0` on Marco's 221-page wiki corpus. The plan's hypothesis was crisp and plausible: the pg_trgm fuzzy-title similarity gate (`FUZZY_ALIAS_THRESHOLD = 0.85`) was too strict because `similarity("Paris", "Paris, France") ≈ 0.45`. Recommended fix: lower `PARENT_TITLE_FUZZY_THRESHOLD` to ~0.55 and ship.

The trap: this is a four-stage pipeline (candidate derivation → exact lookup → fuzzy lookup → precision gate), and a zero at the end can come from ANY stage. Tuning the last knob first would have "fixed" the symptom with a false fix — recovering ~1 link instead of the 14 actually available, while silently admitting false positives like `"Toronto" → "Toronto Life"` (a magazine).

### Prior failed approaches on this same metric (session history)

Two earlier sessions burned cycles on wrong hypotheses for the same zero (session history):

- **Apr 19, `compound-pipeline` worktree (PRs #246–#249)** — hypothesis was **batch-locality**: `deriveParentCandidates` runs per-job over ~40–50 records, so cities wouldn't hit `minClusterSize=2` in a single batch. Fix attempted: drop `minClusterSize` from 2 → 1. Shipped, but `deterministic_parents_derived` stayed at 0 across multiple Marco rebuild drains.
- **Apr 20 morning, `feat/compile-link-densification` worktree (PR #285)** — end-of-session read was "parent-expander candidates still aren't matching any existing topic page even with fuzzy at 0.85. Either the threshold is too strict or the candidates aren't the right shape." The plan handed off with **lower the threshold** as the next action.

Both hypotheses accepted the surface metric as evidence about the final gate. Neither actually looked at what candidates the pipeline was emitting. When the audit finally ran, the answer was visible in the first 10 rows: candidates were malformed strings like `"75006 Paris"` that could never match anything.

## Guidance

**Before acting on a planner's single-knob hypothesis, write an audit script that probes every stage of the pipeline. Commit the script.**

Steps:

1. **Enumerate the stages.** For the parent-linker: (a) candidate generation, (b) exact-title match, (c) fuzzy-similarity distribution, (d) precision gate.
2. **Probe each stage independently.** Don't infer stage N's health from stage N+1's output.
   - Stage (a): dump the raw candidates — is the expander even producing material?
   - Stage (b): count exact hits — is the miss actually a fuzzy problem, or a data-shape problem upstream?
   - Stage (c): for each miss, show the top-K fuzzy matches WITH scores — does the distribution support the planner's threshold guess?
   - Stage (d): build a threshold-recall table AND spot-check 10 pairs for false positives before trusting any threshold.
3. **Cross-check against raw storage.** SQL against the source table (e.g., `memory_units.metadata.place.city` vs `place_address`) catches upstream extraction bugs the pipeline alone hides.
4. **A "clean" audit** shows candidate counts, match-rate at each stage, the fuzzy score distribution, and precision spot-check — enough evidence to locate the zero.
5. **Commit the script** (e.g., `packages/api/scripts/wiki-parent-link-audit.ts`) so the next operator re-runs it verbatim instead of rebuilding intuition.

## Why This Matters

Planner hypotheses are first drafts written without the data in hand. In the Marco case the "obvious" threshold fix would have recovered 1 link out of 14 available, and the real bugs (ZIP-code leakage in `extractCityFromAddress`, accent truncation in `extractCityFromSummary`) would have sat undiscovered while the metric appeared "fixed enough."

Threshold tuning is almost always the wrong lever when a metric reads zero — zeros usually mean a stage upstream produced nothing, not that the final gate was slightly too tight. The audit reveals which stage is actually empty. On this particular metric the wrong-lever pattern repeated across three sessions (minClusterSize, then threshold, then threshold again) before the audit ran.

Committed audit tooling compounds: the next reliability handoff re-runs the same script in 30 seconds instead of rebuilding the mental model from logs. This is the same methodology as "verify wire format empirically" (auto memory [claude]) — inspect the live data, don't trust the narrative — and the same spirit as "read diagnostic logs literally" (auto memory [claude]) — the off-by-one in your diagnostic output IS the bug.

## When to Apply

- A pipeline metric reads zero (or near-zero) when it should be nonzero.
- The pipeline has two or more transformation stages.
- A planner, designer, or handoff doc has proposed a single-knob fix ("just lower the threshold", "just widen the regex").
- A previous session already attempted a fix at the last stage and the metric didn't move — that is strong evidence the bug is upstream (session history).
- You're about to tune the LAST stage without evidence the earlier stages produced input.
- You're tempted to ship a fix whose precision impact you haven't spot-checked.

## Examples

**Before (PR #311 handoff hypothesis):** "Lower `PARENT_TITLE_FUZZY_THRESHOLD` from 0.85 to 0.55. Done."

**After (audit-driven):** Ran `wiki-parent-link-audit.ts`. Found: 91 candidates, threshold 0.55 only emits 3/40 links, top fuzzy matches include `Toronto → Toronto Life (0.615, false positive)`, and SQL shows 880 `memory_units` with `place_address: "11 Rue Bernard Palissy, 75006 Paris, France"` but **zero** with `metadata.place.city` populated. Real fixes: postcode-stripping in `extractCityFromAddress`, `\p{Lu}\p{L}+` regex in `extractCityFromSummary`, plus `isGeoQualifiedExtension` precision gate. Net result: 336 → 350 reference links, all 10 spot-checked pairs precision-correct.

Audit script skeleton:

```ts
// For each page in corpus:
const candidates = deriveParentCandidatesFromPageSummaries(page);
for (const cand of candidates) {
  const exact = await db.page.findFirst({ where: { title: cand } });
  if (exact) { report.exactHits++; continue; }

  const fuzzy = await db.$queryRaw`
    SELECT title, similarity(title, ${cand}) AS score
    FROM pages ORDER BY score DESC LIMIT 5`;
  report.fuzzyDistribution.push({ cand, top: fuzzy });

  for (const t of [0.4, 0.5, 0.6, 0.7, 0.85]) {
    if (fuzzy[0].score >= t) report.recallAt[t]++;
  }
}
console.table(report); // candidates, exactHits, recallAt, top-5 per miss
```

The table tells you which stage is empty before you touch any knob.

## Related

- `docs/solutions/logic-errors/compile-continuation-dedupe-bucket-2026-04-20.md` — sibling wiki-compile pipeline learning (continuation bucket math + `ON CONFLICT DO NOTHING` swallowing failures). Complementary: same module, different stage, same "surface metric hid an upstream failure" shape.
- `plans/2026-04-20-005-handoff-compile-reliability-and-read-surfaces.md` — the handoff plan whose item-#2 hypothesis this audit invalidated.
- PR [#311](https://github.com/thinkwork-ai/thinkwork/pull/311) — the fix that landed after the audit ran.
- Auto-memory: `feedback_verify_wire_format_empirically.md`, `feedback_read_diagnostic_logs_literally.md` — sibling methodology heuristics.
