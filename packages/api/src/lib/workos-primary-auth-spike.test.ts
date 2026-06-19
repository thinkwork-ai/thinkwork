import { describe, expect, it, vi } from "vitest";
import {
  authenticateWorkosAuthorizationCode,
  buildCognitoCustomAuthChallengeInput,
  buildCognitoCustomAuthStartInput,
  buildWorkosAuthorizeUrl,
  buildWorkosLogoutUrl,
  extractWorkosSessionId,
  proveWorkosPrimaryExchange,
  validateCognitoBridgeClaims,
  workosAuthenticateEndpoint,
  workosAuthorizeEndpoint,
} from "./workos-primary-auth-spike";

describe("WorkOS primary auth spike helpers", () => {
  it("builds direct WorkOS AuthKit endpoints from an issuer", () => {
    expect(workosAuthorizeEndpoint()).toBe(
      "https://api.workos.com/user_management/authorize",
    );
    expect(workosAuthenticateEndpoint()).toBe(
      "https://api.workos.com/user_management/authenticate",
    );
  });

  it("builds a direct WorkOS authorization URL with provider/account hints", () => {
    const url = new URL(
      buildWorkosAuthorizeUrl({
        clientId: "client_123",
        redirectUri: "https://api.example.com/api/auth/workos/callback",
        state: "state-123",
        provider: "GoogleOAuth",
        prompt: "select_account",
      }),
    );

    expect(url.origin).toBe("https://api.workos.com");
    expect(url.pathname).toBe("/user_management/authorize");
    expect(url.searchParams.get("client_id")).toBe("client_123");
    expect(url.searchParams.get("provider")).toBe("GoogleOAuth");
    expect(url.searchParams.get("prompt")).toBe("select_account");
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });

  it("extracts the WorkOS sid claim needed for real logout", () => {
    expect(extractWorkosSessionId(jwt({ sid: "session_123" }))).toBe(
      "session_123",
    );
  });

  it("rejects WorkOS access tokens that cannot drive logout", () => {
    expect(() => extractWorkosSessionId(jwt({ sub: "user_123" }))).toThrow(
      /sid/,
    );
  });

  it("builds the WorkOS logout URL from the captured sid", () => {
    expect(
      buildWorkosLogoutUrl({
        sessionId: "session_123",
        returnTo: "http://localhost:5180/sign-in",
      }),
    ).toBe(
      "https://api.workos.com/user_management/sessions/logout?session_id=session_123&return_to=http%3A%2F%2Flocalhost%3A5180%2Fsign-in",
    );
  });

  it("authenticates a WorkOS code and requires a sid-bearing access token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        access_token: jwt({ sid: "session_123", sub: "user_123" }),
        refresh_token: "refresh_123",
        user: {
          id: "user_123",
          email: "eric@homecareintel.com",
          email_verified: true,
          first_name: "Eric",
          last_name: "Odom",
        },
      }),
    );

    const proof = await proveWorkosPrimaryExchange({
      clientId: "client_123",
      clientSecret: "secret_123",
      code: "code_123",
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      fetchImpl: fetchMock,
    });

    expect(proof.sessionId).toBe("session_123");
    expect(proof.workosUserId).toBe("user_123");
    expect(proof.user.email).toBe("eric@homecareintel.com");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.workos.com/user_management/authenticate",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject(
      {
        grant_type: "authorization_code",
        client_id: "client_123",
        client_secret: "secret_123",
        code: "code_123",
        ip_address: "127.0.0.1",
        user_agent: "vitest",
      },
    );
  });

  it("rejects WorkOS authentication responses without a user id", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        access_token: jwt({ sid: "session_123", sub: "user_123" }),
        user: { email: "eric@homecareintel.com" },
      }),
    );

    await expect(
      authenticateWorkosAuthorizationCode({
        clientId: "client_123",
        clientSecret: "secret_123",
        code: "code_123",
        fetchImpl: fetchMock,
      }),
    ).rejects.toThrow(/access_token\/user/);
  });

  it("shapes the Cognito custom auth start command for a server bridge", () => {
    expect(
      buildCognitoCustomAuthStartInput({
        userPoolId: "us-east-1_pool",
        clientId: "client-id",
        username: "eric@homecareintel.com",
        bridgeId: "bridge_123",
        workosUserId: "user_123",
        workosSessionId: "session_123",
      }),
    ).toEqual({
      AuthFlow: "CUSTOM_AUTH",
      UserPoolId: "us-east-1_pool",
      ClientId: "client-id",
      AuthParameters: {
        USERNAME: "eric@homecareintel.com",
        CHALLENGE_NAME: "CUSTOM_CHALLENGE",
      },
      ClientMetadata: {
        bridge_id: "bridge_123",
        workos_user_id: "user_123",
        workos_session_id: "session_123",
      },
    });
  });

  it("shapes the Cognito custom auth challenge response command", () => {
    expect(
      buildCognitoCustomAuthChallengeInput({
        userPoolId: "us-east-1_pool",
        clientId: "client-id",
        username: "eric@homecareintel.com",
        bridgeId: "bridge_123",
        bridgeAnswer: "answer_123",
        workosUserId: "user_123",
        workosSessionId: "session_123",
        session: "cognito-session",
      }),
    ).toEqual({
      UserPoolId: "us-east-1_pool",
      ClientId: "client-id",
      ChallengeName: "CUSTOM_CHALLENGE",
      Session: "cognito-session",
      ChallengeResponses: {
        USERNAME: "eric@homecareintel.com",
        ANSWER: "answer_123",
      },
      ClientMetadata: {
        bridge_id: "bridge_123",
        workos_user_id: "user_123",
        workos_session_id: "session_123",
      },
    });
  });

  it("validates the Cognito token contract required by downstream APIs", () => {
    const check = validateCognitoBridgeClaims(
      jwt({
        iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
        aud: "client-id",
        sub: "cognito-sub",
        email: "eric@homecareintel.com",
        email_verified: true,
        name: "Eric Odom",
        "custom:tenant_id": "tenant-123",
      }),
      {
        issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
        audience: "client-id",
        email: "eric@homecareintel.com",
        tenantId: "tenant-123",
      },
    );

    expect(check).toEqual({ ok: true, missing: [] });
  });

  it("reports missing Cognito bridge claims instead of accepting weak tokens", () => {
    const check = validateCognitoBridgeClaims(
      jwt({
        iss: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
        aud: "client-id",
        sub: "cognito-sub",
      }),
      {
        issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_pool",
        audience: "client-id",
        email: "eric@homecareintel.com",
        tenantId: "tenant-123",
      },
    );

    expect(check.ok).toBe(false);
    expect(check.missing).toEqual([
      "email",
      "email_verified",
      "name",
      "email_match",
      "custom:tenant_id",
    ]);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function jwt(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "none" })),
    base64Url(JSON.stringify(payload)),
    "signature",
  ].join(".");
}

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
