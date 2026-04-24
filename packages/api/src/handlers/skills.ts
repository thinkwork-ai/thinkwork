import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	ListObjectsV2Command,
	CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	SecretsManagerClient,
	CreateSecretCommand,
	UpdateSecretCommand,
	DeleteSecretCommand,
	GetSecretValueCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agentSkills, skillCatalog, skillRuns, tenantSkills, tenantMcpServers, agentMcpServers, agentTemplateMcpServers, tenantBuiltinTools, connections, connectProviders, users } from "@thinkwork/database-pg/schema";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { authenticate } from "../lib/cognito-auth.js";
import { handleCors, json, error, notFound, unauthorized } from "../lib/response.js";
import { resolveTenantId } from "../lib/tenants.js";
import { applyMcpServerFieldUpdate } from "../lib/mcp-server-update.js";
import { computeMcpUrlHash } from "../lib/mcp-server-hash.js";

const s3 = new S3Client({});
const sm = new SecretsManagerClient({});
const db = getDb();
const BUCKET = process.env.WORKSPACE_BUCKET!;
const CATALOG_PREFIX = "skills/catalog";
const STAGE = process.env.STAGE || "dev";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	if (event.requestContext.http.method === "OPTIONS") return { statusCode: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "*", "Access-Control-Allow-Headers": "*" }, body: "" };

	const method = event.requestContext.http.method;
	const path = event.rawPath;

	// MCP OAuth endpoints are public (browser redirects, no Bearer token)
	if (path.startsWith("/api/skills/mcp-oauth/")) {
		try {
			if (path === "/api/skills/mcp-oauth/authorize" && method === "GET") {
				return mcpOAuthAuthorize(event);
			}
			if (path === "/api/skills/mcp-oauth/callback" && method === "GET") {
				return mcpOAuthCallback(event);
			}
			return notFound("Route not found");
		} catch (err) {
			console.error("MCP OAuth error:", err);
			return error("Internal server error", 500);
		}
	}

	// Accept Cognito JWT (admin UI, mobile), Bearer API_AUTH_SECRET (service), or
	// x-api-key (AppSync / app-manager). Validation lives in authenticate().
	const auth = await authenticate(event.headers);
	if (!auth) return unauthorized();

	try {
		// --- Catalog routes ---

		// GET /api/skills/catalog
		if (path === "/api/skills/catalog" && method === "GET") {
			return getCatalogIndex();
		}

		// GET /api/skills/catalog/:slug/files (list) or /api/skills/catalog/:slug/files/* (get)
		const catalogFilesMatch = path.match(
			/^\/api\/skills\/catalog\/([^/]+)\/files(?:\/(.+))?$/,
		);
		if (catalogFilesMatch && method === "GET") {
			const [, slug, filePath] = catalogFilesMatch;
			if (filePath) return getCatalogFile(slug, filePath);
			return listCatalogFiles(slug);
		}

		// GET /api/skills/catalog/:slug
		const catalogSlugMatch = path.match(/^\/api\/skills\/catalog\/([^/]+)$/);
		if (catalogSlugMatch && method === "GET") {
			return getCatalogSkill(catalogSlugMatch[1]);
		}

		// --- Tenant routes ---

		const tenantSlug = event.headers["x-tenant-slug"];

		// GET /api/skills/tenant
		if (path === "/api/skills/tenant" && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return getTenantSkills(tenantSlug);
		}

		// POST /api/skills/tenant/create — create a new custom skill from template
		if (path === "/api/skills/tenant/create" && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return createTenantSkill(tenantSlug, event);
		}

		// POST /api/skills/tenant/:slug/install
		const installMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/install$/,
		);
		if (installMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return installSkill(tenantSlug, installMatch[1]);
		}

		// POST /api/skills/tenant/:slug/upload — upload skill zip
		const uploadMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/upload$/,
		);
		if (uploadMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return getUploadUrl(tenantSlug, uploadMatch[1]);
		}

		// GET /api/skills/tenant/:slug/files — list files in tenant skill
		const tenantFileListMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/files$/,
		);
		if (tenantFileListMatch && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return listTenantSkillFiles(tenantSlug, tenantFileListMatch[1]);
		}

		// GET/PUT/POST/DELETE /api/skills/tenant/:slug/files/*
		const tenantFilesMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/files\/(.+)$/,
		);
		if (tenantFilesMatch) {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			const [, slug, filePath] = tenantFilesMatch;
			if (method === "GET") return getTenantFile(tenantSlug, slug, filePath);
			if (method === "PUT") return saveTenantFile(tenantSlug, slug, filePath, event);
			if (method === "POST") return createTenantFile(tenantSlug, slug, filePath, event);
			if (method === "DELETE") return deleteTenantFile(tenantSlug, slug, filePath);
			return error("Method not allowed", 405);
		}

		// GET /api/skills/tenant/:slug/upgradeable
		const upgradeableMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/upgradeable$/,
		);
		if (upgradeableMatch && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return checkUpgradeable(tenantSlug, upgradeableMatch[1]);
		}

		// POST /api/skills/tenant/:slug/upgrade
		const upgradeMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)\/upgrade$/,
		);
		if (upgradeMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			const force = event.queryStringParameters?.force === "true";
			return upgradeSkill(tenantSlug, upgradeMatch[1], force);
		}

		// DELETE /api/skills/tenant/:slug
		const tenantDeleteMatch = path.match(
			/^\/api\/skills\/tenant\/([^/]+)$/,
		);
		if (tenantDeleteMatch && method === "DELETE") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			const forceDelete = event.queryStringParameters?.force === "true";
			return uninstallSkill(tenantSlug, tenantDeleteMatch[1], forceDelete);
		}

		// POST /api/skills/agent/:agentSlug/install/:skillSlug
		const agentInstallMatch = path.match(
			/^\/api\/skills\/agent\/([^/]+)\/install\/([^/]+)$/,
		);
		if (agentInstallMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return installSkillToAgent(tenantSlug, agentInstallMatch[1], agentInstallMatch[2]);
		}

		// POST /api/skills/agent/:agentId/:skillId/credentials
		const credMatch = path.match(
			/^\/api\/skills\/agent\/([^/]+)\/([^/]+)\/credentials$/,
		);
		if (credMatch && method === "POST") {
			return saveSkillCredentials(credMatch[1], credMatch[2], event);
		}

		// --- MCP Server routes (tenant-level registry) ---

		// GET /api/skills/mcp-servers — list tenant's MCP servers
		if (path === "/api/skills/mcp-servers" && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpListTenantServers(tenantSlug);
		}

		// POST /api/skills/mcp-servers — register MCP server
		if (path === "/api/skills/mcp-servers" && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpRegisterServer(tenantSlug, event);
		}

		// PUT /api/skills/mcp-servers/:id — update MCP server
		const mcpUpdateMatch = path.match(/^\/api\/skills\/mcp-servers\/([^/]+)$/);
		if (mcpUpdateMatch && method === "PUT") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpUpdateServer(tenantSlug, mcpUpdateMatch[1], event);
		}

		// DELETE /api/skills/mcp-servers/:id — remove MCP server
		if (mcpUpdateMatch && method === "DELETE") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpDeleteServer(tenantSlug, mcpUpdateMatch[1]);
		}

		// POST /api/skills/mcp-servers/:id/test — test connection + cache tools
		const mcpTestMatch = path.match(/^\/api\/skills\/mcp-servers\/([^/]+)\/test$/);
		if (mcpTestMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return mcpTestConnection(tenantSlug, mcpTestMatch[1]);
		}

		// --- Built-in Tools (per-tenant config for catalog skills like web-search) ---

		if (path === "/api/skills/builtin-tools" && method === "GET") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return builtinToolsList(tenantSlug);
		}
		const builtinToolMatch = path.match(/^\/api\/skills\/builtin-tools\/([^/]+)$/);
		if (builtinToolMatch && method === "PUT") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return builtinToolsUpsert(tenantSlug, builtinToolMatch[1], event);
		}
		if (builtinToolMatch && method === "DELETE") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return builtinToolsDelete(tenantSlug, builtinToolMatch[1]);
		}
		const builtinToolTestMatch = path.match(/^\/api\/skills\/builtin-tools\/([^/]+)\/test$/);
		if (builtinToolTestMatch && method === "POST") {
			if (!tenantSlug) return error("x-tenant-slug header required", 400);
			return builtinToolsTest(tenantSlug, builtinToolTestMatch[1], event);
		}

		// --- MCP Server routes (agent-level assignment) ---

		// GET /api/skills/agents/:agentId/mcp-servers — list agent's assigned MCP servers
		const agentMcpListMatch = path.match(/^\/api\/skills\/agents\/([^/]+)\/mcp-servers$/);
		if (agentMcpListMatch && method === "GET") {
			return mcpListAgentServers(agentMcpListMatch[1]);
		}

		// POST /api/skills/agents/:agentId/mcp-servers — assign MCP server to agent
		if (agentMcpListMatch && method === "POST") {
			return mcpAssignToAgent(agentMcpListMatch[1], event);
		}

		// DELETE /api/skills/agents/:agentId/mcp-servers/:mcpServerId — unassign
		const agentMcpDeleteMatch = path.match(/^\/api\/skills\/agents\/([^/]+)\/mcp-servers\/([^/]+)$/);
		if (agentMcpDeleteMatch && method === "DELETE") {
			return mcpUnassignFromAgent(agentMcpDeleteMatch[1], agentMcpDeleteMatch[2]);
		}

		// GET /api/skills/oauth-providers — list configured OAuth providers (for admin dropdown)
		if (path === "/api/skills/oauth-providers" && method === "GET") {
			return mcpListOAuthProviders();
		}

		// GET /api/skills/templates/:templateId/mcp-servers — list template's MCP servers
		const templateMcpMatch = path.match(/^\/api\/skills\/templates\/([^/]+)\/mcp-servers$/);
		if (templateMcpMatch && method === "GET") {
			return mcpGetTemplateMcpServers(templateMcpMatch[1]);
		}

		// POST /api/skills/templates/:templateId/mcp-servers — assign MCP server to template
		if (templateMcpMatch && method === "POST") {
			return mcpAssignToTemplate(templateMcpMatch[1], event);
		}

		// DELETE /api/skills/templates/:templateId/mcp-servers/:mcpServerId — unassign
		const templateMcpDeleteMatch = path.match(/^\/api\/skills\/templates\/([^/]+)\/mcp-servers\/([^/]+)$/);
		if (templateMcpDeleteMatch && method === "DELETE") {
			return mcpUnassignFromTemplate(templateMcpDeleteMatch[1], templateMcpDeleteMatch[2]);
		}

		// GET /api/skills/user-mcp-servers — list MCP servers for the current user (for mobile app)
		if (path === "/api/skills/user-mcp-servers" && method === "GET") {
			const tenantId = event.headers["x-tenant-id"];
			const userId = event.headers["x-principal-id"];
			if (!tenantId || !userId) return error("x-tenant-id and x-principal-id headers required", 400);
			return mcpListUserServers(tenantId, userId);
		}

		// DELETE /api/skills/user-mcp-tokens/:mcpServerId — clear user's OAuth tokens for an MCP server
		const clearTokenMatch = path.match(/^\/api\/skills\/user-mcp-tokens\/([^/]+)$/);
		if (clearTokenMatch && method === "DELETE") {
			const mcpServerId = clearTokenMatch[1];
			const userId = event.headers["x-principal-id"];
			const tenantId = event.headers["x-tenant-id"];
			if (!userId || !tenantId) return error("x-principal-id and x-tenant-id headers required", 400);
			return mcpClearUserToken(userId, tenantId, mcpServerId);
		}

		// POST /api/skills/start — service-to-service wrapper around startSkillRun.
		// The AgentCore-container's dispatcher skill calls this with API_AUTH_SECRET
		// to kick off a composition on behalf of the chat invoker. See Unit 5.
		if (path === "/api/skills/start" && method === "POST") {
			return startSkillRunService(event);
		}

		// POST /api/skills/complete — service-to-service terminal-state writeback.
		// The agentcore container calls this from its kind="run_skill" branch
		// after run_composition() returns, so skill_runs.status transitions out
		// of `running`. Mirrors the auth + body-shape convention of /start.
		if (path === "/api/skills/complete" && method === "POST") {
			return completeSkillRunService(event);
		}

		return notFound("Route not found");
	} catch (err) {
		console.error("Skills handler error:", err);
		return error("Internal server error", 500);
	}
}

