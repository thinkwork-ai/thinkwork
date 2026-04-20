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
});
