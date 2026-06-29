import { GraphQLError } from "graphql";
import { and, asc, eq, inArray } from "drizzle-orm";
import type {
  PluginVersion,
  UiSurfaceComponent,
} from "@thinkwork/plugin-catalog/contracts";
import { pluginAppOverlays } from "@thinkwork/database-pg/schema";

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { graphqlJsonInput } from "../email-channel/mappers.js";
import { requirePluginTenantMember } from "../plugins/shared.js";
import {
  compareSemverDesc,
  getPluginCatalog,
} from "../../../lib/plugins/catalog-source.js";
import { createDefaultPluginEngineDeps } from "../../../lib/plugins/engine.js";
import type { PluginComponentRow } from "../../../lib/plugins/store.js";

interface TenantCaller {
  tenantId: string;
  callerUserId: string | null;
}

interface CatalogPlugin {
  pluginKey: string;
  versions: Array<{
    version: string;
    payload: PluginVersion;
  }>;
}

interface ResolvedPluginApp {
  pluginInstallId: string;
  pluginKey: string;
  appSurfaceKey: string;
  appKey: string;
}

type OverlayRow = typeof pluginAppOverlays.$inferSelect;

interface OverlayIdentity {
  tenantId: string;
  pluginInstallId: string;
  pluginKey: string;
  appSurfaceKey: string;
  appKey: string;
  provider: string;
  providerRecordType: string;
  providerRecordId: string;
}

interface OverlayStore {
  list(
    identity: OverlayIdentity,
    sectionKeys: string[] | null,
  ): Promise<OverlayRow[]>;
  upsert(
    identity: OverlayIdentity,
    input: {
      sectionKey: string;
      payload: Record<string, unknown>;
      callerUserId: string;
    },
  ): Promise<OverlayRow>;
}

interface PluginAppOverlayDeps {
  resolveTenantCaller(ctx: GraphQLContext): Promise<TenantCaller>;
  resolvePluginApp(input: {
    tenantId: string;
    appKey: string;
  }): Promise<ResolvedPluginApp>;
  overlayStore: OverlayStore;
}

const defaultOverlayStore: OverlayStore = {
  async list(identity, sectionKeys) {
    const conditions = [
      eq(pluginAppOverlays.tenant_id, identity.tenantId),
      eq(pluginAppOverlays.plugin_install_id, identity.pluginInstallId),
      eq(pluginAppOverlays.app_surface_key, identity.appSurfaceKey),
      eq(pluginAppOverlays.app_key, identity.appKey),
      eq(pluginAppOverlays.provider, identity.provider),
      eq(pluginAppOverlays.provider_record_type, identity.providerRecordType),
      eq(pluginAppOverlays.provider_record_id, identity.providerRecordId),
    ];
    if (sectionKeys?.length) {
      conditions.push(inArray(pluginAppOverlays.section_key, sectionKeys));
    }
    return db
      .select()
      .from(pluginAppOverlays)
      .where(and(...conditions))
      .orderBy(asc(pluginAppOverlays.section_key));
  },

  async upsert(identity, input) {
    const now = new Date();
    const values = {
      tenant_id: identity.tenantId,
      plugin_install_id: identity.pluginInstallId,
      app_surface_key: identity.appSurfaceKey,
      app_key: identity.appKey,
      provider: identity.provider,
      provider_record_type: identity.providerRecordType,
      provider_record_id: identity.providerRecordId,
      section_key: input.sectionKey,
      payload: input.payload,
      created_by_user_id: input.callerUserId,
      updated_by_user_id: input.callerUserId,
      updated_at: now,
    };
    const [row] = await db
      .insert(pluginAppOverlays)
      .values(values)
      .onConflictDoUpdate({
        target: [
          pluginAppOverlays.tenant_id,
          pluginAppOverlays.plugin_install_id,
          pluginAppOverlays.app_surface_key,
          pluginAppOverlays.provider,
          pluginAppOverlays.provider_record_type,
          pluginAppOverlays.provider_record_id,
          pluginAppOverlays.section_key,
        ],
        set: {
          payload: input.payload,
          updated_by_user_id: input.callerUserId,
          updated_at: now,
        },
      })
      .returning();
    if (!row) {
      throw new GraphQLError("Failed to save plugin app overlay", {
        extensions: { code: "INTERNAL_ERROR" },
      });
    }
    return row;
  },
};

const defaultDeps: PluginAppOverlayDeps = {
  resolveTenantCaller: (ctx) => requirePluginTenantMember(ctx),
  resolvePluginApp: resolveLaunchablePluginApp,
  overlayStore: defaultOverlayStore,
};

let deps: PluginAppOverlayDeps = defaultDeps;

export function __setPluginAppOverlayDepsForTests(
  overrides: Partial<PluginAppOverlayDeps>,
) {
  deps = { ...defaultDeps, ...overrides };
  return () => {
    deps = defaultDeps;
  };
}

export async function pluginAppOverlaysQuery(
  _parent: unknown,
  args: {
    input: {
      appKey: string;
      provider: string;
      providerRecordType: string;
      providerRecordId: string;
      sectionKeys?: string[] | null;
    };
  },
  ctx: GraphQLContext,
): Promise<PluginAppOverlayPayload[]> {
  const { identity } = await resolveOverlayRequest(ctx, args.input);
  const sectionKeys = normalizeSectionKeys(args.input.sectionKeys);
  const rows = await deps.overlayStore.list(identity, sectionKeys);
  return rows.map((row) => toOverlayPayload(row, identity.pluginKey));
}

