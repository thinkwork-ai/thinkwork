import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { randomBytes } from "crypto";
import {
	CreateSecretCommand,
	GetSecretValueCommand,
	ResourceNotFoundException,
	SecretsManagerClient,
	UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import {
	McpOAuthStateError,
	encodeJwt,
	sha256Base64Url,
	signObject,
	verifyJwt,
	verifyObject,
	verifyPkce,
} from "../lib/mcp-oauth/state.js";
import { handleCors, json, error } from "../lib/response.js";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;
const CLIENT_TTL_SECONDS = 90 * 24 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;
const COGNITO_EXCHANGE_TIMEOUT_MS = 10_000;
const SUPPORTED_SCOPES = new Set(["openid", "email", "profile", "memory:read", "memory:write", "wiki:read"]);

const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
const testAuthorizationCodes = new Map<string, StoredAuthorizationCode>();
const testRevokedTokenIds = new Map<string, { expiresAt: number; revokedAt: string; clientId?: string }>();

type RegisteredClient = {
	kind: "mcp_client";
	client_id_issued_at?: number;
	client_name?: string;
	redirect_uris: string[];
};

type AuthorizeState = {
	kind: "authorize_state";
	client_id: string;
	redirect_uri: string;
	code_challenge: string;
	code_challenge_method: "S256";
	resource: string;
	scope: string;
	state?: string;
};

type AuthorizationCode = {
	kind: "authorization_code";
	client_id: string;
	redirect_uri: string;
	code_challenge: string;
	code_challenge_method: "S256";
	resource: string;
	scope: string;
	sub: string;
	email?: string;
	tenant_id?: string;
	user_id?: string;
};

type CognitoTokenResponse = {
	id_token?: string;
	access_token?: string;
	error?: string;
	error_description?: string;
};

type StoredAuthorizationCode = {
	payload: AuthorizationCode;
	consumed: boolean;
	expires_at: number;
};

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const preflight = handleCors(event);
	if (preflight) return preflight;

	const method = event.requestContext.http.method;
	const path = event.rawPath.replace(/\/+$/, "") || "/";

	try {
		if (method === "GET" && path.startsWith("/.well-known/oauth-protected-resource")) {
			return protectedResourceMetadata(event);
		}
		if (
			method === "GET" &&
			(path === "/.well-known/oauth-authorization-server" ||
				path === "/.well-known/openid-configuration")
		) {
			return authorizationServerMetadata(event);
		}
		if (method === "GET" && path === "/mcp/oauth/jwks") {
			return json({ keys: [] });
		}
		if (method === "POST" && path === "/mcp/oauth/register") {
			return await registerClient(event);
		}
		if (method === "GET" && path === "/mcp/oauth/authorize") {
			return authorize(event);
		}
		if (method === "GET" && path === "/mcp/oauth/callback") {
			return await callback(event);
		}
		if (method === "POST" && path === "/mcp/oauth/token") {
			return await token(event);
		}
		if (method === "POST" && path === "/mcp/oauth/revoke") {
			return await revoke(event);
		}
		return error("Not found", 404);
	} catch (err) {
		if (err instanceof McpOAuthStateError) {
			return oauthError("invalid_request", err.message, 400);
		}
		console.error("[mcp-oauth] Unexpected error", err);
		return oauthError("server_error", "Internal server error", 500);
	}
}

function protectedResourceMetadata(event: APIGatewayProxyEventV2) {
	const resource = resourceUrl(event);
	return json({
		resource,
		authorization_servers: [issuerUrl(event)],
		bearer_methods_supported: ["header"],
		scopes_supported: ["openid", "email", "profile", "memory:read", "memory:write", "wiki:read"],
		resource_documentation: `${issuerUrl(event)}/docs/mcp/user-memory`,
	});
}

function authorizationServerMetadata(event: APIGatewayProxyEventV2) {
	const issuer = issuerUrl(event);
	return json({
		issuer,
		authorization_endpoint: `${issuer}/mcp/oauth/authorize`,
		token_endpoint: `${issuer}/mcp/oauth/token`,
		revocation_endpoint: `${issuer}/mcp/oauth/revoke`,
		registration_endpoint: `${issuer}/mcp/oauth/register`,
		response_types_supported: ["code"],
		grant_types_supported: ["authorization_code"],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: ["none"],
		scopes_supported: ["openid", "email", "profile", "memory:read", "memory:write", "wiki:read"],
	});
}

