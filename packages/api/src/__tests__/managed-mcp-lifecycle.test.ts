import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { tenantMcpServers } from "@thinkwork/database-pg/schema";
import {
  reconcileTwentyManagedMcp,
  summarizeTwentyManagedMcpState,
  twentyMcpUrlFromApplicationUrl,
} from "../lib/managed-mcp-applications.js";
import { computeMcpUrlHash } from "../lib/mcp-server-hash.js";

const migrationSql = readFileSync(
  new URL(
    "../../../database-pg/drizzle/0149_managed_mcp_servers.sql",
    import.meta.url,
  ),
  "utf8",
);

beforeEach(() => {
  delete process.env.THINKWORK_API_URL;
  delete process.env.MCP_CUSTOM_DOMAIN;
  delete process.env.STAGE;
});

describe("managed MCP lifecycle schema", () => {
  it("exports first-class ownership columns for managed application rows", () => {
    expect(tenantMcpServers.management_source.name).toBe("management_source");
    expect(tenantMcpServers.managed_application_key.name).toBe(
      "managed_application_key",
    );
  });

  it("keeps existing manual MCP rows manual by default", () => {
    expect(migrationSql).toContain(
      "ADD COLUMN IF NOT EXISTS management_source text NOT NULL DEFAULT 'manual'",
    );
    expect(migrationSql).toContain(
      "ADD COLUMN IF NOT EXISTS managed_application_key text",
    );
  });

  it("requires managed application rows to carry a managed application key", () => {
    expect(migrationSql).toContain(
      "tenant_mcp_servers_managed_application_shape_check",
    );
    expect(migrationSql).toContain(
      "(management_source = 'manual' AND managed_application_key IS NULL)",
    );
    expect(migrationSql).toContain(
      "(management_source = 'managed_application' AND managed_application_key IS NOT NULL)",
    );
  });

  it("prevents duplicate managed rows for the same tenant and application", () => {
    expect(migrationSql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_mcp_servers_managed_application",
    );
    expect(migrationSql).toContain(
      "ON public.tenant_mcp_servers (tenant_id, managed_application_key)",
    );
    expect(migrationSql).toContain("WHERE managed_application_key IS NOT NULL");
  });
});

describe("Twenty managed MCP lifecycle", () => {
  it("derives the canonical Twenty MCP endpoint from the deployed CRM URL", () => {
    expect(twentyMcpUrlFromApplicationUrl("https://crm.thinkwork.ai")).toBe(
      "https://crm.thinkwork.ai/mcp",
    );
    expect(
      twentyMcpUrlFromApplicationUrl("https://crm.thinkwork.ai/welcome"),
    ).toBe("https://crm.thinkwork.ai/mcp");
  });

  it("marks a running Twenty deployment as installable when the managed MCP row is missing", () => {
    const state = summarizeTwentyManagedMcpState(runningTwenty(), null);

    expect(state).toMatchObject({
      serverId: null,
      installed: false,
      installAvailable: true,
      status: "missing",
    });
  });

  it("recognizes an approved managed Twenty MCP row as installed", () => {
    const url = "https://crm.thinkwork.ai/mcp";
    const authConfig = { oauth_resource: url };
    const state = summarizeTwentyManagedMcpState(runningTwenty(), {
      id: "server-1",
      slug: "twenty-crm",
      url,
      enabled: true,
      status: "approved",
      url_hash: computeMcpUrlHash(url, authConfig),
      auth_config: authConfig,
      management_source: "managed_application",
      managed_application_key: "twenty-crm",
    });

    expect(state).toMatchObject({
      serverId: "server-1",
      installed: true,
      installAvailable: false,
      status: "installed",
    });
  });

  it("flags a managed Twenty MCP row for repair when the CRM URL changes", () => {
    const url = "https://old-crm.thinkwork.ai/mcp";
    const state = summarizeTwentyManagedMcpState(runningTwenty(), {
      id: "server-1",
      slug: "twenty-crm",
      url,
      enabled: true,
      status: "approved",
      url_hash: computeMcpUrlHash(url, { oauth_resource: url }),
      auth_config: { oauth_resource: url },
      management_source: "managed_application",
      managed_application_key: "twenty-crm",
    });

    expect(state).toMatchObject({
      installed: true,
      installAvailable: true,
      status: "needs_repair",
    });
  });

  it("no-ops when a plugin-owned Twenty MCP row exists (U10 ownership guard)", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const fakeDb = queueDb({
      // First select = the plugin-ownership guard lookup.
      selects: [[{ id: "server-plugin" }]],
      inserts: writes,
    });

    await expect(
      reconcileTwentyManagedMcp({
        tenantId: "tenant-1",
        application: runningTwenty(),
        mode: "destroyed",
        db: fakeDb as any,
      }),
    ).resolves.toMatchObject({
      serverId: "server-plugin",
      installed: true,
      installAvailable: false,
      status: "plugin_managed",
    });

    // Nothing written: the legacy reconciler must never fight the plugin row.
    expect(writes).toHaveLength(0);
  });

  it("assigns the managed Twenty MCP server to the tenant platform default agent on first install", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const fakeDb = queueDb({
      // guard (no plugin row), existing managed row, manual-slug check,
      // platform agents.
      selects: [[], [], [], [{ id: "agent-platform" }]],
      inserts: writes,
    });

    await expect(
      reconcileTwentyManagedMcp({
        tenantId: "tenant-1",
        application: runningTwenty(),
        mode: "running",
        db: fakeDb as any,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              authorization_servers: ["https://crm.thinkwork.ai"],
            }),
            { status: 200 },
          ),
      }),
    ).resolves.toMatchObject({
      serverId: "server-1",
      installed: true,
      status: "installed",
    });

    expect(writes).toContainEqual(
      expect.objectContaining({
        agent_id: "agent-platform",
        tenant_id: "tenant-1",
        mcp_server_id: "server-1",
        enabled: true,
      }),
    );
  });
});

function runningTwenty() {
  return {
    key: "twenty" as const,
    displayName: "Twenty CRM",
    description: "Self-hosted CRM runtime managed by ThinkWork.",
    status: "running" as const,
    enabled: true,
    provisioned: true,
    runtimeEnabled: true,
    url: "https://crm.thinkwork.ai",
    endpoint: "https://crm.thinkwork.ai",
    backendMode: null,
    logGroupName: null,
    logGroupNames: [],
    clusterArn: null,
    serviceName: null,
    serviceNames: [],
    albArn: null,
    targetGroupArn: null,
    storageBucketName: null,
    databaseName: null,
    message: null,
    managedMcpServerId: null,
    managedMcpStatus: "missing",
    managedMcpInstalled: false,
    managedMcpInstallAvailable: true,
    managedMcpMessage: null,
    workflowReadinessState: "blocked_not_ready",
    workflowReadinessReasons: [],
    workflowCapabilityFlags: {},
  };
}

function queueDb(args: {
  selects: unknown[][];
  inserts: Array<Record<string, unknown>>;
}) {
  const selectQueue = [...args.selects];

  const whereResult = () => {
    const rows = selectQueue.shift() ?? [];
    return {
      limit: async () => rows,
      then: (
        resolve: (value: unknown[]) => void,
        reject: (reason?: unknown) => void,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
  };

  return {
    select: () => ({
      from: () => ({
        where: () => whereResult(),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        args.inserts.push(value);
        return {
          returning: async () => [{ id: "server-1" }],
          onConflictDoUpdate: async () => undefined,
        };
      },
    }),
    update: () => ({
      set: () => ({ where: async () => undefined }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
}
