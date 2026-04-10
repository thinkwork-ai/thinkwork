/**
 * Unit tests for thread-dispatch utilities (PRD-09).
 *
 * Tests isThreadBlocked and checkConcurrencyLimits using vi.mock for
 * @thinkwork/database-pg, following the same mocking approach as orchestration.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Database mocks (vi.hoisted so they're available when vi.mock factories run) ──

const { mockExecute, mockDb } = vi.hoisted(() => {
	const mockExecute = vi.fn();
	const mockDb = { execute: mockExecute };
	return { mockExecute, mockDb };
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
}));

vi.mock("drizzle-orm", () => ({
	sql: (...args: unknown[]) => args,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { isThreadBlocked, checkConcurrencyLimits } from "../lib/thread-dispatch.js";

// ─── Reset mocks before each test ───────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

// ─── isThreadBlocked ────────────────────────────────────────────────────────

describe("isThreadBlocked", () => {
	it("no dependencies → false", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: false }] });
		expect(await isThreadBlocked("thread-1")).toBe(false);
	});

	it("all blockers done/cancelled → false", async () => {
		// The SQL query checks for blockers NOT in done/cancelled, so if all
		// blockers are done/cancelled the EXISTS returns false.
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: false }] });
		expect(await isThreadBlocked("thread-2")).toBe(false);
	});

	it("one blocker in_progress → true", async () => {
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: true }] });
		expect(await isThreadBlocked("thread-3")).toBe(true);
	});

	it("mixed status blockers (some done, one in_progress) → true", async () => {
		// EXISTS will be true because at least one blocker is not done/cancelled
		mockExecute.mockResolvedValueOnce({ rows: [{ blocked: true }] });
		expect(await isThreadBlocked("thread-4")).toBe(true);
	});
});

// ─── checkConcurrencyLimits ─────────────────────────────────────────────────

describe("checkConcurrencyLimits", () => {
	const tenantId = "tenant-1";
	const agentId = "agent-1";

	it("no config → allowed", async () => {
		// Hive lookup returns no metadata
		mockExecute.mockResolvedValueOnce({ rows: [] });
		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({ allowed: true });
	});

	it("metadata without concurrency key → allowed", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ metadata: { someOtherKey: true } }],
		});
		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({ allowed: true });
	});

	it("under maxPerAgent limit → allowed", async () => {
		// Hive config with maxPerAgent = 3
		mockExecute.mockResolvedValueOnce({
			rows: [{ metadata: { concurrency: { maxPerAgent: 3 } } }],
		});
		// Count query returns 2 (under limit)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 2 }] });
		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({ allowed: true });
	});

	it("at maxPerAgent limit → not allowed", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ metadata: { concurrency: { maxPerAgent: 3 } } }],
		});
		// Count query returns 3 (at limit)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 3 }] });
		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({
			allowed: false,
			reason: "agent_limit_reached (3)",
		});
	});

	it("at maxConcurrentAgents limit → not allowed", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ metadata: { concurrency: { maxConcurrentAgents: 5 } } }],
		});
		// Distinct agent count returns 5 (at limit)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 5 }] });
		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({
			allowed: false,
			reason: "global_agent_limit_reached (5)",
		});
	});

	it("maxByStatus limit reached → not allowed", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{ metadata: { concurrency: { maxByStatus: { in_progress: 10 } } } }],
		});
		// Status count returns 10 (at limit)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 10 }] });
		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({
			allowed: false,
			reason: "status_limit_reached: in_progress (10)",
		});
	});

	it("all three limit types simultaneously — fails on first exceeded", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				metadata: {
					concurrency: {
						maxPerAgent: 5,
						maxConcurrentAgents: 10,
						maxByStatus: { in_progress: 20 },
					},
				},
			}],
		});
		// maxPerAgent check: under limit (3 < 5)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 3 }] });
		// maxConcurrentAgents check: at limit (10 >= 10)
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 10 }] });

		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({
			allowed: false,
			reason: "global_agent_limit_reached (10)",
		});
		// maxByStatus query should not have been called since we short-circuited
		expect(mockExecute).toHaveBeenCalledTimes(3);
	});

	it("all three limit types — all under → allowed", async () => {
		mockExecute.mockResolvedValueOnce({
			rows: [{
				metadata: {
					concurrency: {
						maxPerAgent: 5,
						maxConcurrentAgents: 10,
						maxByStatus: { in_progress: 20, blocked: 15 },
					},
				},
			}],
		});
		// maxPerAgent: under
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 2 }] });
		// maxConcurrentAgents: under
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 7 }] });
		// maxByStatus in_progress: under
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 10 }] });
		// maxByStatus blocked: under
		mockExecute.mockResolvedValueOnce({ rows: [{ count: 5 }] });

		const result = await checkConcurrencyLimits(tenantId, agentId);
		expect(result).toEqual({ allowed: true });
		// 1 hive lookup + 1 maxPerAgent + 1 maxConcurrentAgents + 2 maxByStatus
		expect(mockExecute).toHaveBeenCalledTimes(5);
	});
});
