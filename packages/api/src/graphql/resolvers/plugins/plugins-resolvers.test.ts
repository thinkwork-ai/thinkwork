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
  mockActivateWithCredentials,
  mockDeactivateActivation,
  mockCutoverTwenty,
  mockIssuePremiumInstallKey,
  mockRedeemPremiumInstallKey,
  mockRevokePremiumInstallKey,
  mockGetPluginCatalog,
  mockGetPluginCatalogSnapshot,
  depsHolder,
  activationDepsHolder,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockStartActivation: vi.fn(),
  mockActivateWithCredentials: vi.fn(),
  mockDeactivateActivation: vi.fn(),
  mockCutoverTwenty: vi.fn(),
  mockIssuePremiumInstallKey: vi.fn(),
  mockRedeemPremiumInstallKey: vi.fn(),
  mockRevokePremiumInstallKey: vi.fn(),
  mockGetPluginCatalog: vi.fn(),
  mockGetPluginCatalogSnapshot: vi.fn(),
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

vi.mock("../../../lib/plugins/catalog-source.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../lib/plugins/catalog-source.js")
    >();
  return {
    ...actual,
    getPluginCatalog: mockGetPluginCatalog,
    getPluginCatalogSnapshot: mockGetPluginCatalogSnapshot,
  };
});

vi.mock("../../../lib/plugins/activation.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/plugins/activation.js")>();
  return {
    ...actual,
    createDefaultPluginActivationDeps: () => activationDepsHolder.current,
    startActivation: mockStartActivation,
    activatePluginWithCredentials: mockActivateWithCredentials,
    deactivateActivation: mockDeactivateActivation,
  };
});

vi.mock("@thinkwork/plugin-twenty/api/cutover", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@thinkwork/plugin-twenty/api/cutover")
    >();
  return {
    ...actual,
    cutoverTwentyPluginForTenant: mockCutoverTwenty,
  };
});

vi.mock(
  "../../../lib/plugins/premium-entitlements.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../lib/plugins/premium-entitlements.js")
      >();
    return {
      ...actual,
      createDefaultPremiumEntitlementDeps: () => ({ mocked: true }),
      issuePremiumInstallKey: mockIssuePremiumInstallKey,
      redeemPremiumInstallKey: mockRedeemPremiumInstallKey,
      revokePremiumInstallKey: mockRevokePremiumInstallKey,
    };
  },
);

import {
  allPluginManifests,
  buildPluginCatalog,
  type PluginVersion,
} from "@thinkwork/plugin-catalog";
import type {
  PluginEngineDeps,
  PremiumInstallGateInput,
} from "../../../lib/plugins/engine.js";
import {
  createInMemoryPluginEngineStore,
  type InMemoryPluginEngineStore,
} from "../../../lib/plugins/testing.js";
import {
  activatePlugin,
  activatePluginWithCredentials,
  cutoverTwentyPlugin,
  deactivatePlugin,
  installPlugin,
  issuePremiumPluginInstallKey,
  redeemPremiumPluginInstallKey,
  refreshPluginCatalog,
  revokePremiumPluginInstallKey,
  uninstallPlugin,
  upgradePlugin,
} from "./mutations.js";
import {
  myPluginActivations,
  pluginCatalog,
  pluginCatalogMetadata,
  pluginInstalls,
  pluginLaunchUrlForInstall,
} from "./queries.js";

const CTX = { auth: { tenantId: null } } as never; // Google-federated shape
const COMPANY_ETL_PAYLOAD_SHA256 =
  "49681471c865d81257872da252538f84345f42b43299c27764fc2714bb2e8abf";

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
let premiumAccessCalls: PremiumInstallGateInput[];

