import {
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { and, eq } from "drizzle-orm";
import { getDb, type Database } from "@thinkwork/database-pg";
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
import {
  TWENTY_PLUGIN_KEY,
  TWENTY_PLUGIN_MCP_COMPONENT_KEY,
  TWENTY_PLUGIN_MCP_SLUG,
  type TwentyCutoverDeps,
} from "@thinkwork/plugin-twenty/api/cutover";
import { emitAuditEvent } from "../../compliance/emit.js";

const TWENTY_MANAGED_MCP_KEY = "twenty-crm";

type DbLike = Database;

export function createDefaultTwentyCutoverDeps(
  db: DbLike = getDb(),
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
        .limit(1)) as Array<{ id: string; url: string }>;
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
        .limit(1)) as Array<{ id: string; url: string }>;
      return row ?? null;
    },

    async invalidateUserTokens(serverId) {
      const tokens = (await db
        .select({ id: userMcpTokens.id, secret_ref: userMcpTokens.secret_ref })
        .from(userMcpTokens)
        .where(eq(userMcpTokens.mcp_server_id, serverId))) as Array<{
        id: string;
        secret_ref: string;
      }>;

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
