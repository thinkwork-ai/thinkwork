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
  mockStartActivation,
  mockDeactivateActivation,
  depsHolder,
  activationDepsHolder,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockStartActivation: vi.fn(),
  mockDeactivateActivation: vi.fn(),
  depsHolder: { current: null as unknown },
  activationDepsHolder: { current: null as unknown },
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

vi.mock("../../../lib/plugins/activation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/plugins/activation.js")>();
  return {
    ...actual,
    createDefaultPluginActivationDeps: () => activationDepsHolder.current,
    startActivation: mockStartActivation,
    deactivateActivation: mockDeactivateActivation,
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
      provisionInfra: async ({ handlerRef }) => handlerRef,
      teardownInfra: async ({ handlerRef }) => ({
        handlerRef,
        complete: true,
      }),
    },
    deleteSecrets: async () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  depsHolder.current = buildDeps();
  // activatePlugin/deactivatePlugin share the same store through their
  // own deps object (only `store` is consumed at the resolver level).
  activationDepsHolder.current = { store };
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockRequireTenantAdmin.mockResolvedValue(undefined);
  mockStartActivation.mockResolvedValue({
    authorizeUrl: "https://auth.example.invalid/authorize?state=signed",
  });
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

describe("activatePlugin (U6)", () => {
  it("is member-level, binds the CANONICAL caller user id, and returns the authorize URL", async () => {
    const result = (await activatePlugin(
      null,
      { input: { installId: "install-1" } },
      CTX,
    )) as { authorizeUrl: string };

    expect(result.authorizeUrl).toBe(
      "https://auth.example.invalid/authorize?state=signed",
    );
    // Member-level: no admin gate.
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    // Canonical caller binding: userId comes from the auth context,
    // tenant from resolveCallerTenantId — never from input fields.
    expect(mockStartActivation).toHaveBeenCalledWith(
      {
        userId: "user-1",
        tenantId: "tenant-1",
        pluginInstallId: "install-1",
        returnTo: null,
      },
      activationDepsHolder.current,
    );
  });

  it("rejects callers with no resolvable user identity", async () => {
    mockResolveCallerUserId.mockResolvedValue(null);
    await expect(
      activatePlugin(null, { input: { installId: "install-1" } }, CTX),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mockStartActivation).not.toHaveBeenCalled();
  });

  it("rejects an invalid returnTo before starting the flow", async () => {
    await expect(
      activatePlugin(
        null,
        {
          input: {
            installId: "install-1",
            returnTo: "https://evil.example.com/phish",
          },
        },
        CTX,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockStartActivation).not.toHaveBeenCalled();
  });
});

describe("deactivatePlugin (U6)", () => {
  it("deactivates the CALLER's activation and returns the revoked payload", async () => {
    await installPlugin(
      null,
      { input: { pluginKey: "lastmile", idempotencyKey: "i-1" } },
      CTX,
    );
    const installId = [...store.installs.keys()][0]!;
    const seeded = store.seedActivation({
      user_id: "user-1",
      plugin_install_id: installId,
      granted_scopes: ["openid"],
    });
    mockDeactivateActivation.mockResolvedValue({
      ...seeded,
      status: "revoked",
      revoked_at: new Date(),
    });
    mockRequireTenantAdmin.mockClear();

    const result = (await deactivatePlugin(
      null,
      { input: { installId } },
      CTX,
    )) as Record<string, unknown>;

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(mockDeactivateActivation).toHaveBeenCalledWith(
      {
        userId: "user-1",
        tenantId: "tenant-1",
        pluginInstallId: installId,
      },
      activationDepsHolder.current,
    );
    expect(result).toMatchObject({
      userId: "user-1",
      status: "revoked",
      pluginKey: "lastmile",
      grantedScopes: ["openid"],
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