function buildDeps(options: { premium?: boolean } = {}): PluginEngineDeps {
  store = createInMemoryPluginEngineStore();
  premiumAccessCalls = [];
  return {
    store,
    resolveVersion: async (pluginKey, version) =>
      pluginKey === "lastmile" && (!version || version === "0.1.0")
        ? {
            plugin: {
              pluginKey: "lastmile",
              displayName: "LastMile",
              description: "d",
              ...(options.premium
                ? {
                    premium: {
                      entitlementProductKey: "lastmile-premium",
                      installKeyRequired: true,
                      installKeyPrompt:
                        "Enter the install key provided by ThinkWork.",
                    },
                  }
                : {}),
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
      provisionAuthProvider: async ({ component }) => ({
        status: "unconfigured",
        provider: component.provider,
        cognitoIdentityProviderName: component.cognitoIdentityProviderName,
        issuerHost: null,
        authProviderResourceId: null,
        tenantAuthProviderReferenceId: null,
        publicOptionsPublished: false,
        providerOptions: [],
        lastValidatedAt: null,
        diagnosticCode: "AUTH_PROVIDER_CONFIG_MISSING",
      }),
    },
    premiumAccess: {
      ensureInstallAllowed: async (input) => {
        premiumAccessCalls.push(input);
      },
    },
    deleteSecrets: async () => undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("THINKWORK_PLATFORM_OPERATOR_EMAILS", "ops@example.com");
  depsHolder.current = buildDeps();
  // activatePlugin/deactivatePlugin share the same store through their
  // own deps object (only `store` is consumed at the resolver level).
  activationDepsHolder.current = { store };
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockResolveCallerUserId.mockResolvedValue("user-1");
  mockRequireTenantAdmin.mockResolvedValue(undefined);
  mockGetPluginCatalog.mockResolvedValue(
    buildPluginCatalog({
      manifests: allPluginManifests,
      generatedAt: "2026-06-24T00:00:00.000Z",
    }),
  );
  mockGetPluginCatalogSnapshot.mockResolvedValue({
    source: "bundled-unsigned",
    catalog: {
      schemaVersion: 1,
      generatedAt: "2026-06-17T00:00:00.000Z",
      plugins: [],
    },
  });
  mockStartActivation.mockResolvedValue({
    authorizeUrl: "https://auth.example.invalid/authorize?state=signed",
  });
  mockActivateWithCredentials.mockImplementation(
    async ({
      userId,
      pluginInstallId,
    }: {
      userId: string;
      pluginInstallId: string;
    }) =>
      store.seedActivation({
        user_id: userId,
        plugin_install_id: pluginInstallId,
        granted_scopes: [],
      }),
  );
  mockIssuePremiumInstallKey.mockResolvedValue({
    rawKey: "twpi_test_key",
    key: {
      id: "key-1",
      plugin_key: "company-brain",
      entitlement_product_key: "company-brain-premium",
      tenant_id: "tenant-1",
      expires_at: null,
      issued_at: new Date("2026-06-13T12:00:00.000Z"),
    },
  });
  mockRedeemPremiumInstallKey.mockResolvedValue({
    source: "install_key",
    entitlement: {
      id: "entitlement-1",
      tenant_id: "tenant-1",
      plugin_key: "company-brain",
      entitlement_product_key: "company-brain-premium",
      status: "active",
      source: "install_key",
      granted_at: new Date("2026-06-13T12:00:00.000Z"),
      revoked_at: null,
      created_at: new Date("2026-06-13T12:00:00.000Z"),
      updated_at: new Date("2026-06-13T12:00:00.000Z"),
    },
  });
  mockRevokePremiumInstallKey.mockResolvedValue({
    key: {
      id: "key-1",
      plugin_key: "company-brain",
      status: "revoked",
      revoked_at: new Date("2026-06-13T12:00:00.000Z"),
    },
  });
});

describe("pluginCatalogMetadata", () => {
  it("returns source provenance and stale GitHub fallback details for members", async () => {
    mockGetPluginCatalogSnapshot.mockResolvedValue({
      source: "github-release-stale",
      catalog: {
        schemaVersion: 1,
        generatedAt: "2026-06-17T00:00:00.000Z",
        source: {
          repository: "thinkwork-ai/thinkwork",
          ref: "main",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
        },
        plugins: [],
      },
      github: {
        source: "github-release",
        repository: "thinkwork-ai/thinkwork",
        releaseTag: "plugin-catalog-main",
        assetName: "thinkwork-plugin-catalog-main.json",
        catalogSha256: "sha256:catalog",
        sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
        generatedAt: "2026-06-17T00:00:00.000Z",
        fetchedAt: "2026-06-17T01:00:00.000Z",
        stale: true,
        lastRefreshStatus: "stale-fallback",
        message: "GitHub catalog release fetch failed (403)",
        rateLimitRemaining: "0",
        rateLimitReset: "1760000000",
      },
    });

    const result = (await pluginCatalogMetadata(
      null,
      {} as never,
      CTX,
    )) as Record<string, unknown>;

    expect(mockResolveCallerTenantId).toHaveBeenCalledWith(CTX);
    expect(result).toMatchObject({
      source: "github-release-stale",
      repository: "thinkwork-ai/thinkwork",
      ref: "main",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      releaseTag: "plugin-catalog-main",
      assetName: "thinkwork-plugin-catalog-main.json",
      catalogSha256: "sha256:catalog",
      generatedAt: "2026-06-17T00:00:00.000Z",
      fetchedAt: "2026-06-17T01:00:00.000Z",
      stale: true,
      lastRefreshStatus: "stale-fallback",
      message: "GitHub catalog release fetch failed (403)",
      rateLimitRemaining: "0",
      rateLimitReset: "1760000000",
    });
  });
});

describe("pluginCatalog", () => {
  it("canonicalizes a legacy Data Integrations install onto the ThinkWork ETL catalog entry", async () => {
    store.seedInstall({
      tenant_id: "tenant-1",
      plugin_key: "data-integrations",
      pinned_version: "0.1.0",
      pinned_payload_sha256: COMPANY_ETL_PAYLOAD_SHA256,
      state: "installed",
    });

    const result = (await pluginCatalog(null, {} as never, CTX)) as Array<{
      pluginKey: string;
      displayName: string;
      install: { pluginKey: string; pinnedPayloadSha256: string } | null;
    }>;

    const companyEtl = result.find(
      (entry) => entry.pluginKey === "company-etl",
    );
    expect(companyEtl).toBeDefined();
    expect(companyEtl).toMatchObject({
      pluginKey: "company-etl",
      displayName: "ThinkWork ETL",
      install: {
        pluginKey: "company-etl",
        pinnedPayloadSha256: COMPANY_ETL_PAYLOAD_SHA256,
      },
    });
    expect(
      result.some((entry) => entry.pluginKey === "data-integrations"),
    ).toBe(false);
  });

  it("canonicalizes legacy Data Integrations activations to ThinkWork ETL", async () => {
    const install = store.seedInstall({
      tenant_id: "tenant-1",
      plugin_key: "data-integrations",
      pinned_version: "0.1.0",
      pinned_payload_sha256: COMPANY_ETL_PAYLOAD_SHA256,
      state: "installed",
    });
    store.seedActivation({
      user_id: "user-1",
      plugin_install_id: install.id,
      granted_scopes: [],
    });

    const result = (await myPluginActivations(
      null,
      {} as never,
      CTX,
    )) as unknown as Array<{ pluginKey: string; pluginInstallId: string }>;

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      pluginKey: "company-etl",
      pluginInstallId: install.id,
    });
  });
});

