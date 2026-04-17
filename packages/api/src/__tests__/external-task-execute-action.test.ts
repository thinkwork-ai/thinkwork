/**
 * Integration-style tests for the external-task action executor.
 *
 * Mocks `@thinkwork/database-pg`, the adapter registry, and the OAuth token
 * resolver. Drives the orchestrator through its branches: missing thread,
 * wrong tenant, missing metadata, unknown provider, capability denial,
 * OAuth failure, and the happy path (adapter call → thread metadata update
 * → audit message insert).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks: database-pg drizzle chain ─────────────────────────────────────────

const { mockSelect, mockSelectFrom, mockSelectWhere, mockUpdate, mockUpdateSet, mockUpdateWhere, mockInsert, mockInsertValues, mockInsertReturning, mockDb } = vi.hoisted(() => {
	const mockSelectWhere = vi.fn();
	const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
	const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

	const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
	const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

	const mockInsertReturning = vi.fn();
	const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
	const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

	const mockDb = {
		select: mockSelect,
		update: mockUpdate,
		insert: mockInsert,
	};
	return {
		mockSelect,
		mockSelectFrom,
		mockSelectWhere,
		mockUpdate,
		mockUpdateSet,
		mockUpdateWhere,
		mockInsert,
		mockInsertValues,
		mockInsertReturning,
		mockDb,
	};
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
	schema: {
		threads: { id: "id", tenant_id: "tenant_id", metadata: "metadata" },
		messages: { id: "id", thread_id: "thread_id" },
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
}));

// ── Mocks: adapter registry ──────────────────────────────────────────────────

const { mockExecuteAction, mockHasAdapter, mockGetAdapter } = vi.hoisted(() => {
	const mockExecuteAction = vi.fn();
	const mockHasAdapter = vi.fn((provider: string) => provider === "lastmile");
	const mockGetAdapter = vi.fn(() => ({
		provider: "lastmile",
		executeAction: mockExecuteAction,
	}));
	return { mockExecuteAction, mockHasAdapter, mockGetAdapter };
});

vi.mock("../integrations/external-work-items/index.js", () => ({
	getAdapter: mockGetAdapter,
	hasAdapter: mockHasAdapter,
}));

// ── Mocks: OAuth token resolver ──────────────────────────────────────────────

const { mockResolveOAuthToken, mockResolveLastmileTasksMcpServer } = vi.hoisted(() => {
	const mockResolveOAuthToken = vi.fn();
	const mockResolveLastmileTasksMcpServer = vi.fn();
	return { mockResolveOAuthToken, mockResolveLastmileTasksMcpServer };
});

vi.mock("../lib/oauth-token.js", () => ({
	resolveOAuthToken: mockResolveOAuthToken,
	resolveLastmileTasksMcpServer: mockResolveLastmileTasksMcpServer,
}));

// ── Import AFTER mocks ───────────────────────────────────────────────────────

import { executeExternalTaskAction } from "../integrations/external-work-items/executeAction.js";
import type { ExternalTaskEnvelope } from "../integrations/external-work-items/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT = "tenant-1";
const PRINCIPAL = "user-1";
const THREAD_ID = "thread-1";
const CONNECTION_ID = "conn-1";
const PROVIDER_ID = "prov-1";
const EXT_TASK_ID = "task_abc";

function buildEnvelope(overrides?: Partial<ExternalTaskEnvelope>): ExternalTaskEnvelope {
	return {
		_type: "external_task",
		_source: {
			provider: "lastmile",
			tool: "task_get",
			params: { id: EXT_TASK_ID },
		},
		item: {
			core: {
				id: EXT_TASK_ID,
				provider: "lastmile",
				title: "Deliver groceries",
			},
			capabilities: {
				getTask: true,
				updateStatus: true,
				assignTask: true,
				commentOnTask: true,
				editTaskFields: true,
			},
			fields: [],
			actions: [],
		},
		blocks: [],
		...overrides,
	};
}

function buildThread(overrides?: Record<string, unknown>) {
	return {
		id: THREAD_ID,
		tenant_id: TENANT,
		metadata: {
			external: {
				provider: "lastmile",
				externalTaskId: EXT_TASK_ID,
				connectionId: CONNECTION_ID,
				providerId: PROVIDER_ID,
				latestEnvelope: buildEnvelope(),
			},
		},
		...overrides,
	};
}

// ── Reset state ──────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockHasAdapter.mockImplementation((p: string) => p === "lastmile");
	mockGetAdapter.mockReturnValue({
		provider: "lastmile",
		executeAction: mockExecuteAction,
	} as never);
	mockResolveLastmileTasksMcpServer.mockResolvedValue({
		id: "mcp-server-1",
		url: "https://mcp-test.invalid/tasks",
	});
	mockSelectFrom.mockReturnValue({ where: mockSelectWhere });
	mockSelect.mockReturnValue({ from: mockSelectFrom });
	mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
	mockUpdate.mockReturnValue({ set: mockUpdateSet });
	mockInsertValues.mockReturnValue({ returning: mockInsertReturning });
	mockInsert.mockReturnValue({ values: mockInsertValues });
	mockUpdateWhere.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("executeExternalTaskAction — guard clauses", () => {
	it("throws when the thread does not exist", async () => {
		mockSelectWhere.mockResolvedValueOnce([]);
		await expect(
			executeExternalTaskAction({
				threadId: THREAD_ID,
				actionType: "external_task.update_status",
				params: { value: "done" },
				tenantId: TENANT,
				principalId: PRINCIPAL,
			}),
		).rejects.toThrow(/Thread not found/);
	});

	it("throws when the thread belongs to a different tenant", async () => {
		mockSelectWhere.mockResolvedValueOnce([buildThread({ tenant_id: "other-tenant" })]);
		await expect(
			executeExternalTaskAction({
				threadId: THREAD_ID,
				actionType: "external_task.update_status",
				params: { value: "done" },
				tenantId: TENANT,
				principalId: PRINCIPAL,
			}),
		).rejects.toThrow(/authenticated tenant/);
	});

	it("throws when metadata.external is missing", async () => {
		mockSelectWhere.mockResolvedValueOnce([buildThread({ metadata: {} })]);
		await expect(
			executeExternalTaskAction({
				threadId: THREAD_ID,
				actionType: "external_task.update_status",
				params: { value: "done" },
				tenantId: TENANT,
				principalId: PRINCIPAL,
			}),
		).rejects.toThrow(/no external task linkage/);
	});

	it("throws when no adapter is registered for the thread's provider", async () => {
		mockHasAdapter.mockImplementation((p: string) => p === "asana");
		mockSelectWhere.mockResolvedValueOnce([buildThread()]);
		await expect(
			executeExternalTaskAction({
				threadId: THREAD_ID,
				actionType: "external_task.update_status",
				params: { value: "done" },
				tenantId: TENANT,
				principalId: PRINCIPAL,
			}),
		).rejects.toThrow(/No adapter registered/);
	});

	it("throws when the current task capabilities deny the requested action", async () => {
		const envelope = buildEnvelope();
		envelope.item.capabilities.updateStatus = false;
		const thread = buildThread();
		(thread.metadata.external as Record<string, unknown>).latestEnvelope = envelope;
		mockSelectWhere.mockResolvedValueOnce([thread]);

		await expect(
			executeExternalTaskAction({
				threadId: THREAD_ID,
				actionType: "external_task.update_status",
				params: { value: "done" },
				tenantId: TENANT,
				principalId: PRINCIPAL,
			}),
		).rejects.toThrow(/not permitted/);
	});

	it("throws when OAuth token resolution fails", async () => {
		mockSelectWhere.mockResolvedValueOnce([buildThread()]);
		mockResolveOAuthToken.mockResolvedValueOnce(null);

		await expect(
			executeExternalTaskAction({
				threadId: THREAD_ID,
				actionType: "external_task.update_status",
				params: { value: "done" },
				tenantId: TENANT,
				principalId: PRINCIPAL,
			}),
		).rejects.toThrow(/resolve OAuth token/);
	});
});

describe("executeExternalTaskAction — happy path", () => {
	it("calls the adapter, updates thread metadata, writes audit message, returns envelope", async () => {
		mockSelectWhere.mockResolvedValueOnce([buildThread()]);
		mockResolveOAuthToken.mockResolvedValueOnce("token-fresh");

		const freshEnvelope = buildEnvelope({
			_refreshedAt: "2026-04-14T10:00:00.000Z",
		});
		freshEnvelope.item.core.title = "Deliver groceries (updated)";
		mockExecuteAction.mockResolvedValueOnce(freshEnvelope);
		mockInsertReturning.mockResolvedValueOnce([{ id: "msg-audit-1" }]);

		const result = await executeExternalTaskAction({
			threadId: THREAD_ID,
			actionType: "external_task.update_status",
			params: { value: "in_progress" },
			tenantId: TENANT,
			principalId: PRINCIPAL,
		});

		expect(mockResolveOAuthToken).toHaveBeenCalledWith(CONNECTION_ID, TENANT, PROVIDER_ID);
		expect(mockExecuteAction).toHaveBeenCalledWith({
			actionType: "external_task.update_status",
			externalTaskId: EXT_TASK_ID,
			params: { value: "in_progress" },
			ctx: {
				tenantId: TENANT,
				userId: PRINCIPAL,
				connectionId: CONNECTION_ID,
				authToken: "token-fresh",
				mcpServerUrl: "https://mcp-test.invalid/tasks",
			},
		});

		// Thread metadata update: the `set` arg should carry the new envelope
		// under metadata.external.latestEnvelope.
		expect(mockUpdateSet).toHaveBeenCalled();
		const updateCalls = mockUpdateSet.mock.calls as unknown as Array<Array<{
			metadata: { external: { latestEnvelope: ExternalTaskEnvelope; lastUpdatedAt: string } };
		}>>;
		const updateArg = updateCalls[0][0];
		expect(updateArg.metadata.external.latestEnvelope).toBe(freshEnvelope);
		expect(updateArg.metadata.external.lastUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

		// Audit message insert
		expect(mockInsertValues).toHaveBeenCalled();
		const insertCalls = mockInsertValues.mock.calls as unknown as Array<Array<{
			thread_id: string;
			tenant_id: string;
			role: string;
			content: string;
			metadata: Record<string, unknown>;
		}>>;
		const insertArg = insertCalls[0][0];
		expect(insertArg.thread_id).toBe(THREAD_ID);
		expect(insertArg.tenant_id).toBe(TENANT);
		expect(insertArg.role).toBe("system");
		expect(insertArg.content).toContain("Status changed to in_progress");
		expect(insertArg.metadata).toMatchObject({
			kind: "external_task_action",
			actionType: "external_task.update_status",
			provider: "lastmile",
			externalTaskId: EXT_TASK_ID,
			actor: PRINCIPAL,
		});

		expect(result).toEqual({
			envelope: freshEnvelope,
			threadId: THREAD_ID,
			auditMessageId: "msg-audit-1",
		});
	});

	it("summarizes assign actions with the target user id", async () => {
		mockSelectWhere.mockResolvedValueOnce([buildThread()]);
		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockExecuteAction.mockResolvedValueOnce(buildEnvelope());
		mockInsertReturning.mockResolvedValueOnce([{ id: "audit-2" }]);

		await executeExternalTaskAction({
			threadId: THREAD_ID,
			actionType: "external_task.assign",
			params: { userId: "user_42" },
			tenantId: TENANT,
			principalId: PRINCIPAL,
		});

		const insertCalls2 = mockInsertValues.mock.calls as unknown as Array<Array<{ content: string }>>;
		const insertArg = insertCalls2[0][0];
		expect(insertArg.content).toContain("Assigned");
		expect(insertArg.content).toContain("user_42");
	});

	it("returns auditMessageId null when the insert returns nothing", async () => {
		mockSelectWhere.mockResolvedValueOnce([buildThread()]);
		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockExecuteAction.mockResolvedValueOnce(buildEnvelope());
		mockInsertReturning.mockResolvedValueOnce([]);

		const result = await executeExternalTaskAction({
			threadId: THREAD_ID,
			actionType: "external_task.comment",
			params: { body: "hi" },
			tenantId: TENANT,
			principalId: PRINCIPAL,
		});
		expect(result.auditMessageId).toBeNull();
	});
});
