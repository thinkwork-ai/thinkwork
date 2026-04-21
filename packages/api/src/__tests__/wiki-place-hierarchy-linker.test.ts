import { describe, expect, it, vi } from "vitest";
import {
	emitPlaceHierarchyLinks,
	type PageWithPlace,
} from "../lib/wiki/deterministic-linker.js";
import type {
	WikiPageRow,
	WikiPlaceRow,
} from "../lib/wiki/repository.js";

const scope = { tenantId: "t-1", ownerId: "a-1" };

function page(overrides: Partial<PageWithPlace> = {}): PageWithPlace {
	return {
		id: "page-1",
		tenant_id: scope.tenantId,
		owner_id: scope.ownerId,
		place_id: "place-1",
		...overrides,
	};
}

function placeRow(overrides: Partial<WikiPlaceRow> = {}): WikiPlaceRow {
	return {
		id: "place-1",
		tenant_id: scope.tenantId,
		owner_id: scope.ownerId,
		name: "Paris",
		google_place_id: null,
		geo_lat: null,
		geo_lon: null,
		address: null,
		parent_place_id: null,
		place_kind: "city",
		source: "derived_hierarchy",
		source_payload: null,
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	};
}

function pageRow(overrides: Partial<WikiPageRow> = {}): WikiPageRow {
	return {
		id: "page-parent",
		tenant_id: scope.tenantId,
		owner_id: scope.ownerId,
		type: "topic",
		slug: "paris",
		title: "Paris",
		summary: null,
		body_md: null,
		status: "active",
		parent_page_id: null,
		place_id: null,
		hubness_score: 0,
		tags: [],
		last_compiled_at: null,
		created_at: new Date(),
		updated_at: new Date(),
		...overrides,
	};
}

describe("emitPlaceHierarchyLinks", () => {
	it("emits one reference edge per affected page to its parent's backing page", async () => {
		const writeLink = vi.fn().mockResolvedValue(true);
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [page({ id: "page-poi", place_id: "poi-1" })],
			findPlaceById: vi.fn().mockResolvedValue(
				placeRow({ id: "poi-1", parent_place_id: "city-1", place_kind: "poi" }),
			),
			findPageByPlaceId: vi
				.fn()
				.mockResolvedValue(pageRow({ id: "page-paris", slug: "paris" })),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
		expect(result.emissions).toHaveLength(1);
		expect(writeLink).toHaveBeenCalledWith(
			expect.objectContaining({
				fromPageId: "page-poi",
				toPageId: "page-paris",
				context: "deterministic:place:city-1",
				kind: "reference",
			}),
		);
	});

	it("skips pages without place_id", async () => {
		const writeLink = vi.fn();
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [page({ place_id: null })],
			findPlaceById: vi.fn(),
			findPageByPlaceId: vi.fn(),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(result.skipped[0].reason).toBe("no_place_id");
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("skips pages whose place is top-of-hierarchy (no parent)", async () => {
		const writeLink = vi.fn();
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [page({ id: "page-fr", place_id: "country-fr" })],
			findPlaceById: vi
				.fn()
				.mockResolvedValue(
					placeRow({ id: "country-fr", place_kind: "country", parent_place_id: null }),
				),
			findPageByPlaceId: vi.fn(),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(result.skipped[0].reason).toBe("top_of_hierarchy");
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("logs and skips when parent place has no backing page", async () => {
		const writeLink = vi.fn();
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [page()],
			findPlaceById: vi.fn().mockResolvedValue(
				placeRow({ parent_place_id: "orphan-parent" }),
			),
			findPageByPlaceId: vi.fn().mockResolvedValue(null),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(result.skipped[0].reason).toBe("parent_page_missing");
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("does not count edges when writeLink returns false (ON CONFLICT)", async () => {
		const writeLink = vi.fn().mockResolvedValue(false);
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [page()],
			findPlaceById: vi.fn().mockResolvedValue(
				placeRow({ parent_place_id: "parent-1" }),
			),
			findPageByPlaceId: vi.fn().mockResolvedValue(pageRow()),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(result.emissions).toHaveLength(0);
		expect(writeLink).toHaveBeenCalledTimes(1);
	});

	it("catches findPlaceById errors, continues with other pages", async () => {
		const writeLink = vi.fn().mockResolvedValue(true);
		const findPlaceById = vi
			.fn()
			.mockImplementationOnce(async () => {
				throw new Error("boom");
			})
			.mockResolvedValue(placeRow({ parent_place_id: "parent-1" }));
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [
				page({ id: "page-1", place_id: "place-1" }),
				page({ id: "page-2", place_id: "place-2" }),
			],
			findPlaceById,
			findPageByPlaceId: vi.fn().mockResolvedValue(pageRow()),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
		expect(writeLink).toHaveBeenCalledTimes(1);
	});

	it("emits edges for multiple pages in one call (chain)", async () => {
		const writeLink = vi.fn().mockResolvedValue(true);
		const result = await emitPlaceHierarchyLinks({
			scope,
			affectedPages: [
				page({ id: "page-poi-1", place_id: "poi-1" }),
				page({ id: "page-poi-2", place_id: "poi-2" }),
				page({ id: "page-city", place_id: "city-1" }),
			],
			findPlaceById: vi.fn().mockImplementation(async (args) => {
				if (args.id === "poi-1") return placeRow({ id: "poi-1", parent_place_id: "city-1" });
				if (args.id === "poi-2") return placeRow({ id: "poi-2", parent_place_id: "city-1" });
				if (args.id === "city-1")
					return placeRow({ id: "city-1", parent_place_id: "country-fr" });
				return null;
			}),
			findPageByPlaceId: vi.fn().mockImplementation(async (args) => {
				if (args.placeId === "city-1") return pageRow({ id: "page-city-paris" });
				if (args.placeId === "country-fr") return pageRow({ id: "page-france" });
				return null;
			}),
			writeLink,
		});
		expect(result.linksWritten).toBe(3);
		expect(writeLink).toHaveBeenCalledTimes(3);
	});
});
