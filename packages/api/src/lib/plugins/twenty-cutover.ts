/**
 * One-time Twenty plugin cutover (plan 2026-06-12-001 U10).
 *
 * Run ONCE per tenant (by the `cutoverTwentyPlugin` admin mutation) after
 * the `twenty` plugin install exists. It moves MCP ownership from the
 * legacy managed-application reconciler to the plugin engine:
 *
 *   1. ADOPT — when the legacy managed row (management_source
 *      'managed_application', managed_application_key 'twenty-crm') still
 *      exists and the plugin MCP handler has not created its own row, the
 *      legacy row is adopted in place: slug → `twenty--crm` (so the
 *      handler's idempotent (tenant, install, slug) lookup converges on
 *      it), management_source → 'plugin', plugin_install_id set, and the
 *      install's `crm` component handler_ref is pointed at the row
 *      (state 'provisioned'). URL, auth_config, and url_hash are
 *      untouched — the plugin row is wire-identical to the managed row.
 *   2. DEDUPE — when the plugin handler ALREADY provisioned its own row
 *      (same endpoint), the legacy row is redundant: its inventory
 *      (user tokens + secrets, context tools, agent/template/space
 *      assignments, the row itself) is removed; the plugin row stays
 *      canonical.
 *   3. In both cases the legacy row's per-server `user_mcp_tokens` are
 *      invalidated (token rows deleted, secrets deleted via Secrets
 *      Manager) so users re-activate at APP level through the plugin
 *      activation flow.
 *
 * Idempotent: a re-run after a completed cutover finds no legacy row and
 * reports a no-op. Mutating runs emit a `plugin.cutover` compliance event
 * transactionally with the row changes (control-evidence tier).
 */

