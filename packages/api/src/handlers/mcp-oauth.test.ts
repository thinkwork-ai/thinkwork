import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { handler } from "./mcp-oauth.js";
import { sha256Base64Url } from "../lib/mcp-oauth/state.js";

const host = "api.test";
const resource = `https://${host}/mcp/user-memory`;

describe("mcp-oauth handler", () => {
	beforeEach(() => {
		process.env.API_AUTH_SECRET = "test-secret";
		process.env.COGNITO_AUTH_BASE_URL = "https://thinkwork-dev.auth.us-east-1.amazoncognito.com";
		process.env.COGNITO_MCP_CLIENT_ID = "cognito-mcp-client";
		vi.restoreAllMocks();
	});

	it("serves protected-resource metadata for the Codex resource path", async () => {
		const response = await handler(event("GET", "/.well-known/oauth-protected-resource/mcp/user-memory"));
		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body || "{}");
		expect(body.resource).toBe(resource);
		expect(body.authorization_servers).toEqual([`https://${host}`]);
	});

	it("serves authorization-server metadata with dynamic registration", async () => {
		const response = await handler(event("GET", "/.well-known/oauth-authorization-server"));
		expect(response.statusCode).toBe(200);
		const body = JSON.parse(response.body || "{}");
		expect(body.authorization_endpoint).toBe(`https://${host}/mcp/oauth/authorize`);
		expect(body.token_endpoint).toBe(`https://${host}/mcp/oauth/token`);
		expect(body.registration_endpoint).toBe(`https://${host}/mcp/oauth/register`);
		expect(body.code_challenge_methods_supported).toContain("S256");
	});

	it("rejects plaintext non-loopback redirect URIs at registration", async () => {
		const response = await handler(
			event("POST", "/mcp/oauth/register", {
				redirect_uris: ["http://example.com/callback"],
			}),
		);
		expect(response.statusCode).toBe(400);
		expect(JSON.parse(response.body || "{}").error).toBe("invalid_redirect_uri");
	});

	it("rejects arbitrary HTTPS redirect URIs for this public Codex client flow", async () => {
		const response = await handler(
			event("POST", "/mcp/oauth/register", {
				redirect_uris: ["https://example.com/callback"],
			}),
		);
		expect(response.statusCode).toBe(400);
		expect(JSON.parse(response.body || "{}").error).toBe("invalid_redirect_uri");
	});

	it("accepts Codex registration requests that include refresh_token grant metadata", async () => {
		const response = await handler(
			event("POST", "/mcp/oauth/register", {
				client_name: "Codex",
				redirect_uris: ["http://127.0.0.1:43210/callback"],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			}),
		);
		expect(response.statusCode).toBe(201);
		const body = JSON.parse(response.body || "{}");
		expect(body.grant_types).toEqual(["authorization_code"]);
		expect(body.client_id).toEqual(expect.any(String));
	});

	it("registers Codex loopback redirect URIs and redirects authorize requests to Cognito", async () => {
		const registration = await handler(
			event("POST", "/mcp/oauth/register", {
				client_name: "Codex",
				redirect_uris: ["http://127.0.0.1:43210/callback"],
			}),
		);
		expect(registration.statusCode).toBe(201);
		const { client_id } = JSON.parse(registration.body || "{}") as { client_id: string };
		const verifier = "codex-test-verifier";
		const authorize = await handler(
			event("GET", "/mcp/oauth/authorize", undefined, {
				client_id,
				redirect_uri: "http://127.0.0.1:43210/callback",
				response_type: "code",
				code_challenge: sha256Base64Url(verifier),
				code_challenge_method: "S256",
				resource,
				state: "codex-state",
			}),
		);
		expect(authorize.statusCode).toBe(302);
		expect(authorize.headers?.Location).toContain(
			"https://thinkwork-dev.auth.us-east-1.amazoncognito.com/oauth2/authorize",
		);
		expect(authorize.headers?.Location).toContain("client_id=cognito-mcp-client");
	});

	it("defaults missing authorize resource to the user-memory MCP resource", async () => {
		const registration = await handler(
			event("POST", "/mcp/oauth/register", {
				redirect_uris: ["http://127.0.0.1:43210/callback"],
			}),
		);
		const { client_id } = JSON.parse(registration.body || "{}") as { client_id: string };
		const authorize = await handler(
			event("GET", "/mcp/oauth/authorize", undefined, {
				client_id,
				redirect_uri: "http://127.0.0.1:43210/callback",
				response_type: "code",
				code_challenge: sha256Base64Url("verifier"),
				code_challenge_method: "S256",
			}),
		);
		expect(authorize.statusCode).toBe(302);
	});

	it("rejects unsupported scopes before redirecting to Cognito", async () => {
		const registration = await handler(
			event("POST", "/mcp/oauth/register", {
				redirect_uris: ["http://127.0.0.1:43210/callback"],
			}),
		);
		const { client_id } = JSON.parse(registration.body || "{}") as { client_id: string };
		const authorize = await handler(
			event("GET", "/mcp/oauth/authorize", undefined, {
				client_id,
				redirect_uri: "http://127.0.0.1:43210/callback",
				response_type: "code",
				code_challenge: sha256Base64Url("verifier"),
				code_challenge_method: "S256",
				resource,
				scope: "openid admin:everything",
			}),
		);
		expect(authorize.statusCode).toBe(400);
		expect(JSON.parse(authorize.body || "{}").error_description).toContain("invalid_scope");
	});

	it("does not allow an authorize-state token to be exchanged as an authorization code", async () => {
		const registration = await handler(
			event("POST", "/mcp/oauth/register", {
				redirect_uris: ["http://127.0.0.1:43210/callback"],
			}),
		);
		const { client_id } = JSON.parse(registration.body || "{}") as { client_id: string };
		const verifier = "codex-test-verifier";
		const authorize = await handler(
			event("GET", "/mcp/oauth/authorize", undefined, {
				client_id,
				redirect_uri: "http://127.0.0.1:43210/callback",
				response_type: "code",
				code_challenge: sha256Base64Url(verifier),
				code_challenge_method: "S256",
				resource,
			}),
		);
		const cognitoRedirect = new URL(String(authorize.headers?.Location));
		const token = await handler(
			event(
				"POST",
				"/mcp/oauth/token",
				new URLSearchParams({
					grant_type: "authorization_code",
					client_id,
					redirect_uri: "http://127.0.0.1:43210/callback",
					code: cognitoRedirect.searchParams.get("state") || "",
					code_verifier: verifier,
					resource,
				}).toString(),
				undefined,
				"application/x-www-form-urlencoded",
			),
		);
		expect(token.statusCode).toBe(400);
		expect(JSON.parse(token.body || "{}").error_description).toContain("authorization code not found");
	});

	it("exchanges a callback for an authorization code and then for a bearer token", async () => {
		const registration = await handler(
			event("POST", "/mcp/oauth/register", {
				redirect_uris: ["http://127.0.0.1:43210/callback"],
			}),
		);
		const { client_id } = JSON.parse(registration.body || "{}") as { client_id: string };
		const verifier = "codex-test-verifier";
		const authorize = await handler(
			event("GET", "/mcp/oauth/authorize", undefined, {
				client_id,
				redirect_uri: "http://127.0.0.1:43210/callback",
				response_type: "code",
				code_challenge: sha256Base64Url(verifier),
				code_challenge_method: "S256",
				resource,
				state: "codex-state",
			}),
		);
		const cognitoRedirect = new URL(String(authorize.headers?.Location));
		const idToken = unsignedJwt({ sub: "user-sub", email: "eric@example.com", "custom:tenant_id": "tenant-a" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ id_token: idToken, access_token: "cognito-access" }),
			})),
		);

		const callback = await handler(
			event("GET", "/mcp/oauth/callback", undefined, {
				code: "cognito-code",
				state: cognitoRedirect.searchParams.get("state") || "",
			}),
		);
		expect(callback.statusCode).toBe(302);
		const codexRedirect = new URL(String(callback.headers?.Location));
		expect(codexRedirect.origin + codexRedirect.pathname).toBe("http://127.0.0.1:43210/callback");
		expect(codexRedirect.searchParams.get("state")).toBe("codex-state");
		const authCode = codexRedirect.searchParams.get("code") || "";

		const token = await handler(
			event(
				"POST",
				"/mcp/oauth/token",
				new URLSearchParams({
					grant_type: "authorization_code",
					client_id,
					redirect_uri: "http://127.0.0.1:43210/callback",
					code: authCode,
					code_verifier: verifier,
					resource,
				}).toString(),
				undefined,
				"application/x-www-form-urlencoded",
			),
		);
		expect(token.statusCode).toBe(200);
		const tokenBody = JSON.parse(token.body || "{}");
		expect(tokenBody.token_type).toBe("Bearer");
		expect(tokenBody.access_token).toEqual(expect.any(String));

		const replay = await handler(
			event(
				"POST",
				"/mcp/oauth/token",
				new URLSearchParams({
					grant_type: "authorization_code",
					client_id,
					redirect_uri: "http://127.0.0.1:43210/callback",
					code: authCode,
					code_verifier: verifier,
					resource,
				}).toString(),
				undefined,
				"application/x-www-form-urlencoded",
			),
		);
		expect(replay.statusCode).toBe(400);
		expect(JSON.parse(replay.body || "{}").error_description).toContain("already been used");
	});
});

function event(
	method: string,
	path: string,
	body?: unknown,
	queryStringParameters?: Record<string, string>,
	contentType = "application/json",
): APIGatewayProxyEventV2 {
	return {
		version: "2.0",
		routeKey: `${method} ${path}`,
		rawPath: path,
		rawQueryString: "",
		headers: { host, "content-type": contentType },
		queryStringParameters,
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
		body: typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body),
	} as APIGatewayProxyEventV2;
}

function unsignedJwt(payload: Record<string, unknown>): string {
	return [
		Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
		Buffer.from(JSON.stringify(payload)).toString("base64url"),
		"",
	].join(".");
}
