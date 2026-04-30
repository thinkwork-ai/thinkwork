import type { ContextHit } from "../context-engine/types.js";

export interface PromotionDecision {
	shouldPromote: boolean;
	reason: string;
	score: number;
}

const DEFAULT_THRESHOLD = 0.7;

export function shouldPromoteKbHit(
	hit: ContextHit,
	existingCompiledText = "",
	threshold = DEFAULT_THRESHOLD,
): PromotionDecision {
	const score = typeof hit.score === "number" ? hit.score : 0;
	if (score < threshold) {
		return { shouldPromote: false, reason: "score_below_threshold", score };
	}
	if (hasTextConflict(hit.snippet, existingCompiledText)) {
		return { shouldPromote: false, reason: "compiled_conflict_detected", score };
	}
	return { shouldPromote: true, reason: "would_promote", score };
}

function hasTextConflict(candidate: string, existing: string): boolean {
	const lowerCandidate = candidate.toLowerCase();
	const lowerExisting = existing.toLowerCase();
	const conflictPairs = [
		["diesel", "gasoline"],
		["approved", "rejected"],
		["active", "cancelled"],
	];
	return conflictPairs.some(
		([a, b]) =>
			(lowerCandidate.includes(a) && lowerExisting.includes(b)) ||
			(lowerCandidate.includes(b) && lowerExisting.includes(a)),
	);
}