async function registerClient(event: APIGatewayProxyEventV2) {
	const body = parseJsonBody(event) as {
		client_name?: string;
		redirect_uris?: string[];
		grant_types?: string[];
		response_types?: string[];
		token_endpoint_auth_method?: string;
	};
	const redirectUris = body.redirect_uris ?? [];
	if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
		return oauthError("invalid_client_metadata", "redirect_uris is required", 400);
	}
	if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
		return oauthError("invalid_client_metadata", "Only public clients are supported", 400);
	}
	if (body.grant_types && !body.grant_types.includes("authorization_code")) {
		return oauthError("invalid_client_metadata", "Only authorization_code grant is supported", 400);
	}
	if (body.response_types && !body.response_types.every((responseType) => responseType === "code")) {
		return oauthError("invalid_client_metadata", "Only code response type is supported", 400);
	}
	for (const redirectUri of redirectUris) {
		if (!isAllowedRedirectUri(redirectUri)) {
			return oauthError("invalid_redirect_uri", `redirect_uri is not allowed: ${redirectUri}`, 400);
		}
	}

	const client: RegisteredClient = {
		kind: "mcp_client",
		client_id_issued_at: Math.floor(Date.now() / 1000),
		client_name: body.client_name,
		redirect_uris: redirectUris,
	};
	const clientId = signObject(client, signingSecret(), CLIENT_TTL_SECONDS);
	return json(
		{
			client_id: clientId,
			client_id_issued_at: client.client_id_issued_at,
			client_name: body.client_name,
			redirect_uris: redirectUris,
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
		201,
	);
}

function authorize(event: APIGatewayProxyEventV2) {
	const qs = event.queryStringParameters ?? {};
	const clientId = required(qs.client_id, "client_id");
	const redirectUri = required(qs.redirect_uri, "redirect_uri");
	const responseType = required(qs.response_type, "response_type");
	const codeChallenge = required(qs.code_challenge, "code_challenge");
	const codeChallengeMethod = required(qs.code_challenge_method, "code_challenge_method");
	const resource = qs.resource || resourceUrl(event);

	if (responseType !== "code") return oauthError("unsupported_response_type", "response_type must be code", 400);
	if (codeChallengeMethod !== "S256") {
		return oauthError("invalid_request", "Only S256 PKCE is supported", 400);
	}
	const client = verifyClient(clientId);
	if (!client.redirect_uris.includes(redirectUri)) {
		return oauthError("invalid_request", "redirect_uri was not registered for this client", 400);
	}
	if (!sameResource(resource, resourceUrl(event))) {
		return oauthError("invalid_target", "resource does not match this MCP server", 400);
	}

	const state = signObject<AuthorizeState>(
		{
			kind: "authorize_state",
			client_id: clientId,
			redirect_uri: redirectUri,
			code_challenge: codeChallenge,
			code_challenge_method: "S256",
			resource,
			scope: validateScope(qs.scope),
			...(qs.state ? { state: qs.state } : {}),
		},
		signingSecret(),
		STATE_TTL_SECONDS,
	);

	const cognitoBaseUrl = requiredEnv("COGNITO_AUTH_BASE_URL");
	const cognitoClientId = requiredEnv("COGNITO_MCP_CLIENT_ID");
	const callbackUrl = mcpOAuthCallbackUrl(event);
	const redirect = new URL(`${cognitoBaseUrl.replace(/\/+$/, "")}/oauth2/authorize`);
	redirect.searchParams.set("client_id", cognitoClientId);
	redirect.searchParams.set("redirect_uri", callbackUrl);
	redirect.searchParams.set("response_type", "code");
	redirect.searchParams.set("scope", "openid email profile");
	redirect.searchParams.set("state", state);

	return redirectResponse(redirect.toString());
}

