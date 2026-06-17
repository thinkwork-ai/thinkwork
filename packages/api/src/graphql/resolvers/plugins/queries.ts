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
import { and, desc, eq } from "drizzle-orm";
import type { PluginCatalogEntry as CatalogPluginEntry } from "@thinkwork/plugin-catalog";
import { pluginCatalogSha256 } from "@thinkwork/plugin-catalog";
import {
  managedApplicationDeploymentJobs,
  managedApplications,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import { snakeToCamel } from "../../utils.js";
import {
  compareSemverDesc,
  getPluginCatalog,
  getPluginCatalogSnapshot,
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

type DbLike = typeof defaultDb;

type PluginInstallPayload = Record<string, unknown> & {
  state?: unknown;
  components?: Array<{
    componentType?: unknown;
    state?: unknown;
    handlerRef?: unknown;
  }>;
};

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

export async function pluginLaunchUrlForInstall(
  tenantId: string,
  install: PluginInstallPayload | null,
  db: DbLike = defaultDb,
): Promise<string | null> {
  if (!install) return null;
  const components = Array.isArray(install.components)
    ? install.components
    : [];
  const infra = components.find(
    (component) =>
      component.componentType === "infrastructure" &&
      component.state === "provisioned" &&
      isRecord(jsonRecordValue(component.handlerRef)),
  );
  if (!infra) return null;
  const handlerRef = jsonRecordValue(infra.handlerRef);
  if (!handlerRef) return null;

  const managedApplicationId = stringValue(handlerRef.managedApplicationId);
  const managedAppKey = stringValue(handlerRef.managedAppKey);
  const row = managedApplicationId
    ? await findManagedApplicationById(tenantId, managedApplicationId, db)
    : managedAppKey
      ? await findManagedApplicationByKey(tenantId, managedAppKey, db)
      : null;
  if (
    !row ||
    !(await applicationHasLaunchableRuntime(tenantId, row, handlerRef, db))
  ) {
    return null;
  }
  const desiredConfig = isRecord(row.desired_config) ? row.desired_config : {};
  return publicHttpUrl(desiredConfig.publicUrl);
}

async function findManagedApplicationById(
  tenantId: string,
  id: string,
  db: DbLike,
) {
  const [row] = await db
    .select({
      key: managedApplications.key,
      current_status: managedApplications.current_status,
      desired_config: managedApplications.desired_config,
    })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.id, id),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findManagedApplicationByKey(
  tenantId: string,
  key: string,
  db: DbLike,
) {
  const [row] = await db
    .select({
      key: managedApplications.key,
      current_status: managedApplications.current_status,
      desired_config: managedApplications.desired_config,
    })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.key, key),
      ),
    )
    .limit(1);
  return row ?? null;
}

function applicationIsDeployed(status: string | null | undefined): boolean {
  return status === "enabled" || status === "running";
}

async function applicationHasLaunchableRuntime(
  tenantId: string,
  row: {
    key: string;
    current_status: string | null;
  },
  handlerRef: Record<string, unknown>,
  db: DbLike,
): Promise<boolean> {
  if (applicationIsDeployed(row.current_status)) return true;
  if (handlerRef.adoptedRunningInfra === true) return true;
  const [job] = await db
    .select({ operation: managedApplicationDeploymentJobs.operation })
    .from(managedApplicationDeploymentJobs)
    .where(
      and(
        eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
        eq(managedApplicationDeploymentJobs.app_key, row.key),
        eq(managedApplicationDeploymentJobs.status, "succeeded"),
      ),
    )
    .orderBy(desc(managedApplicationDeploymentJobs.updated_at))
    .limit(1);
  return job?.operation === "ENABLE" || job?.operation === "UPGRADE";
}

function publicHttpUrl(value: unknown): string | null {
  const url = stringValue(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonRecordValue(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
    const installPayload = install
      ? ((await installPayloadWithDetails(
          install,
          deps,
        )) as PluginInstallPayload)
      : null;
    entries.push({
      pluginKey: plugin.pluginKey,
      displayName: plugin.displayName,
      description: plugin.description,
      premium: plugin.premium ?? null,
      entitlement: null,
      versions,
      latestVersion,
      install: installPayload,
      launchUrl: await pluginLaunchUrlForInstall(tenantId, installPayload),
      updateAvailable: Boolean(
        install &&
        latestVersion &&
        compareSemverDesc(latestVersion, install.pinned_version) < 0,
      ),
    });
  }
  return entries;
}

export async function pluginCatalogMetadata(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  await requirePluginTenantMember(ctx);
  const snapshot = await getPluginCatalogSnapshot();
  const github = snapshot.github ?? null;
  return {
    source: snapshot.source,
    repository:
      github?.repository ?? snapshot.catalog.source?.repository ?? null,
    ref: snapshot.catalog.source?.ref ?? null,
    commitSha:
      github?.sourceCommitSha ?? snapshot.catalog.source?.commitSha ?? null,
    releaseTag: github?.releaseTag ?? null,
    assetName: github?.assetName ?? null,
    catalogSha256:
      github?.catalogSha256 ?? pluginCatalogSha256(snapshot.catalog),
    generatedAt: snapshot.catalog.generatedAt,
    fetchedAt: github?.fetchedAt ?? null,
    stale: github?.stale ?? false,
    lastRefreshStatus: github?.lastRefreshStatus ?? null,
    message: github?.message ?? null,
    rateLimitRemaining: github?.rateLimitRemaining ?? null,
    rateLimitReset: github?.rateLimitReset ?? null,
  };
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
