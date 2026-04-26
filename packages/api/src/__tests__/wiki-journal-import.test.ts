/**
 * Unit tests for PR 5 — journal import + replay.
 *
 * Focus: the pure parts we can pin without a live DB.
 *   - buildRetainPayload: prose rendering and skip-rules for representative
 *     idea rows (body-only / body+place / place-only / neither)
 *   - metadata compaction drops Google Places photos + oversize fields
 *   - compile-enqueue is triggered exactly once at the end of an ingest
 *   - admin auth required on bootstrapJournalImport
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAdapter, mockEnqueue, mockFetchPage, mockAgentsRow } = vi.hoisted(
	() => ({
		mockAdapter: { retain: vi.fn() },
		mockEnqueue: vi.fn(),
		mockFetchPage: vi.fn(),
		mockAgentsRow: vi.fn(),
	}),
);

vi.mock("../graphql/utils.js", () => ({
	db: {
		select: () => ({
			from: () => ({
				where: () => ({ limit: () => mockAgentsRow() }),
			}),
		}),
	},
	eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }),
	agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	agents: { id: "agents.id", tenant_id: "agents.tenant_id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
	const actual = (await importOriginal()) as typeof import("drizzle-orm");
	return { ...actual, eq: (a: unknown, b: unknown) => ({ __eq: [a, b] }) };
});

vi.mock("../lib/wiki/repository.js", async (importOriginal) => {
	const actual =
		(await importOriginal()) as typeof import("../lib/wiki/repository.js");
	return { ...actual, enqueueCompileJob: mockEnqueue };
});

vi.mock("../lib/memory/index.js", () => ({
	getMemoryServices: () => ({
		adapter: mockAdapter,
		config: { engine: "hindsight" },
	}),
}));

// The DB-facing `fetchPage` is internal; we mock `db.execute` directly so the
// journal-import code exercises its real control flow but gets scripted rows.
vi.mock("../lib/db.js", () => ({
	db: {
		execute: vi.fn(async () => ({ rows: mockFetchPage() })),
	},
}));

import {
	buildRetainPayload,
	runJournalImport,
} from "../lib/wiki/journal-import.js";
import { bootstrapJournalImport } from "../graphql/resolvers/wiki/bootstrapJournalImport.mutation.js";
import type { GraphQLContext } from "../graphql/context.js";

beforeEach(() => {
	vi.resetAllMocks();
	mockAgentsRow.mockReturnValue([{ id: "a1", tenant_id: "t1" }]);
	mockFetchPage.mockReturnValue([]);
	mockAdapter.retain.mockResolvedValue({ record: { id: "r" } });
	// Default: no compile enqueue happens unless the test sets up records.
	mockEnqueue.mockResolvedValue({
		inserted: true,
		job: { id: "job-default" },
	});
});

// ─── buildRetainPayload ──────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "idea-1",
		body: null,
		tags: null,
		created: null,
		date_created: null,
		is_visit: null,
		is_favorite: null,
		geo_lat: null,
		geo_lon: null,
		images: null,
		external_id: null,
		idea_metadata: null,
		place_id: null,
		place_name: null,
		place_address: null,
		place_types: null,
		place_lat: null,
		place_lon: null,
		place_google_id: null,
		place_metadata: null,
		journal_id: null,
		journal_title: null,
		journal_description: null,
		journal_start_date: null,
		journal_end_date: null,
		journal_tags: null,
		...overrides,
	} as any;
}

describe("buildRetainPayload", () => {
	const owner = { tenantId: "t1", userId: "a1" };

	it("skips records with neither body nor place anchor", () => {
		const out = buildRetainPayload(makeRow({ body: " " }), owner);
		expect(out).toBeNull();
	});

	it("emits a payload for body-only records", () => {
		const out = buildRetainPayload(
			makeRow({ body: "Great pastrami." }),
			owner,
		);
		expect(out).not.toBeNull();
		expect(out!.content).toContain("Great pastrami.");
		expect(out!.sourceType).toBe("import");
		expect(out!.ownerId).toBe("a1");
	});

	it("renders place + journal + tags into prose, ordered deterministically", () => {
		const out = buildRetainPayload(
			makeRow({
				body: "Go early, line by noon.",
				place_name: "Taberna dos Mercadores",
				place_address: "Rua dos Mercadores",
				place_types: ["restaurant", "food"],
				tags: ["restaurant", "food"],
				journal_title: "Lisbon 2023",
				journal_start_date: new Date("2023-09-01T00:00:00Z"),
				journal_end_date: new Date("2023-09-15T00:00:00Z"),
			}),
			owner,
		);
		expect(out!.content).toBe(
			[
				"Go early, line by noon.",
				"",
				'From journal "Lisbon 2023" (2023-09-01–2023-09-15).',
				"",
				"Place: Taberna dos Mercadores — Rua dos Mercadores [restaurant, food].",
				"",
				"Tags: restaurant, food.",
			].join("\n"),
		);
	});

	it("falls back to 'Visited.' when body is empty but a place exists", () => {
		const out = buildRetainPayload(
			makeRow({ place_name: "Somewhere" }),
			owner,
		);
		expect(out).not.toBeNull();
		expect(out!.content.startsWith("Visited.")).toBe(true);
	});

	it("folds allow-listed google places fields and drops photos + unknown keys", () => {
		const out = buildRetainPayload(
			makeRow({
				body: "n",
				place_name: "X",
				place_metadata: {
					phone: "123",
					website: "https://x.example",
					rating: 4.5,
					photos: ["u".repeat(200)],
					openingHours: ["Mon: closed"],
					bigBlob: "x".repeat(1000),
				},
			}),
			owner,
		);
		const meta = (out!.metadata as any) ?? {};
		expect(meta.place_phone).toBe("123");
		expect(meta.place_website).toBe("https://x.example");
		expect(meta.place_rating).toBe("4.5");
		expect(meta.place_opening_hours).toBe("Mon: closed");
		expect(meta).not.toHaveProperty("place_photos");
		expect(meta).not.toHaveProperty("place_big_blob");
	});

	it("tolerates pg returning timestamp columns as strings (not Date)", () => {
		// Regression: in some pg pool configs timestamps come back as strings;
		// calling `.toISOString()` on them throws and crashes the whole
		// import. The fix normalizes through `toIsoSafe` at every date path.
		const out = buildRetainPayload(
			makeRow({
				body: "Visit",
				place_name: "Somewhere",
				created: "2026-04-17T10:00:00.000+0000" as any,
				date_created: "2026-04-17T10:00:00.000+0000" as any,
				journal_title: "T",
				journal_start_date: "2026-04-17" as any,
				journal_end_date: "2026-04-18" as any,
			}),
			owner,
		);
		expect(out).not.toBeNull();
		expect((out!.metadata as any).idea_created).toMatch(/^2026-04-17T10:00:00/);
		expect(out!.content).toContain("(2026-04-17–2026-04-18)");
	});

	it("attaches provenance to metadata for section-source tracking", () => {
		const out = buildRetainPayload(
			makeRow({ id: "idea-42", body: "n" }),
			owner,
		);
		const meta = (out!.metadata as any) ?? {};
		expect(meta.import_source).toBe("journal.idea");
		expect(meta.import_journal_idea_id).toBe("idea-42");
	});

	it("emits a fully flat string-only metadata dict (Hindsight requires Dict[str, str])", () => {
		const out = buildRetainPayload(
			makeRow({
				body: "Great pastrami.",
				tags: ["food", "restaurant"],
				is_visit: true,
				place_name: "Taberna",
				place_types: ["restaurant", "food"],
				// journal_* fields only surface when joined from journal.journal,
				// which always provides journal_id. Mirror that in the test.
				journal_id: "journal-lisbon",
				journal_title: "Lisbon",
				journal_start_date: new Date("2023-09-01T00:00:00Z"),
			}),
			owner,
		);
		const meta = out!.metadata as Record<string, unknown>;
		for (const [k, v] of Object.entries(meta)) {
			expect(typeof v, `metadata[${k}] must be string`).toBe("string");
		}
		// Spot-check the flattening conventions.
		expect(meta.idea_tags).toBe("food, restaurant");
		expect(meta.idea_is_visit).toBe("true");
		expect(meta.place_name).toBe("Taberna");
		expect(meta.place_types).toBe("restaurant, food");
		expect(meta.journal_title).toBe("Lisbon");
		expect(meta.journal_start_date).toBe("2023-09-01");
	});
});

// ─── runJournalImport orchestration ─────────────────────────────────────────

describe("runJournalImport", () => {
	it("calls adapter.retain per row and enqueues exactly one terminal compile", async () => {
		mockFetchPage
			.mockReturnValueOnce([
				makeRow({ id: "a", body: "one" }),
				makeRow({ id: "b", body: "two" }),
				makeRow({ id: "c", body: " ", place_name: null }), // skipped
			])
			.mockReturnValueOnce([]);
		mockAdapter.retain.mockResolvedValue({ record: { id: "r" } });
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-1" },
		});

		const result = await runJournalImport({
			accountId: "acct_1",
			tenantId: "t1",
			userId: "a1",
			adapter: mockAdapter as any,
		});

		expect(result.recordsIngested).toBe(2);
		expect(result.recordsSkipped).toBe(1);
		expect(result.errors).toBe(0);
		expect(result.compileJobId).toBe("job-1");
		expect(result.compileJobDeduped).toBe(false);
		expect(mockEnqueue).toHaveBeenCalledTimes(1);
	});

	it("reports a deduped terminal job when one already runs for the scope", async () => {
		mockFetchPage
			.mockReturnValueOnce([makeRow({ id: "a", body: "only" })])
			.mockReturnValueOnce([]);
		mockAdapter.retain.mockResolvedValue({ record: { id: "r" } });
		mockEnqueue.mockResolvedValueOnce({
			inserted: false,
			job: { id: "job-existing" },
		});

		const result = await runJournalImport({
			accountId: "acct_1",
			tenantId: "t1",
			userId: "a1",
			adapter: mockAdapter as any,
		});

		expect(result.compileJobId).toBe("job-existing");
		expect(result.compileJobDeduped).toBe(true);
	});

	it("respects the limit cap by short-circuiting pagination", async () => {
		// The SQL layer enforces the page-size LIMIT in production; we
		// emulate that here by returning exactly `pageSize` rows per call.
		// With limit=2 the first call should ask for pageSize=2 and the
		// loop breaks when `rows.length < pageSize` isn't hit but the
		// while condition fails after the batch is processed.
		mockFetchPage.mockReturnValueOnce([
			makeRow({ id: "a", body: "1" }),
			makeRow({ id: "b", body: "2" }),
		]);
		mockAdapter.retain.mockResolvedValue({ record: { id: "r" } });
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-1" },
		});

		const result = await runJournalImport({
			accountId: "acct_1",
			tenantId: "t1",
			userId: "a1",
			limit: 2,
			adapter: mockAdapter as any,
		});
		expect(result.recordsIngested).toBe(2);
		expect(mockAdapter.retain).toHaveBeenCalledTimes(2);
		// Confirm the loop stopped at the cap rather than asking for another page.
		expect(mockFetchPage).toHaveBeenCalledTimes(1);
	});

	it("counts retain errors without throwing out of the loop", async () => {
		mockFetchPage
			.mockReturnValueOnce([
				makeRow({ id: "a", body: "one" }),
				makeRow({ id: "b", body: "two" }),
			])
			.mockReturnValueOnce([]);
		mockAdapter.retain
			.mockRejectedValueOnce(new Error("hindsight 500"))
			.mockResolvedValueOnce({ record: { id: "r" } });
		mockEnqueue.mockResolvedValueOnce({
			inserted: true,
			job: { id: "job-1" },
		});

		const result = await runJournalImport({
			accountId: "acct_1",
			tenantId: "t1",
			userId: "a1",
			adapter: mockAdapter as any,
		});
		expect(result.errors).toBe(1);
		expect(result.recordsIngested).toBe(1);
	});
});

// ─── bootstrapJournalImport resolver authz ───────────────────────────────────

describe("bootstrapJournalImport", () => {
	function makeCtx(authType: "cognito" | "apikey"): GraphQLContext {
		return {
			auth: {
				principalId: "u",
				tenantId: "t1",
				email: null,
				authType,
			},
		} as GraphQLContext;
	}

	it("refuses a cognito-session caller", async () => {
		await expect(
			bootstrapJournalImport(
				{},
				{ accountId: "acct_1", tenantId: "t1", userId: "a1" },
				makeCtx("cognito"),
			),
		).rejects.toThrow(/Admin-only/);
	});

	it("accepts an api-key caller and dispatches (returns immediately, no await)", async () => {
		// Mutation is now fire-and-forget — it async-invokes the
		// wiki-bootstrap-import Lambda. Without STAGE / WIKI_BOOTSTRAP_IMPORT_FN
		// the resolver returns `dispatched: false` with an error string
		// instead of throwing, which is the shape the admin UI renders.
		const res = await bootstrapJournalImport(
			{},
			{ accountId: "acct_1", tenantId: "t1", userId: "a1" },
			makeCtx("apikey"),
		);
		expect(res.accountId).toBe("acct_1");
		expect(res.tenantId).toBe("t1");
		expect(res.userId).toBe("a1");
		expect(typeof res.dispatched).toBe("boolean");
		expect(typeof res.dispatchedAt).toBe("string");
	});
});