// ---------------------------------------------------------------------------
// Catalog routes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MCP OAuth — RFC 9728 discovery + proxy authorize/callback
// ---------------------------------------------------------------------------

/**
 * Step 1: Browser redirect. Discovers the MCP server's OAuth endpoints,
 * registers a client (or uses cached), and redirects to the authorize URL.
 *
 * GET /api/skills/mcp-oauth/authorize?mcpServerId=X&userId=Y&tenantId=Z
 */
async function mcpOAuthAuthorize(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const qs = event.queryStringParameters || {};
	const { mcpServerId, userId, tenantId } = qs;
	if (!mcpServerId || !userId || !tenantId) {
		return error("mcpServerId, userId, tenantId are required", 400);
	}

	// Look up MCP server + auth config
	const [server] = await db
		.select({ url: tenantMcpServers.url, slug: tenantMcpServers.slug, auth_config: tenantMcpServers.auth_config })
		.from(tenantMcpServers)
		.where(eq(tenantMcpServers.id, mcpServerId));
	if (!server) return error("MCP server not found", 404);

	const authConfig = (server.auth_config as Record<string, string>) || {};
	const apiBaseUrl = `https://${event.headers.host || ""}`;
	const callbackUrl = `${apiBaseUrl}/api/skills/mcp-oauth/callback`;
	const forceRediscovery = qs.force === "true";

	// Always discover via RFC 9728 unless we have cached endpoints AND not forcing rediscovery
	let authorizeEndpoint = (!forceRediscovery && authConfig.authorize_endpoint) || "";
	let tokenEndpoint = (!forceRediscovery && authConfig.token_endpoint) || "";
	let clientId = (!forceRediscovery && authConfig.client_id) || "";
	let registrationEndpoint = "";

	if (!authorizeEndpoint || !tokenEndpoint) {
		// Discover via RFC 9728
		const mcpBaseUrl = server.url.replace(/\/+$/, "");
		const serverPath = new URL(mcpBaseUrl).pathname.replace(/^\//, "");
		const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;

		const resourceRes = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(10000) });
		if (!resourceRes.ok) return error(`Failed to discover OAuth metadata: ${resourceRes.status}`, 502);
		const resourceMeta = await resourceRes.json() as { authorization_servers?: string[] };

		const authServerUrl = resourceMeta.authorization_servers?.[0];
		if (!authServerUrl) return error("No authorization server in resource metadata", 502);

		// Get auth server metadata (RFC 8414 or OIDC discovery)
		const authMetaRes = await fetch(`${authServerUrl}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10000) })
			.catch(() => null);
		const oidcRes = authMetaRes?.ok ? authMetaRes : await fetch(`${authServerUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10000) });
		if (!oidcRes.ok) return error("Failed to discover auth server endpoints", 502);
		const authMeta = await oidcRes.json() as {
			authorization_endpoint: string;
			token_endpoint: string;
			registration_endpoint?: string;
		};

		authorizeEndpoint = authMeta.authorization_endpoint;
		tokenEndpoint = authMeta.token_endpoint;
		if (authMeta.registration_endpoint) registrationEndpoint = authMeta.registration_endpoint;
	}

	// RFC 7591 Dynamic Client Registration — if no client_id and registration endpoint exists
	if (!clientId && registrationEndpoint) {
		const dcrRes = await fetch(registrationEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				client_name: `Thinkwork (${server.slug || "mcp"})`,
				redirect_uris: [callbackUrl],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			}),
			signal: AbortSignal.timeout(10000),
		});
		if (!dcrRes.ok) {
			const body = await dcrRes.text();
			return error(`Dynamic Client Registration failed: ${dcrRes.status} ${body}`, 502);
		}
		const dcrData = await dcrRes.json() as { client_id: string };
		clientId = dcrData.client_id;

		// Cache the discovered endpoints + client_id for next time. This is a
		// system-internal discovery write, not an admin intent change — we
		// also recompute `url_hash` so the row stays approved and the SI-5
		// defensive check in buildMcpConfigs keeps matching. Without the
		// recompute, approved OAuth servers would self-revoke the first
		// time a user initiated OAuth (auth_config drift → hash mismatch).
		const nextAuthConfig = { authorize_endpoint: authorizeEndpoint, token_endpoint: tokenEndpoint, client_id: clientId };
		await db.update(tenantMcpServers).set({
			auth_config: nextAuthConfig,
			url_hash: computeMcpUrlHash(server.url, nextAuthConfig),
			updated_at: new Date(),
		}).where(eq(tenantMcpServers.id, mcpServerId));
	}

	if (!clientId) return error("No client_id — server has no registration endpoint and no client_id configured", 400);
	if (!authorizeEndpoint) return error("Could not resolve authorize endpoint", 502);

	// Generate PKCE code_verifier + code_challenge (required for public clients)
	const { randomBytes, createHash } = await import("crypto");
	const codeVerifier = randomBytes(32).toString("base64url");
	const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

	// Build state (encode context for callback, including PKCE verifier)
	const state = Buffer.from(JSON.stringify({
		mcpServerId,
		userId,
		tenantId,
		tokenEndpoint,
		clientId,
		codeVerifier,
	})).toString("base64url");

	// Redirect to authorize
	const authorizeUrl = new URL(authorizeEndpoint);
	authorizeUrl.searchParams.set("client_id", clientId);
	authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
	authorizeUrl.searchParams.set("response_type", "code");
	authorizeUrl.searchParams.set("scope", "openid email profile offline_access");
	authorizeUrl.searchParams.set("state", state);
	authorizeUrl.searchParams.set("code_challenge", codeChallenge);
	authorizeUrl.searchParams.set("code_challenge_method", "S256");
	// The mobile MCP connect flow uses a persistent ASWebAuthenticationSession
	// cookie jar (no `preferEphemeralSession`) so reconnects reuse the WorkOS
	// session. If the user explicitly clears auth from the server detail
	// screen, `force=true` is set on the authorize URL to bypass the SSO
	// short-circuit server-side. Do NOT re-add `prompt=login` or `max_age=0`
	// here: `max_age=0` is literally unsatisfiable and we hit infinite
	// redirect loops the last two times we shipped it (PR #85, PR #86).

	return {
		statusCode: 302,
		headers: { Location: authorizeUrl.toString() },
		body: "",
	};
}

/**
 * Mobile-app deep link for MCP OAuth completion. The mobile MCP Servers
 * screen opens the OAuth flow via `WebBrowser.openAuthSessionAsync(url,
 * MCP_OAUTH_DEEP_LINK)` (plain 2-arg form, persistent cookie jar), and
 * Expo's ASWebAuthenticationSession watches for ANY redirect to this scheme.
 * As soon as our `mcpOAuthCallback` returns a 302 with `Location:
 * thinkwork://mcp-oauth-complete?...`, the in-app browser auto-closes
 * and the mobile callback receives the result via Expo's promise.
 *
 * Hard-coded `thinkwork` scheme matches `apps/mobile/app.json:scheme`.
 * If we ever ship the app under a different scheme, update both at once.
 */
const MCP_OAUTH_DEEP_LINK = "thinkwork://mcp-oauth-complete";

function deepLinkRedirect(
	status: "success" | "error",
	extras: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
	const params = new URLSearchParams({ status, ...extras });
	return {
		statusCode: 302,
		headers: { Location: `${MCP_OAUTH_DEEP_LINK}?${params.toString()}` },
		body: "",
	};
}

/**
 * Step 2: OAuth callback. Exchanges auth code for tokens, stores in SM,
 * then redirects to the mobile deep link so the in-app auth browser
 * auto-closes (rather than rendering a manual "you can close this
 * window" HTML page that requires a tap to dismiss).
 *
 * GET /api/skills/mcp-oauth/callback?code=X&state=Y
 */
