import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  cognitoVerifierCreateMock,
  getApiAuthSecretMock,
  getConfigMock,
  primeRuntimeConfigMock,
  routeAdmissionMock,
  verifyMock,
} = vi.hoisted(() => ({
  cognitoVerifierCreateMock: vi.fn(),
  getApiAuthSecretMock: vi.fn(),
  getConfigMock: vi.fn(),
  primeRuntimeConfigMock: vi.fn(),
  routeAdmissionMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getApiAuthSecret: getApiAuthSecretMock,
  getConfig: getConfigMock,
  primeRuntimeConfig: primeRuntimeConfigMock,
}));

vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: cognitoVerifierCreateMock,
  },
}));

vi.mock("./auth-admission.js", () => ({
  resolveCognitoRouteProvenance: routeAdmissionMock,
}));

import { authenticate, verifyCognitoApplicationToken } from "./cognito-auth.js";

describe("authenticate — apikey path", () => {
  const prev = process.env.API_AUTH_SECRET;

  beforeEach(() => {
    process.env.API_AUTH_SECRET = "tw-test-secret";
    cognitoVerifierCreateMock.mockReset();
    getApiAuthSecretMock.mockReset();
    getConfigMock.mockReset();
    primeRuntimeConfigMock.mockReset();
    verifyMock.mockReset();
    routeAdmissionMock.mockReset();
    getApiAuthSecretMock.mockReturnValue("");
    getConfigMock.mockImplementation(
      (_: string, fallback?: string) => fallback,
    );
    primeRuntimeConfigMock.mockResolvedValue(undefined);
    cognitoVerifierCreateMock.mockReturnValue({ verify: verifyMock });
    routeAdmissionMock.mockResolvedValue({
      routeClientId: "route-web",
      routeKey: "google",
      clientFamily: "web",
      appClientId: "client-web",
      lifecycleState: "native",
      connectionId: "connection-google",
      connectionKey: "google",
      providerKind: "google",
      providerIssuer: "https://accounts.google.com",
    });
  });

  afterEach(() => {
    process.env.API_AUTH_SECRET = prev;
  });

  it("returns null when no credential is present", async () => {
    expect(await authenticate({})).toBeNull();
  });

  it("rejects a wrong api key", async () => {
    expect(await authenticate({ "x-api-key": "nope" })).toBeNull();
  });

  it("accepts a matching api key and hydrates principal headers", async () => {
    const auth = await authenticate({
      "x-api-key": "tw-test-secret",
      "x-principal-id": "user-123",
      "x-tenant-id": "tenant-abc",
      "x-principal-email": "operator@example.com",
      "x-agent-id": "agent-42",
    });
    expect(auth).toEqual({
      principalId: "user-123",
      tenantId: "tenant-abc",
      email: "operator@example.com",
      emailVerified: false,
      authType: "apikey",
      agentId: "agent-42",
    });
  });

  it("accepts the runtime-config-backed service secret as an x-api-key", async () => {
    process.env.API_AUTH_SECRET = "";
    getApiAuthSecretMock.mockReturnValue("runtime-secret");

    const auth = await authenticate({
      "x-api-key": "runtime-secret",
      "x-tenant-id": "tenant-abc",
    });

    expect(auth).toMatchObject({
      tenantId: "tenant-abc",
      authType: "service",
    });
  });

  it("returns email=null when x-principal-email is absent", async () => {
    const auth = await authenticate({ "x-api-key": "tw-test-secret" });
    expect(auth).not.toBeNull();
    expect(auth!.email).toBeNull();
  });
});

