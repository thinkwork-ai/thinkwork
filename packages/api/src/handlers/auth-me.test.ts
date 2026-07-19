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
const { discoverCognitoTenantAdmissionsMock } = vi.hoisted(() => ({
  discoverCognitoTenantAdmissionsMock: vi.fn(),
}));

vi.mock("../lib/db.js", () => ({ db: mockDb }));
vi.mock("../lib/cognito-auth.js", () => ({ authenticate: authenticateMock }));
vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
  resolveCallerFromAuth: resolveCallerFromAuthMock,
}));
vi.mock("../lib/auth-admission.js", () => ({
  AuthAdmissionError: class AuthAdmissionError extends Error {},
  discoverCognitoTenantAdmissions: discoverCognitoTenantAdmissionsMock,
}));

import { handler } from "./auth-me.js";

function getEvent(): APIGatewayProxyEventV2 {
  return {
    headers: { authorization: "Bearer token" },
    requestContext: { http: { method: "GET" } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.stubEnv("AUTH_MIGRATION_RECOVERY_DEADLINE", "2026-08-01T00:00:00Z");
  selectQueue.length = 0;
  authenticateMock.mockReset();
  resolveCallerFromAuthMock.mockReset();
  authenticateMock.mockResolvedValue({
    authType: "service",
    email: "Service@HomeCareIntel.com",
  });
  resolveCallerFromAuthMock.mockResolvedValue({ userId: null, tenantId: null });
  discoverCognitoTenantAdmissionsMock.mockReset();
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
    discoverCognitoTenantAdmissionsMock.mockResolvedValue({
      userId: null,
      tenants: [],
    });
    const result = await handler(getEvent());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      userId: null,
      tenantId: null,
      role: null,
    });
  });

  it("returns safe tenant choices without implicitly selecting for a multi-tenant identity", async () => {
    authenticateMock.mockResolvedValue({
      authType: "cognito",
      principalId: "sub-1",
      cognitoIssuer: "https://issuer.example",
      email: "member@example.com",
      route: { appClientId: "google-client" },
    });
    discoverCognitoTenantAdmissionsMock.mockResolvedValue({
      userId: "user-1",
      tenants: [
        { tenantId: "tenant-a", role: "owner" },
        { tenantId: "tenant-b", role: "member" },
      ],
    });
    selectQueue.push([
      { id: "user-1", email: "member@example.com", name: "Member" },
    ]);

    const result = await handler(getEvent());

    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      userId: "user-1",
      tenantId: null,
      tenantSelectionRequired: true,
      availableTenants: [
        { tenantId: "tenant-a", role: "owner" },
        { tenantId: "tenant-b", role: "member" },
      ],
    });
  });

  it("requires native identity migration only for an admitted coexistence WorkOS route", async () => {
    authenticateMock.mockResolvedValue({
      authType: "cognito",
      principalId: "legacy-sub-1",
      cognitoIssuer: "https://issuer.example",
      email: "member@example.com",
      tenantId: "tenant-a",
      route: {
        providerKind: "legacy_workos",
        lifecycleState: "coexistence",
      },
    });
    discoverCognitoTenantAdmissionsMock.mockResolvedValue({
      userId: "user-1",
      tenants: [{ tenantId: "tenant-a", role: "member" }],
    });
    selectQueue.push([
      { id: "user-1", email: "member@example.com", name: "Member" },
    ]);
    selectQueue.push([{ role: "member", status: "active" }]);

    const result = await handler(getEvent());

    expect(JSON.parse(result.body ?? "{}")).toMatchObject({
      userId: "user-1",
      tenantId: "tenant-a",
      migrationRequired: true,
      migrationRecoveryDeadline: "2026-08-01T00:00:00Z",
    });
  });
});
