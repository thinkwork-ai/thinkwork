import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createWorkosAuthHandler } from "./workos-auth.js";
import { signWorkosAuthorizeState, type WorkosAuthDeps } from "../lib/workos-auth.js";
import type { WorkosLogoutDeps } from "../lib/workos-auth-session.js";
import type { WorkosCognitoBridgeDeps } from "../lib/workos-cognito-bridge.js";

describe("workos-auth handler", () => {
  it("redirects authorize requests to WorkOS", async () => {
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps: bridgeDepsForHandler(),
    });

    const response = await handler(
      event({
        path: "/api/auth/workos/authorize",
        query: {
          redirect_uri: "https://app.customer.example/auth/callback",
          return_to: "/new",
        },
      }),
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toContain(
      "https://api.workos.com/user_management/authorize",
    );
  });

  it("redirects successful callbacks back to the web callback with a bridge code", async () => {
    const state = signWorkosAuthorizeState(
      {
        kind: "workos_authorize_state",
        nonce: "nonce-123",
        host: "api.customer.example",
        tenantId: "tenant-123",
        tenantReferenceId: "tenant-ref-123",
        authProviderResourceId: "resource-123",
        redirectUri: "https://app.customer.example/auth/callback",
        returnTo: "/new",
      },
      "state-secret",
    );
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps: bridgeDepsForHandler(),
    });

    const response = await handler(
      event({
        path: "/api/auth/workos/callback",
        query: { code: "code_123", state },
      }),
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers?.Location).toBe(
      "https://app.customer.example/auth/callback?workos_bridge=bridge-code&next=%2Fnew",
    );
  });

  it("fails closed for unsupported paths", async () => {
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps: bridgeDepsForHandler(),
    });

    const response = await handler(event({ path: "/api/auth/workos/nope" }));

    expect(response.statusCode).toBe(404);
  });

  it("exchanges a WorkOS bridge code for Cognito tokens", async () => {
    const bridgeDeps = bridgeDepsForHandler();
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps,
    });

    const response = await handler(
      event({
        path: "/api/auth/workos/bridge",
        method: "POST",
        body: { bridge_code: "browser-bridge-code" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(bridgeDeps.consumePendingBridge).toHaveBeenCalled();
    expect(bridgeDeps.startCognitoCustomAuth).toHaveBeenCalled();
  });

  it("revokes authenticated WorkOS sessions server-side", async () => {
    const logoutDeps = logoutDepsForHandler();
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps: bridgeDepsForHandler(),
      logoutDeps,
    });

    const response = await handler(
      event({
        path: "/api/auth/workos/logout",
        method: "POST",
        headers: { authorization: "Bearer id-token" },
        body: { return_to: "https://app.customer.example" },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ logout_url: null });
    expect(logoutDeps.findActiveSession).toHaveBeenCalledWith({
      cognitoPrincipalId: "cognito-sub-123",
      now: new Date("2026-06-19T12:00:00Z"),
    });
    expect(logoutDeps.getSecret).toHaveBeenCalledWith("secret-ref");
    expect(logoutDeps.revokeWorkosSession).toHaveBeenCalledWith({
      sessionId: "workos-session-123",
      clientSecret: "secret_123",
    });
    expect(logoutDeps.markSessionLoggedOut).toHaveBeenCalledWith({
      sessionRowId: "session-row-123",
      now: new Date("2026-06-19T12:00:00Z"),
    });
    expect(logoutDeps.emitSignOutAudit).toHaveBeenCalledWith({
      tenantId: "tenant-123",
      userId: "user-123",
      cognitoSub: "cognito-sub-123",
      sessionId: "session-row-123",
      workosUserId: "workos-user-123",
      authProviderResourceId: "resource-123",
      tenantReferenceId: "tenant-ref-123",
      result: "workos_session_revoked",
    });
  });

  it("requires Cognito auth for WorkOS logout", async () => {
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps: bridgeDepsForHandler(),
      logoutDeps: logoutDepsForHandler({ auth: null }),
    });

    const response = await handler(
      event({
        path: "/api/auth/workos/logout",
        method: "POST",
        body: { return_to: "https://app.customer.example/sign-in" },
      }),
    );

    expect(response.statusCode).toBe(401);
  });

  it("fails closed when a bridge POST has invalid JSON", async () => {
    const handler = createWorkosAuthHandler({
      workosAuthDeps: depsForHandler(),
      bridgeDeps: bridgeDepsForHandler(),
    });

    const response = await handler(
      event({
        path: "/api/auth/workos/bridge",
        method: "POST",
        rawBody: "{not-json",
      }),
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "{}")).toEqual({
      error: "WorkOS authentication failed",
    });
  });
});