describe("authenticate — Bearer-as-apikey fallback (CLI/Strands back-compat)", () => {
  const prev = process.env.API_AUTH_SECRET;

  beforeEach(() => {
    process.env.API_AUTH_SECRET = "tw-test-secret";
    cognitoVerifierCreateMock.mockReset();
    getApiAuthSecretMock.mockReset();
    getConfigMock.mockReset();
    primeRuntimeConfigMock.mockReset();
    verifyMock.mockReset();
    routeAdmissionMock.mockReset();
    getApiAuthSecretMock.mockReturnValue("");
    getConfigMock.mockImplementation(
      (_: string, fallback?: string) => fallback,
    );
    primeRuntimeConfigMock.mockResolvedValue(undefined);
    cognitoVerifierCreateMock.mockReturnValue({ verify: verifyMock });
    routeAdmissionMock.mockResolvedValue({
      routeClientId: "route-web",
      routeKey: "google",
      clientFamily: "web",
      appClientId: "client-web",
      lifecycleState: "native",
      connectionId: "connection-google",
      connectionKey: "google",
      providerKind: "google",
      providerIssuer: "https://accounts.google.com",
    });
  });

  afterEach(() => {
    process.env.API_AUTH_SECRET = prev;
  });

  it("accepts Authorization: Bearer <API_AUTH_SECRET> with no x-api-key header (classifies as `service`)", async () => {
    // The thinkwork CLI (apps/cli/src/api-client.ts) and the Strands
    // agentcore container send the service secret this way. Without
    // this branch they would 401 after the SPA migrates off the same
    // shared secret. Bearer-only callers — no x-principal-id, no
    // x-agent-id — classify as `service` (vs `apikey` when identity
    // headers are present); see requireAdminOrServiceCaller in
    // graphql/resolvers/core/authz.ts.
    const auth = await authenticate({
      authorization: "Bearer tw-test-secret",
      "x-tenant-id": "tenant-abc",
    });
    expect(auth).not.toBeNull();
    expect(auth!.authType).toBe("service");
    expect(auth!.tenantId).toBe("tenant-abc");
  });

  it("accepts the runtime-config-backed service secret as a bearer token", async () => {
    process.env.API_AUTH_SECRET = "";
    getApiAuthSecretMock.mockReturnValue("runtime-secret");

    const auth = await authenticate({
      authorization: "Bearer runtime-secret",
      "x-tenant-id": "tenant-abc",
    });

    expect(auth).toMatchObject({
      tenantId: "tenant-abc",
      authType: "service",
    });
  });

  it("accepts the uppercase Authorization header too (still `service` when bearer-only)", async () => {
    const auth = await authenticate({
      Authorization: "Bearer tw-test-secret",
    });
    expect(auth).not.toBeNull();
    expect(auth!.authType).toBe("service");
  });

  it("rejects a non-matching Bearer token with no x-api-key", async () => {
    expect(
      await authenticate({ authorization: "Bearer wrong-secret" }),
    ).toBeNull();
  });

  it("hydrates principal headers from the apikey path even when auth came via Bearer", async () => {
    const auth = await authenticate({
      authorization: "Bearer tw-test-secret",
      "x-principal-id": "user-7",
      "x-principal-email": "ops@example.com",
      "x-agent-id": "agent-9",
    });
    expect(auth).toEqual({
      principalId: "user-7",
      tenantId: null,
      email: "ops@example.com",
      emailVerified: false,
      authType: "apikey",
      agentId: "agent-9",
    });
  });

  it("does not mistake an expired or malformed JWT for an apikey", async () => {
    // A random JWT-shaped string: the verifier branch rejects it
    // (logs a warning), then the apikey fallbacks both reject it
    // because it isn't in acceptedApiKeys(). Returns null.
    expect(
      await authenticate({
        authorization: "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.e30.invalid",
      }),
    ).toBeNull();
  });
});

