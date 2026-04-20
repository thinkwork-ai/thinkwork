import { describe, it, expect } from "vitest";
import {
	deriveParentCandidates,
	deriveParentCandidatesFromPageSummaries,
	mergeParentCandidates,
} from "../lib/wiki/parent-expander.js";
import type { ThinkWorkMemoryRecord } from "../lib/memory/types.js";

function makeRecord(
	id: string,
	metadata: Record<string, unknown>,
): ThinkWorkMemoryRecord {
	return {
		id,
		tenantId: "t1",
		ownerType: "agent",
		ownerId: "a1",
		kind: "event",
		sourceType: "import",
		status: "active",
		content: { text: `record ${id}` },
		backendRefs: [{ backend: "hindsight", ref: id }],
		createdAt: "2026-04-18T00:00:00Z",
		updatedAt: "2026-04-18T00:00:00Z",
		metadata,
	};
}

describe("deriveParentCandidates", () => {
	it("returns no candidates when nothing clusters", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { place: { city: "Austin" } }),
		]);
		expect(out).toEqual([]);
	});

	it("emits a city candidate when >=2 records share a city", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				place: { city: "Austin", types: ["restaurant"] },
			}),
			makeRecord("r2", {
				place: { city: "Austin", types: ["restaurant"] },
			}),
		]);
		const austin = out.find((c) => c.reason === "city");
		expect(austin).toBeDefined();
		expect(austin?.parentTitle).toBe("Austin");
		expect(austin?.parentSlug).toBe("austin");
		expect(austin?.parentType).toBe("topic");
		expect(austin?.suggestedSectionSlug).toBe("restaurants");
		expect(austin?.sourceRecordIds.sort()).toEqual(["r1", "r2"]);
	});

	it("picks coffee section when place_types includes cafe", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { place: { city: "Portland", types: ["cafe"] } }),
			makeRecord("r2", { place: { city: "Portland", types: ["cafe"] } }),
		]);
		const coffee = out.find((c) => c.reason === "city");
		expect(coffee?.suggestedSectionSlug).toBe("coffee");
	});

	it("supports flat place_types at top level", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { city: "Dallas", place_types: ["restaurant"] }),
			makeRecord("r2", { city: "Dallas", place_types: ["restaurant"] }),
		]);
		const dallas = out.find((c) => c.reason === "city");
		expect(dallas?.parentTitle).toBe("Dallas");
		expect(dallas?.suggestedSectionSlug).toBe("restaurants");
	});

	it("emits a journal candidate when journal_id repeats", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				journal_id: "j-mexico-2024",
				journal: { title: "Mexico 2024" },
			}),
			makeRecord("r2", { journal_id: "j-mexico-2024" }),
		]);
		const trip = out.find((c) => c.reason === "journal");
		expect(trip).toBeDefined();
		expect(trip?.parentTitle).toBe("Mexico 2024");
		expect(trip?.suggestedSectionSlug).toBe("entries");
	});

	it("collapses tag clusters across records", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { tags: ["restaurant", "food"] }),
			makeRecord("r2", { tags: ["restaurant"] }),
			makeRecord("r3", { tags: ["restaurant", "food"] }),
		]);
		const restaurant = out.find(
			(c) => c.reason === "tag_cluster" && c.parentTitle === "Restaurant",
		);
		expect(restaurant?.supportingCount).toBe(3);
		const food = out.find(
			(c) => c.reason === "tag_cluster" && c.parentTitle === "Food",
		);
		expect(food?.supportingCount).toBe(2);
	});

	it("respects minClusterSize threshold", () => {
		const records = [
			makeRecord("r1", { tags: ["coffee"] }),
			makeRecord("r2", { tags: ["coffee"] }),
			makeRecord("r3", { tags: ["coffee"] }),
		];
		const strict = deriveParentCandidates(records, { minClusterSize: 5 });
		expect(strict).toEqual([]);
		const loose = deriveParentCandidates(records, { minClusterSize: 1 });
		expect(loose.find((c) => c.reason === "tag_cluster")?.supportingCount).toBe(
			3,
		);
	});

	it("sorts candidates by supportingCount desc", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { place: { city: "Austin" } }),
			makeRecord("r2", { place: { city: "Austin" } }),
			makeRecord("r3", { place: { city: "Austin" } }),
			makeRecord("r4", { tags: ["restaurant"] }),
			makeRecord("r5", { tags: ["restaurant"] }),
		]);
		expect(out.map((c) => c.supportingCount)).toEqual([3, 2]);
	});

	it("ignores records with no extractable metadata", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {}),
			makeRecord("r2", { unrelated: "value" }),
		]);
		expect(out).toEqual([]);
	});

	// --- Journal-import shape (Marco's bank) ---------------------------------

	it("extracts city from place_address when no explicit city key exists", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				place_name: "Nana",
				place_address: "785 Queen St W, Toronto, ON M6J 1G1, Canada",
			}),
			makeRecord("r2", {
				place_name: "Momofuku",
				place_address: "190 University Ave, Toronto, ON M5H 0A3, Canada",
			}),
		]);
		const toronto = out.find((c) => c.reason === "city");
		expect(toronto?.parentTitle).toBe("Toronto");
		expect(toronto?.supportingCount).toBe(2);
	});

	it("extracts city from US-format address with state+zip", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				place_address: "123 Main St, Austin, TX 78701, USA",
				place_types: "restaurant, food",
			}),
			makeRecord("r2", {
				place_address: "456 Elm Ave, Austin, TX 78702, USA",
				place_types: "restaurant, food",
			}),
		]);
		const austin = out.find((c) => c.reason === "city");
		expect(austin?.parentTitle).toBe("Austin");
		expect(austin?.suggestedSectionSlug).toBe("restaurants");
	});

	it("accepts place_types as comma-separated string", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				place_address: "1 Coffee Ln, Portland, OR 97201, USA",
				place_types: "cafe, food",
			}),
			makeRecord("r2", {
				place_address: "2 Espresso Rd, Portland, OR 97202, USA",
				place_types: "cafe",
			}),
		]);
		expect(out.find((c) => c.reason === "city")?.suggestedSectionSlug).toBe(
			"coffee",
		);
	});

	it("reads idea_tags as comma-separated tags", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { idea_tags: "restaurant, food" }),
			makeRecord("r2", { idea_tags: "restaurant" }),
			makeRecord("r3", { idea_tags: "restaurant, food" }),
		]);
		const restaurant = out.find(
			(c) => c.reason === "tag_cluster" && c.parentTitle === "Restaurant",
		);
		expect(restaurant?.supportingCount).toBe(3);
		const food = out.find(
			(c) => c.reason === "tag_cluster" && c.parentTitle === "Food",
		);
		expect(food?.supportingCount).toBe(2);
	});

	it("treats 'London, UK' as a city", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { place_address: "1 Oxford St, London, UK" }),
			makeRecord("r2", { place_address: "10 Soho Sq, London, UK" }),
		]);
		expect(out.find((c) => c.reason === "city")?.parentTitle).toBe("London");
	});

	// Regression tests for the 2026-04-20 Marco audit — European addresses
	// (no US-style "ST 12345" region code) previously produced broken
	// "ZIPCODE City" candidates that never matched existing wiki pages.
	it("strips French leading postcode from ZIPCODE-city fallback", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				place_address: "11 Rue Bernard Palissy, 75006 Paris, France",
			}),
			makeRecord("r2", {
				place_address: "27 Rue Augereau, 75007 Paris, France",
			}),
		]);
		expect(out.find((c) => c.reason === "city")?.parentTitle).toBe("Paris");
	});

	it("strips leading postcode for a two-part European address", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", { place_address: "26110 Vinsobres, France" }),
			makeRecord("r2", { place_address: "26110 Vinsobres, France" }),
		]);
		expect(out.find((c) => c.reason === "city")?.parentTitle).toBe("Vinsobres");
	});

	it("resolves Mexican addresses with CDMX four-letter region code", () => {
		const out = deriveParentCandidates([
			makeRecord("r1", {
				place_address: "José María Izazaga 8, Centro, 06000 Ciudad de México, CDMX, Mexico",
			}),
			makeRecord("r2", {
				place_address: "Av. Insurgentes 100, 06000 Ciudad de México, CDMX, Mexico",
			}),
		]);
		expect(out.find((c) => c.reason === "city")?.parentTitle).toBe(
			"Ciudad De México",
		);
	});

	it("does not mistake the trailing country token for a region code", () => {
		// Before the "skip last part" fix, widening the region-code regex
		// to `{2,4}` made "USA" swallow the match and return "TX 78701".
		const out = deriveParentCandidates([
			makeRecord("r1", { place_address: "1 Elm St, Austin, TX 78701, USA" }),
			makeRecord("r2", { place_address: "2 Oak Ave, Austin, TX 78702, USA" }),
		]);
		expect(out.find((c) => c.reason === "city")?.parentTitle).toBe("Austin");
	});
});

