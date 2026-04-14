/**
 * Unit tests for the `target_type='task'` dispatch branch in
 * packages/api/src/handlers/webhooks.ts.
 *
 * Mocks the db chain, `ingestExternalTaskEvent`, and the webhook_deliveries
 * insert so we can drive each branch of the task dispatch path (happy,
 * unverified, unresolved_connection, ignored) without a real Postgres.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
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
} = vi.hoisted(() => {
	const mockSelectWhere = vi.fn();
	const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
	const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

	const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
	const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

	// Drizzle's `.insert(...).values(...)` is a PromiseLike that ALSO has
	// `.returning()` attached. The mock mirrors that: each call returns a
	// resolved-promise-with-.returning so both call patterns type-check.
	const mockInsertReturning = vi.fn();
	const mockInsertValues = vi.fn(() => {
		const thenable: Promise<unknown> & { returning: typeof mockInsertReturning } =
			Object.assign(Promise.resolve(undefined), { returning: mockInsertReturning });
		return thenable;
	});
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

vi.mock("../lib/db.js", () => ({ db: mockDb }));

vi.mock("@thinkwork/database-pg/schema", () => ({
	webhooks: { id: "id", token: "token", enabled: "enabled" },
	webhookDeliveries: { id: "id" },
	webhookIdempotency: { id: "id", webhook_id: "webhook_id", idempotency_key: "k" },
	threadTurns: { id: "id", webhook_id: "webhook_id" },
	agentWakeupRequests: { id: "id" },
	connectProviders: { id: "id", name: "name" },
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
	and: (...args: unknown[]) => args,
	sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
}));

// ingestExternalTaskEvent mock — the task dispatch branch forwards to this.
const { mockIngest } = vi.hoisted(() => {
	const mockIngest = vi.fn();
	return { mockIngest };
});

vi.mock("../integrations/external-work-items/ingestEvent.js", () => ({
	ingestExternalTaskEvent: mockIngest,
}));

vi.mock("../lib/thread-helpers.js", () => ({
	ensureThreadForWork: vi.fn(),
}));

// Import AFTER mocks
import { handler } from "../handlers/webhooks.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function buildEvent(
	rawBody: string,
	headers: Record<string, string> = {},
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		rawPath: "/webhooks/test_token_abc",
		headers,
		body: rawBody,
		requestContext: {
			http: { method: "POST", path: "/webhooks/test_token_abc", sourceIp: "203.0.113.7", protocol: "HTTP/1.1", userAgent: "" },
		} as APIGatewayProxyEventV2["requestContext"],
		routeKey: "POST /webhooks/{proxy+}",
		rawQueryString: "",
		isBase64Encoded: false,
	};
}

const TASK_WEBHOOK_ROW = {
	id: "wh-1",
	tenant_id: "tenant-1",
	target_type: "task",
	enabled: true,
	connect_provider_id: "prov-1",
	agent_id: null,
	routine_id: null,
	prompt: null,
	config: null,
	name: "LastMile Tasks",
	rate_limit: 600,
	invocation_count: 0,
};

beforeEach(() => {
	vi.clearAllMocks();
	mockInsertValues.mockImplementation(() => {
		const thenable: Promise<unknown> & { returning: typeof mockInsertReturning } =
			Object.assign(Promise.resolve(undefined), { returning: mockInsertReturning });
		return thenable;
	});
	mockInsertReturning.mockReset();
});

function primeTaskWebhookLookup(row: Record<string, unknown> = TASK_WEBHOOK_ROW) {
	// Sequence of select().from().where() calls during a task dispatch:
	//   1. Look up webhook by token → returns [row]
	//   2. Look up connect_providers by id → returns [{id, name}]
	mockSelectWhere
		.mockResolvedValueOnce([row])
		.mockResolvedValueOnce([{ id: "prov-1", name: "lastmile" }]);
}

describe("webhooks.ts — task dispatch branch", () => {
	it("returns 201 on happy path and forwards tenantId + empty secret to ingest", async () => {
		primeTaskWebhookLookup();
		mockIngest.mockResolvedValueOnce({
			status: "ok",
			threadId: "thread-xyz",
			created: true,
			event: { kind: "task.assigned", externalTaskId: "task_42" },
		});

		const res = await handler(buildEvent(JSON.stringify({ task: { id: "task_42" } })));
		expect(res.statusCode).toBe(201);

		expect(mockIngest).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "lastmile",
				tenantId: "tenant-1",
				secret: undefined,
			}),
		);
		// Stats update
		expect(mockUpdate).toHaveBeenCalled();
		// Delivery row inserted
		expect(mockInsert).toHaveBeenCalled();
	});

	it("forwards webhook.config.secret to ingest when configured", async () => {
		primeTaskWebhookLookup({ ...TASK_WEBHOOK_ROW, config: { secret: "whsec_xyz" } });
		mockIngest.mockResolvedValueOnce({
			status: "ok",
			threadId: "thread-1",
			created: false,
			event: { kind: "task.updated", externalTaskId: "task_1" },
		});

		await handler(buildEvent("{}"));

		expect(mockIngest).toHaveBeenCalledWith(
			expect.objectContaining({ secret: "whsec_xyz" }),
		);
	});

	it("returns 401 on unverified signature", async () => {
		primeTaskWebhookLookup();
		mockIngest.mockResolvedValueOnce({ status: "unverified" });

		const res = await handler(buildEvent("{}"));
		expect(res.statusCode).toBe(401);
	});

	it("returns 202 on unresolved_connection", async () => {
		primeTaskWebhookLookup();
		mockIngest.mockResolvedValueOnce({
			status: "unresolved_connection",
			providerUserId: "lm-user-99",
		});

		const res = await handler(buildEvent("{}"));
		expect(res.statusCode).toBe(202);
	});

	it("returns 202 when adapter ignores the event", async () => {
		primeTaskWebhookLookup();
		mockIngest.mockResolvedValueOnce({
			status: "ignored",
			reason: "unknown event kind",
		});

		const res = await handler(buildEvent("{}"));
		expect(res.statusCode).toBe(202);
	});

	it("returns 404 when the token does not resolve to a webhook row", async () => {
		mockSelectWhere.mockResolvedValueOnce([]); // token lookup: empty
		const res = await handler(buildEvent("{}"));
		expect(res.statusCode).toBe(404);
		expect(mockIngest).not.toHaveBeenCalled();
		// Delivery row still inserted so we can debug unknown-token attempts
		expect(mockInsert).toHaveBeenCalled();
	});

	it("returns 500 if the connect_providers row is missing", async () => {
		mockSelectWhere
			.mockResolvedValueOnce([TASK_WEBHOOK_ROW])
			.mockResolvedValueOnce([]); // provider lookup: empty
		const res = await handler(buildEvent("{}"));
		expect(res.statusCode).toBe(500);
	});

	it("does not call JSON.parse for the task branch (passes rawBody through)", async () => {
		primeTaskWebhookLookup();
		mockIngest.mockResolvedValueOnce({
			status: "ok",
			threadId: "thread-x",
			created: true,
			event: { kind: "task.updated", externalTaskId: "task_x" },
		});
		// A body that is not valid JSON would fail for agent/routine dispatch.
		// Task dispatch must pass it straight through so the adapter can parse.
		const res = await handler(buildEvent("this-is-not-json-but-task-branch-should-ignore"));
		expect(res.statusCode).toBe(201);
	});
});
