/**
 * Handler-level tests for `GET /api/agents/runtime-config`.
 *
 * The helper itself has its own deeper coverage in
 * packages/api/src/lib/__tests__/resolve-agent-runtime-config.test.ts.
 * These tests exercise the HTTP boundary only: method, path, auth, query
 * validation, and mapping helper exceptions to HTTP responses.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const { mockResolve, FakeAgentNotFoundError, FakeAgentTemplateNotFoundError } =
	vi.hoisted(() => {
		class FakeAgentNotFoundError extends Error {
			constructor(public readonly agentId: string) {
				super(`Agent not found: ${agentId}`);
				this.name = "AgentNotFoundError";
			}
		}
		class FakeAgentTemplateNotFoundError extends Error {
			constructor(
				public readonly agentId: string,
				public readonly templateId: string,
			) {
				super(
					`Agent template not found: agentId=${agentId} templateId=${templateId}`,
				);
				this.name = "AgentTemplateNotFoundError";
			}
		}
		return {
			mockResolve: vi.fn(),
			FakeAgentNotFoundError,
			FakeAgentTemplateNotFoundError,
		};
	});

vi.mock("../lib/resolve-agent-runtime-config.js", () => ({
	AgentNotFoundError: FakeAgentNotFoundError,
	AgentTemplateNotFoundError: FakeAgentTemplateNotFoundError,
	resolveAgentRuntimeConfig: mockResolve,
}));

vi.mock("../lib/auth.js", () => ({
	extractBearerToken: (event: APIGatewayProxyEventV2): string | null => {
		const h =
			event.headers?.authorization ||
			event.headers?.Authorization ||
			null;
		if (!h || !h.startsWith("Bearer ")) return null;
		return h.slice("Bearer ".length);
	},
	validateApiSecret: (token: string): boolean =>
		token === "test-service-secret",
}));

import { handler } from "./agents-runtime-config.js";

const GOOD_TENANT = "11111111-2222-3333-4444-555555555555";
const GOOD_AGENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makeEvent(params: {
	method?: string;
	path?: string;
	query?: Record<string, string>;
	authHeader?: string | null;
}): APIGatewayProxyEventV2 {
	return {
		requestContext: {
			http: {
				method: params.method ?? "GET",
				path: params.path ?? "/api/agents/runtime-config",
			},
		},
		rawPath: params.path ?? "/api/agents/runtime-config",
		headers: params.authHeader ? { authorization: params.authHeader } : {},
		queryStringParameters: params.query ?? {},
	} as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("agents-runtime-config handler", () => {
	it("returns 200 with the helper's payload on a valid GET", async () => {
		mockResolve.mockResolvedValueOnce({
			tenantId: GOOD_TENANT,
			agentId: GOOD_AGENT,
			agentName: "Ada",
		});
		const res = await handler(
			makeEvent({
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
				authHeader: "Bearer test-service-secret",
			}),
		);
		expect(res.statusCode).toBe(200);
		const body = JSON.parse(res.body ?? "{}");
		expect(body).toMatchObject({
			tenantId: GOOD_TENANT,
			agentId: GOOD_AGENT,
			agentName: "Ada",
		});
		expect(mockResolve).toHaveBeenCalledTimes(1);
		expect(mockResolve).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: GOOD_TENANT,
				agentId: GOOD_AGENT,
				logPrefix: "[agents-runtime-config]",
			}),
		);
	});

	it("204 on OPTIONS preflight", async () => {
		const res = await handler(makeEvent({ method: "OPTIONS" }));
		expect(res.statusCode).toBe(204);
	});

	it("405 on non-GET method", async () => {
		const res = await handler(
			makeEvent({
				method: "POST",
				authHeader: "Bearer test-service-secret",
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(405);
	});

	it("404 on wrong path", async () => {
		const res = await handler(
			makeEvent({
				path: "/api/agents/runtime-config-typo",
				authHeader: "Bearer test-service-secret",
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(404);
	});

	it("401 when no bearer token", async () => {
		const res = await handler(
			makeEvent({
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(401);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("401 when bearer does not match", async () => {
		const res = await handler(
			makeEvent({
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
				authHeader: "Bearer wrong-secret",
			}),
		);
		expect(res.statusCode).toBe(401);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("400 when tenantId is missing", async () => {
		const res = await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: { agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(400);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("400 when agentId is not a UUID", async () => {
		const res = await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: { tenantId: GOOD_TENANT, agentId: "not-a-uuid" },
			}),
		);
		expect(res.statusCode).toBe(400);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("400 when currentUserId is not a UUID", async () => {
		const res = await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: {
					tenantId: GOOD_TENANT,
					agentId: GOOD_AGENT,
					currentUserId: "not-a-uuid",
				},
			}),
		);
		expect(res.statusCode).toBe(400);
		expect(mockResolve).not.toHaveBeenCalled();
	});

	it("404 when helper raises AgentNotFoundError", async () => {
		mockResolve.mockRejectedValueOnce(new FakeAgentNotFoundError(GOOD_AGENT));
		const res = await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(404);
	});

	it("404 when helper raises AgentTemplateNotFoundError", async () => {
		mockResolve.mockRejectedValueOnce(
			new FakeAgentTemplateNotFoundError(GOOD_AGENT, "tpl-id"),
		);
		const res = await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(404);
	});

	it("500 on unexpected errors (log but don't leak stack)", async () => {
		mockResolve.mockRejectedValueOnce(new Error("pg: connection refused"));
		const res = await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: { tenantId: GOOD_TENANT, agentId: GOOD_AGENT },
			}),
		);
		expect(res.statusCode).toBe(500);
	});

	it("forwards currentUserId + currentUserEmail to the helper when provided", async () => {
		const userId = "cccccccc-dddd-eeee-ffff-111111111111";
		mockResolve.mockResolvedValueOnce({
			tenantId: GOOD_TENANT,
			agentId: GOOD_AGENT,
		});
		await handler(
			makeEvent({
				authHeader: "Bearer test-service-secret",
				query: {
					tenantId: GOOD_TENANT,
					agentId: GOOD_AGENT,
					currentUserId: userId,
					currentUserEmail: "rep@acme.test",
				},
			}),
		);
		expect(mockResolve).toHaveBeenCalledWith(
			expect.objectContaining({
				tenantId: GOOD_TENANT,
				agentId: GOOD_AGENT,
				currentUserId: userId,
				currentUserEmail: "rep@acme.test",
			}),
		);
	});
});
