/**
 * Analyst connector provisioning tests (THINK-228 U4).
 *
 * Chain-mock Drizzle db (same approach as the plugin MCP handler tests).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, selectQueue, insertCalls, updateCalls, returningQueue } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const returningQueue: unknown[][] = [];
    const insertCalls: Array<Record<string, unknown>> = [];
    const updateCalls: Array<Record<string, unknown>> = [];
    const mockDb = {
      select: vi.fn(() => {
        const chain = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => selectQueue.shift() ?? []),
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: (values: Record<string, unknown>) => {
          insertCalls.push(values);
          return {
            returning: async () => returningQueue.shift() ?? [{ id: "new-id" }],
          };
        },
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => {
          updateCalls.push(values);
          return { where: async () => undefined };
        },
      })),
    };
    return { mockDb, selectQueue, insertCalls, updateCalls, returningQueue };
  });

vi.mock("../../graphql/utils.js", () => ({ db: mockDb }));

import { computeMcpUrlHash } from "../mcp-server-hash.js";
import {
  ANALYST_CONNECTOR_SLUG,
  analystConnectorAuthConfig,
  analystConnectorRowValues,
  provisionAnalystConnector,
  resolveAnalystProvisionConfig,
} from "./provision-connector.js";

const INPUT = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  brokerUrl: "https://api.dev.example.com/mcp/analyst",
  secretRef: "arn:aws:secretsmanager:us-east-1:123:secret:analyst-broker",
};

beforeEach(() => {
  selectQueue.length = 0;
  returningQueue.length = 0;
  insertCalls.length = 0;
  updateCalls.length = 0;
});

describe("analyst connector provisioning (U4)", () => {
  it("auth_config is secretRef + Bearer header binding — never a token value", () => {
    const authConfig = analystConnectorAuthConfig(INPUT.secretRef);
    expect(authConfig).toEqual({
      secretRef: INPUT.secretRef,
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "token",
          valuePrefix: "Bearer ",
        },
      ],
    });
    expect(JSON.stringify(authConfig)).not.toMatch(/token"?\s*:\s*"[^"]{8}/);
  });

  it("seed creates an approved row whose url_hash matches the shared helper", async () => {
    selectQueue.push([]); // no existing row
    const outcome = await provisionAnalystConnector({
      ...INPUT,
      db: mockDb as never,
    });
    expect(outcome).toEqual({ action: "created", id: "new-id" });
    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0]!;
    expect(row.slug).toBe(ANALYST_CONNECTOR_SLUG);
    expect(row.status).toBe("approved");
    expect(row.auth_type).toBe("service_credential");
    expect(row.management_source).toBe("manual");
    expect(row.url_hash).toBe(
      computeMcpUrlHash(
        INPUT.brokerUrl,
        row.auth_config as Record<string, unknown>,
      ),
    );
    expect(row.approved_at).toBeInstanceOf(Date);
  });

  it("re-running with identical inputs is a no-op", async () => {
    const values = analystConnectorRowValues(INPUT);
    selectQueue.push([
      {
        id: "row-1",
        url: values.url,
        url_hash: values.url_hash,
        status: "approved",
        auth_config: values.auth_config,
      },
    ]);
    const outcome = await provisionAnalystConnector({
      ...INPUT,
      db: mockDb as never,
    });
    expect(outcome).toEqual({ action: "unchanged", id: "row-1" });
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("a URL change without --re-approve throws instead of leaving a drifted row (SI-5)", async () => {
    const values = analystConnectorRowValues(INPUT);
    selectQueue.push([
      {
        id: "row-1",
        url: "https://old.example.com/mcp/analyst",
        url_hash: "stale-hash",
        status: "approved",
        auth_config: values.auth_config,
      },
    ]);
    await expect(
      provisionAnalystConnector({ ...INPUT, db: mockDb as never }),
    ).rejects.toThrow(/--re-approve/);
    expect(updateCalls).toHaveLength(0);
  });

  it("--re-approve rewrites the row with a fresh hash and restamps approval", async () => {
    selectQueue.push([
      {
        id: "row-1",
        url: "https://old.example.com/mcp/analyst",
        url_hash: "stale-hash",
        status: "pending",
        auth_config: {},
      },
    ]);
    const outcome = await provisionAnalystConnector({
      ...INPUT,
      reApprove: true,
      db: mockDb as never,
    });
    expect(outcome).toEqual({ action: "re_approved", id: "row-1" });
    expect(updateCalls).toHaveLength(1);
    const update = updateCalls[0]!;
    expect(update.status).toBe("approved");
    expect(update.url).toBe(INPUT.brokerUrl);
    expect(update.url_hash).toBe(
      computeMcpUrlHash(
        INPUT.brokerUrl,
        update.auth_config as Record<string, unknown>,
      ),
    );
    expect(update.approved_by).toBeNull();
  });

  it("missing env fails with one clear message and writes nothing", () => {
    expect(() => resolveAnalystProvisionConfig({})).toThrow(
      /missing required env: TENANT_ID, ANALYST_BROKER_URL \(or THINKWORK_API_URL\), ANALYST_BROKER_SECRET_ARN/,
    );
    // Derives the broker URL from THINKWORK_API_URL when unset explicitly.
    const resolved = resolveAnalystProvisionConfig({
      TENANT_ID: INPUT.tenantId,
      THINKWORK_API_URL: "https://api.dev.example.com/",
      ANALYST_BROKER_SECRET_ARN: INPUT.secretRef,
    });
    expect(resolved.brokerUrl).toBe("https://api.dev.example.com/mcp/analyst");
  });
});
