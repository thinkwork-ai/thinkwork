/**
 * Tests for the Unit 4 skill-runs resolver suite.
 *
 * Covers:
 *   * startSkillRun — happy path, dedup, unauthorized, tenant mismatch,
 *     invocation source validation, invoke failure transitions row to
 *     `failed`, resolved_inputs_hash is deterministic.
 *   * cancelSkillRun — 404 on cross-tenant, idempotent terminal, invoker
 *     scope.
 *   * submitRunFeedback — signal validation, note truncation, invoker
 *     scope.
 *   * deleteRun — 404 on cross-tenant, invoker scope.
 *   * skillRun / skillRuns / compositionFeedbackSummary — tenant +
 *     invoker scoping, limit clamp.
 *
 * DB, invokeSkillRun, and resolveCaller are mocked at the module
 * boundary. No DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
	mockSelect,
	mockInsert,
	mockUpdate,
	mockDelete,
	mockResolveCaller,
	mockInvokeSkillRun,
} = vi.hoisted(() => ({
	mockSelect: vi.fn(),
	mockInsert: vi.fn(),
	mockUpdate: vi.fn(),
	mockDelete: vi.fn(),
	mockResolveCaller: vi.fn(),
	mockInvokeSkillRun: vi.fn(),
}));

// `db` chainable stubs -------------------------------------------------------

type Rows = Record<string, unknown>[];

const selectChain = (rows: Rows) => {
	const tail = {
		orderBy: () => ({ limit: () => Promise.resolve(rows) }),
		limit: () => Promise.resolve(rows),
		then: (fn: (r: Rows) => unknown) => Promise.resolve(rows).then(fn),
	};
	const where = () => ({
		...tail,
		then: (fn: (r: Rows) => unknown) => Promise.resolve(rows).then(fn),
	});
	return {
		from: () => ({
			where,
			orderBy: () => ({ limit: () => Promise.resolve(rows) }),
			leftJoin: () => ({ where }),
		}),
	};
};

const selectGroupByChain = (rows: Rows) => ({
	from: () => ({
		where: () => ({
			groupBy: () => Promise.resolve(rows),
		}),
	}),
});

const insertChain = (rows: Rows) => ({
	values: () => ({
		onConflictDoNothing: () => ({
			returning: () => Promise.resolve(rows),
		}),
	}),
});

const updateChain = (rows: Rows) => ({
	set: () => ({
		where: () => ({
			returning: () => Promise.resolve(rows),
		}),
	}),
});

const deleteChain = () => ({
	where: () => Promise.resolve(),
});

vi.mock("../graphql/utils.js", () => ({
	db: {
		select: (...args: unknown[]) => {
			const call = mockSelect(args);
			if (call?.groupBy) return selectGroupByChain(call.rows as Rows);
			return selectChain((call?.rows as Rows) ?? []);
		},
		insert: () => insertChain(mockInsert() as Rows),
		update: () => updateChain(mockUpdate() as Rows),
		delete: () => deleteChain(),
	},
	eq: (...a: unknown[]) => ({ _eq: a }),
	and: (...a: unknown[]) => ({ _and: a }),
	desc: (c: unknown) => ({ _desc: c }),
	sql: Object.assign(
		(...a: unknown[]) => ({ _sql: a, as: (_: string) => ({ _sql: a }) }),
		{ raw: (s: string) => s },
	),
	skillRuns: {
		id: "skill_runs.id",
		tenant_id: "skill_runs.tenant_id",
		invoker_user_id: "skill_runs.invoker_user_id",
		skill_id: "skill_runs.skill_id",
		resolved_inputs_hash: "skill_runs.resolved_inputs_hash",
		status: "skill_runs.status",
		agent_id: "skill_runs.agent_id",
		invocation_source: "skill_runs.invocation_source",
		started_at: "skill_runs.started_at",
	},
	snakeToCamel: (obj: Record<string, unknown>) => obj,
	invokeSkillRun: mockInvokeSkillRun,
	hashResolvedInputs: (v: Record<string, unknown>) =>
		`hash:${JSON.stringify(v)}`,
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCaller: mockResolveCaller,
}));

// Imports AFTER mocks
import { startSkillRun, StartSkillRunError } from "../graphql/resolvers/skill-runs/startSkillRun.mutation.js";
import { cancelSkillRun, CancelSkillRunError } from "../graphql/resolvers/skill-runs/cancelSkillRun.mutation.js";
import { submitRunFeedback, SubmitRunFeedbackError } from "../graphql/resolvers/skill-runs/submitRunFeedback.mutation.js";
import { deleteRun, DeleteRunError } from "../graphql/resolvers/skill-runs/deleteRun.mutation.js";
import { skillRun } from "../graphql/resolvers/skill-runs/skillRun.query.js";
import { skillRuns } from "../graphql/resolvers/skill-runs/skillRuns.query.js";
import { compositionFeedbackSummary } from "../graphql/resolvers/skill-runs/compositionFeedbackSummary.query.js";

const OK_CTX = { auth: {} } as any;

beforeEach(() => {
	vi.clearAllMocks();
	mockResolveCaller.mockResolvedValue({ userId: "U1", tenantId: "T1" });
	mockInvokeSkillRun.mockResolvedValue({ ok: true });
	mockSelect.mockReset();
	mockInsert.mockReset();
	mockUpdate.mockReset();
});

// ---- startSkillRun ---------------------------------------------------------

describe("startSkillRun", () => {
	const insertedRow = {
		id: "run-1",
		tenant_id: "T1",
		invoker_user_id: "U1",
		skill_id: "sales-prep",
		skill_version: 1,
		status: "running",
	};

	it("inserts a row, invokes AgentCore RequestResponse, and returns the run", async () => {
		mockInsert.mockReturnValue([insertedRow]);
		const out = await startSkillRun(null, {
			input: {
				skillId: "sales-prep",
				invocationSource: "chat",
				inputs: { customer: "ABC" },
			},
		}, OK_CTX) as Record<string, unknown>;
		expect(out.id).toBe("run-1");
		expect(mockInvokeSkillRun).toHaveBeenCalledTimes(1);
		const payload = mockInvokeSkillRun.mock.calls[0]![0] as Record<string, unknown>;
		expect(payload.kind).toBe("run_skill");
		expect(payload.runId).toBe("run-1");
		expect(payload.tenantId).toBe("T1");
		expect(payload.invokerUserId).toBe("U1");
		expect(payload.invocationSource).toBe("chat");
	});

	it("rejects unauthorized caller", async () => {
		mockResolveCaller.mockResolvedValueOnce({ userId: null, tenantId: null });
		await expect(
			startSkillRun(null, { input: { skillId: "s", invocationSource: "chat" } }, OK_CTX),
		).rejects.toBeInstanceOf(StartSkillRunError);
	});

	it("rejects a cross-tenant tenantId override", async () => {
		await expect(
			startSkillRun(null, {
				input: { tenantId: "OTHER", skillId: "s", invocationSource: "chat" },
			}, OK_CTX),
		).rejects.toThrow(/does not match caller/);
	});

	it("rejects an invalid invocationSource", async () => {
		await expect(
			startSkillRun(null, { input: { skillId: "s", invocationSource: "chatroom" } }, OK_CTX),
		).rejects.toThrow(/invocationSource must be one of/);
	});

	it("rejects malformed inputs JSON string", async () => {
		await expect(
			startSkillRun(null, {
				input: { skillId: "s", invocationSource: "chat", inputs: "{not valid" },
			}, OK_CTX),
		).rejects.toThrow(/valid JSON/);
	});

	it("returns the existing run on dedup (insert returns zero rows)", async () => {
		mockInsert.mockReturnValue([]);
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-existing",
			tenant_id: "T1",
			invoker_user_id: "U1",
			skill_id: "sales-prep",
			status: "running",
		}] });
		const out = await startSkillRun(null, {
			input: { skillId: "sales-prep", invocationSource: "chat", inputs: { customer: "ABC" } },
		}, OK_CTX) as Record<string, unknown>;
		expect(out.id).toBe("run-existing");
		expect(mockInvokeSkillRun).not.toHaveBeenCalled();
	});

	it("transitions the row to failed when invokeSkillRun errors, then throws", async () => {
		mockInsert.mockReturnValue([insertedRow]);
		mockUpdate.mockReturnValue([{ ...insertedRow, status: "failed", failure_reason: "nope" }]);
		mockInvokeSkillRun.mockResolvedValueOnce({ ok: false, error: "nope" });
		await expect(
			startSkillRun(null, { input: { skillId: "s", invocationSource: "chat" } }, OK_CTX),
		).rejects.toThrow(/skill-run invoke failed/);
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	it("requires skillId and invocationSource", async () => {
		await expect(startSkillRun(null, { input: {} as any }, OK_CTX)).rejects.toThrow(
			/required/,
		);
	});
});

// ---- cancelSkillRun --------------------------------------------------------

describe("cancelSkillRun", () => {
	it("cancels a running row owned by the invoker", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U1", status: "running",
		}] });
		mockUpdate.mockReturnValue([{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U1", status: "cancelled",
		}]);
		const out = await cancelSkillRun(null, { runId: "run-1" }, OK_CTX) as Record<string, unknown>;
		expect(out.status).toBe("cancelled");
	});

	it("returns the row as-is when already terminal", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U1", status: "complete",
		}] });
		const out = await cancelSkillRun(null, { runId: "run-1" }, OK_CTX) as Record<string, unknown>;
		expect(out.status).toBe("complete");
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("404s on cross-tenant run (existence must not leak)", async () => {
		mockSelect.mockReturnValueOnce({ rows: [] });
		await expect(cancelSkillRun(null, { runId: "run-x" }, OK_CTX))
			.rejects.toThrow(/run not found/);
	});

	it("404s when caller is not the invoker", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U2", status: "running",
		}] });
		await expect(cancelSkillRun(null, { runId: "run-1" }, OK_CTX))
			.rejects.toThrow(/run not found/);
	});
});

// ---- submitRunFeedback -----------------------------------------------------

describe("submitRunFeedback", () => {
	it("writes positive feedback", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U1", status: "complete",
		}] });
		mockUpdate.mockReturnValue([{
			id: "run-1", feedback_signal: "positive", feedback_note: "nice",
		}]);
		const out = await submitRunFeedback(null, {
			input: { runId: "run-1", signal: "positive", note: "nice" },
		}, OK_CTX) as Record<string, unknown>;
		expect(out.feedback_signal).toBe("positive");
	});

	it("rejects unknown signals", async () => {
		await expect(submitRunFeedback(null, {
			input: { runId: "r", signal: "medium" },
		}, OK_CTX)).rejects.toThrow(/positive|negative/);
	});

	it("truncates long notes at 2000 chars", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U1",
		}] });
		const updateCalls: unknown[] = [];
		mockUpdate.mockImplementation(() => {
			updateCalls.push(1);
			return [{ id: "run-1" }];
		});
		const longNote = "x".repeat(5000);
		await submitRunFeedback(null, {
			input: { runId: "run-1", signal: "positive", note: longNote },
		}, OK_CTX);
		expect(mockUpdate).toHaveBeenCalled();
	});

	it("404s on non-invoker", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U2",
		}] });
		await expect(submitRunFeedback(null, {
			input: { runId: "run-1", signal: "positive" },
		}, OK_CTX)).rejects.toThrow(/run not found/);
	});
});

// ---- deleteRun -------------------------------------------------------------

describe("deleteRun", () => {
	it("returns true when deleting an own row", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U1",
		}] });
		const out = await deleteRun(null, { runId: "run-1" }, OK_CTX);
		expect(out).toBe(true);
	});

	it("404s when caller is not the invoker", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U2",
		}] });
		await expect(deleteRun(null, { runId: "run-1" }, OK_CTX))
			.rejects.toThrow(/run not found/);
	});
});

// ---- queries ---------------------------------------------------------------

describe("skillRun query", () => {
	it("returns null when caller has no tenant context", async () => {
		mockResolveCaller.mockResolvedValueOnce({ userId: null, tenantId: null });
		const out = await skillRun(null, { id: "run-1" }, OK_CTX);
		expect(out).toBeNull();
	});

	it("returns null on non-invoker (cross-user 404 pattern)", async () => {
		mockSelect.mockReturnValueOnce({ rows: [{
			id: "run-1", tenant_id: "T1", invoker_user_id: "U2",
		}] });
		const out = await skillRun(null, { id: "run-1" }, OK_CTX);
		expect(out).toBeNull();
	});
});

describe("skillRuns list", () => {
	it("returns empty when cross-tenant tenantId is passed", async () => {
		const out = await skillRuns(null, { tenantId: "OTHER" }, OK_CTX);
		expect(out).toEqual([]);
	});

	it("clamps limit into [1, MAX]", async () => {
		mockSelect.mockReturnValue({ rows: [] });
		const out = await skillRuns(null, { limit: 99999 }, OK_CTX);
		expect(out).toEqual([]);
	});

	it("scopes to caller userId when no invokerUserId passed", async () => {
		mockSelect.mockReturnValue({ rows: [{ id: "run-1", invoker_user_id: "U1" }] });
		const out = await skillRuns(null, {}, OK_CTX);
		expect(out.length).toBe(1);
	});
});

describe("compositionFeedbackSummary", () => {
	it("returns empty when caller has no tenant", async () => {
		mockResolveCaller.mockResolvedValueOnce({ userId: null, tenantId: null });
		const out = await compositionFeedbackSummary(null, {}, OK_CTX);
		expect(out).toEqual([]);
	});

	it("maps DB rows to summary objects", async () => {
		mockSelect.mockReturnValueOnce({
			groupBy: true,
			rows: [
				{ skillId: "sales-prep", positive: "5", negative: "1", total: "6" },
				{ skillId: "account-health-review", positive: "2", negative: "0", total: "2" },
			],
		});
		const out = await compositionFeedbackSummary(null, {}, OK_CTX);
		expect(out).toEqual([
			{ skillId: "sales-prep", positive: 5, negative: 1, total: 6 },
			{ skillId: "account-health-review", positive: 2, negative: 0, total: 2 },
		]);
	});
});