export async function upsertPluginAppOverlay(
  _parent: unknown,
  args: {
    input: {
      appKey: string;
      provider: string;
      providerRecordType: string;
      providerRecordId: string;
      sectionKey: string;
      payload: unknown;
    };
  },
  ctx: GraphQLContext,
): Promise<PluginAppOverlayPayload> {
  const { identity, callerUserId } = await resolveOverlayRequest(
    ctx,
    args.input,
  );
  const sectionKey = normalizeToken(args.input.sectionKey, "sectionKey");
  const payload = jsonPayload(args.input.payload);
  const row = await deps.overlayStore.upsert(identity, {
    sectionKey,
    payload,
    callerUserId,
  });
  return toOverlayPayload(row, identity.pluginKey);
}

async function resolveOverlayRequest(
  ctx: GraphQLContext,
  input: {
    appKey: string;
    provider: string;
    providerRecordType: string;
    providerRecordId: string;
  },
): Promise<{ identity: OverlayIdentity; callerUserId: string }> {
  const { tenantId, callerUserId } = await deps.resolveTenantCaller(ctx);
  if (!callerUserId) {
    throw new GraphQLError("User context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  const appKey = normalizeToken(input.appKey, "appKey");
  const app = await deps.resolvePluginApp({ tenantId, appKey });
  return {
    callerUserId,
    identity: {
      tenantId,
      pluginInstallId: app.pluginInstallId,
      pluginKey: app.pluginKey,
      appSurfaceKey: app.appSurfaceKey,
      appKey: app.appKey,
      provider: normalizeToken(input.provider, "provider"),
      providerRecordType: normalizeToken(
        input.providerRecordType,
        "providerRecordType",
      ),
      providerRecordId: normalizeRecordId(input.providerRecordId),
    },
  };
}

async function resolveLaunchablePluginApp(input: {
  tenantId: string;
  appKey: string;
}): Promise<ResolvedPluginApp> {
  const catalog = await getPluginCatalog();
  const pluginsByKey = new Map(
    catalog.plugins.map((plugin) => [
      plugin.pluginKey,
      plugin as CatalogPlugin,
    ]),
  );
  const engineDeps = createDefaultPluginEngineDeps();
  const installs = (await engineDeps.store.listInstalls(input.tenantId)).filter(
    (install) =>
      install.state === "installed" || install.state === "partially_installed",
  );

  for (const install of installs) {
    const catalogPlugin = pluginsByKey.get(install.plugin_key);
    if (!catalogPlugin) continue;
    const version = findPinnedVersion(catalogPlugin, install.pinned_version);
    if (!version) continue;
    const surface = version.payload.components.find(
      (component): component is UiSurfaceComponent =>
        component.type === "ui-surface" &&
        component.launch?.type === "app" &&
        component.launch.appKey === input.appKey,
    );
    if (!surface) continue;
    const components = await engineDeps.store.listComponents(install.id);
    const surfaceRow = components.find(
      (component) => component.component_key === surface.key,
    );
    if (!componentIsProvisioned(surfaceRow)) {
      throw new GraphQLError("Plugin app surface is not provisioned", {
        extensions: {
          code: "PLUGIN_APP_UNAVAILABLE",
          appKey: input.appKey,
        },
      });
    }
    return {
      pluginInstallId: install.id,
      pluginKey: install.plugin_key,
      appSurfaceKey: surface.key,
      appKey: input.appKey,
    };
  }

  throw new GraphQLError("Plugin app is not installed", {
    extensions: { code: "PLUGIN_APP_NOT_FOUND", appKey: input.appKey },
  });
}

function findPinnedVersion(plugin: CatalogPlugin, pinnedVersion: string) {
  const versions = [...plugin.versions].sort((a, b) =>
    compareSemverDesc(a.version, b.version),
  );
  return versions.find((version) => version.version === pinnedVersion) ?? null;
}

function componentIsProvisioned(
  component: PluginComponentRow | undefined,
): boolean {
  return component?.state === "provisioned";
}

function normalizeSectionKeys(values: string[] | null | undefined) {
  if (!values?.length) return null;
  return [
    ...new Set(values.map((value) => normalizeToken(value, "sectionKey"))),
  ];
}

const TOKEN_RE = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizeToken(value: unknown, fieldName: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_RE.test(normalized)) {
    throw new GraphQLError(
      `${fieldName} must use 1-128 letters, numbers, dots, underscores, colons, or dashes`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  return normalized;
}

function normalizeRecordId(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 256) {
    throw new GraphQLError("providerRecordId must be 1-256 characters", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return normalized;
}

function jsonPayload(value: unknown): Record<string, unknown> {
  try {
    return graphqlJsonInput(value);
  } catch {
    throw new GraphQLError("payload must be a JSON object", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

function toOverlayPayload(
  row: OverlayRow,
  pluginKey: string,
): PluginAppOverlayPayload {
  return {
    id: row.id,
    pluginInstallId: row.plugin_install_id,
    pluginKey,
    appSurfaceKey: row.app_surface_key,
    appKey: row.app_key,
    provider: row.provider,
    providerRecordType: row.provider_record_type,
    providerRecordId: row.provider_record_id,
    sectionKey: row.section_key,
    payload: row.payload ?? {},
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface PluginAppOverlayPayload {
  id: string;
  pluginInstallId: string;
  pluginKey: string;
  appSurfaceKey: string;
  appKey: string;
  provider: string;
  providerRecordType: string;
  providerRecordId: string;
  sectionKey: string;
  payload: Record<string, unknown>;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
