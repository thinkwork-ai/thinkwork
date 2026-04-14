/**
 * Unit tests for the task-connectors admin REST handler.
 *
 * Mocks the db chain, auth helpers, and global fetch (for the self-POST
 * path the test endpoint uses). Covers the load-bearing branches: list,
 * enable (new + idempotent), disable, secret lifecycle, test (with and
 * without a connected user), and auth.
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
	mockDelete,
	mockDeleteWhere,
	mockDb,
} = vi.hoisted(() => {
	const mockSelectWhere = vi.fn();
	const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
	const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

	const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
	const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
	const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

	const mockInsertReturning = vi.fn();
	const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }));
	const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

	const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
	const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

	const mockDb = {
		select: mockSelect,
		update: mockUpdate,
		insert: mockInsert,
		delete: mockDelete,
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
		mockDelete,
		mockDeleteWhere,
		mockDb,
	};
});

// `where()` returns a thenable that ALSO has `.limit` so chains like
// `.where().limit(1)` work as well as plain `.where()` awaits. `.orderBy`
// returns itself for chains like `.where().orderBy(...).limit(...)`.
function primeWhere(value: unknown) {
	mockSelectWhere.mockImplementationOnce(() => {
		const chain: Promise<unknown> & {
			limit: (n: number) => Promise<unknown>;
			orderBy: () => typeof chain;
		} = Object.assign(Promise.resolve(value), {
			limit: (_n: number) => Promise.resolve(value),
			orderBy(): typeof chain {
				return chain;
			},
		});
		return chain;
	});
}

vi.mock("../lib/db.js", () => ({ db: mockDb }));

vi.mock("@thinkwork/database-pg/schema", () => ({
	webhooks: { id: "id" },
	webhookDeliveries: { id: "id", webhook_id: "webhook_id", received_at: "received_at" },
	connectProviders: { id: "id", name: "name", provider_type: "provider_type" },
	connections: { id: "id", tenant_id: "tenant_id", provider_id: "provider_id", status: "status", metadata: "metadata" },
	threadTurns: { id: "id", webhook_id: "webhook_id" },
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
	and: (...args: unknown[]) => args,
	desc: (x: unknown) => x,
	gte: (...args: unknown[]) => args,
	lt: (...args: unknown[]) => args,
	sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }),
}));

const { mockValidate, mockExtract } = vi.hoisted(() => {
	const mockValidate = vi.fn<(token: string) => boolean>();
	const mockExtract = vi.fn<(event: unknown) => string | null>();
	return { mockValidate, mockExtract };
});

vi.mock("../lib/auth.js", () => ({
	extractBearerToken: mockExtract,
	validateApiSecret: mockValidate,
}));

// Global fetch mock for the self-POST test endpoint
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Set THINKWORK_API_URL before importing the handler (it's captured at module load)
process.env.THINKWORK_API_URL = "https://api.example.test";

// Import AFTER mocks
import { handler } from "../handlers/task-connectors.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

function buildEvent(
	method: string,
	rawPath: string,
	body?: unknown,
	headers: Record<string, string> = { "x-tenant-id": "tenant-1" },
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		rawPath,
		headers: { ...headers, authorization: "Bearer valid-bearer" },
		body: body ? JSON.stringify(body) : "",
		requestContext: {
			http: { method, path: rawPath, sourceIp: "127.0.0.1", protocol: "HTTP/1.1", userAgent: "" },
		} as APIGatewayProxyEventV2["requestContext"],
		routeKey: `${method} ${rawPath}`,
		rawQueryString: "",
		isBase64Encoded: false,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockValidate.mockReturnValue(true);
	mockExtract.mockReturnValue("valid-bearer");
});

describe("task-connectors — auth", () => {
	it("rejects requests without a Bearer token", async () => {
		mockExtract.mockReturnValueOnce(null);
		const res = await handler(buildEvent("GET", "/api/task-connectors"));
		expect(res.statusCode).toBe(401);
	});

	it("rejects requests with an invalid Bearer token", async () => {
		mockValidate.mockReturnValueOnce(false);
		const res = await handler(buildEvent("GET", "/api/task-connectors"));
		expect(res.statusCode).toBe(401);
	});

	it("rejects requests without x-tenant-id", async () => {
		const res = await handler(
			buildEvent("GET", "/api/task-connectors", undefined, { authorization: "Bearer valid-bearer" }),
		);
		expect(res.statusCode).toBe(400);
	});
});

describe("task-connectors — GET /api/task-connectors", () => {
	it("returns catalog with enabled state + stats", async () => {
		// 1. catalog query → one provider
		primeWhere([
			{
				id: "prov-1",
				name: "lastmile",
				display_name: "LastMile Tasks",
				provider_type: "task",
				is_available: true,
			},
		]);
		// 2. webhooks query → one enabled row for this tenant
		primeWhere([
			{
				id: "wh-1",
				connect_provider_id: "prov-1",
				token: "tok_abc",
				config: null,
				enabled: true,
				last_invoked_at: null,
				invocation_count: 0,
			},
		]);
		// 3. connection_count
		primeWhere([{ count: 2 }]);
		// 4. delivery stats
		primeWhere([{ total: 5, failures: 1 }]);

		const res = await handler(buildEvent("GET", "/api/task-connectors"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body).toHaveLength(1);
		expect(body[0].slug).toBe("lastmile");
		expect(body[0].enabled).toBe(true);
		expect(body[0].webhook_url).toBe("https://api.example.test/webhooks/tok_abc");
		expect(body[0].connection_count).toBe(2);
		expect(body[0].delivery_count_24h).toBe(5);
		expect(body[0].recent_failures).toBe(1);
	});

	it("returns catalog with enabled=false when no webhook row exists", async () => {
		primeWhere([
			{
				id: "prov-2",
				name: "linear",
				display_name: "Linear",
				provider_type: "task",
				is_available: true,
			},
		]);
		primeWhere([]); // no webhooks for this tenant
		primeWhere([{ count: 0 }]); // no connections

		const res = await handler(buildEvent("GET", "/api/task-connectors"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body[0].enabled).toBe(false);
		expect(body[0].webhook_url).toBeNull();
		expect(body[0].has_secret).toBe(false);
	});
});

describe("task-connectors — POST /api/task-connectors/:slug (enable)", () => {
	it("creates a new webhook row and returns the webhook URL", async () => {
		primeWhere([{ id: "prov-1", name: "lastmile", display_name: "LastMile Tasks" }]);
		primeWhere([]); // no existing webhook
		mockInsertReturning.mockResolvedValueOnce([{ id: "wh-new", token: "generated_token" }]);

		const res = await handler(buildEvent("POST", "/api/task-connectors/lastmile"));
		expect(res.statusCode).toBe(201);
		const body = JSON.parse(res.body as string);
		expect(body.already_enabled).toBe(false);
		expect(body.webhook_url).toBe("https://api.example.test/webhooks/generated_token");
		expect(mockInsert).toHaveBeenCalled();
	});

	it("is idempotent — returns existing enabled row on second call", async () => {
		primeWhere([{ id: "prov-1", name: "lastmile", display_name: "LastMile Tasks" }]);
		primeWhere([{ id: "wh-existing", token: "tok_existing", enabled: true }]);

		const res = await handler(buildEvent("POST", "/api/task-connectors/lastmile"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.already_enabled).toBe(true);
		expect(body.re_enabled).toBe(false);
		expect(body.webhook_url).toBe("https://api.example.test/webhooks/tok_existing");
		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("re-enables an existing disabled row (preserving token + secret)", async () => {
		primeWhere([{ id: "prov-1", name: "lastmile", display_name: "LastMile Tasks" }]);
		primeWhere([{ id: "wh-existing", token: "tok_preserved", enabled: false }]);

		const res = await handler(buildEvent("POST", "/api/task-connectors/lastmile"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.already_enabled).toBe(false);
		expect(body.re_enabled).toBe(true);
		expect(body.webhook_url).toBe("https://api.example.test/webhooks/tok_preserved");
		expect(mockInsert).not.toHaveBeenCalled();
		expect(mockUpdate).toHaveBeenCalled();
	});

	it("returns 404 for an unknown slug", async () => {
		primeWhere([]);
		const res = await handler(buildEvent("POST", "/api/task-connectors/notreal"));
		expect(res.statusCode).toBe(404);
	});
});

describe("task-connectors — DELETE /api/task-connectors/:slug (soft disable)", () => {
	it("soft-disables an enabled webhook row via UPDATE enabled=false", async () => {
		primeWhere([{ id: "prov-1" }]);
		primeWhere([{ id: "wh-1", enabled: true }]);

		const res = await handler(buildEvent("DELETE", "/api/task-connectors/lastmile"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.mode).toBe("soft");
		expect(body.changed).toBe(true);
		expect(mockUpdate).toHaveBeenCalled();
		expect(mockDelete).not.toHaveBeenCalled();
	});

	it("is idempotent — already-disabled row returns ok/changed:false", async () => {
		primeWhere([{ id: "prov-1" }]);
		primeWhere([{ id: "wh-1", enabled: false }]);

		const res = await handler(buildEvent("DELETE", "/api/task-connectors/lastmile"));
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.mode).toBe("soft");
		expect(body.changed).toBe(false);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it("hard delete with ?hard=true calls thread_turns null + webhook delete", async () => {
		primeWhere([{ id: "prov-1" }]);
		primeWhere([{ id: "wh-1", enabled: true }]);

		const event = buildEvent("DELETE", "/api/task-connectors/lastmile");
		(event as unknown as { queryStringParameters: Record<string, string> }).queryStringParameters = { hard: "true" };

		const res = await handler(event);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(body.mode).toBe("hard");
		expect(body.changed).toBe(true);
		// Update is called once (to null threadTurns.webhook_id)
		expect(mockUpdate).toHaveBeenCalled();
		// Delete is called on webhooks
		expect(mockDelete).toHaveBeenCalled();
	});
});

describe("task-connectors — secret lifecycle", () => {
	it("generates a secret and writes it to webhooks.config.secret", async () => {
		primeWhere([{ id: "prov-1" }]);
		primeWhere([{ id: "wh-1", config: null }]);

		const res = await handler(
			buildEvent("POST", "/api/task-connectors/lastmile/generate-secret"),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body as string);
		expect(typeof body.secret).toBe("string");
		expect(body.secret.length).toBeGreaterThan(20);
		expect(mockUpdate).toHaveBeenCalled();
	});

	it("rejects secret generation when connector is not enabled", async () => {
		primeWhere([{ id: "prov-1" }]);
		primeWhere([]); // no webhook

		const res = await handler(
			buildEvent("POST", "/api/task-connectors/lastmile/generate-secret"),
		);
		expect(res.statusCode).toBe(400);
	});

	it("removes the signing secret", async () => {
		primeWhere([{ id: "prov-1" }]);
		primeWhere([{ id: "wh-1", config: { secret: "old_secret", other_field: "x" } }]);

		const res = await handler(
			buildEvent("DELETE", "/api/task-connectors/lastmile/secret"),
		);
		expect(res.statusCode).toBe(200);
		expect(mockUpdate).toHaveBeenCalled();
	});
});

describe("task-connectors — POST /api/task-connectors/:slug/test", () => {
	it("rejects when no active connection exists", async () => {
		primeWhere([{ id: "prov-1", name: "lastmile" }]);
		primeWhere([{ id: "wh-1", token: "tok_xyz", config: null }]);
		primeWhere([]); // no connections

		const res = await handler(
			buildEvent("POST", "/api/task-connectors/lastmile/test"),
		);
		expect(res.statusCode).toBe(400);
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("fires a self-POST to /webhooks/{token} when a connection exists", async () => {
		primeWhere([{ id: "prov-1", name: "lastmile" }]);
		primeWhere([{ id: "wh-1", token: "tok_xyz", config: null }]);
		primeWhere([
			{ metadata: { lastmile: { userId: "user_real_lastmile" } } },
		]);
		mockFetch.mockResolvedValueOnce({
			ok: true,
			status: 201,
			json: async () => ({ ok: true, threadId: "thread-1", created: true }),
		});

		const res = await handler(
			buildEvent("POST", "/api/task-connectors/lastmile/test"),
		);
		expect(res.statusCode).toBe(200);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.example.test/webhooks/tok_xyz",
			expect.objectContaining({ method: "POST" }),
		);
		const call = mockFetch.mock.calls[0];
		const init = call?.[1] as { body: string };
		const body = JSON.parse(init.body);
		// Matches the real LastMile batched-array shape
		expect(Array.isArray(body)).toBe(true);
		expect(body[0].task.assignee_id).toBe("user_real_lastmile");
		expect(body[0].action).toBe("updated");
	});
});
