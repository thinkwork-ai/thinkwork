import { describe, expect, it, vi } from "vitest";
import {
	emitCoMentionLinks,
	type CoMentionSource,
	type WriteLinkArgs,
} from "../lib/wiki/deterministic-linker.js";

const SCOPE = { tenantId: "t1", ownerId: "a1" };

function makeWriteLink(): ReturnType<
	typeof vi.fn<(args: WriteLinkArgs) => Promise<void>>
> {
	return vi.fn<(args: WriteLinkArgs) => Promise<void>>(
		async () => undefined,
	);
}

function sources(
	rows: Array<{
		m: string;
		p: string;
		type?: "entity" | "topic" | "decision";
		slug?: string;
	}>,
): CoMentionSource[] {
	return rows.map(({ m, p, type, slug }) => ({
		memory_unit_id: m,
		page_id: p,
		page_type: type ?? "entity",
		slug: slug ?? p,
		title: p,
	}));
}

describe("emitCoMentionLinks", () => {
	it("emits 2 reciprocal rows for a memory sourced on 2 entity pages", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "page-a", slug: "aaa" },
					{ m: "mem-1", p: "page-b", slug: "bbb" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(2);
		expect(writeLink).toHaveBeenCalledTimes(2);
		expect(writeLink).toHaveBeenCalledWith({
			fromPageId: "page-a",
			toPageId: "page-b",
			context: "co_mention:mem-1",
		});
		expect(writeLink).toHaveBeenCalledWith({
			fromPageId: "page-b",
			toPageId: "page-a",
			context: "co_mention:mem-1",
		});
	});

	it("emits 6 directed rows for a memory sourced on 3 entity pages (3 pairs × 2)", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "a", slug: "a" },
					{ m: "mem-1", p: "b", slug: "b" },
					{ m: "mem-1", p: "c", slug: "c" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(6);
	});

	it("caps at 10 directed edges for a memory sourced on 6 entities, slug-asc ordering", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "p6", slug: "zz" }, // last by slug
					{ m: "mem-1", p: "p1", slug: "aa" },
					{ m: "mem-1", p: "p2", slug: "bb" },
					{ m: "mem-1", p: "p3", slug: "cc" },
					{ m: "mem-1", p: "p4", slug: "dd" },
					{ m: "mem-1", p: "p5", slug: "ee" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(10);
		// Every from-page must be one of the first 4 by slug asc: p1 aa, p2 bb,
		// p3 cc, p4 dd. None should start from p5 (ee) or p6 (zz) — we only
		// emit the first 10 ordered directed pairs (i,j) with i<j plus their
		// reciprocals.
		const fromIds = writeLink.mock.calls.map(([c]) => c.fromPageId);
		expect(fromIds).not.toContain("p6");
	});

	it("emits 0 rows for a memory sourced on 1 entity page", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () => sources([{ m: "mem-1", p: "a" }]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
	});

	it("emits 0 rows when both sources are topic pages (entity gate)", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "a", type: "topic" },
					{ m: "mem-1", p: "b", type: "topic" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
	});

	it("emits 0 rows for 1 entity + 1 topic (topic filtered, only 1 entity left)", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "a", type: "entity" },
					{ m: "mem-1", p: "b", type: "topic" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
	});

	it("deduplicates when the same page appears via multiple sections", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "a" },
					{ m: "mem-1", p: "a" }, // duplicate
					{ m: "mem-1", p: "b" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		// Dedup to { a, b } → 2 directed rows.
		expect(result.linksWritten).toBe(2);
	});

	it("processes each memory_unit independently", async () => {
		const writeLink = makeWriteLink();
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "a", slug: "a" },
					{ m: "mem-1", p: "b", slug: "b" },
					{ m: "mem-2", p: "c", slug: "c" },
					{ m: "mem-2", p: "d", slug: "d" },
				]),
			memoryUnitIds: ["mem-1", "mem-2"],
			writeLink,
		});
		// 2 pairs × 2 directed = 4.
		expect(result.linksWritten).toBe(4);
		const contexts = writeLink.mock.calls.map(([c]) => c.context);
		expect(contexts.filter((c) => c === "co_mention:mem-1").length).toBe(2);
		expect(contexts.filter((c) => c === "co_mention:mem-2").length).toBe(2);
	});

	it("swallows writeLink errors per-pair (does not fail the caller)", async () => {
		const writeLink = vi.fn<(args: WriteLinkArgs) => Promise<void>>(
			async () => {
				throw new Error("db busy");
			},
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			lookupMemorySources: async () =>
				sources([
					{ m: "mem-1", p: "a", slug: "a" },
					{ m: "mem-1", p: "b", slug: "b" },
				]),
			memoryUnitIds: ["mem-1"],
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(writeLink).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("returns cleanly when memoryUnitIds is empty (no lookup, no writes)", async () => {
		const writeLink = makeWriteLink();
		const lookup = vi.fn<
			() => Promise<CoMentionSource[]>
		>(async () => []);
		const result = await emitCoMentionLinks({
			scope: SCOPE,
			memoryUnitIds: [],
			lookupMemorySources: lookup,
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(lookup).not.toHaveBeenCalled();
		expect(writeLink).not.toHaveBeenCalled();
	});
});
