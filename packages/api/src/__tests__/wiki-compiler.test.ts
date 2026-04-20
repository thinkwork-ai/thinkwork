/**
 * Unit tests for the PR 3 compiler stack.
 *
 * Covers the pieces we can exercise without a live Bedrock endpoint:
 *   - bedrock.parseJsonResponse (direct + fenced + leading-prose inputs)
 *   - aliases.slugifyTitle / seedAliasesForTitle
 *   - planner.validatePlannerResult (accept/reject matrix)
 *   - planner.buildPlannerUserPrompt (stable shape + metadata compaction)
 *   - section-writer.isMeaningfulChange (noise filter)
 *   - compiler.runCompileJob end-to-end with mocked adapter, mocked DB
 *     repository, mocked Bedrock planner + section-writer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Bedrock + parseJsonResponse ─────────────────────────────────────────────

import { parseJsonResponse } from "../lib/wiki/bedrock.js";

describe("parseJsonResponse", () => {
	it("parses a bare JSON object", () => {
		expect(parseJsonResponse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
	});

	it("strips ```json fences", () => {
		expect(parseJsonResponse('```json\n{"a":2}\n```')).toEqual({ a: 2 });
	});

	it("strips plain ``` fences", () => {
		expect(parseJsonResponse('```\n{"a":3}\n```')).toEqual({ a: 3 });
	});

	it("extracts the first object block when prose leads", () => {
		expect(parseJsonResponse('Here is the plan:\n{"a":4}')).toEqual({
			a: 4,
		});
	});

	it("throws on empty input", () => {
		expect(() => parseJsonResponse("")).toThrow(/empty/);
	});

	it("throws when no JSON block is present", () => {
		expect(() => parseJsonResponse("no json here at all")).toThrow(/no JSON/);
	});
});

// ─── aliases ─────────────────────────────────────────────────────────────────

import { slugifyTitle, seedAliasesForTitle } from "../lib/wiki/aliases.js";

describe("slugifyTitle", () => {
	it("lowercases and dashes", () => {
		expect(slugifyTitle("Taberna dos Mercadores")).toBe(
			"taberna-dos-mercadores",
		);
	});

	it("strips diacritics and punctuation", () => {
		expect(slugifyTitle("Café Mocha!")).toBe("cafe-mocha");
	});

	it("collapses runs of dashes + trims edges", () => {
		expect(slugifyTitle("  ---Foo & Bar---  ")).toBe("foo-bar");
	});

	it("caps at 120 chars", () => {
		const long = "a".repeat(200);
		expect(slugifyTitle(long).length).toBeLessThanOrEqual(120);
	});
});

describe("seedAliasesForTitle", () => {
	it("emits the normalized title", () => {
		expect(seedAliasesForTitle("Taberna dos Mercadores")).toEqual([
			"taberna dos mercadores",
		]);
	});

	it("returns [] for punctuation-only input", () => {
		expect(seedAliasesForTitle("!!!")).toEqual([]);
	});
});

// ─── planner validation ──────────────────────────────────────────────────────

import {
	buildPlannerUserPrompt,
	validatePlannerResult,
	_test as plannerTestExports,
} from "../lib/wiki/planner.js";

const validPlan = {
	pageUpdates: [
		{
			pageId: "p1",
			sections: [
				{ slug: "overview", rationale: "new evidence", proposed_body_md: "body" },
			],
		},
	],
	newPages: [
		{
			type: "entity",
			slug: "taberna-dos-mercadores",
			title: "Taberna dos Mercadores",
			sections: [
				{ slug: "overview", heading: "Overview", body_md: "Great pastrami." },
			],
			source_refs: ["r1"],
		},
	],
	unresolvedMentions: [
		{
			alias: "Chef João",
			suggestedType: "entity",
			context: "mentioned",
			source_ref: "r1",
		},
	],
	promotions: [
		{
			mentionId: "m1",
			reason: "crossed threshold",
			type: "entity",
			title: "Chef João",
			slug: "chef-joao",
			sections: [{ slug: "overview", heading: "Overview", body_md: "..." }],
		},
	],
};

describe("validatePlannerResult", () => {
	it("accepts a well-formed plan", () => {
		expect(() => validatePlannerResult(validPlan)).not.toThrow();
	});

	it("rejects non-object input", () => {
		expect(() => validatePlannerResult("nope")).toThrow(/not an object/);
	});

	it("rejects missing top-level arrays", () => {
		const bad = { ...validPlan, pageUpdates: undefined as unknown };
		expect(() => validatePlannerResult(bad)).toThrow(/pageUpdates/);
	});

	it("rejects unknown page types", () => {
		const bad = {
			...validPlan,
			newPages: [{ ...validPlan.newPages[0], type: "timeline" }],
		};
		expect(() => validatePlannerResult(bad)).toThrow(/type invalid/);
	});

	it("rejects updates with no pageId", () => {
		const bad = {
			...validPlan,
			pageUpdates: [{ ...validPlan.pageUpdates[0], pageId: "" }],
		};
		expect(() => validatePlannerResult(bad)).toThrow(/pageId missing/);
	});
});

describe("buildPlannerUserPrompt", () => {
	const record = {
		id: "r1",
		tenantId: "t1",
		ownerType: "agent" as const,
		ownerId: "a1",
		kind: "event" as const,
		sourceType: "journal_idea",
		status: "active" as const,
		content: { text: "Great pastrami at Taberna" },
		backendRefs: [{ backend: "hindsight", ref: "h1" }],
		createdAt: "2026-04-17T10:00:00Z",
		updatedAt: "2026-04-17T10:00:00Z",
		metadata: {
			place: { name: "Taberna dos Mercadores", photos: ["https://..."] },
			raw: "junk",
		},
	} as any;

	it("includes the record, candidate pages, and mentions sections", () => {
		const prompt = buildPlannerUserPrompt({
			tenantId: "t1",
			ownerId: "a1",
			records: [record],
			candidatePages: [
				{
					id: "p1",
					type: "entity",
					slug: "pastrami-places",
					title: "Pastrami Places",
					summary: null,
					aliases: ["pastrami"],
				},
			],
			openMentions: [
				{
					id: "m1",
					alias: "Chef João",
					aliasNormalized: "chef joão",
					mentionCount: 2,
					suggestedType: "entity",
				},
			],
		});
		expect(prompt).toContain("Memory records in this batch");
		expect(prompt).toContain("id=r1");
		expect(prompt).toContain("Candidate pages already in this scope");
		expect(prompt).toContain("id=p1");
		expect(prompt).toContain("Open unresolved mentions in this scope");
		expect(prompt).toContain("id=m1");
		expect(prompt).toContain("Required output JSON shape");
	});

	it("strips photos + raw from metadata to keep the prompt focused", () => {
		const prompt = buildPlannerUserPrompt({
			tenantId: "t1",
			ownerId: "a1",
			records: [record],
			candidatePages: [],
			openMentions: [],
		});
		expect(prompt).not.toContain("photos");
		expect(prompt).not.toContain("junk");
		expect(prompt).toContain("Taberna dos Mercadores");
	});

	it("compactMetadata drops long strings + photos + raw", () => {
		const out = plannerTestExports.compactMetadata({
			keep: "short",
			drop: "x".repeat(500),
			photos: ["u1"],
			raw: { any: 1 },
			nested: { keep: "ok", drop: "x".repeat(500), photos: ["u2"] },
		});
		expect(out.keep).toBe("short");
		expect(out).not.toHaveProperty("drop");
		expect(out).not.toHaveProperty("photos");
		expect(out).not.toHaveProperty("raw");
		expect((out.nested as any).keep).toBe("ok");
		expect((out.nested as any)).not.toHaveProperty("drop");
		expect((out.nested as any)).not.toHaveProperty("photos");
	});
});

// ─── section-writer: noise filter ────────────────────────────────────────────

import { isMeaningfulChange } from "../lib/wiki/section-writer.js";

describe("isMeaningfulChange", () => {
	it("returns false for identical strings", () => {
		expect(isMeaningfulChange("Great pastrami.", "Great pastrami.")).toBe(false);
	});

	it("returns false for whitespace-only differences", () => {
		expect(isMeaningfulChange("Great  pastrami.", "Great pastrami.")).toBe(
			false,
		);
	});

	it("returns true when moving from empty to non-empty", () => {
		expect(isMeaningfulChange(null, "New body.")).toBe(true);
	});

	it("returns true for substantive changes", () => {
		expect(
			isMeaningfulChange(
				"Great pastrami. Go early.",
				"Great pastrami. Go early; avoid Mondays.",
			),
		).toBe(true);
	});

	it("returns false for sub-5% tweaks", () => {
		const existing = "a".repeat(200);
		const proposed = "a".repeat(199) + "b"; // 1 char diff on a 200-char body
		expect(isMeaningfulChange(existing, proposed)).toBe(false);
	});
});

// ─── compiler end-to-end with mocks ──────────────────────────────────────────

// Hoisted mock handles so vi.mock factories can reach them.
const { mockAdapter, mockRepo, mockPlanner, mockWriter, mockGetServices } =
	vi.hoisted(() => {
		const mockAdapter = {
			kind: "hindsight" as const,
			listRecordsUpdatedSince: vi.fn(),
		};
		const mockGetServices = vi.fn(() => ({
			adapter: mockAdapter,
			config: { engine: "hindsight" },
		}));
		const mockRepo = {
			getCursor: vi.fn(),
			setCursor: vi.fn(),
			completeCompileJob: vi.fn(),
			findPageById: vi.fn(),
			findAliasMatches: vi.fn().mockResolvedValue([]),
			listPagesForScope: vi.fn().mockResolvedValue([]),
			listOpenMentions: vi.fn().mockResolvedValue([]),
			listPageSections: vi.fn().mockResolvedValue([]),
			upsertPage: vi.fn().mockResolvedValue({
				id: "page-new",
				type: "entity",
				slug: "page-new",
				title: "page-new",
			}),
			upsertPageLink: vi.fn().mockResolvedValue(undefined),
			upsertUnresolvedMention: vi.fn(),
			markUnresolvedPromoted: vi.fn(),
			findPagesByExactTitle: vi.fn().mockResolvedValue([]),
			findMemoryUnitPageSources: vi.fn().mockResolvedValue([]),
			normalizeAlias: (s: string) => s.toLowerCase().trim(),
		};
		const mockPlanner = { runPlanner: vi.fn() };
		const mockWriter = { writeSection: vi.fn() };
		return { mockAdapter, mockRepo, mockPlanner, mockWriter, mockGetServices };
	});

vi.mock("../lib/memory/index.js", () => ({
	getMemoryServices: mockGetServices,
}));

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
	const actual =
		(await importOriginal()) as typeof import("../lib/wiki/repository.js");
	return {
		...actual,
		// Leave normalizeAlias / slug helpers as their real implementations;
		// swap the DB-touching helpers.
		getCursor: (...args: unknown[]) => mockRepo.getCursor(...args),
		setCursor: (...args: unknown[]) => mockRepo.setCursor(...args),
		completeCompileJob: (...args: unknown[]) =>
			mockRepo.completeCompileJob(...args),
		findPageById: (...args: unknown[]) => mockRepo.findPageById(...args),
		findAliasMatches: (...args: unknown[]) =>
			mockRepo.findAliasMatches(...args),
		listPagesForScope: (...args: unknown[]) =>
			mockRepo.listPagesForScope(...args),
		listOpenMentions: (...args: unknown[]) =>
			mockRepo.listOpenMentions(...args),
		listPageSections: (...args: unknown[]) =>
			mockRepo.listPageSections(...args),
		upsertPage: (...args: unknown[]) => mockRepo.upsertPage(...args),
		upsertPageLink: (...args: unknown[]) =>
			mockRepo.upsertPageLink(...args),
		upsertUnresolvedMention: (...args: unknown[]) =>
			mockRepo.upsertUnresolvedMention(...args),
		markUnresolvedPromoted: (...args: unknown[]) =>
			mockRepo.markUnresolvedPromoted(...args),
		findPagesByExactTitle: (...args: unknown[]) =>
			mockRepo.findPagesByExactTitle(...args),
		findMemoryUnitPageSources: (...args: unknown[]) =>
			mockRepo.findMemoryUnitPageSources(...args),
	};
});

vi.mock("../lib/wiki/planner.js", async (importOriginal) => {
	const actual =
		(await importOriginal()) as typeof import("../lib/wiki/planner.js");
	return {
		...actual,
		// Swap the Bedrock-calling function; keep pure helpers real.
		runPlanner: (...args: unknown[]) => mockPlanner.runPlanner(...args),
	};
});

vi.mock("../lib/wiki/section-writer.js", async (importOriginal) => {
	const actual =
		(await importOriginal()) as typeof import("../lib/wiki/section-writer.js");
	return {
		...actual,
		writeSection: (...args: unknown[]) => mockWriter.writeSection(...args),
	};
});

import { runCompileJob } from "../lib/wiki/compiler.js";

const sampleJob = {
	id: "job-1",
	tenant_id: "t1",
	owner_id: "a1",
	dedupe_key: "t1:a1:1",
	status: "running" as const,
	trigger: "memory_retain" as const,
	attempt: 1,
	claimed_at: new Date(),
	started_at: new Date(),
	finished_at: null,
	error: null,
	metrics: null,
	created_at: new Date(),
};

function makeRecord(id: string) {
	return {
		id,
		tenantId: "t1",
		ownerType: "agent" as const,
		ownerId: "a1",
		kind: "event" as const,
		sourceType: "journal_idea" as const,
		status: "active" as const,
		content: { text: `record ${id} text` },
		backendRefs: [{ backend: "hindsight", ref: id }],
		createdAt: "2026-04-18T00:00:00Z",
		updatedAt: "2026-04-18T00:00:00Z",
	};
}

/**
 * Helper: make the adapter return a scripted sequence of pages. Avoids the
 * `clearAllMocks`/`mockResolvedValueOnce` interaction that consumed the queue
 * in this test file. We pass the full sequence and mockImplementation pops
 * them off per call.
 */
