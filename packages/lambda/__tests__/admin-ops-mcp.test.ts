import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

// ---------------------------------------------------------------------------
// Mock @thinkwork/database-pg so the Lambda's key-lookup path doesn't try
// to reach Aurora. Each test overrides `dbLookupResult` to drive the path.
// ---------------------------------------------------------------------------
let dbLookupResult:
	| { id: string; tenant_id: string; created_by_user_id?: string | null }[]
	| { throws: unknown }
	| undefined = [];

vi.mock("@thinkwork/database-pg", () => {
	const limit = vi.fn(async () => {
		if (dbLookupResult && "throws" in dbLookupResult) {
			throw dbLookupResult.throws;
		}
		return dbLookupResult ?? [];
	});
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere, catch: () => undefined }));
	const update = vi.fn(() => ({ set: updateSet }));
	return {
		getDb: () => ({ select, update }),
	};
});

vi.mock("@thinkwork/database-pg/schema", () => ({
	tenantMcpAdminKeys: {
		id: "id",
		tenant_id: "tenant_id",
		key_hash: "key_hash",
		revoked_at: "revoked_at",
		last_used_at: "last_used_at",
		created_by_user_id: "created_by_user_id",
	},
}));

// Import handler AFTER mocks are registered.
const { handler } = await import("../admin-ops-mcp.js");

function makeEvent(
	body: unknown,
	opts: { authHeader?: string; method?: string } = {},
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: "POST /mcp/admin",
		rawPath: "/mcp/admin",
		rawQueryString: "",
		headers: opts.authHeader ? { authorization: opts.authHeader } : {},
		requestContext: {
			accountId: "123",
			apiId: "test",
			domainName: "test.example.com",
			domainPrefix: "test",
			http: {
				method: opts.method ?? "POST",
				path: "/mcp/admin",
				protocol: "HTTP/1.1",
				sourceIp: "127.0.0.1",
				userAgent: "vitest",
			},
			requestId: "req-1",
			routeKey: "POST /mcp/admin",
			stage: "$default",
			time: "01/Jan/2026:00:00:00 +0000",
			timeEpoch: 0,
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		isBase64Encoded: false,
	};
}

