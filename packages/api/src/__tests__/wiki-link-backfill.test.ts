import { describe, expect, it, vi } from "vitest";
import { runLinkBackfill, type BackfillPage } from "../lib/wiki/link-backfill.js";
import type {
	CoMentionSource,
	WriteLinkArgs,
} from "../lib/wiki/deterministic-linker.js";

const SCOPE = { tenantId: "t1", ownerId: "a1" };

function entityPage(over: Partial<BackfillPage>): BackfillPage {
	return {
		id: over.id ?? "page-x",
		type: "entity",
		slug: over.slug ?? "slug-x",
		title: over.title ?? "Title X",
		summary: over.summary ?? null,
	};
}

function topicPage(over: Partial<BackfillPage>): BackfillPage {
	return {
		id: over.id ?? "topic-x",
		type: "topic",
		slug: over.slug ?? "topic-slug",
		title: over.title ?? "Topic X",
		summary: over.summary ?? null,
	};
}

function makeWriteLink(): ReturnType<
	typeof vi.fn<(args: WriteLinkArgs) => Promise<void>>
> {
	return vi.fn<(args: WriteLinkArgs) => Promise<void>>(
		async () => undefined,
	);
}

describe("runLinkBackfill — Phase A (deterministic parents)", () => {
	it("emits a reference link when ≥2 entity summaries mention a city that has a matching topic page", async () => {
		const pages: BackfillPage[] = [
			topicPage({ id: "paris", title: "Paris", slug: "paris" }),
			entityPage({
				id: "cafe-1",
				slug: "cafe-flore",
				title: "Café de Flore",
				summary: "A historic cafe in Paris.",
			}),
			entityPage({
				id: "cafe-2",
				slug: "cafe-deux",
				title: "Les Deux Magots",
				summary: "Another landmark cafe located in Paris.",
			}),
		];
		const writeLink = makeWriteLink();
		const result = await runLinkBackfill({
			scope: SCOPE,
			dryRun: false,
			listAllActivePages: async () => pages,
			listMemoryUnitIds: async () => [],
			lookupParentPages: async ({ title }) =>
				title === "Paris"
					? [{ id: "paris", type: "topic", slug: "paris", title: "Paris" }]
					: [],
			lookupMemorySources: async () => [],
			upsertPageLink: writeLink,
		});
		expect(result.pagesSeen).toBe(3);
		expect(result.candidates).toBeGreaterThan(0);
		expect(result.parentLinksWritten).toBe(2);
		expect(writeLink).toHaveBeenCalledTimes(2);
		expect(writeLink).toHaveBeenCalledWith(
			expect.objectContaining({
				toPageId: "paris",
				context: "deterministic:city:paris",
			}),
		);
	});

	it("skips parent emission when the parent page doesn't exist in scope", async () => {
		const pages: BackfillPage[] = [
			entityPage({
				id: "c1",
				summary: "a place in Nowhereville.",
			}),
			entityPage({
				id: "c2",
				summary: "a place in Nowhereville.",
			}),
		];
		const writeLink = makeWriteLink();
		const result = await runLinkBackfill({
			scope: SCOPE,
			dryRun: false,
			listAllActivePages: async () => pages,
			listMemoryUnitIds: async () => [],
			lookupParentPages: async () => [],
			lookupMemorySources: async () => [],
			upsertPageLink: writeLink,
		});
		expect(result.parentLinksWritten).toBe(0);
		expect(writeLink).not.toHaveBeenCalled();
	});
});

describe("runLinkBackfill — Phase B (co-mention)", () => {
	it("emits reciprocal edges for every memory that sourced ≥2 entity pages", async () => {
		const writeLink = makeWriteLink();
		const sources: CoMentionSource[] = [
			{
				memory_unit_id: "mem-1",
				page_id: "p1",
				page_type: "entity",
				slug: "aaa",
				title: "A",
			},
			{
				memory_unit_id: "mem-1",
				page_id: "p2",
				page_type: "entity",
				slug: "bbb",
				title: "B",
			},
		];
		const result = await runLinkBackfill({
			scope: SCOPE,
			dryRun: false,
			listAllActivePages: async () => [],
			listMemoryUnitIds: async () => ["mem-1"],
			lookupParentPages: async () => [],
			lookupMemorySources: async () => sources,
			upsertPageLink: writeLink,
		});
		expect(result.memoryUnitsSeen).toBe(1);
		expect(result.coMentionLinksWritten).toBe(2);
		expect(writeLink).toHaveBeenCalledWith(
			expect.objectContaining({ context: "co_mention:mem-1" }),
		);
	});
});

describe("runLinkBackfill — dry-run", () => {
	it("passes no rows through to upsertPageLink even when emitters have work to do", async () => {
		const pages: BackfillPage[] = [
			topicPage({ id: "paris", title: "Paris", slug: "paris" }),
			entityPage({
				id: "c1",
				summary: "cafe in Paris.",
			}),
			entityPage({
				id: "c2",
				summary: "bistro in Paris.",
			}),
		];
		const writeLink = makeWriteLink();
		const lines: string[] = [];
		const result = await runLinkBackfill({
			scope: SCOPE,
			dryRun: true,
			listAllActivePages: async () => pages,
			listMemoryUnitIds: async () => [],
			lookupParentPages: async ({ title }) =>
				title === "Paris"
					? [{ id: "paris", type: "topic", slug: "paris", title: "Paris" }]
					: [],
			lookupMemorySources: async () => [],
			upsertPageLink: writeLink,
			log: (l) => lines.push(l),
		});
		// Emitter still counts the links it would have written, but the real
		// upsert helper is never reached.
		expect(result.parentLinksWritten).toBe(2);
		expect(writeLink).not.toHaveBeenCalled();
		expect(lines.some((l) => l.startsWith("[dry-run]"))).toBe(true);
	});
});

describe("runLinkBackfill — idempotency", () => {
	it("is a no-op when the upsertPageLink callback drops duplicates (emulates onConflictDoNothing)", async () => {
		let firstPass = true;
		const seenEdges = new Set<string>();
		const writeLink = vi.fn<(args: WriteLinkArgs) => Promise<void>>(
			async (link) => {
				const key = `${link.fromPageId}:${link.toPageId}`;
				if (seenEdges.has(key)) return; // the real onConflictDoNothing
				seenEdges.add(key);
			},
		);

		const pages: BackfillPage[] = [
			topicPage({ id: "paris", title: "Paris", slug: "paris" }),
			entityPage({
				id: "c1",
				summary: "a spot in Paris.",
			}),
			entityPage({
				id: "c2",
				summary: "another spot in Paris.",
			}),
		];
		const deps = {
			scope: SCOPE,
			dryRun: false,
			listAllActivePages: async () => pages,
			listMemoryUnitIds: async () => [] as string[],
			lookupParentPages: async ({ title }: { title: string }) =>
				title === "Paris"
					? [
							{
								id: "paris",
								type: "topic" as const,
								slug: "paris",
								title: "Paris",
							},
						]
					: [],
			lookupMemorySources: async () => [],
			upsertPageLink: writeLink,
		};
		const first = await runLinkBackfill(deps);
		firstPass = false;
		const second = await runLinkBackfill(deps);

		// Both passes report the same number — the emitter is unaware of
		// dedupe — but the writeLink contract above ensures the DB-level
		// state doesn't change on the second pass.
		expect(first.parentLinksWritten).toBe(2);
		expect(second.parentLinksWritten).toBe(2);
		// Only the first pass actually added rows to seenEdges.
		expect(seenEdges.size).toBe(2);
		expect(firstPass).toBe(false); // silences the "unused" lint path
	});
});