describe("deriveParentCandidatesFromPageSummaries", () => {
	it("extracts a city cluster from page summaries", () => {
		const out = deriveParentCandidatesFromPageSummaries([
			{ id: "p1", title: "Momofuku Daishō", summary: "Korean-inspired restaurant in Toronto." },
			{ id: "p2", title: "Nana", summary: "Thai restaurant in Toronto." },
			{ id: "p3", title: "Franklin Barbecue", summary: "BBQ joint in Austin, TX." },
		]);
		const toronto = out.find((c) => c.parentTitle === "Toronto");
		expect(toronto?.supportingCount).toBe(2);
		expect(toronto?.sourceRecordIds.sort()).toEqual(["p1", "p2"]);
		// Austin only has 1 page — below default minClusterSize, so no hub.
		expect(out.find((c) => c.parentTitle === "Austin")).toBeUndefined();
	});

	it("preserves accented city names in preposition matches", () => {
		// Regression for the 2026-04-20 audit — the earlier `[A-Za-z]+`
		// class truncated "Bogotá" to "Bogot", creating nonsense candidates.
		const out = deriveParentCandidatesFromPageSummaries([
			{ id: "p1", title: "Andrés", summary: "Cafe in Bogotá." },
			{ id: "p2", title: "Leo", summary: "Restaurant in Bogotá." },
			{ id: "p3", title: "Joe's", summary: "Cafe in Montréal." },
			{ id: "p4", title: "Ma Poule", summary: "Bistro in Montréal." },
		]);
		expect(out.find((c) => c.parentTitle === "Bogotá")?.supportingCount).toBe(2);
		expect(out.find((c) => c.parentTitle === "Montréal")?.supportingCount).toBe(2);
	});

	it("respects minClusterSize=1 for single-page hubs", () => {
		const out = deriveParentCandidatesFromPageSummaries(
			[{ id: "p1", title: "Franklin", summary: "BBQ joint in Austin." }],
			{ minClusterSize: 1 },
		);
		expect(out.find((c) => c.parentTitle === "Austin")?.supportingCount).toBe(
			1,
		);
	});

	it("ignores pages with no usable summary", () => {
		const out = deriveParentCandidatesFromPageSummaries([
			{ id: "p1", title: "X", summary: null },
			{ id: "p2", title: "Y", summary: "" },
			{ id: "p3", title: "Z", summary: "a thing with no city reference" },
		]);
		expect(out).toEqual([]);
	});

	it("strips trailing state codes from matches", () => {
		const out = deriveParentCandidatesFromPageSummaries(
			[
				{ id: "p1", title: "X", summary: "Located in Austin, TX and popular." },
				{ id: "p2", title: "Y", summary: "A spot in Austin, TX with great views." },
			],
		);
		expect(out.find((c) => c.parentTitle === "Austin")?.supportingCount).toBe(
			2,
		);
	});

	// Address-style summaries are what gpt-oss actually writes — the
	// preposition regex alone missed them on real Marco data.
	it("extracts city from inline postal address in summary", () => {
		const out = deriveParentCandidatesFromPageSummaries([
			{
				id: "p1",
				title: "Momofuku Daishō",
				summary: "Korean restaurant at 190 University Avenue, Toronto, ON M5H 0A3, Canada.",
			},
			{
				id: "p2",
				title: "Nana",
				summary: "Thai joint at 785 Queen St W, Toronto, ON M6J 1G1, Canada.",
			},
		]);
		const toronto = out.find((c) => c.parentTitle === "Toronto");
		expect(toronto?.supportingCount).toBe(2);
	});

	it("prefers preposition match over address fallback", () => {
		// Both patterns would match "Austin" here — just make sure we don't
		// double-count by using both paths on the same summary.
		const out = deriveParentCandidatesFromPageSummaries([
			{
				id: "p1",
				title: "Foo",
				summary: "Restaurant in Austin, at 123 Main St, Austin, TX 78701, USA.",
			},
			{
				id: "p2",
				title: "Bar",
				summary: "Restaurant in Austin, at 456 Other St, Austin, TX 78702, USA.",
			},
		]);
		const austin = out.find((c) => c.parentTitle === "Austin");
		expect(austin?.supportingCount).toBe(2);
	});
});

describe("mergeParentCandidates", () => {
	it("unions supporting ids across lists keyed by slug", () => {
		const a = deriveParentCandidates([
			makeRecord("r1", { place_address: "1 A, Toronto, ON M6J 1G1, Canada" }),
			makeRecord("r2", { place_address: "2 B, Toronto, ON M6J 1G2, Canada" }),
		]);
		const b = deriveParentCandidatesFromPageSummaries([
			{ id: "p9", title: "Pai", summary: "Thai kitchen in Toronto." },
			{ id: "p10", title: "Canoe", summary: "Fine dining in Toronto." },
		]);
		const merged = mergeParentCandidates(a, b);
		const toronto = merged.find((c) => c.parentSlug === "toronto");
		expect(toronto?.supportingCount).toBe(4);
		expect(new Set(toronto?.sourceRecordIds)).toEqual(
			new Set(["r1", "r2", "p9", "p10"]),
		);
	});

	it("returns [] when no inputs", () => {
		expect(mergeParentCandidates()).toEqual([]);
		expect(mergeParentCandidates([], [])).toEqual([]);
	});
});