async function callback(event: APIGatewayProxyEventV2) {
	const qs = event.queryStringParameters ?? {};
	const stateToken = required(qs.state, "state");
	const state = verifyObject<AuthorizeState>(stateToken, signingSecret());
	const redirect = new URL(state.redirect_uri);

	if (qs.error) {
		redirect.searchParams.set("error", qs.error);
		if (qs.error_description) redirect.searchParams.set("error_description", qs.error_description);
		if (state.state) redirect.searchParams.set("state", state.state);
		return redirectResponse(redirect.toString());
	}

	const cognitoCode = required(qs.code, "code");
	const tokens = await exchangeCognitoCode(event, cognitoCode);
	if (!tokens.id_token) {
		return oauthError("server_error", "Cognito token response did not include id_token", 502);
	}
	const claims = decodeJwtPayload(tokens.id_token);
	const sub = stringClaim(claims.sub, "sub");
	const email = typeof claims.email === "string" ? claims.email : undefined;
	const tenantId = typeof claims["custom:tenant_id"] === "string" ? claims["custom:tenant_id"] : undefined;
	const userId = stringClaimOptional(claims.user_id) ?? stringClaimOptional(claims["custom:user_id"]);
	const code = await createAuthorizationCode({
		kind: "authorization_code",
		client_id: state.client_id,
		redirect_uri: state.redirect_uri,
		code_challenge: state.code_challenge,
		code_challenge_method: state.code_challenge_method,
		resource: state.resource,
		scope: state.scope,
		sub,
		...(email ? { email } : {}),
		...(tenantId ? { tenant_id: tenantId } : {}),
		...(userId ? { user_id: userId } : {}),
	});
	redirect.searchParams.set("code", code);
	if (state.state) redirect.searchParams.set("state", state.state);
	return redirectResponse(redirect.toString());
}

async function token(event: APIGatewayProxyEventV2) {
	const form = parseFormBody(event);
	const grantType = required(form.grant_type, "grant_type");
	if (grantType !== "authorization_code") {
		return oauthError("unsupported_grant_type", "Only authorization_code is supported", 400);
	}
	const code = await consumeAuthorizationCode(required(form.code, "code"));
	const clientId = required(form.client_id, "client_id");
	const redirectUri = required(form.redirect_uri, "redirect_uri");
	const codeVerifier = required(form.code_verifier, "code_verifier");
	const resource = form.resource || code.resource;

	if (clientId !== code.client_id) return oauthError("invalid_grant", "client_id does not match code", 400);
	if (code.kind !== "authorization_code" || !code.sub) {
		return oauthError("invalid_grant", "authorization code is invalid", 400);
	}
	if (redirectUri !== code.redirect_uri) return oauthError("invalid_grant", "redirect_uri does not match code", 400);
	if (!sameResource(resource, code.resource)) return oauthError("invalid_target", "resource does not match code", 400);
	if (!verifyPkce(codeVerifier, code.code_challenge, code.code_challenge_method)) {
		return oauthError("invalid_grant", "PKCE verifier did not match code challenge", 400);
	}
	verifyClient(clientId);

	const accessToken = encodeJwt(
		{
			iss: issuerUrl(event),
			aud: code.resource,
			jti: randomBytes(32).toString("base64url"),
			sub: code.sub,
			email: code.email,
			tenant_id: code.tenant_id,
			user_id: code.user_id,
			client_id: clientId,
			scope: code.scope,
		},
		signingSecret(),
		ACCESS_TOKEN_TTL_SECONDS,
	);
	return json({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		scope: code.scope,
	});
}

async function revoke(event: APIGatewayProxyEventV2) {
	const form = parseFormBody(event);
	const token = form.token;
	if (!token) return emptyOk();

	let claims: Record<string, unknown>;
	try {
		claims = verifyJwt(token, signingSecret());
	} catch {
		return emptyOk();
	}

	const jti = stringClaimOptional(claims.jti);
	if (!jti) return emptyOk();

	const expiresAt = typeof claims.exp === "number" ? claims.exp : Math.floor(Date.now() / 1000);
	const clientId = stringClaimOptional(form.client_id) ?? stringClaimOptional(claims.client_id);
	await revokeTokenId(jti, expiresAt, clientId);
	return emptyOk();
}

export async function verifyMcpAccessToken(
	token: string,
	expectedResource: string,
	expectedIssuer?: string,
): Promise<Record<string, unknown>> {
	const claims = verifyJwt(token, signingSecret());
	if (expectedIssuer && !sameResource(String(claims.iss || ""), expectedIssuer)) {
		throw new McpOAuthStateError("token issuer does not match this authorization server");
	}
	if (!sameResource(String(claims.aud || ""), expectedResource)) {
		throw new McpOAuthStateError("token audience does not match this MCP resource");
	}
	if (typeof claims.scope !== "string") {
		throw new McpOAuthStateError("token scope claim missing");
	}
	const jti = stringClaimOptional(claims.jti);
	if (jti && (await isTokenIdRevoked(jti))) {
		throw new McpOAuthStateError("token has been revoked");
	}
	return claims;
}

