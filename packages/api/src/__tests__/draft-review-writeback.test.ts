/**
 * Unit tests for `draft-review-writeback.ts` (U5 of plan 2026-05-01-002).
 *
 * Covers the three writeback outcomes (success, no-op, failure) with mocked
 * Drizzle calls and a fake S3 client, asserting:
 *   - the right rows are inserted (thread, thread_turn, agent_workspace_runs,
 *     agent_workspace_events, messages)
 *   - the workspace event payload carries kind='brain_enrichment_draft_review'
 *     and the structured page + regions shape
 *   - the no-op path doesn't create a workspace_run
 *   - the failure path closes the thread as cancelled with reason metadata
 *
 * The orchestration test (`runDraftCompileJob` calling the writeback) is in
 * `wiki-draft-compile.test.ts`.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// All Drizzle table objects are imported from this module by the writeback;
// returning a stable identity per table lets us assert "which table got
// inserted into" by matching on the table reference itself.
// Use vi.hoisted so the tokens are available inside the vi.mock factory
// without falling afoul of vi.mock's top-level-variable restriction.
const tableTokens = vi.hoisted(() => ({
	tenants: { __tag: "tenants" } as { __tag: string },
	agents: { __tag: "agents" } as { __tag: string },
	threads: { __tag: "threads" } as { __tag: string },
	threadTurns: { __tag: "threadTurns" } as { __tag: string },
	agentWorkspaceRuns: { __tag: "agentWorkspaceRuns" } as { __tag: string },
	agentWorkspaceEvents: { __tag: "agentWorkspaceEvents" } as { __tag: string },
	messages: { __tag: "messages" } as { __tag: string },
}));

// `sendExternalTaskPush` reaches for the real database via getDb() which is
// not configured in CI's vitest environment. The writeback fires the push
// best-effort via `void sendExternalTaskPush(...)`, but the unhandled
// rejection from a missing DATABASE_URL bubbles up and fails the test.
// Local runs may incidentally have DATABASE_URL set (from psql work) which
// masks this in dev. Stub it here so the writeback's own logic is the
// only thing under test, environment-independently.
vi.mock("../lib/push-notifications.js", () => ({
	sendExternalTaskPush: vi.fn(async () => undefined),
}));

vi.mock("../graphql/utils.js", () => {
	return {
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
	};
});

import {
	writeDraftReviewSuccess,
	writeDraftReviewNoOp,
	writeDraftReviewFailure,
	type DraftWritebackContext,
} from "../lib/brain/draft-review-writeback.js";
import type { WikiCompileJobRow } from "../lib/wiki/repository.js";
import type { DraftCompileResult } from "../lib/wiki/draft-compile.js";

// ---------------------------------------------------------------------------
// Fake DB + S3
// ---------------------------------------------------------------------------

interface FakeInsertCall {
	table: object;
	values: unknown;
}
interface FakeUpdateCall {
	table: object;
	set: unknown;
	where?: unknown;
}

function makeFakeDb() {
	const inserts: FakeInsertCall[] = [];
	const updates: FakeUpdateCall[] = [];
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
			const rows = selectQueue.shift() ?? [];
			return Promise.resolve(rows);
		},
		insert(table: object) {
			return {
				values(values: unknown) {
					inserts.push({ table, values });
					const builder = {
						returning(_cols?: unknown) {
							// Heuristic: return a stable id based on insert order so
							// tests can correlate.
							const id = `id-${inserts.length}`;
							return Promise.resolve([{ id }]);
						},
						onConflictDoNothing(_args?: unknown) {
							// No-op in the fake; record a flag so tests can assert if
							// needed. Real Drizzle returns a Promise; mirror that here.
							return Promise.resolve([]);
						},
					};
					return builder;
				},
			};
		},
		update(table: object) {
			return {
				set(setValues: unknown) {
					return {
						where(whereClause: unknown) {
							updates.push({ table, set: setValues, where: whereClause });
							return {
								returning(_cols?: unknown) {
									if (table === tableTokens.tenants) {
										return Promise.resolve([{ nextNumber: 42 }]);
									}
									return Promise.resolve([]);
								},
							};
						},
					};
				},
			};
		},
	};

	return { db, inserts, updates, pushSelect };
}

function makeFakeS3() {
	const calls: { Bucket: string; Key: string; Body: unknown }[] = [];
	const client = {
		send: vi.fn(async (cmd: { input: { Bucket: string; Key: string; Body: unknown } }) => {
			calls.push(cmd.input);
			return { ETag: '"fake-etag"' };
		}),
	};
	return { client, calls };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseJob: WikiCompileJobRow = {
	id: "job-1",
	tenant_id: "tenant-1",
	owner_id: "user-1",
	dedupe_key: "enrichment-draft:tenant-1:user-1:page-1:5601200",
	status: "running",
	trigger: "enrichment_draft",
	attempt: 1,
	claimed_at: new Date(),
	started_at: new Date(),
	finished_at: null,
	error: null,
	metrics: null,
	created_at: new Date(),
};

const baseContext: DraftWritebackContext = {
	job: baseJob,
	pageTable: "wiki_pages",
	pageId: "page-1",
	pageTitle: "Paris Opera",
	candidates: [
		{
			id: "c1",
			title: "Tickets",
			summary: "Tickets go on sale 60 days ahead.",
			sourceFamily: "WEB",
		},
	],
};

const baseResult: DraftCompileResult = {
	proposedBodyMd: "## Overview\n\nProposed.\n\n## Tickets\n\nNew fact.",
	snapshotMd: "## Overview\n\nProposed.",
	regions: [
		{
			id: "region-tickets",
			sectionSlug: "tickets",
			sectionHeading: "Tickets",
			sourceFamily: "WEB",
			citation: { uri: "https://example", label: "example" },
			beforeMd: "",
			afterMd: "New fact.",
			contributingCandidateIds: ["c1"],
		},
	],
	modelId: "test-model",
	inputTokens: 100,
	outputTokens: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("writeDraftReviewSuccess", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("inserts thread + turn + run + event + message and writes S3", async () => {
		const { db, inserts, pushSelect } = makeFakeDb();
		const { client: s3, calls: s3Calls } = makeFakeS3();
		// Tenant slug, agent paired, agent fallback — three SELECTs in resolveAgentContext
		pushSelect([{ slug: "acme" }]); // tenant slug
		pushSelect([{ id: "agent-1", slug: "ops" }]); // paired agent

		const result = await writeDraftReviewSuccess({
			context: baseContext,
			result: baseResult,
			io: { db: db as never, s3: s3 as never, bucket: "test-bucket" },
		});

		expect(result.status).toBe("awaiting_review");
		expect(result.workspaceRunId).toBeTruthy();
		expect(result.reviewObjectKey).toMatch(
			/^tenants\/acme\/agents\/ops\/workspace\/review\/brain-enrichment-draft-/,
		);

		// S3 sidecar
		expect(s3Calls).toHaveLength(1);
		const s3Body = JSON.parse(s3Calls[0]!.Body as string);
		expect(s3Body.kind).toBe("brain_enrichment_draft_review");
		expect(s3Body.proposedBodyMd).toBe(baseResult.proposedBodyMd);
		expect(s3Body.regions).toHaveLength(1);

		// DB inserts in order: thread, threadTurns, agentWorkspaceRuns, agentWorkspaceEvents, messages
		const tables = inserts.map((i) => (i.table as { __tag: string }).__tag);
		expect(tables).toEqual([
			"threads",
			"threadTurns",
			"agentWorkspaceRuns",
			"agentWorkspaceEvents",
			"messages",
		]);

		// Workspace event carries the structured payload
		const event = inserts[3]!.values as { payload: { kind: string; regions: unknown[] } };
		expect(event.payload.kind).toBe("brain_enrichment_draft_review");
		expect(event.payload.regions).toHaveLength(1);

		// Message metadata
		const msg = inserts[4]!.values as { metadata: { kind: string; regionCount: number } };
		expect(msg.metadata.kind).toBe("brain_enrichment_draft_ready");
		expect(msg.metadata.regionCount).toBe(1);
	});

	it("idempotency_key includes the compile job id", async () => {
		const { db, inserts, pushSelect } = makeFakeDb();
		const { client: s3 } = makeFakeS3();
		pushSelect([{ slug: "acme" }]);
		pushSelect([{ id: "agent-1", slug: "ops" }]);

		await writeDraftReviewSuccess({
			context: baseContext,
			result: baseResult,
			io: { db: db as never, s3: s3 as never, bucket: "test-bucket" },
		});

		const event = inserts.find(
			(i) => (i.table as { __tag: string }).__tag === "agentWorkspaceEvents",
		)!;
		const eventValues = event.values as { idempotency_key: string };
		expect(eventValues.idempotency_key).toBe("brain-enrichment-draft:job-1");
	});

	it("falls back to non-paired agent when no human-pair exists", async () => {
		const { db, inserts, pushSelect } = makeFakeDb();
		const { client: s3 } = makeFakeS3();
		pushSelect([{ slug: "acme" }]); // tenant slug
		pushSelect([]); // no paired
		pushSelect([{ id: "fallback-agent", slug: null }]); // fallback

		const result = await writeDraftReviewSuccess({
			context: baseContext,
			result: baseResult,
			io: { db: db as never, s3: s3 as never, bucket: "test-bucket" },
		});

		expect(result.reviewObjectKey).toMatch(
			/agents\/fallback-agent\/workspace\/review/,
		);
		const run = inserts.find(
			(i) => (i.table as { __tag: string }).__tag === "agentWorkspaceRuns",
		)!;
		expect((run.values as { agent_id: string }).agent_id).toBe("fallback-agent");
	});

	it("throws when bucket is not configured", async () => {
		const { db } = makeFakeDb();
		const { client: s3 } = makeFakeS3();
		await expect(
			writeDraftReviewSuccess({
				context: baseContext,
				result: baseResult,
				io: { db: db as never, s3: s3 as never, bucket: "" },
			}),
		).rejects.toThrow(/WORKSPACE_BUCKET/);
	});
});

describe("writeDraftReviewNoOp", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates thread in `done` status with no workspace_run", async () => {
		const { db, inserts, updates, pushSelect } = makeFakeDb();
		pushSelect([{ slug: "acme" }]);
		pushSelect([{ id: "agent-1", slug: "ops" }]);

		const result = await writeDraftReviewNoOp({
			context: baseContext,
			io: { db: db as never },
		});

		expect(result.status).toBe("done");
		expect(result.workspaceRunId).toBeNull();
		expect(result.reviewObjectKey).toBeNull();

		const tables = inserts.map((i) => (i.table as { __tag: string }).__tag);
		// Thread + turn + message; NO run, NO event
		expect(tables).toEqual(["threads", "threadTurns", "messages"]);

		// Thread metadata
		const thread = inserts[0]!.values as { metadata: { kind: string }; status: string };
		expect(thread.metadata.kind).toBe("brain_enrichment_draft_no_op");
		expect(thread.status).toBe("done");

		// Turn closed via update
		const turnUpdate = updates.find(
			(u) => (u.table as { __tag: string }).__tag === "threadTurns",
		)!;
		expect((turnUpdate.set as { status: string }).status).toBe("succeeded");
	});
});

describe("writeDraftReviewFailure", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates thread in `cancelled` status with error in metadata", async () => {
		const { db, inserts, updates, pushSelect } = makeFakeDb();
		pushSelect([{ slug: "acme" }]);
		pushSelect([{ id: "agent-1", slug: "ops" }]);

		const result = await writeDraftReviewFailure({
			context: baseContext,
			error: "bedrock fell over",
			io: { db: db as never },
		});

		expect(result.status).toBe("cancelled");
		expect(result.workspaceRunId).toBeNull();

		// Thread metadata carries reason='compile_failed' + error string
		const thread = inserts[0]!.values as {
			metadata: { kind: string; reason: string; error: string };
			status: string;
		};
		expect(thread.metadata.kind).toBe("brain_enrichment_draft_failed");
		expect(thread.metadata.reason).toBe("compile_failed");
		expect(thread.metadata.error).toBe("bedrock fell over");
		expect(thread.status).toBe("cancelled");

		// Turn closed via update with cancelled status
		const turnUpdate = updates.find(
			(u) => (u.table as { __tag: string }).__tag === "threadTurns",
		)!;
		expect((turnUpdate.set as { status: string }).status).toBe("cancelled");
	});
});
