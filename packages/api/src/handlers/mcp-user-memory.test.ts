import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./mcp-user-memory.js";
import { encodeJwt } from "../lib/mcp-oauth/state.js";
import { getMemoryServices } from "../lib/memory/index.js";
import { searchWikiForUser } from "../lib/wiki/search.js";
import { resolveCallerFromAuth } from "../graphql/resolvers/core/resolve-auth-user.js";

vi.mock("../lib/memory/index.js", () => ({
	getMemoryServices: vi.fn(),
}));

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerFromAuth: vi.fn(),
}));

vi.mock("../lib/wiki/search.js", () => ({
	searchWikiForUser: vi.fn(),
}));

const host = "api.test";
const resource = `https://${host}/mcp/user-memory`;
const getMemoryServicesMock = vi.mocked(getMemoryServices);
const resolveCallerFromAuthMock = vi.mocked(resolveCallerFromAuth);
const searchWikiForUserMock = vi.mocked(searchWikiForUser);

describe("mcp-user-memory handler", () => {
	const recallMock = vi.fn();
	const inspectMock = vi.fn();

	beforeEach(() => {
		process.env.API_AUTH_SECRET = "test-secret";
		recallMock.mockReset();
		inspectMock.mockReset();
		searchWikiForUserMock.mockReset();
		searchWikiForUserMock.mockResolvedValue([]);
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
			"recall",
			"memory_list",
			"list_memories",
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

	it("returns identical results through Hindsight-compatible aliases", async () => {
		const memory = {
			record: memoryRecord({ id: "mem-alias", content: { text: "Alias remembered fact." } }),
			score: 0.8,
			whyRecalled: "alias match",
			backend: "hindsight",
		};
		recallMock.mockResolvedValue([memory]);
		inspectMock.mockResolvedValue([memory.record]);

		const recallAlias = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 10,
					method: "tools/call",
					params: { name: "recall", arguments: { query: "remembered fact", limit: 2 } },
				},
				`Bearer ${mcpToken({ scope: "openid email profile memory:read" })}`,
			),
		);
		const listAlias = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 11,
					method: "tools/call",
					params: { name: "list_memories", arguments: { limit: 2 } },
				},
				`Bearer ${mcpToken({ scope: "openid email profile memory:read" })}`,
			),
		);

		expect(JSON.parse(recallAlias.body || "{}").result.structuredContent.memories[0].id).toBe("mem-alias");
		expect(JSON.parse(listAlias.body || "{}").result.structuredContent.memories[0].id).toBe("mem-alias");
		expect(recallMock).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			ownerType: "user",
			ownerId: "user-a",
			query: "remembered fact",
			limit: 2,
		});
		expect(inspectMock).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			ownerType: "user",
			ownerId: "user-a",
			limit: 2,
		});
	});

	it("enriches recall with user-scoped wiki results when wiki:read is granted", async () => {
		recallMock.mockResolvedValue([
			{
				record: memoryRecord({ id: "mem-3", content: { text: "Paris favorite is Septime." } }),
				score: 0.94,
				whyRecalled: "restaurant preference",
				backend: "hindsight",
			},
		]);
		searchWikiForUserMock.mockResolvedValue([
			wikiResult({
				page: {
					id: "wiki-1",
					title: "Paris Restaurants",
					summary: "Favorite meals and reservations.",
				},
				score: 1.2,
				matchedAlias: "septime",
			}),
		]);

		const response = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 12,
					method: "tools/call",
					params: { name: "memory_recall", arguments: { query: "favorite restaurant in Paris", limit: 50 } },
				},
				`Bearer ${mcpToken({ sub: "cognito-sub", user_id: "user-a", tenant_id: "tenant-a" })}`,
			),
		);

		const body = JSON.parse(response.body || "{}");
		expect(searchWikiForUserMock).toHaveBeenCalledWith({
			tenantId: "tenant-a",
			userId: "user-a",
			query: "favorite restaurant in Paris",
			limit: 10,
		});
		expect(body.result.structuredContent.wikiResults[0]).toMatchObject({
			page: { id: "wiki-1", title: "Paris Restaurants" },
			score: 1.2,
			matchedAlias: "septime",
		});
		expect(body.result.structuredContent.results).toEqual([
			expect.objectContaining({ type: "memory", memory: expect.objectContaining({ id: "mem-3" }) }),
			expect.objectContaining({ type: "wiki", page: expect.objectContaining({ id: "wiki-1" }) }),
		]);
		expect(body.result.content[0].text).toContain("Wiki");
	});

	it("keeps recall memory-only when wiki:read is not granted", async () => {
		recallMock.mockResolvedValue([
			{
				record: memoryRecord({ id: "mem-4" }),
				score: 0.7,
				whyRecalled: null,
				backend: "hindsight",
			},
		]);
		const response = await handler(
			event(
				"POST",
				"/mcp/user-memory",
				{
					jsonrpc: "2.0",
					id: 13,
					method: "tools/call",
					params: { name: "memory_recall", arguments: { query: "remembered fact" } },
				},
				`Bearer ${mcpToken({ scope: "openid email profile memory:read" })}`,
			),
		);

		const body = JSON.parse(response.body || "{}");
		expect(searchWikiForUserMock).not.toHaveBeenCalled();
		expect(body.result.structuredContent.wikiResults).toBeUndefined();
		expect(body.result.structuredContent.results).toEqual([
			expect.objectContaining({ type: "memory", memory: expect.objectContaining({ id: "mem-4" }) }),
		]);
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

function wikiResult(overrides: Record<string, unknown> = {}) {
	const { page: pageOverrides, ...rest } = overrides;
	const page = {
		id: "wiki-1",
		tenantId: "tenant-a",
		userId: "user-a",
		ownerId: "user-a",
		type: "TOPIC",
		slug: "paris-restaurants",
		title: "Paris Restaurants",
		summary: "Favorite meals.",
		bodyMd: null,
		status: "active",
		lastCompiledAt: "2026-04-27T00:00:00.000Z",
		createdAt: "2026-04-27T00:00:00.000Z",
		updatedAt: "2026-04-27T00:00:00.000Z",
		sections: [],
		aliases: [],
		...((pageOverrides as Record<string, unknown> | undefined) ?? {}),
	};
	return {
		page,
		score: 1,
		matchedAlias: null,
		...rest,
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