function verifyClient(clientId: string): RegisteredClient {
	const client = verifyObject<RegisteredClient>(clientId, signingSecret());
	if (client.kind !== "mcp_client" || !Array.isArray(client.redirect_uris)) {
		throw new McpOAuthStateError("invalid client_id");
	}
	return client;
}

async function exchangeCognitoCode(
	event: APIGatewayProxyEventV2,
	code: string,
): Promise<CognitoTokenResponse> {
	const cognitoBaseUrl = requiredEnv("COGNITO_AUTH_BASE_URL");
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		client_id: requiredEnv("COGNITO_MCP_CLIENT_ID"),
		redirect_uri: mcpOAuthCallbackUrl(event),
		code,
	});
	const response = await fetch(`${cognitoBaseUrl.replace(/\/+$/, "")}/oauth2/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
		signal: AbortSignal.timeout(COGNITO_EXCHANGE_TIMEOUT_MS),
	});
	const payload = (await response.json().catch(() => ({}))) as CognitoTokenResponse;
	if (!response.ok) {
		console.error("[mcp-oauth] Cognito code exchange failed", {
			status: response.status,
			error: payload.error,
			error_description: payload.error_description,
		});
		throw new McpOAuthStateError("Cognito code exchange failed");
	}
	return payload;
}

async function createAuthorizationCode(payload: AuthorizationCode): Promise<string> {
	const code = `tw_mcp_code_${randomBytes(32).toString("base64url")}`;
	const stored: StoredAuthorizationCode = {
		payload,
		consumed: false,
		expires_at: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
	};
	if (isTestRuntime()) {
		testAuthorizationCodes.set(code, stored);
		return code;
	}
	await secrets.send(
		new CreateSecretCommand({
			Name: authorizationCodeSecretName(code),
			SecretString: JSON.stringify(stored),
		}),
	);
	return code;
}

async function consumeAuthorizationCode(code: string): Promise<AuthorizationCode> {
	const stored = await readAuthorizationCode(code);
	if (stored.consumed) throw new McpOAuthStateError("authorization code has already been used");
	if (stored.expires_at < Date.now()) throw new McpOAuthStateError("authorization code expired");
	const consumed = { ...stored, consumed: true };
	if (isTestRuntime()) {
		testAuthorizationCodes.set(code, consumed);
	} else {
		await secrets.send(
			new UpdateSecretCommand({
				SecretId: authorizationCodeSecretName(code),
				SecretString: JSON.stringify(consumed),
			}),
		);
	}
	return stored.payload;
}

async function readAuthorizationCode(code: string): Promise<StoredAuthorizationCode> {
	if (isTestRuntime()) {
		const stored = testAuthorizationCodes.get(code);
		if (!stored) throw new McpOAuthStateError("authorization code not found");
		return stored;
	}
	try {
		const response = await secrets.send(
			new GetSecretValueCommand({ SecretId: authorizationCodeSecretName(code) }),
		);
		if (!response.SecretString) throw new McpOAuthStateError("authorization code not found");
		return JSON.parse(response.SecretString) as StoredAuthorizationCode;
	} catch (err) {
		if (err instanceof ResourceNotFoundException) {
			throw new McpOAuthStateError("authorization code not found");
		}
		throw err;
	}
}

async function revokeTokenId(jti: string, expiresAt: number, clientId?: string): Promise<void> {
	const tokenIdHash = sha256Base64Url(jti);
	const revokedAt = new Date().toISOString();
	if (isTestRuntime()) {
		testRevokedTokenIds.set(tokenIdHash, { expiresAt, revokedAt, ...(clientId ? { clientId } : {}) });
		return;
	}

	const tableName = requiredEnv("MCP_OAUTH_REVOCATIONS_TABLE");
	await dynamodb.send(
		new PutItemCommand({
			TableName: tableName,
			Item: {
				token_id_hash: { S: tokenIdHash },
				expires_at: { N: String(expiresAt) },
				revoked_at: { S: revokedAt },
				...(clientId ? { client_id: { S: clientId } } : {}),
			},
		}),
	);
}

async function isTokenIdRevoked(jti: string): Promise<boolean> {
	const tokenIdHash = sha256Base64Url(jti);
	if (isTestRuntime()) {
		const revoked = testRevokedTokenIds.get(tokenIdHash);
		if (!revoked) return false;
		return revoked.expiresAt >= Math.floor(Date.now() / 1000);
	}

	const tableName = requiredEnv("MCP_OAUTH_REVOCATIONS_TABLE");
	try {
		const response = await dynamodb.send(
			new GetItemCommand({
				TableName: tableName,
				Key: { token_id_hash: { S: tokenIdHash } },
				ProjectionExpression: "token_id_hash, expires_at",
				ConsistentRead: true,
			}),
		);
		const expiresAt = Number(response.Item?.expires_at?.N ?? 0);
		return Boolean(response.Item?.token_id_hash?.S) && expiresAt >= Math.floor(Date.now() / 1000);
	} catch (err) {
		console.error("[mcp-oauth] token revocation lookup failed", err);
		throw new McpOAuthStateError("token revocation status could not be checked");
	}
}

function authorizationCodeSecretName(code: string): string {
	const stage = process.env.STAGE || "dev";
	return `thinkwork/${stage}/mcp-oauth/codes/${sha256Base64Url(code)}`;
}

function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
	if (!event.body) return {};
	const body = event.isBase64Encoded
		? Buffer.from(event.body, "base64").toString("utf8")
		: event.body;
	return JSON.parse(body);
}

function parseFormBody(event: APIGatewayProxyEventV2): Record<string, string> {
	if (!event.body) return {};
	const body = event.isBase64Encoded
		? Buffer.from(event.body, "base64").toString("utf8")
		: event.body;
	const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
	if (contentType.includes("application/json")) {
		return parseJsonBody(event) as Record<string, string>;
	}
	return Object.fromEntries(new URLSearchParams(body));
}

function decodeJwtPayload(token: string): Record<string, unknown> {
	const [, payload] = token.split(".");
	if (!payload) throw new McpOAuthStateError("invalid id_token");
	return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

function resourceUrl(event: APIGatewayProxyEventV2): string {
	return `${issuerUrl(event)}/mcp/user-memory`;
}

function mcpOAuthCallbackUrl(event: APIGatewayProxyEventV2): string {
	return process.env.MCP_OAUTH_CALLBACK_URL || `${issuerUrl(event)}/mcp/oauth/callback`;
}

function issuerUrl(event: APIGatewayProxyEventV2): string {
	const proto = event.headers["x-forwarded-proto"] || "https";
	const host = event.headers.host || event.requestContext.domainName;
	return `${proto}://${host}`;
}

