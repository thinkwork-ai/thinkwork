/**
 * PR A + PR B — activity-timeline entries and realtime notify fan-out
 * for webhook-driven external task updates.
 *
 * PR A: the `summarizeWebhookEvent()` branch and the system-message insert
 * it drives from inside `ingestExternalTaskEvent()`. Locks the noise filter:
 * `task.created` and property-only noise (updated_at, viewed_at) must NOT
 * insert a row, while real changes (status, priority, due_at, assignee,
 * comments) MUST produce a readable summary line.
 *
 * PR B: after a successful insert, we fan out `notifyNewMessage` +
 * `notifyThreadUpdate` so the mobile task detail + inbox list update
 * without the user pull-to-refreshing. Tests here assert:
 *   - both notify helpers are called exactly once per successful insert,
 *   - the payload matches the inserted message shape + the derived title,
 *   - notify failures are swallowed (ingest still returns ok),
 *   - a null summary (noise filter) triggers zero notify calls.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── DB mock — `.values(...)` is both awaitable (for the handoff path
//    that doesn't care about ids) and chainable via `.returning(...)`
//    (for PR A/B's activity insert that captures the message id).
// ─────────────────────────────────────────────────────────────────────────────

const { mockInsertValues, mockInsertReturning, mockInsert, mockDb } = vi.hoisted(() => {
	const mockInsertReturning = vi.fn().mockResolvedValue([{ id: "mock-msg-id" }]);
	// Typed parameter so TS infers `mock.calls` as `[unknown][]` — see the
	// sibling comment in external-task-ingest-event.test.ts for why.
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

// ── ensureExternalTaskThread ─────────────────────────────────────────────────

const { mockEnsureThread, mockCloseThread } = vi.hoisted(() => {
	const mockEnsureThread = vi.fn();
	const mockCloseThread = vi.fn();
	return { mockEnsureThread, mockCloseThread };
});

vi.mock("../integrations/external-work-items/ensureExternalTaskThread.js", () => ({
	ensureExternalTaskThread: mockEnsureThread,
	closeExternalTaskThread: mockCloseThread,
}));

// ── AppSync notify fan-out (PR B) ────────────────────────────────────────────

const { mockNotifyNewMessage, mockNotifyThreadUpdate } = vi.hoisted(() => {
	const mockNotifyNewMessage = vi.fn().mockResolvedValue(undefined);
	const mockNotifyThreadUpdate = vi.fn().mockResolvedValue(undefined);
	return { mockNotifyNewMessage, mockNotifyThreadUpdate };
});

vi.mock("../graphql/notify.js", () => ({
	notifyNewMessage: mockNotifyNewMessage,
	notifyThreadUpdate: mockNotifyThreadUpdate,
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { ingestExternalTaskEvent } from "../integrations/external-work-items/ingestEvent.js";
import type {
	ExternalTaskEnvelope,
	NormalizedEvent,
} from "../integrations/external-work-items/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RAW_BODY = "{}"; // adapter is fully mocked, body is irrelevant
const HEADERS = {};

const CONN = {
	connectionId: "conn-1",
	tenantId: "tenant-1",
	userId: "user-1",
	providerId: "prov-1",
};

function envelope(
	overrides: Partial<{
		title: string;
		status: { value: string; label: string };
		priority: { value: string; label: string };
		assignee: { id?: string; name: string };
		dueAt: string;
	}> = {},
): ExternalTaskEnvelope {
	return {
		_type: "external_task",
		item: {
			core: {
				id: "task_1",
				provider: "lastmile",
				title: overrides.title ?? "Test Outbox",
				status: overrides.status,
				priority: overrides.priority,
				assignee: overrides.assignee,
				dueAt: overrides.dueAt,
			},
			capabilities: {},
			fields: [],
			actions: [],
		},
		blocks: [],
	};
}

function arrangePipeline(
	event: NormalizedEvent,
	env: ExternalTaskEnvelope | undefined,
	threadId = "thread-1",
) {
	mockVerifySignature.mockResolvedValueOnce(true);
	mockNormalizeEvent.mockResolvedValueOnce(event);
	mockResolveConnection.mockResolvedValueOnce(CONN);
	mockResolveOAuthToken.mockResolvedValueOnce("access-token");
	if (env) {
		mockRefresh.mockResolvedValueOnce(env);
	} else {
		mockRefresh.mockRejectedValueOnce(new Error("no envelope"));
	}
	mockEnsureThread.mockResolvedValueOnce({ threadId, created: false });
}

function lastInsert() {
	const calls = mockInsertValues.mock.calls as unknown as Array<
		Array<{
			thread_id: string;
			tenant_id: string;
			role: string;
			content: string;
			sender_type: string;
			metadata: { kind: string; eventKind: string; provider: string };
		}>
	>;
	if (calls.length === 0) return null;
	return calls[calls.length - 1][0];
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
	mockInsert.mockReturnValue({ values: mockInsertValues });
	mockInsertReturning.mockResolvedValue([{ id: "mock-msg-id" }]);
	mockNotifyNewMessage.mockResolvedValue(undefined);
	mockNotifyThreadUpdate.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ingestExternalTaskEvent — activity message (PR A)", () => {
	describe("noise filter", () => {
		it("does NOT insert for task.created (thread creation is the implicit signal)", async () => {
			arrangePipeline(
				{
					kind: "task.created",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(mockInsert).not.toHaveBeenCalled();
		});

		it("does NOT insert for task.updated with only updated_at change (pure noise)", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["updated_at"] },
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(mockInsert).not.toHaveBeenCalled();
		});

		it("does NOT insert for task.updated when propertiesUpdated is absent", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: {},
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(mockInsert).not.toHaveBeenCalled();
		});
	});

	describe("task.updated → single-field summaries", () => {
		it("inserts 'Status changed to <label>' for a status change with a resolved envelope", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status"] },
				},
				envelope({ status: { value: "in_progress", label: "In Progress" } }),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(mockInsert).toHaveBeenCalledTimes(1);
			const msg = lastInsert();
			expect(msg).not.toBeNull();
			expect(msg!.content).toBe("Status changed to In Progress");
			expect(msg!.role).toBe("system");
			expect(msg!.sender_type).toBe("system");
			expect(msg!.thread_id).toBe("thread-1");
			expect(msg!.metadata).toMatchObject({
				kind: "external_task_event",
				eventKind: "task.updated",
				provider: "lastmile",
			});
		});

		it("inserts 'Priority set to <label>' for a priority change", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["priority"] },
				},
				envelope({ priority: { value: "high", label: "High" } }),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("Priority set to High");
		});

		it("inserts 'Due date set to <yyyy-mm-dd>' for a due-date change", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["due_at"] },
				},
				envelope({ dueAt: "2026-05-01T00:00:00Z" }),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("Due date set to 2026-05-01");
		});

		it("falls back to 'Status changed' when no envelope is available", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status"] },
				},
				undefined,
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("Status changed");
		});
	});

	describe("task.updated → multi-field summaries", () => {
		it("collapses multiple meaningful changes into 'Updated: a, b'", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status", "priority", "updated_at"] },
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("Updated: status, priority");
		});

		it("also accepts the snake_case properties_updated key from legacy webhooks", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { properties_updated: ["status"] },
				},
				envelope({ status: { value: "done", label: "Done" } }),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("Status changed to Done");
		});
	});

	describe("task.commented", () => {
		it("inserts '<actor> commented: <body excerpt>' when both are present", async () => {
			arrangePipeline(
				{
					kind: "task.commented",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: {
						comment: {
							body: "working on it now",
							author: { name: "Sam" },
						},
					},
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("Sam commented: working on it now");
		});

		it("truncates long comment bodies with an ellipsis", async () => {
			const longBody = "a".repeat(200);
			arrangePipeline(
				{
					kind: "task.commented",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: {
						comment: {
							body: longBody,
							author: { name: "Sam" },
						},
					},
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			const content = lastInsert()!.content;
			expect(content.startsWith("Sam commented: ")).toBe(true);
			expect(content.endsWith("…")).toBe(true);
			// 15 ("Sam commented: ") + 120 (excerpt) + 1 (ellipsis) = 136
			expect(content.length).toBe(136);
		});

		it("falls back to 'New comment added' when no body or actor is present", async () => {
			arrangePipeline(
				{
					kind: "task.commented",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: {},
				},
				envelope(),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			expect(lastInsert()!.content).toBe("New comment added");
		});
	});

	describe("task.assigned / task.reassigned", () => {
		it("inserts 'Reassigned to <name>' when the envelope has an assignee", async () => {
			arrangePipeline(
				{
					kind: "task.assigned",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
				},
				envelope({ assignee: { id: "user_lm_1", name: "Eric Odom" } }),
			);

			await ingestExternalTaskEvent({ provider: "lastmile", rawBody: RAW_BODY, headers: HEADERS });

			const msg = lastInsert();
			expect(msg!.content).toBe("Reassigned to Eric Odom");
			expect(msg!.metadata.eventKind).toBe("task.assigned");
		});
	});

	describe("robustness", () => {
		it("swallows a DB insert failure so ingest still returns ok", async () => {
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status"] },
				},
				envelope({ status: { value: "done", label: "Done" } }),
			);
			mockInsertReturning.mockRejectedValueOnce(new Error("db down"));

			const result = await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});

			expect(result.status).toBe("ok");
			// Notify helpers must not fire when the insert itself failed —
			// otherwise the mobile client sees a ghost message with an id
			// that doesn't exist in the DB.
			expect(mockNotifyNewMessage).not.toHaveBeenCalled();
			expect(mockNotifyThreadUpdate).not.toHaveBeenCalled();
		});
	});

	describe("PR B — realtime notify fan-out", () => {
		it("calls notifyNewMessage + notifyThreadUpdate after a successful insert", async () => {
			mockInsertReturning.mockResolvedValueOnce([{ id: "msg-real-id" }]);
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status"] },
				},
				envelope({
					title: "Test Outbox",
					status: { value: "in_progress", label: "In Progress" },
				}),
			);

			await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});

			// Wait a microtask tick so the fire-and-forget `.catch()` chains
			// attach before we assert. (`notify*` is called synchronously
			// without await, so the promise is live by the time we get here,
			// but the test runner may schedule the assertion on a microtask.)
			await Promise.resolve();

			expect(mockNotifyNewMessage).toHaveBeenCalledTimes(1);
			expect(mockNotifyNewMessage).toHaveBeenCalledWith({
				messageId: "msg-real-id",
				threadId: "thread-1",
				tenantId: "tenant-1",
				role: "system",
				content: "Status changed to In Progress",
				senderType: "system",
			});

			expect(mockNotifyThreadUpdate).toHaveBeenCalledTimes(1);
			expect(mockNotifyThreadUpdate).toHaveBeenCalledWith({
				threadId: "thread-1",
				tenantId: "tenant-1",
				status: "in_progress",
				title: "Test Outbox",
			});
		});

		it("passes the envelope title through to notifyThreadUpdate", async () => {
			arrangePipeline(
				{
					kind: "task.assigned",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
				},
				envelope({
					title: "Restock walk-in cooler",
					assignee: { id: "user_lm_1", name: "Eric" },
				}),
			);

			await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});
			await Promise.resolve();

			const call = mockNotifyThreadUpdate.mock.calls[0][0] as { title: string };
			expect(call.title).toBe("Restock walk-in cooler");
		});

		it("falls back to 'in_progress' status when the envelope has none", async () => {
			arrangePipeline(
				{
					kind: "task.assigned",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
				},
				envelope({ title: "No status task" }),
			);

			await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});
			await Promise.resolve();

			const call = mockNotifyThreadUpdate.mock.calls[0][0] as { status: string };
			expect(call.status).toBe("in_progress");
		});

		it("skips BOTH notify calls for noise events (null summary)", async () => {
			arrangePipeline(
				{
					kind: "task.created",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
				},
				envelope(),
			);

			await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});
			await Promise.resolve();

			expect(mockInsert).not.toHaveBeenCalled();
			expect(mockNotifyNewMessage).not.toHaveBeenCalled();
			expect(mockNotifyThreadUpdate).not.toHaveBeenCalled();
		});

		it("still returns ok when notifyNewMessage rejects", async () => {
			mockNotifyNewMessage.mockRejectedValueOnce(new Error("appsync 503"));
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status"] },
				},
				envelope({ status: { value: "done", label: "Done" } }),
			);

			const result = await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});

			expect(result.status).toBe("ok");
			// Even though notifyNewMessage rejected, notifyThreadUpdate
			// still fired — they're independent fire-and-forget calls.
			await Promise.resolve();
			expect(mockNotifyThreadUpdate).toHaveBeenCalledTimes(1);
		});

		it("still returns ok when notifyThreadUpdate rejects", async () => {
			mockNotifyThreadUpdate.mockRejectedValueOnce(new Error("appsync 503"));
			arrangePipeline(
				{
					kind: "task.updated",
					externalTaskId: "task_1",
					providerUserId: "user_lm_1",
					receivedAt: "2026-04-14T10:00:00Z",
					raw: { propertiesUpdated: ["status"] },
				},
				envelope({ status: { value: "done", label: "Done" } }),
			);

			const result = await ingestExternalTaskEvent({
				provider: "lastmile",
				rawBody: RAW_BODY,
				headers: HEADERS,
			});

			expect(result.status).toBe("ok");
			await Promise.resolve();
			expect(mockNotifyNewMessage).toHaveBeenCalledTimes(1);
		});
	});
});
