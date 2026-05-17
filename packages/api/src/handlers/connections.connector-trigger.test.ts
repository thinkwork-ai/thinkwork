import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mocks = vi.hoisted(() => ({
  requireTenantMembership: vi.fn(),
  selectRows: vi.fn(),
}));

vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: mocks.requireTenantMembership,
}));

vi.mock("../lib/db.js", () => ({
  db: {
    select: vi.fn((projection?: unknown) => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: (cond: unknown) =>
          Promise.resolve(mocks.selectRows({ projection, cond })),
      };
      return chain;
    }),
  },
}));

import { handler } from "./connections.js";

const TENANT_ID = "tenant-1";
const USER_ID = "user-1";
const CONNECTION_ID = "connection-1";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: TENANT_ID,
    userId: USER_ID,
  });
});

describe("connections handler connector triggers", () => {
  it("lists event triggers for a user-owned connection", async () => {
    mocks.selectRows
      .mockResolvedValueOnce([{ id: CONNECTION_ID }])
      .mockResolvedValueOnce([
        {
          id: "trigger-1",
          tenant_id: TENANT_ID,
          trigger_type: "event",
          computer_id: "computer-1",
          config: {
            connectorTrigger: {
              connectionId: CONNECTION_ID,
              provider: "google-gmail",
              requesterUserId: USER_ID,
            },
          },
        },
      ]);

    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "[]")).toEqual([
      expect.objectContaining({
        id: "trigger-1",
        computer_id: "computer-1",
      }),
    ]);
    expect(mocks.selectRows).toHaveBeenCalledTimes(2);
  });

  it("does not list triggers for a connection outside the requester scope", async () => {
    mocks.selectRows.mockResolvedValueOnce([]);

    const response = await handler(event());

    expect(response.statusCode).toBe(404);
    expect(mocks.selectRows).toHaveBeenCalledTimes(1);
  });
});

function event(): APIGatewayProxyEventV2 {
  return {
    rawPath: `/api/connections/${CONNECTION_ID}/computer-triggers`,
    headers: {
      "x-tenant-id": TENANT_ID,
      "x-principal-id": USER_ID,
      authorization: "Bearer test",
    },
    requestContext: { http: { method: "GET" } },
  } as unknown as APIGatewayProxyEventV2;
}
