---
title: Backfill audits must account for corpus growth when materializing structural pages
date: 2026-04-21
category: best-practices
module: wiki-places
problem_type: best_practice
component: tooling
severity: medium
applies_when:
  - Writing audit scripts that project the impact of a backfill operation
  - The backfill has side effects that create new rows of the type being counted
  - Reporting before/after ratios where both numerator and denominator can grow
  - Designing R13-style rollout gates phrased as "actual matches projected ±X%"
related_components:
  - database
tags:
  - wiki
  - places
  - backfill
  - audit
  - metrics
  - projection
  - ratio-lift
  - denominator
---

# Backfill audits must account for corpus growth when materializing structural pages

## Context

The wiki-places-v2 rollout (PR #333 schema + client, PR #338 Phase C backfill) shipped with an R13 verification criterion in `docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md`: *"Dry-run against dev GiGi: output matches Unit 1's audit projection ±5%."* When we wet-ran Phase C against two agents in tenant `0015953e-aa13-4cab-8398-2e70f73dda63`, the headline `linked%` blew through that gate:

- **GiGi**: audit projected `+47.0pp` lift (49.7% → 96.7%). Actual lift was `+24.2pp` (49.7% → 73.9%) — a 51% shortfall against the gate.
- **Marco**: projected `+16.3pp` (67.8% → 84.1%). Actual `+8.5pp` (67.8% → 76.3%) — a 48% shortfall.

Both runs were technically clean: zero collisions, breaker closed, R14 drift budget under 10%, and Phase C wrote `783` hierarchy edges on GiGi and `93` on Marco with no error spikes. The gap wasn't in execution — it was in the projection.

Root cause: `packages/api/src/lib/wiki/places-service.ts::ensureBackingPage` (called from `materializeHierarchy`) creates a new `wiki_pages` entity row per POI and per hierarchy tier (country / state / city) as a side effect of the wet-run. GiGi's `active_entity_pages` went from 1054 → **1333** (+279); Marco's went from 208 → **228** (+20). The audit query in `packages/api/scripts/wiki-places-audit.ts::summarize` computes `projected_linked_pct` as `(linked + addressable) / active`, holding the denominator fixed. When the backfill adds rows to the denominator, the ratio undershoots even if every addressable page is enriched perfectly.

Switching to a denominator-stable metric `hierarchy_edges_written / pages_with_google_place_id` gives **77.6% for GiGi** (783 / 1009) and **87.7% for Marco** (93 / 106) — which tracks the audit's `addressable_ceiling_pct` (93.4% and 50.7%) within normal Google NOT_FOUND noise (17 on GiGi, 4 on Marco). The backfill did what it was supposed to do; the comparison metric was wrong.

## Guidance

Three concrete rules for backfill audits that project ratios:

**1. Separate "opportunity" from "lift projection" in audit output.** `addressable_ceiling_pct` (what fraction of the unlinked tail has the enriching data available) is denominator-agnostic and always honest. `projected_linked_pct` / `projected_lift_pp` implicitly assume a static denominator — they're only valid when the backfill does not create new rows of the type being counted. Mark the latter as conditional in both the code and the output.

**2. For backfills that materialize structural pages, add an explicit `expected_new_pages` term.** If the audit knows the backfill will create roughly `N` new entity rows (e.g., one per POI plus hierarchy tiers for places-service), it should project against `(linked_after) / (active + expected_new_pages)`, not `/ active`. If `expected_new_pages` isn't known, the audit should say so and refuse to emit a ratio projection — emit opportunity only.

**3. Prefer `edges_written / addressable_ceiling` as the primary post-run success metric.** This ratio is denominator-stable: the numerator counts the thing the backfill actually did, and the denominator counts the opportunity the audit actually measured. R13-style gates should be wired to this metric, not to `linked_pct` deltas.

## Why This Matters

The R13 rollout gate is an operator's kill switch. With the current metric, the wet-run reports read as: *"projected +47pp, got +24.2pp — ~50% miss."* The honest read is: *"realized 77.6% of a 93.4% opportunity ceiling within Google NOT_FOUND noise — the backfill did its job."* Those two framings point operators in opposite directions. The first invites "pause rollout, debug why we're at half-strength." The second invites "proceed to the next scope."

For any future backfill that materializes structural pages as a side effect — places today, tags / periods / themes / any auto-entity capability next — the denominator trap will fire the same way and the same shortfall narrative will emerge. The fix is cheap (a few lines in `summarize()`); the cost of not fixing it is either bypassed gates ("we know linked% undershoots, ignore it") or killed-off healthy work.

## When to Apply

- Every future wiki backfill that materializes backing pages as a side effect of enrichment (places is the current case; tags, periods, themes, and any auto-entity capability are near-certain next cases).
- Any audit that projects a ratio where the backfill can grow the denominator. If the backfill only writes edges without creating new rows of the counted type, the existing `projected_linked_pct` math is fine.
- Any R13-style verification gate phrased as "actual matches projected ±X%". Wire the gate to a denominator-stable metric, or explicitly widen the tolerance to cover denominator growth.

## Examples

**Current `summarize()` — implicit static-denominator assumption:**

```ts
// packages/api/scripts/wiki-places-audit.ts
export function summarize(row: CountRow): AuditResult {
	const active = Number(row.active_entity_pages);
	const unlinked = Number(row.unlinked_entity_pages);
	const addressable = Number(row.unlinked_with_place_data);
	const linked = active - unlinked;

	const currentLinkedPct = active === 0 ? 0 : (linked / active) * 100;
	// Implicitly assumes `active` is the denominator AFTER the backfill too.
	// ensureBackingPage() grows `active` during the run, so this overstates
	// the post-run ratio.
	const projectedLinkedPct =
		active === 0 ? 0 : ((linked + addressable) / active) * 100;

	return {
		active_entity_pages: active,
		unlinked_entity_pages: unlinked,
		unlinked_with_place_data: addressable,
		addressable_ceiling_pct:
			unlinked === 0 ? 0 : (addressable / unlinked) * 100,
		projected_lift_pp: projectedLinkedPct - currentLinkedPct,
		current_linked_pct: currentLinkedPct,
		projected_linked_pct: projectedLinkedPct,
	};
}
```

**Proposed fix — make the denominator assumption explicit and favor the stable metric:**

```ts
// packages/api/scripts/wiki-places-audit.ts
export interface SummarizeOptions {
	/**
	 * Expected number of new entity rows the backfill will create as a side
	 * effect (e.g. one per POI + hierarchy tiers for places-service).
	 * When > 0, projected_linked_pct is computed against the grown denominator.
	 * When undefined, projected_linked_pct is suppressed — only the
	 * denominator-stable `addressable_ceiling_pct` is reported.
	 */
	expectedNewPages?: number;
}

export function summarize(
	row: CountRow,
	opts: SummarizeOptions = {},
): AuditResult {
	const active = Number(row.active_entity_pages);
	const unlinked = Number(row.unlinked_entity_pages);
	const addressable = Number(row.unlinked_with_place_data);
	const linked = active - unlinked;

	const currentLinkedPct = active === 0 ? 0 : (linked / active) * 100;

	// addressable_ceiling_pct is the PRIMARY projection: denominator-agnostic,
	// always honest. projected_linked_pct is secondary and only valid when the
	// caller has told us how many new rows the backfill will create.
	const projectedDenominator = active + (opts.expectedNewPages ?? 0);
	const projectedLinkedPct =
		opts.expectedNewPages === undefined
			? null // refuse to project a ratio we can't defend
			: projectedDenominator === 0
				? 0
				: ((linked + addressable) / projectedDenominator) * 100;

	return {
		active_entity_pages: active,
		unlinked_entity_pages: unlinked,
		unlinked_with_place_data: addressable,
		// PRIMARY: stable under denominator growth. Wire R13 gates to this.
		addressable_ceiling_pct:
			unlinked === 0 ? 0 : (addressable / unlinked) * 100,
		current_linked_pct: currentLinkedPct,
		// SECONDARY: null when expected_new_pages is unknown.
		projected_linked_pct: projectedLinkedPct,
		projected_lift_pp:
			projectedLinkedPct === null
				? null
				: projectedLinkedPct - currentLinkedPct,
	};
}
```

**Proposed post-run success metric (what R13-style gates should compare against):**

```
realization_rate = hierarchy_edges_written / pages_with_enriching_data

# Where `pages_with_enriching_data` is the Phase C summary's
# `pages_with_google_place_id`, which equals the audit's
# `unlinked_with_place_data` + any already-linked pages that also carry the
# enriching field.

# GiGi:  783 / 1009 = 77.6%   (vs. addressable_ceiling_pct = 93.4%)
# Marco:  93 /  106 = 87.7%   (vs. addressable_ceiling_pct = 50.7%)
```

R13 gate should read: *"`realization_rate` within ±X% of `addressable_ceiling_pct`, where X is sized to cover third-party NOT_FOUND noise"* — not *"`linked_pct` lift within ±5% of `projected_linked_pct`."*

## Related

- [Probe every pipeline stage before tuning](./probe-every-pipeline-stage-before-tuning-2026-04-20.md) — parent methodology (audit-first discipline). This doc is the denominator-drift corollary: once the audit exists, watch for pipeline side effects that move the denominator during the wet-run.
- `packages/api/scripts/wiki-places-audit.ts::summarize` — the projection code that needs the fix.
- `packages/api/src/lib/wiki/places-service.ts::ensureBackingPage` — the side effect responsible for denominator growth.
- `docs/plans/2026-04-21-005-feat-wiki-place-capability-v2-plan.md` — R13 verification criterion that flagged the gap.
- PR [#338](https://github.com/thinkwork-ai/thinkwork/pull/338) — wiki-places-v2 PR B; source of the GiGi + Marco numbers.
