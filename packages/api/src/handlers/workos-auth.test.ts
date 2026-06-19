import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createWorkosAuthHandler } from "./workos-auth.js";
import { signWorkosAuthorizeState, type WorkosAuthDeps } from "../lib/workos-auth.js";

describe("workos-auth handler", () => {
  it("redirects authorize requests to WorkOS", async () => {
    const handler = createWorkosAuthHandler(depsForHandler());

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
    const handler = createWorkosAuthHandler(depsForHandler());

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
    const handler = createWorkosAuthHandler(depsForHandler());

    const response = await handler(event({ path: "/api/auth/workos/nope" }));

    expect(response.statusCode).toBe(404);
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

function event(args: {
  path: string;
  method?: string;
  query?: Record<string, string>;
}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${args.method ?? "GET"} ${args.path}`,
    rawPath: args.path,
    rawQueryString: "",
    queryStringParameters: args.query,
    headers: {},
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
