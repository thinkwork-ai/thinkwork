/**
 * buildMcpConfigs plugin-dispatch tests (plan 2026-06-12-001 U6).
 *
 * Plugin-managed servers (management_source='plugin') resolve auth from
 * the REQUESTER's app-level activation token records; direct
 * per_user_oauth servers keep resolving user_mcp_tokens by humanPairId
 * (R16). Covers: the requester/human-pair split, fail-closed null
 * requester, URL-dedupe precedence, needs_reauth refresh-failure skip,
 * and deactivation dropping servers on the next resolution.
 *
 * getDb() is mocked (fake query shapes); schema + drizzle are REAL; the
 * plugin auth resolver runs for real against the in-memory store +
 * secrets fakes via the injectable `deps.pluginAuth` seam.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockJoinRows, mockUserTokenRows, mockSecretString } = vi.hoisted(
  () => ({
    mockJoinRows: vi.fn(),
    mockUserTokenRows: vi.fn(),
    mockSecretString: vi.fn(),
  }),
);

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve(mockJoinRows()),
          }),
          where: () => ({
            limit: () => Promise.resolve(mockUserTokenRows()),
          }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    }),
  };
});

vi.mock("@aws-sdk/client-secrets-manager", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@aws-sdk/client-secrets-manager")>();
  class Stub {
    async send() {
      return { SecretString: mockSecretString() };
    }
  }
  return {
    ...actual,
    SecretsManagerClient: Stub,
  };
});

// eslint-disable-next-line import/first
import { buildMcpConfigs } from "../mcp-configs.js";
// eslint-disable-next-line import/first
import {
  createPluginDispatchAuthResolver,
  type PluginDispatchAuthResolver,
} from "../plugins/activation.js";
// eslint-disable-next-line import/first
import {
  createInMemoryPluginEngineStore,
  createInMemoryPluginSecrets,
  type InMemoryPluginEngineStore,
  type InMemoryPluginSecrets,
} from "../plugins/testing.js";

const AGENT = "agent-1";
const REQUESTER = "requester-user-1";
const HUMAN_PAIR = "human-pair-1";
const INSTALL = "install-lastmile-1";

function pluginRow(key: string, over: Record<string, unknown> = {}) {
  return {
    mcp_server_id: `srv-${key}`,
    name: key.toUpperCase(),
    slug: `lastmile--${key}`,
    url: `https://${key}.lastmile.invalid/mcp`,
    transport: "streamable-http",
    auth_type: "oauth",
    auth_config: { oauth_resource: `https://${key}.lastmile.invalid` },
    tools: null,
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "plugin",
    plugin_install_id: INSTALL,
    assignment_enabled: true,
    assignment_config: null,
    ...over,
  };
}

function directRow(over: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "srv-direct",
    name: "Direct",
    slug: "direct-server",
    url: "https://direct.example.invalid/mcp",
    transport: "streamable-http",
    auth_type: "per_user_oauth",
    auth_config: null,
    tools: null,
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "manual",
    plugin_install_id: null,
    assignment_enabled: true,
    assignment_config: null,
    ...over,
  };
}

let store: InMemoryPluginEngineStore;
let secrets: InMemoryPluginSecrets;

function seedActivationWithTokens(
  resources: string[],
  userId = REQUESTER,
): void {
  const activation = store.seedActivation({
    user_id: userId,
    plugin_install_id: INSTALL,
    granted_scopes: ["openid"],
  });
  for (const resource of resources) {
    const ref = `thinkwork/test/plugin-tokens/${userId}/${INSTALL}/${resource.replace(/[^a-z0-9]+/g, "-")}`;
    store.seedToken({
      activation_id: activation.id,
      resource_indicator: resource,
      secret_ref: ref,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    });
    secrets.values.set(
      ref,
      JSON.stringify({
        access_token: `plugin-token-${resource}`,
        refresh_token: "rt",
        token_type: "Bearer",
        client_id: "client-1",
        token_endpoint: "https://auth.example.invalid/token",
        resource,
      }),
    );
  }
}

function resolver(
  fetchFn: typeof fetch = (async () =>
    new Response("{}", { status: 500 })) as typeof fetch,
): PluginDispatchAuthResolver {
  return createPluginDispatchAuthResolver({
    store,
    secrets,
    fetchFn,
    now: () => new Date(),
  });
}

function bearerToken(config: { auth?: unknown }): string | undefined {
  const auth = config.auth as { type?: string; token?: string } | undefined;
  return auth?.type === "bearer" ? auth.token : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  store = createInMemoryPluginEngineStore();
  secrets = createInMemoryPluginSecrets();
  mockUserTokenRows.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
});

describe("buildMcpConfigs — plugin dispatch identity", () => {
  it("AE2: one activation's token records resolve ALL three LastMile-shaped servers", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("crm"),
      pluginRow("tasks"),
      pluginRow("routing"),
    ]);
    seedActivationWithTokens([
      "https://crm.lastmile.invalid",
      "https://tasks.lastmile.invalid",
      "https://routing.lastmile.invalid",
    ]);

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs.map((config) => config.name).sort()).toEqual([
      "lastmile--crm",
      "lastmile--routing",
      "lastmile--tasks",
    ]);
    for (const config of configs) {
      expect(bearerToken(config)).toMatch(/^plugin-token-/);
    }
  });

  it("plugin servers resolve by requesterUserId while a direct per_user_oauth server resolves by humanPairId", async () => {
    mockJoinRows.mockReturnValue([pluginRow("crm"), directRow()]);
    // Plugin token belongs to the REQUESTER (not the human pair).
    seedActivationWithTokens(["https://crm.lastmile.invalid"]);
    // Direct token rows come back from the user_mcp_tokens query — the
    // SQL is keyed by humanPairId (asserted by the no-humanPairId case
    // below returning nothing despite this row being available).
    mockUserTokenRows.mockReturnValue([
      {
        id: "tok-direct",
        secret_ref: "arn:direct",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "direct-user-token" }),
    );

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(2);
    const plugin = configs.find((config) => config.name === "lastmile--crm")!;
    const direct = configs.find((config) => config.name === "direct-server")!;
    expect(bearerToken(plugin)).toBe(
      "plugin-token-https://crm.lastmile.invalid",
    );
    expect(bearerToken(direct)).toBe("direct-user-token");
  });

  it("R16: a direct per_user_oauth server still resolves when there is NO requester (humanPairId only)", async () => {
    mockJoinRows.mockReturnValue([directRow()]);
    mockUserTokenRows.mockReturnValue([
      {
        id: "tok-direct",
        secret_ref: "arn:direct",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "direct-user-token" }),
    );
    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: null },
      "[test]",
      { pluginAuth: resolver() },
    );
    expect(configs).toHaveLength(1);
    expect(bearerToken(configs[0]!)).toBe("direct-user-token");
  });

  it("FAIL CLOSED: a null requester excludes plugin servers entirely", async () => {
    mockJoinRows.mockReturnValue([pluginRow("crm"), directRow()]);
    seedActivationWithTokens(["https://crm.lastmile.invalid"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: null },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs.map((config) => config.name)).not.toContain("lastmile--crm");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no resolvable requesting user"),
    );
    warn.mockRestore();
  });

  it("a requester WITHOUT an activation gets no plugin servers (deactivation drops them next resolution)", async () => {
    mockJoinRows.mockReturnValue([pluginRow("crm")]);
    // No activation seeded — the post-deactivation shape.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );
    expect(configs).toHaveLength(0);
    warn.mockRestore();
  });

  it("URL dedupe: plugin entry wins over a direct entry sharing the URL when the activation resolves", async () => {
    const sharedUrl = "https://shared.lastmile.invalid/mcp";
    mockJoinRows.mockReturnValue([
      // Direct row listed FIRST to prove ordering is by kind, not row order.
      directRow({
        mcp_server_id: "srv-shared-direct",
        slug: "shared-direct",
        url: sharedUrl,
        auth_type: "none",
        auth_config: null,
      }),
      pluginRow("crm", {
        url: sharedUrl,
        auth_config: { oauth_resource: "https://crm.lastmile.invalid" },
      }),
    ]);
    seedActivationWithTokens(["https://crm.lastmile.invalid"]);

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(1); // never both
    expect(configs[0]!.name).toBe("lastmile--crm");
  });

  it("URL dedupe: the direct entry serves users whose activation does NOT resolve", async () => {
    const sharedUrl = "https://shared.lastmile.invalid/mcp";
    mockJoinRows.mockReturnValue([
      pluginRow("crm", { url: sharedUrl }),
      directRow({
        mcp_server_id: "srv-shared-direct",
        slug: "shared-direct",
        url: sharedUrl,
        auth_type: "none",
        auth_config: null,
      }),
    ]);
    // No activation for the requester → plugin entry drops, direct serves.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );
    expect(configs).toHaveLength(1);
    expect(configs[0]!.name).toBe("shared-direct");
    warn.mockRestore();
  });

  it("refresh failure marks needs_reauth and skips the plugin's remaining servers WITHOUT throwing", async () => {
    mockJoinRows.mockReturnValue([pluginRow("crm"), pluginRow("tasks")]);
    seedActivationWithTokens([
      "https://crm.lastmile.invalid",
      "https://tasks.lastmile.invalid",
    ]);
    // Expire both token records; the AS rejects the refresh.
    for (const token of store.tokens.values()) {
      token.expires_at = new Date(Date.now() - 1000);
    }
    const failingFetch = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      })) as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver(failingFetch) },
    );

    expect(configs).toHaveLength(0); // skipped, not thrown
    const activation = [...store.activations.values()][0]!;
    expect(activation.status).toBe("needs_reauth");
    warn.mockRestore();
  });

  it("non-OAuth plugin servers still gate on an active activation", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("docs", { auth_type: "none", auth_config: null }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Without activation: excluded.
    expect(
      await buildMcpConfigs(
        AGENT,
        { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
        "[test]",
        { pluginAuth: resolver() },
      ),
    ).toHaveLength(0);
    // With an active activation: included (no bearer auth required).
    store.seedActivation({
      user_id: REQUESTER,
      plugin_install_id: INSTALL,
    });
    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );
    expect(configs).toHaveLength(1);
    expect(configs[0]!.auth).toBeUndefined();
    warn.mockRestore();
  });

  it("Plane-style user_headers plugin servers resolve bearer plus headers from the requester's activation secret", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("issues", {
        slug: "plane--issues",
        name: "Plane work items",
        url: "https://plane.example.invalid/http/api-key/mcp",
        auth_type: "user_headers",
        auth_config: {
          bearerCredentialKey: "apiKey",
          headers: [
            { name: "x-workspace-slug", credentialKey: "workspaceSlug" },
          ],
        },
      }),
    ]);
    const activation = store.seedActivation({
      user_id: REQUESTER,
      plugin_install_id: INSTALL,
    });
    const ref = "thinkwork/test/plugin-header-auth/requester/plane";
    store.seedToken({
      activation_id: activation.id,
      resource_indicator: "https://plane.example.invalid/http/api-key/mcp",
      secret_ref: ref,
    });
    secrets.values.set(
      ref,
      JSON.stringify({
        auth_type: "user-provided-headers",
        access_token: "plane_pat_user_123",
        token_type: "Bearer",
        headers: {
          "x-workspace-slug": "eng",
        },
        resource: "https://plane.example.invalid/http/api-key/mcp",
      }),
    );

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      name: "plane--issues",
      url: "https://plane.example.invalid/http/api-key/mcp",
      auth: {
        type: "bearer",
        token: "plane_pat_user_123",
        headers: {
          "x-workspace-slug": "eng",
        },
      },
    });
  });

  it("Plane-style user_headers plugin servers fail closed when the requester has no header secret", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("issues", {
        slug: "plane--issues",
        name: "Plane work items",
        url: "https://plane.example.invalid/http/api-key/mcp",
        auth_type: "user_headers",
        auth_config: {
          headers: [{ name: "x-api-key", credentialKey: "apiKey" }],
        },
      }),
    ]);
    store.seedActivation({
      user_id: REQUESTER,
      plugin_install_id: INSTALL,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no active header credential record"),
    );
    warn.mockRestore();
  });
});
