import { describe, it, expect } from "vitest";
import { deriveParentCandidates } from "../lib/wiki/parent-expander.js";
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
});
