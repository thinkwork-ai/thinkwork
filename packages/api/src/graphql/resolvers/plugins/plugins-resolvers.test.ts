/**
 * Plugin resolver tests (plan 2026-06-12-001 U5).
 *
 * Auth modules are mocked (the deployment-resolver test approach); the
 * REAL engine runs against the in-memory store fake so admin gating,
 * tenant pinning, and the destructive-confirmation rule are exercised
 * end-to-end through the resolver surface.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";

const {
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  depsHolder,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
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

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
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

import type { PluginVersion } from "@thinkwork/plugin-catalog";
import type { PluginEngineDeps } from "../../../lib/plugins/engine.js";
import {
  createInMemoryPluginEngineStore,
  type InMemoryPluginEngineStore,
} from "../../../lib/plugins/testing.js";
import {
  activatePlugin,
  deactivatePlugin,
  installPlugin,
  uninstallPlugin,
} from "./mutations.js";
import { myPluginActivations, pluginInstalls } from "./queries.js";

const CTX = { auth: { tenantId: null } } as never; // Google-federated shape

const fixtureVersion: PluginVersion = {
  version: "0.1.0",
  requiredOauthScopes: ["openid"],
  components: [
    {
      type: "mcp-server",
      key: "crm",
      displayName: "CRM",
      endpointUrl: "https://crm.example.invalid/mcp",
      auth: {
        mode: "oauth",
        authDomain: "https://auth.example.invalid",
        resourceIndicator: "https://crm.example.invalid",
      },
    },
    {
      type: "skills",
      key: "skills",
      skills: [{ slug: "lastmile--crm-basics", skillMd: "# s" }],
    },
  ],
};

let store: InMemoryPluginEngineStore;

function buildDeps(): PluginEngineDeps {
  store = createInMemoryPluginEngineStore();
  return {
    store,
    resolveVersion: async (pluginKey, version) =>
      pluginKey === "lastmile" && (!version || version === "0.1.0")
        ? {
            plugin: {
              pluginKey: "lastmile",
              displayName: "LastMile",
              description: "d",
            },
            versionEntry: {
              version: "0.1.0",
              payloadSha256: "sha-0.1.0",
              payload: fixtureVersion,
            },
          }
        : null,
    handlers: {
      provisionMcp: async () => ({ tenantMcpServerId: "server-1" }),
      teardownMcp: async () => undefined,
      provisionSkills: async () => ({
        seededCatalogPrefixes: [],
        workspaceFolders: [],
        agentSlug: "agent-1",
      }),
      teardownSkills: async () => undefined,
    },
    deleteSecrets: async () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  depsHolder.current = buildDeps();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockRequireTenantAdmin.mockResolvedValue(undefined);
});

describe("admin gating", () => {
  it("a non-admin caller gets the structured authorization error and the engine never runs", async () => {
    mockRequireTenantAdmin.mockRejectedValue(
      new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }),
    );
    await expect(
      installPlugin(
        null,
        { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
        CTX,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(store.installs.size).toBe(0);
  });

  it("a caller with no resolvable tenant is rejected before the admin check", async () => {
    mockResolveCallerTenantId.mockResolvedValue(null);
    await expect(
      installPlugin(
        null,
        { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
        CTX,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
  });

  it("google-federated callers (null ctx.auth.tenantId) resolve the tenant via resolveCallerTenantId", async () => {
    const result = (await installPlugin(
      null,
      { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
      CTX,
    )) as Record<string, unknown>;

    expect(mockResolveCallerTenantId).toHaveBeenCalledWith(CTX);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(CTX, "tenant-1");
    expect(result.pluginKey).toBe("lastmile");
    expect(result.state).toBe("installed");
    expect(result.tenantId).toBe("tenant-1");
    expect(result.activatedUserCount).toBe(0);
    expect(Array.isArray(result.components)).toBe(true);
    expect((result.components as unknown[]).length).toBe(2);

    // The compliance event was bound to the resolved caller, not ctx.auth.
    expect(store.audits[0]).toMatchObject({
      eventType: "plugin.installed",
      actorId: "user-1",
      actorType: "user",
    });
  });

  it("pluginInstalls is admin-gated", async () => {
    mockRequireTenantAdmin.mockRejectedValue(
      new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }),
    );
    await expect(pluginInstalls(null, {} as never, CTX)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
  });
});

describe("uninstallPlugin", () => {
  it("rejects a destructiveConfirmation that does not match the plugin key", async () => {
    await installPlugin(
      null,
      { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
      CTX,
    );
    const installId = [...store.installs.keys()][0]!;
    await expect(
      uninstallPlugin(
        null,
        { input: { installId, destructiveConfirmation: "not-the-key" } },
        CTX,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "DESTRUCTIVE_CONFIRMATION_MISMATCH" },
    });
    expect(store.installs.size).toBe(1);
  });

  it("uninstalls with the matching confirmation and returns the final snapshot", async () => {
    await installPlugin(
      null,
      { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
      CTX,
    );
    const installId = [...store.installs.keys()][0]!;
    const result = (await uninstallPlugin(
      null,
      { input: { installId, destructiveConfirmation: "lastmile" } },
      CTX,
    )) as Record<string, unknown>;
    expect(result.state).toBe("uninstalling");
    expect(store.installs.size).toBe(0);
    expect(store.audits.map((a) => a.eventType)).toContain(
      "plugin.uninstalled",
    );
  });
});

describe("U6 stubs", () => {
  it("activatePlugin / deactivatePlugin return a structured NOT_IMPLEMENTED error", async () => {
    await expect(activatePlugin()).rejects.toMatchObject({
      extensions: { code: "NOT_IMPLEMENTED" },
    });
    await expect(deactivatePlugin()).rejects.toMatchObject({
      extensions: { code: "NOT_IMPLEMENTED" },
    });
  });
});

describe("myPluginActivations", () => {
  it("returns only the caller's activations, annotated with the plugin key", async () => {
    await installPlugin(
      null,
      { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
      CTX,
    );
    const installId = [...store.installs.keys()][0]!;
    store.seedActivation({
      user_id: "user-1",
      plugin_install_id: installId,
      granted_scopes: ["openid"],
    });
    store.seedActivation({ user_id: "user-2", plugin_install_id: installId });
    mockRequireTenantAdmin.mockClear(); // the install above was admin-gated

    const result = (await myPluginActivations(
      null,
      {} as never,
      CTX,
    )) as Record<string, unknown>[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      userId: "user-1",
      pluginKey: "lastmile",
      status: "active",
      grantedScopes: ["openid"],
    });
    // Member-level query: no admin check.
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
  });
});
