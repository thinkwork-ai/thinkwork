/**
 * /api/auth/me — pendingClaim reporting for pre-provisioned owners.
 *
 * When the caller has no users row, the handler checks whether a tenants
 * row carries the caller's email in pending_owner_email (written by the
 * Stripe webhook or by `thinkwork deploy`). `pendingClaim: true` tells the
 * web shell it may safely call bootstrapUser — its claim path attaches only
 * to that row, so this does not reopen ADV-9's auto-provisioning hole.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const { selectQueue, mockDb } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
        then: (resolve: (v: unknown) => void) =>
          resolve(selectQueue.shift() ?? []),
      };
      return chain;
    }),
  };
  return { selectQueue, mockDb };
});

const { authenticateMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({ db: mockDb }));
vi.mock("../lib/cognito-auth.js", () => ({ authenticate: authenticateMock }));

import { handler } from "./auth-me.js";

function getEvent(): APIGatewayProxyEventV2 {
  return {
    headers: { authorization: "Bearer token" },
    requestContext: { http: { method: "GET" } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  selectQueue.length = 0;
  authenticateMock.mockReset();
  authenticateMock.mockResolvedValue({
    email: "Service@HomeCareIntel.com",
  });
});

describe("auth-me pendingClaim", () => {
  it("reports pendingClaim=true when a pending tenant matches the email", async () => {
    selectQueue.push([]); // users lookup — no row
    selectQueue.push([{ id: "tenant-1" }]); // pending_owner_email lookup

    const result = await handler(getEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.pendingClaim).toBe(true);
    expect(body.tenantId).toBeNull();
    expect(body.note).toBe("user_not_bootstrapped");
  });

  it("reports pendingClaim=false when no pending tenant exists", async () => {
    selectQueue.push([]); // users lookup — no row
    selectQueue.push([]); // pending_owner_email lookup — no row

    const result = await handler(getEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.pendingClaim).toBe(false);
  });

  it("omits pendingClaim once the user row exists", async () => {
    selectQueue.push([
      { id: "user-1", email: "service@homecareintel.com", tenant_id: "t-1" },
    ]);
    selectQueue.push([{ role: "owner", status: "active" }]);

    const result = await handler(getEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.pendingClaim).toBeUndefined();
    expect(body.tenantId).toBe("t-1");
  });
});
