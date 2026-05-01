/**
 * Unit tests for the draft-compile module (`packages/api/src/lib/wiki/draft-compile.ts`).
 *
 * Exercises the structural pipeline (section parse, model-response parse,
 * region computation, body composition) plus an end-to-end pass through
 * `runDraftCompile` with an injected fake seam — so we can assert the full
 * shape without a live Bedrock call.
 *
 * Job-runner integration with the database (`runDraftCompileJob`) is covered
 * by U5's writeback tests once that unit lands; U1 ships the module inert.
 */

import { describe, expect, it } from "vitest";

import {
	composeBodyFromSections,
	parseModelResponse,
	parseSections,
	runDraftCompile,
	type DraftCompileCandidate,
	type DraftCompileSeam,
} from "../lib/wiki/draft-compile.js";

// ---------------------------------------------------------------------------
// parseSections
// ---------------------------------------------------------------------------

describe("draft-compile / parseSections", () => {
	it("returns empty array for empty body", () => {
		expect(parseSections("")).toEqual([]);
		expect(parseSections("   \n  \n")).toEqual([]);
	});

	it("parses a single H2 section", () => {
		const md = "## Overview\n\nThis is the body.";
		expect(parseSections(md)).toEqual([
			{ slug: "overview", heading: "Overview", bodyMd: "This is the body." },
		]);
	});

	it("parses multiple H2 sections in order", () => {
		const md = [
			"## First",
			"",
			"first body",
			"",
			"## Second",
			"",
			"second body",
		].join("\n");
		expect(parseSections(md)).toEqual([
			{ slug: "first", heading: "First", bodyMd: "first body" },
			{ slug: "second", heading: "Second", bodyMd: "second body" },
		]);
	});

	it("captures preamble before the first H2 as a synthetic _preamble section", () => {
		const md = [
			"Some intro prose.",
			"",
			"## Details",
			"",
			"details body",
		].join("\n");
		const sections = parseSections(md);
		expect(sections).toEqual([
			{ slug: "_preamble", heading: "", bodyMd: "Some intro prose." },
			{ slug: "details", heading: "Details", bodyMd: "details body" },
		]);
	});

	it("keeps H3 and below inside their parent H2 section", () => {
		const md = [
			"## Top",
			"",
			"### Subhead",
			"",
			"sub body",
		].join("\n");
		expect(parseSections(md)).toEqual([
			{
				slug: "top",
				heading: "Top",
				bodyMd: "### Subhead\n\nsub body",
			},
		]);
	});

	it("falls back to slug='section' when heading produces an empty slug", () => {
		const md = "## ???\n\nbody";
		expect(parseSections(md)).toEqual([
			{ slug: "section", heading: "???", bodyMd: "body" },
		]);
	});
});

// ---------------------------------------------------------------------------
// composeBodyFromSections
// ---------------------------------------------------------------------------

describe("draft-compile / composeBodyFromSections", () => {
	it("rebuilds a body that round-trips through parseSections", () => {
		const original = [
			"## First",
			"",
			"first body",
			"",
			"## Second",
			"",
			"second body",
		].join("\n");
		const parsed = parseSections(original);
		const composed = composeBodyFromSections(parsed);
		expect(composed).toBe(original.trim());
	});

	it("emits the _preamble section without an H2 heading", () => {
		const composed = composeBodyFromSections([
			{ slug: "_preamble", heading: "", bodyMd: "intro" },
			{ slug: "details", heading: "Details", bodyMd: "body" },
		]);
		expect(composed).toBe("intro\n\n## Details\n\nbody");
	});

	it("accepts afterMd in place of bodyMd (model output shape)", () => {
		const composed = composeBodyFromSections([
			{ slug: "x", heading: "X", afterMd: "from-after" },
		]);
		expect(composed).toBe("## X\n\nfrom-after");
	});
});

// ---------------------------------------------------------------------------
// parseModelResponse
// ---------------------------------------------------------------------------

