/**
 * Plugin MCP component handler (plan 2026-06-12-001 U5).
 *
 * Provisioning creates-or-repairs ONE `tenant_mcp_servers` row per
 * `mcp-server` manifest component, owned by the plugin install:
 *
 *   - `management_source: 'plugin'` + `plugin_install_id` are the
 *     ownership markers (generalizing the per-app Twenty branch
 *     in `managed-mcp-applications.ts`).
 *   - Plugin rows land `approved` with a url_hash pin, exactly like
 *     managed-application rows — the admin approved the plugin install,
 *     which subsumes per-server approval.
 *   - OAuth servers use the same per-user `oauth` auth_type as existing
 *     rows, with `auth_config.oauth_resource` carrying the RFC 8707
 *     resource indicator (matches `managedTwentyAuthConfig`).
 *   - User-provided header servers use `auth_type: 'user_headers'`; their
 *     `auth_config` stores only header-name/credential-key bindings. Actual
 *     values live in user_plugin_activation_tokens secrets and resolve at
 *     dispatch time for the requester.
 *   - Tenant service credential servers use `auth_type: 'service_credential'`;
 *     their `auth_config` stores only a managed-app secret ref plus header
 *     metadata. Dispatch resolves the secret server-side without per-user
 *     activation.
 *
 * Direct-add coexistence: when a `manual` row already points at the same
 * endpoint URL, provisioning adopts that row in place instead of creating a
 * duplicate. Existing agent/space/template/token references stay attached to
 * the stable tenant_mcp_servers id while plugin ownership takes over.
 *
 * `endpointFrom` (U10, the ONE allowed endpoint indirection): a component
 * whose endpoint is tenant-specific (Twenty CRM) resolves it at provision
 * time from the tenant's `managed_applications` row — `desired_config
 * [configKey]` carries the application's public URL and `path` replaces
 * the URL path. The resolved URL is recorded on the handler_ref
 * (`resolvedEndpointUrl`) so activation can derive per-instance auth.
 * When the managed app row (or its config key) does not exist yet — a
 * fresh install whose infrastructure component has not been configured —
 * provisioning fails with a readable error and the engine's per-component
 * retry re-drives it after the infra deploy lands.
 *
 * Teardown follows the managed-mcp destroy inventory: user tokens (and
 * their secrets), context tools, agent/template/space assignments, then
 * the server row itself.
 */

