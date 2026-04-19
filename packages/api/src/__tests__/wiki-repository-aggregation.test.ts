/**
 * Unit tests for the pure parts of the hierarchical-aggregation repository
 * additions.
 *
 * These cover the merge/shape logic that runs before we touch Postgres. The
 * DB-touching helpers (setParentPage, recomputeHubness, listChildPages,
 * listRecentlyChangedPagesForAggregation) require a live Postgres with the
 * wiki_* tables migrated — they're exercised by integration work under
 * DATABASE_URL, not by the fast unit suite.
 */

import { describe, it, expect } from "vitest";
import {
	emptySectionAggregation,
	mergeSectionAggregation,
	type SectionAggregation,
} from "../lib/wiki/repository.js";

describe("emptySectionAggregation", () => {
	it("returns a fresh record with zeroed counts + empty arrays", () => {
		const empty = emptySectionAggregation();
		expect(empty).toEqual({
			linked_page_ids: [],
			supporting_record_count: 0,
			first_source_at: null,
			last_source_at: null,
			observed_tags: [],
			promotion_status: "none",
			promotion_score: 0,
			promoted_page_id: null,
		});
	});

	it("does not share array references across calls", () => {
		const a = emptySectionAggregation();
		const b = emptySectionAggregation();
		a.linked_page_ids.push("mutation");
		expect(b.linked_page_ids).toEqual([]);
	});
});

describe("mergeSectionAggregation", () => {
	it("returns a fresh empty-ish record when current is null and patch empty", () => {
		const merged = mergeSectionAggregation(null, {});
		expect(merged).toEqual(emptySectionAggregation());
	});

	it("overlays scalar keys from the patch", () => {
		const current = emptySectionAggregation();
		const merged = mergeSectionAggregation(current, {
			promotion_status: "candidate",
			promotion_score: 0.72,
			supporting_record_count: 8,
			last_source_at: "2026-04-19T00:00:00Z",
		});
		expect(merged.promotion_status).toBe("candidate");
		expect(merged.promotion_score).toBeCloseTo(0.72);
		expect(merged.supporting_record_count).toBe(8);
		expect(merged.last_source_at).toBe("2026-04-19T00:00:00Z");
	});

	it("preserves scalar keys not present on the patch", () => {
		const current: SectionAggregation = {
			...emptySectionAggregation(),
			supporting_record_count: 20,
			first_source_at: "2026-03-01T00:00:00Z",
			promotion_score: 0.6,
		};
		const merged = mergeSectionAggregation(current, {
			promotion_status: "candidate",
		});
		expect(merged.supporting_record_count).toBe(20);
		expect(merged.first_source_at).toBe("2026-03-01T00:00:00Z");
		expect(merged.promotion_score).toBeCloseTo(0.6);
	});

	it("replaces linked_page_ids with the patch and dedupes in order", () => {
		const current: SectionAggregation = {
			...emptySectionAggregation(),
			linked_page_ids: ["p1", "p2", "p3"],
		};
		const merged = mergeSectionAggregation(current, {
			linked_page_ids: ["p4", "p2", "p2", "p5", "p4"],
		});
		expect(merged.linked_page_ids).toEqual(["p4", "p2", "p5"]);
	});

	it("keeps current linked_page_ids when patch omits the field", () => {
		const current: SectionAggregation = {
			...emptySectionAggregation(),
			linked_page_ids: ["p1", "p2"],
		};
		const merged = mergeSectionAggregation(current, {
			promotion_score: 0.1,
		});
		expect(merged.linked_page_ids).toEqual(["p1", "p2"]);
	});

	it("dedupes observed_tags across replacement", () => {
		const merged = mergeSectionAggregation(null, {
			observed_tags: ["food", "travel", "food", "restaurant", "travel"],
		});
		expect(merged.observed_tags).toEqual(["food", "travel", "restaurant"]);
	});

	it("supports marking a section promoted without clearing provenance", () => {
		const current: SectionAggregation = {
			...emptySectionAggregation(),
			linked_page_ids: ["p1", "p2", "p3"],
			supporting_record_count: 40,
			first_source_at: "2026-03-01T00:00:00Z",
			last_source_at: "2026-04-19T00:00:00Z",
			observed_tags: ["restaurant", "austin"],
			promotion_status: "candidate",
			promotion_score: 0.81,
		};
		const merged = mergeSectionAggregation(current, {
			promotion_status: "promoted",
			promoted_page_id: "new-topic-page-id",
		});
		expect(merged.promotion_status).toBe("promoted");
		expect(merged.promoted_page_id).toBe("new-topic-page-id");
		// Provenance survives promotion so the parent section retains its
		// history for future review.
		expect(merged.linked_page_ids).toEqual(["p1", "p2", "p3"]);
		expect(merged.supporting_record_count).toBe(40);
		expect(merged.observed_tags).toEqual(["restaurant", "austin"]);
	});
});