async function mcpOAuthCallback(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const qs = event.queryStringParameters || {};
	const { code, state: stateParam } = qs;
	if (!code || !stateParam) {
		return deepLinkRedirect("error", { reason: "missing_code_or_state" });
	}

	// Decode state
	let state: { mcpServerId: string; userId: string; tenantId: string; tokenEndpoint: string; clientId: string; codeVerifier: string };
	try {
		state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
	} catch {
		return deepLinkRedirect("error", { reason: "invalid_state" });
	}

	const apiBaseUrl = `https://${event.headers.host || ""}`;
	const callbackUrl = `${apiBaseUrl}/api/skills/mcp-oauth/callback`;

	// Exchange code for tokens (public client — PKCE, no client_secret)
	const tokenRes = await fetch(state.tokenEndpoint, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: callbackUrl,
			client_id: state.clientId,
			code_verifier: state.codeVerifier,
		}).toString(),
		signal: AbortSignal.timeout(10000),
	});

	if (!tokenRes.ok) {
		const errBody = await tokenRes.text().catch(() => "");
		console.error(`[mcp-oauth] Token exchange failed: ${tokenRes.status} ${errBody}`);
		return deepLinkRedirect("error", {
			reason: "token_exchange_failed",
			status: String(tokenRes.status),
		});
	}

	const tokenData = await tokenRes.json() as {
		access_token: string;
		refresh_token?: string;
		token_type?: string;
		expires_in?: number;
	};

	// Store in Secrets Manager
	const secretName = `thinkwork/${STAGE}/mcp-tokens/${state.userId}/${state.mcpServerId}`;
	const secretValue = JSON.stringify({
		access_token: tokenData.access_token,
		refresh_token: tokenData.refresh_token || null,
		token_type: tokenData.token_type || "Bearer",
		obtained_at: new Date().toISOString(),
	});

	try {
		await sm.send(new UpdateSecretCommand({ SecretId: secretName, SecretString: secretValue }));
	} catch (err: any) {
		if (err instanceof ResourceNotFoundException) {
			await sm.send(new CreateSecretCommand({ Name: secretName, SecretString: secretValue }));
		} else {
			throw err;
		}
	}

	// Upsert user_mcp_tokens row
	const { userMcpTokens } = await import("@thinkwork/database-pg/schema");
	const expiresAt = tokenData.expires_in
		? new Date(Date.now() + tokenData.expires_in * 1000)
		: null;

	const [existing] = await db
		.select({ id: userMcpTokens.id })
		.from(userMcpTokens)
		.where(and(eq(userMcpTokens.user_id, state.userId), eq(userMcpTokens.mcp_server_id, state.mcpServerId)));

	if (existing) {
		await db.update(userMcpTokens).set({
			secret_ref: secretName,
			expires_at: expiresAt,
			status: "active",
			updated_at: new Date(),
		}).where(eq(userMcpTokens.id, existing.id));
	} else {
		await db.insert(userMcpTokens).values({
			user_id: state.userId,
			tenant_id: state.tenantId,
			mcp_server_id: state.mcpServerId,
			secret_ref: secretName,
			expires_at: expiresAt,
			status: "active",
		});
	}

	console.log(`[mcp-oauth] Token stored for user ${state.userId}, MCP server ${state.mcpServerId}`);

	// Redirect to the mobile deep link — ASWebAuthenticationSession on
	// the mobile side detects the `thinkwork://` scheme and auto-closes
	// the in-app browser, returning control to the MCP Servers screen.
	return deepLinkRedirect("success");
}

// ---------------------------------------------------------------------------
// Catalog routes
// ---------------------------------------------------------------------------

async function getCatalogIndex(): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db.select().from(skillCatalog).execute();
	return json(
		rows.map((r) => ({
			slug: r.slug,
			name: r.display_name,
			description: r.description,
			category: r.category,
			version: r.version,
			author: r.author,
			icon: r.icon,
			tags: r.tags || [],
			source: r.source,
			is_default: r.is_default,
			execution: r.execution,
			requires_env: r.requires_env || [],
			oauth_provider: r.oauth_provider,
			oauth_scopes: r.oauth_scopes || [],
			mcp_server: r.mcp_server,
			mcp_tools: r.mcp_tools || [],
			dependencies: r.dependencies || [],
			triggers: r.triggers || [],
		})),
	);
}

async function getCatalogSkill(
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const yamlText = await getS3Text(`${CATALOG_PREFIX}/${slug}/skill.yaml`);
	if (!yamlText) return notFound("Skill not found");
	const parsed = parseYaml(yamlText) as Record<string, unknown>;
	// Normalize display_name → name for API consumers
	if (parsed.display_name && !parsed.name) {
		parsed.name = parsed.display_name;
	}
	return json(parsed);
}

async function listCatalogFiles(
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const prefix = `${CATALOG_PREFIX}/${slug}/`;
	const files = await listS3Keys(prefix);
	// Return paths relative to skill root
	return json(files.map((f) => f.slice(prefix.length)));
}

async function getCatalogFile(
	slug: string,
	filePath: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const content = await getS3Text(`${CATALOG_PREFIX}/${slug}/${filePath}`);
	if (content === null) return notFound("File not found");
	return json({ path: filePath, content });
}

// ---------------------------------------------------------------------------
// Tenant routes
// ---------------------------------------------------------------------------

function tenantSkillsPrefix(tenantSlug: string) {
	return `tenants/${tenantSlug}/skills`;
}

async function getTenantSkills(
	tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Auto-provision built-in skills (PRD-31)
	await ensureBuiltinSkills(tenantId);

	// Read from DB
	const rows = await db
		.select({
			skill_id: tenantSkills.skill_id,
			source: tenantSkills.source,
			version: tenantSkills.version,
			catalog_version: tenantSkills.catalog_version,
			enabled: tenantSkills.enabled,
			installed_at: tenantSkills.installed_at,
			// Join with catalog for metadata
			name: skillCatalog.display_name,
			description: skillCatalog.description,
			category: skillCatalog.category,
			icon: skillCatalog.icon,
			execution: skillCatalog.execution,
			is_default: skillCatalog.is_default,
			oauth_provider: skillCatalog.oauth_provider,
			mcp_server: skillCatalog.mcp_server,
			triggers: skillCatalog.triggers,
		})
		.from(tenantSkills)
		.leftJoin(skillCatalog, eq(tenantSkills.skill_id, skillCatalog.slug))
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.enabled, true),
			),
		)
		.execute();

	return json(
		rows.map((r) => ({
			slug: r.skill_id,
			name: r.name || r.skill_id,
			description: r.description,
			category: r.category,
			version: r.version,
			icon: r.icon,
			source: r.source,
			execution: r.execution,
			is_default: r.is_default,
			catalogVersion: r.catalog_version,
			oauthProvider: r.oauth_provider,
			mcpServer: r.mcp_server,
			triggers: r.triggers || [],
			installedAt: r.installed_at?.toISOString(),
		})),
	);
}

async function installSkill(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Verify skill exists in catalog
	const yamlText = await getS3Text(`${CATALOG_PREFIX}/${slug}/skill.yaml`);
	if (!yamlText) return notFound("Skill not found in catalog");

	// List all catalog files for this skill
	const catalogPrefix = `${CATALOG_PREFIX}/${slug}/`;
	const files = await listS3Keys(catalogPrefix);

	// Copy each file to tenant prefix (editable copy)
	const tenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	for (const key of files) {
		const relativePath = key.slice(catalogPrefix.length);
		await s3.send(
			new CopyObjectCommand({
				Bucket: BUCKET,
				CopySource: `${BUCKET}/${key}`,
				Key: `${tenantPrefix}${relativePath}`,
			}),
		);
	}

	// Get catalog version for tracking
	const [catalogEntry] = await db
		.select({ version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);
	const catalogVersion = catalogEntry?.version;

	const meta = parseYaml(yamlText);

	// Upsert into tenant_skills DB (PRD-31)
	await db
		.insert(tenantSkills)
		.values({
			tenant_id: tenantId,
			skill_id: slug,
			source: "catalog",
			version: meta.version || "1.0.0",
			catalog_version: catalogVersion || meta.version || "1.0.0",
			enabled: true,
			updated_at: new Date(),
		})
		.onConflictDoUpdate({
			target: [tenantSkills.tenant_id, tenantSkills.skill_id],
			set: {
				source: "catalog",
				version: meta.version || "1.0.0",
				catalog_version: catalogVersion || meta.version || "1.0.0",
				enabled: true,
				updated_at: new Date(),
			},
		});

	// Also update S3 installed.json (backward compat during migration)
	const installedRaw = await getS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
	);
	const installed: Array<Record<string, unknown>> = installedRaw
		? JSON.parse(installedRaw)
		: [];
	const filtered = installed.filter((s) => s.slug !== slug);
	filtered.push({
		slug: meta.slug,
		name: meta.name,
		description: meta.description,
		category: meta.category,
		version: meta.version,
		icon: meta.icon,
		installedAt: new Date().toISOString(),
	});
	await putS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
		JSON.stringify(filtered, null, 2),
	);

	// --- Dependency resolution ---
	const [catalogEntry2] = await db
		.select({ dependencies: skillCatalog.dependencies })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);

	const deps = catalogEntry2?.dependencies || [];
	const dependenciesInstalled: string[] = [];

	if (deps.length > 0) {
		const installing = new Set<string>([slug]);
		await resolveDependencies(tenantId, tenantSlug, deps, installing, dependenciesInstalled);
	}

	return json({ success: true, slug, dependenciesInstalled });
}

/** Recursively install missing dependencies with cycle detection */
async function resolveDependencies(
	tenantId: string,
	tenantSlug: string,
	deps: string[],
	installing: Set<string>,
	installed: string[],
): Promise<void> {
	for (const depSlug of deps) {
		if (installing.has(depSlug)) {
			throw new Error(`Circular dependency detected: ${depSlug}`);
		}
		installing.add(depSlug);

		// Check if already installed and enabled
		const [existing] = await db
			.select({ enabled: tenantSkills.enabled })
			.from(tenantSkills)
			.where(
				and(
					eq(tenantSkills.tenant_id, tenantId),
					eq(tenantSkills.skill_id, depSlug),
					eq(tenantSkills.enabled, true),
				),
			)
			.limit(1);

		if (!existing) {
			// Auto-install the dependency
			const depYaml = await getS3Text(`${CATALOG_PREFIX}/${depSlug}/skill.yaml`);
			if (!depYaml) continue; // skip if not in catalog

			const depCatalogPrefix = `${CATALOG_PREFIX}/${depSlug}/`;
			const depFiles = await listS3Keys(depCatalogPrefix);
			const depTenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${depSlug}/`;

			for (const key of depFiles) {
				const relativePath = key.slice(depCatalogPrefix.length);
				await s3.send(
					new CopyObjectCommand({
						Bucket: BUCKET,
						CopySource: `${BUCKET}/${key}`,
						Key: `${depTenantPrefix}${relativePath}`,
					}),
				);
			}

			const depMeta = parseYaml(depYaml);
			const [depCatalogEntry] = await db
				.select({ version: skillCatalog.version })
				.from(skillCatalog)
				.where(eq(skillCatalog.slug, depSlug))
				.limit(1);

			await db
				.insert(tenantSkills)
				.values({
					tenant_id: tenantId,
					skill_id: depSlug,
					source: "catalog",
					version: depMeta.version || "1.0.0",
					catalog_version: depCatalogEntry?.version || depMeta.version || "1.0.0",
					enabled: true,
					updated_at: new Date(),
				})
				.onConflictDoUpdate({
					target: [tenantSkills.tenant_id, tenantSkills.skill_id],
					set: {
						source: "catalog",
						version: depMeta.version || "1.0.0",
						catalog_version: depCatalogEntry?.version || depMeta.version || "1.0.0",
						enabled: true,
						updated_at: new Date(),
					},
				});

			installed.push(depSlug);

			// Recursively resolve transitive dependencies
			const [depCatalog] = await db
				.select({ dependencies: skillCatalog.dependencies })
				.from(skillCatalog)
				.where(eq(skillCatalog.slug, depSlug))
				.limit(1);
			const transitiveDeps = depCatalog?.dependencies || [];
			if (transitiveDeps.length > 0) {
				await resolveDependencies(tenantId, tenantSlug, transitiveDeps, installing, installed);
			}
		}
	}
}

async function getTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const content = await getS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`,
	);
	if (content === null) return notFound("File not found");
	return json({ path: filePath, content });
}

async function saveTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	if (typeof body.content !== "string")
		return error("content (string) is required");

	await putS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`,
		body.content,
	);
	return json({ success: true, path: filePath });
}

// ---------------------------------------------------------------------------
// PRD-31 Phase 3: Tenant-uploadable custom skills
// ---------------------------------------------------------------------------

const SKILL_YAML_TEMPLATE = `slug: {{slug}}
display_name: {{name}}
description: {{description}}
category: custom
version: "1.0.0"
author: tenant
icon: zap
tags: []
execution: context
triggers: []
`;

const SKILL_MD_TEMPLATE = `---
name: {{slug}}
description: >
  {{description}}
license: Proprietary
metadata:
  author: tenant
  version: "1.0.0"
---

# {{name}}

## Overview

Describe what this skill does and when to use it.

## Instructions

Add your skill instructions here. Keep this file under 200 lines.
Move detailed reference material to the references/ folder.
`;

async function createTenantSkill(
	tenantSlug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const body = JSON.parse(event.body || "{}");
	const { name, slug: rawSlug, description } = body;
	if (!name) return error("name is required", 400);

	// Generate slug from name if not provided
	const slug = rawSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
	if (!slug) return error("Could not generate slug from name", 400);

	// Check for collision with catalog skills
	const [existing] = await db
		.select({ slug: skillCatalog.slug })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);
	if (existing) return error(`Slug '${slug}' conflicts with a catalog skill`, 409);

	// Check for collision with tenant skills
	const [existingTenant] = await db
		.select({ skill_id: tenantSkills.skill_id })
		.from(tenantSkills)
		.where(and(eq(tenantSkills.tenant_id, tenantId), eq(tenantSkills.skill_id, slug)))
		.limit(1);
	if (existingTenant) return error(`Skill '${slug}' already exists for this tenant`, 409);

	const desc = description || `Custom skill: ${name}`;
	const prefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}`;

	// Create skill.yaml from template
	const yamlContent = SKILL_YAML_TEMPLATE
		.replace(/\{\{slug\}\}/g, slug)
		.replace(/\{\{name\}\}/g, name)
		.replace(/\{\{description\}\}/g, desc);
	await putS3Text(`${prefix}/skill.yaml`, yamlContent);

	// Create SKILL.md from template
	const mdContent = SKILL_MD_TEMPLATE
		.replace(/\{\{slug\}\}/g, slug)
		.replace(/\{\{name\}\}/g, name)
		.replace(/\{\{description\}\}/g, desc);
	await putS3Text(`${prefix}/SKILL.md`, mdContent);

	// Insert into tenant_skills
	await db.insert(tenantSkills).values({
		tenant_id: tenantId,
		skill_id: slug,
		source: "tenant",
		version: "1.0.0",
		enabled: true,
	}).onConflictDoNothing();

	return json({ success: true, slug, files: ["skill.yaml", "SKILL.md"] });
}

