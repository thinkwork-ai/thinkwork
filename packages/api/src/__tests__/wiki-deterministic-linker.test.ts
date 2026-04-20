import { describe, expect, it, vi } from "vitest";
import {
	emitDeterministicParentLinks,
	type AffectedPage,
	type ParentPageLookup,
	type WriteLinkArgs,
} from "../lib/wiki/deterministic-linker.js";
import type { DerivedParentCandidate } from "../lib/wiki/parent-expander.js";

// Typed fresh so vi.fn infers the expected 1-arg writeLink signature.
function makeWriteLink(): ReturnType<
	typeof vi.fn<(args: WriteLinkArgs) => Promise<void>>
> {
	return vi.fn<(args: WriteLinkArgs) => Promise<void>>(
		async () => undefined,
	);
}

const SCOPE = { tenantId: "t1", ownerId: "a1" };

function candidate(over: Partial<DerivedParentCandidate> = {}): DerivedParentCandidate {
	return {
		reason: "city",
		parentTitle: "Paris",
		parentSlug: "paris",
		parentType: "topic",
		suggestedSectionSlug: "overview",
		suggestedSectionHeading: "Overview",
		sourceRecordIds: ["r1"],
		observedTags: [],
		supportingCount: 2,
		...over,
	};
}

function leafPage(over: Partial<AffectedPage> = {}): AffectedPage {
	return {
		id: "page-leaf-1",
		type: "entity",
		slug: "cafe-de-flore",
		title: "Café de Flore",
		sourceRecordIds: ["r1"],
		...over,
	};
}

function lookupThatReturns(
	pages: Array<{
		title: string;
		match: { id: string; type: "entity" | "topic" | "decision"; slug: string; title: string };
	}>,
): ParentPageLookup {
	return vi.fn(async ({ title }) => {
		const hits = pages.filter((p) => p.title === title).map((p) => p.match);
		return hits;
	});
}

const PARIS_TOPIC = {
	id: "page-paris",
	type: "topic" as const,
	slug: "paris",
	title: "Paris",
};

