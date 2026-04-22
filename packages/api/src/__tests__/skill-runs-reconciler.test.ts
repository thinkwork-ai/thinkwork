/**
 * Tests for skill-runs-reconciler Lambda.
 *
 * Verifies the handler:
 *   * emits a status='failed' update keyed on status='running' AND
 *     started_at older than the 15-minute window,
 *   * logs one structured line per reconciled row + a summary line,
 *   * returns the count of reconciled rows.
 *
 * Mocks the DB at the @thinkwork/database-pg boundary so the test
 * doesn't need a live Postgres — the where-clause shape assertions
 * cover the partial-index semantics.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReturning, mockUpdate, mockWhere, mockSet, capturedWhere } = vi.hoisted(() => ({
	mockReturning: vi.fn(),
	mockUpdate: vi.fn(),
	mockWhere: vi.fn(),
	mockSet: vi.fn(),
	capturedWhere: { value: undefined as unknown },
}));

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => ({
		update: () => {
			mockUpdate();
			return {
				set: (payload: Record<string, unknown>) => {
					mockSet(payload);
					return {
						where: (pred: unknown) => {
							mockWhere(pred);
							capturedWhere.value = pred;
							return {
								returning: () => Promise.resolve(mockReturning() ?? []),
							};
						},
					};
				},
			};
		},
	}),
	schema: {
		skillRuns: {
			id: "skill_runs.id",
			tenant_id: "skill_runs.tenant_id",
			skill_id: "skill_runs.skill_id",
			status: "skill_runs.status",
			started_at: "skill_runs.started_at",
		},
	},
}));

vi.mock("drizzle-orm", () => ({
	and: (...a: unknown[]) => ({ _and: a }),
	eq: (col: unknown, val: unknown) => ({ _eq: [col, val] }),
	lt: (col: unknown, val: unknown) => ({ _lt: [col, val] }),
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		_sql: { strings: Array.from(strings), values },
	}),
}));

import { handler } from "../handlers/skill-runs-reconciler.js";

beforeEach(() => {
	vi.resetAllMocks();
	capturedWhere.value = undefined;
});

describe("skill-runs-reconciler", () => {
	it("updates stuck rows and returns the count", async () => {
		mockReturning.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", skill_id: "sales-prep", started_at: new Date(Date.now() - 20 * 60_000) },
			{ id: "R2", tenant_id: "T2", skill_id: "renewal-prep", started_at: new Date(Date.now() - 30 * 60_000) },
		]);

		const result = await handler();

		expect(result.reconciled).toBe(2);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockSet).toHaveBeenCalledTimes(1);
		const setArg = mockSet.mock.calls[0][0] as Record<string, unknown>;
		expect(setArg.status).toBe("failed");
		expect(setArg.failure_reason).toContain("reconciler:");
		expect(setArg.failure_reason).toContain("15 min");
		expect(setArg.finished_at).toBeInstanceOf(Date);
	});

	it("returns zero when no rows are stale", async () => {
		mockReturning.mockReturnValueOnce([]);
		const result = await handler();
		expect(result.reconciled).toBe(0);
	});

	it("scopes the update to status='running' rows started before the 15-minute boundary", async () => {
		mockReturning.mockReturnValueOnce([]);
		await handler();

		// The and() wrapper nests an eq() on status and a lt() on started_at.
		const whereArg = capturedWhere.value as { _and: unknown[] } | undefined;
		expect(whereArg).toBeDefined();
		const [statusClause, agedClause] = (whereArg!._and as Array<{ _eq?: unknown[]; _lt?: unknown[] }>);
		expect(statusClause._eq?.[1]).toBe("running");
		expect(agedClause._lt?.[0]).toBe("skill_runs.started_at");
		const sqlLike = agedClause._lt?.[1] as { _sql?: { values: unknown[] } } | undefined;
		expect(sqlLike?._sql?.values?.[0]).toBe(15);
	});

	it("logs one line per reconciled row and a summary line", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		mockReturning.mockReturnValueOnce([
			{ id: "R1", tenant_id: "T1", skill_id: "sales-prep", started_at: new Date(Date.now() - 20 * 60_000) },
		]);

		await handler();

		const messages = logSpy.mock.calls.map((call) => String(call[0]));
		expect(messages.some((m) => m.includes("row_reconciled") && m.includes("run_id=R1"))).toBe(true);
		expect(messages.some((m) => m.includes("reconciled=1") && m.includes("stale_after_min=15"))).toBe(true);
		logSpy.mockRestore();
	});
});