describe("authenticate — Cognito JWT path", () => {
  const prev = process.env.API_AUTH_SECRET;

  beforeEach(() => {
    process.env.API_AUTH_SECRET = "";
    cognitoVerifierCreateMock.mockReset();
    getApiAuthSecretMock.mockReset();
    getConfigMock.mockReset();
    primeRuntimeConfigMock.mockReset();
    verifyMock.mockReset();
    routeAdmissionMock.mockReset();
    getApiAuthSecretMock.mockReturnValue("");
    primeRuntimeConfigMock.mockResolvedValue(undefined);
    cognitoVerifierCreateMock.mockReturnValue({ verify: verifyMock });
    routeAdmissionMock.mockResolvedValue({
      routeClientId: "route-web",
      routeKey: "google",
      clientFamily: "web",
      appClientId: "client-web",
      lifecycleState: "native",
      connectionId: "connection-google",
      connectionKey: "google",
      providerKind: "google",
      providerIssuer: "https://accounts.google.com",
    });
  });

  afterEach(() => {
    process.env.API_AUTH_SECRET = prev;
  });

  it("force-refreshes runtime config before creating a verifier when Cognito config is initially absent", async () => {
    const config = new Map<string, string>();
    getConfigMock.mockImplementation((key: string, fallback?: string) => {
      return config.get(key) ?? fallback;
    });
    primeRuntimeConfigMock.mockImplementation(async () => {
      config.set("COGNITO_USER_POOL_ID", "us-east-1_test");
    });
    verifyMock.mockResolvedValue({
      sub: "user-sub",
      iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
      aud: "client-web",
      email: "operator@example.com",
      email_verified: "true",
      "custom:tenant_id": "tenant-A",
    });

    const auth = await authenticate({ authorization: "Bearer jwt-token" });

    expect(primeRuntimeConfigMock).toHaveBeenCalledWith({ force: true });
    expect(cognitoVerifierCreateMock).toHaveBeenCalledWith({
      userPoolId: "us-east-1_test",
      tokenUse: "id",
      clientId: null,
    });
    expect(auth).toEqual({
      principalId: "user-sub",
      tenantId: null,
      tenantClaimHint: "tenant-A",
      email: "operator@example.com",
      emailVerified: true,
      authType: "cognito",
      agentId: null,
      cognitoIssuer:
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
      route: expect.objectContaining({
        appClientId: "client-web",
        connectionKey: "google",
      }),
    });
    expect(routeAdmissionMock).toHaveBeenCalledWith({
      userPoolId: "us-east-1_test",
      appClientId: "client-web",
      cognitoSub: "user-sub",
    });
  });

  it("does not cache a verifier when runtime config remains unavailable", async () => {
    getConfigMock.mockImplementation(
      (_: string, fallback?: string) => fallback,
    );

    expect(
      await authenticate({ authorization: "Bearer jwt-token" }),
    ).toBeNull();

    expect(primeRuntimeConfigMock).toHaveBeenCalledWith({ force: true });
    expect(cognitoVerifierCreateMock).not.toHaveBeenCalled();
  });

  it("uses client_id for access-token provenance and never access-token aud", async () => {
    getConfigMock.mockImplementation((key: string, fallback?: string) =>
      key === "COGNITO_USER_POOL_ID" ? "us-east-1_test" : fallback,
    );
    verifyMock.mockResolvedValue({
      token_use: "access",
      sub: "user-sub",
      iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
      client_id: "client-access",
      aud: "must-not-be-used",
      exp: 9999999999,
      iat: 1,
      auth_time: 1,
      jti: "jti",
      origin_jti: "origin",
    });

    await verifyCognitoApplicationToken("access-token", "access");

    expect(cognitoVerifierCreateMock).toHaveBeenLastCalledWith({
      userPoolId: "us-east-1_test",
      tokenUse: "access",
      clientId: null,
    });
    expect(routeAdmissionMock).toHaveBeenLastCalledWith({
      userPoolId: "us-east-1_test",
      appClientId: "client-access",
      cognitoSub: "user-sub",
    });
  });

  it("does not substitute access-token client_id for a missing ID-token aud", async () => {
    getConfigMock.mockImplementation((key: string, fallback?: string) =>
      key === "COGNITO_USER_POOL_ID" ? "us-east-1_test" : fallback,
    );
    verifyMock.mockResolvedValue({
      token_use: "id",
      sub: "user-sub",
      iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test",
      client_id: "access-style-client",
    });

    await expect(
      verifyCognitoApplicationToken("id-token", "id"),
    ).rejects.toThrow(/missing issuer or app-client provenance/);
  });
});
