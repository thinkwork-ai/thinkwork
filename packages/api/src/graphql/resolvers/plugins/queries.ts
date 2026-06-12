/**
 * Plugin queries (plan 2026-06-12-001 U5).
 *
 *   - pluginCatalog        — signed catalog + caller tenant install overlay
 *   - pluginInstalls       — admin status surface (read-time reconciled)
 *   - pluginInstall(id)    — one install, reconciled
 *   - myPluginActivations  — the caller's activation rows (read-only; the
 *                            activate/deactivate mutations are U6)
 *
 * Catalog trust failures (bad signature, digest mismatch, missing signed
 * artifact in signed mode) propagate as GraphQL errors — the UI renders
 * its degraded browse state; installed plugins still render from the DB.
 */

import { GraphQLError } from "graphql";
import type { PluginCatalogEntry as CatalogPluginEntry } from "@thinkwork/plugin-catalog";
import type { GraphQLContext } from "../../context.js";
import { snakeToCamel } from "../../utils.js";
import {
  compareSemverDesc,
  getPluginCatalog,
  sortVersionsNewestFirst,
} from "../../../lib/plugins/catalog-source.js";
import {
  createDefaultPluginEngineDeps,
  reconcileInstallStatus,
} from "../../../lib/plugins/engine.js";
import type { PluginInstallRow } from "../../../lib/plugins/store.js";
import {
  requirePluginTenantAdmin,
  requirePluginTenantMember,
  toPluginInstallPayload,
} from "./shared.js";

async function installPayloadWithDetails(
  install: PluginInstallRow,
  deps = createDefaultPluginEngineDeps(),
): Promise<Record<string, unknown>> {
  const reconciled = await reconcileInstallStatus(install, deps);
  const components = await deps.store.listComponents(reconciled.id);
  const activatedUserCount = await deps.store.countActiveActivations(
    reconciled.id,
  );
  return toPluginInstallPayload(reconciled, components, activatedUserCount);
}

function catalogVersionsPayload(plugin: CatalogPluginEntry) {
  return sortVersionsNewestFirst(plugin).map((entry) => ({
    version: entry.version,
    payloadSha256: entry.payloadSha256,
    requiredOauthScopes: entry.payload.requiredOauthScopes,
    components: entry.payload.components.map((component) => ({
      key: component.key,
      type: component.type,
      displayName:
        "displayName" in component ? (component.displayName ?? null) : null,
    })),
  }));
}

export async function pluginCatalog(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantMember(ctx);
  const catalog = await getPluginCatalog();
  const deps = createDefaultPluginEngineDeps();
  const installs = await deps.store.listInstalls(tenantId);

  const entries = [];
  for (const plugin of catalog.plugins) {
    const versions = catalogVersionsPayload(plugin);
    const latestVersion = versions[0]?.version ?? "";
    const install =
      installs.find((row) => row.plugin_key === plugin.pluginKey) ?? null;
    entries.push({
      pluginKey: plugin.pluginKey,
      displayName: plugin.displayName,
      description: plugin.description,
      versions,
      latestVersion,
      install: install ? await installPayloadWithDetails(install, deps) : null,
      updateAvailable: Boolean(
        install &&
        latestVersion &&
        compareSemverDesc(latestVersion, install.pinned_version) < 0,
      ),
    });
  }
  return entries;
}

export async function pluginInstalls(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPluginEngineDeps();
  const installs = await deps.store.listInstalls(tenantId);
  return Promise.all(
    installs.map((install) => installPayloadWithDetails(install, deps)),
  );
}

export async function pluginInstall(
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const deps = createDefaultPluginEngineDeps();
  const install = await deps.store.getInstallById(tenantId, args.id);
  if (!install) return null;
  return installPayloadWithDetails(install, deps);
}

export async function myPluginActivations(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  const { tenantId, callerUserId } = await requirePluginTenantMember(ctx);
  if (!callerUserId) {
    throw new GraphQLError("User context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const deps = createDefaultPluginEngineDeps();
  const installs = await deps.store.listInstalls(tenantId);
  if (installs.length === 0) return [];
  const installsById = new Map(installs.map((row) => [row.id, row]));
  const activations = await deps.store.listActivationsForUser(
    callerUserId,
    installs.map((row) => row.id),
  );
  return activations.map((activation) => ({
    ...snakeToCamel(activation as unknown as Record<string, unknown>),
    pluginKey: installsById.get(activation.plugin_install_id)?.plugin_key ?? "",
    grantedScopes: activation.granted_scopes ?? [],
  }));
}