describe("emitDeterministicParentLinks", () => {
	it("emits one reference link for a city candidate with a matching topic page", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate({ reason: "city" })],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
		expect(writeLink).toHaveBeenCalledTimes(1);
		expect(writeLink).toHaveBeenCalledWith({
			fromPageId: "page-leaf-1",
			toPageId: "page-paris",
			context: "deterministic:city:paris",
		});
	});

	it("emits for reason=journal too", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [
				candidate({
					reason: "journal",
					parentTitle: "Summer 2025",
					parentSlug: "summer-2025",
				}),
			],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([
				{
					title: "Summer 2025",
					match: {
						id: "page-journal",
						type: "topic",
						slug: "summer-2025",
						title: "Summer 2025",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
		expect(writeLink).toHaveBeenCalledWith(
			expect.objectContaining({
				context: "deterministic:journal:summer-2025",
			}),
		);
	});

	it("ignores reason=tag_cluster in v1", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [
				candidate({
					reason: "tag_cluster",
					parentTitle: "Restaurants",
					parentSlug: "restaurants",
				}),
			],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([
				{
					title: "Restaurants",
					match: {
						id: "page-restaurants",
						type: "topic",
						slug: "restaurants",
						title: "Restaurants",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("emits no link when no active parent page exists for the title", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate({ parentTitle: "Nowhereville" })],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("skips entity leaves whose parent candidate would be a decision page (type-mismatch gate)", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate()],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([
				{
					title: "Paris",
					match: {
						id: "page-paris-decision",
						type: "decision",
						slug: "paris",
						title: "Paris",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("skips leaves of type topic — deterministic linker is for entity leaves only", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate()],
			affectedPages: [leafPage({ type: "topic" })],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("skips leaves whose source records do not overlap the candidate", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate({ sourceRecordIds: ["r99"] })],
			// Leaf page sourced by r1 — no overlap with r99.
			affectedPages: [leafPage({ sourceRecordIds: ["r1"] })],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
	});

	it("never emits a self-link when the leaf and parent are the same page", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate()],
			affectedPages: [leafPage({ id: "page-paris", title: "Paris" })],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
	});

	it("logs a warning and picks the first candidate when the lookup returns >1 page", async () => {
		const writeLink = makeWriteLink();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate()],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
				{
					title: "Paris",
					match: {
						id: "page-paris-2",
						type: "topic",
						slug: "paris-fr",
						title: "Paris",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
		expect(writeLink).toHaveBeenCalledWith(
			expect.objectContaining({ toPageId: "page-paris" }),
		);
		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/deterministic-linker.*title collision/i),
		);
		warn.mockRestore();
	});

	it("swallows writeLink errors per-candidate (does not fail the caller)", async () => {
		const writeLink = vi.fn<(args: WriteLinkArgs) => Promise<void>>(
			async () => {
				throw new Error("boom");
			},
		);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate()],
			affectedPages: [leafPage(), leafPage({ id: "page-leaf-2", slug: "cafe-2" })],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
			]),
			writeLink,
		});
		// Both attempts failed and were logged; counter didn't advance.
		expect(result.linksWritten).toBe(0);
		expect(writeLink).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it("fan-outs: one candidate with 3 affected entity leaves → 3 links", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate({ sourceRecordIds: ["r1", "r2", "r3"] })],
			affectedPages: [
				leafPage({ id: "p1", slug: "cafe-1", sourceRecordIds: ["r1"] }),
				leafPage({ id: "p2", slug: "cafe-2", sourceRecordIds: ["r2"] }),
				leafPage({ id: "p3", slug: "cafe-3", sourceRecordIds: ["r3"] }),
			],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: PARIS_TOPIC },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(3);
	});

	// ─── Trigram fallback (Unit 10 / 2026-04-20) ──────────────────────
	//
	// When exact-title lookup misses, the emitter falls through to a fuzzy
	// trigram lookup — so a candidate titled "Portland" still finds an
	// active page titled "Portland, Oregon" at similarity ≥ 0.85. The
	// fuzzy path is opt-in via the `lookupParentPagesFuzzy` callback;
	// callers that don't wire it get exact-only behavior.
	describe("trigram fallback", () => {
		it("resolves a candidate via fuzzy when exact returns empty", async () => {
			const writeLink = makeWriteLink();
			const fuzzy = vi.fn(async () => [
				{
					id: "page-portland",
					type: "topic" as const,
					slug: "portland-oregon",
					title: "Portland, Oregon",
					similarity: 0.89,
				},
			]);
			const result = await emitDeterministicParentLinks({
				scope: SCOPE,
				candidates: [
					candidate({ parentTitle: "Portland", parentSlug: "portland" }),
				],
				affectedPages: [leafPage()],
				lookupParentPages: lookupThatReturns([]), // no exact hit
				lookupParentPagesFuzzy: fuzzy,
				writeLink,
			});
			expect(result.linksWritten).toBe(1);
			expect(writeLink).toHaveBeenCalledWith(
				expect.objectContaining({
					toPageId: "page-portland",
					context: "deterministic:city:portland",
				}),
			);
		});

		it("never queries fuzzy when exact already resolved the candidate", async () => {
			const writeLink = makeWriteLink();
			const fuzzy = vi.fn();
			await emitDeterministicParentLinks({
				scope: SCOPE,
				candidates: [candidate()],
				affectedPages: [leafPage()],
				lookupParentPages: lookupThatReturns([
					{ title: "Paris", match: PARIS_TOPIC },
				]),
				lookupParentPagesFuzzy: fuzzy as any,
				writeLink,
			});
			expect(fuzzy).not.toHaveBeenCalled();
		});

		it("honors the type gate on fuzzy hits — decision parent still skipped", async () => {
			const writeLink = makeWriteLink();
			const fuzzy = vi.fn(async () => [
				{
					id: "page-portland-decision",
					type: "decision" as const,
					slug: "portland",
					title: "Portland, Oregon",
					similarity: 0.91,
				},
			]);
			const result = await emitDeterministicParentLinks({
				scope: SCOPE,
				candidates: [
					candidate({ parentTitle: "Portland", parentSlug: "portland" }),
				],
				affectedPages: [leafPage()],
				lookupParentPages: lookupThatReturns([]),
				lookupParentPagesFuzzy: fuzzy,
				writeLink,
			});
			expect(result.linksWritten).toBe(0);
			expect(writeLink).not.toHaveBeenCalled();
		});

		it("degrades silently when fuzzy callback is omitted (exact-only)", async () => {
			const writeLink = makeWriteLink();
			const result = await emitDeterministicParentLinks({
				scope: SCOPE,
				candidates: [
					candidate({ parentTitle: "Portland", parentSlug: "portland" }),
				],
				affectedPages: [leafPage()],
				lookupParentPages: lookupThatReturns([]),
				// lookupParentPagesFuzzy: undefined  ← test wants exact-only
				writeLink,
			});
			expect(result.linksWritten).toBe(0);
			expect(writeLink).not.toHaveBeenCalled();
		});

		// ─── Geo-suffix precision gate (2026-04-20 Marco audit) ─────────
		//
		// Lowering the fuzzy threshold to recover "Austin"→"Austin, Texas"
		// would also match things like "Austin Reggae Fest" or
		// "Toronto Life" — both start with the candidate token but aren't
		// geographic hubs. The gate requires the target title to carry a
		// "X, Region" suffix before the fuzzy hit counts.
		describe("geo-suffix precision gate", () => {
			it("accepts 'Austin' → 'Austin, Texas'", async () => {
				const writeLink = makeWriteLink();
				const fuzzy = vi.fn(async () => [
					{
						id: "page-austin-tx",
						type: "entity" as const,
						slug: "austin-texas",
						title: "Austin, Texas",
						similarity: 0.54,
					},
				]);
				const result = await emitDeterministicParentLinks({
					scope: SCOPE,
					candidates: [
						candidate({ parentTitle: "Austin", parentSlug: "austin" }),
					],
					affectedPages: [leafPage()],
					lookupParentPages: lookupThatReturns([]),
					lookupParentPagesFuzzy: fuzzy,
					writeLink,
				});
				expect(result.linksWritten).toBe(1);
			});

			it("rejects 'Austin' → 'Austin Reggae Fest' (prefix match but no geo suffix)", async () => {
				const writeLink = makeWriteLink();
				const fuzzy = vi.fn(async () => [
					{
						id: "page-reggae-fest",
						type: "entity" as const,
						slug: "austin-reggae-fest",
						title: "Austin Reggae Fest",
						similarity: 0.62,
					},
				]);
				const result = await emitDeterministicParentLinks({
					scope: SCOPE,
					candidates: [
						candidate({ parentTitle: "Austin", parentSlug: "austin" }),
					],
					affectedPages: [leafPage()],
					lookupParentPages: lookupThatReturns([]),
					lookupParentPagesFuzzy: fuzzy,
					writeLink,
				});
				expect(result.linksWritten).toBe(0);
				expect(writeLink).not.toHaveBeenCalled();
			});

			it("rejects 'Toronto' → 'Toronto Life' (magazine, not geography)", async () => {
				const writeLink = makeWriteLink();
				const fuzzy = vi.fn(async () => [
					{
						id: "page-toronto-life",
						type: "entity" as const,
						slug: "toronto-life",
						title: "Toronto Life",
						similarity: 0.62,
					},
				]);
				const result = await emitDeterministicParentLinks({
					scope: SCOPE,
					candidates: [
						candidate({ parentTitle: "Toronto", parentSlug: "toronto" }),
					],
					affectedPages: [leafPage()],
					lookupParentPages: lookupThatReturns([]),
					lookupParentPagesFuzzy: fuzzy,
					writeLink,
				});
				expect(result.linksWritten).toBe(0);
			});

			it("rejects 'Honolulu' → 'Merriman's Honolulu' (candidate not prefix)", async () => {
				const writeLink = makeWriteLink();
				const fuzzy = vi.fn(async () => [
					{
						id: "page-merrimans",
						type: "entity" as const,
						slug: "merrimans-honolulu",
						title: "Merriman's Honolulu",
						similarity: 0.45,
					},
				]);
				const result = await emitDeterministicParentLinks({
					scope: SCOPE,
					candidates: [
						candidate({ parentTitle: "Honolulu", parentSlug: "honolulu" }),
					],
					affectedPages: [leafPage()],
					lookupParentPages: lookupThatReturns([]),
					lookupParentPagesFuzzy: fuzzy,
					writeLink,
				});
				expect(result.linksWritten).toBe(0);
			});

			it("scans past a rejected first hit for a later geo-qualified one", async () => {
				// Ordering of fuzzy results is sim-desc, so the precision
				// gate must keep looking past a high-sim non-geo hit. This
				// models the real "Austin Reggae Fest (0.62) > Austin,
				// Texas (0.54)" order observed in the Marco audit.
				const writeLink = makeWriteLink();
				const fuzzy = vi.fn(async () => [
					{
						id: "page-reggae-fest",
						type: "entity" as const,
						slug: "austin-reggae-fest",
						title: "Austin Reggae Fest",
						similarity: 0.62,
					},
					{
						id: "page-austin-tx",
						type: "entity" as const,
						slug: "austin-texas",
						title: "Austin, Texas",
						similarity: 0.54,
					},
				]);
				const result = await emitDeterministicParentLinks({
					scope: SCOPE,
					candidates: [
						candidate({ parentTitle: "Austin", parentSlug: "austin" }),
					],
					affectedPages: [leafPage()],
					lookupParentPages: lookupThatReturns([]),
					lookupParentPagesFuzzy: fuzzy,
					writeLink,
				});
				expect(result.linksWritten).toBe(1);
				expect(writeLink).toHaveBeenCalledWith(
					expect.objectContaining({ toPageId: "page-austin-tx" }),
				);
			});
		});
	});
});

