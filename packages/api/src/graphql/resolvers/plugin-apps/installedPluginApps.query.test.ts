import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const {
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  mockGetPluginCatalog,
  depsHolder,
} = vi.hoisted(() => ({
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockGetPluginCatalog: vi.fn(),
  depsHolder: { current: null as unknown },
}));

vi.mock("../../utils.js", () => ({
  db: {},
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
        value,
      ]),
    ),
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/plugins/engine.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/plugins/engine.js")>();
  return {
    ...actual,
    createDefaultPluginEngineDeps: () => depsHolder.current,
  };
});

vi.mock("../../../lib/plugins/catalog-source.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../lib/plugins/catalog-source.js")
    >();
  return {
    ...actual,
    getPluginCatalog: mockGetPluginCatalog,
  };
});

import {
  allPluginManifests,
  buildPluginCatalog,
} from "@thinkwork/plugin-catalog";
import type { PluginEngineDeps } from "../../../lib/plugins/engine.js";
import {
  createInMemoryPluginEngineStore,
  type InMemoryPluginEngineStore,
} from "../../../lib/plugins/testing.js";
import { installedPluginApps } from "./installedPluginApps.query.js";

const CTX = { auth: { tenantId: null } } as never;

let store: InMemoryPluginEngineStore;

function buildDeps(): PluginEngineDeps {
  store = createInMemoryPluginEngineStore();
  return {
    store,
    resolveVersion: async () => null,
    handlers: {
      provisionMcp: async () => ({}),
      teardownMcp: async () => {},
      provisionSkills: async () => ({}),
      teardownSkills: async () => {},
      provisionInfra: async () => ({}),
      teardownInfra: async () => ({ handlerRef: {}, complete: true }),
      provisionAuthProvider: async () => ({}),
    },
    premiumAccess: { ensureInstallAllowed: async () => {} },
    deleteSecrets: async () => {},
  };
}

function seedTwentyInstall({
  activation = true,
  surfaceState = "provisioned",
  mcpState = "provisioned",
  infraState = "provisioned",
}: {
  activation?: boolean;
  surfaceState?: string;
  mcpState?: string;
  infraState?: string;
} = {}) {
  const install = store.seedInstall({
    tenant_id: "tenant-1",
    plugin_key: "twenty",
    pinned_version: "0.3.0",
    pinned_payload_sha256: "sha-twenty-0.3.0",
    state: "installed",
  });
  store.seedComponent({
    plugin_install_id: install.id,
    component_key: "crm",
    component_type: "mcp-server",
    state: mcpState,
  });
  store.seedComponent({
    plugin_install_id: install.id,
    component_key: "runtime",
    component_type: "infrastructure",
    state: infraState,
  });
  store.seedComponent({
    plugin_install_id: install.id,
    component_key: "client-engagement",
    component_type: "ui-surface",
    state: surfaceState,
  });
  if (activation) {
    store.seedActivation({
      user_id: "user-1",
      plugin_install_id: install.id,
      status: "active",
      granted_scopes: [],
    });
  }
  return install;
}

describe("installedPluginApps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    depsHolder.current = buildDeps();
    mockResolveCallerTenantId.mockResolvedValue("tenant-1");
    mockResolveCallerUserId.mockResolvedValue("user-1");
    mockGetPluginCatalog.mockResolvedValue(
      buildPluginCatalog({ manifests: allPluginManifests }),
    );
  });

  it("returns a ready Twenty Client Engagement app from an installed launchable ui-surface", async () => {
    const install = seedTwentyInstall();

    const result = await installedPluginApps(null, {} as never, CTX);

    expect(result).toEqual([
      {
        id: `${install.id}:client-engagement`,
        pluginInstallId: install.id,
        pluginKey: "twenty",
        pluginDisplayName: "Twenty CRM",
        pluginVersion: "0.3.0",
        surfaceKey: "client-engagement",
        displayName: "Client Engagement",
        appKey: "twenty-client-engagement",
        routeSegment: "client-engagement",
        mount: "main-shell",
        runtime: "trusted-bundled-react",
        description:
          "Account and opportunity engagement workspace for Twenty CRM records.",
        icon: "layout-dashboard",
        entitlementProductKey: "twenty-client-engagement",
        readiness: {
          state: "ready",
          message: "Ready to launch.",
          nextAction: null,
        },
      },
    ]);
  });

  it("returns an empty list when installed plugins have no launchable app surfaces", async () => {
    const install = store.seedInstall({
      tenant_id: "tenant-1",
      plugin_key: "lastmile",
      pinned_version: "0.1.0",
      pinned_payload_sha256: "sha-lastmile-0.1.0",
      state: "installed",
    });
    store.seedComponent({
      plugin_install_id: install.id,
      component_key: "crm",
      component_type: "mcp-server",
      state: "provisioned",
    });

    await expect(installedPluginApps(null, {} as never, CTX)).resolves.toEqual(
      [],
    );
  });

  it("keeps the app visible when the current user needs plugin activation", async () => {
    seedTwentyInstall({ activation: false });

    const result = await installedPluginApps(null, {} as never, CTX);

    expect(result).toHaveLength(1);
    expect(result[0]?.readiness).toEqual({
      state: "activation_required",
      message: "Connect this plugin before launching the app.",
      nextAction: "connect_plugin",
    });
  });

  it("reports component readiness when the app surface is not provisioned", async () => {
    seedTwentyInstall({ surfaceState: "pending" });

    const result = await installedPluginApps(null, {} as never, CTX);

    expect(result[0]?.readiness).toEqual({
      state: "component_unavailable",
      message: "The app surface has not been provisioned yet.",
      nextAction: "open_plugin_settings",
    });
  });

  it("reports component readiness when a required runtime component is unavailable", async () => {
    seedTwentyInstall({ mcpState: "failed" });

    const result = await installedPluginApps(null, {} as never, CTX);

    expect(result[0]?.readiness).toEqual({
      state: "component_unavailable",
      message: "Twenty CRM is not ready yet.",
      nextAction: "open_plugin_settings",
    });
  });

  it("requires current user context", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);

    await expect(installedPluginApps(null, {} as never, CTX)).rejects.toThrow(
      GraphQLError,
    );
  });
});
