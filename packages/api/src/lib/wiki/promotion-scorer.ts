/**
 * Promotion scorer — pure function that decides whether a parent-page
 * section is dense/coherent/persistent enough to earn its own topic page.
 *
 * No LLM here. The aggregation planner is allowed to override by including
 * a sectionPromotion in its output, but the compiler uses this score both
 * as a hard-gate on the planner's suggestions and as the source of
 * `aggregation.promotion_score` + `promotion_status = "candidate"` flips.
 *
 * Signals intentionally kept coarse. We want monotonic ordering across
 * candidates in the same agent scope, not precise calibration.
 */

import type { SectionAggregation } from "./repository.js";

export interface PromotionSignals {
	/** Distinct child pages linked from the section. Saturates at 20. */
	linkedPageCount: number;
	/** Distinct memory records that cited the section. Saturates at 30. */
	supportingRecordCount: number;
	/** Days between first_source_at and last_source_at. Saturates at 30. */
	temporalSpreadDays: number;
	/** 0..1 — fraction of linked pages sharing at least one observed tag. */
	coherence: number;
	/** Rendered body length (markdown characters). Saturates at ~1800. */
	bodyLength: number;
}

export interface PromotionScoreResult {
	/** 0..1 composite score. */
	score: number;
	/** "none" / "candidate" / "promote_ready" under the current thresholds. */
	status: "none" | "candidate" | "promote_ready";
	/** Per-signal contribution (for debugging + future tuning). */
	contributions: {
		linked: number;
		supporting: number;
		temporal: number;
		coherence: number;
		readability: number;
	};
}

export interface PromotionThresholds {
	/** Score at/above which we flip aggregation.promotion_status to 'candidate'. */
	candidate: number;
	/** Score at/above which the aggregation planner may promote. */
	promoteReady: number;
}

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = {
	candidate: 0.55,
	promoteReady: 0.75,
};

const WEIGHTS = {
	linked: 0.25,
	supporting: 0.25,
	temporal: 0.2,
	coherence: 0.15,
	readability: 0.15,
} as const;

const SATURATION = {
	linkedPageCount: 20,
	supportingRecordCount: 30,
	temporalSpreadDays: 30,
	bodyLength: 1800,
} as const;

/**
 * Compute a 0..1 promotion score from raw signals.
 */
export function scorePromotion(
	signals: PromotionSignals,
	thresholds: PromotionThresholds = DEFAULT_PROMOTION_THRESHOLDS,
): PromotionScoreResult {
	const linked =
		clamp01(signals.linkedPageCount / SATURATION.linkedPageCount) *
		WEIGHTS.linked;
	const supporting =
		clamp01(signals.supportingRecordCount / SATURATION.supportingRecordCount) *
		WEIGHTS.supporting;
	const temporal =
		clamp01(signals.temporalSpreadDays / SATURATION.temporalSpreadDays) *
		WEIGHTS.temporal;
	const coherence = clamp01(signals.coherence) * WEIGHTS.coherence;
	const readability =
		clamp01(signals.bodyLength / SATURATION.bodyLength) * WEIGHTS.readability;

	const score = round3(linked + supporting + temporal + coherence + readability);

	const status: PromotionScoreResult["status"] =
		score >= thresholds.promoteReady
			? "promote_ready"
			: score >= thresholds.candidate
				? "candidate"
				: "none";

	return {
		score,
		status,
		contributions: {
			linked: round3(linked),
			supporting: round3(supporting),
			temporal: round3(temporal),
			coherence: round3(coherence),
			readability: round3(readability),
		},
	};
}

/**
 * Convenience wrapper for the compiler: derives signals from the live
 * SectionAggregation + the section body, then scores. Keeps the signal-
 * extraction logic co-located with the scoring weights.
 */
export function scoreSectionAggregation(args: {
	aggregation: SectionAggregation;
	bodyMd: string;
	/** Tags observed on the linked child pages (dedup'd). Used to compute
	 *  coherence against `aggregation.observed_tags`. */
	linkedPageTagSets?: string[][];
	now?: Date;
	thresholds?: PromotionThresholds;
}): PromotionScoreResult {
	const a = args.aggregation;
	const linkedPageCount = a.linked_page_ids.length;
	const supportingRecordCount = a.supporting_record_count;
	const temporalSpreadDays = daysBetween(
		a.first_source_at,
		a.last_source_at,
		args.now,
	);
	const coherence = computeCoherence(
		a.observed_tags,
		args.linkedPageTagSets ?? [],
	);
	const bodyLength = args.bodyMd.length;

	return scorePromotion(
		{
			linkedPageCount,
			supportingRecordCount,
			temporalSpreadDays,
			coherence,
			bodyLength,
		},
		args.thresholds ?? DEFAULT_PROMOTION_THRESHOLDS,
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
	if (!Number.isFinite(x) || x <= 0) return 0;
	if (x >= 1) return 1;
	return x;
}

function round3(x: number): number {
	return Math.round(x * 1000) / 1000;
}

function daysBetween(
	first: string | null,
	last: string | null,
	now?: Date,
): number {
	if (!first) return 0;
	const firstMs = Date.parse(first);
	if (Number.isNaN(firstMs)) return 0;
	const lastMs = last ? Date.parse(last) : (now?.getTime() ?? Date.now());
	if (Number.isNaN(lastMs)) return 0;
	const ms = Math.max(0, lastMs - firstMs);
	return ms / (1000 * 60 * 60 * 24);
}

/**
 * Fraction of linked pages that share at least one tag with the section's
 * observed tag set. Returns 0 when the section has no observed tags (we
 * can't claim coherence without a reference set) and 0 when there are no
 * linked pages to measure.
 */
function computeCoherence(
	sectionTags: string[],
	linkedPageTagSets: string[][],
): number {
	if (sectionTags.length === 0) return 0;
	if (linkedPageTagSets.length === 0) return 0;
	const sectionSet = new Set(sectionTags.map((t) => t.toLowerCase()));
	let hits = 0;
	for (const tags of linkedPageTagSets) {
		for (const t of tags) {
			if (sectionSet.has(t.toLowerCase())) {
				hits += 1;
				break;
			}
		}
	}
	return hits / linkedPageTagSets.length;
}
