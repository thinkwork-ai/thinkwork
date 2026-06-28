/**
 * buildMcpConfigs plugin-dispatch tests (plan 2026-06-12-001 U6).
 *
 * Plugin-managed OAuth MCP servers (management_source='plugin') are registered
 * by plugin install but resolve auth from the REQUESTER's user_mcp_tokens
 * record. Direct per_user_oauth servers keep resolving user_mcp_tokens by
 * humanPairId (R16). user_headers and non-OAuth plugin servers continue to use
 * app-level activation records. Covers: the requester/human-pair split,
 * fail-closed null requester, URL-dedupe precedence, and activation-gated
 * non-OAuth/header shapes.
 *
 * getDb() is mocked (fake query shapes); schema + drizzle are REAL; the
 * plugin auth resolver runs for real against the in-memory store +
 * secrets fakes via the injectable `deps.pluginAuth` seam.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAgentRows,
  mockJoinRows,
  mockAssignmentRows,
  mockUserTokenRows,
  mockSecretString,
} = vi.hoisted(() => ({
  mockAgentRows: vi.fn(),
  mockJoinRows: vi.fn(),
  mockAssignmentRows: vi.fn(),
  mockUserTokenRows: vi.fn(),
  mockSecretString: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    ...actual,
    getDb: () => ({
      select: () => ({
        from: (table: unknown) => ({
          innerJoin: () => ({
            where: () => Promise.resolve(mockJoinRows()),
          }),
          where: () => {
            if (table === actual.schema.agents) {
              return {
                limit: () => Promise.resolve(mockAgentRows()),
              };
            }
            if (table === actual.schema.tenantMcpServers) {
              return Promise.resolve(mockJoinRows());
            }
            if (table === actual.schema.agentMcpServers) {
              return Promise.resolve(mockAssignmentRows());
            }
            return {
              limit: () => Promise.resolve(mockUserTokenRows()),
            };
          },
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

function twentyRecordLinkMetadata(over: Record<string, unknown> = {}) {
  return {
    recordLinkHints: {
      schemaVersion: 1,
      source: "plugin-manifest",
      browserBaseUrl: "https://crm.thinkwork.invalid",
      routes: [
        {
          objectType: "opportunity",
          routeTemplate: "/object/opportunity/{id}",
          idFields: ["id", "opportunityId"],
          labelFields: ["name"],
        },
      ],
      ...over,
    },
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
  mockAgentRows.mockReturnValue([{ tenant_id: "tenant-1" }]);
  mockAssignmentRows.mockReturnValue([]);
  mockUserTokenRows.mockReturnValue([]);
  mockSecretString.mockReturnValue("");
});

describe("buildMcpConfigs — plugin dispatch identity", () => {
  it("plugin-registered OAuth MCP servers resolve from the requester's MCP tokens", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("crm"),
      pluginRow("tasks"),
      pluginRow("routing"),
    ]);
    mockUserTokenRows.mockReturnValue([
      {
        id: "tok-plugin-mcp",
        secret_ref: "arn:plugin-mcp",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "requester-mcp-token" }),
    );

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
      expect(bearerToken(config)).toBe("requester-mcp-token");
    }
  });

  it("plugin servers resolve by requesterUserId while a direct per_user_oauth server resolves by humanPairId", async () => {
    mockJoinRows.mockReturnValue([pluginRow("crm"), directRow()]);
    // Plugin OAuth rows also use user_mcp_tokens, but they are keyed by the
    // requester. Direct rows are keyed by humanPairId.
    mockUserTokenRows.mockReturnValue([
      {
        id: "tok-user-mcp",
        secret_ref: "arn:user-mcp",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString
      .mockReturnValueOnce(
        JSON.stringify({ access_token: "plugin-user-token" }),
      )
      .mockReturnValueOnce(
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
    expect(bearerToken(plugin)).toBe("plugin-user-token");
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

  it("a requester WITHOUT an MCP token gets no plugin-registered OAuth MCP servers", async () => {
    mockJoinRows.mockReturnValue([pluginRow("crm")]);
    mockUserTokenRows.mockReturnValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );
    expect(configs).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("No active MCP token for user"),
    );
    warn.mockRestore();
  });

  it("plugin OAuth servers do not require a plugin activation when the requester has an MCP token", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("crm", {
        mcp_server_id: "srv-twenty",
        slug: "twenty--crm",
        name: "Twenty CRM",
        url: "https://crm.thinkwork.invalid/mcp",
        auth_config: { oauth_resource: "https://crm.thinkwork.invalid/mcp" },
        runtime_metadata: twentyRecordLinkMetadata(),
      }),
    ]);
    const pluginAuth = {
      resolveToken: vi.fn(async () => {
        throw new Error("plugin activation token must not be used");
      }),
      resolveHeaders: vi.fn(async () => ({})),
      hasActiveActivation: vi.fn(async () => false),
    };
    mockUserTokenRows.mockReturnValue([
      {
        id: "tok-twenty",
        secret_ref: "arn:twenty-user-token",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "twenty-server-level-token" }),
    );

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth },
    );

    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      name: "twenty--crm",
      url: "https://crm.thinkwork.invalid/mcp",
      auth: { type: "bearer", token: "twenty-server-level-token" },
      recordLinkHints: {
        schemaVersion: 1,
        source: "plugin-manifest",
        browserBaseUrl: "https://crm.thinkwork.invalid",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
            idFields: ["id", "opportunityId"],
            labelFields: ["name"],
          },
        ],
      },
    });
    expect(JSON.stringify(configs[0]!.recordLinkHints)).not.toContain(
      "twenty-server-level-token",
    );
    expect(pluginAuth.resolveToken).not.toHaveBeenCalled();
    expect(pluginAuth.hasActiveActivation).not.toHaveBeenCalled();
  });

  it("a requester WITHOUT an MCP token receives no plugin record-link hints", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("crm", {
        slug: "twenty--crm",
        runtime_metadata: twentyRecordLinkMetadata(),
      }),
    ]);
    mockUserTokenRows.mockReturnValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toEqual([]);
    expect(JSON.stringify(configs)).not.toContain("recordLinkHints");
    warn.mockRestore();
  });

  it("URL dedupe: plugin entry wins over a direct entry sharing the URL when requester MCP auth resolves", async () => {
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
        runtime_metadata: twentyRecordLinkMetadata({
          browserBaseUrl: "https://shared.lastmile.invalid",
        }),
      }),
    ]);
    mockUserTokenRows.mockReturnValue([
      {
        id: "tok-plugin-mcp",
        secret_ref: "arn:plugin-mcp",
        status: "active",
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({ access_token: "plugin-user-token" }),
    );

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(1); // never both
    expect(configs[0]!.name).toBe("lastmile--crm");
    expect(configs[0]!.recordLinkHints).toMatchObject({
      browserBaseUrl: "https://shared.lastmile.invalid",
      routes: [
        {
          objectType: "opportunity",
          routeTemplate: "/object/opportunity/{id}",
        },
      ],
    });
  });

  it("URL dedupe: the direct entry serves users whose plugin MCP auth does NOT resolve", async () => {
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
    // No MCP token for the requester → plugin entry drops, direct serves.
    mockUserTokenRows.mockReturnValue([]);
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

  it("no-auth plugin servers are tenant-owned and dispatch after install", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("brain", {
        slug: "company-brain--brain",
        name: "ThinkWork Brain",
        url: "http://internal-cognee.example.local/mcp-server/http",
        auth_type: "none",
        auth_config: null,
      }),
    ]);

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: null },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toEqual([
      {
        name: "company-brain--brain",
        url: "http://internal-cognee.example.local/mcp-server/http",
        transport: "streamable-http",
        trustedInternal: true,
      },
    ]);
  });

  it("service_credential plugin servers resolve tenant auth without requester activation", async () => {
    const authConfig = {
      credentialKind: "n8n-mcp-access-token",
      secretRef:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
      secretRefConfigKey: "serviceCredentialSecretArn",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
          valuePrefix: "Bearer ",
        },
      ],
    };
    mockJoinRows.mockReturnValue([
      pluginRow("workflow-management", {
        slug: "n8n--workflow-management",
        name: "n8n workflow management",
        url: "https://n8n.example.invalid/mcp-server/http",
        auth_type: "service_credential",
        auth_config: authConfig,
      }),
    ]);
    mockSecretString.mockReturnValue(
      JSON.stringify({
        N8N_MCP_SERVICE_CREDENTIAL: "n8n_service_token_123",
      }),
    );

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: null },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toEqual([
      {
        name: "n8n--workflow-management",
        url: "https://n8n.example.invalid/mcp-server/http",
        transport: "streamable-http",
        auth: { type: "bearer", token: "n8n_service_token_123" },
      },
    ]);
  });

  it("service_credential plugin servers fail closed when the secret key is missing", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("workflow-management", {
        slug: "n8n--workflow-management",
        auth_type: "service_credential",
        auth_config: {
          secretRef: "arn:aws:secretsmanager:us-east-1:123:secret:n8n-service",
          headers: [
            {
              name: "Authorization",
              secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
              valuePrefix: "Bearer ",
            },
          ],
        },
      }),
    ]);
    mockSecretString.mockReturnValue(JSON.stringify({ OTHER: "value" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("missing key N8N_MCP_SERVICE_CREDENTIAL"),
    );
    warn.mockRestore();
  });

  it("service_credential plugin servers fail closed when revoked", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("workflow-management", {
        slug: "n8n--workflow-management",
        auth_type: "service_credential",
        auth_config: {
          revokedAt: "2026-06-19T12:00:00.000Z",
          secretRef: "arn:aws:secretsmanager:us-east-1:123:secret:n8n-service",
          headers: [
            {
              name: "Authorization",
              secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
              valuePrefix: "Bearer ",
            },
          ],
        },
      }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const configs = await buildMcpConfigs(
      AGENT,
      { humanPairId: HUMAN_PAIR, requesterUserId: REQUESTER },
      "[test]",
      { pluginAuth: resolver() },
    );

    expect(configs).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("revoked"));
    warn.mockRestore();
  });

  it("user_headers plugin servers resolve bearer plus headers from the requester's activation secret", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("records", {
        slug: "header-auth--records",
        name: "Header-auth records",
        url: "https://headers.example.invalid/http/api-key/mcp",
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
    const ref = "thinkwork/test/plugin-header-auth/requester/records";
    store.seedToken({
      activation_id: activation.id,
      resource_indicator: "https://headers.example.invalid/http/api-key/mcp",
      secret_ref: ref,
    });
    secrets.values.set(
      ref,
      JSON.stringify({
        auth_type: "user-provided-headers",
        access_token: "header_token_user_123",
        token_type: "Bearer",
        headers: {
          "x-workspace-slug": "eng",
        },
        resource: "https://headers.example.invalid/http/api-key/mcp",
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
      name: "header-auth--records",
      url: "https://headers.example.invalid/http/api-key/mcp",
      auth: {
        type: "bearer",
        token: "header_token_user_123",
        headers: {
          "x-workspace-slug": "eng",
        },
      },
    });
  });

  it("user_headers plugin servers fail closed when the requester has no header secret", async () => {
    mockJoinRows.mockReturnValue([
      pluginRow("records", {
        slug: "header-auth--records",
        name: "Header-auth records",
        url: "https://headers.example.invalid/http/api-key/mcp",
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
