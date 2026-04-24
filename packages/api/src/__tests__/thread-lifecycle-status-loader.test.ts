/**
 * Loader-level test for the threadLifecycleStatus DataLoader.
 *
 * The pure function is covered by lifecycle-status.test.ts. This suite
 * exercises the batching integration:
 *
 *  1. Two SQL probes fire regardless of the number of thread IDs (one
 *     active probe, one latest-row probe). Batching invariant.
 *  2. Loader output order matches input thread-id order (DataLoader
 *     contract).
 *  3. An active-turn hit on one thread doesn't leak the RUNNING result
 *     to its siblings.
 *  4. The mapping pipes through deriveLifecycleStatus — stuck queued,
 *     latest succeeded, and no-turns cases resolve per the unit-tested
 *     table.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbSelectMock, dbExecuteMock } = vi.hoisted(() => ({
	dbSelectMock: vi.fn(),
	dbExecuteMock: vi.fn(),
}));

vi.mock("../graphql/utils.js", () => {
	return {
		db: {
			select: (...args: unknown[]) => dbSelectMock(...args),
			execute: (...args: unknown[]) => dbExecuteMock(...args),
		},
		messages: { thread_id: "messages.thread_id", created_at: "messages.created_at", role: "messages.role" },
		threadTurns: {
			thread_id: "thread_turns.thread_id",
			status: "thread_turns.status",
			created_at: "thread_turns.created_at",
		},
	};
});

import { createThreadLoaders } from "../graphql/resolvers/threads/loaders.js";

/**
 * Stubbed select()-chain builder. Accepts the where() input and replays
 * the rows set per test. Shape matches Drizzle's fluent select builder
 * enough for the loader's probe 1.
 */
function selectChain(rows: unknown[]) {
	return {
		from: () => ({
			where: () => Promise.resolve(rows),
		}),
	};
}

describe("threadLifecycleStatus DataLoader", () => {
	beforeEach(() => {
		dbSelectMock.mockReset();
		dbExecuteMock.mockReset();
	});

	it("fires exactly one active-probe and one latest-probe regardless of thread count", async () => {
		dbSelectMock.mockReturnValue(selectChain([])); // no active turns
		dbExecuteMock.mockResolvedValue({ rows: [] }); // no rows in latest probe

		const { threadLifecycleStatus } = createThreadLoaders();
		await Promise.all([
			threadLifecycleStatus.load("t-1"),
			threadLifecycleStatus.load("t-2"),
			threadLifecycleStatus.load("t-3"),
		]);

		// Probe 1 (active) fired once, covering all 3 thread IDs in a single query.
		expect(dbSelectMock).toHaveBeenCalledTimes(1);
		// Probe 2 (latest DISTINCT ON) fired once.
		expect(dbExecuteMock).toHaveBeenCalledTimes(1);
	});

	it("returns results in input-id order — DataLoader contract", async () => {
		dbSelectMock.mockReturnValue(selectChain([]));
		dbExecuteMock.mockResolvedValue({
			rows: [
				{ thread_id: "t-2", status: "succeeded", created_at: new Date() },
				{ thread_id: "t-1", status: "failed", created_at: new Date() },
			],
		});

		const { threadLifecycleStatus } = createThreadLoaders();
		const [r1, r2, r3] = await Promise.all([
			threadLifecycleStatus.load("t-1"),
			threadLifecycleStatus.load("t-2"),
			threadLifecycleStatus.load("t-3"),
		]);

		expect(r1).toBe("FAILED"); // t-1's latest was failed
		expect(r2).toBe("COMPLETED"); // t-2's latest was succeeded
		expect(r3).toBe("IDLE"); // t-3 has no turns
	});

	it("active-turn hit on one thread doesn't leak RUNNING to siblings", async () => {
		// Only t-1 has a fresh active turn.
		dbSelectMock.mockReturnValue(selectChain([{ threadId: "t-1" }]));
		dbExecuteMock.mockResolvedValue({
			rows: [
				{ thread_id: "t-2", status: "succeeded", created_at: new Date() },
				{ thread_id: "t-3", status: "failed", created_at: new Date() },
			],
		});

		const { threadLifecycleStatus } = createThreadLoaders();
		const [r1, r2, r3] = await Promise.all([
			threadLifecycleStatus.load("t-1"),
			threadLifecycleStatus.load("t-2"),
			threadLifecycleStatus.load("t-3"),
		]);

		expect(r1).toBe("RUNNING");
		expect(r2).toBe("COMPLETED");
		expect(r3).toBe("FAILED");
	});

	it("routes stuck-queued (> 5 min) via the latest-row fallback → FAILED", async () => {
		// No active turns — the stuck queued row is older than 5 min.
		dbSelectMock.mockReturnValue(selectChain([]));
		dbExecuteMock.mockResolvedValue({
			rows: [
				{
					thread_id: "t-stuck",
					status: "queued",
					created_at: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
				},
			],
		});

		const { threadLifecycleStatus } = createThreadLoaders();
		expect(await threadLifecycleStatus.load("t-stuck")).toBe("FAILED");
	});

	it("resolves a thread with zero turns as IDLE", async () => {
		dbSelectMock.mockReturnValue(selectChain([]));
		dbExecuteMock.mockResolvedValue({ rows: [] });

		const { threadLifecycleStatus } = createThreadLoaders();
		expect(await threadLifecycleStatus.load("t-empty")).toBe("IDLE");
	});

	it("coerces ISO-string created_at (JSON-decoded from db.execute) back to a Date", async () => {
		// Some raw SQL drivers return created_at as a string. Loader must
		// rehydrate it so deriveLifecycleStatus can compute age.
		const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
		dbSelectMock.mockReturnValue(selectChain([]));
		dbExecuteMock.mockResolvedValue({
			rows: [{ thread_id: "t-iso", status: "queued", created_at: tenMinAgoIso }],
		});

		const { threadLifecycleStatus } = createThreadLoaders();
		expect(await threadLifecycleStatus.load("t-iso")).toBe("FAILED");
	});
});
