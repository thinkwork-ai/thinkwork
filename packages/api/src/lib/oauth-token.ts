/**
 * Shared OAuth Token Resolution
 *
 * Used by both chat-agent-invoke and wakeup-processor to resolve
 * fresh OAuth access tokens for skill envOverrides.
 *
 * Flow:
 * 1. Read token from SM at thinkwork/{stage}/oauth/{connectionId}
 * 2. Check credentials.expires_at with 5-min buffer
 * 3. If expired: POST to provider's token_url with refresh_token
 * 4. On success: write back to SM + update credentials.expires_at
 * 5. On failure: mark connection status="expired" + notify
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { schema } from "@thinkwork/database-pg";

const { connections, connectProviders, credentials, userMcpTokens, tenantMcpServers } = schema;
import {
	SecretsManagerClient,
	GetSecretValueCommand,
	UpdateSecretCommand,
	// CreateSecretCommand - not needed for refresh, only for initial token storage
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const STAGE = process.env.STAGE || process.env.APP_STAGE || "dev";
const APPSYNC_ENDPOINT = process.env.APPSYNC_ENDPOINT || "";
const APPSYNC_API_KEY = process.env.APPSYNC_API_KEY || "";

const sm = new SecretsManagerClient({
	region: process.env.AWS_REGION || "us-east-1",
});

const db = getDb();

// 5-minute buffer before considering a token expired
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface StoredOAuthToken {
	access_token: string;
	refresh_token: string;
	token_type: string;
	scope: string;
	obtained_at: string;
}

interface ProviderConfig {
	token_url: string;
	scopes: Record<string, string>;
}

interface TokenRefreshResult {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
}

/**
 * Resolve an active connection row for a provider-native user id (e.g.
 * LastMile's internal user uuid), given the provider name. Webhooks carry the
 * native id, not our Cognito sub, so this is the one-stop lookup.
 *
 * Matches on `connections.metadata->{provider}->userId`. The OAuth callback
 * is responsible for writing that field at connect time; if it's missing the
 * webhook resolution will return null and the caller must log + drop.
 *
 * Also surfaces `defaultAgentId` from `metadata.{provider}.default_agent_id`
 * so the webhook ingest can wire the user's opted-in chat agent onto new
 * external-task threads. Undefined when the user has not opted in.
 *
 * When `tenantId` is provided, the scan is scoped to that tenant — used by
 * the unified token-based webhook dispatch where the webhook row already
 * pinned down the tenant. When omitted, the scan runs across all active
 * connections globally (legacy behavior, kept for backward compat).
 */
export async function resolveConnectionByProviderUserId(
	providerName: string,
	providerUserId: string,
	tenantId?: string,
): Promise<
	| {
			connectionId: string;
			tenantId: string;
			userId: string;
			providerId: string;
			defaultAgentId?: string;
	  }
	| null