async function getUploadUrl(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Generate a presigned URL for the tenant to upload a skill zip
	const key = `${tenantSkillsPrefix(tenantSlug)}/${slug}/_upload.zip`;
	const command = new PutObjectCommand({
		Bucket: BUCKET,
		Key: key,
		ContentType: "application/zip",
	});
	const url = await getSignedUrl(s3, command, { expiresIn: 300 });
	return json({ uploadUrl: url, key });
}

async function listTenantSkillFiles(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const prefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	const files = await listS3Keys(prefix);
	// Return paths relative to skill root, filter out upload artifacts
	return json(
		files
			.map((f) => f.slice(prefix.length))
			.filter((f) => !f.startsWith("_upload") && f.length > 0),
	);
}

async function createTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const content = typeof body.content === "string" ? body.content : "";

	// Validate: Python scripts only
	if (filePath.startsWith("scripts/") && !filePath.endsWith(".py")) {
		return error("Only Python (.py) scripts are allowed", 400);
	}

	const key = `${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`;

	// Check if file already exists
	const existing = await getS3Text(key);
	if (existing !== null) {
		return error(`File '${filePath}' already exists. Use PUT to update.`, 409);
	}

	await putS3Text(key, content);
	return json({ success: true, path: filePath, created: true });
}

async function deleteTenantFile(
	tenantSlug: string,
	slug: string,
	filePath: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Don't allow deleting skill.yaml — it's required
	if (filePath === "skill.yaml") {
		return error("Cannot delete skill.yaml — it is required", 400);
	}

	const key = `${tenantSkillsPrefix(tenantSlug)}/${slug}/${filePath}`;
	await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
	return json({ success: true, path: filePath, deleted: true });
}

async function uninstallSkill(
	tenantSlug: string,
	slug: string,
	force = false,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);

	// Check for dependents before uninstalling
	if (tenantId && !force) {
		// Get all installed tenant skills
		const installedRows = await db
			.select({ skill_id: tenantSkills.skill_id })
			.from(tenantSkills)
			.where(
				and(
					eq(tenantSkills.tenant_id, tenantId),
					eq(tenantSkills.enabled, true),
				),
			);

		// For each installed skill, check if it depends on the skill being uninstalled
		const dependents: string[] = [];
		for (const row of installedRows) {
			if (row.skill_id === slug) continue;
			const [catalogRow] = await db
				.select({ dependencies: skillCatalog.dependencies })
				.from(skillCatalog)
				.where(eq(skillCatalog.slug, row.skill_id))
				.limit(1);
			const deps = catalogRow?.dependencies || [];
			if (deps.includes(slug)) {
				dependents.push(row.skill_id);
			}
		}

		if (dependents.length > 0) {
			return json({ hasDependents: true, dependents }, 409);
		}
	}

	// Soft-disable in DB (PRD-31)
	if (tenantId) {
		await db
			.update(tenantSkills)
			.set({ enabled: false, updated_at: new Date() })
			.where(
				and(
					eq(tenantSkills.tenant_id, tenantId),
					eq(tenantSkills.skill_id, slug),
				),
			);
	}

	// Delete all files under tenant skill prefix
	const prefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	const keys = await listS3Keys(prefix);
	for (const key of keys) {
		await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
	}

	// Update installed.json (backward compat)
	const installedRaw = await getS3Text(
		`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
	);
	if (installedRaw) {
		const installed: Array<Record<string, unknown>> = JSON.parse(installedRaw);
		const filtered = installed.filter((s) => s.slug !== slug);
		await putS3Text(
			`${tenantSkillsPrefix(tenantSlug)}/installed.json`,
			JSON.stringify(filtered, null, 2),
		);
	}

	return json({ success: true, slug });
}

// ---------------------------------------------------------------------------
// Agent-level skill install
// ---------------------------------------------------------------------------

async function installSkillToAgent(
	tenantSlug: string,
	agentSlug: string,
	skillSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	// Verify skill exists in catalog
	const yamlText = await getS3Text(`${CATALOG_PREFIX}/${skillSlug}/skill.yaml`);
	if (!yamlText) return notFound("Skill not found in catalog");

	// List all catalog files for this skill
	const catalogPrefix = `${CATALOG_PREFIX}/${skillSlug}/`;
	const files = await listS3Keys(catalogPrefix);

	// Copy each file to agent-level prefix
	const agentPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/skills/${skillSlug}/`;
	for (const key of files) {
		const relativePath = key.slice(catalogPrefix.length);
		await s3.send(
			new CopyObjectCommand({
				Bucket: BUCKET,
				CopySource: `${BUCKET}/${key}`,
				Key: `${agentPrefix}${relativePath}`,
			}),
		);
	}

	return json({ success: true, slug: skillSlug });
}

// ---------------------------------------------------------------------------
// Agent skill credentials
// ---------------------------------------------------------------------------

async function saveSkillCredentials(
	agentId: string,
	skillId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const env = body.env;
	if (!env || typeof env !== "object" || Object.keys(env).length === 0) {
		return error("env object with at least one key is required", 400);
	}

	const secretName = `thinkwork/${STAGE}/agent-skills/${agentId}/${skillId}`;
	const secretValue = JSON.stringify({ type: "skillEnv", env });

	let secretArn: string;
	try {
		// Try to update existing secret first
		const res = await sm.send(
			new UpdateSecretCommand({
				SecretId: secretName,
				SecretString: secretValue,
			}),
		);
		secretArn = res.ARN!;
	} catch (err: any) {
		if (err instanceof ResourceNotFoundException) {
			// Create new secret
			const res = await sm.send(
				new CreateSecretCommand({
					Name: secretName,
					SecretString: secretValue,
				}),
			);
			secretArn = res.ARN!;
		} else {
			throw err;
		}
	}

	// Update agent_skills.config with secretRef
	const [existing] = await db
		.select({ id: agentSkills.id, config: agentSkills.config })
		.from(agentSkills)
		.where(
			and(
				eq(agentSkills.agent_id, agentId),
				eq(agentSkills.skill_id, skillId),
			),
		);

	if (!existing) {
		return error("Skill not attached to this agent", 404);
	}

	const currentConfig = (existing.config as Record<string, unknown>) || {};
	await db
		.update(agentSkills)
		.set({ config: { ...currentConfig, secretRef: secretArn } })
		.where(eq(agentSkills.id, existing.id));

	return json({ ok: true, secretRef: secretArn });
}

// ---------------------------------------------------------------------------
// MCP Server — Tenant Registry (uses tenant_mcp_servers table)
// ---------------------------------------------------------------------------

async function mcpListTenantServers(
	tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const rows = await db
		.select()
		.from(tenantMcpServers)
		.where(eq(tenantMcpServers.tenant_id, tenantId));

	return json({
		servers: rows.map((r) => ({
			id: r.id,
			name: r.name,
			slug: r.slug,
			url: r.url,
			transport: r.transport,
			authType: r.auth_type,
			oauthProvider: r.oauth_provider,
			tools: r.tools,
			enabled: r.enabled,
			// Plan §U11 admin-approval metadata. Existing rows default to
			// 'approved' so the admin UI can filter without bespoke
			// migration logic on the client.
			status: r.status,
			urlHash: r.url_hash,
			approvedBy: r.approved_by,
			approvedAt: r.approved_at,
			createdAt: r.created_at,
		})),
	});
}