function depsForHandler(): WorkosAuthDeps {
  return {
    loadPublicationForHost: vi.fn(async () => ({
      tenantId: "tenant-123",
      tenantReferenceId: "tenant-ref-123",
      authProviderResourceId: "resource-123",
      clientId: "client_123",
      clientSecretRef: "secret-ref",
      authorizeScopes: "openid email profile",
      hostnames: ["api.customer.example"],
      metadata: {
        allowedRedirectOrigins: ["https://app.customer.example"],
      },
      componentHandlerRef: {
        status: "valid",
        publicOptionsPublished: true,
      },
    })),
    getSecret: vi.fn(async () => "secret_123"),
    exchangeCode: vi.fn(async () => ({
      access_token: jwt({ sid: "session_123" }),
      user: {
        id: "user_123",
        email: "eric@homecareintel.com",
        email_verified: true,
      },
    })),
    persistBridge: vi.fn(async () => undefined),
    signingSecret: () => "state-secret",
    now: () => new Date("2026-06-19T10:00:00Z"),
    randomToken: () => "bridge-code",
  };
}

function bridgeDepsForHandler(): WorkosCognitoBridgeDeps {
  return {
    consumePendingBridge: vi.fn(async () => ({
      id: "bridge-row-123",
      tenantId: "tenant-123",
      tenantReferenceId: "tenant-ref-123",
      authProviderResourceId: "resource-123",
      workosUserId: "workos-user-123",
      workosSessionId: "workos-session-123",
      workosSessionExpiresAt: new Date("2026-06-19T12:30:00Z"),
      workosEmail: "eric@homecareintel.com",
      workosEmailVerified: true,
      returnTo: "/new",
    })),
    resolveBridgeUser: vi.fn(async () => ({
      id: "user-123",
      tenantId: "tenant-123",
      email: "eric@homecareintel.com",
      name: "Eric",
      hasActiveTenantMembership: true,
    })),
    startCognitoCustomAuth: vi.fn(async () => ({
      id_token: jwt({
        sub: "cognito-sub-123",
        "cognito:username": "cognito-user-123",
        exp: 1781870400,
      }),
      access_token: "access-token",
      refresh_token: "refresh-token",
    })),
    recordWorkosSession: vi.fn(async () => undefined),
    emitSignInSuccess: vi.fn(async () => undefined),
    emitSignInFailure: vi.fn(async () => undefined),
    signingSecret: () => "api-secret",
    now: () => new Date("2026-06-19T11:00:00Z"),
    randomToken: () => "answer-token",
  };
}

function logoutDepsForHandler(overrides: {
  auth?: Awaited<ReturnType<WorkosLogoutDeps["authenticate"]>>;
  session?: Awaited<ReturnType<WorkosLogoutDeps["findActiveSession"]>>;
} = {}): WorkosLogoutDeps {
  const defaultAuth: NonNullable<
    Awaited<ReturnType<WorkosLogoutDeps["authenticate"]>>
  > = {
    principalId: "cognito-sub-123",
    tenantId: "tenant-123",
    email: "eric@homecareintel.com",
    emailVerified: true,
    authType: "cognito",
    agentId: null,
  };
  return {
    authenticate: vi.fn(async () =>
      Object.prototype.hasOwnProperty.call(overrides, "auth")
        ? overrides.auth!
        : defaultAuth,
    ),
    findActiveSession: vi.fn(async () =>
      Object.prototype.hasOwnProperty.call(overrides, "session")
        ? overrides.session!
        : {
            id: "session-row-123",
            tenantId: "tenant-123",
            userId: "user-123",
            tenantReferenceId: "tenant-ref-123",
            authProviderResourceId: "resource-123",
            workosUserId: "workos-user-123",
            workosSessionId: "workos-session-123",
            clientSecretRef: "secret-ref",
          },
    ),
    getSecret: vi.fn(async () => "secret_123"),
    revokeWorkosSession: vi.fn(async () => undefined),
    markSessionLoggedOut: vi.fn(async () => undefined),
    emitSignOutAudit: vi.fn(async () => undefined),
    now: () => new Date("2026-06-19T12:00:00Z"),
  };
}

function event(args: {
  path: string;
  method?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  rawBody?: string;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${args.method ?? "GET"} ${args.path}`,
    rawPath: args.path,
    rawQueryString: "",
    queryStringParameters: args.query,
    body: args.rawBody ?? (args.body ? JSON.stringify(args.body) : undefined),
    headers: args.headers ?? {},
    requestContext: {
      accountId: "123",
      apiId: "api",
      domainName: "api.customer.example",
      domainPrefix: "api",
      http: {
        method: args.method ?? "GET",
        path: args.path,
        protocol: "HTTP/1.1",
        sourceIp: "203.0.113.10",
        userAgent: "vitest",
      },
      requestId: "req",
      routeKey: `${args.method ?? "GET"} ${args.path}`,
      stage: "$default",
      time: "19/Jun/2026:10:00:00 +0000",
      timeEpoch: 1781863200000,
    },
    isBase64Encoded: false,
  };
}

function jwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}
