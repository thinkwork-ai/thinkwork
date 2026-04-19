/**
 * Unit test for the MemoryRecord.wikiPages field resolver.
 *
 * The resolver joins from a Hindsight memory unit id → wiki_section_sources
 * → wiki_page_sections → wiki_pages. We mock drizzle's chained `select()`
 * to return scripted rows and confirm the resolver emits the right shape.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSectionRows, mockPageRows } = vi.hoisted(() => ({
	mockSectionRows: vi.fn(),
	mockPageRows: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => {
	// First select call returns section rows, second returns page rows.
	let call = 0;
	return {
		db: {
			select: vi.fn(() => {
				const which = call++;
				const rows = which === 0 ? mockSectionRows() : mockPageRows();
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => rows,
						}),
						where: () => ({
							orderBy: () => rows,
						}),
					}),
				};
			}),
			// Exposed so tests can reset the call counter between cases.
			__reset: () => {
				call = 0;
			},
		},
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
		and: (...xs: unknown[]) => ({ __and: xs }),
	};
});

vi.mock("@thinkwork/database-pg/schema", () => ({
	wikiPageSections: { id: "col.sections.id", page_id: "col.sections.page_id" },
	wikiPages: {
		id: "col.pages.id",
		status: "col.pages.status",
		type: "col.pages.type",
		slug: "col.pages.slug",
	},
	wikiSectionSources: {
		section_id: "col.sources.section_id",
		source_kind: "col.sources.source_kind",
		source_ref: "col.sources.source_ref",
	},
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return {
		...actual,
		eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
		and: (...xs: unknown[]) => ({ __and: xs }),
		inArray: (col: unknown, arr: unknown) => ({ __inArray: [col, arr] }),
		sql: (...xs: unknown[]) => xs,
	};
});

import { memoryRecordTypeResolvers } from "../graphql/resolvers/memory/types.js";
import { db as mockedDb } from "../graphql/utils.js";

beforeEach(() => {
	vi.clearAllMocks();
	(mockedDb as any).__reset?.();
	mockSectionRows.mockReturnValue([]);
	mockPageRows.mockReturnValue([]);
});

describe("MemoryRecord.wikiPages resolver", () => {
	it("returns [] when no sections cite this memory unit", async () => {
		const out = await memoryRecordTypeResolvers.wikiPages({
			memoryRecordId: "m1",
		});
		expect(out).toEqual([]);
	});

	it("returns [] when memoryRecordId is missing / non-string", async () => {
		expect(
			await memoryRecordTypeResolvers.wikiPages({}),
		).toEqual([]);
		(mockedDb as any).__reset?.();
		expect(
			await memoryRecordTypeResolvers.wikiPages({
				memoryRecordId: 123 as any,
			}),
		).toEqual([]);
	});

	it("returns page previews with empty sections/aliases when sources exist", async () => {
		mockSectionRows.mockReturnValueOnce([
			{ page_id: "p1" },
			{ page_id: "p2" },
			{ page_id: "p1" }, // duplicate — different section, same page
		]);
		mockPageRows.mockReturnValueOnce([
			{
				id: "p1",
				tenant_id: "t1",
				owner_id: "a1",
				type: "entity",
				slug: "taberna",
				title: "Taberna",
				summary: "Pastrami spot",
				body_md: "…",
				status: "active",
				last_compiled_at: new Date("2026-04-18T00:00:00Z"),
				created_at: new Date("2026-04-17T00:00:00Z"),
				updated_at: new Date("2026-04-18T00:00:00Z"),
			},
			{
				id: "p2",
				tenant_id: "t1",
				owner_id: "a1",
				type: "topic",
				slug: "lisbon",
				title: "Lisbon",
				summary: null,
				body_md: null,
				status: "active",
				last_compiled_at: null,
				created_at: new Date("2026-04-17T00:00:00Z"),
				updated_at: new Date("2026-04-18T00:00:00Z"),
			},
		]);

		const out = (await memoryRecordTypeResolvers.wikiPages({
			memoryRecordId: "mem-abc",
		})) as any[];

		expect(out).toHaveLength(2);
		const p1 = out.find((p) => p.slug === "taberna")!;
		expect(p1.type).toBe("ENTITY");
		expect(p1.title).toBe("Taberna");
		expect(p1.summary).toBe("Pastrami spot");
		expect(p1.sections).toEqual([]);
		expect(p1.aliases).toEqual([]);
		const p2 = out.find((p) => p.slug === "lisbon")!;
		expect(p2.type).toBe("TOPIC");
	});
});
