/**
 * Contract tests for `webhookDeliveries`.
 *
 * Three branches:
 *   1. webhook missing → empty list, no auth call (cross-tenant defense).
 *   2. webhook found → auth gate against row.tenant_id, then DB read.
 *   3. limit clamping — default 50, hard cap 500, floor 1.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const webhookSchema = { __table: "webhooks" };
  const deliverySchema = { __table: "webhook_deliveries" };
  return {
    webhookSchema,
    deliverySchema,
    webhookRows: [] as unknown[],
    deliveryRows: [] as unknown[],
    deliveryLimit: vi.fn(),
    requireAdminOrServiceCaller: vi.fn(),
  };
});

vi.mock("../../utils.js", () => ({
  db: {
    select: (_proj?: unknown) => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === mocks.webhookSchema) {
            return Promise.resolve(mocks.webhookRows);
          }
          return {
            orderBy: () => ({
              limit: (n: number) => {
                mocks.deliveryLimit(n);
                return Promise.resolve(mocks.deliveryRows);
              },
            }),
          };
        },
      }),
    }),
  },
  webhooks: mocks.webhookSchema,
  webhookDeliveries: mocks.deliverySchema,
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  desc: vi.fn((col: unknown) => ({ op: "desc", col })),
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mocks.requireAdminOrServiceCaller,
}));

// eslint-disable-next-line import/first
import { webhookDeliveries_ } from "./webhookDeliveries.query.js";

const ctx = () =>
  ({
    auth: {
      authType: "service" as const,
      principalId: null,
      tenantId: null,
      email: null,
      agentId: null,
    },
  }) as any;

beforeEach(() => {
  mocks.webhookRows = [];
  mocks.deliveryRows = [];
  mocks.deliveryLimit.mockReset();
  mocks.requireAdminOrServiceCaller.mockReset();
});

describe("webhookDeliveries", () => {
  it("returns [] without auth probe when the webhook id resolves to nothing", async () => {
    mocks.webhookRows = [];

    const result = await webhookDeliveries_(null, { webhookId: "wh-x" }, ctx());

    expect(result).toEqual([]);
    expect(mocks.requireAdminOrServiceCaller).not.toHaveBeenCalled();
    expect(mocks.deliveryLimit).not.toHaveBeenCalled();
  });

  it("gates by row.tenant_id (not caller's claimed tenant)", async () => {
    mocks.webhookRows = [{ id: "wh-1", tenant_id: "tenant-A" }];
    mocks.requireAdminOrServiceCaller.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(
      webhookDeliveries_(null, { webhookId: "wh-1" }, ctx()),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });

    expect(mocks.requireAdminOrServiceCaller).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-A",
      "webhook_deliveries",
    );
    expect(mocks.deliveryLimit).not.toHaveBeenCalled();
  });

  it("clamps limit: default 50, floor 1, cap 500", async () => {
    mocks.webhookRows = [{ id: "wh-2", tenant_id: "tenant-A" }];
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);

    await webhookDeliveries_(null, { webhookId: "wh-2" }, ctx());
    expect(mocks.deliveryLimit).toHaveBeenLastCalledWith(50);

    await webhookDeliveries_(null, { webhookId: "wh-2", limit: 0 }, ctx());
    expect(mocks.deliveryLimit).toHaveBeenLastCalledWith(1);

    await webhookDeliveries_(null, { webhookId: "wh-2", limit: 9999 }, ctx());
    expect(mocks.deliveryLimit).toHaveBeenLastCalledWith(500);

    await webhookDeliveries_(null, { webhookId: "wh-2", limit: 25 }, ctx());
    expect(mocks.deliveryLimit).toHaveBeenLastCalledWith(25);
  });

  it("returns rows from webhook_deliveries on the happy path", async () => {
    mocks.webhookRows = [{ id: "wh-3", tenant_id: "tenant-A" }];
    mocks.requireAdminOrServiceCaller.mockResolvedValue(undefined);
    mocks.deliveryRows = [
      { id: "wd-1", webhookId: "wh-3", resolutionStatus: "ok" },
      { id: "wd-2", webhookId: "wh-3", resolutionStatus: "rate_limited" },
    ];

    const result = await webhookDeliveries_(
      null,
      { webhookId: "wh-3" },
      ctx(),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "wd-1", resolutionStatus: "ok" });
  });
});
