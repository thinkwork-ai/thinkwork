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
 *     PLUGIN-managed OAuth MCP servers (management_source='plugin') via
 *     user_mcp_tokens for that requester and server. The plugin owns the MCP
 *     server registration/lifecycle; each user still authenticates to the MCP
 *     server individually. Plugin-managed user_headers servers continue to use
 *     user_plugin_activation_tokens, and service_credential rows are
 *     tenant-owned and resolve server-side without requester activation.
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

export interface McpServerConfig {
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  auth?:
    | { type: "bearer"; token: string }
    | { type: "headers"; headers: Record<string, string> }
    | { type: "bearer"; token: string; headers: Record<string, string> };
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
    // Plugin installation registers and owns the server row, but OAuth MCP
    // access is still per-user MCP auth. Resolve that from the REQUESTER's
    // user_mcp_tokens record, never from humanPairId. user_headers remains an
    // app-level activation shape, and service_credential is tenant-owned.
    if (isPluginRow(mcp)) {
      if (mcp.auth_type === "service_credential") {
        const resolved = await resolveServiceCredentialAuth(
          (mcp.auth_config as Record<string, unknown>) || {},
          logPrefix,
          mcp.slug ?? mcp.name,
        );
        if (!resolved) continue;
        mcpConfigs.push(
          toMcpServerConfig(mcp, resolved.token, resolved.headers),
        );
        includedPluginUrls.add(normalizeServerUrl(mcp.url));
        continue;
      }
      if (!requesterUserId) {
        console.warn(
          `${logPrefix} Skipping plugin MCP ${mcp.slug}: no resolvable requesting user (fail closed)`,
        );
        continue;
      }
      const pluginInstallId = mcp.plugin_install_id as string;
      let pluginToken: string | undefined;
      let pluginHeaders: Record<string, string> | undefined;
      if (mcp.auth_type === "oauth" || mcp.auth_type === "per_user_oauth") {
        pluginToken = await resolveUserMcpBearerToken({
          userId: requesterUserId,
          mcp,
          logPrefix,
          fallbackLabel: "for plugin-registered MCP server",
        });
        if (!pluginToken) continue;
      } else if (mcp.auth_type === "user_headers") {
        const headerNames = userHeaderNamesFromAuthConfig(
          mcp.auth_config as Record<string, unknown> | null,
        );
        const usesBearer = userHeaderAuthUsesBearer(
          mcp.auth_config as Record<string, unknown> | null,
        );
        if (headerNames.length === 0 && !usesBearer) {
          console.warn(
            `${logPrefix} Skipping plugin MCP ${mcp.slug}: user_headers auth_config has no header or bearer bindings`,
          );
          continue;
        }
        if (headerNames.length > 0) {
          const resolved = await (
            await getPluginAuth()
          ).resolveHeaders({
            requesterUserId,
            pluginInstallId,
            resource: mcp.url,
            slug: mcp.slug ?? mcp.name,
            headerNames,
            logPrefix,
          });
          if (!resolved) continue;
          pluginHeaders = resolved;
        }
        if (usesBearer) {
          const resolved = await (
            await getPluginAuth()
          ).resolveToken({
            requesterUserId,
            pluginInstallId,
            resource: mcp.url,
            slug: mcp.slug ?? mcp.name,
            logPrefix,
          });
          if (!resolved) continue;
          pluginToken = resolved;
        }
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
      mcpConfigs.push(toMcpServerConfig(mcp, pluginToken, pluginHeaders));
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
        token = await resolveUserMcpBearerToken({
          userId: humanPairId,
          mcp,
          logPrefix,
        });
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

async function resolveUserMcpBearerToken(args: {
  userId: string;
  mcp: {
    mcp_server_id: string;
    slug: string | null;
    name: string;
    url: string;
    auth_config: unknown;
  };
  logPrefix: string;
  fallbackLabel?: string;
}): Promise<string | undefined> {
  const { userId, mcp, logPrefix } = args;
  const slug = mcp.slug ?? mcp.name;
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
          eq(userMcpTokens.user_id, userId),
          eq(userMcpTokens.mcp_server_id, mcp.mcp_server_id),
          eq(userMcpTokens.status, "active"),
        ),
      )
      .limit(1);
    if (!userToken?.secret_ref) {
      console.warn(
        `${logPrefix} No active MCP token for user ${userId} (MCP: ${slug})`,
      );
      return undefined;
    }

    const sm = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: userToken.secret_ref }),
    );
    if (!secret.SecretString) return undefined;
    const parsed = JSON.parse(secret.SecretString);
    const accessToken =
      typeof parsed.access_token === "string" ? parsed.access_token : "";
    const refreshToken =
      typeof parsed.refresh_token === "string" ? parsed.refresh_token : "";
    const EXPIRY_BUFFER_MS = 5 * 60 * 1000;
    const isExpired =
      userToken.expires_at &&
      new Date(userToken.expires_at).getTime() - Date.now() < EXPIRY_BUFFER_MS;

    if (!isExpired) return accessToken || undefined;
    if (!refreshToken) return accessToken || undefined;

    // WorkOS public-client refresh REQUIRES client_id in the body.
    // It's stored in tenant_mcp_servers.auth_config at DCR time.
    const authCfg = (mcp.auth_config as Record<string, unknown>) || {};
    const clientId =
      typeof authCfg.client_id === "string" ? authCfg.client_id : "";
    if (!clientId) {
      console.warn(
        `${logPrefix} MCP token for ${slug} needs refresh but auth_config.client_id is missing; user must reconnect from mobile to re-run DCR`,
      );
      return accessToken || undefined;
    }

    console.log(
      `${logPrefix} MCP token expired for ${slug}, refreshing${args.fallbackLabel ? ` ${args.fallbackLabel}` : ""}...`,
    );
    try {
      const mcpBaseUrl = mcp.url.replace(/\/+$/, "");
      const serverPath = new URL(mcpBaseUrl).pathname.replace(/^\//, "");
      const wellKnownUrl = `${new URL(mcpBaseUrl).origin}/.well-known/oauth-protected-resource/${serverPath}`;
      const resMeta = await fetch(wellKnownUrl, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resMeta.ok) return undefined;
      const meta = (await resMeta.json()) as {
        authorization_servers?: string[];
      };
      const authServer = meta.authorization_servers?.[0];
      if (!authServer) return undefined;
      const authMetaRes = await fetch(
        `${authServer}/.well-known/oauth-authorization-server`,
        { signal: AbortSignal.timeout(5000) },
      ).catch(() => null);
      const oidcRes = authMetaRes?.ok
        ? authMetaRes
        : await fetch(`${authServer}/.well-known/openid-configuration`, {
            signal: AbortSignal.timeout(5000),
          });
      if (!oidcRes.ok) return undefined;
      const authMeta = (await oidcRes.json()) as {
        token_endpoint: string;
      };
      const refreshRes = await fetch(authMeta.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: clientId,
        }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (!refreshRes.ok) {
        const errBody = await refreshRes.text().catch(() => "");
        console.warn(
          `${logPrefix} MCP token refresh failed for ${slug}: ${refreshRes.status} ${errBody}`,
        );
        await db
          .update(userMcpTokens)
          .set({
            status: "expired",
            updated_at: new Date(),
          })
          .where(eq(userMcpTokens.id, userToken.id));
        return undefined;
      }
      const refreshData = (await refreshRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const refreshedToken = refreshData.access_token;
      const updatedSecret = {
        access_token: refreshedToken,
        refresh_token: refreshData.refresh_token || refreshToken,
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
        ? new Date(Date.now() + refreshData.expires_in * 1000)
        : null;
      await db
        .update(userMcpTokens)
        .set({
          expires_at: newExpiry,
          updated_at: new Date(),
        })
        .where(eq(userMcpTokens.id, userToken.id));
      console.log(`${logPrefix} MCP token refreshed for ${slug}`);
      return refreshedToken;
    } catch (refreshErr) {
      console.warn(
        `${logPrefix} MCP token refresh error for ${slug}:`,
        refreshErr,
      );
      return undefined;
    }
  } catch (err) {
    console.warn(`${logPrefix} MCP token lookup failed for ${slug}:`, err);
    return undefined;
  }
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
  headers?: Record<string, string>,
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
    auth: token
      ? headers
        ? { type: "bearer", token, headers }
        : { type: "bearer", token }
      : headers
        ? { type: "headers", headers }
        : undefined,
    tools: toolAllowlist,
    availableTools: availableTools.length > 0 ? availableTools : undefined,
  };
}