async function mcpRegisterServer(
	tenantSlug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const body = JSON.parse(event.body || "{}");
	const { name, url, transport, authType, apiKey, oauthProvider } = body;

	if (!name || !url) return error("name and url are required", 400);

	const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
		return error("name must be lowercase alphanumeric with hyphens", 400);
	}

	// Store API key in Secrets Manager if provided
	let authConfig: Record<string, unknown> | null = null;
	if (authType === "tenant_api_key" && apiKey) {
		const secretName = `thinkwork/${STAGE}/mcp/${tenantId}/${slug}`;
		const secretValue = JSON.stringify({ type: "mcpApiKey", token: apiKey });
		try {
			await sm.send(new UpdateSecretCommand({ SecretId: secretName, SecretString: secretValue }));
		} catch (err: any) {
			if (err instanceof ResourceNotFoundException) {
				await sm.send(new CreateSecretCommand({ Name: secretName, SecretString: secretValue }));
			} else {
				throw err;
			}
		}
		authConfig = { secretRef: secretName, token: apiKey };
	}

	// Check for existing
	const [existing] = await db
		.select({ id: tenantMcpServers.id })
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.tenant_id, tenantId), eq(tenantMcpServers.slug, slug)));

	if (existing) {
		// SI-5: route through applyMcpServerFieldUpdate so url/auth_config
		// changes on an approved row revert the approval. Echo the
		// revert flag so the admin CLI / SPA can surface the state change.
		const { revertedToPending } = await applyMcpServerFieldUpdate(db, existing.id, {
			name,
			url,
			transport: transport || "streamable-http",
			auth_type: authType || "none",
			auth_config: authConfig,
			oauth_provider: oauthProvider || null,
		});
		return json({ id: existing.id, slug, updated: true, revertedToPending });
	}

	const [inserted] = await db
		.insert(tenantMcpServers)
		.values({
			tenant_id: tenantId,
			name,
			slug,
			url,
			transport: transport || "streamable-http",
			auth_type: authType || "none",
			auth_config: authConfig,
			oauth_provider: oauthProvider || null,
		})
		.returning({ id: tenantMcpServers.id });

	return json({ id: inserted.id, slug, created: true });
}