describe("draft-compile / parseModelResponse", () => {
	it("parses a well-formed JSON response", () => {
		const text = JSON.stringify({
			sections: [
				{
					slug: "overview",
					heading: "Overview",
					afterMd: "body",
					contributingCandidateIds: ["c1"],
					sourceFamily: "WEB",
					citation: { uri: "https://x", label: "X" },
				},
			],
		});
		const parsed = parseModelResponse(text);
		expect(parsed.sections).toHaveLength(1);
		expect(parsed.sections[0]).toEqual({
			slug: "overview",
			heading: "Overview",
			afterMd: "body",
			contributingCandidateIds: ["c1"],
			sourceFamily: "WEB",
			citation: { uri: "https://x", label: "X" },
		});
	});

	it("strips surrounding ```json fences", () => {
		const text = "```json\n" + JSON.stringify({ sections: [] }) + "\n```";
		expect(parseModelResponse(text).sections).toEqual([]);
	});

	it("throws on non-JSON output", () => {
		expect(() => parseModelResponse("not json")).toThrow(/not valid JSON/);
	});

	it("throws when sections key is missing", () => {
		expect(() => parseModelResponse(JSON.stringify({}))).toThrow(
			/missing `sections`/,
		);
	});

	it("throws when a section is missing slug or heading", () => {
		expect(() =>
			parseModelResponse(
				JSON.stringify({
					sections: [{ slug: "", heading: "x", afterMd: "" }],
				}),
			),
		).toThrow(/missing slug or heading/);
	});

	it("ignores unknown sourceFamily values (treats as null)", () => {
		const text = JSON.stringify({
			sections: [
				{
					slug: "s",
					heading: "S",
					afterMd: "",
					contributingCandidateIds: [],
					sourceFamily: "UNKNOWN",
				},
			],
		});
		expect(parseModelResponse(text).sections[0]!.sourceFamily).toBeNull();
	});

	it("filters out non-string contributingCandidateIds", () => {
		const text = JSON.stringify({
			sections: [
				{
					slug: "s",
					heading: "S",
					afterMd: "",
					contributingCandidateIds: ["a", 1, null, "b"],
				},
			],
		});
		expect(parseModelResponse(text).sections[0]!.contributingCandidateIds).toEqual([
			"a",
			"b",
		]);
	});
});

// ---------------------------------------------------------------------------
// runDraftCompile (with injected seam)
// ---------------------------------------------------------------------------

const baseCandidates: DraftCompileCandidate[] = [
	{
		id: "c1",
		title: "New fact",
		summary: "Paris Opera tickets go on sale 60 days ahead.",
		sourceFamily: "WEB",
		providerId: "exa",
		citation: { uri: "https://example.com", label: "example" },
	},
];

function fakeSeam(jsonOutput: string): DraftCompileSeam {
	return {
		invokeModel: async () => ({
			text: jsonOutput,
			inputTokens: 100,
			outputTokens: 50,
			modelId: "test-model",
		}),
	};
}

