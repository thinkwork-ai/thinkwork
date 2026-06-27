import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantMembership: vi.fn(),
  selectLimitResults: [] as unknown[][],
}));

vi.mock("../lib/tenant-membership.js", () => ({
  requireTenantMembership: mocks.requireTenantMembership,
}));

vi.mock("../lib/db.js", () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(mocks.selectLimitResults.shift() ?? []),
      };
      return chain;
    }),
  },
}));

import {
  handler,
  isThreadTurnListRoute,
  matchThreadTurnRoute,
} from "./scheduled-jobs.js";

const TENANT_ID = "tenant-abc";
const RUN_ID = "turn-123";

beforeEach(() => {
  mocks.requireTenantMembership.mockReset();
  mocks.selectLimitResults = [];
  mocks.requireTenantMembership.mockResolvedValue({
    ok: true,
    tenantId: TENANT_ID,
    userId: "user-123",
    role: "member",
  });
});

describe("scheduled jobs thread-turn routing", () => {
  it("matches the canonical thread-turn event route exposed by API Gateway", () => {
    const match = matchThreadTurnRoute(
      "/api/thread-turns/turn-123/events",
      String.raw`\/([^/]+)\/events$`,
    );

    expect(match?.[1]).toBe("turn-123");
  });

  it("keeps accepting the legacy trigger-runs route alias", () => {
    const match = matchThreadTurnRoute(
      "/api/trigger-runs/turn-123/events",
      String.raw`\/([^/]+)\/events$`,
    );

    expect(match?.[1]).toBe("turn-123");
  });

  it("matches both canonical and legacy list routes", () => {
    expect(isThreadTurnListRoute("/api/thread-turns")).toBe(true);
    expect(isThreadTurnListRoute("/api/trigger-runs")).toBe(true);
    expect(isThreadTurnListRoute("/api/trigger-runs/turn-123")).toBe(false);
  });

  it.each(["/api/thread-turns", "/api/trigger-runs"])(
    "dispatches %s event routes through the Lambda handler",
    async (prefix) => {
      mocks.selectLimitResults = [
        [{ id: RUN_ID }],
        [
          {
            id: "event-1",
            run_id: RUN_ID,
            seq: 1,
            event_type: "memory_recall",
          },
        ],
      ];

      const response = await handler(event(`${prefix}/${RUN_ID}/events`));

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body ?? "[]")).toEqual([
        expect.objectContaining({
          id: "event-1",
          event_type: "memory_recall",
        }),
      ]);
      expect(mocks.requireTenantMembership).toHaveBeenCalledWith(
        expect.any(Object),
        TENANT_ID,
        { requiredRoles: ["owner", "admin", "member"] },
      );
    },
  );
});

function event(rawPath: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /api/thread-turns/{proxy+}",
    rawPath,
    rawQueryString: "limit=500",
    queryStringParameters: { limit: "500" },
    headers: {
      authorization: "Bearer test",
      "x-tenant-id": TENANT_ID,
    },
    requestContext: {
      http: {
        method: "GET",
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
    } as APIGatewayProxyEventV2["requestContext"],
    isBase64Encoded: false,
  };
}
