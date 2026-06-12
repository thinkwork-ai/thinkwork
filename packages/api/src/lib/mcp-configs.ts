/**
 * Build MCP server configs for an agent invocation.
 *
 * Queries `agent_mcp_servers` ⋈ `tenant_mcp_servers`, resolves auth
 * (tenant_api_key → auth_config, per_user_oauth → user_mcp_tokens +
 * Secrets Manager, with refresh-on-expiry), and returns the list of
 * servers the runtime container should connect to. Servers whose auth
 * can't be resolved are logged and skipped.
 *
 * Requester identity (plan 2026-06-12-001 U6): callers pass BOTH halves
 * of the dispatch identity explicitly —
 *
 *   - `humanPairId`      — the agent's paired human; resolves DIRECT
 *     `per_user_oauth` servers via user_mcp_tokens exactly as before (R16).
 *   - `requesterUserId`  — the thread-turn / job owner; resolves
 *     PLUGIN-managed servers (management_source='plugin') via
 *     user_plugin_activation_tokens by (requester, plugin_install_id,
 *     resource indicator), with refresh-on-expiry per token record.
 *     Refresh failure flips the activation to needs_reauth and skips that
 *     plugin's servers (log, never throw). A null requester excludes ALL
 *     plugin servers (fail closed).
 *
 * URL dedupe: when a plugin server and a direct server share an endpoint
 * URL, the dispatch includes the plugin entry for users whose activation
 * resolves, else the direct entry (if its own auth resolves) — never both.
 *
 * Called from the wakeup processor (scheduled/triggered invocations),
 * chat-agent-invoke via resolve-agent-runtime-config (direct chat turns),
 * and mcp-proxy (interactive tool calls).
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
import { mcpHashMatches } from "./mcp-server-hash.js";
import type { PluginDispatchAuthResolver } from "./plugins/activation.js";
import { resolveMcpOAuthResource } from "./mcp-oauth-client.js";

export interface McpServerConfig {
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  auth?: { type: string; token: string };
  tools?: string[];
  availableTools?: string[];
}

/** Dispatch identity for MCP auth resolution — see module doc. */
export interface McpRequesterIdentity {
  humanPairId: string | null | undefined;
  requesterUserId: string | null | undefined;
}

export interface BuildMcpConfigsDeps {
  /** Injectable for tests; defaults to the Drizzle/SecretsManager resolver. */
  pluginAuth?: PluginDispatchAuthResolver;
}

const db = getDb();

function normalizeServerUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function buildMcpConfigs(
  agentId: string,
  requester: McpRequesterIdentity | null,
  logPrefix = "[mcp-configs]",
  deps: BuildMcpConfigsDeps = {},
): Promise<McpServerConfig[]> {
  const humanPairId = requester?.humanPairId ?? null;
  const requesterUserId = requester?.requesterUserId ?? null;
  const mcpConfigs: McpServerConfig[] = [];

  // U11 gate: only approved + enabled servers whose pinned `url_hash`
  // still matches (url, auth_config) reach the runtime. Pending /
  // rejected rows, and approved rows whose fields drifted, are dropped
  // here with a log line so operators see the reason a capability
  // vanished. This is the SI-5 defensive layer.
  const mcpRows = await db
    .select({
      mcp_server_id: tenantMcpServers.id,
      name: tenantMcpServers.name,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      transport: tenantMcpServers.transport,
      auth_type: tenantMcpServers.auth_type,
      auth_config: tenantMcpServers.auth_config,
      tools: tenantMcpServers.tools,
      server_enabled: tenantMcpServers.enabled,
      server_status: tenantMcpServers.status,
      server_url_hash: tenantMcpServers.url_hash,
      management_source: tenantMcpServers.management_source,
      plugin_install_id: tenantMcpServers.plugin_install_id,
      assignment_enabled: agentMcpServers.enabled,
      assignment_config: agentMcpServers.config,
    })
    .from(agentMcpServers)
    .innerJoin(
      tenantMcpServers,
      eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
    )
    .where(
      and(
        eq(agentMcpServers.agent_id, agentId),
        eq(agentMcpServers.enabled, true),
        eq(tenantMcpServers.status, "approved"),
        eq(tenantMcpServers.enabled, true),
      ),
    );

  // Plugin rows resolve FIRST so the URL-dedupe pass below can give the
  // plugin entry precedence over a direct entry sharing the endpoint.
  const isPluginRow = (row: (typeof mcpRows)[number]): boolean =>
    row.management_source === "plugin" && Boolean(row.plugin_install_id);
  const orderedRows = [
    ...mcpRows.filter(isPluginRow),
    ...mcpRows.filter((row) => !isPluginRow(row)),
  ];
  /** Normalized URLs of plugin entries that made it into the dispatch. */
  const includedPluginUrls = new Set<string>();
  // Lazy (dynamic import): the activation module — and its store/engine
  // dependency graph — only loads when a plugin row actually needs
  // resolving in this invocation.
  let pluginAuth: PluginDispatchAuthResolver | null = deps.pluginAuth ?? null;
  const getPluginAuth = async (): Promise<PluginDispatchAuthResolver> => {
    if (!pluginAuth) {
      const activation = await import("./plugins/activation.js");
      pluginAuth = activation.createPluginDispatchAuthResolver();
    }
    return pluginAuth;
  };

  for (const mcp of orderedRows) {
    if (!mcp.server_enabled) continue;
    // Defensive invariant: the SQL WHERE already filters by
    // status='approved', but drift between `url_hash` and the
    // current (url, auth_config) indicates the approval no longer
    // applies. Treat as pending without blocking the rest of the
    // agent's MCP fleet.
    //
    // `url_hash IS NULL` means the row was pre-existing at the U3
    // migration (which grandfathered live servers in as approved
    // without computing a hash) — allow it. U11 approvals always
    // write url_hash, so future mutations are hash-guarded.
    if (
      mcp.server_url_hash &&
      !mcpHashMatches(
        mcp.server_url_hash,
        mcp.url,
        mcp.auth_config as Record<string, unknown> | null,
      )
    ) {
      console.warn(
        `${logPrefix} skipping ${mcp.slug}: url_hash mismatch with (url, auth_config); re-approval required`,
      );
      continue;
    }

    // ── Plugin-managed servers (management_source='plugin') ──────────
    // Auth resolves from the REQUESTER's app-level activation, never
    // from humanPairId. No resolvable requester → fail closed.
    if (isPluginRow(mcp)) {
      if (!requesterUserId) {
        console.warn(
          `${logPrefix} Skipping plugin MCP ${mcp.slug}: no resolvable requesting user (fail closed)`,
        );
        continue;
      }
      const pluginInstallId = mcp.plugin_install_id as string;
      let pluginToken: string | undefined;
      if (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") {
        const resource = resolveMcpOAuthResource({
          serverUrl: mcp.url,
          authConfig: mcp.auth_config as Record<string, unknown> | null,
        });
        const resolved = await (
          await getPluginAuth()
        ).resolveToken({
          requesterUserId,
          pluginInstallId,
          resource,
          slug: mcp.slug ?? mcp.name,
          logPrefix,
        });
        if (!resolved) continue;
        pluginToken = resolved;
      } else {
        // Non-OAuth plugin servers still gate on the requester's active
        // activation (R14: install alone exposes nothing to end users).
        const active = await (
          await getPluginAuth()
        ).hasActiveActivation(requesterUserId, pluginInstallId);
        if (!active) {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${mcp.slug}: requester has no active activation`,
          );
          continue;
        }
      }
      mcpConfigs.push(toMcpServerConfig(mcp, pluginToken));
      includedPluginUrls.add(normalizeServerUrl(mcp.url));
      continue;
    }

    // ── Direct servers ────────────────────────────────────────────────
    // URL dedupe: a plugin entry with the same endpoint already resolved
    // for this requester wins — never dispatch both.
    if (includedPluginUrls.has(normalizeServerUrl(mcp.url))) {
      console.log(
        `${logPrefix} Skipping direct MCP ${mcp.slug}: deduped against an active plugin server with the same URL`,
      );
      continue;
    }

    let token: string | undefined;

    if (mcp.auth_type === "tenant_api_key") {
      const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
      token = await resolveTenantApiKeyToken(authCfg, logPrefix, mcp.slug);
    } else if (
      mcp.auth_type === "oauth" ||
      mcp.auth_type === "per_user_oauth"
    ) {
      if (humanPairId) {
        try {
          const [userToken] = await db
            .select({
              id: userMcpTokens.id,
              secret_ref: userMcpTokens.secret_ref,
              status: userMcpTokens.status,
              expires_at: userMcpTokens.expires_at,
            })
            .from(userMcpTokens)
            .where(
              and(
                eq(userMcpTokens.user_id, humanPairId),
                eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id),
                eq(userMcpTokens.status, "active"),
              ),
            )
            .limit(1);
          if (userToken?.secret_ref) {
            const sm = new SecretsManagerClient({
              region: process.env.AWS_REGION || "us-east-1",
            });
            const secret = await sm.send(
              new GetSecretValueCommand({ SecretId: userToken.secret_ref }),
            );
            if (secret.SecretString) {
              const parsed = JSON.parse(secret.SecretString);
              const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
              const isExpired =
                userToken.expires_at &&
                new Date(userToken.expires_at).getTime() - Date.now() <
                  EXPIRY_BUFFER_MS;

              if (isExpired && parsed.refresh_token) {
                // WorkOS public-client refresh REQUIRES client_id in the body.
                // It's stored in tenant_mcp_servers.auth_config at DCR time.
                const authCfg =
                  (mcp.auth_config as Record<string, unknown>) || {};
                const clientId =
                  typeof authCfg.client_id === "string"
                    ? authCfg.client_id
                    : "";
                if (!clientId) {
                  console.warn(
                    `${logPrefix} MCP token for ${mcp.slug} needs refresh but auth_config.client_id is missing; user must reconnect from mobile to re-run DCR`,
                  );
                  token = parsed.access_token;
                } else {
                  console.log(
                    `${logPrefix} MCP token expired for ${mcp.slug}, refreshing...`,
                  );
                  try {
                    const mcpBaseUrl = mcp.url.replace(/\/+$/, "");
                    const serverPath = new URL(mcpBaseUrl).pathname.replace(
                      /^\//,
                      "",
                    );
                    const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;
                    const resMeta = await fetch(wellKnownUrl, {
                      signal: AbortSignal.timeout(5000),
                    });
                    if (resMeta.ok) {
                      const meta = (await resMeta.json()) as {
                        authorization_servers?: string[];
                      };
                      const authServer = meta.authorization_servers?.[0];
                      if (authServer) {
                        const authMetaRes = await fetch(
                          `${authServer}/.well-known/oauth-authorization-server`,
                          { signal: AbortSignal.timeout(5000) },
                        ).catch(() => null);
                        const oidcRes = authMetaRes?.ok
                          ? authMetaRes
                          : await fetch(
                              `${authServer}/.well-known/openid-configuration`,
                              { signal: AbortSignal.timeout(5000) },
                            );
                        if (oidcRes.ok) {
                          const authMeta = (await oidcRes.json()) as {
                            token_endpoint: string;
                          };
                          const refreshRes = await fetch(
                            authMeta.token_endpoint,
                            {
                              method: "POST",
                              headers: {
                                "Content-Type":
                                  "application/x-www-form-urlencoded",
                              },
                              body: new URLSearchParams({
                                grant_type: "refresh_token",
                                refresh_token: parsed.refresh_token,
                                client_id: clientId,
                              }).toString(),
                              signal: AbortSignal.timeout(10000),
                            },
                          );
                          if (refreshRes.ok) {
                            const refreshData = (await refreshRes.json()) as {
                              access_token: string;
                              refresh_token?: string;
                              expires_in?: number;
                            };
                            token = refreshData.access_token;
                            const updatedSecret = {
                              access_token: refreshData.access_token,
                              refresh_token:
                                refreshData.refresh_token ||
                                parsed.refresh_token,
                              token_type: parsed.token_type || "Bearer",
                              obtained_at: new Date().toISOString(),
                            };
                            await sm.send(
                              new UpdateSecretCommand({
                                SecretId: userToken.secret_ref,
                                SecretString: JSON.stringify(updatedSecret),
                              }),
                            );
                            const newExpiry = refreshData.expires_in
                              ? new Date(
                                  Date.now() + refreshData.expires_in * 1000,
                                )
                              : null;
                            await db
                              .update(userMcpTokens)
                              .set({
                                expires_at: newExpiry,
                                updated_at: new Date(),
                              })
                              .where(eq(userMcpTokens.id, userToken.id));
                            console.log(
                              `${logPrefix} MCP token refreshed for ${mcp.slug}`,
                            );
                          } else {
                            const errBody = await refreshRes
                              .text()
                              .catch(() => "");
                            console.warn(
                              `${logPrefix} MCP token refresh failed for ${mcp.slug}: ${refreshRes.status} ${errBody}`,
                            );
                            await db
                              .update(userMcpTokens)
                              .set({
                                status: "expired",
                                updated_at: new Date(),
                              })
                              .where(eq(userMcpTokens.id, userToken.id));
                          }
                        }
                      }
                    }
                  } catch (refreshErr) {
                    console.warn(
                      `${logPrefix} MCP token refresh error for ${mcp.slug}:`,
                      refreshErr,
                    );
                  }
                }
              } else {
                token = parsed.access_token;
              }
            }
          } else {
            console.warn(
              `${logPrefix} No active MCP token for user ${humanPairId} (MCP: ${mcp.slug})`,
            );
          }
        } catch (err) {
          console.warn(
            `${logPrefix} MCP token lookup failed for ${mcp.slug}:`,
            err,
          );
        }
      }
    }

    if (mcp.auth_type === "tenant_api_key" && !token) {
      console.warn(
        `${logPrefix} Skipping MCP ${mcp.slug}: tenant API key not configured`,
      );
      continue;
    }
    if (
      (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") &&
      !token
    ) {
      console.warn(
        `${logPrefix} Skipping MCP ${mcp.slug}: user has not completed OAuth`,
      );
      continue;
    }

    mcpConfigs.push(toMcpServerConfig(mcp, token));
  }

  if (mcpConfigs.length > 0) {
    console.log(
      `${logPrefix} MCP configs built: ${mcpConfigs.length} servers (${mcpConfigs.map((c) => c.name).join(", ")})`,
    );
  }

  return mcpConfigs;
}

function toMcpServerConfig(
  mcp: {
    slug: string | null;
    name: string;
    url: string;
    transport: string | null;
    tools: unknown;
    assignment_config: unknown;
  },
  token: string | undefined,
): McpServerConfig {
  const assignCfg = (mcp.assignment_config as Record<string, unknown>) || {};
  const toolAllowlist = Array.isArray(assignCfg.toolAllowlist)
    ? (assignCfg.toolAllowlist as string[]).filter(
        (tool): tool is string => typeof tool === "string",
      )
    : undefined;
  const availableTools = extractMcpToolNames(mcp.tools);
  return {
    name: mcp.slug ?? mcp.name,
    url: mcp.url,
    transport:
      (mcp.transport as "streamable-http" | "sse") || "streamable-http",
    auth: token ? { type: "bearer", token } : undefined,
    tools: toolAllowlist,
    availableTools: availableTools.length > 0 ? availableTools : undefined,
  };
}

async function resolveTenantApiKeyToken(
  authCfg: Record<string, unknown>,
  logPrefix: string,
  slug: string,
): Promise<string | undefined> {
  const secretRef =
    typeof authCfg.secretRef === "string" && authCfg.secretRef.trim()
      ? authCfg.secretRef.trim()
      : null;

  if (secretRef) {
    try {
      const sm = new SecretsManagerClient({
        region: process.env.AWS_REGION || "us-east-1",
      });
      const secret = await sm.send(
        new GetSecretValueCommand({ SecretId: secretRef }),
      );
      const token = extractTokenFromSecretString(secret.SecretString);
      if (token) return token;
      console.warn(
        `${logPrefix} tenant API key secret for ${slug} did not contain a token`,
      );
      return undefined;
    } catch (err) {
      console.warn(
        `${logPrefix} tenant API key secret lookup failed for ${slug}:`,
        err,
      );
      return undefined;
    }
  }

  const token = authCfg.token;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

function extractTokenFromSecretString(
  secretString?: string,
): string | undefined {
  if (!secretString) return undefined;
  try {
    const parsed = JSON.parse(secretString) as Record<string, unknown>;
    const token = parsed.token ?? parsed.apiKey ?? parsed.access_token;
    return typeof token === "string" && token.length > 0 ? token : undefined;
  } catch {
    return secretString.length > 0 ? secretString : undefined;
  }
}

function extractMcpToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names = value
    .map((tool) => {
      if (typeof tool === "string") return tool;
      if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
        return "";
      }
      const name = (tool as Record<string, unknown>).name;
      return typeof name === "string" ? name : "";
    })
    .filter((name) => name.length > 0);
  return [...new Set(names)];
}
