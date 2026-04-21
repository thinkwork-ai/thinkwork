/**
 * OAuth Authorize Handler
 *
 * GET /api/oauth/authorize?provider=google_productivity&scopes=gmail,calendar&userId=...&tenantId=...
 *
 * Generates a random state token, inserts a pending connection row,
 * looks up provider config, and returns a 302 redirect to the provider's
 * authorization URL.
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import { error } from "../lib/response.js";
import {
	getOAuthClientCredentials,
	isSecretsManagerProvider,
} from "../lib/oauth-client-credentials.js";

const { connectProviders, connections, users } = schema;

// LastMile is still env-var based (legacy surface; migrate opportunistically).
// Google + Microsoft come from Secrets Manager via getOAuthClientCredentials().
const LASTMILE_CLIENT_ID = process.env.LASTMILE_CLIENT_ID || "";

// Callback URL — in production this is api.thinkwork.ai, in dev it's the raw API Gateway URL
const OAUTH_CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || "";

interface ProviderConfig {
	authorization_url: string;
	token_url: string;
	scopes: Record<string, string>;
	extra_params?: Record<string, string>;
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const providerName = params.provider;
	const requestedScopes = params.scopes?.split(",") || [];
	const userId = params.userId;
	const tenantId = params.tenantId;
	const agentId = params.agentId || "";
	const skillId = params.skillId || "";
	const returnUrl = params.returnUrl || "";

	if (!providerName || !userId || !tenantId) {
		return error("Missing required params: provider, userId, tenantId");
	}

	// Look up provider
	const [provider] = await db
		.select()
		.from(connectProviders)
		.where(eq(connectProviders.name, providerName));

	if (!provider) {
		return error(
			`Unknown provider: ${providerName} (check connect_providers table; run scripts/seed-dev.sql if missing)`,
			404,
		);
	}

	const config = provider.config as ProviderConfig;
	if (!config?.authorization_url) {
		return error("Provider not configured for OAuth");
	}

	// Determine client ID — Google/Microsoft come from Secrets Manager,
	// LastMile still reads from env (legacy).
	let clientId = "";
	if (isSecretsManagerProvider(providerName)) {
		try {
			clientId = (await getOAuthClientCredentials(providerName)).clientId;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return error(`OAuth client not configured for ${providerName}: ${msg}`, 500);
		}
	} else if (providerName === "lastmile") {
		clientId = LASTMILE_CLIENT_ID;
	}
	if (!clientId) {
		const envHint = isSecretsManagerProvider(providerName)
			? `check the Secrets Manager secret referenced by ${providerName === "google_productivity" ? "GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN" : "MICROSOFT_OAUTH_SECRET_ARN"}`
			: "check LASTMILE_CLIENT_ID env var";
		return error(`OAuth client not configured for ${providerName} (${envHint})`, 500);
	}
	if (!OAUTH_CALLBACK_URL) {
		return error("OAUTH_CALLBACK_URL is not configured", 500);
	}

	// Generate state token
	const state = randomBytes(32).toString("hex");

	// Build scopes — map requested scope names to full scope URLs
	const scopeValues: string[] = [];
	// LastMile (Clerk) — only send standard OIDC scopes; custom permissions
	// are handled by the LastMile MCP server auth, not Clerk scopes.
	if (providerName === "lastmile") {
		scopeValues.push("openid", "email", "profile", "offline_access");
	} else {
		for (const scopeName of requestedScopes) {
			const scopeValue = config.scopes[scopeName];
			if (scopeValue) scopeValues.push(scopeValue);
		}
		// If no specific scopes requested, use all available
		if (scopeValues.length === 0) {
			scopeValues.push(...Object.values(config.scopes));
		}
		// Google requires openid + email for userinfo
		if (providerName === "google_productivity") {
			scopeValues.push("openid", "email", "profile");
		}
		// Microsoft requires offline_access for refresh tokens + User.Read for userinfo
		if (providerName === "microsoft_365") {
			if (!scopeValues.includes("offline_access")) scopeValues.push("offline_access");
			if (!scopeValues.includes("User.Read")) scopeValues.push("User.Read");
		}
	}

	// Resolve Thinkwork user ID. The mobile/admin UI passes `meUser.id`
	// (which is already users.id from the `me` GraphQL resolver), so the
	// direct match is the common case. We fall back to a tenant-only lookup
	// only for legacy callers that still pass a raw Cognito sub and can't
	// find a matching users row (rare, kept for compatibility).
	let resolvedUserId = userId;
	try {
		const [dbUser] = await db
			.select({ id: users.id })
			.from(users)
			.where(and(eq(users.tenant_id, tenantId), eq(users.id, userId)))
			.limit(1);
		if (dbUser) {
			resolvedUserId = dbUser.id;
		} else {
			// Legacy fallback — userId didn't match a users.id in this tenant.
			// Pick the tenant's first user deterministically so we don't bind
			// the connection to an arbitrary row each invocation.
			const [fallbackUser] = await db
				.select({ id: users.id })
				.from(users)
				.where(eq(users.tenant_id, tenantId))
				.orderBy(users.created_at)
				.limit(1);
			if (fallbackUser) {
				console.warn(`[oauth-authorize] userId=${userId.slice(0,8)} not a users.id in tenant; falling back to first user ${fallbackUser.id.slice(0,8)}`);
				resolvedUserId = fallbackUser.id;
			}
		}
	} catch (err) {
		console.warn(`[oauth-authorize] Failed to resolve user, using provided userId:`, err);
	}

	// Insert pending connection (include agentId/skillId for post-OAuth linking)
	const [conn] = await db
		.insert(connections)
		.values({
			tenant_id: tenantId,
			user_id: resolvedUserId,
			provider_id: provider.id,
			status: "pending",
			metadata: {
				oauth_state: state,
				requested_scopes: requestedScopes,
				...(agentId ? { agent_id: agentId } : {}),
				...(skillId ? { skill_id: skillId } : {}),
				...(returnUrl ? { return_url: returnUrl } : {}),
			},
		})
		.returning({ id: connections.id });

	// Build authorization URL
	const authUrl = new URL(config.authorization_url);
	authUrl.searchParams.set("client_id", clientId);
	authUrl.searchParams.set("redirect_uri", OAUTH_CALLBACK_URL);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("scope", scopeValues.join(" "));
	authUrl.searchParams.set("state", state);

	// Add extra params from provider config
	if (config.extra_params) {
		for (const [key, value] of Object.entries(config.extra_params)) {
			authUrl.searchParams.set(key, value);
		}
	}

	console.log(`[oauth-authorize] Redirecting to ${providerName} for connection ${conn.id}`, {
		authUrl: authUrl.toString(),
		callbackUrl: OAUTH_CALLBACK_URL,
		clientId,
		scopes: scopeValues.join(" "),
	});

	return {
		statusCode: 302,
		headers: {
			Location: authUrl.toString(),
		},
		body: "",
	};
}
