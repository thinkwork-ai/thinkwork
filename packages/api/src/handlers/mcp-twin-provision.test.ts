/**
 * mcp-twin-provision default-URL resolution (consolidation U14): the
 * registration flip to the platform-served Brain MCP endpoint rides
 * BRAIN_MCP_URL; empty/unset keeps the legacy stage /mcp/twin default.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const getConfig = vi.fn();
const requireTenantMembership = vi.fn();
const provisionTwinConnector = vi.fn();
const publishTwinKeyManifest = vi.fn();

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: (...args: unknown[]) => getConfig(...args),
}));
vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: (...args: unknown[]) =>
    requireTenantMembership(...args),
}));
vi.mock("../lib/twin/provision-connector.js", () => ({
  provisionTwinConnector: (...args: unknown[]) =>
    provisionTwinConnector(...args),
}));
vi.mock("../lib/twin/key-manifest.js", () => ({
  publishTwinKeyManifest: (...args: unknown[]) =>
    publishTwinKeyManifest(...args),
}));

import { handler } from "./mcp-twin-provision.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

function event(body?: unknown): APIGatewayProxyEventV2 {
  return {
    rawPath: `/api/tenants/${TENANT}/mcp-twin-provision`,
    headers: {},
    requestContext: { http: { method: "POST" } },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function configureStage(values: Record<string, string>) {
  getConfig.mockImplementation((key: string) => {
    if (key in values) return values[key];
    throw new Error(`config key ${key} not set`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: TENANT,
    userId: "user-1",
  });
  provisionTwinConnector.mockResolvedValue({ provisioned: true });
});

describe("mcp-twin-provision default URL", () => {
  it("registers the platform Brain MCP endpoint when BRAIN_MCP_URL is set", async () => {
    configureStage({
      NEPTUNE_ENDPOINT: "neptune.example.com",
      BRAIN_MCP_URL: "https://mcp.brain.thinkwork.ai/mcp",
      THINKWORK_API_URL: "https://api.example.com",
    });
    const res = await handler(event({}));
    expect(res.statusCode).toBe(201);
    expect(provisionTwinConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        twinMcpUrl: "https://mcp.brain.thinkwork.ai/mcp",
      }),
    );
  });

  it("falls back to the stage /mcp/twin URL when BRAIN_MCP_URL is empty", async () => {
    configureStage({
      NEPTUNE_ENDPOINT: "neptune.example.com",
      BRAIN_MCP_URL: "",
      THINKWORK_API_URL: "https://api.example.com/",
    });
    const res = await handler(event({}));
    expect(res.statusCode).toBe(201);
    expect(provisionTwinConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        twinMcpUrl: "https://api.example.com/mcp/twin",
      }),
    );
  });

  it("falls back to the stage /mcp/twin URL when BRAIN_MCP_URL is unset", async () => {
    configureStage({
      NEPTUNE_ENDPOINT: "neptune.example.com",
      THINKWORK_API_URL: "https://api.example.com",
    });
    const res = await handler(event({}));
    expect(res.statusCode).toBe(201);
    expect(provisionTwinConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        twinMcpUrl: "https://api.example.com/mcp/twin",
      }),
    );
  });

  it("an explicit body url still overrides everything", async () => {
    configureStage({
      NEPTUNE_ENDPOINT: "neptune.example.com",
      BRAIN_MCP_URL: "https://mcp.brain.thinkwork.ai/mcp",
      THINKWORK_API_URL: "https://api.example.com",
    });
    const res = await handler(
      event({ url: "https://override.example.com/mcp" }),
    );
    expect(res.statusCode).toBe(201);
    expect(provisionTwinConnector).toHaveBeenCalledWith(
      expect.objectContaining({
        twinMcpUrl: "https://override.example.com/mcp",
      }),
    );
  });
});
