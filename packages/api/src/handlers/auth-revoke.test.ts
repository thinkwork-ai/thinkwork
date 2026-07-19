import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const { authenticateMock, sendMock } = vi.hoisted(() => ({
  authenticateMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: authenticateMock }));
vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = sendMock;
  },
  RevokeTokenCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

import { __resetAuthRevokeRateLimitForTests, handler } from "./auth-revoke.js";

function event(
  body: unknown = { refreshToken: "opaque-refresh-token" },
  method = "POST",
): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    headers: { authorization: "Bearer id-token" },
    requestContext: { http: { method } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  authenticateMock.mockReset();
  sendMock.mockReset();
  __resetAuthRevokeRateLimitForTests();
  authenticateMock.mockResolvedValue({
    authType: "cognito",
    principalId: "cognito-sub",
    cognitoIssuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
    route: { appClientId: "admitted-client" },
  });
  sendMock.mockResolvedValue({});
});

describe("auth-revoke", () => {
  it("revokes against the authenticated route client", async () => {
    const response = await handler(event());

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "{}")).toEqual({ revoked: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0].input).toEqual({
      ClientId: "admitted-client",
      Token: "opaque-refresh-token",
    });
  });

  it("requires an admitted Cognito route", async () => {
    authenticateMock.mockResolvedValue(null);
    const response = await handler(event());
    expect(response.statusCode).toBe(401);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects malformed refresh tokens before calling Cognito", async () => {
    const response = await handler(event({ refreshToken: "" }));
    expect(response.statusCode).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("treats an invalid or already revoked token as terminal success", async () => {
    sendMock.mockRejectedValue(
      Object.assign(new Error("sensitive provider detail"), {
        name: "NotAuthorizedException",
      }),
    );
    const response = await handler(event());
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("sensitive");
  });

  it("rate limits each authenticated principal and client", async () => {
    vi.stubEnv("AUTH_REVOKE_RATE_LIMIT_PER_MINUTE", "1");
    expect((await handler(event())).statusCode).toBe(200);
    expect((await handler(event())).statusCode).toBe(429);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("sanitizes upstream failures", async () => {
    sendMock.mockRejectedValue(new Error("refresh token was secret-value"));
    const response = await handler(event());
    expect(response.statusCode).toBe(502);
    expect(response.body).toBe('{"error":"Unable to revoke session"}');
  });
});
