import { describe, it, expect } from "vitest";
import {
	DEFAULT_PROMOTION_THRESHOLDS,
	scorePromotion,
	scoreSectionAggregation,
} from "../lib/wiki/promotion-scorer.js";
import { emptySectionAggregation } from "../lib/wiki/repository.js";

describe("scorePromotion", () => {
	it("returns 0 + 'none' for empty signals", () => {
		const r = scorePromotion({
			linkedPageCount: 0,
			supportingRecordCount: 0,
			temporalSpreadDays: 0,
			coherence: 0,
			bodyLength: 0,
		});
		expect(r.score).toBe(0);
		expect(r.status).toBe("none");
	});

	it("returns 1.0 + 'promote_ready' when every signal saturates", () => {
		const r = scorePromotion({
			linkedPageCount: 25, // > saturation=20
			supportingRecordCount: 40, // > saturation=30
			temporalSpreadDays: 60, // > saturation=30
			coherence: 1,
			bodyLength: 3000, // > saturation=1800
		});
		expect(r.score).toBeCloseTo(1.0);
		expect(r.status).toBe("promote_ready");
	});

	it("flags 'candidate' once the composite crosses 0.55", () => {
		const r = scorePromotion({
			linkedPageCount: 12,
			supportingRecordCount: 18,
			temporalSpreadDays: 20,
			coherence: 0.5,
			bodyLength: 1200,
		});
		expect(r.score).toBeGreaterThanOrEqual(
			DEFAULT_PROMOTION_THRESHOLDS.candidate,
		);
		expect(r.score).toBeLessThan(DEFAULT_PROMOTION_THRESHOLDS.promoteReady);
		expect(r.status).toBe("candidate");
	});

	it("clamps negative / non-finite inputs to 0", () => {
		const r = scorePromotion({
			linkedPageCount: -5,
			supportingRecordCount: Number.NaN,
			temporalSpreadDays: -Infinity,
			coherence: -1,
			bodyLength: 0,
		});
		expect(r.score).toBe(0);
	});

	it("respects custom thresholds", () => {
		// linkedPageCount=10 → 10/20 * 0.25 = 0.125 composite
		const signals = {
			linkedPageCount: 10,
			supportingRecordCount: 0,
			temporalSpreadDays: 0,
			coherence: 0,
			bodyLength: 0,
		};
		const strict = scorePromotion(signals);
		expect(strict.status).toBe("none");

		const low = { candidate: 0.05, promoteReady: 0.1 };
		const r = scorePromotion(signals, low);
		expect(r.score).toBeCloseTo(0.125);
		expect(r.status).toBe("promote_ready");
	});

	it("separates contributions per signal for debugging", () => {
		const r = scorePromotion({
			linkedPageCount: 20,
			supportingRecordCount: 0,
			temporalSpreadDays: 0,
			coherence: 0,
			bodyLength: 0,
		});
		expect(r.contributions.linked).toBeCloseTo(0.25);
		expect(r.contributions.supporting).toBe(0);
		expect(r.contributions.temporal).toBe(0);
		expect(r.contributions.coherence).toBe(0);
		expect(r.contributions.readability).toBe(0);
	});
});

describe("scoreSectionAggregation", () => {
	it("derives temporal spread from aggregation.first_source_at/last_source_at", () => {
		const agg = {
			...emptySectionAggregation(),
			linked_page_ids: ["p1", "p2", "p3", "p4", "p5", "p6"],
			supporting_record_count: 12,
			first_source_at: "2026-01-01T00:00:00Z",
			last_source_at: "2026-01-31T00:00:00Z",
			observed_tags: ["restaurant"],
		};
		const r = scoreSectionAggregation({
			aggregation: agg,
			bodyMd: "x".repeat(1000),
			linkedPageTagSets: [
				["restaurant"],
				["restaurant"],
				["coffee"],
				["restaurant"],
				[],
				["restaurant"],
			],
		});
		// 4 of 6 linked pages share the 'restaurant' tag → coherence ≈ 0.67
		expect(r.contributions.coherence).toBeGreaterThan(0);
		expect(r.contributions.temporal).toBeCloseTo(
			(30 / 30) * 0.2, // fully saturates at 30 days
			2,
		);
		expect(r.status).toMatch(/candidate|promote_ready/);
	});

	it("returns coherence=0 when the section has no observed tags", () => {
		const agg = {
			...emptySectionAggregation(),
			linked_page_ids: ["p1", "p2"],
			supporting_record_count: 5,
			first_source_at: "2026-01-01T00:00:00Z",
			last_source_at: "2026-01-10T00:00:00Z",
			observed_tags: [],
		};
		const r = scoreSectionAggregation({
			aggregation: agg,
			bodyMd: "body",
			linkedPageTagSets: [["x"], ["y"]],
		});
		expect(r.contributions.coherence).toBe(0);
	});

	it("handles missing timestamps without throwing", () => {
		const agg = {
			...emptySectionAggregation(),
			linked_page_ids: ["p1"],
			supporting_record_count: 1,
			first_source_at: null,
			last_source_at: null,
		};
		expect(() =>
			scoreSectionAggregation({ aggregation: agg, bodyMd: "" }),
		).not.toThrow();
	});
});
