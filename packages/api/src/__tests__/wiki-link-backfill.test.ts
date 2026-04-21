import { describe, expect, it, vi } from "vitest";
import {
	runLinkBackfill,
	runPhaseCPlaceBackfill,
	type BackfillPage,
	type PhaseCPage,
	type PhaseCSourceRecord,
	type RunPhaseCPlaceBackfillArgs,
} from "../lib/wiki/link-backfill.js";
import type {
	CoMentionSource,
	WriteLinkArgs,
} from "../lib/wiki/deterministic-linker.js";
import type { WikiPageRow, WikiPlaceRow } from "../lib/wiki/repository.js";

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

// ─── Phase C fixtures ─────────────────────────────────────────────────────

function phaseCPage(over: Partial<PhaseCPage>): PhaseCPage {
	return {
		id: over.id ?? "page-1",
		slug: over.slug ?? "slug-1",
		title: over.title ?? "Page 1",
		type: over.type ?? "entity",
		place_id: over.place_id ?? null,
	};
}

function phaseCSource(
	id: string,
	googlePlaceId: string | null,
): PhaseCSourceRecord {
	return {
		id,
		metadata: googlePlaceId
			? {
					raw: {
						place_google_place_id: googlePlaceId,
						place_name: `POI for ${googlePlaceId}`,
					},
				}
			: { raw: {} },
	};
}

function buildPhaseCDeps(
	pages: PhaseCPage[],
	recordsByPage: Record<string, PhaseCSourceRecord[]>,
): {
	args: RunPhaseCPlaceBackfillArgs;
	placesRowsById: Map<string, WikiPlaceRow>;
	backingPagesByPlaceId: Map<string, WikiPageRow>;
	setPlaceIdCalls: Array<{ pageId: string; placeId: string }>;
	writeLinkCalls: Array<WriteLinkArgs & { kind: "reference" }>;
	writtenLinkKeys: Set<string>;
	log: string[];
} {
	const placesRowsById = new Map<string, WikiPlaceRow>();
	const backingPagesByPlaceId = new Map<string, WikiPageRow>();
	const setPlaceIdCalls: Array<{ pageId: string; placeId: string }> = [];
	const writeLinkCalls: Array<WriteLinkArgs & { kind: "reference" }> = [];
	const writtenLinkKeys = new Set<string>();
	const log: string[] = [];

	const args: RunPhaseCPlaceBackfillArgs = {
		scope: { tenantId: "t1", ownerId: "a1" },
		dryRun: false,
		listActivePages: async () => pages,
		fetchRecordsForPage: async (pageId) => recordsByPage[pageId] ?? [],
		resolvePlaceForRecord: async (record) => {
			const raw = (record.metadata as { raw?: { place_google_place_id?: string } })
				?.raw;
			const gpid = raw?.place_google_place_id;
			if (!gpid) return null;
			// Return a stable place id derived from the google_place_id so
			// identical records across pages resolve to the same POI — mirrors
			// the real places-service's cache path.
			return { poi: { id: `poi-${gpid}` } };
		},
		setPagePlaceId: async ({ pageId, placeId }) => {
			setPlaceIdCalls.push({ pageId, placeId });
			return placeId;
		},
		findPlaceById: async ({ id }) => placesRowsById.get(id) ?? null,
		findPageByPlaceId: async ({ placeId }) =>
			backingPagesByPlaceId.get(placeId) ?? null,
		writeLink: async (link) => {
			const key = `${link.fromPageId}:${link.toPageId}`;
			writeLinkCalls.push(link);
			if (writtenLinkKeys.has(key)) return false;
			writtenLinkKeys.add(key);
			return true;
		},
		log: (line) => log.push(line),
	};

	return {
		args,
		placesRowsById,
		backingPagesByPlaceId,
		setPlaceIdCalls,
		writeLinkCalls,
		writtenLinkKeys,
		log,
	};
}

function placeRow(over: Partial<WikiPlaceRow>): WikiPlaceRow {
	return {
		id: over.id ?? "place-1",
		tenant_id: "t1",
		owner_id: "a1",
		name: over.name ?? "Place",
		google_place_id: over.google_place_id ?? null,
		geo_lat: null,
		geo_lon: null,
		address: null,
		parent_place_id: over.parent_place_id ?? null,
		place_kind: over.place_kind ?? "poi",
		source: over.source ?? "google_api",
		source_payload: null,
		created_at: new Date(),
		updated_at: new Date(),
	};
}