function userHeaderAuthUsesBearer(
  authConfig: Record<string, unknown> | null,
): boolean {
  return typeof authConfig?.bearerCredentialKey === "string";
}

function userHeaderNamesFromAuthConfig(
  authConfig: Record<string, unknown> | null,
): string[] {
  const headers = authConfig?.headers;
  if (!Array.isArray(headers)) return [];
  const names = headers
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return "";
      }
      const name = (entry as Record<string, unknown>).name;
      return typeof name === "string" ? name : "";
    })
    .filter((name) => name.length > 0);
  return [...new Set(names)];
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

interface ResolvedServiceCredentialAuth {
  token?: string;
  headers?: Record<string, string>;
}

interface ServiceCredentialHeaderBinding {
  name: string;
  secretJsonKey: string;
  valuePrefix?: string;
}

async function resolveServiceCredentialAuth(
  authCfg: Record<string, unknown>,
  logPrefix: string,
  slug: string,
): Promise<ResolvedServiceCredentialAuth | undefined> {
  if (typeof authCfg.revokedAt === "string" || authCfg.revoked === true) {
    console.warn(
      `${logPrefix} Skipping MCP ${slug}: service credential is revoked`,
    );
    return undefined;
  }
  const secretRef =
    typeof authCfg.secretRef === "string" && authCfg.secretRef.trim()
      ? authCfg.secretRef.trim()
      : null;
  if (!secretRef) {
    console.warn(
      `${logPrefix} Skipping MCP ${slug}: service credential secret ref is missing`,
    );
    return undefined;
  }
  const bindings = serviceCredentialHeaderBindings(authCfg);
  if (bindings.length === 0) {
    console.warn(
      `${logPrefix} Skipping MCP ${slug}: service credential auth_config has no header bindings`,
    );
    return undefined;
  }

  let secretValue: ServiceCredentialSecretValue | null = null;
  try {
    const sm = new SecretsManagerClient({
      region: process.env.AWS_REGION || "us-east-1",
    });
    const secret = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    secretValue = parseServiceCredentialSecret(secret.SecretString);
  } catch (err) {
    console.warn(
      `${logPrefix} service credential secret lookup failed for ${slug}:`,
      err,
    );
    return undefined;
  }
  if (!secretValue) {
    console.warn(`${logPrefix} service credential secret for ${slug} is empty`);
    return undefined;
  }

  let token: string | undefined;
  const headers: Record<string, string> = {};
  for (const binding of bindings) {
    const raw = serviceCredentialSecretField(
      secretValue,
      binding.secretJsonKey,
    );
    if (!raw) {
      console.warn(
        `${logPrefix} service credential secret for ${slug} is missing key ${binding.secretJsonKey}`,
      );
      return undefined;
    }
    const headerValue = `${binding.valuePrefix ?? ""}${raw}`;
    if (binding.name.toLowerCase() === "authorization") {
      const bearer = headerValue.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
      if (!bearer) {
        console.warn(
          `${logPrefix} service credential Authorization header for ${slug} must use Bearer auth`,
        );
        return undefined;
      }
      token = bearer;
    } else {
      headers[binding.name] = headerValue;
    }
  }

  const extraHeaders = Object.keys(headers).length > 0 ? headers : undefined;
  if (!token && !extraHeaders) {
    console.warn(
      `${logPrefix} service credential auth_config for ${slug} resolved no usable auth material`,
    );
    return undefined;
  }
  return { token, headers: extraHeaders };
}