import {
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { and, eq, sql } from "drizzle-orm";
import {
  agentMcpServers,
  agents,
  agentTemplateMcpServers,
  managedApplications,
  spaceMcpServers,
  tenantMcpContextTools,
  tenantMcpServers,
  userMcpTokens,
} from "@thinkwork/database-pg/schema";
import type {
  McpRecordLinkHints,
  McpServerComponent,
} from "@thinkwork/plugin-catalog";
import { db as defaultDb } from "../../../graphql/utils.js";
import { computeMcpUrlHash } from "../../mcp-server-hash.js";

type DbLike = typeof defaultDb;

/** handler_ref shape recorded on `mcp-server` component rows. */
export interface McpHandlerRef extends Record<string, unknown> {
  tenantMcpServerId: string;
  /** The endpoint the row was provisioned with (resolved for endpointFrom). */
  resolvedEndpointUrl: string;
}

interface ResolvedPluginMcpEndpoint {
  endpointUrl: string;
  browserBaseUrl?: string;
  managedAppDesiredConfig?: Record<string, unknown>;
}

interface RuntimeRecordLinkHints extends McpRecordLinkHints {
  /** Tenant-specific browser origin, e.g. https://crm.example.com. */
  browserBaseUrl: string;
}

interface McpRuntimeMetadata {
  recordLinkHints?: RuntimeRecordLinkHints;
}

export function pluginMcpServerSlug(
  pluginKey: string,
  componentKey: string,
): string {
  return `${pluginKey}--${componentKey}`;
}

function normalizeMcpEndpointUrl(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function pluginMcpAuthFields(
  component: McpServerComponent,
  endpointUrl: string,
  managedAppDesiredConfig?: Record<string, unknown>,
): {
  auth_type: string;
  auth_config: Record<string, unknown> | null;
} {
  if (component.auth.mode === "oauth") {
    return {
      auth_type: "oauth",
      auth_config: { oauth_resource: component.auth.resourceIndicator },
    };
  }
  if (component.auth.mode === "oauth-per-instance") {
    // Per-instance OAuth (Twenty): the RFC 8707 resource indicator IS the
    // resolved endpoint — same shape the legacy managed-application row
    // carried (`managedTwentyAuthConfig`).
    return {
      auth_type: "oauth",
      auth_config: { oauth_resource: endpointUrl },
    };
  }
  if (component.auth.mode === "user-provided-headers") {
    return {
      auth_type: "user_headers",
      auth_config: {
        ...(component.auth.bearer
          ? { bearerCredentialKey: component.auth.bearer.credentialKey }
          : {}),
        headers: component.auth.headers.map((header) => ({
          name: header.name,
          credentialKey: header.credentialKey,
        })),
      },
    };
  }
  if (component.auth.mode === "tenant-service-credential") {
    const secretRef =
      managedAppDesiredConfig?.[component.auth.secretRefConfigKey];
    if (typeof secretRef !== "string" || secretRef.trim() === "") {
      throw new Error(
        `MCP component "${component.key}": managed application desired_config has no "${component.auth.secretRefConfigKey}" service credential secret ref yet — retry after the deployment configuration lands`,
      );
    }
    return {
      auth_type: "service_credential",
      auth_config: {
        credentialKind: component.auth.credentialKind,
        secretRef: secretRef.trim(),
        secretRefConfigKey: component.auth.secretRefConfigKey,
        headers: component.auth.headers.map((header) => ({
          name: header.name,
          secretJsonKey: header.secretJsonKey,
          ...(header.valuePrefix !== undefined
            ? { valuePrefix: header.valuePrefix }
            : {}),
        })),
      },
    };
  }
  return { auth_type: "none", auth_config: null };
}

function isLocalBrowserOrigin(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.") ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function browserBaseUrlFromPublicUrl(url: URL): string | undefined {
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLocalBrowserOrigin(url)) {
    return url.origin;
  }
  return undefined;
}

function pluginMcpRuntimeMetadata(
  component: McpServerComponent,
  resolvedEndpoint: ResolvedPluginMcpEndpoint,
): McpRuntimeMetadata | null {
  if (!component.recordLinkHints || !resolvedEndpoint.browserBaseUrl) {
    return null;
  }
  return {
    recordLinkHints: {
      ...component.recordLinkHints,
      browserBaseUrl: resolvedEndpoint.browserBaseUrl,
    },
  };
}

/**
 * Resolve the component's endpoint: static `endpointUrl`, or the U10
 * `endpointFrom` indirection against the tenant's managed_applications
 * row (`desired_config[configKey]` + path replacement).
 */
export async function resolvePluginMcpEndpoint(args: {
  tenantId: string;
  component: McpServerComponent;
  db?: DbLike;
}): Promise<string> {
  return (await resolvePluginMcpEndpointContext(args)).endpointUrl;
}

async function resolvePluginMcpEndpointContext(args: {
  tenantId: string;
  component: McpServerComponent;
  db?: DbLike;
}): Promise<ResolvedPluginMcpEndpoint> {
  const { component } = args;
  if (component.endpointUrl) return { endpointUrl: component.endpointUrl };
  const endpointFrom = component.endpointFrom;
  if (!endpointFrom) {
    throw new Error(
      `MCP component "${component.key}" declares neither endpointUrl nor endpointFrom`,
    );
  }

  const db = args.db ?? defaultDb;
  const [row] = (await db
    .select({ desired_config: managedApplications.desired_config })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, args.tenantId),
        eq(managedApplications.key, endpointFrom.managedApp),
      ),
    )
    .limit(1)) as { desired_config: unknown }[];
  if (!row) {
    throw new Error(
      `MCP component "${component.key}": managed application "${endpointFrom.managedApp}" has no row for this tenant yet — retry after its infrastructure component is configured and deployed`,
    );
  }
  const desiredConfig = (row.desired_config ?? {}) as Record<string, unknown>;
  const baseUrl = desiredConfig[endpointFrom.configKey];
  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new Error(
      `MCP component "${component.key}": managed application "${endpointFrom.managedApp}" desired_config has no "${endpointFrom.configKey}" value yet — retry after the deployment configuration lands`,
    );
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(
      `MCP component "${component.key}": "${endpointFrom.configKey}" value "${baseUrl}" is not a valid URL`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      `MCP component "${component.key}": "${endpointFrom.configKey}" value must be an http(s) URL`,
    );
  }
  if (endpointFrom.path) url.pathname = endpointFrom.path;
  url.search = "";
  url.hash = "";
  return {
    endpointUrl: url.toString().replace(/\/$/, ""),
    browserBaseUrl: browserBaseUrlFromPublicUrl(new URL(baseUrl)),
    managedAppDesiredConfig: desiredConfig,
  };
}