function pageRow(over: Partial<WikiPageRow>): WikiPageRow {
	return {
		id: over.id ?? "page-1",
		tenant_id: "t1",
		owner_id: "a1",
		type: over.type ?? "topic",
		slug: over.slug ?? "slug-1",
		title: over.title ?? "Page 1",
		summary: null,
		body_md: null,
		status: "active",
		parent_page_id: null,
		place_id: over.place_id ?? null,
		hubness_score: 0,
		tags: [],
		last_compiled_at: null,
		created_at: new Date(),
		updated_at: new Date(),
	};
}

describe("runPhaseCPlaceBackfill — happy path", () => {
	it("enriches pages whose sources carry place metadata and emits one hierarchy edge per page", async () => {
		const pages: PhaseCPage[] = [
			phaseCPage({ id: "p-cafe", slug: "cafe-flore", title: "Café de Flore" }),
			phaseCPage({ id: "p-unused", slug: "plain", title: "Plain page" }),
		];
		const deps = buildPhaseCDeps(pages, {
			"p-cafe": [phaseCSource("m1", "gpid-cafe")],
			"p-unused": [phaseCSource("m2", null)],
		});

		// Wire the POI row (with a parent place) + the parent backing page so
		// `emitPlaceHierarchyLinks` can walk one level up.
		deps.placesRowsById.set(
			"poi-gpid-cafe",
			placeRow({
				id: "poi-gpid-cafe",
				parent_place_id: "city-paris",
				place_kind: "poi",
			}),
		);
		deps.backingPagesByPlaceId.set(
			"city-paris",
			pageRow({ id: "paris", type: "topic", slug: "paris", title: "Paris" }),
		);

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_processed).toBe(2);
		expect(result.pages_enriched).toBe(1);
		expect(result.hierarchy_edges_written).toBe(1);
		expect(result.collisions).toBe(0);
		expect(result.breaker_tripped).toBe(false);
		expect(deps.setPlaceIdCalls).toEqual([
			{ pageId: "p-cafe", placeId: "poi-gpid-cafe" },
		]);
		expect(deps.writeLinkCalls).toEqual([
			expect.objectContaining({
				fromPageId: "p-cafe",
				toPageId: "paris",
				context: "deterministic:place:city-paris",
				kind: "reference",
			}),
		]);
	});

	it("skips enrichment for pages that already carry place_id but still emits the hierarchy edge", async () => {
		const pages: PhaseCPage[] = [
			phaseCPage({ id: "p-existing", place_id: "poi-existing" }),
		];
		const deps = buildPhaseCDeps(pages, {});
		deps.placesRowsById.set(
			"poi-existing",
			placeRow({ id: "poi-existing", parent_place_id: "city-nyc" }),
		);
		deps.backingPagesByPlaceId.set(
			"city-nyc",
			pageRow({ id: "nyc-page", title: "New York" }),
		);

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_processed).toBe(1);
		expect(result.pages_enriched).toBe(0);
		expect(result.hierarchy_edges_written).toBe(1);
		expect(deps.setPlaceIdCalls).toEqual([]);
	});
});

