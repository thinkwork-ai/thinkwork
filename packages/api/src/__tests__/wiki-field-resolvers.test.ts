/**
 * Unit tests for the `WikiPage` GraphQL field resolvers (Unit 8 / handoff
 * plan item #3). The resolvers are thin adapters over repository queries,
 * so these tests mock the repository module directly and assert shape +
 * edge-case behavior (null parents, archived pages, clamped limits).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const repoMocks = vi.hoisted(() => ({
	countSourceMemoriesForPage: vi.fn(),
	listSourceMemoryIdsForPage: vi.fn(),
	findPageById: vi.fn(),
	findPromotedFromSection: vi.fn(),
	listActiveChildPages: vi.fn(),
	listSectionChildPages: vi.fn(),
}));

vi.mock("../lib/wiki/repository.js", () => ({
	countSourceMemoriesForPage: (...a: unknown[]) =>
		repoMocks.countSourceMemoriesForPage(...a),
	listSourceMemoryIdsForPage: (...a: unknown[]) =>
		repoMocks.listSourceMemoryIdsForPage(...a),
	findPageById: (...a: unknown[]) => repoMocks.findPageById(...a),
	findPromotedFromSection: (...a: unknown[]) =>
		repoMocks.findPromotedFromSection(...a),
	listActiveChildPages: (...a: unknown[]) => repoMocks.listActiveChildPages(...a),
	listSectionChildPages: (...a: unknown[]) =>
		repoMocks.listSectionChildPages(...a),
}));

import { wikiPageTypeResolvers } from "../graphql/resolvers/wiki/fieldResolvers.js";
import type { GraphQLWikiPage } from "../graphql/resolvers/wiki/mappers.js";

function page(over: Partial<GraphQLWikiPage> = {}): GraphQLWikiPage {
	return {
		id: "page-1",
		tenantId: "t1",
		ownerId: "o1",
		type: "ENTITY",
		slug: "demo",
		title: "Demo",
		summary: null,
		bodyMd: null,
		status: "active",
		lastCompiledAt: null,
		createdAt: "2026-04-20T00:00:00.000Z",
		updatedAt: "2026-04-20T00:00:00.000Z",
		sections: [],
		aliases: [],
		_parentPageId: null,
		...over,
	};
}

function pageRow(over: Record<string, unknown> = {}) {
	return {
		id: "row-1",
		tenant_id: "t1",
		owner_id: "o1",
		type: "topic",
		slug: "row",
		title: "Row",
		summary: null,
		body_md: null,
		status: "active",
		last_compiled_at: null,
		created_at: new Date("2026-04-20T00:00:00.000Z"),
		updated_at: new Date("2026-04-20T00:00:00.000Z"),
		parent_page_id: null,
		...over,
	};
}

beforeEach(() => {
	for (const m of Object.values(repoMocks)) m.mockReset();
});

describe("WikiPage.sourceMemoryCount", () => {
	it("passes the page id through to the repository", async () => {
		repoMocks.countSourceMemoriesForPage.mockResolvedValue(7);
		const result = await wikiPageTypeResolvers.sourceMemoryCount(
			page({ id: "p-42" }),
		);
		expect(result).toBe(7);
		expect(repoMocks.countSourceMemoriesForPage).toHaveBeenCalledWith("p-42");
	});
});

describe("WikiPage.sourceMemoryIds", () => {
	it("defaults to limit=10 when arg is null/absent", async () => {
		repoMocks.listSourceMemoryIdsForPage.mockResolvedValue(["m1", "m2"]);
		const result = await wikiPageTypeResolvers.sourceMemoryIds(page(), {
			limit: null,
		});
		expect(result).toEqual(["m1", "m2"]);
		expect(repoMocks.listSourceMemoryIdsForPage).toHaveBeenCalledWith(
			"page-1",
			10,
		);
	});

	it("forwards caller's limit — the repo layer does the clamp", async () => {
		repoMocks.listSourceMemoryIdsForPage.mockResolvedValue([]);
		await wikiPageTypeResolvers.sourceMemoryIds(page(), { limit: 999 });
		expect(repoMocks.listSourceMemoryIdsForPage).toHaveBeenCalledWith(
			"page-1",
			999,
		);
	});
});

describe("WikiPage.parent", () => {
	it("returns null when the page has no parent", async () => {
		const result = await wikiPageTypeResolvers.parent(
			page({ _parentPageId: null }),
		);
		expect(result).toBeNull();
		expect(repoMocks.findPageById).not.toHaveBeenCalled();
	});

	it("returns null when the parent page is archived", async () => {
		repoMocks.findPageById.mockResolvedValue(pageRow({ status: "archived" }));
		const result = await wikiPageTypeResolvers.parent(
			page({ _parentPageId: "parent-1" }),
		);
		expect(result).toBeNull();
	});

	it("maps the parent row through toGraphQLPage", async () => {
		repoMocks.findPageById.mockResolvedValue(
			pageRow({
				id: "parent-1",
				type: "topic",
				slug: "paris",
				title: "Paris",
				parent_page_id: null,
			}),
		);
		const result = await wikiPageTypeResolvers.parent(
			page({ _parentPageId: "parent-1" }),
		);
		expect(result).toMatchObject({
			id: "parent-1",
			type: "TOPIC",
			slug: "paris",
			title: "Paris",
		});
	});
});

describe("WikiPage.children", () => {
	it("maps every active child row", async () => {
		repoMocks.listActiveChildPages.mockResolvedValue([
			pageRow({ id: "c1", slug: "c1", title: "Child 1" }),
			pageRow({ id: "c2", slug: "c2", title: "Child 2" }),
		]);
		const result = await wikiPageTypeResolvers.children(page({ id: "parent" }));
		expect(result.map((p) => p.id)).toEqual(["c1", "c2"]);
		expect(repoMocks.listActiveChildPages).toHaveBeenCalledWith("parent");
	});

	it("returns [] when no children exist", async () => {
		repoMocks.listActiveChildPages.mockResolvedValue([]);
		expect(await wikiPageTypeResolvers.children(page())).toEqual([]);
	});
});

describe("WikiPage.promotedFromSection", () => {
	it("returns null when no promotion linkage exists", async () => {
		repoMocks.findPromotedFromSection.mockResolvedValue(null);
		const result = await wikiPageTypeResolvers.promotedFromSection(page());
		expect(result).toBeNull();
		expect(repoMocks.findPageById).not.toHaveBeenCalled();
	});

	it("returns null when the parent page has since been archived", async () => {
		repoMocks.findPromotedFromSection.mockResolvedValue({
			parentPageId: "p-arch",
			sectionId: "s-1",
			sectionSlug: "restaurants",
			sectionHeading: "Restaurants",
		});
		repoMocks.findPageById.mockResolvedValue(pageRow({ status: "archived" }));
		expect(await wikiPageTypeResolvers.promotedFromSection(page())).toBeNull();
	});

	it("returns the full shape when promoted from an active parent", async () => {
		repoMocks.findPromotedFromSection.mockResolvedValue({
			parentPageId: "paris",
			sectionId: "s-1",
			sectionSlug: "restaurants",
			sectionHeading: "Restaurants",
		});
		repoMocks.findPageById.mockResolvedValue(
			pageRow({ id: "paris", slug: "paris", title: "Paris", type: "topic" }),
		);
		const result = await wikiPageTypeResolvers.promotedFromSection(page());
		expect(result).toMatchObject({
			parentPage: { id: "paris", title: "Paris", type: "TOPIC" },
			sectionSlug: "restaurants",
			sectionHeading: "Restaurants",
		});
	});
});

describe("WikiPage.sectionChildren", () => {
	it("passes (pageId, sectionSlug) to the repository and maps rows", async () => {
		repoMocks.listSectionChildPages.mockResolvedValue([
			pageRow({ id: "child-1", title: "Child 1" }),
		]);
		const result = await wikiPageTypeResolvers.sectionChildren(
			page({ id: "parent-1" }),
			{ sectionSlug: "restaurants" },
		);
		expect(repoMocks.listSectionChildPages).toHaveBeenCalledWith({
			pageId: "parent-1",
			sectionSlug: "restaurants",
		});
		expect(result.map((p) => p.id)).toEqual(["child-1"]);
	});

	it("returns [] when the section has no aggregation metadata", async () => {
		repoMocks.listSectionChildPages.mockResolvedValue([]);
		expect(
			await wikiPageTypeResolvers.sectionChildren(page(), {
				sectionSlug: "nonexistent",
			}),
		).toEqual([]);
	});
});
