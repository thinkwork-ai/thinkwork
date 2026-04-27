import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./mcp-user-memory.js";
import { encodeJwt } from "../lib/mcp-oauth/state.js";
import { getMemoryServices } from "../lib/memory/index.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";

vi.mock("../lib/memory/index.js", () => ({
	getMemoryServices: vi.fn(),
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerFromAuth: vi.fn(),
}));

const host = "api.test";
const resource = `https://${host}/mcp/user-memory`;
const getMemoryServicesMock = vi.mocked(getMemoryServices);
const resolveCallerFromAuthMock = vi.mocked(resolveCallerFromAuth);

describe("mcp-user-memory handler", () => {
	const recallMock = vi.fn();
	const inspectMock = vi.fn();

	beforeEach(() => {
		process.env.API_AUTH_SECRET = "test-secret";
		recallMock.mockReset();
		inspectMock.mockReset();
		getMemoryServicesMock.mockReturnValue({
			recall: { recall: recallMock },
			inspect: { inspect: inspectMock },
		} as any);
		resolveCallerFromAuthMock.mockResolvedValue({ userId: "resolved-user", tenantId: "resolved-tenant" });
	});

	it("returns OAuth discovery challenge when no bearer token is present", async () => {
		const response = await handler(event("POST", "/mcp/user-memory"));
		expect(response.statusCode).toBe(401);
		expect(response.headers?.["WWW-Authenticate"]).toBe(
			`Bearer resource_metadata="https://${host}/.well-known/oauth-protected-resource/mcp/user-memory"`,
		);
	});

	it("rejects invalid bearer tokens", async () => {
		const response = await handler(event("POST", "/mcp/user-memory", undefined, "Bearer nope"));
		expect(response.statusCode).toBe(401);
	});

	it("responds to MCP initialize with a valid user-memory token", async () => {
		const token = mcpToken();
		const response = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
				`Bearer ${token}`,
			),
		);
		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body || "{}");
		expect(body.result.serverInfo.name).toBe("thinkwork-user-memory");
	});

	it("lists user memory tools", async () => {
		const token = mcpToken();
		const response = await handler(
			event("POST", "/mcp/user-memory", { jsonrpc: "2.0", id: 2, method: "tools/list" }, `Bearer ${token}`),
		);
		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body || "{}");
		expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
			"memory_recall",
			"memory_list",
		]);
	});

	it("recalls memories scoped to the authenticated user_id claim", async () => {
		recallMock.mockResolvedValue([
			{
				record: memoryRecord({ id: "mem-1", content: { text: "Eric prefers concise launch notes." } }),
				score: 0.91,
				whyRecalled: "preference match",
				backend: "hindsight",
			},
		]);
		const response = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "memory_recall", arguments: { query: "launch note preferences", limit: 5 } },
				},
				`Bearer ${mcpToken({ sub: "cognito-sub", user_id: "user-a", tenant_id: "tenant-a" })}`,
			),
		);

		expect(response.statusCode).toBe(200);
		expect(recallMock).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			ownerType: "user",
			ownerId: "user-a",
			query: "launch note preferences",
			limit: 5,
		});
		expect(resolveCallerFromAuthMock).not.toHaveBeenCalled();
		const body = JSON.parse(response.body || "{}");
		expect(body.result.structuredContent.memories[0]).toMatchObject({
			id: "mem-1",
			text: "Eric prefers concise launch notes.",
			score: 0.91,
		});
	});

	it("falls back to resolving users.id from Cognito sub and email for older tokens", async () => {
		inspectMock.mockResolvedValue([memoryRecord({ id: "mem-2" })]);
		const response = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 4,
					method: "tools/call",
					params: { name: "memory_list", arguments: { limit: 1 } },
				},
				`Bearer ${mcpToken({
					sub: "google-cognito-sub",
					email: "eric@example.com",
					user_id: undefined,
					tenant_id: undefined,
				})}`,
			),
		);

		expect(response.statusCode).toBe(200);
		expect(resolveCallerFromAuthMock).toHaveBeenCalledWith({
			authType: "cognito",
			principalId: "google-cognito-sub",
			email: "eric@example.com",
			tenantId: null,
			agentId: null,
		});
		expect(inspectMock).toHaveBeenCalledWith({
			tenantId: "resolved-tenant",
			ownerType: "user",
			ownerId: "resolved-user",
			limit: 1,
		});
	});

	it("rejects memory calls without memory:read scope", async () => {
		const response = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 5,
					method: "tools/call",
					params: { name: "memory_list", arguments: {} },
				},
				`Bearer ${mcpToken({ scope: "openid email" })}`,
			),
		);
		const body = JSON.parse(response.body || "{}");
		expect(body.error.message).toContain("memory:read");
		expect(inspectMock).not.toHaveBeenCalled();
	});
});

function mcpToken(overrides: Record<string, unknown> = {}): string {
	const claims = {
		iss: `https://${host}`,
		aud: resource,
		sub: "user-a",
		email: "eric@example.com",
		tenant_id: "tenant-a",
		user_id: "user-a",
		scope: "openid email profile memory:read wiki:read",
		...overrides,
	};
	for (const [key, value] of Object.entries(claims)) {
		if (value === undefined) delete (claims as Record<string, unknown>)[key];
	}
	return encodeJwt(claims, "test-secret", 900);
}

function memoryRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: "mem-1",
		tenantId: "tenant-a",
		ownerType: "user",
		ownerId: "user-a",
		kind: "event",
		sourceType: "explicit_remember",
		status: "active",
		content: { text: "Remembered fact." },
		backendRefs: [{ backend: "hindsight", ref: "fact-1" }],
		createdAt: "2026-04-27T00:00:00.000Z",
		...overrides,
	};
}

function event(
	method: string,
	path: string,
	body?: unknown,
	authorization?: string,
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: `${method} ${path}`,
		rawPath: path,
		rawQueryString: "",
		headers: {
			host,
			...(authorization ? { authorization } : {}),
		},
		requestContext: {
			accountId: "123",
			apiId: "api",
			domainName: host,
			domainPrefix: "api",
			http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "vitest" },
			requestId: "request",
			routeKey: `${method} ${path}`,
			stage: "$default",
			time: "",
			timeEpoch: Date.now(),
		},
		isBase64Encoded: false,
		body: body === undefined ? undefined : JSON.stringify(body),
	} as APIGatewayProxyEventV2;
}
