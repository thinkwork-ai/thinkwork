import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
	mockExecute: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => ({
	db: {
		execute: mockExecute,
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return {
		...actual,
		sql: (...xs: unknown[]) => xs,
	};
});

import {
	buildPrefixTsQuery,
	normalizeWikiSearchTerms,
	searchWikiForUser,
} from "../lib/wiki/search.js";

function makeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "page-1",
		tenant_id: "t1",
		owner_id: "user-1",
		type: "entity",
		slug: "gogo-fresh",
		title: "GoGo Fresh Food Cafe",
		summary: "Cafe/Restaurant in Miami Beach.",
		body_md: "Fresh empanada eaten near Miami Beach.",
		status: "active",
		last_compiled_at: "2026-04-18T12:00:00Z",
		created_at: "2026-04-01T00:00:00Z",
		updated_at: "2026-04-18T12:00:00Z",
		score: 0.75,
		matched_alias: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockExecute.mockReset();
});

describe("wiki search query normalization", () => {
	it("extracts normalized searchable terms from separator-heavy input", () => {
		expect(
			normalizeWikiSearchTerms("GoGo Fresh Food Cafe/Restaurant, Miami Beach!"),
		).toEqual([
			"gogo",
			"fresh",
			"food",
			"cafe",
			"restaurant",
			"miami",
			"beach",
		]);
	});

	it("builds an all-term prefix tsquery from safe terms", () => {
		expect(buildPrefixTsQuery("restaurant empan")).toBe(
			"restaurant:* & empan:*",
		);
	});

	it("drops punctuation-only and one-letter fragments", () => {
		expect(normalizeWikiSearchTerms(" / ' a ! ")).toEqual([]);
		expect(buildPrefixTsQuery(" / ' a ! ")).toBeNull();
	});
});

describe("searchWikiForUser", () => {
	it("returns [] for punctuation-only input without querying the database", async () => {
		await expect(
			searchWikiForUser({
				tenantId: "t1",
				userId: "user-1",
				query: " / ' a ! ",
				limit: 20,
			}),
		).resolves.toEqual([]);
		expect(mockExecute).not.toHaveBeenCalled();
	});

	it("uses search_tsv with plain and prefix tsqueries for restaurant searches", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [makeRow()] });

		const out = await searchWikiForUser({
			tenantId: "t1",
			userId: "user-1",
			query: "restaurant",
			limit: 20,
		});

		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			score: 0.75,
			matchedAlias: null,
			page: {
				id: "page-1",
				type: "ENTITY",
				slug: "gogo-fresh",
				title: "GoGo Fresh Food Cafe",
			},
		});

		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("p.search_tsv @@ plainto_tsquery");
		expect(flattened).toContain("p.search_tsv @@ to_tsquery");
		expect(flattened).toContain("restaurant:*");
		expect(flattened).toContain("p.tenant_id");
		expect(flattened).toContain("p.owner_id");
		expect(flattened).toContain("p.status = 'active'");
	});

	it("passes prefix input through to the prefix tsquery", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [makeRow({ title: "Empanadas" })],
		});

		await searchWikiForUser({
			tenantId: "t1",
			userId: "user-1",
			query: "empan",
			limit: 20,
		});

		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("empan:*");
	});

	it("keeps apostrophe input parameterized while adding a safe prefix query", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [makeRow({ title: "Dake's Shoppe", slug: "dakes-shoppe" })],
		});

		await searchWikiForUser({
			tenantId: "t1",
			userId: "user-1",
			query: "Dake's Shoppe",
			limit: 20,
		});

		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("Dake's Shoppe");
		expect(flattened).toContain("dake:* & shoppe:*");
	});

	it("preserves alias-only hits and matchedAlias mapping", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [makeRow({ score: 1, matched_alias: "gogo fresh" })],
		});

		const out = await searchWikiForUser({
			tenantId: "t1",
			userId: "user-1",
			query: "gogo fresh",
			limit: 20,
		});

		expect(out[0].matchedAlias).toBe("gogo fresh");
		const flattened = JSON.stringify(mockExecute.mock.calls[0].flat(3));
		expect(flattened).toContain("alias_hits");
		expect(flattened).toContain("ah.page_id IS NOT NULL");
	});
});