import {
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import {
  agentMcpServers,
  agentTemplateMcpServers,
  pluginComponents,
  pluginInstalls,
  spaceMcpServers,
  tenantMcpContextTools,
  tenantMcpServers,
  userMcpTokens,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../graphql/utils.js";
import {
  emitAuditEvent,
  type EmitAuditEventInput,
} from "../compliance/emit.js";
import { TWENTY_MANAGED_MCP_KEY } from "../managed-mcp-applications.js";
import { pluginMcpServerSlug } from "./handlers/mcp.js";

type DbLike = typeof defaultDb;

export const TWENTY_PLUGIN_KEY = "twenty";
export const TWENTY_PLUGIN_MCP_COMPONENT_KEY = "crm";
export const TWENTY_PLUGIN_MCP_SLUG = pluginMcpServerSlug(
  TWENTY_PLUGIN_KEY,
  TWENTY_PLUGIN_MCP_COMPONENT_KEY,
);

export interface TwentyCutoverResult {
  /** True when this run changed ownership (adopt or legacy-row removal). */
  adopted: boolean;
  /** The canonical plugin-owned Twenty MCP row after the run, if any. */
  mcpServerId: string | null;
  /** Per-server user_mcp_tokens invalidated (rows deleted) by this run. */
  invalidatedUserTokenCount: number;
  message: string;
}

interface ServerRowSnapshot {
  id: string;
  url: string;
}

export interface TwentyCutoverDeps {
  getTwentyInstall(tenantId: string): Promise<{ id: string } | null>;
  /** The legacy managed-application row, if it still exists. */
  getLegacyManagedRow(tenantId: string): Promise<ServerRowSnapshot | null>;
  /** The plugin-handler-created row for the install, if any. */
  getPluginRow(
    tenantId: string,
    installId: string,
  ): Promise<ServerRowSnapshot | null>;
  /** Delete the row's user tokens (+ their secrets); returns the count. */
  invalidateUserTokens(serverId: string): Promise<number>;
  /**
   * Adopt the legacy row in place (slug/management_source/plugin_install_id)
   * and point the install's mcp component handler_ref at it — one
   * transaction with the audit event.
   */
  adoptLegacyRow(args: {
    tenantId: string;
    installId: string;
    serverId: string;
    serverUrl: string;
    audit: EmitAuditEventInput;
  }): Promise<void>;
  /**
   * Remove the redundant legacy row + its full inventory (context tools,
   * agent/template/space assignments, the row) — one transaction with the
   * audit event. Tokens are already gone via invalidateUserTokens.
   */
  removeLegacyRow(args: {
    tenantId: string;
    serverId: string;
    audit: EmitAuditEventInput;
  }): Promise<void>;
}

export function createDefaultTwentyCutoverDeps(
  db: DbLike = defaultDb,
  secretsManager?: Pick<SecretsManagerClient, "send">,
): TwentyCutoverDeps {
  const sm = () =>
    secretsManager ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });

  return {
    async getTwentyInstall(tenantId) {
      const [row] = await db
        .select({ id: pluginInstalls.id })
        .from(pluginInstalls)
        .where(
          and(
            eq(pluginInstalls.tenant_id, tenantId),
            eq(pluginInstalls.plugin_key, TWENTY_PLUGIN_KEY),
          ),
        )
        .limit(1);
      return row ?? null;
    },

    async getLegacyManagedRow(tenantId) {
      const [row] = (await db
        .select({ id: tenantMcpServers.id, url: tenantMcpServers.url })
        .from(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.tenant_id, tenantId),
            eq(tenantMcpServers.management_source, "managed_application"),
            eq(
              tenantMcpServers.managed_application_key,
              TWENTY_MANAGED_MCP_KEY,
            ),
          ),
        )
        .limit(1)) as ServerRowSnapshot[];
      return row ?? null;
    },

    async getPluginRow(tenantId, installId) {
      const [row] = (await db
        .select({ id: tenantMcpServers.id, url: tenantMcpServers.url })
        .from(tenantMcpServers)
        .where(
          and(
            eq(tenantMcpServers.tenant_id, tenantId),
            eq(tenantMcpServers.plugin_install_id, installId),
            eq(tenantMcpServers.slug, TWENTY_PLUGIN_MCP_SLUG),
          ),
        )
        .limit(1)) as ServerRowSnapshot[];
      return row ?? null;
    },

    async invalidateUserTokens(serverId) {
      const tokens = (await db
        .select({ id: userMcpTokens.id, secret_ref: userMcpTokens.secret_ref })
        .from(userMcpTokens)
        .where(eq(userMcpTokens.mcp_server_id, serverId))) as {
        id: string;
        secret_ref: string;
      }[];

      const client = sm();
      for (const token of tokens) {
        if (!token.secret_ref) continue;
        try {
          await client.send(
            new DeleteSecretCommand({
              SecretId: token.secret_ref,
              ForceDeleteWithoutRecovery: true,
            }),
          );
        } catch (error) {
          console.warn(
            "[twenty-cutover] Failed to delete Twenty MCP token secret:",
            (error as Error).message,
          );
        }
      }
      await db
        .delete(userMcpTokens)
        .where(eq(userMcpTokens.mcp_server_id, serverId));
      return tokens.length;
    },

    async adoptLegacyRow({ tenantId, installId, serverId, serverUrl, audit }) {
      await db.transaction(async (tx) => {
        await tx
          .update(tenantMcpServers)
          .set({
            slug: TWENTY_PLUGIN_MCP_SLUG,
            management_source: "plugin",
            plugin_install_id: installId,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(tenantMcpServers.id, serverId),
              eq(tenantMcpServers.tenant_id, tenantId),
            ),
          );
        await tx
          .update(pluginComponents)
          .set({
            state: "provisioned",
            handler_ref: {
              tenantMcpServerId: serverId,
              resolvedEndpointUrl: serverUrl,
              adoptedFromManagedApplication: true,
            },
            last_error: null,
            updated_at: new Date(),
          })
          .where(
            and(
              eq(pluginComponents.plugin_install_id, installId),
              eq(
                pluginComponents.component_key,
                TWENTY_PLUGIN_MCP_COMPONENT_KEY,
              ),
            ),
          );
        await emitAuditEvent(tx, audit);
      });
    },

    async removeLegacyRow({ tenantId, serverId, audit }) {
      await db.transaction(async (tx) => {
        await tx
          .delete(tenantMcpContextTools)
          .where(eq(tenantMcpContextTools.mcp_server_id, serverId));
        await tx
          .delete(agentMcpServers)
          .where(eq(agentMcpServers.mcp_server_id, serverId));
        await tx
          .delete(agentTemplateMcpServers)
          .where(eq(agentTemplateMcpServers.mcp_server_id, serverId));
        await tx
          .delete(spaceMcpServers)
          .where(eq(spaceMcpServers.mcp_server_id, serverId));
        await tx
          .delete(tenantMcpServers)
          .where(
            and(
              eq(tenantMcpServers.id, serverId),
              eq(tenantMcpServers.tenant_id, tenantId),
            ),
          );
        await emitAuditEvent(tx, audit);
      });
    },
  };
}