function scriptAdapter(
	pages: Array<{
		records: ReturnType<typeof makeRecord>[];
		nextCursor: { updatedAt: Date; recordId: string } | null;
	}>,
): void {
	let i = 0;
	mockAdapter.listRecordsUpdatedSince.mockImplementation(async () => {
		const out = pages[i] ?? { records: [], nextCursor: null };
		i++;
		return out;
	});
}

describe("runCompileJob", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Re-install defaults wiped by resetAllMocks.
		mockGetServices.mockImplementation(() => ({
			adapter: mockAdapter,
			config: { engine: "hindsight" },
		}));
		mockRepo.getCursor.mockResolvedValue({
			updatedAt: null,
			recordId: null,
		});
		mockRepo.listPagesForScope.mockResolvedValue([]);
		mockRepo.listOpenMentions.mockResolvedValue([]);
		mockRepo.listPageSections.mockResolvedValue([]);
		mockRepo.upsertPage.mockResolvedValue({
			id: "page-new",
			type: "entity",
			slug: "page-new",
			title: "page-new",
		});
		mockRepo.upsertPageLink.mockResolvedValue(undefined);
		mockRepo.findPagesByExactTitle.mockResolvedValue([]);
		mockRepo.findMemoryUnitPageSources.mockResolvedValue([]);
		// No alias collisions by default; individual tests override when
		// exercising the dedup path.
		mockRepo.findAliasMatches.mockResolvedValue([]);
	});

	it("creates a new page from the planner's newPages output", async () => {
		scriptAdapter([
			{
				records: [makeRecord("r1"), makeRecord("r2")],
				nextCursor: {
					updatedAt: new Date("2026-04-18T00:00:00Z"),
					recordId: "r2",
				},
			},
			{ records: [], nextCursor: null },
		]);
		mockPlanner.runPlanner.mockResolvedValueOnce({
			pageUpdates: [],
			newPages: [
				{
					type: "entity",
					slug: "taberna",
					title: "Taberna dos Mercadores",
					sections: [
						{
							slug: "overview",
							heading: "Overview",
							body_md: "Great pastrami.",
						},
					],
					source_refs: ["r1", "r2"],
				},
			],
			unresolvedMentions: [],
			promotions: [],
			usage: { inputTokens: 100, outputTokens: 40 },
		});

		const result = await runCompileJob(sampleJob);

		expect(result.status).toBe("succeeded");
		expect(result.metrics.records_read).toBe(2);
		expect(result.metrics.pages_upserted).toBe(1);
		expect(result.metrics.planner_calls).toBe(1);
		expect(mockRepo.upsertPage).toHaveBeenCalledTimes(1);
		expect(mockWriter.writeSection).not.toHaveBeenCalled();
		expect(mockRepo.setCursor).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "t1",
				ownerId: "a1",
				recordId: "r2",
			}),
		);
		expect(mockRepo.completeCompileJob).toHaveBeenCalledWith(
			expect.objectContaining({ jobId: "job-1", status: "succeeded" }),
		);
	});

	it("calls section-writer only for sections with meaningful changes", async () => {
		const existingPage = {
			id: "p-existing",
			tenant_id: "t1",
			owner_id: "a1",
			type: "entity" as const,
			slug: "taberna",
			title: "Taberna",
			summary: null,
			body_md: null,
			status: "active" as const,
			last_compiled_at: null,
			created_at: new Date(),
			updated_at: new Date(),
		};
		scriptAdapter([
			{
				records: [makeRecord("r1")],
				nextCursor: {
					updatedAt: new Date("2026-04-18T00:00:00Z"),
					recordId: "r1",
				},
			},
			{ records: [], nextCursor: null },
		]);
		mockRepo.findPageById.mockResolvedValue(existingPage);
		mockRepo.listPageSections.mockResolvedValue([
			{
				id: "s1",
				section_slug: "overview",
				heading: "Overview",
				body_md: "Existing body that stays the same",
				position: 1,
				last_source_at: null,
			},
			{
				id: "s2",
				section_slug: "notes",
				heading: "Notes",
				body_md: "Old notes",
				position: 2,
				last_source_at: null,
			},
		]);
		mockWriter.writeSection.mockResolvedValue({
			body_md: "Fully revised notes body.",
			inputTokens: 50,
			outputTokens: 30,
			modelId: "haiku",
		});
		mockPlanner.runPlanner.mockResolvedValueOnce({
			pageUpdates: [
				{
					pageId: "p-existing",
					sections: [
						{
							slug: "overview",
							rationale: "no change really",
							proposed_body_md: "Existing body that stays the same",
						},
						{
							slug: "notes",
							rationale: "reinforces prior",
							proposed_body_md:
								"Fully revised notes body with new evidence and a long tail to exceed noise threshold.",
						},
					],
				},
			],
			newPages: [],
			unresolvedMentions: [],
			promotions: [],
			usage: { inputTokens: 100, outputTokens: 40 },
		});

		const result = await runCompileJob(sampleJob);

		expect(result.status).toBe("succeeded");
		expect(mockWriter.writeSection).toHaveBeenCalledTimes(1);
		expect(result.metrics.sections_skipped).toBe(1);
		expect(result.metrics.sections_rewritten).toBe(1);
	});

	it("accumulates unresolved mentions and promotes when planner says so", async () => {
		scriptAdapter([
			{
				records: [makeRecord("r1")],
				nextCursor: null, // explicit drain
			},
			{ records: [], nextCursor: null },
		]);
		mockPlanner.runPlanner.mockResolvedValueOnce({
			pageUpdates: [],
			newPages: [],
			unresolvedMentions: [
				{
					alias: "Chef João",
					suggestedType: "entity",
					context: "mentioned at taberna",
					source_ref: "r1",
				},
			],
			promotions: [
				{
					mentionId: "m-existing",
					reason: "seen four times",
					type: "entity",
					title: "Maria Santos",
					slug: "maria-santos",
					sections: [
						{ slug: "overview", heading: "Overview", body_md: "..." },
					],
				},
			],
			usage: { inputTokens: 100, outputTokens: 40 },
		});

		const result = await runCompileJob(sampleJob);

		expect(result.status).toBe("succeeded");
		expect(result.metrics.unresolved_upserted).toBe(1);
		expect(result.metrics.unresolved_promoted).toBe(1);
		expect(mockRepo.markUnresolvedPromoted).toHaveBeenCalledWith({
			mentionId: "m-existing",
			pageId: "page-new",
		});
	});

	it("fails the job (not throws) when the planner explodes", async () => {
		scriptAdapter([
			{ records: [makeRecord("r1")], nextCursor: null },
			{ records: [], nextCursor: null },
		]);
		mockPlanner.runPlanner.mockRejectedValueOnce(new Error("bedrock 500"));

		const result = await runCompileJob(sampleJob);

		expect(result.status).toBe("failed");
		expect(result.error).toContain("bedrock 500");
		expect(mockRepo.completeCompileJob).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed" }),
		);
		expect(mockRepo.setCursor).not.toHaveBeenCalled();
	});

	it("fails cleanly when the adapter lacks listRecordsUpdatedSince", async () => {
		const brokenAdapter = { kind: "agentcore" } as any;
		const result = await runCompileJob(sampleJob, { adapter: brokenAdapter });
		expect(result.status).toBe("failed");
		expect(result.error).toMatch(/listRecordsUpdatedSince/);
	});
});