describe("refreshPluginCatalog", () => {
  it("requires tenant admin and force-refreshes the catalog snapshot", async () => {
    mockGetPluginCatalogSnapshot.mockResolvedValue({
      source: "github-release",
      catalog: {
        schemaVersion: 1,
        generatedAt: "2026-06-17T00:00:00.000Z",
        source: {
          repository: "thinkwork-ai/thinkwork",
          ref: "main",
          commitSha: "0123456789abcdef0123456789abcdef01234567",
        },
        plugins: [],
      },
      github: {
        source: "github-release",
        repository: "thinkwork-ai/thinkwork",
        releaseTag: "plugin-catalog-main",
        assetName: "thinkwork-plugin-catalog-main.json",
        catalogSha256: "sha256:catalog",
        sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
        generatedAt: "2026-06-17T00:00:00.000Z",
        fetchedAt: "2026-06-17T01:05:00.000Z",
        stale: false,
        lastRefreshStatus: "not-modified",
        rateLimitRemaining: "4998",
        rateLimitReset: "1760000100",
      },
    });

    const result = (await refreshPluginCatalog(
      null,
      {} as never,
      CTX,
    )) as Record<string, unknown>;

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(CTX, "tenant-1");
    expect(mockGetPluginCatalogSnapshot).toHaveBeenCalledWith({
      forceGitHubRefresh: true,
    });
    expect(result).toMatchObject({
      source: "github-release",
      lastRefreshStatus: "not-modified",
      fetchedAt: "2026-06-17T01:05:00.000Z",
      rateLimitRemaining: "4998",
    });
  });
});

