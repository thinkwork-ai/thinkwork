import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthResult } from "../../lib/cognito-auth.js";
import {
  MSTEAMS_LINK_TOKEN_TTL_MS,
  createMsteamsAccountLinkToken,
} from "../../lib/msteams/install-state.js";
import { handleMsteamsAccountLinkComplete } from "./account-link-complete.js";

const CREDENTIALS = { appId: "bot-app-1", clientSecret: "teams-client-secret" };

const COGNITO_AUTH: AuthResult = {
  principalId: "sub-1",
  tenantId: null,
  email: "user@example.com",
  emailVerified: true,
  authType: "cognito",
  agentId: null,
};

function event(body: unknown, method = "POST"): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} /msteams/account-link/complete`,
    rawPath: "/msteams/account-link/complete",
    rawQueryString: "",
    headers: { authorization: "Bearer jwt" },
    requestContext: {
      accountId: "1",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method,
        path: "/msteams/account-link/complete",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req",
      routeKey: `${method} /msteams/account-link/complete`,
      stage: "$default",
      time: "16/May/2026:00:00:00 +0000",
      timeEpoch: 1,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function linkToken(
  overrides: Partial<{
    tenantId: string;
    entraTenantId: string;
    aadObjectId: string;
    signingKey: string;
  }> = {}
): string {
  return createMsteamsAccountLinkToken({
    tenantId: "tenant-1",
    entraTenantId: "entra-1",
    aadObjectId: "aad-1",
    signingKey: CREDENTIALS.clientSecret,
    nowMs: () => 1_000,
    nonce: "nonce-1",
    ...overrides,
  });
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue(COGNITO_AUTH),
    getCredentials: vi.fn().mockResolvedValue(CREDENTIALS),
    resolveUserByEmail: vi
      .fn()
      .mockResolvedValue({ id: "user-1", tenantId: "tenant-1" }),
    isTenantMember: vi.fn().mockResolvedValue(false),
    findInstall: vi.fn().mockResolvedValue({
      tenant_id: "tenant-1",
      entra_tenant_id: "entra-1",
      bot_app_id: "bot-app-1",
      status: "active",
    }),
    upsertLink: vi.fn().mockResolvedValue({}),
    findLink: vi.fn().mockResolvedValue({
      user_id: "user-1",
      entra_tenant_id: "entra-1",
      aad_object_id: "aad-1",
      status: "active",
    }),
    unlink: vi.fn().mockResolvedValue({}),
    nowMs: () => 2_000,
    ...overrides,
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("msteams account-link-complete handler", () => {
  it("links the authenticated caller to the token's Teams identity", async () => {
    const d = deps();
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      linked: true,
      userId: "user-1",
    });
    expect(d.upsertLink).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      entraTenantId: "entra-1",
      aadObjectId: "aad-1",
      userId: "user-1",
    });
  });

  it("rejects unauthenticated callers with 401", async () => {
    const d = deps({ authenticate: vi.fn().mockResolvedValue(null) });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(401);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("rejects non-Cognito callers with 401", async () => {
    const d = deps({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...COGNITO_AUTH, authType: "service" }),
    });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(401);
  });

  it("rejects an expired token with 401", async () => {
    const d = deps({ nowMs: () => 1_000 + MSTEAMS_LINK_TOKEN_TTL_MS + 1 });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(401);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("rejects a tampered or wrongly-signed token with 401", async () => {
    const d = deps();
    const tampered = await handleMsteamsAccountLinkComplete(
      event({ token: `${linkToken().slice(0, -3)}xyz` }),
      d
    );
    expect(tampered.statusCode).toBe(401);

    const wrongKey = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken({ signingKey: "other-key" }) }),
      d
    );
    expect(wrongKey.statusCode).toBe(401);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("rejects a malformed token with 401 and a missing token with 400", async () => {
    const d = deps();
    const malformed = await handleMsteamsAccountLinkComplete(
      event({ token: "not-a-token" }),
      d
    );
    expect(malformed.statusCode).toBe(401);

    const missing = await handleMsteamsAccountLinkComplete(event({}), d);
    expect(missing.statusCode).toBe(400);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("rejects with 403 when the caller belongs to a different tenant", async () => {
    const d = deps({
      resolveUserByEmail: vi
        .fn()
        .mockResolvedValue({ id: "user-2", tenantId: "tenant-other" }),
      isTenantMember: vi.fn().mockResolvedValue(false),
    });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(403);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("accepts a caller whose membership comes from tenant_members", async () => {
    const d = deps({
      resolveUserByEmail: vi
        .fn()
        .mockResolvedValue({ id: "user-1", tenantId: null }),
      isTenantMember: vi.fn().mockResolvedValue(true),
    });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(200);
    expect(d.isTenantMember).toHaveBeenCalledWith("tenant-1", "user-1");
  });

  it("rejects with 409 when the tenant install is missing or inactive", async () => {
    const d = deps({ findInstall: vi.fn().mockResolvedValue(null) });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(409);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("rejects with 409 when the install belongs to a different ThinkWork tenant", async () => {
    const d = deps({
      findInstall: vi.fn().mockResolvedValue({
        tenant_id: "tenant-other",
        entra_tenant_id: "entra-1",
        bot_app_id: "bot-app-1",
        status: "active",
      }),
    });
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }),
      d
    );
    expect(response.statusCode).toBe(409);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("rejects linking the bot identity with 403", async () => {
    const d = deps();
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken({ aadObjectId: "bot-app-1" }) }),
      d
    );
    expect(response.statusCode).toBe(403);
    expect(d.upsertLink).not.toHaveBeenCalled();
  });

  it("unlinks the caller's own link", async () => {
    const d = deps();
    const response = await handleMsteamsAccountLinkComplete(
      event({
        action: "unlink",
        entraTenantId: "entra-1",
        aadObjectId: "aad-1",
      }),
      d
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ linked: false });
    expect(d.unlink).toHaveBeenCalledWith({
      entraTenantId: "entra-1",
      aadObjectId: "aad-1",
    });
  });

  it("refuses to unlink another user's link", async () => {
    const d = deps({
      findLink: vi.fn().mockResolvedValue({
        user_id: "someone-else",
        entra_tenant_id: "entra-1",
        aad_object_id: "aad-1",
        status: "active",
      }),
    });
    const response = await handleMsteamsAccountLinkComplete(
      event({
        action: "unlink",
        entraTenantId: "entra-1",
        aadObjectId: "aad-1",
      }),
      d
    );
    expect(response.statusCode).toBe(403);
    expect(d.unlink).not.toHaveBeenCalled();
  });

  it("returns 404 when unlinking a link that does not exist", async () => {
    const d = deps({ findLink: vi.fn().mockResolvedValue(null) });
    const response = await handleMsteamsAccountLinkComplete(
      event({
        action: "unlink",
        entraTenantId: "entra-1",
        aadObjectId: "aad-1",
      }),
      d
    );
    expect(response.statusCode).toBe(404);
    expect(d.unlink).not.toHaveBeenCalled();
  });

  it("guards the method", async () => {
    const response = await handleMsteamsAccountLinkComplete(
      event({ token: linkToken() }, "GET"),
      deps()
    );
    expect(response.statusCode).toBe(405);
  });

  it("never returns or logs the token or client_secret", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const token = linkToken();
    const response = await handleMsteamsAccountLinkComplete(
      event({ token }),
      deps()
    );

    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(CREDENTIALS.clientSecret);
    const logged = [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join(" ");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(CREDENTIALS.clientSecret);
  });
});
