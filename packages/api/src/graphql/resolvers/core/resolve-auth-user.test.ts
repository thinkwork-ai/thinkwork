import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthResult } from "../../../lib/cognito-auth.js";

const { admitCognitoTenantMock } = vi.hoisted(() => ({
  admitCognitoTenantMock: vi.fn(),
}));

vi.mock("../../../lib/auth-admission.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../lib/auth-admission.js")>();
  return { ...original, admitCognitoTenant: admitCognitoTenantMock };
});

import { AuthAdmissionError } from "../../../lib/auth-admission.js";
import { resolveCallerFromAuth } from "./resolve-auth-user.js";

function cognitoAuth(overrides: Partial<AuthResult> = {}): AuthResult {
  return {
    authType: "cognito",
    principalId: "cognito-sub",
    tenantId: null,
    tenantClaimHint: "untrusted-tenant-claim",
    email: "same-email-is-not-proof@example.com",
    emailVerified: true,
    agentId: null,
    cognitoIssuer:
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
    route: {
      routeClientId: "route-google-web",
      routeKey: "google",
      clientFamily: "web",
      appClientId: "client-google",
      lifecycleState: "native",
      connectionId: "connection-google",
      connectionKey: "google",
      providerKind: "google",
      providerIssuer: "https://accounts.google.com",
    },
    ...overrides,
  };
}

beforeEach(() => {
  admitCognitoTenantMock.mockReset();
});

describe("resolveCallerFromAuth", () => {
  it("returns only the identity and tenant admitted by route/policy/membership", async () => {
    admitCognitoTenantMock.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-a",
      role: "member",
      identityId: "identity-google",
    });

    await expect(resolveCallerFromAuth(cognitoAuth())).resolves.toEqual({
      userId: "user-1",
      tenantId: "tenant-a",
    });
    expect(admitCognitoTenantMock).toHaveBeenCalledWith(
      expect.objectContaining({ principalId: "cognito-sub" }),
      undefined,
    );
  });

  it("passes an independently selected resource tenant into admission", async () => {
    admitCognitoTenantMock.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-b",
    });

    await expect(
      resolveCallerFromAuth(cognitoAuth(), "tenant-b"),
    ).resolves.toEqual({ userId: "user-1", tenantId: "tenant-b" });
    expect(admitCognitoTenantMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-b",
    );
  });

  it("fails closed instead of resolving by email or raw tenant claim", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    admitCognitoTenantMock.mockRejectedValue(
      new AuthAdmissionError("identity_not_bound", "not bound"),
    );

    await expect(resolveCallerFromAuth(cognitoAuth())).resolves.toEqual({
      userId: null,
      tenantId: null,
    });
    expect(warn).toHaveBeenCalledWith(
      "[resolve-auth-user] Cognito tenant admission denied",
      expect.objectContaining({ code: "identity_not_bound" }),
    );
  });

  it("preserves the trusted service credential path", async () => {
    await expect(
      resolveCallerFromAuth({
        authType: "service",
        principalId: null,
        tenantId: "tenant-service",
        email: null,
        emailVerified: false,
        agentId: null,
      }),
    ).resolves.toEqual({ userId: null, tenantId: "tenant-service" });
    expect(admitCognitoTenantMock).not.toHaveBeenCalled();
  });
});