function serviceCredentialHeaderBindings(
  authCfg: Record<string, unknown>,
): ServiceCredentialHeaderBinding[] {
  const headers = authCfg.headers;
  if (!Array.isArray(headers)) return [];
  const bindings: ServiceCredentialHeaderBinding[] = [];
  for (const header of headers) {
    if (!header || typeof header !== "object" || Array.isArray(header)) {
      continue;
    }
    const entry = header as Record<string, unknown>;
    if (
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.secretJsonKey !== "string" ||
      !entry.secretJsonKey.trim()
    ) {
      continue;
    }
    bindings.push({
      name: entry.name.trim(),
      secretJsonKey: entry.secretJsonKey.trim(),
      ...(typeof entry.valuePrefix === "string"
        ? { valuePrefix: entry.valuePrefix }
        : {}),
    });
  }
  return bindings;
}

type ServiceCredentialSecretValue = Record<string, unknown> | string;

function parseServiceCredentialSecret(
  secretString?: string,
): ServiceCredentialSecretValue | null {
  if (!secretString) return null;
  try {
    const parsed = JSON.parse(secretString) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return secretString.trim() ? secretString : null;
  }
}

function serviceCredentialSecretField(
  secretValue: ServiceCredentialSecretValue,
  key: string,
): string | undefined {
  if (typeof secretValue === "string") {
    return key === "token" && secretValue.trim()
      ? secretValue.trim()
      : undefined;
  }
  const value = secretValue[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
