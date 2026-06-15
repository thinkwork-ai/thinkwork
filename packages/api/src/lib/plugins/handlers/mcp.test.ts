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
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];
  const insertCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const deleteCalls: unknown[] = [];
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
  };
});

vi.mock("../../../graphql/utils.js", () => ({ db: mockDb }));

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
};

describe("endpointFrom resolution (U10)", () => {
  it("resolves the endpoint from the managed app's desired_config and derives per-instance oauth", async () => {
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

describe("user-provided header auth (THNK-27 U5)", () => {
  it("provisions Plane MCP rows with header bindings but no credential values", async () => {
    const planeComponent: McpServerComponent = {
      type: "mcp-server",
      key: "issues",
      displayName: "Plane work items",
      endpointFrom: {
        managedApp: "plane",
        configKey: "publicUrl",
        path: "/http/api-key/mcp",
      },
      auth: {
        mode: "user-provided-headers",
        bearer: {
          credentialKey: "apiKey",
          displayName: "Plane personal access token",
          secret: true,
        },
        headers: [
          {
            name: "x-workspace-slug",
            credentialKey: "workspaceSlug",
            displayName: "Plane workspace slug",
          },
        ],
      },
    };
    selectQueue.push([
      {
        desired_config: {
          publicUrl: "https://plane.tenant.example.com/app",
        },
      },
    ]);
    selectQueue.push([]);
    selectQueue.push([]);
    returningQueue.push([{ id: "server-plane" }]);
    selectQueue.push([]);

    const ref = await provisionPluginMcpComponent({
      tenantId: "tenant-1",
      pluginInstallId: "install-plane",
      pluginKey: "plane",
      component: planeComponent,
      db: mockDb as never,
    });

    expect(ref).toEqual({
      tenantMcpServerId: "server-plane",
      resolvedEndpointUrl: "https://plane.tenant.example.com/http/api-key/mcp",
    });
    expect(insertCalls[0]).toMatchObject({
      slug: "plane--issues",
      url: "https://plane.tenant.example.com/http/api-key/mcp",
      auth_type: "user_headers",
      auth_config: {
        bearerCredentialKey: "apiKey",
        headers: [
          { name: "x-workspace-slug", credentialKey: "workspaceSlug" },
        ],
      },
      management_source: "plugin",
      plugin_install_id: "install-plane",
      status: "approved",
    });
    expect(JSON.stringify(insertCalls[0])).not.toContain("plane_pat");
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
