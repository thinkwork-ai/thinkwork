/**
 * Unit tests for `ensureExternalTaskThread` denormalization + assignee +
 * agent_id wiring. Mocks the drizzle chain (select/update) and
 * `ensureThreadForWork` from database-pg.
 *
 * Covers Phase A behavior:
 * - Create branch sets assignee_type=user / assignee_id when userId provided
 * - Create branch sets agent_id from per-user opt-in (defaultAgentId)
 * - Create + reuse branches denormalize status/priority/due_at/description
 *   from `envelope.item.core` (with LastMile→thread enum mapping)
 * - Reuse branch self-heals assignee but does NOT touch agent_id
 * - Invalid status values are dropped (default thread.status preserved)
 * - LastMile "normal" priority maps to thread "medium"
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalTaskEnvelope } from "../integrations/external-work-items/types.js";

// ── DB chain ─────────────────────────────────────────────────────────────────

const {
	mockSelectLimit,
	mockSelectWhere,
	mockSelectFrom,
	mockSelect,
	mockUpdateWhere,
	mockUpdateSet,
	mockUpdate,
	mockEnsureThreadForWork,
	mockDb,
} = vi.hoisted(() => {
	const mockSelectLimit = vi.fn();
	const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
	const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
	const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

	const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
	const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

	const mockEnsureThreadForWork = vi.fn();
	const mockDb = { select: mockSelect, update: mockUpdate };

	return {
		mockSelectLimit,
		mockSelectWhere,
		mockSelectFrom,
		mockSelect,
		mockUpdateWhere,
		mockUpdateSet,
		mockUpdate,
		mockEnsureThreadForWork,
		mockDb,
	};
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
	schema: {
		threads: {
			id: "id",
			tenant_id: "tenant_id",
			metadata: "metadata",
		},
	},
	ensureThreadForWork: mockEnsureThreadForWork,
}));

vi.mock("drizzle-orm", () => ({
	and: (...args: unknown[]) => args,
	eq: (...args: unknown[]) => args,
	sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
		strings,
		values,
	}),
}));

// ── Import AFTER mocks ───────────────────────────────────────────────────────

import { ensureExternalTaskThread } from "../integrations/external-work-items/ensureExternalTaskThread.js";

// Helper to extract the latest `update().set(...)` payload with a sane type.
function lastSetArg(): Record<string, unknown> {
	const calls = mockUpdateSet.mock.calls as unknown as Array<[Record<string, unknown>]>;
	if (calls.length === 0) throw new Error("update().set() was never called");
	return calls[calls.length - 1][0];
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function buildEnvelope(
	core?: Partial<ExternalTaskEnvelope["item"]["core"]>,
): ExternalTaskEnvelope {
	return {
		_type: "external_task",
		item: {
			core: {
				id: "task_1",
				provider: "lastmile",
				title: "Deliver groceries",
				description: "Bring eggs and bread",
				dueAt: "2026-04-20T15:00:00Z",
				status: { value: "in_progress", label: "In progress" },
				priority: { value: "normal", label: "Normal" },
				...core,
			},
			capabilities: {},
			fields: [],
			actions: [],
		},
		blocks: [],
	};
}

const BASE_ARGS = {
	tenantId: "tenant-1",
	provider: "lastmile" as const,
	externalTaskId: "task_1",
	connectionId: "conn-1",
	providerId: "prov-1",
	providerUserId: "lm-user-1",
	userId: "user-1",
	title: "Deliver groceries",
};

beforeEach(() => {
	vi.clearAllMocks();
	mockSelectLimit.mockResolvedValue([]);
	mockEnsureThreadForWork.mockResolvedValue({
		threadId: "thread-new",
		identifier: "TASK-1",
		number: 1,
	});
	mockUpdateWhere.mockResolvedValue(undefined);
});

// ── Create branch ────────────────────────────────────────────────────────────

describe("ensureExternalTaskThread — create branch", () => {
	it("writes assignee_type=user, assignee_id, agent_id, and denormalized fields", async () => {
		const envelope = buildEnvelope();
		const result = await ensureExternalTaskThread({
			...BASE_ARGS,
			defaultAgentId: "agent-research-bot",
			envelope,
		});

		expect(result).toEqual({ threadId: "thread-new", created: true });
		expect(mockEnsureThreadForWork).toHaveBeenCalledWith({
			tenantId: "tenant-1",
			userId: "user-1",
			title: "Deliver groceries",
			channel: "task",
		});

		expect(mockUpdateSet).toHaveBeenCalledTimes(1);
		const setArg = lastSetArg();
		expect(setArg.assignee_type).toBe("user");
		expect(setArg.assignee_id).toBe("user-1");
		expect(setArg.agent_id).toBe("agent-research-bot");
		expect(setArg.description).toBe("Bring eggs and bread");
		expect(setArg.due_at).toEqual(new Date("2026-04-20T15:00:00Z"));
		expect(setArg.status).toBe("in_progress");
		expect(setArg.priority).toBe("medium");
		expect(setArg.metadata).toMatchObject({
			external: {
				provider: "lastmile",
				externalTaskId: "task_1",
				connectionId: "conn-1",
				providerId: "prov-1",
				providerUserId: "lm-user-1",
				latestEnvelope: envelope,
			},
		});
	});

	it("omits agent_id when no defaultAgentId is provided", async () => {
		await ensureExternalTaskThread({ ...BASE_ARGS, envelope: buildEnvelope() });
		const setArg = lastSetArg();
		expect(setArg).not.toHaveProperty("agent_id");
		expect(setArg.assignee_type).toBe("user");
	});

	it("omits assignee fields when no userId is provided", async () => {
		await ensureExternalTaskThread({
			...BASE_ARGS,
			userId: undefined,
			envelope: buildEnvelope(),
		});
		const setArg = lastSetArg();
		expect(setArg).not.toHaveProperty("assignee_type");
		expect(setArg).not.toHaveProperty("assignee_id");
	});

	it("does not denormalize fields when envelope is missing", async () => {
		await ensureExternalTaskThread({ ...BASE_ARGS, envelope: undefined });
		const setArg = lastSetArg();
		expect(setArg).not.toHaveProperty("description");
		expect(setArg).not.toHaveProperty("due_at");
		expect(setArg).not.toHaveProperty("status");
		expect(setArg).not.toHaveProperty("priority");
	});

	it("drops invalid status values rather than writing garbage", async () => {
		await ensureExternalTaskThread({
			...BASE_ARGS,
			envelope: buildEnvelope({
				status: { value: "wat", label: "Wat" },
				priority: { value: "high", label: "High" },
			}),
		});
		const setArg = lastSetArg();
		expect(setArg).not.toHaveProperty("status");
		expect(setArg.priority).toBe("high");
	});

	it("maps every LastMile status value 1:1 with the thread enum", async () => {
		const cases: Array<[string, string]> = [
			["todo", "todo"],
			["in_progress", "in_progress"],
			["blocked", "blocked"],
			["done", "done"],
			["cancelled", "cancelled"],
		];
		for (const [lm, thread] of cases) {
			mockUpdateSet.mockClear();
			mockSelectLimit.mockResolvedValueOnce([]);
			await ensureExternalTaskThread({
				...BASE_ARGS,
				envelope: buildEnvelope({ status: { value: lm, label: lm } }),
			});
			const setArg = lastSetArg();
			expect(setArg.status).toBe(thread);
		}
	});
});

// ── Reuse branch ─────────────────────────────────────────────────────────────

describe("ensureExternalTaskThread — reuse branch", () => {
	it("self-heals assignee + denormalized fields but does not touch agent_id", async () => {
		mockSelectLimit.mockResolvedValueOnce([
			{ id: "thread-existing", metadata: { external: {} } },
		]);

		const result = await ensureExternalTaskThread({
			...BASE_ARGS,
			defaultAgentId: "agent-should-be-ignored",
			envelope: buildEnvelope({
				status: { value: "done", label: "Done" },
				priority: { value: "urgent", label: "Urgent" },
			}),
		});

		expect(result).toEqual({ threadId: "thread-existing", created: false });
		// ensureThreadForWork is the create-only path; reuse must not call it.
		expect(mockEnsureThreadForWork).not.toHaveBeenCalled();

		const setArg = lastSetArg();
		expect(setArg.title).toBe("Deliver groceries");
		expect(setArg.assignee_type).toBe("user");
		expect(setArg.assignee_id).toBe("user-1");
		expect(setArg).not.toHaveProperty("agent_id");
		expect(setArg.status).toBe("done");
		expect(setArg.priority).toBe("urgent");
		expect(setArg.description).toBe("Bring eggs and bread");
	});
});
