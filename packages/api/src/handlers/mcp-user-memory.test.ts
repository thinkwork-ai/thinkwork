import { beforeEach, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./mcp-user-memory.js";
import { encodeJwt } from "../lib/mcp-oauth/state.js";

const host = "api.test";
const resource = `https://${host}/mcp/user-memory`;

describe("mcp-user-memory handler", () => {
	beforeEach(() => {
		process.env.API_AUTH_SECRET = "test-secret";
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
		const token = encodeJwt({ iss: `https://${host}`, aud: resource, sub: "user-a" }, "test-secret", 900);
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

	it("returns an empty tools list until memory tools ship", async () => {
		const token = encodeJwt({ iss: `https://${host}`, aud: resource, sub: "user-a" }, "test-secret", 900);
		const response = await handler(
			event("POST", "/mcp/user-memory", { jsonrpc: "2.0", id: 2, method: "tools/list" }, `Bearer ${token}`),
		);
		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body || "{}");
		expect(body.result.tools).toEqual([]);
	});
});

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
