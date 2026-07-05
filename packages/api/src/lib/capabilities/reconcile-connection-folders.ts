/**
 * Connection-folder reconciler (THINK-173 plan U10 — R14, R16 support).
 *
 * The DualWrite-window mirror for NON-Composer attach paths: the managed-
 * application provisioner, the plugin MCP provisioner, and the legacy
 * REST assign/unassign endpoints all upsert `agent_mcp_servers` rows —
 * this reconciler mirrors each agent's attached set into signed
 * `connections/<slug>/` folders so folder state converges ahead of the
 * U11 backfill. Provenance is the caller's (`plugin-reconciler` for the
 * autonomous provisioners — their authority derives from the original
 * plugin/app approval).
 *
 * Upsert-only by design: it never deletes folders it does not know
 * about, so hand-authored connections (api-type, Composer-created) are
 * never clobbered. Removal happens on the explicit detach/uninstall
 * paths, which know the exact registry row being removed.
 *
 * Best-effort like the mcp/ mirror: failures log and never fail the DB
 * write they shadow — the DB row remains authoritative while the
 * agent's `capability_folder_dispatch` flag is off.
 */

import { db, eq, and } from "../../graphql/utils.js";
import {
  agentMcpServers,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import { resolveAgentWorkspacePrefix } from "../skills/assignment-state.js";
import {
  connectionDefinitionFromRegistryRow,
  putCapabilityFolder,
  removeCapabilityFolder,
  type CapabilityFolderWriteDeps,
} from "./folder-write.js";
import type { CapabilitySignedBy } from "./sidecar-signing.js";

const LOG_PREFIX = "[connection-folder-reconcile]";

/** Registry-derived connection slug — one sanitizer everywhere. */
export function connectionSlugForRegistry(input: {
  slug: string | null;
  name: string;
}): string {
  return connectionDefinitionFromRegistryRow({
    slug: input.slug,
    name: input.name,
    url: "https://placeholder.invalid",
  }).slug;
}

export async function reconcileConnectionFoldersForAgents(input: {
  agentIds: string[];
  tenantId: string;
  signedBy: CapabilitySignedBy;
  deps?: CapabilityFolderWriteDeps;
}): Promise<void> {
  for (const agentId of input.agentIds) {
    try {
      const targetPrefix = await resolveAgentWorkspacePrefix(agentId);
      if (!targetPrefix) continue;

      const rows = await db
        .select({
          enabled: agentMcpServers.enabled,
          config: agentMcpServers.config,
          server_id: tenantMcpServers.id,
          slug: tenantMcpServers.slug,
          name: tenantMcpServers.name,
          url: tenantMcpServers.url,
          transport: tenantMcpServers.transport,
          tools: tenantMcpServers.tools,
          status: tenantMcpServers.status,
          server_enabled: tenantMcpServers.enabled,
        })
        .from(agentMcpServers)
        .innerJoin(
          tenantMcpServers,
          eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
        )
        .where(
          and(
            eq(agentMcpServers.agent_id, agentId),
            eq(agentMcpServers.tenant_id, input.tenantId),
          ),
        );

      for (const row of rows) {
        if (row.enabled === false) continue;
        if (row.status !== "approved" || row.server_enabled === false) continue;
        const generated = connectionDefinitionFromRegistryRow(row);
        const allowlist = (row.config as { toolAllowlist?: unknown } | null)
          ?.toolAllowlist;
        const operations = Array.isArray(allowlist)
          ? allowlist.filter((op): op is string => typeof op === "string")
          : [];
        const written = await putCapabilityFolder({
          targetPrefix,
          klass: "connection",
          slug: generated.slug,
          definition: generated.definition,
          sidecar: {
            enabled: true,
            ...(operations.length > 0 ? { permissions: { operations } } : {}),
            config: { registryServerId: row.server_id },
          },
          signedBy: input.signedBy,
          deps: input.deps,
        });
        if (!written.ok) {
          console.warn(
            `${LOG_PREFIX} folder write failed agent=${agentId} slug=${generated.slug}: ${written.reason} (DB row remains authoritative)`,
          );
        }
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} reconcile failed agent=${agentId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

/** Explicit removal for detach/uninstall paths that know the registry row. */
export async function removeConnectionFoldersForAgents(input: {
  agentIds: string[];
  registry: { slug: string | null; name: string };
  deps?: CapabilityFolderWriteDeps;
}): Promise<void> {
  const slug = connectionSlugForRegistry(input.registry);
  for (const agentId of input.agentIds) {
    try {
      const targetPrefix = await resolveAgentWorkspacePrefix(agentId);
      if (!targetPrefix) continue;
      const removed = await removeCapabilityFolder({
        targetPrefix,
        klass: "connection",
        slug,
        deps: input.deps,
      });
      if (!removed.ok) {
        console.warn(
          `${LOG_PREFIX} folder removal failed agent=${agentId} slug=${slug}: ${removed.reason}`,
        );
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} removal failed agent=${agentId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
