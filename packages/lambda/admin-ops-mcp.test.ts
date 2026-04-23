import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./admin-ops-mcp.js";

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

	it("rejects requests with a wrong Bearer token", async () => {
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "tools/list" },
				{ authHeader: "Bearer wrong-secret" },
			),
		);
		expect(res.statusCode).toBe(401);
	});

	it("initialize returns serverInfo + tools capability", async () => {
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
				{ authHeader: "Bearer test-secret" },
			),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.id).toBe(1);
		expect(body.result.serverInfo.name).toBe("thinkwork-admin-ops");
		expect(body.result.capabilities.tools).toBeDefined();
	});

	it("tools/list returns the tenant tools", async () => {
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", id: 2, method: "tools/list" },
				{ authHeader: "Bearer test-secret" },
			),
		);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.tools).toBeInstanceOf(Array);
		const names = body.result.tools.map((t: { name: string }) => t.name).sort();
		expect(names).toEqual(["tenants_get", "tenants_list", "tenants_update"]);
		for (const tool of body.result.tools) {
			expect(tool.inputSchema.type).toBe("object");
			expect(typeof tool.description).toBe("string");
		}
	});

	it("tools/call invokes tenants_list and proxies to the REST API with Bearer auth", async () => {
		global.fetch = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify([{ id: "t1", name: "Acme", slug: "acme", plan: "team", createdAt: null }]),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		) as unknown as typeof fetch;

		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "tenants_list", arguments: {} },
				},
				{ authHeader: "Bearer test-secret" },
			),
		);

		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(false);
		const inner = JSON.parse(body.result.content[0].text);
		expect(inner).toEqual([
			{ id: "t1", name: "Acme", slug: "acme", plan: "team", createdAt: null },
		]);

		// Verify downstream REST call used the bearer secret.
		const fetchCall = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
		expect(fetchCall[0]).toBe("https://api.test.example.com/api/tenants");
		expect((fetchCall[1] as RequestInit).headers).toMatchObject({
			Authorization: "Bearer test-secret",
		});
	});

	it("tools/call with unknown tool returns MethodNotFound", async () => {
		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "tenants_nope", arguments: {} },
				},
				{ authHeader: "Bearer test-secret" },
			),
		);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.error?.code).toBe(-32601);
	});

	it("tools/call with downstream REST failure returns isError=true content", async () => {
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
				{ authHeader: "Bearer test-secret" },
			),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain("Tenant not found");
		expect(body.result.content[0].text).toContain("HTTP 404");
	});

	it("notifications/initialized returns 202 with empty body", async () => {
		const res = await handler(
			makeEvent(
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				{ authHeader: "Bearer test-secret" },
			),
		);
		expect(res.statusCode).toBe(202);
		expect(res.body).toBe("");
	});

	it("malformed JSON returns a ParseError", async () => {
		const res = await handler({
			...makeEvent({ dummy: true }, { authHeader: "Bearer test-secret" }),
			body: "{not json",
		});
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.error?.code).toBe(-32700);
	});

	it("tools/call tenants_update enforces at-least-one-field", async () => {
		const res = await handler(
			makeEvent(
				{
					jsonrpc: "2.0",
					id: 6,
					method: "tools/call",
					params: { name: "tenants_update", arguments: { id: "t1" } },
				},
				{ authHeader: "Bearer test-secret" },
			),
		);
		const body = JSON.parse(res.body ?? "{}");
		expect(body.result.isError).toBe(true);
		expect(body.result.content[0].text).toContain("At least one");
	});
});