/**
 * Short-circuit non-UUID path params so Postgres's UUID column doesn't throw
 * `invalid input syntax for type uuid` and bubble up as a 500. CLI users who
 * pass a slug to these endpoints should get a clean 404 pointing them at
 * `mcp list` — not an opaque server error.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(serverId: string): APIGatewayProxyStructuredResultV2 | null {
	if (UUID_RE.test(serverId)) return null;
	return notFound(
		`MCP server not found — path param must be a UUID (got "${serverId}"). Use \`thinkwork mcp list\` to see IDs, or pass a slug/name to the CLI which will resolve it client-side.`,
	);
}

async function mcpUpdateServer(
	tenantSlug: string,
	serverId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const badUuid = requireUuid(serverId);
	if (badUuid) return badUuid;
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const body = JSON.parse(event.body || "{}");

	// Confirm the row belongs to this tenant before mutating. The
	// applyMcpServerFieldUpdate helper is tenant-agnostic (matches on
	// id only), so enforce the tenant match here.
	const [existing] = await db
		.select({ id: tenantMcpServers.id })
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, serverId), eq(tenantMcpServers.tenant_id, tenantId)))
		.limit(1);
	if (!existing) return notFound("MCP server not found");

	const { revertedToPending } = await applyMcpServerFieldUpdate(db, serverId, {
		name: body.name,
		url: body.url,
		transport: body.transport,
		auth_config: body.auth_config,
		enabled: body.enabled,
	});

	return json({ ok: true, id: serverId, revertedToPending });
}

async function mcpDeleteServer(
	tenantSlug: string,
	serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const badUuid = requireUuid(serverId);
	if (badUuid) return badUuid;
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Delete agent assignments first (cascade)
	await db
		.delete(agentMcpServers)
		.where(eq(agentMcpServers.mcp_server_id, serverId));

	const deleted = await db
		.delete(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, serverId), eq(tenantMcpServers.tenant_id, tenantId)))
		.returning({ id: tenantMcpServers.id });

	if (deleted.length === 0) return notFound("MCP server not found");
	return json({ ok: true, deleted: serverId });
}

async function mcpTestConnection(
	tenantSlug: string,
	serverId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const badUuid = requireUuid(serverId);
	if (badUuid) return badUuid;
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const [row] = await db
		.select()
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, serverId), eq(tenantMcpServers.tenant_id, tenantId)));

	if (!row) return notFound("MCP server not found");

	// Build auth headers
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (row.auth_type === "tenant_api_key") {
		const authCfg = (row.auth_config as Record<string, unknown>) || {};
		const token = authCfg.token as string;
		if (token) headers["Authorization"] = `Bearer ${token}`;
	}

	try {
		const response = await fetch(row.url, {
			method: "POST",
			headers,
			body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			return json({ ok: false, error: `MCP server returned ${response.status}` }, 502);
		}

		const result = await response.json() as {
			result?: { tools?: Array<{ name: string; description?: string }> };
			error?: unknown;
		};
		if (result.error) {
			return json({ ok: false, error: result.error }, 502);
		}

		const tools = (result.result?.tools || []).map((t) => ({
			name: t.name,
			description: t.description,
		}));

		// Cache discovered tools in DB
		await db
			.update(tenantMcpServers)
			.set({ tools, updated_at: new Date() })
			.where(eq(tenantMcpServers.id, serverId));

		return json({ ok: true, tools });
	} catch (err: any) {
		return json({ ok: false, error: err.message || "Connection failed" }, 502);
	}
}

// ---------------------------------------------------------------------------
// MCP Server — Agent Assignment (uses agent_mcp_servers table)
// ---------------------------------------------------------------------------

async function mcpListAgentServers(
	agentId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select({
			id: agentMcpServers.id,
			mcp_server_id: agentMcpServers.mcp_server_id,
			enabled: agentMcpServers.enabled,
			config: agentMcpServers.config,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			transport: tenantMcpServers.transport,
			auth_type: tenantMcpServers.auth_type,
			oauth_provider: tenantMcpServers.oauth_provider,
			tools: tenantMcpServers.tools,
			server_enabled: tenantMcpServers.enabled,
		})
		.from(agentMcpServers)
		.innerJoin(tenantMcpServers, eq(agentMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(eq(agentMcpServers.agent_id, agentId));

	return json({
		servers: rows.map((r) => ({
			id: r.id,
			mcpServerId: r.mcp_server_id,
			name: r.name,
			slug: r.slug,
			url: r.url,
			transport: r.transport,
			authType: r.auth_type,
			oauthProvider: r.oauth_provider,
			tools: r.tools,
			enabled: r.enabled && r.server_enabled,
			config: r.config,
		})),
	});
}

async function mcpAssignToAgent(
	agentId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { mcpServerId, config } = body;

	if (!mcpServerId) return error("mcpServerId is required", 400);

	// Resolve agent's tenant_id
	const { agents } = await import("@thinkwork/database-pg/schema");
	const [agentRow] = await db
		.select({ tenant_id: agents.tenant_id })
		.from(agents)
		.where(eq(agents.id, agentId));
	if (!agentRow) return error("Agent not found", 404);

	// Verify MCP server belongs to same tenant
	const [server] = await db
		.select({ id: tenantMcpServers.id })
		.from(tenantMcpServers)
		.where(and(eq(tenantMcpServers.id, mcpServerId), eq(tenantMcpServers.tenant_id, agentRow.tenant_id)));
	if (!server) return error("MCP server not found in this tenant", 404);

	// Upsert
	const [existing] = await db
		.select({ id: agentMcpServers.id })
		.from(agentMcpServers)
		.where(and(eq(agentMcpServers.agent_id, agentId), eq(agentMcpServers.mcp_server_id, mcpServerId)));

	if (existing) {
		await db
			.update(agentMcpServers)
			.set({ enabled: true, config: config || null, updated_at: new Date() })
			.where(eq(agentMcpServers.id, existing.id));
		return json({ id: existing.id, updated: true });
	}

	const [inserted] = await db
		.insert(agentMcpServers)
		.values({
			agent_id: agentId,
			tenant_id: agentRow.tenant_id,
			mcp_server_id: mcpServerId,
			config: config || null,
		})
		.returning({ id: agentMcpServers.id });

	return json({ id: inserted.id, created: true });
}

async function mcpUnassignFromAgent(
	agentId: string,
	mcpServerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const deleted = await db
		.delete(agentMcpServers)
		.where(and(eq(agentMcpServers.agent_id, agentId), eq(agentMcpServers.mcp_server_id, mcpServerId)))
		.returning({ id: agentMcpServers.id });

	if (deleted.length === 0) return notFound("MCP server assignment not found");
	return json({ ok: true });
}

// ---------------------------------------------------------------------------
// MCP Server — OAuth Providers + User View
// ---------------------------------------------------------------------------

async function mcpGetTemplateMcpServers(
	templateId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const rows = await db
		.select({
			id: agentTemplateMcpServers.id,
			mcp_server_id: agentTemplateMcpServers.mcp_server_id,
			enabled: agentTemplateMcpServers.enabled,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			auth_type: tenantMcpServers.auth_type,
		})
		.from(agentTemplateMcpServers)
		.innerJoin(tenantMcpServers, eq(agentTemplateMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(eq(agentTemplateMcpServers.template_id, templateId));

	return json({
		mcpServers: rows.map((r) => ({
			mcp_server_id: r.mcp_server_id,
			enabled: r.enabled,
			name: r.name,
			slug: r.slug,
			url: r.url,
			authType: r.auth_type,
		})),
	});
}

async function mcpAssignToTemplate(
	templateId: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const body = JSON.parse(event.body || "{}");
	const { mcpServerId } = body;
	if (!mcpServerId) return error("mcpServerId is required", 400);

	// Resolve tenant_id from template
	const { agentTemplates } = await import("@thinkwork/database-pg/schema");
	const [template] = await db
		.select({ tenant_id: agentTemplates.tenant_id })
		.from(agentTemplates)
		.where(eq(agentTemplates.id, templateId));
	if (!template) return error("Template not found", 404);

	// Upsert
	const [existing] = await db
		.select({ id: agentTemplateMcpServers.id })
		.from(agentTemplateMcpServers)
		.where(and(eq(agentTemplateMcpServers.template_id, templateId), eq(agentTemplateMcpServers.mcp_server_id, mcpServerId)));

	if (existing) {
		await db
			.update(agentTemplateMcpServers)
			.set({ enabled: true, updated_at: new Date() })
			.where(eq(agentTemplateMcpServers.id, existing.id));
		return json({ id: existing.id, updated: true });
	}

	const [inserted] = await db
		.insert(agentTemplateMcpServers)
		.values({
			template_id: templateId,
			tenant_id: template.tenant_id!,
			mcp_server_id: mcpServerId,
		})
		.returning({ id: agentTemplateMcpServers.id });

	return json({ id: inserted.id, created: true });
}

async function mcpUnassignFromTemplate(
	templateId: string,
	mcpServerId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const deleted = await db
		.delete(agentTemplateMcpServers)
		.where(and(eq(agentTemplateMcpServers.template_id, templateId), eq(agentTemplateMcpServers.mcp_server_id, mcpServerId)))
		.returning({ id: agentTemplateMcpServers.id });

	if (deleted.length === 0) return notFound("MCP server not assigned to template");
	return json({ ok: true });
}

async function mcpListOAuthProviders(): Promise<APIGatewayProxyStructuredResultV2> {
	const { connectProviders } = await import("@thinkwork/database-pg/schema");
	const rows = await db
		.select({
			id: connectProviders.id,
			name: connectProviders.name,
			display_name: connectProviders.display_name,
			provider_type: connectProviders.provider_type,
			is_available: connectProviders.is_available,
		})
		.from(connectProviders)
		.where(eq(connectProviders.is_available, true));

	return json({
		providers: rows.map((r) => ({
			id: r.id,
			name: r.name,
			displayName: r.display_name,
			providerType: r.provider_type,
		})),
	});
}

async function mcpClearUserToken(
	userId: string,
	tenantId: string,
	mcpServerId: string,
) {
	const { userMcpTokens } = await import("@thinkwork/database-pg/schema");

	// Find the token row
	const [tokenRow] = await db
		.select({ id: userMcpTokens.id, secret_ref: userMcpTokens.secret_ref })
		.from(userMcpTokens)
		.where(and(
			eq(userMcpTokens.user_id, userId),
			eq(userMcpTokens.mcp_server_id, mcpServerId),
		));

	if (!tokenRow) {
		return json({ ok: true, message: "No token found" });
	}

	// Delete the secret from Secrets Manager if it exists
	if (tokenRow.secret_ref) {
		try {
			const { SecretsManagerClient, DeleteSecretCommand } = await import("@aws-sdk/client-secrets-manager");
			const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
			await sm.send(new DeleteSecretCommand({
				SecretId: tokenRow.secret_ref,
				ForceDeleteWithoutRecovery: true,
			}));
		} catch (err) {
			console.warn("[mcp-clear-token] Failed to delete secret:", (err as Error).message);
		}
	}

	// Delete the token row
	await db.delete(userMcpTokens).where(eq(userMcpTokens.id, tokenRow.id));

	return json({ ok: true, cleared: true });
}

async function mcpListUserServers(
	tenantId: string,
	userId: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const { agents, userMcpTokens } = await import("@thinkwork/database-pg/schema");

	// Find all agents paired with this user
	const userAgents = await db
		.select({ id: agents.id, name: agents.name })
		.from(agents)
		.where(and(eq(agents.tenant_id, tenantId), eq(agents.human_pair_id, userId)));

	if (userAgents.length === 0) {
		return json({ servers: [] });
	}

	const agentIds = userAgents.map((a) => a.id);

	// Get all MCP servers assigned to these agents
	const rows = await db
		.select({
			assignment_id: agentMcpServers.id,
			agent_id: agentMcpServers.agent_id,
			mcp_server_id: agentMcpServers.mcp_server_id,
			enabled: agentMcpServers.enabled,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			auth_type: tenantMcpServers.auth_type,
			tools: tenantMcpServers.tools,
			server_enabled: tenantMcpServers.enabled,
		})
		.from(agentMcpServers)
		.innerJoin(tenantMcpServers, eq(agentMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(inArray(agentMcpServers.agent_id, agentIds));

	// For OAuth servers, check if user has an active token in user_mcp_tokens
	const oauthServerIds = rows.filter((r) => r.auth_type === "oauth" || r.auth_type === "per_user_oauth").map((r) => r.mcp_server_id);

	const userTokens = oauthServerIds.length > 0
		? await db
			.select({
				mcp_server_id: userMcpTokens.mcp_server_id,
				status: userMcpTokens.status,
			})
			.from(userMcpTokens)
			.where(and(
				eq(userMcpTokens.user_id, userId),
				eq(userMcpTokens.tenant_id, tenantId),
			))
		: [];

	const tokenByServer = new Map(userTokens.map((t) => [t.mcp_server_id, t]));

	// Deduplicate MCP servers (same server may be assigned to multiple agents)
	const seen = new Set<string>();
	const servers = rows
		.filter((r) => {
			if (seen.has(r.mcp_server_id)) return false;
			seen.add(r.mcp_server_id);
			return true;
		})
		.map((r) => {
			let authStatus: "active" | "not_connected" | "expired" = "active";
			if (r.auth_type === "oauth" || r.auth_type === "per_user_oauth") {
				const tok = tokenByServer.get(r.mcp_server_id);
				if (!tok) authStatus = "not_connected";
				else if (tok.status !== "active") authStatus = "expired";
			}
			const agentName = userAgents.find((a) => a.id === r.agent_id)?.name;
			return {
				id: r.mcp_server_id,
				name: r.name,
				slug: r.slug,
				url: r.url,
				authType: r.auth_type,
				tools: r.tools,
				enabled: r.enabled && r.server_enabled,
				authStatus,
				agentName,
			};
		});

	return json({ servers });
}

// ---------------------------------------------------------------------------
// Built-in Tools — tenant-level config for catalog skills (web-search, …)
// ---------------------------------------------------------------------------

const BUILTIN_TOOL_CATALOG: Record<string, { providers: string[]; keyEnvVar: Record<string, string> }> = {
	"web-search": {
		providers: ["exa", "serpapi"],
		keyEnvVar: { exa: "EXA_API_KEY", serpapi: "SERPAPI_KEY" },
	},
};

function builtinToolSecretName(tenantId: string, slug: string): string {
	return `thinkwork/${STAGE}/tenant/${tenantId}/builtin/${slug}`;
}

async function builtinToolsList(
	tenantSlug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const rows = await db
		.select()
		.from(tenantBuiltinTools)
		.where(eq(tenantBuiltinTools.tenant_id, tenantId));

	return json({
		tools: rows.map((r) => ({
			id: r.id,
			toolSlug: r.tool_slug,
			provider: r.provider,
			enabled: r.enabled,
			config: r.config,
			hasSecret: !!r.secret_ref,
			lastTestedAt: r.last_tested_at,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		})),
	});
}

async function builtinToolsUpsert(
	tenantSlug: string,
	slug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const catalogEntry = BUILTIN_TOOL_CATALOG[slug];
	if (!catalogEntry) return error(`Unknown built-in tool '${slug}'`, 400);

	const body = JSON.parse(event.body || "{}") as {
		provider?: string;
		enabled?: boolean;
		config?: Record<string, unknown>;
		apiKey?: string;
	};

	if (body.provider && !catalogEntry.providers.includes(body.provider)) {
		return error(
			`provider must be one of ${catalogEntry.providers.join(", ")}`,
			400,
		);
	}

	const [existing] = await db
		.select()
		.from(tenantBuiltinTools)
		.where(
			and(
				eq(tenantBuiltinTools.tenant_id, tenantId),
				eq(tenantBuiltinTools.tool_slug, slug),
			),
		);

	let secretRef = existing?.secret_ref ?? null;
	if (body.apiKey) {
		const secretName = builtinToolSecretName(tenantId, slug);
		const secretValue = JSON.stringify({ type: "builtinToolApiKey", token: body.apiKey });
		try {
			await sm.send(
				new UpdateSecretCommand({ SecretId: secretName, SecretString: secretValue }),
			);
		} catch (err: any) {
			if (err instanceof ResourceNotFoundException) {
				await sm.send(
					new CreateSecretCommand({ Name: secretName, SecretString: secretValue }),
				);
			} else {
				throw err;
			}
		}
		secretRef = secretName;
	}

	if (existing) {
		const updates: Record<string, unknown> = { updated_at: new Date() };
		if (body.provider !== undefined) updates.provider = body.provider;
		if (body.enabled !== undefined) updates.enabled = body.enabled;
		if (body.config !== undefined) updates.config = body.config;
		if (secretRef !== existing.secret_ref) updates.secret_ref = secretRef;

		await db
			.update(tenantBuiltinTools)
			.set(updates)
			.where(eq(tenantBuiltinTools.id, existing.id));
		return json({ id: existing.id, toolSlug: slug, updated: true });
	}

	const [inserted] = await db
		.insert(tenantBuiltinTools)
		.values({
			tenant_id: tenantId,
			tool_slug: slug,
			provider: body.provider ?? null,
			enabled: body.enabled ?? false,
			config: body.config ?? null,
			secret_ref: secretRef,
		})
		.returning({ id: tenantBuiltinTools.id });

	return json({ id: inserted.id, toolSlug: slug, created: true });
}

async function builtinToolsDelete(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const [row] = await db
		.select()
		.from(tenantBuiltinTools)
		.where(
			and(
				eq(tenantBuiltinTools.tenant_id, tenantId),
				eq(tenantBuiltinTools.tool_slug, slug),
			),
		);

	if (!row) return notFound("Built-in tool config not found");

	if (row.secret_ref) {
		try {
			await sm.send(
				new DeleteSecretCommand({
					SecretId: row.secret_ref,
					ForceDeleteWithoutRecovery: true,
				}),
			);
		} catch (err) {
			console.warn(`[builtin-tools] Failed to delete secret: ${(err as Error).message}`);
		}
	}

	await db.delete(tenantBuiltinTools).where(eq(tenantBuiltinTools.id, row.id));
	return json({ ok: true, deleted: slug });
}

async function resolveBuiltinToolApiKey(secretRef: string): Promise<string | null> {
	try {
		const res = await sm.send(new GetSecretValueCommand({ SecretId: secretRef }));
		if (!res.SecretString) return null;
		const parsed = JSON.parse(res.SecretString) as { token?: string };
		return parsed.token ?? null;
	} catch (err) {
		console.warn(`[builtin-tools] Failed to fetch secret ${secretRef}: ${(err as Error).message}`);
		return null;
	}
}

async function builtinToolsTest(
	tenantSlug: string,
	slug: string,
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Allow testing with a key supplied in the request body (before it's saved)
	// OR with the stored secret_ref for an existing row.
	const body = (event.body ? JSON.parse(event.body) : {}) as {
		provider?: string;
		apiKey?: string;
	};

	let provider = body.provider;
	let apiKey = body.apiKey;

	if (!apiKey) {
		const [row] = await db
			.select()
			.from(tenantBuiltinTools)
			.where(
				and(
					eq(tenantBuiltinTools.tenant_id, tenantId),
					eq(tenantBuiltinTools.tool_slug, slug),
				),
			);
		if (!row) return error("No saved config and no apiKey provided", 400);
		provider = provider ?? row.provider ?? undefined;
		if (row.secret_ref) {
			apiKey = (await resolveBuiltinToolApiKey(row.secret_ref)) ?? undefined;
		}
	}

	if (!provider) return error("provider is required", 400);
	if (!apiKey) return error("apiKey is required (and no stored secret was found)", 400);

	if (slug !== "web-search") {
		return error(`Test not implemented for tool '${slug}'`, 400);
	}

	try {
		if (provider === "exa") {
			const res = await fetch("https://api.exa.ai/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"User-Agent": "Thinkwork/1.0",
				},
				body: JSON.stringify({ query: "ping", numResults: 1 }),
				signal: AbortSignal.timeout(10000),
			});
			if (!res.ok) {
				const text = await res.text();
				return json({ ok: false, error: `Exa ${res.status}: ${text.slice(0, 200)}` }, 502);
			}
			const data = (await res.json()) as { results?: unknown[] };
			const count = Array.isArray(data.results) ? data.results.length : 0;
			await markBuiltinToolTested(tenantId, slug);
			return json({ ok: true, provider, resultCount: count });
		}

		if (provider === "serpapi") {
			const url = `https://serpapi.com/search.json?engine=google&q=ping&num=1&api_key=${encodeURIComponent(apiKey)}`;
			const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
			if (!res.ok) {
				const text = await res.text();
				return json({ ok: false, error: `SerpAPI ${res.status}: ${text.slice(0, 200)}` }, 502);
			}
			const data = (await res.json()) as { organic_results?: unknown[]; error?: string };
			if (data.error) {
				return json({ ok: false, error: `SerpAPI: ${data.error}` }, 502);
			}
			const count = Array.isArray(data.organic_results) ? data.organic_results.length : 0;
			await markBuiltinToolTested(tenantId, slug);
			return json({ ok: true, provider, resultCount: count });
		}

		return error(`Unknown provider '${provider}'`, 400);
	} catch (err: any) {
		return json({ ok: false, error: err.message || "Test failed" }, 502);
	}
}

async function markBuiltinToolTested(tenantId: string, slug: string): Promise<void> {
	await db
		.update(tenantBuiltinTools)
		.set({ last_tested_at: new Date() })
		.where(
			and(
				eq(tenantBuiltinTools.tenant_id, tenantId),
				eq(tenantBuiltinTools.tool_slug, slug),
			),
		);
}

/** Load enabled built-in tools for a tenant, with API keys resolved from Secrets Manager. */
export async function loadTenantBuiltinTools(
	tenantId: string,
): Promise<Array<{ toolSlug: string; provider: string | null; envOverrides: Record<string, string> }>> {
	const rows = await db
		.select()
		.from(tenantBuiltinTools)
		.where(
			and(
				eq(tenantBuiltinTools.tenant_id, tenantId),
				eq(tenantBuiltinTools.enabled, true),
			),
		);

	const out: Array<{ toolSlug: string; provider: string | null; envOverrides: Record<string, string> }> = [];
	for (const row of rows) {
		const envOverrides: Record<string, string> = {};
		if (row.tool_slug === "web-search") {
			const provider = row.provider ?? "exa";
			envOverrides.WEB_SEARCH_PROVIDER = provider;
			if (row.secret_ref) {
				const key = await resolveBuiltinToolApiKey(row.secret_ref);
				if (key) {
					if (provider === "exa") envOverrides.EXA_API_KEY = key;
					else if (provider === "serpapi") envOverrides.SERPAPI_KEY = key;
				}
			}
			// If no key resolved, skip — we don't inject a broken skill.
			if (!envOverrides.EXA_API_KEY && !envOverrides.SERPAPI_KEY) continue;
		}
		out.push({ toolSlug: row.tool_slug, provider: row.provider, envOverrides });
	}
	return out;
}