function launchUrlDb(row: {
  key?: string;
  current_status: string;
  desired_config: Record<string, unknown>;
  latestSucceededOperation?: string | null;
}) {
  let selectCount = 0;
  const appRow = { key: row.key ?? "twenty", ...row };
  const jobRows = row.latestSucceededOperation
    ? [{ operation: row.latestSucceededOperation }]
    : [];
  const resultForSelect = () => {
    selectCount += 1;
    return selectCount === 1 ? [appRow] : jobRows;
  };
  const chain = () => ({
    where: vi.fn(() => ({
      limit: vi.fn(async () => resultForSelect()),
      orderBy: vi.fn(() => ({
        limit: vi.fn(async () => resultForSelect()),
      })),
    })),
  });
  return {
    select: vi.fn(() => ({
      from: vi.fn(chain),
    })),
  } as never;
}

describe("pluginLaunchUrlForInstall", () => {
  it("returns the public URL for provisioned infrastructure on a deployed app", async () => {
    await expect(
      pluginLaunchUrlForInstall(
        "tenant-1",
        {
          state: "installed",
          components: [
            {
              componentType: "infrastructure",
              state: "provisioned",
              handlerRef: { managedApplicationId: "app-1" },
            },
          ],
        },
        launchUrlDb({
          current_status: "enabled",
          desired_config: { publicUrl: "https://crm.example.test/" },
        }),
      ),
    ).resolves.toBe("https://crm.example.test");
  });

  it("returns the public URL when handlerRef is a GraphQL AWSJSON string", async () => {
    await expect(
      pluginLaunchUrlForInstall(
        "tenant-1",
        {
          state: "installed",
          components: [
            {
              componentType: "infrastructure",
              state: "provisioned",
              handlerRef: JSON.stringify({ managedApplicationId: "app-1" }),
            },
          ],
        },
        launchUrlDb({
          current_status: "enabled",
          desired_config: { publicUrl: "https://crm.example.test/" },
        }),
      ),
    ).resolves.toBe("https://crm.example.test");
  });

  it("returns the public URL when the latest succeeded app operation is running-capable", async () => {
    await expect(
      pluginLaunchUrlForInstall(
        "tenant-1",
        {
          state: "installed",
          components: [
            {
              componentType: "infrastructure",
              state: "provisioned",
              handlerRef: { managedApplicationId: "app-1" },
            },
          ],
        },
        launchUrlDb({
          key: "twenty",
          current_status: "unknown",
          desired_config: { publicUrl: "https://crm.example.test/" },
          latestSucceededOperation: "UPGRADE",
        }),
      ),
    ).resolves.toBe("https://crm.example.test");
  });

  it("returns the public URL for explicitly adopted running infrastructure", async () => {
    await expect(
      pluginLaunchUrlForInstall(
        "tenant-1",
        {
          state: "installed",
          components: [
            {
              componentType: "infrastructure",
              state: "provisioned",
              handlerRef: JSON.stringify({
                managedApplicationId: "app-1",
                adoptedRunningInfra: true,
              }),
            },
          ],
        },
        launchUrlDb({
          key: "twenty",
          current_status: "unknown",
          desired_config: { publicUrl: "https://crm.example.test/" },
        }),
      ),
    ).resolves.toBe("https://crm.example.test");
  });

  it("does not return a launch URL for parked or invalid deployments", async () => {
    await expect(
      pluginLaunchUrlForInstall(
        "tenant-1",
        {
          state: "installed",
          components: [
            {
              componentType: "infrastructure",
              state: "provisioned",
              handlerRef: { managedAppKey: "twenty" },
            },
          ],
        },
        launchUrlDb({
          current_status: "parked",
          desired_config: { publicUrl: "https://crm.example.test" },
          latestSucceededOperation: "UPGRADE",
        }),
      ),
    ).resolves.toBeNull();
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

  it("passes premium install keys and request metadata through to the engine gate", async () => {
    depsHolder.current = buildDeps({ premium: true });
    const ctx = {
      auth: { tenantId: null },
      headers: {
        "x-forwarded-for": "203.0.113.7, 10.0.0.1",
        "user-agent": "PremiumInstallTest/1.0",
      },
    } as never;

    await installPlugin(
      null,
      {
        input: {
          pluginKey: "lastmile",
          installKey: "twpi_valid",
          idempotencyKey: "i-premium",
        },
      },
      ctx,
    );

    expect(premiumAccessCalls).toHaveLength(1);
    expect(premiumAccessCalls[0]).toMatchObject({
      tenantId: "tenant-1",
      pluginKey: "lastmile",
      installKey: "twpi_valid",
      actor: { actorId: "user-1", actorType: "user" },
      request: {
        ip: "203.0.113.7",
        userAgent: "PremiumInstallTest/1.0",
      },
    });
  });

  it("upgrades an installed plugin to a launchable app ui-surface component", async () => {
    const oldVersion: PluginVersion = {
      version: "0.2.0",
      requiredOauthScopes: [],
      components: [
        {
          type: "mcp-server",
          key: "crm",
          displayName: "Twenty CRM",
          endpointUrl: "https://crm.example.invalid/mcp",
          auth: {
            mode: "oauth",
            authDomain: "https://auth.example.invalid",
            resourceIndicator: "https://crm.example.invalid",
          },
        },
      ],
    };
    const newVersion: PluginVersion = {
      version: "0.3.0",
      requiredOauthScopes: [],
      components: [
        oldVersion.components[0]!,
        {
          type: "ui-surface",
          key: "client-engagement",
          displayName: "Client Engagement",
          intendedMount: "apps.main",
          launch: {
            schemaVersion: 1,
            type: "app",
            appKey: "twenty-client-engagement",
            routeSegment: "client-engagement",
            mount: "main-shell",
            runtime: "trusted-bundled-react",
            description:
              "Account and opportunity engagement workspace for Twenty CRM records.",
            icon: "layout-dashboard",
            entitlementProductKey: "twenty-client-engagement",
          },
        },
      ],
    };
    const deps = buildDeps();
    deps.resolveVersion = async (pluginKey, version) => {
      if (pluginKey !== "twenty") return null;
      const payload = version === "0.3.0" ? newVersion : oldVersion;
      return {
        plugin: {
          pluginKey: "twenty",
          displayName: "Twenty CRM",
          description: "Customer relationship management.",
        },
        versionEntry: {
          version: payload.version,
          payloadSha256: `sha-${payload.version}`,
          payload,
        },
      };
    };
    depsHolder.current = deps;

    await installPlugin(
      null,
      {
        input: {
          pluginKey: "twenty",
          version: "0.2.0",
          idempotencyKey: "install-twenty",
        },
      },
      CTX,
    );
    const installId = [...store.installs.keys()][0]!;

    const result = (await upgradePlugin(
      null,
      {
        input: {
          installId,
          version: "0.3.0",
          idempotencyKey: "upgrade-twenty-app",
        },
      },
      CTX,
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      pluginKey: "twenty",
      pinnedVersion: "0.3.0",
      state: "installed",
    });
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentKey: "client-engagement",
          componentType: "ui-surface",
          state: "provisioned",
          handlerRef: {},
        }),
      ]),
    );
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

describe("activatePluginWithCredentials (THNK-27 U5)", () => {
  it("is member-level, binds the caller, and never accepts a user id from input", async () => {
    await installPlugin(
      null,
      { input: { pluginKey: "lastmile", idempotencyKey: "i-credentials" } },
      CTX,
    );
    const installId = [...store.installs.keys()][0]!;
    mockRequireTenantAdmin.mockClear();

    const result = (await activatePluginWithCredentials(
      null,
      {
        input: {
          installId,
          credentials: [
            { key: "apiKey", value: "header-token" },
            { key: "workspaceSlug", value: "eng" },
          ],
        },
      },
      CTX,
    )) as Record<string, unknown>;

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(mockActivateWithCredentials).toHaveBeenCalledWith(
      {
        userId: "user-1",
        tenantId: "tenant-1",
        pluginInstallId: installId,
        credentials: {
          apiKey: "header-token",
          workspaceSlug: "eng",
        },
      },
      activationDepsHolder.current,
    );
    expect(result).toMatchObject({
      userId: "user-1",
      pluginKey: "lastmile",
      status: "active",
      grantedScopes: [],
    });
  });

  it("rejects blank credential keys before storing secrets", async () => {
    await expect(
      activatePluginWithCredentials(
        null,
        {
          input: {
            installId: "install-1",
            credentials: [{ key: "", value: "header-token" }],
          },
        },
        CTX,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expect(mockActivateWithCredentials).not.toHaveBeenCalled();
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

describe("premium entitlement key mutations (THNK-15 U3)", () => {
  it("issues keys only for ThinkWork platform operators and returns the raw key once", async () => {
    const ctx = {
      auth: { tenantId: null, email: "ops@example.com" },
      headers: { "x-forwarded-for": "203.0.113.10", "user-agent": "vitest" },
    } as never;

    const result = (await issuePremiumPluginInstallKey(
      null,
      {
        input: {
          pluginKey: "company-brain",
          tenantId: "tenant-1",
          expiresAt: null,
        },
      },
      ctx,
    )) as Record<string, unknown>;

    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(mockIssuePremiumInstallKey).toHaveBeenCalledWith(
      {
        pluginKey: "company-brain",
        tenantId: "tenant-1",
        expiresAt: null,
        actor: { actorId: "user-1", actorType: "user" },
        request: { ip: "203.0.113.10", userAgent: "vitest" },
      },
      { mocked: true },
    );
    expect(result.installKey).toBe("twpi_test_key");
    expect(result.keyId).toBe("key-1");
  });

  it("refuses premium key issuance for a tenant admin who is not a platform operator", async () => {
    const ctx = {
      auth: { tenantId: null, email: "admin@example.com" },
      headers: {},
    } as never;

    await expect(
      issuePremiumPluginInstallKey(
        null,
        {
          input: {
            pluginKey: "company-brain",
            tenantId: "tenant-1",
            expiresAt: null,
          },
        },
        ctx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    expect(mockIssuePremiumInstallKey).not.toHaveBeenCalled();
  });

  it("redeems keys through the tenant-admin boundary and resolved tenant", async () => {
    const result = (await redeemPremiumPluginInstallKey(
      null,
      {
        input: {
          pluginKey: "company-brain",
          installKey: "twpi_test_key",
        },
      },
      CTX,
    )) as Record<string, unknown>;

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(CTX, "tenant-1");
    expect(mockRedeemPremiumInstallKey).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        pluginKey: "company-brain",
        rawKey: "twpi_test_key",
        actor: { actorId: "user-1", actorType: "user" },
        request: { ip: null, userAgent: null },
      },
      { mocked: true },
    );
    expect((result.entitlement as Record<string, unknown>).tenantId).toBe(
      "tenant-1",
    );
    expect(result.source).toBe("install_key");
  });

  it("revokes keys only for ThinkWork platform operators", async () => {
    const ctx = {
      auth: { tenantId: null, email: "ops@example.com" },
      headers: {},
    } as never;

    const result = (await revokePremiumPluginInstallKey(
      null,
      { input: { keyId: "key-1", tenantId: "tenant-1" } },
      ctx,
    )) as Record<string, unknown>;

    expect(mockRevokePremiumInstallKey).toHaveBeenCalledWith(
      {
        keyId: "key-1",
        tenantId: "tenant-1",
        actor: { actorId: "user-1", actorType: "user" },
        request: { ip: null, userAgent: null },
      },
      { mocked: true },
    );
    expect(result.status).toBe("revoked");
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

describe("cutoverTwentyPlugin (U10)", () => {
  it("is tenant-admin gated and runs the cutover with the canonical caller actor", async () => {
    mockCutoverTwenty.mockResolvedValue({
      adopted: true,
      mcpServerId: "server-1",
      invalidatedUserTokenCount: 2,
      message: "Adopted.",
    });

    const result = await cutoverTwentyPlugin(null, {}, CTX);

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(CTX, "tenant-1");
    expect(mockCutoverTwenty).toHaveBeenCalledWith(
      {
        tenantId: "tenant-1",
        actorId: "user-1",
        actorType: "user",
      },
      expect.objectContaining({
        getTwentyInstall: expect.any(Function),
        adoptLegacyRow: expect.any(Function),
      }),
    );
    expect(result).toMatchObject({
      adopted: true,
      mcpServerId: "server-1",
      invalidatedUserTokenCount: 2,
    });
  });

  it("a non-admin caller is rejected before the cutover runs", async () => {
    mockRequireTenantAdmin.mockRejectedValue(
      new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }),
    );
    await expect(cutoverTwentyPlugin(null, {}, CTX)).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(mockCutoverTwenty).not.toHaveBeenCalled();
  });
});
