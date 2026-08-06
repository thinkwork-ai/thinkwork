import { describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createAuthSubscriptionTicketHandler } from "./auth-subscription-ticket.js";

const route = {
  routeClientId: "11111111-1111-4111-8111-111111111111",
  routeKey: "web-google",
  clientFamily: "web",
  appClientId: "cognito-client",
  lifecycleState: "native" as const,
  connectionId: "connection-1",
  connectionKey: "google",
  providerKind: "google",
  providerIssuer: "https://accounts.google.com",
};

function event(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /api/auth/subscription-ticket",
    rawPath: "/api/auth/subscription-ticket",
    rawQueryString: "",
    headers: { authorization: "id-token" },
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function dependencies() {
  const persist = vi.fn(async () => undefined);
  return {
    authenticate: vi.fn(async () => ({
      authType: "cognito" as const,
      principalId: "cognito-sub",
      tenantId: null,
      email: null,
      emailVerified: true,
      agentId: null,
      cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
      route,
    })),
    signer: vi.fn(async () => ({
      keyId: "key-1",
      sign: vi.fn(() => "twsub1_signed"),
    })),
    admit: vi.fn(async () => ({
      userId: "user-1",
      tenantId: "tenant-1",
      route,
    })),
    admitOperation: vi.fn(async () => ({
      operationName: "OnNewMessage",
      operationHash: "hash-1",
      resourceKind: "thread" as const,
      resourceId: "thread-1",
    })),
    persist,
    countRecentConnectTickets: vi.fn(async () => 0),
    now: () => 1_800_000_000,
    stage: () => "dev",
    audience: () => "appsync-api-1",
  };
}

describe("auth subscription ticket handler", () => {
  it("issues and persists a one-use connect ticket", async () => {
    const deps = dependencies();
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({ kind: "connect", tenantId: "tenant-1" }),
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? ("{}" as string))).toEqual({
      token: "twsub1_signed",
      kind: "connect",
      expiresAt: 1_800_000_060,
    });
    expect(deps.admitOperation).not.toHaveBeenCalled();
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        nonceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        claims: expect.objectContaining({
          kind: "connect",
          tenantId: "tenant-1",
        }),
      }),
    );
  });

  it("operation-binds a registration ticket", async () => {
    const deps = dependencies();
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({
        kind: "registration",
        tenantId: "tenant-1",
        operationName: "OnNewMessage",
        query:
          "subscription OnNewMessage { onNewMessage(threadId: 1) { messageId } }",
        variables: { threadId: "thread-1" },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(deps.persist).toHaveBeenCalledWith(
      expect.objectContaining({
        claims: expect.objectContaining({
          operationName: "OnNewMessage",
          operationHash: "hash-1",
          resourceId: "thread-1",
        }),
      }),
    );
  });

  it("fails closed when signing configuration is absent", async () => {
    const deps = dependencies();
    deps.signer.mockResolvedValueOnce(null as never);
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({ kind: "connect", tenantId: "tenant-1" }),
    );
    expect(response.statusCode).toBe(503);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("rejects service authentication and invalid registration input", async () => {
    const serviceDeps = dependencies();
    serviceDeps.authenticate.mockResolvedValueOnce({
      authType: "service",
      principalId: null,
    } as never);
    expect(
      (
        await createAuthSubscriptionTicketHandler(serviceDeps)(
          event({ kind: "connect", tenantId: "tenant-1" }),
        )
      ).statusCode,
    ).toBe(401);

    const deps = dependencies();
    expect(
      (
        await createAuthSubscriptionTicketHandler(deps)(
          event({ kind: "registration", tenantId: "tenant-1" }),
        )
      ).statusCode,
    ).toBe(400);
  });

  it("mints under the connect rate limit and counts only the last minute", async () => {
    const deps = dependencies();
    deps.countRecentConnectTickets.mockResolvedValueOnce(9);
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({ kind: "connect", tenantId: "tenant-1" }),
    );
    expect(response.statusCode).toBe(200);
    expect(deps.countRecentConnectTickets).toHaveBeenCalledWith({
      cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
      cognitoSub: "cognito-sub",
      since: new Date(1_799_999_940_000),
    });
  });

  it("refuses connect tickets with 429 above 10 per minute", async () => {
    const deps = dependencies();
    deps.countRecentConnectTickets.mockResolvedValueOnce(10);
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({ kind: "connect", tenantId: "tenant-1" }),
    );
    expect(response.statusCode).toBe(429);
    expect(deps.admit).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it("does not rate-limit operation-bound registration tickets", async () => {
    const deps = dependencies();
    deps.countRecentConnectTickets.mockResolvedValue(5_000);
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({
        kind: "registration",
        tenantId: "tenant-1",
        operationName: "OnNewMessage",
        query:
          "subscription OnNewMessage { onNewMessage(threadId: 1) { messageId } }",
        variables: { threadId: "thread-1" },
      }),
    );
    expect(response.statusCode).toBe(200);
    expect(deps.countRecentConnectTickets).not.toHaveBeenCalled();
  });

  it("fails open when the rate-limit count query errors", async () => {
    const deps = dependencies();
    deps.countRecentConnectTickets.mockRejectedValueOnce(new Error("db down"));
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({ kind: "connect", tenantId: "tenant-1" }),
    );
    expect(response.statusCode).toBe(200);
  });

  it("returns a uniform forbidden response for admission failures", async () => {
    const deps = dependencies();
    deps.admit.mockRejectedValueOnce(
      Object.assign(new Error("detail"), { code: "tenant_not_admitted" }),
    );
    const response = await createAuthSubscriptionTicketHandler(deps)(
      event({ kind: "connect", tenantId: "tenant-2" }),
    );
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("tenant_not_admitted");
  });
});