// ---------------------------------------------------------------------------
// PRD-31: DB helpers
// ---------------------------------------------------------------------------

/** Ensure all is_default skills are provisioned for this tenant */
async function ensureBuiltinSkills(tenantId: string): Promise<void> {
	const defaults = await db
		.select({ slug: skillCatalog.slug, version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.is_default, true));

	if (defaults.length === 0) return;

	// Check which are already installed
	const existing = await db
		.select({ skill_id: tenantSkills.skill_id })
		.from(tenantSkills)
		.where(eq(tenantSkills.tenant_id, tenantId));

	const existingSet = new Set(existing.map((r) => r.skill_id));

	for (const skill of defaults) {
		if (existingSet.has(skill.slug)) continue;
		await db.insert(tenantSkills).values({
			tenant_id: tenantId,
			skill_id: skill.slug,
			source: "builtin",
			version: skill.version,
			catalog_version: skill.version,
			enabled: true,
		}).onConflictDoNothing();
	}
}

/** Check if a skill has a newer version in the catalog */
async function checkUpgradeable(
	tenantSlug: string,
	slug: string,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	const [installed] = await db
		.select({ catalog_version: tenantSkills.catalog_version })
		.from(tenantSkills)
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.skill_id, slug),
			),
		)
		.limit(1);

	if (!installed) return notFound("Skill not installed");

	const [catalog] = await db
		.select({ version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);

	if (!catalog) return notFound("Skill not in catalog");

	return json({
		upgradeable: installed.catalog_version !== catalog.version,
		currentVersion: installed.catalog_version,
		latestVersion: catalog.version,
	});
}

// ---------------------------------------------------------------------------
// Upgrade
// ---------------------------------------------------------------------------

async function upgradeSkill(
	tenantSlug: string,
	slug: string,
	force: boolean,
): Promise<APIGatewayProxyStructuredResultV2> {
	const tenantId = await resolveTenantId(tenantSlug);
	if (!tenantId) return error("Tenant not found", 404);

	// Look up latest catalog version
	const [catalog] = await db
		.select({ version: skillCatalog.version })
		.from(skillCatalog)
		.where(eq(skillCatalog.slug, slug))
		.limit(1);
	if (!catalog) return notFound("Skill not in catalog");

	// Look up tenant's installed version
	const [installed] = await db
		.select({
			catalog_version: tenantSkills.catalog_version,
			version: tenantSkills.version,
		})
		.from(tenantSkills)
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.skill_id, slug),
			),
		)
		.limit(1);
	if (!installed) return notFound("Skill not installed");

	const currentVersion = installed.catalog_version || installed.version;
	const latestVersion = catalog.version;

	// Check for customizations unless force
	if (!force) {
		const catalogPrefix = `${CATALOG_PREFIX}/${slug}/`;
		const tenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;

		const catalogKeys = await listS3Keys(catalogPrefix);
		const tenantKeys = await listS3Keys(tenantPrefix);

		const catalogRelative = new Set(catalogKeys.map((k) => k.slice(catalogPrefix.length)));
		const tenantRelative = tenantKeys.map((k) => k.slice(tenantPrefix.length));

		// Files that exist in tenant but not in catalog = customizations
		const customizedFiles = tenantRelative.filter(
			(f) => !f.startsWith("_upload") && !catalogRelative.has(f),
		);

		if (customizedFiles.length > 0) {
			return json({
				upgradeable: true,
				hasCustomizations: true,
				currentVersion,
				latestVersion,
				customizedFiles,
			});
		}
	}

	// Perform upgrade: re-copy catalog files to tenant prefix
	const catalogPrefix = `${CATALOG_PREFIX}/${slug}/`;
	const tenantPrefix = `${tenantSkillsPrefix(tenantSlug)}/${slug}/`;
	const files = await listS3Keys(catalogPrefix);

	for (const key of files) {
		const relativePath = key.slice(catalogPrefix.length);
		await s3.send(
			new CopyObjectCommand({
				Bucket: BUCKET,
				CopySource: `${BUCKET}/${key}`,
				Key: `${tenantPrefix}${relativePath}`,
			}),
		);
	}

	// Update DB versions
	await db
		.update(tenantSkills)
		.set({
			catalog_version: latestVersion,
			version: latestVersion,
			updated_at: new Date(),
		})
		.where(
			and(
				eq(tenantSkills.tenant_id, tenantId),
				eq(tenantSkills.skill_id, slug),
			),
		);

	return json({
		upgraded: true,
		previousVersion: currentVersion,
		newVersion: latestVersion,
	});
}

// ---------------------------------------------------------------------------
// S3 helpers
// ---------------------------------------------------------------------------

async function getS3Text(key: string): Promise<string | null> {
	try {
		const res = await s3.send(
			new GetObjectCommand({ Bucket: BUCKET, Key: key }),
		);
		return (await res.Body?.transformToString("utf-8")) ?? null;
	} catch (err: any) {
		if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
			return null;
		}
		throw err;
	}
}

async function putS3Text(key: string, content: string): Promise<void> {
	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET,
			Key: key,
			Body: content,
			ContentType: key.endsWith(".json") ? "application/json" : "text/plain",
		}),
	);
}

async function listS3Keys(prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let continuationToken: string | undefined;

	do {
		const res = await s3.send(
			new ListObjectsV2Command({
				Bucket: BUCKET,
				Prefix: prefix,
				ContinuationToken: continuationToken,
			}),
		);
		for (const obj of res.Contents ?? []) {
			if (obj.Key) keys.push(obj.Key);
		}
		continuationToken = res.NextContinuationToken;
	} while (continuationToken);

	return keys;
}

// ---------------------------------------------------------------------------
// Composition start (Unit 5) — service-to-service wrapper around startSkillRun.
//
// The AgentCore-container dispatcher skill calls this with API_AUTH_SECRET
// to start a composition on behalf of the chat invoker. We trust the caller
// (container runs inside our infra + has the secret) to assert the invoker's
// identity. Cognito-JWT-driven callers should use the GraphQL mutation
// instead — this endpoint is explicitly for service identities that have
// already resolved the user.
// ---------------------------------------------------------------------------

const VALID_INVOCATION_SOURCES = new Set(["chat", "scheduled", "catalog", "webhook"]);

interface StartSkillRunServiceBody {
	tenantId: string;
	invokerUserId: string;
	agentId?: string;
	skillId: string;
	skillVersion?: number;
	invocationSource: string;
	inputs?: Record<string, unknown>;
	deliveryChannels?: unknown[];
}

