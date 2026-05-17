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

import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { schema } from "@thinkwork/database-pg";

const {
  connections,
  connectProviders,
  credentials,
  userMcpTokens,
  tenantMcpServers,
} = schema;
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  UpdateSecretCommand,
  // CreateSecretCommand - not needed for refresh, only for initial token storage
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";
import {
  getOAuthClientCredentials,
  isSecretsManagerProvider,
} from "./oauth-client-credentials.js";

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
 * Resolve an active connection row for a provider-native user id, given the
 * provider name. Webhooks carry the
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
): Promise<{
  connectionId: string;
  tenantId: string;
  userId: string;
  providerId: string;
  defaultAgentId?: string;
} | null> {
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
    .innerJoin(
      connectProviders,
      eq(connections.provider_id, connectProviders.id),
    )
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
    .innerJoin(
      connectProviders,
      eq(connections.provider_id, connectProviders.id),
    )
    .where(
      and(
        eq(connections.tenant_id, tenantId),
        eq(connections.user_id, userId),
        eq(connectProviders.name, providerName),
        eq(connections.status, "active"),
      ),
    )
    .orderBy(desc(connections.updated_at), desc(connections.created_at))
    .limit(1);

  if (!row) return null;
  return { connectionId: row.connectionId, providerId: row.providerId };
}

export async function resolveConnectionForUserById(input: {
  tenantId: string;
  userId: string;
  providerName: string;
  connectionId: string;
}): Promise<{ connectionId: string; providerId: string } | null> {
  const [row] = await db
    .select({
      connectionId: connections.id,
      providerId: connections.provider_id,
    })
    .from(connections)
    .innerJoin(
      connectProviders,
      eq(connections.provider_id, connectProviders.id),
    )
    .where(
      and(
        eq(connections.tenant_id, input.tenantId),
        eq(connections.user_id, input.userId),
        eq(connections.id, input.connectionId),
        eq(connectProviders.name, input.providerName),
        eq(connections.status, "active"),
      ),
    )
    .limit(1);

  if (!row) return null;
  return { connectionId: row.connectionId, providerId: row.providerId };
}

/**
 * Resolve a fresh OAuth access token for a given connection.
 * Returns the access token string, or null if resolution fails.
 */
export async function resolveOAuthToken(
  connectionId: string,
  tenantId: string,
  providerId: string,
): Promise<string | null> {
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
      console.warn(
        `[oauth-token] No secret found for connection ${connectionId}`,
      );
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
    console.error(
      `[oauth-token] No refresh token for connection ${connectionId}`,
    );
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

  // Determine client credentials — Google/Microsoft from Secrets Manager (cached per-cold-start).
  let clientId = "";
  let clientSecret = "";
  if (isSecretsManagerProvider(provider.name)) {
    try {
      const creds = await getOAuthClientCredentials(provider.name);
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
    } catch (credErr) {
      console.error(
        `[oauth-token] Client credentials fetch failed for ${provider.name}:`,
        credErr,
      );
      await markConnectionExpired(
        connectionId,
        tenantId,
        "client_creds_missing",
      );
      return null;
    }
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
      console.error(
        `[oauth-token] Refresh failed for ${connectionId}: ${refreshRes.status} ${errText}`,
      );
      await markConnectionExpired(
        connectionId,
        tenantId,
        "token_refresh_failed",
      );
      return null;
    }

    const refreshResult = (await refreshRes.json()) as TokenRefreshResult;

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
    console.error(
      `[oauth-token] Token refresh error for ${connectionId}:`,
      err,
    );
    await markConnectionExpired(connectionId, tenantId, "token_refresh_error");
    return null;
  }
}

export async function resolveOAuthTokenDetails(
  connectionId: string,
  tenantId: string,
  providerId: string,
): Promise<{ accessToken: string; grantedScopes: string[] } | null> {
  const accessToken = await resolveOAuthToken(
    connectionId,
    tenantId,
    providerId,
  );
  if (!accessToken) return null;

  const secretId = `thinkwork/${STAGE}/oauth/${connectionId}`;
  try {
    const result = await sm.send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    if (!result.SecretString) {
      return { accessToken, grantedScopes: [] };
    }
    const stored = JSON.parse(result.SecretString) as Partial<StoredOAuthToken>;
    return {
      accessToken,
      grantedScopes: parseGrantedScopes(stored.scope),
    };
  } catch (err) {
    console.warn(
      `[oauth-token] Failed to read granted scopes for connection ${connectionId}:`,
      err,
    );
    return { accessToken, grantedScopes: [] };
  }
}

function parseGrantedScopes(scope: unknown): string[] {
  if (typeof scope !== "string") return [];
  return scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
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
    .innerJoin(
      connectProviders,
      eq(connections.provider_id, connectProviders.id),
    )
    .where(eq(connections.id, connectionId));

  if (!conn || conn.status !== "active") return null;

  const accessToken = await resolveOAuthToken(
    connectionId,
    tenantId,
    conn.provider_id,
  );
  if (!accessToken) return null;

  // Build env vars based on provider type
  const envOverrides: Record<string, string> = {};

  if (conn.provider_name === "google_productivity") {
    // Determine which env var name based on skill type or tokenEnvVar hint
    const skillType = (skillConfig.skillType as string) || "";
    const tokenEnvVar = (skillConfig.tokenEnvVar as string) || "";
    if (
      skillType === "google-calendar" ||
      tokenEnvVar === "GCAL_ACCESS_TOKEN"
    ) {
      envOverrides.GCAL_ACCESS_TOKEN = accessToken;
      envOverrides.GCAL_CONNECTION_ID = connectionId;
    } else {
      // Default to Gmail
      envOverrides.GMAIL_ACCESS_TOKEN = accessToken;
      envOverrides.GMAIL_CONNECTION_ID = connectionId;
    }
  } else if (conn.provider_name === "microsoft_365") {
    const skillType = (skillConfig.skillType as string) || "";
    const tokenEnvVar = (skillConfig.tokenEnvVar as string) || "";
    if (
      skillType === "microsoft-calendar" ||
      tokenEnvVar === "MSCAL_ACCESS_TOKEN"
    ) {
      envOverrides.MSCAL_ACCESS_TOKEN = accessToken;
      envOverrides.MSCAL_CONNECTION_ID = connectionId;
    } else {
      envOverrides.MSGRAPH_ACCESS_TOKEN = accessToken;
      envOverrides.MSGRAPH_CONNECTION_ID = connectionId;
    }
  } else if (conn.provider_name === "github") {
    // GitHub user OAuth token — exposed to the sandbox for `gh` CLI, the
    // github REST API, and typed GitHub skills. Scope set at authorize time
    // (repo / read:org / user:email per the sandbox plan).
    envOverrides.GITHUB_ACCESS_TOKEN = accessToken;
    envOverrides.GITHUB_CONNECTION_ID = connectionId;
  } else if (conn.provider_name === "slack") {
    // Slack user OAuth token — agents post on behalf of the invoking user.
    // Scope set at authorize time (chat:write / channels:read / users:read
    // per the sandbox plan).
    envOverrides.SLACK_ACCESS_TOKEN = accessToken;
    envOverrides.SLACK_CONNECTION_ID = connectionId;
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
    .innerJoin(
      connectProviders,
      eq(connections.provider_id, connectProviders.id),
    )
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