export async function provisionPluginMcpComponent(args: {
  tenantId: string;
  pluginInstallId: string;
  pluginKey: string;
  component: McpServerComponent;
  db?: DbLike;
}): Promise<McpHandlerRef> {
  const db = args.db ?? defaultDb;
  const slug = pluginMcpServerSlug(args.pluginKey, args.component.key);
  const resolvedEndpoint = await resolvePluginMcpEndpointContext({
    tenantId: args.tenantId,
    component: args.component,
    db,
  });
  const endpointUrl = resolvedEndpoint.endpointUrl;
  const { auth_type, auth_config } = pluginMcpAuthFields(
    args.component,
    endpointUrl,
    resolvedEndpoint.managedAppDesiredConfig,
  );
  const urlHash = computeMcpUrlHash(endpointUrl, auth_config);
  const runtimeMetadata = pluginMcpRuntimeMetadata(
    args.component,
    resolvedEndpoint,
  );

  const [existing] = (await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, args.tenantId),
        eq(tenantMcpServers.plugin_install_id, args.pluginInstallId),
        eq(tenantMcpServers.slug, slug),
      ),
    )
    .limit(1)) as { id: string }[];

  const rowValues = {
    name: args.component.displayName,
    slug,
    url: endpointUrl,
    transport: "streamable-http",
    auth_type,
    auth_config,
    runtime_metadata: runtimeMetadata,
    enabled: true,
    management_source: "plugin",
    plugin_install_id: args.pluginInstallId,
    status: "approved",
    url_hash: urlHash,
    approved_at: new Date(),
  };

  if (existing) {
    await db
      .update(tenantMcpServers)
      .set({ ...rowValues, approved_by: null, updated_at: new Date() })
      .where(eq(tenantMcpServers.id, existing.id));
    await ensurePluginMcpDefaultAgentAssignments(
      db,
      args.tenantId,
      existing.id,
    );
    return { tenantMcpServerId: existing.id, resolvedEndpointUrl: endpointUrl };
  }

  const [manualSameEndpoint] = (await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, args.tenantId),
        eq(tenantMcpServers.management_source, "manual"),
        sql`regexp_replace(lower(trim(${tenantMcpServers.url})), '/+$', '') = ${normalizeMcpEndpointUrl(endpointUrl)}`,
      ),
    )
    .limit(1)) as { id: string }[];

  if (manualSameEndpoint) {
    await db
      .update(tenantMcpServers)
      .set({ ...rowValues, approved_by: null, updated_at: new Date() })
      .where(eq(tenantMcpServers.id, manualSameEndpoint.id));
    await ensurePluginMcpDefaultAgentAssignments(
      db,
      args.tenantId,
      manualSameEndpoint.id,
    );
    return {
      tenantMcpServerId: manualSameEndpoint.id,
      resolvedEndpointUrl: endpointUrl,
    };
  }

  const [inserted] = (await db
    .insert(tenantMcpServers)
    .values({ tenant_id: args.tenantId, ...rowValues })
    .returning({ id: tenantMcpServers.id })) as { id: string }[];
  if (!inserted) {
    throw new Error(
      `Plugin MCP server row insert returned no row (slug ${slug})`,
    );
  }
  await ensurePluginMcpDefaultAgentAssignments(db, args.tenantId, inserted.id);
  return { tenantMcpServerId: inserted.id, resolvedEndpointUrl: endpointUrl };
}

export async function teardownPluginMcpComponent(args: {
  tenantId: string;
  handlerRef: Record<string, unknown>;
  db?: DbLike;
  secretsManager?: Pick<SecretsManagerClient, "send">;
}): Promise<void> {
  const db = args.db ?? defaultDb;
  const serverId =
    typeof args.handlerRef.tenantMcpServerId === "string"
      ? args.handlerRef.tenantMcpServerId
      : null;
  if (!serverId) return; // never provisioned — nothing to tear down

  const tokens = (await db
    .select({ id: userMcpTokens.id, secret_ref: userMcpTokens.secret_ref })
    .from(userMcpTokens)
    .where(eq(userMcpTokens.mcp_server_id, serverId))) as {
    id: string;
    secret_ref: string;
  }[];

  const sm =
    args.secretsManager ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  for (const token of tokens) {
    if (!token.secret_ref) continue;
    try {
      await sm.send(
        new DeleteSecretCommand({
          SecretId: token.secret_ref,
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (error) {
      console.warn(
        "[plugin-mcp] Failed to delete MCP token secret:",
        (error as Error).message,
      );
    }
  }

  await db
    .delete(userMcpTokens)
    .where(eq(userMcpTokens.mcp_server_id, serverId));
  await db
    .delete(tenantMcpContextTools)
    .where(eq(tenantMcpContextTools.mcp_server_id, serverId));
  await db
    .delete(agentMcpServers)
    .where(eq(agentMcpServers.mcp_server_id, serverId));
  await db
    .delete(agentTemplateMcpServers)
    .where(eq(agentTemplateMcpServers.mcp_server_id, serverId));
  await db
    .delete(spaceMcpServers)
    .where(eq(spaceMcpServers.mcp_server_id, serverId));
  await db
    .delete(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, serverId),
        eq(tenantMcpServers.tenant_id, args.tenantId),
      ),
    );
}

async function ensurePluginMcpDefaultAgentAssignments(
  db: DbLike,
  tenantId: string,
  serverId: string,
) {
  const platformAgents = (await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    )) as { id: string }[];

  for (const agent of platformAgents) {
    await db
      .insert(agentMcpServers)
      .values({
        agent_id: agent.id,
        tenant_id: tenantId,
        mcp_server_id: serverId,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [agentMcpServers.agent_id, agentMcpServers.mcp_server_id],
        set: { enabled: true, updated_at: new Date() },
      });
  }
}