> {
	const conditions = [
		eq(connectProviders.name, providerName),
		eq(connections.status, "active"),
	];
	if (tenantId) {
		conditions.push(eq(connections.tenant_id, tenantId));
	}

	const rows = await db
		.select({
			connectionId: connections.id,
			tenantId: connections.tenant_id,
			userId: connections.user_id,
			providerId: connections.provider_id,
			status: connections.status,
			metadata: connections.metadata,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(and(...conditions));

	for (const row of rows) {
		const meta = (row.metadata ?? {}) as Record<string, unknown>;
		const providerMeta = (meta[providerName] ?? {}) as Record<string, unknown>;
		if (providerMeta.userId === providerUserId) {
			const rawDefaultAgentId = providerMeta.default_agent_id;
			const defaultAgentId =
				typeof rawDefaultAgentId === "string" && rawDefaultAgentId.length > 0
					? rawDefaultAgentId
					: undefined;
			return {
				connectionId: row.connectionId,
				tenantId: row.tenantId,
				userId: row.userId,
				providerId: row.providerId,
				defaultAgentId,
			};
		}
	}
	return null;
}

/**
 * Resolve a user's active connection row for a named provider. Used by the
 * external-task executor and webhook pipeline to map
 * `(tenantId, userId, providerName)` → `{ connectionId, providerId }`
 * without each call site re-learning the join shape.
 */
export async function resolveConnectionForUser(
	tenantId: string,
	userId: string,
	providerName: string,
): Promise<{ connectionId: string; providerId: string } | null> {
	const [row] = await db
		.select({
			connectionId: connections.id,
			providerId: connections.provider_id,
			status: connections.status,
			providerName: connectProviders.name,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(
			and(
				eq(connections.tenant_id, tenantId),
				eq(connections.user_id, userId),
				eq(connectProviders.name, providerName),
			),
		);

	if (!row || row.status !== "active") return null;
	return { connectionId: row.connectionId, providerId: row.providerId };
}

/**
 * Resolve a fresh OAuth access token for a given connection.
 * Returns the access token string, or null if resolution fails.
 *
 * LastMile special case: tokens live in `user_mcp_tokens` + a different
 * Secrets Manager path (`thinkwork/.../mcp-tokens/{userId}/{mcpServerId}`)
 * because the OAuth flow goes through the MCP Servers RFC 9728 pipeline, not
 * the `oauth-callback` flow. For non-LastMile providers we fall through to
 * the standard `connections` secret path.
 */
export async function resolveOAuthToken(
	connectionId: string,
	tenantId: string,
	providerId: string,
): Promise<string | null> {
	// Check if this is a LastMile connection — route to the MCP token path.
	const [providerRow] = await db
		.select({ name: connectProviders.name })
		.from(connectProviders)
		.where(eq(connectProviders.id, providerId));
	if (providerRow?.name === "lastmile") {
		return resolveLastmileUserToken(connectionId, tenantId);
	}

	const secretId = `thinkwork/${STAGE}/oauth/${connectionId}`;

	// 1. Read current token from Secrets Manager
	let stored: StoredOAuthToken;
	try {
		const result = await sm.send(
			new GetSecretValueCommand({ SecretId: secretId }),
		);
		if (!result.SecretString) return null;
		stored = JSON.parse(result.SecretString);
	} catch (err) {
		if (err instanceof ResourceNotFoundException) {
			console.warn(`[oauth-token] No secret found for connection ${connectionId}`);
			return null;
		}
		throw err;
	}

	// 2. Check if token needs refresh
	const [cred] = await db
		.select({ id: credentials.id, expires_at: credentials.expires_at })
		.from(credentials)
		.where(
			and(
				eq(credentials.connection_id, connectionId),
				eq(credentials.tenant_id, tenantId),
			),
		);

	const needsRefresh =
		cred?.expires_at &&
		new Date(cred.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;

	if (!needsRefresh && stored.access_token) {
		return stored.access_token;
	}

	// 3. Token needs refresh — look up provider config
	if (!stored.refresh_token) {
		console.error(`[oauth-token] No refresh token for connection ${connectionId}`);
		await markConnectionExpired(connectionId, tenantId, "no_refresh_token");
		return null;
	}

	const [provider] = await db
		.select({ name: connectProviders.name, config: connectProviders.config })
		.from(connectProviders)
		.where(eq(connectProviders.id, providerId));

	if (!provider) {
		console.error(`[oauth-token] Provider not found: ${providerId}`);
		return null;
	}

	const config = provider.config as ProviderConfig;

	// Determine client credentials from env
	let clientId = "";
	let clientSecret = "";
	if (provider.name === "google_productivity") {
		clientId = process.env.GOOGLE_PRODUCTIVITY_CLIENT_ID || "";
		clientSecret = process.env.GOOGLE_PRODUCTIVITY_CLIENT_SECRET || "";
	} else if (provider.name === "microsoft_365") {
		clientId = process.env.MICROSOFT_CLIENT_ID || "";
		clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
	} else if (provider.name === "lastmile") {
		clientId = process.env.LASTMILE_CLIENT_ID || "";
		clientSecret = process.env.LASTMILE_CLIENT_SECRET || "";
	}

	// 4. Refresh the token
	try {
		const refreshBody = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: stored.refresh_token,
			client_id: clientId,
			client_secret: clientSecret,
		});

		const refreshRes = await fetch(config.token_url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: refreshBody.toString(),
		});

		if (!refreshRes.ok) {
			const errText = await refreshRes.text();
			console.error(`[oauth-token] Refresh failed for ${connectionId}: ${refreshRes.status} ${errText}`);
			await markConnectionExpired(connectionId, tenantId, "token_refresh_failed");
			return null;
		}

		const refreshResult = await refreshRes.json() as TokenRefreshResult;

		// 5. Write refreshed token back to SM
		const updatedToken: StoredOAuthToken = {
			access_token: refreshResult.access_token,
			refresh_token: refreshResult.refresh_token || stored.refresh_token,
			token_type: stored.token_type,
			scope: stored.scope,
			obtained_at: new Date().toISOString(),
		};

		await sm.send(
			new UpdateSecretCommand({
				SecretId: secretId,
				SecretString: JSON.stringify(updatedToken),
			}),
		);

		// 6. Update credentials.expires_at
		const newExpiresAt = refreshResult.expires_in
			? new Date(Date.now() + refreshResult.expires_in * 1000)
			: null;

		if (cred) {
			await db
				.update(credentials)
				.set({
					expires_at: newExpiresAt,
					updated_at: new Date(),
				})
				.where(eq(credentials.id, cred.id));
		}

		console.log(`[oauth-token] Refreshed token for connection ${connectionId}`);
		return refreshResult.access_token;
	} catch (err) {
		console.error(`[oauth-token] Token refresh error for ${connectionId}:`, err);
		await markConnectionExpired(connectionId, tenantId, "token_refresh_error");
		return null;
	}
}

/**
 * Build envOverrides for a skill that has a connectionId in its config.
 * Returns env vars that will be merged into os.environ by server.py.
 */
export async function buildSkillEnvOverrides(
	skillConfig: Record<string, unknown>,
	tenantId: string,
): Promise<Record<string, string> | null> {
	const connectionId = skillConfig.connectionId as string;
	if (!connectionId) return null;

	// Look up connection to get provider info
	const [conn] = await db
		.select({
			id: connections.id,
			provider_id: connections.provider_id,
			status: connections.status,
			provider_name: connectProviders.name,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(eq(connections.id, connectionId));

	if (!conn || conn.status !== "active") return null;

	const accessToken = await resolveOAuthToken(connectionId, tenantId, conn.provider_id);
	if (!accessToken) return null;

	// Build env vars based on provider type
	const envOverrides: Record<string, string> = {};

	if (conn.provider_name === "google_productivity") {
		// Determine which env var name based on skill type or tokenEnvVar hint
		const skillType = skillConfig.skillType as string || "";
		const tokenEnvVar = skillConfig.tokenEnvVar as string || "";
		if (skillType === "google-calendar" || tokenEnvVar === "GCAL_ACCESS_TOKEN") {
			envOverrides.GCAL_ACCESS_TOKEN = accessToken;
			envOverrides.GCAL_CONNECTION_ID = connectionId;
		} else {
			// Default to Gmail
			envOverrides.GMAIL_ACCESS_TOKEN = accessToken;
			envOverrides.GMAIL_CONNECTION_ID = connectionId;
		}
	} else if (conn.provider_name === "microsoft_365") {
		const skillType = skillConfig.skillType as string || "";
		const tokenEnvVar = skillConfig.tokenEnvVar as string || "";
		if (skillType === "microsoft-calendar" || tokenEnvVar === "MSCAL_ACCESS_TOKEN") {
			envOverrides.MSCAL_ACCESS_TOKEN = accessToken;
			envOverrides.MSCAL_CONNECTION_ID = connectionId;
		} else {
			envOverrides.MSGRAPH_ACCESS_TOKEN = accessToken;
			envOverrides.MSGRAPH_CONNECTION_ID = connectionId;
		}
	} else if (conn.provider_name === "lastmile") {
		envOverrides.LASTMILE_ACCESS_TOKEN = accessToken;
		envOverrides.LASTMILE_CONNECTION_ID = connectionId;
		// LastMile GraphQL credentials for direct API calls (script skills)
		envOverrides.LASTMILE_GRAPHQL_USERNAME = process.env.LASTMILE_GRAPHQL_USERNAME || "";
		envOverrides.LASTMILE_GRAPHQL_PASSWORD = process.env.LASTMILE_GRAPHQL_PASSWORD || "";
		envOverrides.LASTMILE_API_URL = process.env.LASTMILE_API_URL || "https://graphql-dev.lastmile-tei.com/graphql";
	}

	// Always provide the API URL and secret so skills can call back
	envOverrides.THINKWORK_API_URL = process.env.MCP_BASE_URL || "";
	envOverrides.THINKWORK_API_SECRET = process.env.THINKWORK_API_SECRET || "";

	return envOverrides;
}

/**
 * Mark a connection as expired and optionally notify the user.
 */
async function markConnectionExpired(
	connectionId: string,
	tenantId: string,
	reason: string,
): Promise<void> {
	// First read current metadata, then merge
	const [conn] = await db
		.select({ metadata: connections.metadata })
		.from(connections)
		.where(eq(connections.id, connectionId));

	const currentMeta = (conn?.metadata as Record<string, unknown>) || {};
	await db
		.update(connections)
		.set({
			status: "expired",
			metadata: { ...currentMeta, expired_reason: reason },
			updated_at: new Date(),
		})
		.where(eq(connections.id, connectionId));

	// Insert a notification — find the agent's triage thread or any thread for this tenant
	await notifyConnectionExpired(connectionId, tenantId, reason);
}

/**
 * Notify the user that their connection has expired.
 * Posts a system message and sends an AppSync notification.
 */
export async function notifyConnectionExpired(
	connectionId: string,
	tenantId: string,
	reason: string,
): Promise<void> {
	// Look up connection details for the notification
	const [conn] = await db
		.select({
			user_id: connections.user_id,
			provider_name: connectProviders.display_name,
		})
		.from(connections)
		.innerJoin(connectProviders, eq(connections.provider_id, connectProviders.id))
		.where(eq(connections.id, connectionId));

	if (!conn) return;

	const message = `Your ${conn.provider_name} connection has expired (${reason}). Please reconnect in Settings → Integrations.`;

	// Send AppSync notification if configured
	if (APPSYNC_ENDPOINT && APPSYNC_API_KEY) {
		const mutation = `
			mutation NotifyNewMessage(
				$messageId: ID!
				$threadId: ID!
				$tenantId: ID!
				$role: String!
				$content: String!
				$senderType: String
			) {
				notifyNewMessage(
					messageId: $messageId
					threadId: $threadId
					tenantId: $tenantId
					role: $role
					content: $content
					senderType: $senderType
				) {
					messageId
					threadId
					tenantId
					role
					content
				}
			}
		`;

		try {
			await fetch(APPSYNC_ENDPOINT, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": APPSYNC_API_KEY,
				},
				body: JSON.stringify({
					query: mutation,
					variables: {
						messageId: `system-${connectionId}-expired`,
						threadId: `system-${tenantId}`,
						tenantId,
						role: "system",
						content: message,
						senderType: "system",
					},
				}),
			});
		} catch (err) {
			console.error(`[oauth-token] AppSync notification failed:`, err);
		}
	}

	console.log(`[oauth-token] Connection ${connectionId} expired: ${reason}`);
}

/**
 * Stored MCP token shape — matches the JSON written to Secrets Manager by
 * `skills.ts` (initial OAuth code exchange) and by `refreshLastmileMcpToken`
 * (this file). The `expires_in` field is authoritative for per-row expiry
 * bookkeeping on `user_mcp_tokens.expires_at`; the secret itself only
 * carries `obtained_at` for audit purposes.
 */
interface StoredMcpToken {
	access_token: string;
	refresh_token: string | null;
	token_type: string;
	obtained_at: string;
}

interface McpTokenAuthConfig {
	client_id?: string;
	token_endpoint?: string;
}

/**
 * Refresh a LastMile MCP token via the WorkOS `/oauth2/token` endpoint
 * using `grant_type=refresh_token`. The WorkOS public-client flow does
 * NOT require a client_secret — the mobile MCP Servers screen registers
 * a new DCR client on first connect with `token_endpoint_auth_method:
 * "none"`, and the client_id is cached in `tenant_mcp_servers.auth_config`.
 *
 * WorkOS rotates the `refresh_token` on every successful refresh — the
 * new pair MUST be persisted back to Secrets Manager before returning,
 * otherwise the next refresh attempt will fail with "invalid refresh
 * token" and the user has to reconnect from mobile (exactly the PR H
 * bug this helper fixes).
 *
 * Concurrency: two Lambda invocations can race here. The second one will
 * fail because WorkOS invalidates the old refresh_token, mark the row
 * expired, and the caller will fall back to its synthetic-envelope path
 * for that single request. Next invocation picks up the freshly-stored
 * token and succeeds.
 *
 * Returns the new access_token on success, null on any failure.
 *
 * Exported for unit tests; the intended public entry point is
 * `resolveOAuthToken(connectionId, tenantId, providerId)` which wraps
 * this helper behind the LastMile provider detection path.
 */
export async function refreshLastmileMcpToken(args: {
	secretRef: string;
	storedToken: StoredMcpToken;
	userMcpTokenId: string;
	tokenEndpoint: string;
	clientId: string;
}): Promise<string | null> {
	const { secretRef, storedToken, userMcpTokenId, tokenEndpoint, clientId } = args;

	if (!storedToken.refresh_token) {
		console.warn(
			`[oauth-token] LastMile MCP token has no refresh_token; cannot refresh ${secretRef}`,
		);
		await db
			.update(userMcpTokens)
			.set({ status: "expired", updated_at: new Date() })
			.where(eq(userMcpTokens.id, userMcpTokenId));
		return null;
	}

	let refreshJson: {
		access_token?: string;
		refresh_token?: string;
		token_type?: string;
		expires_in?: number;
	};
	try {
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: storedToken.refresh_token,
			client_id: clientId,
		});
		const res = await fetch(tokenEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) {
			const errText = await res.text().catch(() => "");
			console.error(
				`[oauth-token] LastMile MCP refresh failed: ${res.status} ${errText}`,
			);
			await db
				.update(userMcpTokens)
				.set({ status: "expired", updated_at: new Date() })
				.where(eq(userMcpTokens.id, userMcpTokenId));
			return null;
		}
		refreshJson = await res.json();
	} catch (err) {
		console.error(`[oauth-token] LastMile MCP refresh error:`, err);
		return null;
	}

	if (!refreshJson.access_token) {
		console.error(
			`[oauth-token] LastMile MCP refresh returned no access_token for ${secretRef}`,
		);
		return null;
	}

	// Persist the rotated pair back to SM before returning — if this step
	// fails, future resolves will keep handing out the now-invalid old
	// access_token and we'd be in a permanently broken state.
	const updated: StoredMcpToken = {
		access_token: refreshJson.access_token,
		// WorkOS rotates — if it didn't return a new one for some reason,
		// keep the old one (better than null-ing out the refresh_token).
		refresh_token: refreshJson.refresh_token ?? storedToken.refresh_token,
		token_type: refreshJson.token_type ?? storedToken.token_type,
		obtained_at: new Date().toISOString(),
	};
	try {
		await sm.send(
			new UpdateSecretCommand({
				SecretId: secretRef,
				SecretString: JSON.stringify(updated),
			}),
		);
	} catch (err) {
		console.error(
			`[oauth-token] Failed to persist refreshed LastMile MCP token to SM:`,
			err,
		);
		return null;
	}

	// Update the expiry bookkeeping row so the next resolve reads the right
	// expires_at. If WorkOS didn't return expires_in, leave the column alone
	// and fall back to JWT exp on next resolve (not currently implemented).
	if (refreshJson.expires_in) {
		const newExpiresAt = new Date(Date.now() + refreshJson.expires_in * 1000);
		await db
			.update(userMcpTokens)
			.set({ expires_at: newExpiresAt, updated_at: new Date() })
			.where(eq(userMcpTokens.id, userMcpTokenId));
	}

	console.log(
		`[oauth-token] Refreshed LastMile MCP token ${secretRef} (expires_in=${refreshJson.expires_in ?? "?"}s)`,
	);
	return refreshJson.access_token;
}