async function startSkillRunService(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	let body: StartSkillRunServiceBody;
	try {
		body = JSON.parse(event.body || "{}");
	} catch {
		return error("Invalid JSON body", 400);
	}

	const {
		tenantId,
		invokerUserId,
		agentId,
		skillId,
		skillVersion = 1,
		invocationSource,
		inputs = {},
		deliveryChannels = [],
	} = body;

	if (!tenantId || !invokerUserId || !skillId || !invocationSource) {
		return error(
			"Missing required fields: tenantId, invokerUserId, skillId, invocationSource",
			400,
		);
	}
	if (!VALID_INVOCATION_SOURCES.has(invocationSource)) {
		return error(
			`invocationSource must be one of chat|scheduled|catalog|webhook (got ${invocationSource})`,
			400,
		);
	}

	// Sanity check: the claimed invoker belongs to the claimed tenant.
	// Prevents a compromised container (or a bad call) from pinning one
	// tenant's user to another tenant's run.
	const [invoker] = await db
		.select({ id: users.id, tenant_id: users.tenant_id })
		.from(users)
		.where(eq(users.id, invokerUserId));
	if (!invoker) return error("invokerUserId not found", 404);
	if (invoker.tenant_id !== tenantId) {
		return error("invokerUserId tenant mismatch", 403);
	}

	const resolvedInputs = inputs;
	const resolvedInputsHash = hashResolvedInputs(resolvedInputs);
	// Per-run HMAC secret for /api/skills/complete authentication. Shipped
	// to the agentcore container in the run_skill envelope; burned to NULL
	// when the row transitions to a terminal status (single-use).
	const completionHmacSecret = randomBytes(32).toString("hex");

	const inserted = await db
		.insert(skillRuns)
		.values({
			tenant_id: tenantId,
			agent_id: agentId ?? null,
			invoker_user_id: invokerUserId,
			skill_id: skillId,
			skill_version: skillVersion,
			invocation_source: invocationSource,
			inputs: resolvedInputs,
			resolved_inputs: resolvedInputs,
			resolved_inputs_hash: resolvedInputsHash,
			delivery_channels: deliveryChannels,
			status: "running",
			completion_hmac_secret: completionHmacSecret,
		})
		.onConflictDoNothing({
			target: [
				skillRuns.tenant_id,
				skillRuns.invoker_user_id,
				skillRuns.skill_id,
				skillRuns.resolved_inputs_hash,
			],
			// Match the partial unique index `uq_skill_runs_dedup_active`
			// (WHERE status='running'). Without this predicate Postgres
			// cannot resolve the ON CONFLICT target against a partial index
			// and raises error 42P10.
			where: sql`status = 'running'`,
		})
		.returning();

	if (inserted.length === 0) {
		// Dedup hit — surface the active run so the dispatcher can tell
		// the user "already running, view progress" without starting a
		// duplicate composition.
		const [existing] = await db
			.select()
			.from(skillRuns)
			.where(
				and(
					eq(skillRuns.tenant_id, tenantId),
					eq(skillRuns.invoker_user_id, invokerUserId),
					eq(skillRuns.skill_id, skillId),
					eq(skillRuns.resolved_inputs_hash, resolvedInputsHash),
					eq(skillRuns.status, "running"),
				),
			);
		if (!existing) {
			return error("concurrent start race: no row inserted, no active match", 500);
		}
		return json({ runId: existing.id, status: existing.status, deduped: true });
	}

	const runRow = inserted[0];
	const invokeResult = await invokeAgentcoreRunSkill({
		runId: runRow.id,
		tenantId,
		invokerUserId,
		skillId,
		skillVersion: runRow.skill_version,
		resolvedInputs,
		invocationSource,
		completionHmacSecret,
	});

	if (!invokeResult.ok) {
		await db
			.update(skillRuns)
			.set({
				status: "failed",
				failure_reason: invokeResult.error.slice(0, 500),
				finished_at: new Date(),
				updated_at: new Date(),
			})
			.where(eq(skillRuns.id, runRow.id));
		return error(`composition invoke failed: ${invokeResult.error}`, 502);
	}

	return json({ runId: runRow.id, status: "running", deduped: false });
}

// ---------------------------------------------------------------------------
// Composition complete — terminal-state writeback from the agentcore container.
//
// After run_composition() returns, the container POSTs the terminal state
// here so skill_runs.status transitions out of `running`. Service-auth only
// (Bearer API_AUTH_SECRET); tenant-integrity-checked against the row by id.
// ---------------------------------------------------------------------------

// Transitions permitted from `running`. The skill_runs CHECK constraint
// permits these terminal statuses. `invoker_deprovisioned` + `skipped_disabled`
// are owned by job-trigger, not this endpoint — a container-completion can't
// produce those signals.
const SKILL_RUN_TERMINAL_FROM_RUNNING = new Set([
	"complete",
	"failed",
	"cancelled",
	"cost_bounded_error",
]);

interface CompleteSkillRunBody {
	runId: string;
	tenantId: string;
	status: string;
	failureReason?: string | null;
	deliveredArtifactRef?: unknown;
}

async function completeSkillRunService(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	let body: CompleteSkillRunBody;
	try {
		body = JSON.parse(event.body || "{}");
	} catch {
		return error("Invalid JSON body", 400);
	}

	const { runId, tenantId, status, failureReason, deliveredArtifactRef } = body;

	if (!runId || !tenantId || !status) {
		return error("Missing required fields: runId, tenantId, status", 400);
	}
	if (!SKILL_RUN_TERMINAL_FROM_RUNNING.has(status)) {
		return error(
			`status must be one of ${Array.from(SKILL_RUN_TERMINAL_FROM_RUNNING).join("|")} (got ${status})`,
			400,
		);
	}
	if (status !== "complete" && !failureReason) {
		return error("failureReason is required when status is not 'complete'", 400);
	}

	const [row] = await db
		.select({
			id: skillRuns.id,
			tenant_id: skillRuns.tenant_id,
			status: skillRuns.status,
			completion_hmac_secret: skillRuns.completion_hmac_secret,
		})
		.from(skillRuns)
		.where(eq(skillRuns.id, runId));
	if (!row) return error("runId not found", 404);
	if (row.tenant_id !== tenantId) {
		return error("tenantId does not match skill_run", 403);
	}

	// Per-run HMAC verification. The secret was generated by
	// startSkillRunService and shipped to the agentcore container in the
	// run_skill envelope. A NULL secret means the row is either already
	// completed (secret burned) or pre-dates the hardening migration — both
	// are terminal from the completion endpoint's perspective. Returning 401
	// here rather than 400 is deliberate: the Python retry helper treats 4xx
	// as terminal and does NOT retry (see _urlopen_with_retry), so a 401
	// ends the callback loop cleanly.
	if (!row.completion_hmac_secret) {
		return unauthorized("completion signature required: run is no longer active");
	}
	if (!verifyCompletionHmac(event, runId, row.completion_hmac_secret)) {
		return unauthorized("invalid completion signature");
	}

	// Only `running` rows are eligible for this writeback. Terminal-to-terminal
	// transitions (e.g. failed → cancelled) aren't something run_composition
	// should be producing — reject so we don't silently overwrite prior state.
	// The atomic CAS in the UPDATE (change 5) is the authoritative check;
	// this early return is a fast-path for the common case.
	if (row.status !== "running") {
		return error(`invalid transition: ${row.status} → ${status}`, 400);
	}

	const updates: Record<string, unknown> = {
		status,
		finished_at: new Date(),
		updated_at: new Date(),
		// Burn the secret so a retry (or a leaked runId) cannot forge a
		// second completion. Any subsequent POST with this runId hits the
		// "completion signature required" 401 branch above.
		completion_hmac_secret: null,
	};
	if (failureReason != null) {
		updates.failure_reason = String(failureReason).slice(0, 500);
	}
	if (deliveredArtifactRef !== undefined && deliveredArtifactRef !== null) {
		updates.delivered_artifact_ref = deliveredArtifactRef;
	}

	// Atomic compare-and-swap on status='running'. A concurrent cancel
	// (admin, reconciler, deprovisioner) that flips status between the
	// SELECT above and this UPDATE would be silently clobbered without
	// this predicate. The fast-path 400 above is a best-effort early
	// rejection; this is the authoritative guard.
	const [updated] = await db
		.update(skillRuns)
		.set(updates)
		.where(and(eq(skillRuns.id, runId), eq(skillRuns.status, "running")))
		.returning({
			id: skillRuns.id,
			status: skillRuns.status,
			finished_at: skillRuns.finished_at,
		});
	if (!updated) {
		return error("run no longer in running state", 409);
	}

	return json({
		runId: updated.id,
		status: updated.status,
		finishedAt: updated.finished_at,
	});
}

function verifyCompletionHmac(
	event: APIGatewayProxyEventV2,
	runId: string,
	secret: string,
): boolean {
	const header =
		event.headers["x-skill-run-signature"] ||
		event.headers["X-Skill-Run-Signature"] ||
		"";
	if (!header) return false;
	// Accept either "sha256=<hex>" or a bare hex digest — callers may drop
	// the scheme prefix. Only sha256 is supported.
	const provided = header.startsWith("sha256=") ? header.slice(7) : header;
	if (provided.length % 2 !== 0) return false;
	let providedBuf: Buffer;
	try {
		providedBuf = Buffer.from(provided, "hex");
	} catch {
		return false;
	}
	const expectedHex = createHmac("sha256", secret).update(runId).digest("hex");
	const expectedBuf = Buffer.from(expectedHex, "hex");
	if (providedBuf.length !== expectedBuf.length) return false;
	return timingSafeEqual(providedBuf, expectedBuf);
}

// Shared helpers — mirror the canonicalization/invoke shape used by the
// GraphQL startSkillRun resolver (packages/api/src/graphql/utils.ts) and by
// job-trigger's inline skill_run branch. Drift would collapse the
// skill_runs dedup partial unique index.

function canonicalizeForHash(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((v) => canonicalizeForHash(v)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const entries = keys.map(
		(k) => `${JSON.stringify(k)}:${canonicalizeForHash(obj[k])}`,
	);
	return `{${entries.join(",")}}`;
}

function hashResolvedInputs(resolvedInputs: Record<string, unknown>): string {
	return createHash("sha256")
		.update(canonicalizeForHash(resolvedInputs))
		.digest("hex");
}

async function invokeAgentcoreRunSkill(payload: {
	runId: string;
	tenantId: string;
	invokerUserId: string;
	skillId: string;
	skillVersion: number;
	resolvedInputs: Record<string, unknown>;
	invocationSource: string;
	completionHmacSecret: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
	const fnName = process.env.AGENTCORE_FUNCTION_NAME;
	if (!fnName) return { ok: false, error: "AGENTCORE_FUNCTION_NAME env var not set" };
	try {
		const { LambdaClient, InvokeCommand } = await import("@aws-sdk/client-lambda");
		const { NodeHttpHandler } = await import("@smithy/node-http-handler");
		// 28s socketTimeout leaves 2s headroom before this Lambda's 30s
		// ceiling (and API Gateway's 29s cap). Without it a slow agentcore
		// can block past those limits and we lose the chance to return a
		// structured 502 to the caller.
		const lambda = new LambdaClient({
			requestHandler: new NodeHttpHandler({ socketTimeout: 28_000 }),
		});
		const envelope = {
			kind: "run_skill" as const,
			runId: payload.runId,
			tenantId: payload.tenantId,
			invokerUserId: payload.invokerUserId,
			skillId: payload.skillId,
			skillVersion: payload.skillVersion,
			invocationSource: payload.invocationSource,
			resolvedInputs: payload.resolvedInputs,
			// snake_case — Python's composition_runner._scope_to_inputs reads
			// tenant_id/user_id/skill_id. See change 4 of the hardening plan.
			scope: {
				tenant_id: payload.tenantId,
				user_id: payload.invokerUserId,
				skill_id: payload.skillId,
			},
			// Per-run HMAC secret the container uses to sign its
			// /api/skills/complete callback. Never put this secret in logs or
			// persist it outside skill_runs.completion_hmac_secret.
			completionHmacSecret: payload.completionHmacSecret,
		};
		const res = await lambda.send(new InvokeCommand({
			FunctionName: fnName,
			InvocationType: "RequestResponse",
			Payload: new TextEncoder().encode(JSON.stringify({
				requestContext: { http: { method: "POST", path: "/invocations" } },
				rawPath: "/invocations",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${process.env.THINKWORK_API_SECRET || process.env.API_AUTH_SECRET || ""}`,
				},
				body: JSON.stringify(envelope),
				isBase64Encoded: false,
			})),
		}));
		if (res.FunctionError) {
			const raw = res.Payload ? new TextDecoder().decode(res.Payload) : "";
			return { ok: false, error: `agentcore-invoke threw: ${raw || res.FunctionError}` };
		}
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
