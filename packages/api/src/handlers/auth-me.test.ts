/**
 * /api/auth/me — exact Cognito identity admission only.
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

const { authenticateMock, resolveCallerFromAuthMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  resolveCallerFromAuthMock: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({ db: mockDb }));
vi.mock("../lib/cognito-auth.js", () => ({ authenticate: authenticateMock }));
vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: resolveCallerFromAuthMock,
}));

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
  resolveCallerFromAuthMock.mockReset();
  authenticateMock.mockResolvedValue({
    email: "Service@HomeCareIntel.com",
  });
  resolveCallerFromAuthMock.mockResolvedValue({ userId: null, tenantId: null });
});

describe("auth-me identity admission", () => {
  it("does not convert an authenticated email into an ownership claim", async () => {
    const result = await handler(getEvent());
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body ?? "{}");
    expect(body.pendingClaim).toBeUndefined();
    expect(body).toMatchObject({
      userId: null,
      tenantId: null,
      role: null,
      note: "user_not_bootstrapped",
    });
  });

  it("omits pendingClaim once the user row exists", async () => {
    resolveCallerFromAuthMock.mockResolvedValue({
      userId: "user-1",
      tenantId: "t-1",
    });
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

  it("does not resolve an existing account by email without an admitted subject", async () => {
    authenticateMock.mockResolvedValue({
      authType: "cognito",
      principalId: "different-cognito-subject",
      email: "Service@HomeCareIntel.com",
      emailVerified: true,
      tenantId: null,
    });
    const result = await handler(getEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      userId: null,
      tenantId: null,
      role: null,
    });
  });
});