/**
 * Resolve the per-user LastMile access token from the MCP OAuth path.
 *
 * LastMile users authenticate via the mobile MCP Servers screen, which
 * stores tokens in `user_mcp_tokens` + Secrets Manager at
 * `thinkwork/{stage}/mcp-tokens/{userId}/{mcpServerId}`. The `connections`
 * row created by the whoami hook is just an identity-linking record — it
 * does NOT own the credential. So for LastMile the token lookup goes
 * through the MCP path.
 *
 * Matches the LastMile Tasks MCP server by URL substring (same heuristic
 * as the whoami hook in skills.ts). If there are multiple LastMile MCP
 * servers for the tenant (Tasks, CRM, Data Catalog) we use the Tasks one
 * because that's the only one that currently performs write actions on
 * tasks — when another provider needs writes, re-think this lookup.
 *
 * PR H: this function now proactively refreshes the token when
 * `user_mcp_tokens.expires_at` is within `EXPIRY_BUFFER_MS` of now.
 * Previously we just returned the stored access_token as-is, so every
 * ~15 minutes of idle time the webhook ingest path would start failing
 * with "Invalid WorkOS token" and the user had to manually reconnect
 * from mobile to unblock. Auto-refresh via the stored `refresh_token`
 * closes that gap.
 */