describe("runPhaseCPlaceBackfill — edge cases", () => {
	it("is a no-op for pages whose sources carry no place metadata (Cruz-style scope)", async () => {
		const pages: PhaseCPage[] = [
			phaseCPage({ id: "p1" }),
			phaseCPage({ id: "p2" }),
		];
		const deps = buildPhaseCDeps(pages, {
			p1: [phaseCSource("m1", null), phaseCSource("m2", null)],
			p2: [phaseCSource("m3", null)],
		});

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_processed).toBe(2);
		expect(result.pages_enriched).toBe(0);
		expect(result.hierarchy_edges_written).toBe(0);
		expect(result.collisions).toBe(0);
		expect(deps.setPlaceIdCalls).toEqual([]);
	});

	it("skips pages whose fetchRecordsForPage returns zero rows", async () => {
		const pages: PhaseCPage[] = [phaseCPage({ id: "p-orphan" })];
		const deps = buildPhaseCDeps(pages, { "p-orphan": [] });

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_processed).toBe(1);
		expect(result.pages_enriched).toBe(0);
	});

	it("counts a collision when setPagePlaceId throws the partial-unique error and moves on", async () => {
		const pages: PhaseCPage[] = [
			phaseCPage({ id: "p-a", slug: "a" }),
			phaseCPage({ id: "p-b", slug: "b" }),
		];
		const deps = buildPhaseCDeps(pages, {
			"p-a": [phaseCSource("m1", "gpid-shared")],
			"p-b": [phaseCSource("m2", "gpid-shared")],
		});
		deps.placesRowsById.set(
			"poi-gpid-shared",
			placeRow({ id: "poi-gpid-shared", parent_place_id: null }),
		);

		let callCount = 0;
		deps.args.setPagePlaceId = async ({ pageId, placeId }) => {
			callCount += 1;
			if (callCount === 2) {
				throw new Error(
					"duplicate key value violates unique constraint wiki_places_tenant_google_place_id_key",
				);
			}
			return placeId;
		};

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_processed).toBe(2);
		expect(result.pages_enriched).toBe(1);
		expect(result.collisions).toBe(1);
	});

	it("reports breaker_tripped when the breakerState callback returns tripped at the end", async () => {
		const pages: PhaseCPage[] = [phaseCPage({ id: "p-x" })];
		const deps = buildPhaseCDeps(pages, {
			"p-x": [phaseCSource("m1", "gpid-a")],
		});
		deps.placesRowsById.set(
			"poi-gpid-a",
			placeRow({ id: "poi-gpid-a", parent_place_id: null }),
		);
		deps.args.breakerState = () => ({ state: "tripped" });

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.breaker_tripped).toBe(true);
	});

	it("does not emit a hierarchy edge when the resolved POI is top-of-hierarchy (parent_place_id is null)", async () => {
		const pages: PhaseCPage[] = [phaseCPage({ id: "p-city" })];
		const deps = buildPhaseCDeps(pages, {
			"p-city": [phaseCSource("m1", "gpid-country")],
		});
		deps.placesRowsById.set(
			"poi-gpid-country",
			placeRow({
				id: "poi-gpid-country",
				place_kind: "country",
				parent_place_id: null,
			}),
		);

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_enriched).toBe(1);
		expect(result.hierarchy_edges_written).toBe(0);
	});
});

describe("runPhaseCPlaceBackfill — dry-run", () => {
	it("counts pages whose sources carry place metadata without calling the places-service or writing anything", async () => {
		const pages: PhaseCPage[] = [
			phaseCPage({ id: "p-cafe" }),
			phaseCPage({ id: "p-none" }),
		];
		const deps = buildPhaseCDeps(pages, {
			"p-cafe": [phaseCSource("m1", "gpid-cafe")],
			"p-none": [phaseCSource("m2", null)],
		});
		deps.args.dryRun = true;
		const resolveSpy = vi.fn(deps.args.resolvePlaceForRecord);
		deps.args.resolvePlaceForRecord = resolveSpy;
		const setSpy = vi.fn(deps.args.setPagePlaceId);
		deps.args.setPagePlaceId = setSpy;
		const writeSpy = vi.fn(deps.args.writeLink);
		deps.args.writeLink = writeSpy;

		const result = await runPhaseCPlaceBackfill(deps.args);

		expect(result.pages_processed).toBe(2);
		expect(result.pages_enriched).toBe(1);
		expect(result.hierarchy_edges_written).toBe(0);
		expect(resolveSpy).not.toHaveBeenCalled();
		expect(setSpy).not.toHaveBeenCalled();
		expect(writeSpy).not.toHaveBeenCalled();
	});
});

describe("runPhaseCPlaceBackfill — idempotency", () => {
	it("emits zero new hierarchy edges on the second pass when writeLink dedupes on the unique index", async () => {
		const pages: PhaseCPage[] = [
			phaseCPage({ id: "p-cafe" }),
		];
		const deps = buildPhaseCDeps(pages, {
			"p-cafe": [phaseCSource("m1", "gpid-cafe")],
		});
		deps.placesRowsById.set(
			"poi-gpid-cafe",
			placeRow({ id: "poi-gpid-cafe", parent_place_id: "city-paris" }),
		);
		deps.backingPagesByPlaceId.set(
			"city-paris",
			pageRow({ id: "paris", title: "Paris" }),
		);

		const first = await runPhaseCPlaceBackfill(deps.args);

		// Simulate the page picking up the place_id (live DB would update
		// this via setPagePlaceId) — on second pass the page has a place_id.
		pages[0].place_id = "poi-gpid-cafe";

		const second = await runPhaseCPlaceBackfill(deps.args);

		expect(first.hierarchy_edges_written).toBe(1);
		expect(second.hierarchy_edges_written).toBe(0);
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
