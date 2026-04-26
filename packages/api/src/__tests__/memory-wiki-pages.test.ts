/**
 * Unit test for the MemoryRecord.wikiPages field resolver.
 *
 * The resolver is intentionally thin: it extracts the Hindsight memory-unit
 * id from the parent record, then delegates to the request-scoped DataLoader
 * that batches wiki page lookups for mobile's large memory list.
 */

import { describe, it, expect, vi } from "vitest";
import { memoryRecordTypeResolvers } from "../graphql/resolvers/memory/types.js";

function ctxWithPages(pages: unknown[] = []) {
	const load = vi.fn(async () => pages);
	return {
		load,
		ctx: {
			loaders: {
				wikiPagesByMemoryRecord: { load },
			},
		} as any,
	};
}

describe("MemoryRecord.wikiPages resolver", () => {
	it("returns [] when memoryRecordId is missing / non-string", async () => {
		const { load, ctx } = ctxWithPages([{ id: "p1" }]);

		await expect(memoryRecordTypeResolvers.wikiPages({}, {}, ctx)).resolves.toEqual([]);
		await expect(
			memoryRecordTypeResolvers.wikiPages({ memoryRecordId: 123 as any }, {}, ctx),
		).resolves.toEqual([]);
		expect(load).not.toHaveBeenCalled();
	});

	it("loads page previews by memoryRecordId", async () => {
		const pages = [
			{
				id: "p1",
				type: "ENTITY",
				slug: "taberna",
				title: "Taberna",
				sections: [],
				aliases: [],
			},
		];
		const { load, ctx } = ctxWithPages(pages);

		const out = await memoryRecordTypeResolvers.wikiPages(
			{ memoryRecordId: "mem-abc" },
			{},
			ctx,
		);

		expect(load).toHaveBeenCalledWith("mem-abc");
		expect(out).toEqual(pages);
	});

	it("falls back to alternate memory id shapes", async () => {
		const { load, ctx } = ctxWithPages([]);

		await memoryRecordTypeResolvers.wikiPages({ id: "mem-id" }, {}, ctx);
		await memoryRecordTypeResolvers.wikiPages({ memory_unit_id: "mem-unit" }, {}, ctx);

		expect(load).toHaveBeenNthCalledWith(1, "mem-id");
		expect(load).toHaveBeenNthCalledWith(2, "mem-unit");
	});
});
