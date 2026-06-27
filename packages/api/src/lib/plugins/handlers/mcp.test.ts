/**
 * MCP component handler tests (plan 2026-06-12-001 U5).
 *
 * Chain-mock Drizzle db (same approach as the deployment resolver tests):
 * select results come from a queue, insert/update/delete calls are
 * recorded for assertions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  returningQueue,
  insertCalls,
  updateCalls,
  deleteCalls,
  mockDb,
  cogneeStatus,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const deleteCalls: unknown[] = [];
  const cogneeStatus = {
    enabled: false,
    endpoint: null as string | null,
    backendMode: null as string | null,
  };
  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
        then: (resolve: (v: unknown[]) => void, reject: (e: unknown) => void) =>
          Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push(values);
        return {
          returning: async () => returningQueue.shift() ?? [],
          onConflictDoUpdate: async () => [],
          onConflictDoNothing: async () => [],
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        };
      },
    })),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => {
        updateCalls.push(values);
        return {
          where: () => ({
            returning: async () => returningQueue.shift() ?? [],
            then: (resolve: (v: unknown[]) => void) => resolve([]),
          }),
        };
      },
    })),
    delete: vi.fn((table: unknown) => {
      deleteCalls.push(table);
      return {
        where: () => ({
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        }),
      };
    }),
  };
  return {
    selectQueue,
    returningQueue,
    insertCalls,
    updateCalls,
    deleteCalls,
    mockDb,
    cogneeStatus,
  };
});

vi.mock("../../../graphql/utils.js", () => ({ db: mockDb }));
vi.mock("../../../graphql/resolvers/core/managedApplications.js", () => ({
  readCogneeStatus: () => cogneeStatus,
}));

import { tenantMcpServers, userMcpTokens } from "@thinkwork/database-pg/schema";
import type { McpServerComponent } from "@thinkwork/plugin-catalog";
import {
  pluginMcpServerSlug,
  provisionPluginMcpComponent,
  resolvePluginMcpEndpoint,
  teardownPluginMcpComponent,
} from "./mcp.js";

const component: McpServerComponent = {
  type: "mcp-server",
  key: "crm",
  displayName: "LastMile CRM",
  endpointUrl: "https://crm.example.invalid/mcp",
  auth: {
    mode: "oauth",
    authDomain: "https://auth.example.invalid",
    resourceIndicator: "https://crm.example.invalid",
  },
};

beforeEach(() => {
  selectQueue.length = 0;
  returningQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  cogneeStatus.enabled = false;
  cogneeStatus.endpoint = null;
  cogneeStatus.backendMode = null;
});

describe("provisionPluginMcpComponent", () => {
  it("creates a plugin-owned approved row with oauth_resource auth and assigns platform agents", async () => {
    selectQueue.push([]); // no existing plugin row
    selectQueue.push([]); // no manual row with the same endpoint
    returningQueue.push([{ id: "server-1" }]);
    selectQueue.push([{ id: "agent-1" }]); // platform agents

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "lastmile",
      component,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-1",
      resolvedEndpointUrl: "https://crm.example.invalid/mcp",
    });
    expect(insertCalls[0]).toMatchObject({
      tenant_id: "tenant-1",
      name: "LastMile CRM",
      slug: "lastmile--crm",
      url: "https://crm.example.invalid/mcp",
      transport: "streamable-http",
      auth_type: "oauth",
      auth_config: { oauth_resource: "https://crm.example.invalid" },
      enabled: true,
      management_source: "plugin",
      plugin_install_id: "install-1",
      status: "approved",
    });
    expect(insertCalls[0]!.url_hash).toEqual(expect.any(String));
    // Platform agent assignment row
    expect(insertCalls[1]).toMatchObject({
      agent_id: "agent-1",
      tenant_id: "tenant-1",
      mcp_server_id: "server-1",
      enabled: true,
    });
  });

  it("adopts an existing manual row with the same URL instead of inserting a duplicate", async () => {
    selectQueue.push([]); // no plugin-owned row
    selectQueue.push([{ id: "server-2" }]); // manual row with the same endpoint
    selectQueue.push([]); // no platform agents

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "lastmile",
      component,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-2",
      resolvedEndpointUrl: "https://crm.example.invalid/mcp",
    });
    expect(updateCalls[0]).toMatchObject({
      name: "LastMile CRM",
      slug: "lastmile--crm",
      url: "https://crm.example.invalid/mcp",
      management_source: "plugin",
      plugin_install_id: "install-1",
      status: "approved",
    });
    expect(insertCalls).toHaveLength(0);
  });

  it("repairs an existing plugin-owned row instead of inserting a duplicate", async () => {
    selectQueue.push([{ id: "server-9" }]); // existing plugin row
    selectQueue.push([{ id: "agent-1" }]); // platform agents

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "lastmile",
      component: {
        ...component,
        endpointUrl: "https://crm-v2.example.invalid/mcp",
        auth: { mode: "none" },
      },
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-9",
      resolvedEndpointUrl: "https://crm-v2.example.invalid/mcp",
    });
    expect(updateCalls[0]).toMatchObject({
      url: "https://crm-v2.example.invalid/mcp",
      auth_type: "none",
      auth_config: null,
      management_source: "plugin",
      plugin_install_id: "install-1",
      status: "approved",
    });
    // No tenant_mcp_servers insert — only the agent-assignment upsert.
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ mcp_server_id: "server-9" });
  });

  it("namespaces slugs as <pluginKey>--<componentKey>", () => {
    expect(pluginMcpServerSlug("lastmile", "crm")).toBe("lastmile--crm");
  });
});

// U10: the one allowed endpoint indirection — tenant-specific endpoints
// resolve from the managed_applications row at provision time.
const endpointFromComponent: McpServerComponent = {
  type: "mcp-server",
  key: "crm",
  displayName: "Twenty CRM",
  endpointFrom: { managedApp: "twenty", configKey: "publicUrl", path: "/mcp" },
  auth: { mode: "oauth-per-instance" },
  recordLinkHints: {
    schemaVersion: 1,
    source: "plugin-manifest",
    routes: [
      {
        objectType: "opportunity",
        routeTemplate: "/object/opportunity/{id}",
        idFields: ["id", "opportunityId"],
        labelFields: ["name"],
      },
    ],
  },
};

describe("endpointFrom resolution (U10)", () => {
  it("resolves the endpoint and stores non-secret record-link metadata", async () => {
    selectQueue.push([
      {
        desired_config: { publicUrl: "https://crm.tenant.example.com/welcome" },
      },
    ]); // managed_applications row
    selectQueue.push([]); // no existing plugin row
    selectQueue.push([]); // no manual row with the same endpoint
    returningQueue.push([{ id: "server-7" }]);
    selectQueue.push([]); // no platform agents

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-7",
      resolvedEndpointUrl: "https://crm.tenant.example.com/mcp",
    });
    expect(insertCalls[0]).toMatchObject({
      slug: "twenty--crm",
      url: "https://crm.tenant.example.com/mcp",
      auth_type: "oauth",
      // Mirrors the legacy managedTwentyAuthConfig shape exactly.
      auth_config: { oauth_resource: "https://crm.tenant.example.com/mcp" },
      management_source: "plugin",
      plugin_install_id: "install-1",
      status: "approved",
      runtime_metadata: {
        recordLinkHints: {
          schemaVersion: 1,
          source: "plugin-manifest",
          browserBaseUrl: "https://crm.tenant.example.com",
          routes: [
            {
              objectType: "opportunity",
              routeTemplate: "/object/opportunity/{id}",
              idFields: ["id", "opportunityId"],
              labelFields: ["name"],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(insertCalls[0]!.runtime_metadata)).not.toContain(
      "/mcp",
    );
    expect(JSON.stringify(insertCalls[0]!.runtime_metadata)).not.toContain(
      "token",
    );
  });

  it("repairs existing plugin-owned rows with runtime record-link metadata without changing auth", async () => {
    selectQueue.push([
      {
        desired_config: { publicUrl: "https://crm.tenant.example.com/old" },
      },
    ]);
    selectQueue.push([{ id: "server-7" }]); // existing plugin row
    selectQueue.push([]); // no platform agents

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-7",
      resolvedEndpointUrl: "https://crm.tenant.example.com/mcp",
    });
    expect(updateCalls[0]).toMatchObject({
      auth_type: "oauth",
      auth_config: { oauth_resource: "https://crm.tenant.example.com/mcp" },
      runtime_metadata: {
        recordLinkHints: {
          browserBaseUrl: "https://crm.tenant.example.com",
          routes: [
            {
              objectType: "opportunity",
              routeTemplate: "/object/opportunity/{id}",
            },
          ],
        },
      },
    });
  });

  it("preserves cached OAuth DCR metadata when repairing the same plugin-owned resource", async () => {
    selectQueue.push([
      {
        desired_config: { publicUrl: "https://crm.tenant.example.com/old" },
      },
    ]);
    selectQueue.push([
      {
        id: "server-7",
        auth_config: {
          oauth_resource: "https://crm.tenant.example.com/mcp",
          authorize_endpoint: "https://crm.tenant.example.com/auth/authorize",
          token_endpoint: "https://crm.tenant.example.com/auth/token",
          client_id: "cached-client-id",
        },
      },
    ]);
    selectQueue.push([]); // no platform agents

    await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(updateCalls[0]).toMatchObject({
      auth_type: "oauth",
      auth_config: {
        oauth_resource: "https://crm.tenant.example.com/mcp",
        authorize_endpoint: "https://crm.tenant.example.com/auth/authorize",
        token_endpoint: "https://crm.tenant.example.com/auth/token",
        client_id: "cached-client-id",
      },
    });
    expect(updateCalls[0]!.url_hash).toEqual(expect.any(String));
  });

  it("does not preserve cached OAuth DCR metadata when the resource changes", async () => {
    selectQueue.push([
      {
        desired_config: { publicUrl: "https://crm.tenant.example.com/old" },
      },
    ]);
    selectQueue.push([
      {
        id: "server-7",
        auth_config: {
          oauth_resource: "https://old-crm.tenant.example.com/mcp",
          authorize_endpoint: "https://old-crm.tenant.example.com/auth",
          token_endpoint: "https://old-crm.tenant.example.com/token",
          client_id: "stale-client-id",
        },
      },
    ]);
    selectQueue.push([]); // no platform agents

    await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(updateCalls[0]).toMatchObject({
      auth_type: "oauth",
      auth_config: { oauth_resource: "https://crm.tenant.example.com/mcp" },
    });
    expect(updateCalls[0]!.auth_config).not.toHaveProperty("client_id");
  });

  it("adopts manual rows with runtime record-link metadata", async () => {
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "https://crm.tenant.example.com/app?utm=1#top",
        },
      },
    ]);
    selectQueue.push([]); // no plugin-owned row
    selectQueue.push([{ id: "server-manual" }]); // manual row same endpoint
    selectQueue.push([]); // no platform agents

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-manual",
      resolvedEndpointUrl: "https://crm.tenant.example.com/mcp",
    });
    expect(updateCalls[0]).toMatchObject({
      management_source: "plugin",
      plugin_install_id: "install-1",
      runtime_metadata: {
        recordLinkHints: {
          browserBaseUrl: "https://crm.tenant.example.com",
        },
      },
    });
    expect(insertCalls).toHaveLength(0);
  });

  it("preserves cached OAuth DCR metadata when adopting a manual row for the same resource", async () => {
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "https://crm.tenant.example.com/app?utm=1#top",
        },
      },
    ]);
    selectQueue.push([]); // no plugin-owned row
    selectQueue.push([
      {
        id: "server-manual",
        auth_config: {
          oauth_resource: "https://crm.tenant.example.com/mcp",
          authorize_endpoint: "https://crm.tenant.example.com/auth/authorize",
          token_endpoint: "https://crm.tenant.example.com/auth/token",
          client_id: "manual-client-id",
        },
      },
    ]);
    selectQueue.push([]); // no platform agents

    await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(updateCalls[0]).toMatchObject({
      management_source: "plugin",
      plugin_install_id: "install-1",
      auth_config: {
        oauth_resource: "https://crm.tenant.example.com/mcp",
        authorize_endpoint: "https://crm.tenant.example.com/auth/authorize",
        token_endpoint: "https://crm.tenant.example.com/auth/token",
        client_id: "manual-client-id",
      },
    });
  });

  it("omits runtime record-link metadata for remote http origins", async () => {
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "http://crm.tenant.example.com/app",
        },
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    returningQueue.push([{ id: "server-http" }]);
    selectQueue.push([]);

    await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(insertCalls[0]).toMatchObject({
      url: "http://crm.tenant.example.com/mcp",
      runtime_metadata: null,
    });
  });

  it("keeps runtime record-link metadata for localhost http origins", async () => {
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "http://localhost:3000/app",
        },
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    returningQueue.push([{ id: "server-localhost" }]);
    selectQueue.push([]);

    await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-1",
      pluginKey: "twenty",
      component: endpointFromComponent,
      db: mockDb as never,
    });

    expect(insertCalls[0]).toMatchObject({
      url: "http://localhost:3000/mcp",
      runtime_metadata: {
        recordLinkHints: {
          browserBaseUrl: "http://localhost:3000",
        },
      },
    });
  });

  it("fails with a readable error when the managed app row does not exist yet", async () => {
    selectQueue.push([]); // no managed_applications row

    await expect(
      provisionPluginMcpComponent({
        tenantId: "tenant-1",
        pluginInstallId: "install-1",
        pluginKey: "twenty",
        component: endpointFromComponent,
        db: mockDb as never,
      }),
    ).rejects.toThrow(/managed application "twenty" has no row/);
    expect(insertCalls).toHaveLength(0);
  });

  it("resolves Cognee endpointFrom from deployed runtime status when no managed app row exists", async () => {
    cogneeStatus.enabled = true;
    cogneeStatus.endpoint = "http://internal-cognee.example.local";
    selectQueue.push([]); // no managed_applications row

    const resolved = await resolvePluginMcpEndpoint({
      tenantId: "tenant-1",
      component: {
        type: "mcp-server",
        key: "brain",
        displayName: "ThinkWork Brain",
        endpointFrom: {
          managedApp: "cognee",
          configKey: "cogneeEndpoint",
          path: "/mcp-server/http",
        },
        auth: { mode: "none" },
      },
      db: mockDb as never,
    });

    expect(resolved).toBe(
      "http://internal-cognee.example.local/mcp-server/http",
    );
  });

  it("fails with a readable error when desired_config lacks the configKey", async () => {
    selectQueue.push([{ desired_config: { imageUri: "img@sha256:x" } }]);

    await expect(
      resolvePluginMcpEndpoint({
        tenantId: "tenant-1",
        component: endpointFromComponent,
        db: mockDb as never,
      }),
    ).rejects.toThrow(/has no "publicUrl" value yet/);
  });

  it("rejects a non-URL publicUrl value", async () => {
    selectQueue.push([{ desired_config: { publicUrl: "not a url" } }]);

    await expect(
      resolvePluginMcpEndpoint({
        tenantId: "tenant-1",
        component: endpointFromComponent,
        db: mockDb as never,
      }),
    ).rejects.toThrow(/is not a valid URL/);
  });

  it("strips query/hash and trailing slash from the resolved endpoint", async () => {
    selectQueue.push([
      { desired_config: { publicUrl: "https://crm.example.com/?utm=1#top" } },
    ]);
    const resolved = await resolvePluginMcpEndpoint({
      tenantId: "tenant-1",
      component: endpointFromComponent,
      db: mockDb as never,
    });
    expect(resolved).toBe("https://crm.example.com/mcp");
  });
});

describe("user-provided header auth (shared header auth)", () => {
  it("provisions header-auth MCP rows with header bindings but no credential values", async () => {
    const headerAuthComponent: McpServerComponent = {
      type: "mcp-server",
      key: "issues",
      displayName: "Header-auth records",
      endpointFrom: {
        managedApp: "header-auth",
        configKey: "publicUrl",
        path: "/http/api-key/mcp",
      },
      auth: {
        mode: "user-provided-headers",
        bearer: {
          credentialKey: "apiKey",
          displayName: "API token",
          secret: true,
        },
        headers: [
          {
            name: "x-workspace-slug",
            credentialKey: "workspaceSlug",
            displayName: "Workspace slug",
          },
        ],
      },
    };
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "https://headers.tenant.example.com/app",
        },
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    returningQueue.push([{ id: "server-header-auth" }]);
    selectQueue.push([]);

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-header-auth",
      pluginKey: "header-auth",
      component: headerAuthComponent,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-header-auth",
      resolvedEndpointUrl:
        "https://headers.tenant.example.com/http/api-key/mcp",
    });
    expect(insertCalls[0]).toMatchObject({
      slug: "header-auth--issues",
      url: "https://headers.tenant.example.com/http/api-key/mcp",
      auth_type: "user_headers",
      auth_config: {
        bearerCredentialKey: "apiKey",
        headers: [{ name: "x-workspace-slug", credentialKey: "workspaceSlug" }],
      },
      management_source: "plugin",
      plugin_install_id: "install-header-auth",
      status: "approved",
    });
    expect(JSON.stringify(insertCalls[0])).not.toContain("header_token");
  });
});

describe("tenant service credential auth (THNK-50 U5)", () => {
  it("provisions n8n MCP rows with service credential metadata but no secret values", async () => {
    const n8nComponent: McpServerComponent = {
      type: "mcp-server",
      key: "workflow-management",
      displayName: "n8n workflow management",
      endpointFrom: {
        managedApp: "n8n",
        configKey: "publicUrl",
        path: "/mcp-server/http",
      },
      auth: {
        mode: "tenant-service-credential",
        credentialKind: "n8n-mcp-access-token",
        secretRefConfigKey: "serviceCredentialSecretArn",
        headers: [
          {
            name: "Authorization",
            secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
            valuePrefix: "Bearer ",
          },
        ],
      },
    };
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "https://n8n.tenant.example.com/home",
          serviceCredentialSecretArn:
            "arn:aws:secretsmanager:us-east-1:123456789012:secret:n8n-service",
        },
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    returningQueue.push([{ id: "server-n8n" }]);
    selectQueue.push([{ id: "agent-default" }]);

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-n8n",
      pluginKey: "n8n",
      component: n8nComponent,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-n8n",
      resolvedEndpointUrl: "https://n8n.tenant.example.com/mcp-server/http",
    });
    expect(insertCalls[0]).toMatchObject({
      slug: "n8n--workflow-management",
      url: "https://n8n.tenant.example.com/mcp-server/http",
      auth_type: "service_credential",
      auth_config: {
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
      },
      management_source: "plugin",
      plugin_install_id: "install-n8n",
      status: "approved",
    });
    expect(insertCalls[1]).toMatchObject({
      agent_id: "agent-default",
      tenant_id: "tenant-1",
      mcp_server_id: "server-n8n",
      enabled: true,
    });
    expect(JSON.stringify(insertCalls[0])).not.toContain("n8n_token_value");
  });

  it("fails clearly when the managed app desired_config lacks the service credential secret ref", async () => {
    const n8nComponent: McpServerComponent = {
      type: "mcp-server",
      key: "workflow-management",
      displayName: "n8n workflow management",
      endpointFrom: {
        managedApp: "n8n",
        configKey: "publicUrl",
        path: "/mcp-server/http",
      },
      auth: {
        mode: "tenant-service-credential",
        credentialKind: "n8n-mcp-access-token",
        secretRefConfigKey: "serviceCredentialSecretArn",
        headers: [
          {
            name: "Authorization",
            secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
            valuePrefix: "Bearer ",
          },
        ],
      },
    };
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "https://n8n.tenant.example.com",
        },
      },
    ]);

    await expect(
      provisionPluginMcpComponent({
        tenantId: "tenant-1",
        pluginInstallId: "install-n8n",
        pluginKey: "n8n",
        component: n8nComponent,
        db: mockDb as never,
      }),
    ).rejects.toThrow(/serviceCredentialSecretArn/);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("teardownPluginMcpComponent", () => {
  it("deletes token secrets, token rows, context tools, assignments, then the server row", async () => {
    selectQueue.push([
      { id: "token-1", secret_ref: "thinkwork/dev/mcp-tokens/u1/server-1" },
      { id: "token-2", secret_ref: "" },
    ]);
    const smCalls: unknown[] = [];
    const sm = {
      send: vi.fn(async (command: unknown) => {
        smCalls.push(command);
        return {};
      }),
    };

    await teardownPluginMcpComponent({
      tenantId: "tenant-1",
      handlerRef: { tenantMcpServerId: "server-1" },
      db: mockDb as never,
      secretsManager: sm as never,
    });

    // One secret deletion (empty refs skipped).
    expect(sm.send).toHaveBeenCalledTimes(1);
    expect((smCalls[0] as { input: { SecretId: string } }).input.SecretId).toBe(
      "thinkwork/dev/mcp-tokens/u1/server-1",
    );

    // Full destroy inventory, server row last.
    expect(deleteCalls).toHaveLength(6);
    expect(deleteCalls[0]).toBe(userMcpTokens);
    expect(deleteCalls[5]).toBe(tenantMcpServers);
  });

  it("is a no-op when the component never recorded a server id", async () => {
    await teardownPluginMcpComponent({
      tenantId: "tenant-1",
      handlerRef: {},
      db: mockDb as never,
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("continues teardown when secret deletion fails", async () => {
    selectQueue.push([{ id: "token-1", secret_ref: "ref-1" }]);
    const sm = {
      send: vi.fn(async () => {
        throw new Error("secrets manager down");
      }),
    };
    await teardownPluginMcpComponent({
      tenantId: "tenant-1",
      handlerRef: { tenantMcpServerId: "server-1" },
      db: mockDb as never,
      secretsManager: sm as never,
    });
    expect(deleteCalls).toHaveLength(6);
  });
});