// ─── isGeoQualifiedExtension unit matrix ─────────────────────────────────
//
// The gate is exported so we can hammer the matrix directly without
// staging fuzzy result rows. Lives outside the emitter describe block
// since it's a pure helper, not an emitter behavior.
import { isGeoQualifiedExtension } from "../lib/wiki/deterministic-linker.js";

describe("isGeoQualifiedExtension", () => {
	const cases: Array<[string, string, boolean, string]> = [
		["Austin", "Austin, Texas", true, "canonical city + state"],
		["Paris", "Paris, France", true, "canonical city + country"],
		["Portland", "Portland, Oregon", true, "the original Unit 10 case"],
		["Austin", "Austin Reggae Fest", false, "prefix match, no comma"],
		["Toronto", "Toronto Life", false, "prefix match, no geo suffix"],
		["Honolulu", "Merriman's Honolulu", false, "candidate not a prefix"],
		["", "Austin, Texas", false, "empty candidate"],
		["Austin", "", false, "empty target"],
		["Austin", "Austin", false, "identical (no suffix at all)"],
		["AUSTIN", "Austin, Texas", true, "case-insensitive prefix"],
		["São Paulo", "São Paulo, Brazil", true, "accented candidate"],
	];
	for (const [candidate, target, expected, label] of cases) {
		it(`${expected ? "accepts" : "rejects"} "${candidate}" → "${target}" (${label})`, () => {
			expect(isGeoQualifiedExtension(candidate, target)).toBe(expected);
		});
	}
});

