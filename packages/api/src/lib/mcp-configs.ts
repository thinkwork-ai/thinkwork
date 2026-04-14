/**
 * Build MCP server configs for an agent invocation.
 *
 * Queries `agent_mcp_servers` ⋈ `tenant_mcp_servers`, resolves auth
 * (tenant_api_key → auth_config, per_user_oauth → user_mcp_tokens +
 * Secrets Manager, with refresh-on-expiry), and returns the list of
 * servers the runtime container should connect to. Servers whose auth
 * can't be resolved are logged and skipped.
 *
 * Called from both the wakeup processor (scheduled/triggered
 * invocations) and chat-agent-invoke (direct chat turns).
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
	tenantMcpServers,
	agentMcpServers,
	userMcpTokens,
} from "@thinkwork/database-pg/schema";
import {
	SecretsManagerClient,
	GetSecretValueCommand,
	UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";

export interface McpServerConfig {
	name: string;
	url: string;
	transport: "streamable-http" | "sse";
	auth?: { type: string; token: string };
	tools?: string[];
}

const db = getDb();

export async function buildMcpConfigs(
	agentId: string,
	humanPairId: string | null | undefined,
	logPrefix = "[mcp-configs]",
): Promise<McpServerConfig[]> {
	const mcpConfigs: McpServerConfig[] = [];

	const mcpRows = await db
		.select({
			mcp_server_id: tenantMcpServers.id,
			name: tenantMcpServers.name,
			slug: tenantMcpServers.slug,
			url: tenantMcpServers.url,
			transport: tenantMcpServers.transport,
			auth_type: tenantMcpServers.auth_type,
			auth_config: tenantMcpServers.auth_config,
			server_enabled: tenantMcpServers.enabled,
			assignment_enabled: agentMcpServers.enabled,
			assignment_config: agentMcpServers.config,
		})
		.from(agentMcpServers)
		.innerJoin(tenantMcpServers, eq(agentMcpServers.mcp_server_id, tenantMcpServers.id))
		.where(and(eq(agentMcpServers.agent_id, agentId), eq(agentMcpServers.enabled, true)));

	for (const mcp of mcpRows) {
		if (!mcp.server_enabled) continue;

		let token: string | undefined;

		if (mcp.auth_type === "tenant_api_key") {
			const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
			token = authCfg.token as string | undefined;
		} else if (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") {
			if (humanPairId) {
				try {
					const [userToken] = await db
						.select({
							secret_ref: userMcpTokens.secret_ref,
							status: userMcpTokens.status,
							expires_at: userMcpTokens.expires_at,
						})
						.from(userMcpTokens)
						.where(and(
							eq(userMcpTokens.user_id, humanPairId),
							eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id),
							eq(userMcpTokens.status, "active"),
						))
						.limit(1);
					if (userToken?.secret_ref) {
						const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
						const secret = await sm.send(new GetSecretValueCommand({ SecretId: userToken.secret_ref }));
						if (secret.SecretString) {
							const parsed = JSON.parse(secret.SecretString);
							const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
							const isExpired = userToken.expires_at &&
								new Date(userToken.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;

							if (isExpired && parsed.refresh_token) {
								console.log(`${logPrefix} MCP token expired for ${mcp.slug}, refreshing...`);
								try {
									const mcpBaseUrl = mcp.url.replace(/\/+$/, "");
									const serverPath = new URL(mcpBaseUrl).pathname.replace(/^\//, "");
									const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;
									const resMeta = await fetch(wellKnownUrl, { signal: AbortSignal.timeout(5000) });
									if (resMeta.ok) {
										const meta = await resMeta.json() as { authorization_servers?: string[] };
										const authServer = meta.authorization_servers?.[0];
										if (authServer) {
											const authMetaRes = await fetch(`${authServer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) })
												.catch(() => null);
											const oidcRes = authMetaRes?.ok ? authMetaRes : await fetch(`${authServer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
											if (oidcRes.ok) {
												const authMeta = await oidcRes.json() as { token_endpoint: string };
												const refreshRes = await fetch(authMeta.token_endpoint, {
													method: "POST",
													headers: { "Content-Type": "application/x-www-form-urlencoded" },
													body: new URLSearchParams({
														grant_type: "refresh_token",
														refresh_token: parsed.refresh_token,
													}).toString(),
													signal: AbortSignal.timeout(10000),
												});
												if (refreshRes.ok) {
													const refreshData = await refreshRes.json() as {
														access_token: string;
														refresh_token?: string;
														expires_in?: number;
													};
													token = refreshData.access_token;
													const updatedSecret = {
														access_token: refreshData.access_token,
														refresh_token: refreshData.refresh_token || parsed.refresh_token,
														token_type: parsed.token_type || "Bearer",
														obtained_at: new Date().toISOString(),
													};
													await sm.send(new UpdateSecretCommand({
														SecretId: userToken.secret_ref,
														SecretString: JSON.stringify(updatedSecret),
													}));
													const newExpiry = refreshData.expires_in
														? new Date(Date.now() + refreshData.expires_in * 1000)
														: null;
													await db.update(userMcpTokens).set({
														expires_at: newExpiry,
														updated_at: new Date(),
													}).where(eq(userMcpTokens.user_id, humanPairId));
													console.log(`${logPrefix} MCP token refreshed for ${mcp.slug}`);
												} else {
													console.warn(`${logPrefix} MCP token refresh failed for ${mcp.slug}: ${refreshRes.status}`);
													await db.update(userMcpTokens).set({ status: "expired", updated_at: new Date() })
														.where(and(eq(userMcpTokens.user_id, humanPairId), eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id)));
												}
											}
										}
									}
								} catch (refreshErr) {
									console.warn(`${logPrefix} MCP token refresh error for ${mcp.slug}:`, refreshErr);
								}
							} else {
								token = parsed.access_token;
							}
						}
					} else {
						console.warn(`${logPrefix} No active MCP token for user ${humanPairId} (MCP: ${mcp.slug})`);
					}
				} catch (err) {
					console.warn(`${logPrefix} MCP token lookup failed for ${mcp.slug}:`, err);
				}
			}
		}

		if (mcp.auth_type === "tenant_api_key" && !token) {
			console.warn(`${logPrefix} Skipping MCP ${mcp.slug}: tenant API key not configured`);
			continue;
		}
		if ((mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") && !token) {
			console.warn(`${logPrefix} Skipping MCP ${mcp.slug}: user has not completed OAuth`);
			continue;
		}

		const assignCfg = (mcp.assignment_config as Record<string, unknown>) || {};
		mcpConfigs.push({
			name: mcp.slug,
			url: mcp.url,
			transport: (mcp.transport as "streamable-http" | "sse") || "streamable-http",
			auth: token ? { type: "bearer", token } : undefined,
			tools: Array.isArray(assignCfg.toolAllowlist) ? assignCfg.toolAllowlist as string[] : undefined,
		});
	}

	if (mcpConfigs.length > 0) {
		console.log(`${logPrefix} MCP configs built: ${mcpConfigs.length} servers (${mcpConfigs.map((c) => c.name).join(", ")})`);
	}

	return mcpConfigs;
}
