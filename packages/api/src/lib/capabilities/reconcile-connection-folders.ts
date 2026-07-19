/**
 * Connection-folder writer for the NON-Composer attach paths (THINK-173
 * plan U10 — R14, R16 support; table-retirement follow-up).
 *
 * The managed-application provisioner, the plugin MCP provisioner, and the
 * legacy REST assign endpoint attach a REGISTRY server to agents. Post-
 * retirement there is no `agent_mcp_servers` row behind an attachment —
 * the signed `connections/<slug>/` folder (plus the `mcp/<slug>/` state
 * file) IS the attachment. These helpers write/remove that folder for a
 * set of agents from the registry row alone. Provenance is the caller's
 * (`plugin-reconciler` for the autonomous provisioners — their authority
 * derives from the original plugin/app approval).
 *
 * Upsert-only by design: writers never delete folders they do not know
 * about, so hand-authored connections (api-type, Composer-created) are
 * never clobbered. Removal happens on the explicit detach/uninstall
 * paths, which know the exact registry server being removed.
 *
 * U15 connectors/ flip: writes land under the flipped `connectors/`
 * spelling (via the workspace-constants key builders inside
 * folder-write). Because these writers derive purely from the
 * `tenant_mcp_servers` registry (keyed by slug/id, never by S3 path)
 * and are upsert-only, they can never RESURRECT a legacy
 * `connections/<slug>/` folder the `migrate-connectors` mover deleted —
 * there is no path-shaped record to re-point ("sever" = ship this
 * writer flip before the mover deletes). Removal sweeps BOTH spellings
 * (folder-write's legacy sweep) so a detach during the window cannot
 * leave a stale dual-read-visible legacy folder behind.
 *
 * Best-effort like the mcp/ state-file writes: failures log and never
 * fail the provisioning flow they ride — the next backfill/reconcile
 * converges the folder.
 */

import { getConfig } from "@thinkwork/runtime-config";
import { db, eq, and } from "../../graphql/utils.js";
import { tenantMcpServers } from "@thinkwork/database-pg/schema";
import { resolveAgentWorkspacePrefix } from "../skills/assignment-state.js";
import {
  connectionDefinitionFromRegistryRow,
  putCapabilityFolder,
  removeCapabilityFolder,
  type CapabilityFolderWriteDeps,
} from "./folder-write.js";
import type { CapabilitySignedBy } from "./sidecar-signing.js";

const LOG_PREFIX = "[connection-folder-reconcile]";

/**
 * THINK-321 U4: connector attach/detach changes what the routing map may
 * address, so the workspace projection refreshes behind both choke points
 * below. Best-effort like every other write here — the refresh itself
 * skips unchanged content and no-ops for tenants with no identity
 * declarations, so this stays cheap on unrelated provisioning flows.
 */
async function refreshRoutingMapBestEffort(tenantId: string): Promise<void> {
  try {
    const { refreshRoutingMapFile } = await import(
      "../entity-identity/routing-map-file.js"
    );
    await refreshRoutingMapFile(db, tenantId);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} routing-map refresh failed tenant=${tenantId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function workspaceBucketConfigured(): boolean {
  try {
    return Boolean(getConfig("WORKSPACE_BUCKET"));
  } catch {
    return false;
  }
}

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

/**
 * Write the signed `connections/<slug>/` folder for one registry server on
 * each agent. Reads ONLY the tenant registry row (never an assignment
 * table). Skips silently when the server is not approved+enabled — the
 * caller's registry write decides visibility, this mirror only follows it.
 */
export async function writeConnectionFoldersForAgents(input: {
  agentIds: readonly string[];
  tenantId: string;
  registryServerId: string;
  /** Agent-level operation allowlist, when the caller has one. */
  operations?: readonly string[];
  signedBy: CapabilitySignedBy;
  deps?: CapabilityFolderWriteDeps;
}): Promise<void> {
  // Bucket-gated BEFORE any DB read, so DB-mocked unit tests are unaffected.
  if (!input.deps?.bucket && !workspaceBucketConfigured()) return;
  let row:
    | {
        server_id: string;
        slug: string | null;
        name: string;
        url: string;
        transport: string | null;
        tools: unknown;
        status: string | null;
        server_enabled: boolean | null;
      }
    | undefined;
  try {
    [row] = await db
      .select({
        server_id: tenantMcpServers.id,
        slug: tenantMcpServers.slug,
        name: tenantMcpServers.name,
        url: tenantMcpServers.url,
        transport: tenantMcpServers.transport,
        tools: tenantMcpServers.tools,
        status: tenantMcpServers.status,
        server_enabled: tenantMcpServers.enabled,
      })
      .from(tenantMcpServers)
      .where(
        and(
          eq(tenantMcpServers.id, input.registryServerId),
          eq(tenantMcpServers.tenant_id, input.tenantId),
        ),
      )
      .limit(1);
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} registry read failed server=${input.registryServerId}:`,
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (!row) return;
  if (row.status !== "approved" || row.server_enabled === false) return;

  const generated = connectionDefinitionFromRegistryRow(row);
  const operations = (input.operations ?? []).filter(
    (op): op is string => typeof op === "string",
  );

  for (const agentId of input.agentIds) {
    try {
      const targetPrefix = await resolveAgentWorkspacePrefix(agentId);
      if (!targetPrefix) continue;
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
          `${LOG_PREFIX} folder write failed agent=${agentId} slug=${generated.slug}: ${written.reason}`,
        );
      }
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} folder write failed agent=${agentId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  await refreshRoutingMapBestEffort(input.tenantId);
}

/** Explicit removal for detach/uninstall paths that know the registry row. */
export async function removeConnectionFoldersForAgents(input: {
  agentIds: string[];
  registry: { slug: string | null; name: string };
  /**
   * When provided, the tenant's routing-map projection refreshes after the
   * removal (THINK-321 U4) — deregistration may strand a source-system
   * link, and the file must say so instead of naming a dead connector.
   */
  tenantId?: string;
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
  if (input.tenantId) {
    await refreshRoutingMapBestEffort(input.tenantId);
  }
}