describe("draft-compile / runDraftCompile (seam-injected)", () => {
	it("happy path: produces a region for a touched section", async () => {
		const seam = fakeSeam(
			JSON.stringify({
				sections: [
					{
						slug: "overview",
						heading: "Overview",
						afterMd: "Original overview prose.",
						contributingCandidateIds: [],
					},
					{
						slug: "tickets",
						heading: "Tickets",
						afterMd: "Tickets go on sale 60 days ahead.",
						contributingCandidateIds: ["c1"],
						sourceFamily: "WEB",
						citation: { uri: "https://example.com", label: "example" },
					},
				],
			}),
		);
		const result = await runDraftCompile(
			{
				pageId: "p1",
				pageTable: "wiki_pages",
				pageTitle: "Paris Opera",
				currentBodyMd: "## Overview\n\nOriginal overview prose.",
				candidates: baseCandidates,
			},
			seam,
		);
		expect(result.snapshotMd).toBe("## Overview\n\nOriginal overview prose.");
		expect(result.proposedBodyMd).toBe(
			"## Overview\n\nOriginal overview prose.\n\n## Tickets\n\nTickets go on sale 60 days ahead.",
		);
		expect(result.regions).toHaveLength(1);
		expect(result.regions[0]).toMatchObject({
			sectionSlug: "tickets",
			sectionHeading: "Tickets",
			sourceFamily: "WEB",
			contributingCandidateIds: ["c1"],
			beforeMd: "",
			afterMd: "Tickets go on sale 60 days ahead.",
		});
		expect(result.regions[0]!.citation).toEqual({
			uri: "https://example.com",
			label: "example",
		});
		expect(result.modelId).toBe("test-model");
		expect(result.inputTokens).toBe(100);
		expect(result.outputTokens).toBe(50);
	});

	it("no-op: zero regions when proposed sections match snapshot text and no contributors", async () => {
		const seam = fakeSeam(
			JSON.stringify({
				sections: [
					{
						slug: "overview",
						heading: "Overview",
						afterMd: "Original prose.",
						contributingCandidateIds: [],
					},
				],
			}),
		);
		const result = await runDraftCompile(
			{
				pageId: "p1",
				pageTable: "wiki_pages",
				pageTitle: "Page",
				currentBodyMd: "## Overview\n\nOriginal prose.",
				candidates: baseCandidates,
			},
			seam,
		);
		expect(result.regions).toEqual([]);
	});

	it("text changed but no contributors still emits a region (model edited prose without claiming candidates)", async () => {
		const seam = fakeSeam(
			JSON.stringify({
				sections: [
					{
						slug: "overview",
						heading: "Overview",
						afterMd: "Refined prose.",
						contributingCandidateIds: [],
					},
				],
			}),
		);
		const result = await runDraftCompile(
			{
				pageId: "p1",
				pageTable: "wiki_pages",
				pageTitle: "Page",
				currentBodyMd: "## Overview\n\nOriginal prose.",
				candidates: baseCandidates,
			},
			seam,
		);
		expect(result.regions).toHaveLength(1);
		expect(result.regions[0]!.beforeMd).toBe("Original prose.");
		expect(result.regions[0]!.afterMd).toBe("Refined prose.");
		expect(result.regions[0]!.contributingCandidateIds).toEqual([]);
	});

	it("removed section: snapshot section absent from proposed becomes a region with empty afterMd", async () => {
		const seam = fakeSeam(
			JSON.stringify({
				sections: [
					{
						slug: "overview",
						heading: "Overview",
						afterMd: "Kept.",
						contributingCandidateIds: [],
					},
				],
			}),
		);
		const result = await runDraftCompile(
			{
				pageId: "p1",
				pageTable: "wiki_pages",
				pageTitle: "Page",
				currentBodyMd: "## Overview\n\nKept.\n\n## Old\n\nOld content.",
				candidates: [],
			},
			seam,
		);
		const removed = result.regions.find((r) => r.sectionSlug === "old");
		expect(removed).toBeDefined();
		expect(removed!.beforeMd).toBe("Old content.");
		expect(removed!.afterMd).toBe("");
	});

	it("MIXED source family when a region has contributors from multiple families", async () => {
		const seam = fakeSeam(
			JSON.stringify({
				sections: [
					{
						slug: "overview",
						heading: "Overview",
						afterMd: "Combined.",
						contributingCandidateIds: ["c1", "c2"],
					},
				],
			}),
		);
		const result = await runDraftCompile(
			{
				pageId: "p1",
				pageTable: "wiki_pages",
				pageTitle: "Page",
				currentBodyMd: "## Overview\n\nOriginal.",
				candidates: [
					{
						id: "c1",
						title: "Web fact",
						summary: "x",
						sourceFamily: "WEB",
					},
					{
						id: "c2",
						title: "KB fact",
						summary: "y",
						sourceFamily: "KNOWLEDGE_BASE",
					},
				],
			},
			seam,
		);
		expect(result.regions[0]!.sourceFamily).toBe("MIXED");
	});

	it("propagates seam errors as thrown exceptions", async () => {
		const seam: DraftCompileSeam = {
			invokeModel: async () => {
				throw new Error("bedrock fell over");
			},
		};
		await expect(
			runDraftCompile(
				{
					pageId: "p1",
					pageTable: "wiki_pages",
					pageTitle: "Page",
					currentBodyMd: "## Overview\n\nx.",
					candidates: baseCandidates,
				},
				seam,
			),
		).rejects.toThrow(/bedrock fell over/);
	});

	it("rejects malformed model output cleanly", async () => {
		const seam = fakeSeam("not json at all");
		await expect(
			runDraftCompile(
				{
					pageId: "p1",
					pageTable: "wiki_pages",
					pageTitle: "Page",
					currentBodyMd: "## Overview\n\nx.",
					candidates: baseCandidates,
				},
				seam,
			),
		).rejects.toThrow(/not valid JSON/);
	});

	it("empty current body + new candidates produces a region with empty beforeMd", async () => {
		const seam = fakeSeam(
			JSON.stringify({
				sections: [
					{
						slug: "overview",
						heading: "Overview",
						afterMd: "First content.",
						contributingCandidateIds: ["c1"],
						sourceFamily: "WEB",
					},
				],
			}),
		);
		const result = await runDraftCompile(
			{
				pageId: "p1",
				pageTable: "wiki_pages",
				pageTitle: "Page",
				currentBodyMd: "",
				candidates: baseCandidates,
			},
			seam,
		);
		expect(result.regions).toHaveLength(1);
		expect(result.regions[0]!.beforeMd).toBe("");
		expect(result.regions[0]!.afterMd).toBe("First content.");
	});
});