// ─── sourceKind branch — 2026-04-20 summary-expander wiring ──────────────
//
// The emitter routes candidates based on `sourceKind`:
//   - "record" (default): sourceRecordIds are memory-record ids; leaves
//     come from affectedPages via leavesByRecord (batch-scoped).
//   - "summary": sourceRecordIds are page ids; leaves come from
//     scopePages + affectedPages via leavesById (scope-wide).
//
// These tests exercise the summary-kind path and confirm the record-kind
// path still works when sourceKind is omitted (back-compat).

describe("sourceKind='summary' candidate leaf resolution", () => {
	it("resolves leaves by page id from scopePages", async () => {
		const writeLink = makeWriteLink();
		const scopePage: AffectedPage = {
			id: "page-nana",
			type: "entity",
			slug: "nana",
			title: "Nana",
			sourceRecordIds: [], // unused for summary-kind
		};
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [
				candidate({
					sourceKind: "summary",
					sourceRecordIds: ["page-nana"],
					parentTitle: "Toronto",
					parentSlug: "toronto",
				}),
			],
			affectedPages: [], // summary-kind should not need affectedPages
			scopePages: [scopePage],
			lookupParentPages: lookupThatReturns([
				{
					title: "Toronto",
					match: {
						id: "page-toronto",
						type: "topic",
						slug: "toronto",
						title: "Toronto",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
		expect(writeLink).toHaveBeenCalledWith(
			expect.objectContaining({
				fromPageId: "page-nana",
				toPageId: "page-toronto",
				context: "deterministic:city:toronto",
			}),
		);
	});

	it("skips summary-kind candidates whose page ids aren't in any pool", async () => {
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [
				candidate({
					sourceKind: "summary",
					sourceRecordIds: ["page-not-in-scope"],
					parentTitle: "Toronto",
					parentSlug: "toronto",
				}),
			],
			affectedPages: [],
			scopePages: [], // empty pool → no leaf resolution possible
			lookupParentPages: lookupThatReturns([
				{
					title: "Toronto",
					match: {
						id: "page-toronto",
						type: "topic",
						slug: "toronto",
						title: "Toronto",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
		expect(writeLink).not.toHaveBeenCalled();
	});

	it("filters non-entity scopePages from leaf resolution", async () => {
		// Only entities are linkable leaves; topic/decision scopePages get
		// dropped from leavesById before candidate matching.
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [
				candidate({
					sourceKind: "summary",
					sourceRecordIds: ["page-topic"],
					parentTitle: "Paris",
					parentSlug: "paris",
				}),
			],
			affectedPages: [],
			scopePages: [
				{
					id: "page-topic",
					type: "topic",
					slug: "paris-food",
					title: "Paris Food",
					sourceRecordIds: [],
				},
			],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: { id: "page-paris", type: "entity", slug: "paris", title: "Paris" } },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(0);
	});

	it("record-kind candidates still work when sourceKind is omitted (back-compat)", async () => {
		// Existing test fixtures don't set sourceKind — the emitter must
		// default to "record" and use leavesByRecord / affectedPages.
		const writeLink = makeWriteLink();
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [candidate({ /* no sourceKind */ })],
			affectedPages: [leafPage()],
			lookupParentPages: lookupThatReturns([
				{ title: "Paris", match: { id: "page-paris", type: "entity", slug: "paris", title: "Paris" } },
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(1);
	});

	it("writes both record and summary emissions when both kinds target the same parent", async () => {
		// Real-world: Toronto is a city with BOTH record-based candidates
		// (memory_units with place_address) AND summary-based candidates
		// (pages whose summaries mention Toronto). Both lists should fire.
		const writeLink = makeWriteLink();
		const recordLeaf: AffectedPage = {
			id: "page-record-leaf",
			type: "entity",
			slug: "cafe-batch",
			title: "Cafe Batch",
			sourceRecordIds: ["r1"],
		};
		const scopeLeaf: AffectedPage = {
			id: "page-scope-leaf",
			type: "entity",
			slug: "cafe-scope",
			title: "Cafe Scope",
			sourceRecordIds: [],
		};
		const result = await emitDeterministicParentLinks({
			scope: SCOPE,
			candidates: [
				candidate({
					sourceKind: "record",
					sourceRecordIds: ["r1"],
					parentTitle: "Toronto",
					parentSlug: "toronto",
				}),
				candidate({
					sourceKind: "summary",
					sourceRecordIds: ["page-scope-leaf"],
					parentTitle: "Toronto",
					parentSlug: "toronto",
				}),
			],
			affectedPages: [recordLeaf],
			scopePages: [scopeLeaf],
			lookupParentPages: lookupThatReturns([
				{
					title: "Toronto",
					match: {
						id: "page-toronto",
						type: "topic",
						slug: "toronto",
						title: "Toronto",
					},
				},
			]),
			writeLink,
		});
		expect(result.linksWritten).toBe(2);
		const toIds = writeLink.mock.calls.map((c) => c[0].fromPageId).sort();
		expect(toIds).toEqual(["page-record-leaf", "page-scope-leaf"]);
	});
});
