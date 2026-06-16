import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const {
  cognitoVerifierCreateMock,
  getConfigMock,
  primeRuntimeConfigMock,
  verifyMock,
} = vi.hoisted(() => ({
  cognitoVerifierCreateMock: vi.fn(),
  getConfigMock: vi.fn(),
  primeRuntimeConfigMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: getConfigMock,
  primeRuntimeConfig: primeRuntimeConfigMock,
}));

vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: cognitoVerifierCreateMock,
  },
}));

import { authenticate } from "./cognito-auth.js";

describe("authenticate — apikey path", () => {
  const prev = process.env.API_AUTH_SECRET;

  beforeEach(() => {
    process.env.API_AUTH_SECRET = "tw-test-secret";
    cognitoVerifierCreateMock.mockReset();
    getConfigMock.mockReset();
    primeRuntimeConfigMock.mockReset();
    verifyMock.mockReset();
    getConfigMock.mockImplementation((_: string, fallback?: string) => fallback);
    primeRuntimeConfigMock.mockResolvedValue(undefined);
    cognitoVerifierCreateMock.mockReturnValue({ verify: verifyMock });
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
    getConfigMock.mockReset();
    primeRuntimeConfigMock.mockReset();
    verifyMock.mockReset();
    getConfigMock.mockImplementation((_: string, fallback?: string) => fallback);
    primeRuntimeConfigMock.mockResolvedValue(undefined);
    cognitoVerifierCreateMock.mockReturnValue({ verify: verifyMock });
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
    getConfigMock.mockReset();
    primeRuntimeConfigMock.mockReset();
    verifyMock.mockReset();
    primeRuntimeConfigMock.mockResolvedValue(undefined);
    cognitoVerifierCreateMock.mockReturnValue({ verify: verifyMock });
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
      config.set("COGNITO_APP_CLIENT_IDS", "client-web,client-mobile");
    });
    verifyMock.mockResolvedValue({
      sub: "user-sub",
      email: "operator@example.com",
      email_verified: "true",
      "custom:tenant_id": "tenant-A",
    });

    const auth = await authenticate({ authorization: "Bearer jwt-token" });

    expect(primeRuntimeConfigMock).toHaveBeenCalledWith({ force: true });
    expect(cognitoVerifierCreateMock).toHaveBeenCalledWith({
      userPoolId: "us-east-1_test",
      tokenUse: "id",
      clientId: ["client-web", "client-mobile"],
    });
    expect(auth).toEqual({
      principalId: "user-sub",
      tenantId: "tenant-A",
      email: "operator@example.com",
      emailVerified: true,
      authType: "cognito",
      agentId: null,
    });
  });

  it("does not cache a verifier when runtime config remains unavailable", async () => {
    getConfigMock.mockImplementation((_: string, fallback?: string) => fallback);

    expect(await authenticate({ authorization: "Bearer jwt-token" })).toBeNull();

    expect(primeRuntimeConfigMock).toHaveBeenCalledWith({ force: true });
    expect(cognitoVerifierCreateMock).not.toHaveBeenCalled();
  });
});
