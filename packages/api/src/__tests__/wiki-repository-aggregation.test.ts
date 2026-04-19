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
	isValidUuid,
	mergeSectionAggregation,
	stripWikilinks,
	type SectionAggregation,
} from "../lib/wiki/repository.js";
import { linkifyKnownEntities } from "../lib/wiki/compiler.js";

describe("linkifyKnownEntities", () => {
	const refs = [
		{ type: "entity" as const, slug: "austin", title: "Austin" },
		{
			type: "entity" as const,
			slug: "austin-nature-science-center",
			title: "Austin Nature & Science Center",
		},
		{
			type: "entity" as const,
			slug: "order-vqod414y",
			title: "Order vqod414y",
		},
	];

	it("wraps bolded known titles in markdown links", () => {
		const body = "- **Order vqod414y** – from FILM FLEET LLC";
		expect(linkifyKnownEntities(body, refs)).toBe(
			"- [**Order vqod414y**](/wiki/entity/order-vqod414y) – from FILM FLEET LLC",
		);
	});

	it("prefers longer title matches over shorter prefixes", () => {
		const body = "Visit **Austin Nature & Science Center** and **Austin**.";
		const out = linkifyKnownEntities(body, refs);
		expect(out).toContain(
			"[**Austin Nature & Science Center**](/wiki/entity/austin-nature-science-center)",
		);
		expect(out).toContain("[**Austin**](/wiki/entity/austin)");
		// The longer title should have replaced first; the embedded "Austin"
		// inside it must NOT have been double-linked.
		expect(out).not.toContain("[**Austin**](/wiki/entity/austin) Nature");
	});

	it("leaves untitled or unknown bold mentions alone", () => {
		const body = "- **Unknown Thing** — not in scope";
		expect(linkifyKnownEntities(body, refs)).toBe(body);
	});

	it("is idempotent — already-linked mentions stay linked once", () => {
		const once = linkifyKnownEntities("**Austin**", refs);
		const twice = linkifyKnownEntities(once, refs);
		expect(twice).toBe(once);
	});

	it("returns empty string on null/undefined body", () => {
		expect(linkifyKnownEntities(null, refs)).toBe("");
		expect(linkifyKnownEntities(undefined, refs)).toBe("");
	});

	it("returns body unchanged when refs is empty", () => {
		const body = "- **Austin** — not linked";
		expect(linkifyKnownEntities(body, [])).toBe(body);
	});

	it("escapes regex metacharacters in titles", () => {
		const tricky = [
			{
				type: "entity" as const,
				slug: "johnson-s",
				title: "Johnson's (Grocery)",
			},
		];
		const body = "Went to **Johnson's (Grocery)** yesterday.";
		expect(linkifyKnownEntities(body, tricky)).toBe(
			"Went to [**Johnson's (Grocery)**](/wiki/entity/johnson-s) yesterday.",
		);
	});
});

describe("stripWikilinks", () => {
	it("returns empty string for null/undefined", () => {
		expect(stripWikilinks(null)).toBe("");
		expect(stripWikilinks(undefined)).toBe("");
		expect(stripWikilinks("")).toBe("");
	});

	it("unwraps simple [[Title]] brackets", () => {
		expect(stripWikilinks("Visit [[Austin]] for BBQ.")).toBe(
			"Visit Austin for BBQ.",
		);
	});

	it("handles [[Title|Display]] piped form", () => {
		expect(stripWikilinks("See [[Tom's Dive & Swim|the camp]] listing.")).toBe(
			"See the camp listing.",
		);
	});

	it("unwraps multiple brackets in one body", () => {
		expect(
			stripWikilinks(
				"- [[Tom's Dive & Swim]] – 10-week camp for 4-year-olds\n- [[Goldfish Swim School]] – Jump Start Clinics",
			),
		).toBe(
			"- Tom's Dive & Swim – 10-week camp for 4-year-olds\n- Goldfish Swim School – Jump Start Clinics",
		);
	});

	it("leaves plain markdown links alone", () => {
		expect(stripWikilinks("See [the docs](https://example.com)")).toBe(
			"See [the docs](https://example.com)",
		);
	});
});

describe("isValidUuid", () => {
	it("accepts canonical RFC 4122 UUIDs", () => {
		expect(isValidUuid("f4a3f29b-efab-487e-b53f-33381163d168")).toBe(true);
		expect(isValidUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
	});

	it("accepts mixed-case UUIDs", () => {
		expect(isValidUuid("F4A3F29B-EFAB-487E-B53F-33381163D168")).toBe(true);
	});

	it("rejects truncated / hallucinated LLM output", () => {
		expect(isValidUuid("814e6b70")).toBe(false);
		expect(isValidUuid("f4a3f29b-efab-487e-b53f")).toBe(false);
		expect(isValidUuid("not-a-uuid")).toBe(false);
	});

	it("rejects non-strings", () => {
		expect(isValidUuid(undefined)).toBe(false);
		expect(isValidUuid(null)).toBe(false);
		expect(isValidUuid(123)).toBe(false);
		expect(isValidUuid({})).toBe(false);
	});

	it("rejects UUIDs with wrapping whitespace or quotes", () => {
		expect(isValidUuid(" f4a3f29b-efab-487e-b53f-33381163d168")).toBe(false);
		expect(isValidUuid('"f4a3f29b-efab-487e-b53f-33381163d168"')).toBe(false);
	});
});

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
