import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthResult } from "../../lib/cognito-auth.js";
import {
  MSTEAMS_INSTALL_STATE_TTL_MS,
  verifyMsteamsInstallState,
} from "../../lib/msteams/install-state.js";
import { handleMsteamsInstallStart } from "./install-start.js";

const CREDENTIALS = { appId: "app-1", clientSecret: "teams-client-secret" };

const COGNITO_AUTH: AuthResult = {
  principalId: "sub-1",
  tenantId: null,
  email: "admin@example.com",
  emailVerified: true,
  authType: "cognito",
  agentId: null,
};

function event(body: unknown, method = "POST"): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} /msteams/install/start`,
    rawPath: "/msteams/install/start",
    rawQueryString: "",
    headers: { authorization: "Bearer jwt" },
    requestContext: {
      accountId: "1",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method,
        path: "/msteams/install/start",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "req",
      routeKey: `${method} /msteams/install/start`,
      stage: "$default",
      time: "16/May/2026:00:00:00 +0000",
      timeEpoch: 1,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    authenticate: vi.fn().mockResolvedValue(COGNITO_AUTH),
    getCredentials: vi.fn().mockResolvedValue(CREDENTIALS),
    resolveUserIdByEmail: vi.fn().mockResolvedValue("user-1"),
    isTenantAdmin: vi.fn().mockResolvedValue(true),
    reopenRevoked: vi.fn().mockResolvedValue(null),
    redirectUri: "https://api.example.com/msteams/install/complete",
    nowMs: () => 1_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("msteams install-start handler", () => {
  it("returns the consent URL and signed state without persisting any row", async () => {
    const d = deps();
    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }),
      d
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body ?? "{}");
    expect(body.expiresAt).toBe(1_000 + MSTEAMS_INSTALL_STATE_TTL_MS);

    const payload = verifyMsteamsInstallState(
      body.state,
      CREDENTIALS.clientSecret,
      () => 2_000
    );
    expect(payload.tenantId).toBe("tenant-1");
    expect(payload.adminUserId).toBe("user-1");

    const url = new URL(body.adminConsentUrl);
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/organizations/adminconsent"
    );
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("state")).toBe(body.state);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.example.com/msteams/install/complete"
    );

    // The only persistence side effect: a revoked install is deliberately
    // reopened to pending on this operator-authenticated path.
    expect(d.reopenRevoked).toHaveBeenCalledWith({ tenantId: "tenant-1" });
  });

  it("rejects unauthenticated callers with 401", async () => {
    const d = deps({ authenticate: vi.fn().mockResolvedValue(null) });
    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }),
      d
    );
    expect(response.statusCode).toBe(401);
    expect(d.reopenRevoked).not.toHaveBeenCalled();
  });

  it("rejects non-Cognito (service) callers with 401", async () => {
    const d = deps({
      authenticate: vi
        .fn()
        .mockResolvedValue({ ...COGNITO_AUTH, authType: "service" }),
    });
    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }),
      d
    );
    expect(response.statusCode).toBe(401);
    expect(d.reopenRevoked).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers with 403 and does not persist", async () => {
    const d = deps({ isTenantAdmin: vi.fn().mockResolvedValue(false) });
    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }),
      d
    );
    expect(response.statusCode).toBe(403);
    expect(d.reopenRevoked).not.toHaveBeenCalled();
  });

  it("rejects a caller with no ThinkWork user with 403", async () => {
    const d = deps({ resolveUserIdByEmail: vi.fn().mockResolvedValue(null) });
    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }),
      d
    );
    expect(response.statusCode).toBe(403);
    expect(d.reopenRevoked).not.toHaveBeenCalled();
  });

  it("requires tenantId", async () => {
    const response = await handleMsteamsInstallStart(event({}), deps());
    expect(response.statusCode).toBe(400);
  });

  it("rejects invalid JSON bodies", async () => {
    const raw = event(undefined);
    raw.body = "{not json";
    const response = await handleMsteamsInstallStart(raw, deps());
    expect(response.statusCode).toBe(400);
  });

  it("guards the method", async () => {
    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }, "GET"),
      deps()
    );
    expect(response.statusCode).toBe(405);
  });

  it("never returns or logs the client_secret", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleMsteamsInstallStart(
      event({ tenantId: "tenant-1" }),
      deps()
    );

    expect(response.body).not.toContain(CREDENTIALS.clientSecret);
    const logged = [logSpy, warnSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((value) => String(value))
      .join(" ");
    expect(logged).not.toContain(CREDENTIALS.clientSecret);
  });
});
