/**
 * Plugin MCP component handler (plan 2026-06-12-001 U5).
 *
 * Provisioning creates-or-repairs ONE `tenant_mcp_servers` row per
 * `mcp-server` manifest component, owned by the plugin install:
 *
 *   - `management_source: 'plugin'` + `plugin_install_id` are the
 *     ownership markers (generalizing the per-app Twenty/Kestra branches
 *     in `managed-mcp-applications.ts`).
 *   - Plugin rows land `approved` with a url_hash pin, exactly like
 *     managed-application rows — the admin approved the plugin install,
 *     which subsumes per-server approval.
 *   - OAuth servers use the same per-user `oauth` auth_type as existing
 *     rows, with `auth_config.oauth_resource` carrying the RFC 8707
 *     resource indicator (matches `managedTwentyAuthConfig`).
 *
 * Direct-add coexistence: a `manual` row with the same endpoint URL is
 * left untouched and the plugin row is created anyway — dispatch-time
 * dedupe-by-URL is U6/U7's concern.
 *
 * Teardown follows the managed-mcp destroy inventory: user tokens (and
 * their secrets), context tools, agent/template/space assignments, then
 * the server row itself.
 */

import {
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { and, eq } from "drizzle-orm";
import {
  agentMcpServers,
  agents,
  agentTemplateMcpServers,
  spaceMcpServers,
  tenantMcpContextTools,
  tenantMcpServers,
  userMcpTokens,
} from "@thinkwork/database-pg/schema";
import type { McpServerComponent } from "@thinkwork/plugin-catalog";
import { db as defaultDb } from "../../../graphql/utils.js";
import { computeMcpUrlHash } from "../../mcp-server-hash.js";

type DbLike = typeof defaultDb;

/** handler_ref shape recorded on `mcp-server` component rows. */
export interface McpHandlerRef extends Record<string, unknown> {
  tenantMcpServerId: string;
}

export function pluginMcpServerSlug(
  pluginKey: string,
  componentKey: string,
): string {
  return `${pluginKey}--${componentKey}`;
}

function pluginMcpAuthFields(component: McpServerComponent): {
  auth_type: string;
  auth_config: Record<string, unknown> | null;
} {
  if (component.auth.mode === "oauth") {
    return {
      auth_type: "oauth",
      auth_config: { oauth_resource: component.auth.resourceIndicator },
    };
  }
  return { auth_type: "none", auth_config: null };
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
  const { auth_type, auth_config } = pluginMcpAuthFields(args.component);
  const urlHash = computeMcpUrlHash(args.component.endpointUrl, auth_config);

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
    url: args.component.endpointUrl,
    transport: "streamable-http",
    auth_type,
    auth_config,
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
    return { tenantMcpServerId: existing.id };
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
  return { tenantMcpServerId: inserted.id };
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
