/**
 * Unit test for the wikiBacklinks resolver dedup behavior.
 *
 * Pre-fix, the resolver ran `db.select().from(wikiPageLinks).innerJoin(
 * wikiPages, ...)` without any DISTINCT on the source page id. A parent/
 * child pair that carried BOTH a `reference` and a `parent_of` row in
 * `wiki_page_links` joined twice and surfaced as duplicate REFERENCED BY
 * entries on the mobile wiki detail screen (React logged a key-collision
 * warning on the iOS sim).
 *
 * Post-fix the resolver does a two-step query: `selectDistinct(from_page_id)`
 * to build a dedup'd id set, then `inArray(id, ids)` to fetch the active
 * page rows. This test asserts one row out even when two link rows carry
 * the same source page id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
	mockSelectDistinctResult,
	mockPageRowsResult,
	mockTargetResult,
	mockAssertScope,
	selectCallRef,
} = vi.hoisted(() => ({
	mockSelectDistinctResult: vi.fn(),
	mockPageRowsResult: vi.fn(),
	mockTargetResult: vi.fn(),
	mockAssertScope: vi.fn().mockResolvedValue(undefined),
	selectCallRef: { value: 0 },
}));

vi.mock("../graphql/utils.js", () => {
	// Two `db.select()` chains in order:
	//   1. target page (select().from(wikiPages).where().limit(1))
	//   2. source page rows (select().from(wikiPages).where(and(inArray, eq)))
	// Plus one `db.selectDistinct()` chain:
	//   selectDistinct(from_page_id).from(wikiPageLinks).where()
	return {
		db: {
			select: vi.fn(() => {
				const which = selectCallRef.value++;
				return {
					from: () => {
						if (which === 0) {
							// target page — supports .where().limit()
							return {
								where: () => ({
									limit: () =>
										Promise.resolve(mockTargetResult() as unknown[]),
								}),
							};
						}
						// source page rows — supports .where() awaited directly
						return {
							where: () =>
								Promise.resolve(mockPageRowsResult() as unknown[]),
						};
					},
				};
			}),
			selectDistinct: vi.fn(() => ({
				from: () => ({
					where: () =>
						Promise.resolve(mockSelectDistinctResult() as unknown[]),
				}),
			})),
		},
	};
});

vi.mock("../graphql/resolvers/wiki/auth.js", () => ({
	assertCanReadWikiScope: mockAssertScope,
	WikiAuthError: class WikiAuthError extends Error {},
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	wikiPages: {
		id: "wikiPages.id",
		tenant_id: "wikiPages.tenant_id",
		owner_id: "wikiPages.owner_id",
		status: "wikiPages.status",
		type: "wikiPages.type",
		slug: "wikiPages.slug",
		title: "wikiPages.title",
	},
	wikiPageLinks: {
		from_page_id: "wikiPageLinks.from_page_id",
		to_page_id: "wikiPageLinks.to_page_id",
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return {
		...actual,
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
		and: (...xs: unknown[]) => ({ __and: xs }),
		inArray: (col: unknown, vals: unknown) => ({ __inArray: [col, vals] }),
	};
});

import { wikiBacklinks } from "../graphql/resolvers/wiki/wikiBacklinks.query.js";
import type { GraphQLContext } from "../graphql/context.js";

function makeCtx(): GraphQLContext {
	return {
		auth: {
			principalId: "user-1",
			tenantId: "t1",
			email: "eric@example.com",
			authType: "apikey",
		},
	} as unknown as GraphQLContext;
}

function targetPage() {
	return { id: "target-page", tenant_id: "t1", owner_id: "a1" };
}

function makePageRow(over: Record<string, unknown> = {}) {
	return {
		id: "page-a",
		tenant_id: "t1",
		owner_id: "a1",
		type: "entity",
		slug: "page-a",
		title: "Page A",
		summary: "Summary A",
		body_md: null,
		status: "active",
		last_compiled_at: null,
		created_at: new Date("2026-04-20T00:00:00Z"),
		updated_at: new Date("2026-04-20T00:00:00Z"),
		parent_page_id: null,
		...over,
	};
}

describe("wikiBacklinks resolver dedup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectCallRef.value = 0;
	});

	it("emits one result per source page even when two link rows share the same from_page_id", async () => {
		mockTargetResult.mockReturnValue([targetPage()]);
		// selectDistinct dedups at the SQL layer — asserting the callers AS IF
		// SQL is doing its job. The input is the shape selectDistinct would
		// emit on two link rows with same from_page_id: a single id row.
		mockSelectDistinctResult.mockReturnValue([{ id: "page-a" }]);
		mockPageRowsResult.mockReturnValue([makePageRow({ id: "page-a" })]);

		const result = await wikiBacklinks(
			null,
			{ pageId: "target-page" },
			makeCtx(),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.id).toBe("page-a");
	});

	it("passes through multiple distinct source pages", async () => {
		mockTargetResult.mockReturnValue([targetPage()]);
		mockSelectDistinctResult.mockReturnValue([
			{ id: "page-a" },
			{ id: "page-b" },
		]);
		mockPageRowsResult.mockReturnValue([
			makePageRow({ id: "page-a", slug: "page-a", title: "Page A" }),
			makePageRow({ id: "page-b", slug: "page-b", title: "Page B" }),
		]);

		const result = await wikiBacklinks(
			null,
			{ pageId: "target-page" },
			makeCtx(),
		);

		expect(result).toHaveLength(2);
		expect(result.map((r) => r.id).sort()).toEqual(["page-a", "page-b"]);
	});

	it("short-circuits with [] when no source pages exist", async () => {
		mockTargetResult.mockReturnValue([targetPage()]);
		mockSelectDistinctResult.mockReturnValue([]);

		const result = await wikiBacklinks(
			null,
			{ pageId: "target-page" },
			makeCtx(),
		);

		expect(result).toEqual([]);
		// The page-rows query must NOT run when sourceIds is empty — otherwise
		// inArray([]) would generate an invalid `IN ()` SQL clause.
		expect(mockPageRowsResult).not.toHaveBeenCalled();
	});

	it("returns [] when the target page doesn't exist", async () => {
		mockTargetResult.mockReturnValue([]);

		const result = await wikiBacklinks(
			null,
			{ pageId: "missing" },
			makeCtx(),
		);

		expect(result).toEqual([]);
		expect(mockAssertScope).not.toHaveBeenCalled();
	});
});
