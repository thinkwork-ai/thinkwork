/**
 * buildMcpConfigs analyst source-refresh withhold gate tests (THINK-283 U4).
 *
 * The explicit refresh mutation (U5) owns runtime_metadata.analyst_refresh.
 * Dispatch must withhold a sourced connection while a refresh is running or
 * after a failed attempt — INDEPENDENTLY of the scheduled probe verdict — and
 * a successful scheduled probe must never make a mid-refresh source
 * dispatchable. Absent refresh state never gates (sources that have never
 * been refreshed keep working).
 *
 * getDb() is mocked (fake query shapes); schema + drizzle are REAL. The
 * sourced row is service_credential auth; the secret resolves to a valid
 * broker token so an ungated row is actually served.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAgentRows, mockJoinRows, mockSecretString } = vi.hoisted(() => ({
  mockAgentRows: vi.fn(),
  mockJoinRows: vi.fn(),
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
              return { limit: () => Promise.resolve(mockAgentRows()) };
            }
            if (table === actual.schema.tenantMcpServers) {
              return Promise.resolve(mockJoinRows());
            }
            return { limit: () => Promise.resolve([]) };
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
  return { ...actual, SecretsManagerClient: Stub };
});

// eslint-disable-next-line import/first
import { buildMcpConfigs } from "../mcp-configs.js";
// eslint-disable-next-line import/first
import { createCapabilityDiagnostics } from "../capability-diagnostics.js";

const AGENT = "agent-1";

/** A THINK-239/283 sourced analyst connector row (route has a slug). */
function sourcedRow(over: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "srv-warehouse",
    name: "Warehouse",
    slug: "warehouse",
    url: "https://api.example.com/mcp/analyst/warehouse",
    transport: "streamable-http",
    auth_type: "service_credential",
    auth_config: {
      secretRef: "arn:analyst-broker",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "token",
          valuePrefix: "Bearer ",
        },
      ],
    },
    tools: null,
    server_enabled: true,
    server_status: "approved",
    server_url_hash: null,
    management_source: "manual",
    plugin_install_id: null,
    runtime_metadata: {
      analyst_source: {
        host: "wh.example.rds.amazonaws.com",
        port: 5432,
        database: "thinkwork_warehouse",
        dbUser: "warehouse_reader",
        tls: "required",
        credentialSecretArn: "arn:secret:warehouse",
        tenantScoped: true,
        schema: "raw_jde",
        kind: "internal",
        sourceGeneration: "gen-1",
      },
    },
    assignment_enabled: true,
    assignment_config: null,
    ...over,
  };
}

function withRefresh(
  refresh: Record<string, unknown> | undefined,
  probe?: Record<string, unknown>,
) {
  const base = sourcedRow();
  return sourcedRow({
    runtime_metadata: {
      ...(base.runtime_metadata as Record<string, unknown>),
      ...(refresh ? { analyst_refresh: refresh } : {}),
      ...(probe ? { analyst_probe: probe } : {}),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgentRows.mockReturnValue([{ tenant_id: "tenant-1" }]);
  mockSecretString.mockReturnValue(
    JSON.stringify({ token: "broker-token", tenantId: "tenant-1" }),
  );
});

describe("buildMcpConfigs — analyst source refresh withhold gate (THINK-283)", () => {
  it("no refresh state → sourced connection served (never-refreshed back-compat)", async () => {
    mockJoinRows.mockReturnValue([withRefresh(undefined)]);
    const configs = await buildMcpConfigs(AGENT, null, "[test]");
    expect(configs.map((c) => c.name)).toEqual(["warehouse"]);
  });

  it("running refresh → withheld with source_refresh_pending", async () => {
    mockJoinRows.mockReturnValue([
      withRefresh({ status: "running", attemptId: "a1" }),
    ]);
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(AGENT, null, "[test]", {
      diagnostics,
    });
    expect(configs).toHaveLength(0);
    const drop = diagnostics.drops.find((d) => d.capabilityId === "warehouse");
    expect(drop?.reason).toBe("source_refresh_pending");
    expect(drop?.detail).toContain("in progress");
  });

  it("failed refresh → withheld with the persisted remediation detail (survives reloads)", async () => {
    mockJoinRows.mockReturnValue([
      withRefresh({
        status: "failed",
        attemptId: "a1",
        detail: "model upload failed at step artifacts — retry the refresh",
      }),
    ]);
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(AGENT, null, "[test]", {
      diagnostics,
    });
    expect(configs).toHaveLength(0);
    const drop = diagnostics.drops.find((d) => d.capabilityId === "warehouse");
    expect(drop?.reason).toBe("source_refresh_pending");
    expect(drop?.detail).toContain("step artifacts");
  });

  it("state isolation: a FRESH OK probe cannot clear a running refresh gate", async () => {
    mockJoinRows.mockReturnValue([
      withRefresh(
        { status: "running", attemptId: "a1" },
        { status: "ok", checkedAt: new Date().toISOString() },
      ),
    ]);
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(AGENT, null, "[test]", {
      diagnostics,
    });
    expect(configs).toHaveLength(0);
    expect(
      diagnostics.drops.find((d) => d.capabilityId === "warehouse")?.reason,
    ).toBe("source_refresh_pending");
  });

  it("completed (ok) refresh + fresh ok probe → served", async () => {
    mockJoinRows.mockReturnValue([
      withRefresh(
        { status: "ok", attemptId: "a1" },
        { status: "ok", checkedAt: new Date().toISOString() },
      ),
    ]);
    const configs = await buildMcpConfigs(AGENT, null, "[test]");
    expect(configs.map((c) => c.name)).toEqual(["warehouse"]);
  });
});
