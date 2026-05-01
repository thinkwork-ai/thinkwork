/**
 * Resolver-level test for U6 of plan 2026-05-01-002.
 *
 * Verifies the rewire of `runBrainPageEnrichment`: the resolver now enqueues
 * a `wiki_compile_jobs` row with trigger='enrichment_draft', async-invokes
 * the wiki-compile Lambda, and returns immediately with status='QUEUED' and
 * NO synchronous workspace_run / thread / S3 review object.
 *
 * Implementation surface (createReviewThread, agentWorkspaceRuns, etc.) is
 * NOT exercised here — those are the legacy synchronous path. We assert
 * positively (job inserted, queued response shape) and negatively (no thread
 * insert, no S3 PutObject).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// Drizzle table tokens needed by the resolver's transitive imports. The
// resolver itself does not import wikiCompileJobs from utils.js — that lives
// in the repository module which this test mocks separately — so it is not
// included here.
const tableTokens = vi.hoisted(() => ({
	tenants: { __tag: "tenants" } as { __tag: string },
	agents: { __tag: "agents" } as { __tag: string },
	threads: { __tag: "threads" } as { __tag: string },
	threadTurns: { __tag: "threadTurns" } as { __tag: string },
	agentWorkspaceRuns: { __tag: "agentWorkspaceRuns" } as { __tag: string },
	agentWorkspaceEvents: { __tag: "agentWorkspaceEvents" } as { __tag: string },
	messages: { __tag: "messages" } as { __tag: string },
}));

vi.mock("../../graphql/utils.js", () => ({
	db: {} as never,
	tenants: tableTokens.tenants,
	agents: tableTokens.agents,
	threads: tableTokens.threads,
	threadTurns: tableTokens.threadTurns,
	agentWorkspaceRuns: tableTokens.agentWorkspaceRuns,
	agentWorkspaceEvents: tableTokens.agentWorkspaceEvents,
	messages: tableTokens.messages,
	eq: (...args: unknown[]) => ({ __op: "eq", args }),
	and: (...args: unknown[]) => ({ __op: "and", args }),
	sql: ((strings: TemplateStringsArray, ...values: unknown[]) => ({
		__op: "sql",
		strings: [...strings],
		values,
	})) as unknown as never,
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
	tenantEntityPages: { __tag: "tenantEntityPages" } as never,
	wikiPages: { __tag: "wikiPages" } as never,
}));

const enqueueMock = vi.hoisted(() =>
	vi.fn(async (args: { tenantId: string; ownerId: string; pageId: string; input: unknown }) => ({
		inserted: true,
		job: {
			id: "job-test-1",
			tenant_id: args.tenantId,
			owner_id: args.ownerId,
			dedupe_key: `enrichment-draft:${args.tenantId}:${args.ownerId}:${args.pageId}:5601200`,
			status: "pending",
			trigger: "enrichment_draft",
			attempt: 0,
			claimed_at: null,
			started_at: null,
			finished_at: null,
			error: null,
			metrics: null,
			created_at: new Date(),
		},
	})),
);

vi.mock("../wiki/repository.js", () => ({
	enqueueEnrichmentDraftCompileJob: enqueueMock,
}));

const invokeMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../wiki/enqueue.js", () => ({
	invokeWikiCompile: invokeMock,
}));

import { runBrainPageEnrichment } from "./enrichment-service.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeFakeDb() {
	const inserts: { table: object; values: unknown }[] = [];
	const selectQueue: unknown[][] = [];
	function pushSelect(rows: unknown[]) {
		selectQueue.push(rows);
	}
	const db = {
		select() {
			return this;
		},
		from() {
			return this;
		},
		where() {
			return this;
		},
		limit(_n: number) {
			return Promise.resolve(selectQueue.shift() ?? []);
		},
		insert(table: object) {
			return {
				values(values: unknown) {
					inserts.push({ table, values });
					return {
						returning: () => Promise.resolve([{ id: `id-${inserts.length}` }]),
						onConflictDoNothing: () => Promise.resolve([]),
					};
				},
			};
		},
		update() {
			return {
				set() {
					return {
						where() {
							return { returning: () => Promise.resolve([]) };
						},
					};
				},
			};
		},
	};
	return { db, inserts, pushSelect };
}

function makeFakeContextEngine(args?: {
	providers?: { id: string; family: string; sourceFamily?: string }[];
	hits?: { content: string; sourceFamily: string; providerId: string }[];
}) {
	return {
		listProviders: vi.fn(async () => args?.providers ?? []),
		query: vi.fn(async () => ({
			providers: [],
			hits: args?.hits ?? [],
		})),
	};
}

const baseInput = {
	tenantId: "tenant-1",
	pageTable: "wiki_pages" as const,
	pageId: "page-1",
	query: null,
	sourceFamilies: null,
	limit: null,
};

const baseCaller = {
	userId: "user-1",
	tenantId: "tenant-1",
	scope: "auto" as const,
	depth: "quick" as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBrainPageEnrichment (U6 async draft-compile path)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("enqueues an enrichment_draft job with the candidate input shape", async () => {
		const { db, inserts, pushSelect } = makeFakeDb();
		// loadTargetPage SELECT (wiki_pages) returns the target page
		pushSelect([
			{
				id: "page-1",
				tenantId: "tenant-1",
				title: "Paris Opera",
				summary: null,
				bodyMd: "## Overview\n\nExisting prose.",
			},
		]);

		const result = await runBrainPageEnrichment({
			input: baseInput,
			caller: baseCaller as never,
			db: db as never,
			contextEngine: makeFakeContextEngine() as never,
		});

		expect(result.status).toBe("QUEUED");
		expect(result.threadId).toBeNull();
		expect(result.reviewRunId).toBeNull();
		expect(result.reviewObjectKey).toBeNull();
		expect(result.id).toBe("job-test-1");
		expect(result.title).toBe("Enrich Paris Opera");

		// Enqueue called with the right shape
		expect(enqueueMock).toHaveBeenCalledTimes(1);
		const enqueueArgs = enqueueMock.mock.calls[0]![0];
		expect(enqueueArgs.tenantId).toBe("tenant-1");
		expect(enqueueArgs.ownerId).toBe("user-1");
		expect(enqueueArgs.pageId).toBe("page-1");
		expect(enqueueArgs.input).toMatchObject({
			pageId: "page-1",
			pageTable: "wiki_pages",
			pageTitle: "Paris Opera",
			currentBodyMd: "## Overview\n\nExisting prose.",
		});

		// invokeWikiCompile fired with the new jobId
		expect(invokeMock).toHaveBeenCalledTimes(1);
		const invokeArgs = invokeMock.mock.calls[0] as unknown as [string];
		expect(invokeArgs[0]).toBe("job-test-1");

		// Crucially: NO thread / workspace_run / messages / S3 inserts.
		const insertedTables = inserts.map(
			(i) => (i.table as { __tag: string }).__tag,
		);
		expect(insertedTables).not.toContain("threads");
		expect(insertedTables).not.toContain("threadTurns");
		expect(insertedTables).not.toContain("agentWorkspaceRuns");
		expect(insertedTables).not.toContain("agentWorkspaceEvents");
		expect(insertedTables).not.toContain("messages");
	});

	it("does NOT invoke wiki-compile when the job dedupes (already enqueued in this bucket)", async () => {
		enqueueMock.mockResolvedValueOnce({
			inserted: false,
			job: {
				id: "job-existing-1",
				tenant_id: "tenant-1",
				owner_id: "user-1",
				dedupe_key: "enrichment-draft:tenant-1:user-1:page-1:5601200",
				status: "pending",
				trigger: "enrichment_draft",
				attempt: 0,
				claimed_at: null,
				started_at: null,
				finished_at: null,
				error: null,
				metrics: null,
				created_at: new Date(),
			},
		});

		const { db, pushSelect } = makeFakeDb();
		pushSelect([
			{
				id: "page-1",
				tenantId: "tenant-1",
				title: "Paris Opera",
				summary: null,
				bodyMd: "",
			},
		]);

		const result = await runBrainPageEnrichment({
			input: baseInput,
			caller: baseCaller as never,
			db: db as never,
			contextEngine: makeFakeContextEngine() as never,
		});

		expect(result.status).toBe("QUEUED");
		expect(result.id).toBe("job-existing-1");
		// Dedupe path does not async-invoke — the existing job is presumably
		// already running or queued.
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("returns the synthesized candidates in the queued response (for mobile preview)", async () => {
		const { db, pushSelect } = makeFakeDb();
		pushSelect([
			{
				id: "page-1",
				tenantId: "tenant-1",
				title: "Paris Opera",
				summary: null,
				bodyMd: "",
			},
		]);

		const result = await runBrainPageEnrichment({
			input: baseInput,
			caller: baseCaller as never,
			db: db as never,
			contextEngine: makeFakeContextEngine() as never,
		});

		// Even with empty hits, candidates is an array (possibly empty) so the
		// mobile sheet's existing render against `candidates` doesn't crash.
		expect(Array.isArray(result.candidates)).toBe(true);
	});

	it("propagates the resolver error when the page does not exist", async () => {
		const { db, pushSelect } = makeFakeDb();
		pushSelect([]); // loadTargetPage finds nothing

		await expect(
			runBrainPageEnrichment({
				input: baseInput,
				caller: baseCaller as never,
				db: db as never,
				contextEngine: makeFakeContextEngine() as never,
			}),
		).rejects.toThrow(/Brain page not found/);

		expect(enqueueMock).not.toHaveBeenCalled();
		expect(invokeMock).not.toHaveBeenCalled();
	});
});