function cutoverAudit(args: {
  tenantId: string;
  actorId: string;
  actorType: "user" | "system";
  installId: string;
  mcpServerId: string;
  mode: "adopted" | "legacy_row_removed";
  invalidatedUserTokenCount: number;
}): EmitAuditEventInput {
  return {
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorType: args.actorType,
    eventType: "plugin.cutover",
    source: "graphql",
    payload: {
      pluginInstallId: args.installId,
      pluginKey: TWENTY_PLUGIN_KEY,
      mcpServerId: args.mcpServerId,
      mode: args.mode,
      invalidatedUserTokenCount: args.invalidatedUserTokenCount,
    },
    resourceType: "plugin_install",
    resourceId: args.installId,
    action: "cutover",
    outcome: "success",
  };
}

export async function cutoverTwentyPluginForTenant(
  args: {
    tenantId: string;
    actorId: string;
    actorType: "user" | "system";
  },
  deps: TwentyCutoverDeps = createDefaultTwentyCutoverDeps(),
): Promise<TwentyCutoverResult> {
  const install = await deps.getTwentyInstall(args.tenantId);
  if (!install) {
    throw new GraphQLError(
      "Install the twenty plugin before running the cutover",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  const legacy = await deps.getLegacyManagedRow(args.tenantId);
  const pluginRow = await deps.getPluginRow(args.tenantId, install.id);

  if (!legacy) {
    return {
      adopted: false,
      mcpServerId: pluginRow?.id ?? null,
      invalidatedUserTokenCount: 0,
      message: pluginRow
        ? "Twenty MCP row is already plugin-owned; nothing to adopt (idempotent re-run)."
        : "No managed Twenty MCP row exists for this tenant; nothing to adopt.",
    };
  }

  const invalidatedUserTokenCount = await deps.invalidateUserTokens(legacy.id);

  if (pluginRow) {
    // The plugin handler already provisioned its own row — the legacy row
    // is a redundant same-endpoint duplicate. Remove it; the plugin row
    // stays canonical.
    await deps.removeLegacyRow({
      tenantId: args.tenantId,
      serverId: legacy.id,
      audit: cutoverAudit({
        tenantId: args.tenantId,
        actorId: args.actorId,
        actorType: args.actorType,
        installId: install.id,
        mcpServerId: pluginRow.id,
        mode: "legacy_row_removed",
        invalidatedUserTokenCount,
      }),
    });
    return {
      adopted: true,
      mcpServerId: pluginRow.id,
      invalidatedUserTokenCount,
      message: `Removed the redundant legacy Twenty MCP row (the plugin row is canonical) and invalidated ${invalidatedUserTokenCount} per-server user token(s); users re-activate at app level.`,
    };
  }

  await deps.adoptLegacyRow({
    tenantId: args.tenantId,
    installId: install.id,
    serverId: legacy.id,
    serverUrl: legacy.url,
    audit: cutoverAudit({
      tenantId: args.tenantId,
      actorId: args.actorId,
      actorType: args.actorType,
      installId: install.id,
      mcpServerId: legacy.id,
      mode: "adopted",
      invalidatedUserTokenCount,
    }),
  });

  return {
    adopted: true,
    mcpServerId: legacy.id,
    invalidatedUserTokenCount,
    message: `Adopted the managed Twenty MCP row to plugin ownership and invalidated ${invalidatedUserTokenCount} per-server user token(s); users re-activate at app level.`,
  };
}
