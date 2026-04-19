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
});