describe("admin-ops-mcp Lambda", () => {
	const originalFetch = global.fetch;
	const envBackup = { ...process.env };

	beforeAll(() => {
		process.env.API_AUTH_SECRET = "test-secret";
		process.env.THINKWORK_API_URL = "https://api.test.example.com";
	});

	afterAll(() => {
		global.fetch = originalFetch;
		process.env = envBackup;
	});

	beforeEach(() => {
		// Default: no matching tenant key. Tests override per-case.
		dbLookupResult = [];
		global.fetch = originalFetch;
		delete process.env.ROUTINES_AGENT_TOOLS_ENABLED;
	});

	it("rejects non-POST methods", async () => {
		const res = await handler(
			makeEvent(undefined, { authHeader: "Bearer test-secret", method: "GET" }),
		);
		expect(res.statusCode).toBe(405);
	});

	it("OPTIONS returns 204 with CORS headers", async () => {
		const res = await handler(makeEvent(undefined, { method: "OPTIONS" }));
		expect(res.statusCode).toBe(204);
		expect(res.headers?.["Access-Control-Allow-Origin"]).toBe("*");
	});

	it("rejects requests without a Bearer token", async () => {
		const res = await handler(
			makeEvent({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
		);
		expect(res.statusCode).toBe(401);
	});

	it("rejects requests with a wrong Bearer token (no key match, no superuser)", async () => {
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authHeader: "Bearer wrong-secret" },
			),
		);
		expect(res.statusCode).toBe(401);
	});

	it("accepts a Bearer that matches a live tenant key (per-tenant auth)", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authHeader: "Bearer tkm_abc123" },
			),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.tools).toBeInstanceOf(Array);
	});

	it("accepts API_AUTH_SECRET as break-glass superuser when no key matches", async () => {
		dbLookupResult = [];
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authHeader: "Bearer test-secret" },
			),
		);
		expect(res.statusCode).toBe(200);
	});

	it("falls through to superuser check when DB lookup throws (partial outage)", async () => {
		dbLookupResult = { throws: new Error("db unavailable") };
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authHeader: "Bearer test-secret" },
			),
		);
		expect(res.statusCode).toBe(200);
	});

	it("rejects on DB failure + non-superuser token", async () => {
		dbLookupResult = { throws: new Error("db unavailable") };
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authHeader: "Bearer some-random-token" },
			),
		);
		expect(res.statusCode).toBe(401);
	});

	it("initialize returns serverInfo + tools capability", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{ authHeader: "Bearer tkm_abc" },
			),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.serverInfo.name).toBe("thinkwork-admin-ops");
		expect(body.result.capabilities.tools).toBeDefined();
	});

	it("tools/list returns every registered admin-ops tool", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 2, method: "tools/list" },
				{ authHeader: "Bearer tkm_abc" },
			),
		);
		const body = JSON.parse(res.body ?? "{}");
		const names = body.result.tools.map((t: { name: string }) => t.name);

		// Must include the original tenant tools + the full ported set from
		// teams/agents/templates/users/artifacts. Assert presence of a curated
		// subset — exact count is allowed to drift as ops are added.
		const mustHave = [
			"tenants_list",
			"tenants_get",
			"tenants_update",
			"me",
			"users_get",
			"tenant_members_list",
			"agents_list",
			"agents_get",
			"agents_list_all",
			"agents_create",
			"agents_set_skills",
			"agents_set_capabilities",
			"teams_list",
			"teams_get",
			"teams_create",
			"teams_add_agent",
			"teams_add_user",
			"teams_remove_agent",
			"teams_remove_user",
			"templates_list",
			"templates_get",
			"templates_linked_agents",
			"templates_create",
			"templates_create_agent",
			"templates_sync_to_agent",
			"templates_sync_to_all_agents",
			"templates_accept_update",
			"artifacts_list",
			"artifacts_get",
			"create_routine",
			"routine_invoke",
		];
		for (const n of mustHave) {
			expect(names, `missing tool: ${n}`).toContain(n);
		}
		// Every tool must carry a non-empty description + object inputSchema.
		for (const tool of body.result.tools) {
			expect(tool.description).toBeTypeOf("string");
			expect(tool.description.length).toBeGreaterThan(0);
			expect(tool.inputSchema.type).toBe("object");
		}
	});

	it("tools/call pins tenantId from the matching key regardless of caller args", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "pinned-tenant-uuid" }];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "tenants_list",
						// Caller tries to spoof a different tenant — must be overridden.
						arguments: { tenantId: "spoofed-tenant-uuid" },
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-tenant-id"]).toBe("pinned-tenant-uuid");
	});

	it("tools/call forwards createdByUserId from the key row as x-principal-id when caller didn't supply one", async () => {
		dbLookupResult = [
			{ id: "key-uuid", tenant_id: "tenant-uuid", created_by_user_id: "owner-uuid" },
		];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 10,
					method: "tools/call",
					params: { name: "tenants_list", arguments: {} },
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const headers = ((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-principal-id"]).toBe("owner-uuid");
	});

	it("tools/call prefers caller-supplied principalId over key's createdByUserId", async () => {
		dbLookupResult = [
			{ id: "key-uuid", tenant_id: "tenant-uuid", created_by_user_id: "owner-uuid" },
		];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 11,
					method: "tools/call",
					params: {
						name: "tenants_list",
						arguments: { principalId: "caller-supplied-user" },
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const headers = ((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-principal-id"]).toBe("caller-supplied-user");
	});

	it("tools/call omits x-principal-id when key has no createdByUserId and caller didn't supply one", async () => {
		dbLookupResult = [
			{ id: "key-uuid", tenant_id: "tenant-uuid", created_by_user_id: null },
		];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 12,
					method: "tools/call",
					params: { name: "tenants_list", arguments: {} },
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const headers = ((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-principal-id"]).toBeUndefined();
	});

	it("tools/call superuser (API_AUTH_SECRET) accepts caller-supplied tenantId", async () => {
		dbLookupResult = [];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify([]), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: {
						name: "tenants_list",
						arguments: { tenantId: "caller-supplied-uuid" },
					},
				},
				{ authHeader: "Bearer test-secret" },
			),
		);

		const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		const headers = (fetchCall[1] as RequestInit).headers as Record<string, string>;
		expect(headers["x-tenant-id"]).toBe("caller-supplied-uuid");
	});

	it("tools/call with unknown tool returns MethodNotFound", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "tenants_nope", arguments: {} },
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.error?.code).toBe(-32601);
	});

	it("create_routine stays inert when ROUTINES_AGENT_TOOLS_ENABLED is disabled", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi.fn() as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 40,
					method: "tools/call",
					params: {
						name: "create_routine",
						arguments: {
							agentId: "agent-uuid",
							name: "Check Austin Weather",
							intent: "Fetch Austin weather and email the summary.",
						},
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		expect(global.fetch).not.toHaveBeenCalled();
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(false);
		const payload = JSON.parse(body.result.content[0].text);
		expect(payload).toMatchObject({
			error: "not_yet_enabled",
			tool: "create_routine",
		});
	});

	it("routine_invoke stays inert when ROUTINES_AGENT_TOOLS_ENABLED is disabled", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi.fn() as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 44,
					method: "tools/call",
					params: {
						name: "routine_invoke",
						arguments: {
							agentId: "agent-uuid",
							routineId: "routine-id",
						},
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		expect(global.fetch).not.toHaveBeenCalled();
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(false);
		const payload = JSON.parse(body.result.content[0].text);
		expect(payload).toMatchObject({
			error: "not_yet_enabled",
			tool: "routine_invoke",
		});
	});

	it("enabled create_routine rejects underspecified intent before GraphQL", async () => {
		process.env.ROUTINES_AGENT_TOOLS_ENABLED = "true";
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi.fn() as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 45,
					method: "tools/call",
					params: {
						name: "create_routine",
						arguments: {
							agentId: "agent-uuid",
							name: "Too vague",
							intent: "weather",
						},
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		expect(global.fetch).not.toHaveBeenCalled();
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain(
			"intent must be at least 10 chars",
		);
	});

	it("enabled create_routine delegates to createRoutine without placeholder ASL artifacts", async () => {
		process.env.ROUTINES_AGENT_TOOLS_ENABLED = "true";
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						createRoutine: {
							id: "routine-id",
							tenantId: "tenant-uuid",
							agentId: "agent-uuid",
							visibility: "agent_private",
							owningAgentId: "agent-uuid",
							name: "Check Austin Weather",
							description: "Fetch Austin weather and email the summary.",
							status: "active",
							engine: "step_functions",
							currentVersion: 1,
							createdAt: "2026-05-03T00:00:00.000Z",
						},
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 41,
					method: "tools/call",
					params: {
						name: "create_routine",
						arguments: {
							agentId: "agent-uuid",
							name: "Check Austin Weather",
							description: "Daily weather check",
							intent:
								"Fetch Austin weather and email the summary to ericodom37@gmail.com.",
						},
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(false);
		const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		const request = JSON.parse((fetchCall[1] as RequestInit).body as string);
		const input = request.variables.input;
		expect(input).toMatchObject({
			tenantId: "tenant-uuid",
			agentId: "agent-uuid",
			owningAgentId: "agent-uuid",
			visibility: "agent_private",
			name: "Check Austin Weather",
		});
		expect(input.description).toContain("Daily weather check");
		expect(input.description).toContain(
			"Fetch Austin weather and email the summary to ericodom37@gmail.com.",
		);
		expect(input).not.toHaveProperty("asl");
		expect(input).not.toHaveProperty("markdownSummary");
		expect(input).not.toHaveProperty("stepManifest");
	});

	it("enabled routine_invoke rejects a routine private to another agent", async () => {
		process.env.ROUTINES_AGENT_TOOLS_ENABLED = "true";
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					data: {
						routine: {
							id: "routine-id",
							tenantId: "tenant-uuid",
							agentId: "owner-agent",
							visibility: "agent_private",
							owningAgentId: "owner-agent",
							name: "Private routine",
							description: null,
							status: "active",
							engine: "step_functions",
							currentVersion: 1,
							createdAt: "2026-05-03T00:00:00.000Z",
						},
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 42,
					method: "tools/call",
					params: {
						name: "routine_invoke",
						arguments: {
							agentId: "other-agent",
							routineId: "routine-id",
						},
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain("private_to_other_agent");
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});

	it("enabled routine_invoke forwards args to triggerRoutineRun after visibility passes", async () => {
		process.env.ROUTINES_AGENT_TOOLS_ENABLED = "true";
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: {
							routine: {
								id: "routine-id",
								tenantId: "tenant-uuid",
								agentId: "owner-agent",
								visibility: "agent_private",
								owningAgentId: "owner-agent",
								name: "Private routine",
								description: null,
								status: "active",
								engine: "step_functions",
								currentVersion: 1,
								createdAt: "2026-05-03T00:00:00.000Z",
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: {
							triggerRoutineRun: {
								id: "execution-id",
								status: "running",
								triggerSource: "agent_tool",
								startedAt: "2026-05-03T00:00:00.000Z",
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			) as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 43,
					method: "tools/call",
					params: {
						name: "routine_invoke",
						arguments: {
							agentId: "owner-agent",
							routineId: "routine-id",
							args: { location: "Austin", units: "imperial" },
						},
					},
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);

		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(false);
		expect(global.fetch).toHaveBeenCalledTimes(2);
		const triggerCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[1]!;
		const request = JSON.parse((triggerCall[1] as RequestInit).body as string);
		expect(request.variables).toEqual({
			routineId: "routine-id",
			input: JSON.stringify({ location: "Austin", units: "imperial" }),
		});
	});

	it("tools/call downstream REST failure surfaces as isError=true content", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		global.fetch = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ error: "Tenant not found" }), {
				status: 404,
				headers: { "Content-Type": "application/json" },
			}),
		) as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 5,
					method: "tools/call",
					params: { name: "tenants_get", arguments: { idOrSlug: "missing" } },
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain("HTTP 404");
	});

	it("notifications/initialized returns 202 with empty body", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				{ authHeader: "Bearer tkm_abc" },
			),
		);
		expect(res.statusCode).toBe(202);
		expect(res.body).toBe("");
	});

	it("malformed JSON returns a ParseError", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler({
			...makeEvent({ dummy: true }, { authHeader: "Bearer tkm_abc" }),
			body: "{not json",
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.error?.code).toBe(-32700);
	});

	it("tools/call tenants_update enforces at-least-one-field", async () => {
		dbLookupResult = [{ id: "key-uuid", tenant_id: "tenant-uuid" }];
		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 6,
					method: "tools/call",
					params: { name: "tenants_update", arguments: { id: "t1" } },
				},
				{ authHeader: "Bearer tkm_abc" },
			),
		);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain("At least one");
	});
});