function signingSecret(): string {
	return process.env.MCP_OAUTH_SIGNING_SECRET || process.env.API_AUTH_SECRET || process.env.THINKWORK_API_SECRET || "";
}

function isTestRuntime(): boolean {
	return process.env.NODE_ENV === "test" || process.env.VITEST === "true";
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new McpOAuthStateError(`${name} is not configured`);
	return value;
}

function required(value: string | undefined, name: string): string {
	if (!value) throw new McpOAuthStateError(`${name} is required`);
	return value;
}

function stringClaim(value: unknown, name: string): string {
	if (typeof value !== "string" || !value) throw new McpOAuthStateError(`${name} claim missing`);
	return value;
}

function stringClaimOptional(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

function sameResource(left: string, right: string): boolean {
	return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

function isAllowedRedirectUri(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:") return false;
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
	} catch {
		return false;
	}
}

function validateScope(scope: string | undefined): string {
	const requested = (scope ?? "openid email profile memory:read memory:write wiki:read")
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	const invalid = requested.filter((part) => !SUPPORTED_SCOPES.has(part));
	if (invalid.length > 0) {
		throw new McpOAuthStateError(`invalid_scope: ${invalid.join(" ")}`);
	}
	return Array.from(new Set(requested)).join(" ");
}

function oauthError(errorCode: string, description: string, statusCode: number) {
	return json({ error: errorCode, error_description: description }, statusCode);
}

function emptyOk(): APIGatewayProxyStructuredResultV2 {
	return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: "" };
}

function redirectResponse(location: string): APIGatewayProxyStructuredResultV2 {
	return { statusCode: 302, headers: { Location: location }, body: "" };
}
