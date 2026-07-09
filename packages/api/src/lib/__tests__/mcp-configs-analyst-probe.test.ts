/**
 * buildMcpConfigs analyst-probe withhold gate tests (THINK-229 U5, R7/R8).
 *
 * The scheduled reconciler stamps runtime_metadata.analyst_probe onto the
 * analyst connector row. Dispatch must withhold the connection on a failing
 * or stale verdict, but never on absent verdicts (non-analyst servers and
 * the pre-first-probe window must keep working).
 *
 * getDb() is mocked (fake query shapes); schema + drizzle are REAL. The
 * analyst row is service_credential auth; the secret resolves to a valid
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
// eslint-disable-next-line import/first
import { PROBE_STALE_AFTER_MS } from "../analyst/connection-probe.js";

const AGENT = "agent-1";

function analystRow(over: Record<string, unknown> = {}) {
  return {
    mcp_server_id: "srv-analyst",
    name: "Postgres (dev)",
    slug: "postgres-dev",
    url: "https://api.example.com/mcp/analyst",
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
    runtime_metadata: null,
    assignment_enabled: true,
    assignment_config: null,
    ...over,
  };
}

function nonAnalystRow(over: Record<string, unknown> = {}) {
  return analystRow({
    mcp_server_id: "srv-other",
    name: "Other",
    slug: "other-server",
    url: "https://api.example.com/mcp/other",
    auth_type: "tenant_api_key",
    auth_config: { token: "static-key" },
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgentRows.mockReturnValue([{ tenant_id: "tenant-1" }]);
  mockSecretString.mockReturnValue(
    JSON.stringify({ token: "broker-token", tenantId: "tenant-1" }),
  );
});

describe("buildMcpConfigs — analyst probe withhold gate", () => {
  it("fail verdict → analyst connection withheld with connection_probe_failed", async () => {
    mockJoinRows.mockReturnValue([
      analystRow({
        runtime_metadata: {
          analyst_probe: {
            status: "fail",
            reason: "select_revoked",
            detail: 'analyst_reader lost SELECT on granted table "messages"',
            checkedAt: new Date().toISOString(),
          },
        },
      }),
    ]);
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(AGENT, null, "[test]", {
      diagnostics,
    });
    expect(configs).toHaveLength(0);
    const drop = diagnostics.drops.find(
      (d) => d.capabilityId === "postgres-dev",
    );
    expect(drop?.reason).toBe("connection_probe_failed");
    expect(drop?.detail).toContain("messages");
  });

  it("fresh ok verdict → analyst connection served", async () => {
    mockJoinRows.mockReturnValue([
      analystRow({
        runtime_metadata: {
          analyst_probe: { status: "ok", checkedAt: new Date().toISOString() },
        },
      }),
    ]);
    const configs = await buildMcpConfigs(AGENT, null, "[test]");
    expect(configs.map((c) => c.name)).toEqual(["postgres-dev"]);
  });

  it("stale verdict on an analyst row → withheld", async () => {
    mockJoinRows.mockReturnValue([
      analystRow({
        runtime_metadata: {
          analyst_probe: {
            status: "ok",
            checkedAt: new Date(
              Date.now() - PROBE_STALE_AFTER_MS - 60_000,
            ).toISOString(),
          },
        },
      }),
    ]);
    const diagnostics = createCapabilityDiagnostics();
    const configs = await buildMcpConfigs(AGENT, null, "[test]", {
      diagnostics,
    });
    expect(configs).toHaveLength(0);
    const drop = diagnostics.drops.find(
      (d) => d.capabilityId === "postgres-dev",
    );
    expect(drop?.reason).toBe("connection_probe_failed");
    expect(drop?.detail).toContain("stale");
  });

  it("absent verdict key on a non-analyst row → served", async () => {
    mockJoinRows.mockReturnValue([nonAnalystRow()]);
    const configs = await buildMcpConfigs(AGENT, null, "[test]");
    expect(configs.map((c) => c.name)).toEqual(["other-server"]);
  });

  it("absent verdict key on an analyst row (pre-first-probe) → served", async () => {
    mockJoinRows.mockReturnValue([analystRow({ runtime_metadata: null })]);
    const configs = await buildMcpConfigs(AGENT, null, "[test]");
    expect(configs.map((c) => c.name)).toEqual(["postgres-dev"]);
  });
});
