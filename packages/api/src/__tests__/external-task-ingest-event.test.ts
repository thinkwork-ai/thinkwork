/**
 * Integration-style tests for the adapter-neutral ingest pipeline.
 *
 * Mocks the adapter registry, OAuth resolver, ensureExternalTaskThread, and
 * the drizzle chain for the handoff message insert. Drives the pipeline
 * through each branch: unknown provider, bad signature, missing user id,
 * unresolved connection, happy path (created + reused thread), refresh
 * failure (pipeline still completes), and reassignment handoff.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── DB: insert is used for both the closed-thread handoff message (bare
//        `.values(...)` call) and the PR A/B activity message
//        (`.values(...).returning({ id })`). The mock chain supports both
//        shapes: it returns a thenable that also exposes `.returning()`.
// ─────────────────────────────────────────────────────────────────────────────

const { mockInsertValues, mockInsertReturning, mockInsert, mockDb } = vi.hoisted(() => {
	const mockInsertReturning = vi.fn().mockResolvedValue([{ id: "mock-msg-id" }]);
	// Typed parameter so TS infers `mock.calls` as `[unknown][]` and lets
	// tests read the insert payload via `mock.calls[0][0]`. Without this,
	// `vi.fn(() => ...)` infers a zero-arg factory and `calls` ends up as
	// `never[][]`, which breaks TS2493 on tuple indexing.
	const mockInsertValues = vi.fn((_values: unknown) => ({
		returning: mockInsertReturning,
		then: (resolve: (value: undefined) => unknown, reject?: (reason: unknown) => unknown) =>
			Promise.resolve(undefined).then(resolve, reject),
	}));
	const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
	const mockDb = { insert: mockInsert };
	return { mockInsertValues, mockInsertReturning, mockInsert, mockDb };
});

vi.mock("@thinkwork/database-pg", () => ({
	getDb: () => mockDb,
	schema: { messages: { id: "id" } },
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
}));

// ── Adapter registry ─────────────────────────────────────────────────────────

const {
	mockVerifySignature,
	mockNormalizeEvent,
	mockRefresh,
	mockNormalizeItem,
	mockBuildBlocks,
	mockBuildFormSchema,
	mockHasAdapter,
	mockGetAdapter,
} = vi.hoisted(() => {
	const mockVerifySignature = vi.fn();
	const mockNormalizeEvent = vi.fn();
	const mockRefresh = vi.fn();
	const mockNormalizeItem = vi.fn();
	const mockBuildBlocks = vi.fn(() => []);
	const mockBuildFormSchema = vi.fn(() => ({
		id: "form_edit",
		title: "Edit",
		submitLabel: "Save",
		actionType: "external_task.edit_fields",
		fields: [],
	}));
	const mockHasAdapter = vi.fn((p: string) => p === "lastmile");
	const mockGetAdapter = vi.fn(() => ({
		provider: "lastmile",
		verifySignature: mockVerifySignature,
		normalizeEvent: mockNormalizeEvent,
		refresh: mockRefresh,
		normalizeItem: mockNormalizeItem,
		buildBlocks: mockBuildBlocks,
		buildFormSchema: mockBuildFormSchema,
	}));
	return {
		mockVerifySignature,
		mockNormalizeEvent,
		mockRefresh,
		mockNormalizeItem,
		mockBuildBlocks,
		mockBuildFormSchema,
		mockHasAdapter,
		mockGetAdapter,
	};
});

vi.mock("../integrations/external-work-items/index.js", () => ({
	getAdapter: mockGetAdapter,
	hasAdapter: mockHasAdapter,
}));

// ── OAuth + connection resolver ──────────────────────────────────────────────

const { mockResolveConnection, mockResolveOAuthToken } = vi.hoisted(() => {
	const mockResolveConnection = vi.fn();
	const mockResolveOAuthToken = vi.fn();
	return { mockResolveConnection, mockResolveOAuthToken };
});

vi.mock("../lib/oauth-token.js", () => ({
	resolveConnectionByProviderUserId: mockResolveConnection,
	resolveOAuthToken: mockResolveOAuthToken,
}));

// ── ensureExternalTaskThread + closeExternalTaskThread ───────────────────────

const { mockEnsureThread, mockCloseThread } = vi.hoisted(() => {
	const mockEnsureThread = vi.fn();
	const mockCloseThread = vi.fn();
	return { mockEnsureThread, mockCloseThread };
});

vi.mock("../integrations/external-work-items/ensureExternalTaskThread.js", () => ({
	ensureExternalTaskThread: mockEnsureThread,
	closeExternalTaskThread: mockCloseThread,
}));

// ── Import AFTER mocks ───────────────────────────────────────────────────────

import { ingestExternalTaskEvent } from "../integrations/external-work-items/ingestEvent.js";
import type { ExternalTaskEnvelope } from "../integrations/external-work-items/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RAW_BODY = JSON.stringify({ event: "assigned", data: { task: { id: "task_1" } } });
const HEADERS = { "x-lastmile-signature": "deadbeef" };

function buildConn(
	overrides?: Partial<{
		connectionId: string;
		tenantId: string;
		userId: string;
		providerId: string;
		defaultAgentId: string;
	}>,
) {
	return {
		connectionId: "conn-1",
		tenantId: "tenant-1",
		userId: "user-1",
		providerId: "prov-1",
		...overrides,
	};
}

function buildEnvelope(title = "Task title"): ExternalTaskEnvelope {
	return {
		_type: "external_task",
		item: {
			core: { id: "task_1", provider: "lastmile", title },
			capabilities: {},
			fields: [],
			actions: [],
		},
		blocks: [],
	};
}

// ── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	mockHasAdapter.mockImplementation((p: string) => p === "lastmile");
	mockGetAdapter.mockReturnValue({
		provider: "lastmile",
		verifySignature: mockVerifySignature,
		normalizeEvent: mockNormalizeEvent,
		refresh: mockRefresh,
		normalizeItem: mockNormalizeItem,
		buildBlocks: mockBuildBlocks,
		buildFormSchema: mockBuildFormSchema,
	} as never);
	mockBuildBlocks.mockReturnValue([]);
	mockInsert.mockReturnValue({ values: mockInsertValues });
	mockInsertReturning.mockResolvedValue([{ id: "mock-msg-id" }]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ingestExternalTaskEvent — guard branches", () => {
	it("returns ignored for an unknown provider", async () => {
		mockHasAdapter.mockReturnValueOnce(false);
		const result = await ingestExternalTaskEvent({
			provider: "asana",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});
		expect(result).toEqual({
			status: "ignored",
			reason: "unknown provider: asana",
		});
		expect(mockVerifySignature).not.toHaveBeenCalled();
	});

	it("returns unverified when the adapter rejects the signature", async () => {
		mockVerifySignature.mockResolvedValueOnce(false);
		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});
		expect(result).toEqual({ status: "unverified" });
		expect(mockNormalizeEvent).not.toHaveBeenCalled();
	});

	it("returns unresolved_connection when the event has no providerUserId", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		const normalized = {
			kind: "task.updated" as const,
			externalTaskId: "task_1",
			receivedAt: "2026-04-14T10:00:00Z",
		};
		mockNormalizeEvent.mockResolvedValueOnce(normalized);
		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});
		expect(result).toEqual({ status: "unresolved_connection", event: normalized });
		expect(mockResolveConnection).not.toHaveBeenCalled();
	});

	it("returns unresolved_connection when no active connection matches the provider user id", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		const normalized = {
			kind: "task.updated" as const,
			externalTaskId: "task_1",
			providerUserId: "user_lastmile_99",
			receivedAt: "2026-04-14T10:00:00Z",
		};
		mockNormalizeEvent.mockResolvedValueOnce(normalized);
		mockResolveConnection.mockResolvedValueOnce(null);
		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});
		expect(result).toEqual({
			status: "unresolved_connection",
			providerUserId: "user_lastmile_99",
			event: normalized,
		});
		expect(mockEnsureThread).not.toHaveBeenCalled();
	});
});

describe("ingestExternalTaskEvent — happy path", () => {
	it("refreshes the envelope, ensures the thread, and returns ok", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		mockNormalizeEvent.mockResolvedValueOnce({
			kind: "task.assigned",
			externalTaskId: "task_1",
			providerUserId: "user_lastmile_1",
			receivedAt: "2026-04-14T10:00:00Z",
		});
		mockResolveConnection.mockResolvedValueOnce(buildConn());
		mockResolveOAuthToken.mockResolvedValueOnce("access-token-xyz");
		const envelope = buildEnvelope("Deliver groceries");
		mockRefresh.mockResolvedValueOnce(envelope);
		mockEnsureThread.mockResolvedValueOnce({ threadId: "thread-new", created: true });

		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.threadId).toBe("thread-new");
		expect(result.created).toBe(true);
		expect(result.envelope).toBe(envelope);

		expect(mockRefresh).toHaveBeenCalledWith({
			externalTaskId: "task_1",
			ctx: {
				tenantId: "tenant-1",
				userId: "user-1",
				connectionId: "conn-1",
				authToken: "access-token-xyz",
			},
		});
		expect(mockEnsureThread).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: "tenant-1",
				provider: "lastmile",
				externalTaskId: "task_1",
				connectionId: "conn-1",
				userId: "user-1",
				title: "Deliver groceries",
				envelope,
			}),
		);
		// Without an opt-in, defaultAgentId is undefined.
		const ensureCall = mockEnsureThread.mock.calls[0][0] as { defaultAgentId?: string };
		expect(ensureCall.defaultAgentId).toBeUndefined();
		// PR A: summarizeWebhookEvent inserts an activity row for task.assigned
		// — the happy path now writes one system message on the new thread.
		expect(mockInsert).toHaveBeenCalledTimes(1);
		const activity = mockInsertValues.mock.calls[0][0] as {
			thread_id: string;
			role: string;
			content: string;
			metadata: { kind: string; eventKind: string };
		};
		expect(activity.thread_id).toBe("thread-new");
		expect(activity.role).toBe("system");
		expect(activity.metadata.kind).toBe("external_task_event");
		expect(activity.metadata.eventKind).toBe("task.assigned");
	});

	it("forwards defaultAgentId from the resolved connection's per-user opt-in", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		mockNormalizeEvent.mockResolvedValueOnce({
			kind: "task.assigned",
			externalTaskId: "task_42",
			providerUserId: "user_lastmile_1",
			receivedAt: "2026-04-14T10:00:00Z",
		});
		mockResolveConnection.mockResolvedValueOnce(
			buildConn({ defaultAgentId: "agent-research-bot" }),
		);
		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockRefresh.mockResolvedValueOnce(buildEnvelope("Task with assist"));
		mockEnsureThread.mockResolvedValueOnce({ threadId: "thread-42", created: true });

		await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});

		expect(mockEnsureThread).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "user-1",
				defaultAgentId: "agent-research-bot",
			}),
		);
	});

	it("synthesizes an envelope from event.raw.task when refresh() fails", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		mockNormalizeEvent.mockResolvedValueOnce({
			kind: "task.created",
			externalTaskId: "task_2",
			providerUserId: "user_lastmile_1",
			receivedAt: "2026-04-14T10:00:00Z",
			raw: {
				action: "created",
				task: {
					id: "task_2",
					title: "Deliver groceries",
					assignee_id: "user_lastmile_1",
					status: "todo",
				},
			},
		});
		mockResolveConnection.mockResolvedValueOnce(buildConn());
		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockRefresh.mockRejectedValueOnce(new Error("MCP 500"));
		// Adapter falls back to normalizeItem on the raw task payload.
		mockNormalizeItem.mockReturnValueOnce({
			core: {
				id: "task_2",
				provider: "lastmile",
				title: "Deliver groceries",
				status: { value: "todo", label: "To do" },
			},
			capabilities: {},
			fields: [],
			actions: [],
		});
		mockBuildBlocks.mockReturnValueOnce([
			{ type: "task_header" as const, title: "Deliver groceries" },
		] as never);
		mockEnsureThread.mockResolvedValueOnce({ threadId: "thread-2", created: true });

		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.envelope).toBeDefined();
		expect(result.envelope?._source?.tool).toBe("webhook_payload_fallback");
		expect(mockNormalizeItem).toHaveBeenCalledWith(
			expect.objectContaining({ id: "task_2", title: "Deliver groceries" }),
		);
		expect(mockEnsureThread).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Deliver groceries",
			}),
		);
	});

	it("falls back to placeholder title when refresh fails AND event has no raw task", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		mockNormalizeEvent.mockResolvedValueOnce({
			kind: "task.updated",
			externalTaskId: "task_3",
			providerUserId: "user_lastmile_1",
			receivedAt: "2026-04-14T10:00:00Z",
			// no `raw`, so extractRawTask returns null
		});
		mockResolveConnection.mockResolvedValueOnce(buildConn());
		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockRefresh.mockRejectedValueOnce(new Error("MCP 500"));
		mockEnsureThread.mockResolvedValueOnce({ threadId: "thread-3", created: false });

		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(result.envelope).toBeUndefined();
		expect(mockNormalizeItem).not.toHaveBeenCalled();
		expect(mockEnsureThread).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "External task task_3",
				envelope: undefined,
			}),
		);
	});
});

describe("ingestExternalTaskEvent — reassignment handoff", () => {
	it("closes the previous assignee's thread and writes a handoff message", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		mockNormalizeEvent.mockResolvedValueOnce({
			kind: "task.reassigned",
			externalTaskId: "task_r",
			providerUserId: "user_new",
			previousProviderUserId: "user_prev",
			receivedAt: "2026-04-14T10:00:00Z",
		});

		// First resolveConnection: the new assignee (for the main happy path)
		// Second resolveConnection: the previous assignee (for handoff)
		mockResolveConnection
			.mockResolvedValueOnce(buildConn({ connectionId: "conn-new", userId: "user-new" }))
			.mockResolvedValueOnce(buildConn({ connectionId: "conn-prev", userId: "user-prev", tenantId: "tenant-1" }));

		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockRefresh.mockResolvedValueOnce(buildEnvelope("Reassigned task"));
		mockCloseThread.mockResolvedValueOnce("thread-closed-id");
		mockEnsureThread.mockResolvedValueOnce({ threadId: "thread-new", created: true });

		const result = await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});

		expect(result.status).toBe("ok");
		expect(mockCloseThread).toHaveBeenCalledWith({
			tenantId: "tenant-1",
			provider: "lastmile",
			externalTaskId: "task_r",
			connectionId: "conn-prev",
			reason: "reassigned",
		});
		// Handoff message inserted on the closed thread
		expect(mockInsert).toHaveBeenCalled();
		const insertCalls = mockInsertValues.mock.calls as unknown as Array<Array<{
			thread_id: string;
			role: string;
			content: string;
			metadata: Record<string, unknown>;
		}>>;
		const inserted = insertCalls[0][0];
		expect(inserted.thread_id).toBe("thread-closed-id");
		expect(inserted.role).toBe("system");
		expect(inserted.content).toContain("reassigned away");
		expect(inserted.metadata).toMatchObject({
			kind: "external_task_handoff",
			provider: "lastmile",
			externalTaskId: "task_r",
		});
	});

	it("does not insert a handoff message when the previous connection is unknown", async () => {
		mockVerifySignature.mockResolvedValueOnce(true);
		mockNormalizeEvent.mockResolvedValueOnce({
			kind: "task.reassigned",
			externalTaskId: "task_r",
			providerUserId: "user_new",
			previousProviderUserId: "user_unknown",
			receivedAt: "2026-04-14T10:00:00Z",
		});
		mockResolveConnection
			.mockResolvedValueOnce(buildConn())
			.mockResolvedValueOnce(null);
		mockResolveOAuthToken.mockResolvedValueOnce("token");
		mockRefresh.mockResolvedValueOnce(buildEnvelope());
		mockEnsureThread.mockResolvedValueOnce({ threadId: "thread-new", created: true });

		await ingestExternalTaskEvent({
			provider: "lastmile",
			rawBody: RAW_BODY,
			headers: HEADERS,
		});

		expect(mockCloseThread).not.toHaveBeenCalled();
		// PR A: no handoff insert (previous connection unknown), but the
		// generic activity summary for task.reassigned is still written on
		// the new thread.
		expect(mockInsert).toHaveBeenCalledTimes(1);
		const activity = mockInsertValues.mock.calls[0][0] as {
			thread_id: string;
			metadata: { kind: string; eventKind: string };
		};
		expect(activity.thread_id).toBe("thread-new");
		expect(activity.metadata.kind).toBe("external_task_event");
		expect(activity.metadata.eventKind).toBe("task.reassigned");
	});
});