async function resolveLastmileUserToken(
	connectionId: string,
	tenantId: string,
): Promise<string | null> {
	// 1. Get the user_id from the connections row — we can't trust caller
	//    context here because this function is called from executeAction,
	//    webhook ingest, and refresh paths all with different upstream args.
	const [conn] = await db
		.select({ user_id: connections.user_id })
		.from(connections)
		.where(
			and(eq(connections.id, connectionId), eq(connections.tenant_id, tenantId)),
		);
	if (!conn?.user_id) {
		console.warn(
			`[oauth-token] LastMile connection ${connectionId} has no user_id`,
		);
		return null;
	}

	// 2. Find the LastMile Tasks MCP server for this tenant. Match by URL
	//    pattern (host contains "lastmile", path contains "/tasks") to stay
	//    agnostic of whatever slug the admin chose. Also select auth_config
	//    so the refresh helper can reach the WorkOS token endpoint.
	const tenantMcpRows = await db
		.select({
			id: tenantMcpServers.id,
			url: tenantMcpServers.url,
			enabled: tenantMcpServers.enabled,
			auth_config: tenantMcpServers.auth_config,
		})
		.from(tenantMcpServers)
		.where(eq(tenantMcpServers.tenant_id, tenantId));
	const tasksMcp = tenantMcpRows.find(
		(r) =>
			r.enabled &&
			r.url.toLowerCase().includes("lastmile") &&
			r.url.toLowerCase().includes("/tasks"),
	);
	if (!tasksMcp) {
		console.warn(
			`[oauth-token] No LastMile Tasks MCP server configured for tenant ${tenantId}`,
		);
		return null;
	}

	// 3. Read the user's token row AND its expiry.
	const [tok] = await db
		.select({
			id: userMcpTokens.id,
			secret_ref: userMcpTokens.secret_ref,
			status: userMcpTokens.status,
			expires_at: userMcpTokens.expires_at,
		})
		.from(userMcpTokens)
		.where(
			and(
				eq(userMcpTokens.user_id, conn.user_id),
				eq(userMcpTokens.mcp_server_id, tasksMcp.id),
				eq(userMcpTokens.status, "active"),
			),
		);
	if (!tok?.secret_ref) {
		console.warn(
			`[oauth-token] No active MCP token for user ${conn.user_id} on LastMile Tasks`,
		);
		return null;
	}

	// 4. Pull the full token blob out of Secrets Manager.
	let storedToken: StoredMcpToken;
	try {
		const result = await sm.send(
			new GetSecretValueCommand({ SecretId: tok.secret_ref }),
		);
		if (!result.SecretString) return null;
		storedToken = JSON.parse(result.SecretString) as StoredMcpToken;
	} catch (err) {
		if (err instanceof ResourceNotFoundException) {
			console.warn(
				`[oauth-token] SM secret missing for LastMile MCP token: ${tok.secret_ref}`,
			);
			return null;
		}
		throw err;
	}
	if (!storedToken.access_token) return null;

	// 5. Check expiry (PR H). Refresh if within the buffer OR if the row
	//    is missing an `expires_at` column entirely (pre-PR-H rows) AND
	//    the secret's `obtained_at` is older than the buffer.
	const needsRefresh = (() => {
		if (tok.expires_at) {
			return new Date(tok.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;
		}
		// No expires_at column — fall back to obtained_at + a conservative
		// 15-minute lifetime (WorkOS default) minus the buffer.
		if (storedToken.obtained_at) {
			const obtainedMs = new Date(storedToken.obtained_at).getTime();
			const assumedLifetimeMs = 15 * 60 * 1000;
			return Date.now() - obtainedMs > assumedLifetimeMs - EXPIRY_BUFFER_MS;
		}
		// Nothing to go on — don't preemptively refresh; let the call fail
		// and the next invocation will see expires_at after the refresh
		// (which also stamps it).
		return false;
	})();

	if (!needsRefresh) {
		return storedToken.access_token;
	}

	// 6. Refresh. Extract endpoint + client_id from the MCP server's auth_config.
	const authCfg = (tasksMcp.auth_config as McpTokenAuthConfig | null) ?? {};
	const tokenEndpoint = authCfg.token_endpoint;
	const clientId = authCfg.client_id;
	if (!tokenEndpoint || !clientId) {
		console.warn(
			`[oauth-token] LastMile Tasks MCP ${tasksMcp.id} has no token_endpoint/client_id in auth_config — cannot refresh; returning stale token`,
		);
		// Hand back the stale token — the MCP call will fail with "Invalid
		// WorkOS token" and the webhook ingest will fall back to synthetic,
		// same as before PR H. Not worse than the pre-PR-H state.
		return storedToken.access_token;
	}
	const refreshed = await refreshLastmileMcpToken({
		secretRef: tok.secret_ref,
		storedToken,
		userMcpTokenId: tok.id,
		tokenEndpoint,
		clientId,
	});
	return refreshed ?? storedToken.access_token;
}
