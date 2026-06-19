import { describe, expect, it, vi } from "vitest";
import {
  WORKOS_BRIDGE_CHALLENGE_METADATA_KEY,
  exchangeWorkosBridgeForCognitoTokens,
  handleCognitoCustomAuthChallenge,
  signWorkosCognitoChallenge,
  verifyWorkosCognitoChallenge,
  type CognitoCustomAuthEvent,
  type WorkosBridgeRecord,
  type WorkosCognitoBridgeDeps,
} from "./workos-cognito-bridge.js";
import { digestBridgeCode } from "./workos-auth.js";

const bridge: WorkosBridgeRecord = {
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
};

describe("exchangeWorkosBridgeForCognitoTokens", () => {
  it("consumes a pending WorkOS bridge, resolves the tenant user, and returns Cognito tokens", async () => {
    const deps = depsForBridge();

    const tokens = await exchangeWorkosBridgeForCognitoTokens({
      bridgeCode: "browser-bridge-code",
      deps,
    });

    expect(deps.consumePendingBridge).toHaveBeenCalledWith({
      bridgeCodeDigest: digestBridgeCode("browser-bridge-code"),
      now: new Date("2026-06-19T11:00:00Z"),
    });
    expect(deps.resolveBridgeUser).toHaveBeenCalledWith(bridge);
    expect(deps.startCognitoCustomAuth).toHaveBeenCalledWith({
      username: "eric@homecareintel.com",
      signedChallenge: expect.any(String),
      answer: "answer-token",
    });
    expect(tokens).toEqual({
      id_token: jwt({
        sub: "cognito-sub-123",
        "cognito:username": "cognito-user-123",
        exp: 1781870400,
      }),
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(deps.recordWorkosSession).toHaveBeenCalledWith({
      tenantId: "tenant-123",
      userId: "user-123",
      tenantReferenceId: "tenant-ref-123",
      authProviderResourceId: "resource-123",
      cognitoPrincipalId: "cognito-sub-123",
      cognitoUsername: "cognito-user-123",
      workosUserId: "workos-user-123",
      workosSessionId: "workos-session-123",
      workosEmail: "eric@homecareintel.com",
      expiresAt: new Date("2026-06-19T12:30:00Z"),
    });
    expect(deps.emitSignInSuccess).toHaveBeenCalledWith({
      tenantId: "tenant-123",
      userId: "user-123",
      workosUserId: "workos-user-123",
      cognitoSub: "cognito-sub-123",
      authProviderResourceId: "resource-123",
      tenantReferenceId: "tenant-ref-123",
      hasActiveTenantMembership: true,
    });

    const signedChallenge = vi.mocked(deps.startCognitoCustomAuth).mock
      .calls[0][0].signedChallenge;
    const challenge = verifyWorkosCognitoChallenge(
      signedChallenge,
      "api-secret",
    );
    expect(challenge).toMatchObject({
      bridgeCodeDigest: digestBridgeCode("browser-bridge-code"),
      userId: "user-123",
      tenantId: "tenant-123",
      email: "eric@homecareintel.com",
      workosUserId: "workos-user-123",
      workosSessionId: "workos-session-123",
    });
  });

  it("rejects replayed or expired bridge codes before starting Cognito", async () => {
    const deps = depsForBridge({ bridge: null });

    await expect(
      exchangeWorkosBridgeForCognitoTokens({
        bridgeCode: "browser-bridge-code",
        deps,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(deps.startCognitoCustomAuth).not.toHaveBeenCalled();
  });

  it("fails closed when the resolved user is outside the bridge tenant", async () => {
    const deps = depsForBridge({
      user: {
        id: "user-123",
        tenantId: "tenant-other",
        email: "eric@homecareintel.com",
        name: "Eric",
        hasActiveTenantMembership: true,
      },
    });

    await expect(
      exchangeWorkosBridgeForCognitoTokens({
        bridgeCode: "browser-bridge-code",
        deps,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(deps.startCognitoCustomAuth).not.toHaveBeenCalled();
    expect(deps.emitSignInFailure).toHaveBeenCalledWith({
      tenantId: "tenant-123",
      userId: "user-123",
      email: "eric@homecareintel.com",
      workosUserId: "workos-user-123",
      authProviderResourceId: "resource-123",
      tenantReferenceId: "tenant-ref-123",
      reason: "tenant_user_not_mapped",
    });
  });

  it("still mints Cognito tokens for mapped users without active tenant membership so the app can render no-workspace", async () => {
    const deps = depsForBridge({
      user: {
        id: "user-123",
        tenantId: "tenant-123",
        email: "eric@homecareintel.com",
        name: "Eric",
        hasActiveTenantMembership: false,
      },
    });

    await expect(
      exchangeWorkosBridgeForCognitoTokens({
        bridgeCode: "browser-bridge-code",
        deps,
      }),
    ).resolves.toMatchObject({
      access_token: "access-token",
      refresh_token: "refresh-token",
    });
    expect(deps.emitSignInSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-123",
        userId: "user-123",
        workosUserId: "workos-user-123",
        cognitoSub: "cognito-sub-123",
        hasActiveTenantMembership: false,
      }),
    );
  });
});

describe("Cognito custom auth challenge handler", () => {
  it("defines a new custom challenge for the first auth step", () => {
    const event = customAuthEvent("DefineAuthChallenge_Authentication", {
      session: [],
    });

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response).toMatchObject({
      challengeName: "CUSTOM_CHALLENGE",
      issueTokens: false,
      failAuthentication: false,
    });
  });

  it("issues tokens after a successful custom challenge", () => {
    const event = customAuthEvent("DefineAuthChallenge_Authentication", {
      session: [{ challengeName: "CUSTOM_CHALLENGE", challengeResult: true }],
    });

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response).toMatchObject({
      issueTokens: true,
      failAuthentication: false,
    });
  });

  it("creates private challenge parameters from signed server metadata", () => {
    const signed = signedChallenge("answer-token");
    const event = customAuthEvent("CreateAuthChallenge_Authentication", {
      clientMetadata: {
        [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: signed,
      },
    });

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response.publicChallengeParameters).toEqual({
      challenge: "workos_bridge",
    });
    expect(result.response.privateChallengeParameters).toEqual({
      [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: signed,
    });
  });

  it("creates a generic private challenge when Cognito omits initiate-auth client metadata", () => {
    const event = customAuthEvent("CreateAuthChallenge_Authentication", {});

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response.publicChallengeParameters).toEqual({
      challenge: "workos_bridge",
    });
    expect(result.response.privateChallengeParameters).toEqual({});
  });

  it("verifies the custom answer without exposing the answer in public parameters", () => {
    const signed = signedChallenge("answer-token");
    const event = customAuthEvent("VerifyAuthChallengeResponse_Authentication", {
      privateChallengeParameters: {
        [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: signed,
      },
      challengeAnswer: "answer-token",
    });

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response.answerCorrect).toBe(true);
  });

  it("verifies the custom answer from respond-to-challenge client metadata when private params are empty", () => {
    const signed = signedChallenge("answer-token");
    const event = customAuthEvent("VerifyAuthChallengeResponse_Authentication", {
      privateChallengeParameters: {},
      clientMetadata: {
        [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: signed,
      },
      challengeAnswer: "answer-token",
    });

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response.answerCorrect).toBe(true);
  });

  it("rejects wrong answers", () => {
    const signed = signedChallenge("answer-token");
    const event = customAuthEvent("VerifyAuthChallengeResponse_Authentication", {
      privateChallengeParameters: {
        [WORKOS_BRIDGE_CHALLENGE_METADATA_KEY]: signed,
      },
      challengeAnswer: "wrong-token",
    });

    const result = handleCognitoCustomAuthChallenge(event, "api-secret");

    expect(result.response.answerCorrect).toBe(false);
  });
});

function depsForBridge(overrides: {
  bridge?: WorkosBridgeRecord | null;
  user?: {
    id: string;
    tenantId: string;
    email: string;
    name: string | null;
    hasActiveTenantMembership: boolean;
  } | null;
} = {}): WorkosCognitoBridgeDeps {
  return {
    consumePendingBridge: vi.fn(async () =>
      Object.prototype.hasOwnProperty.call(overrides, "bridge")
        ? overrides.bridge!
        : bridge,
    ),
    resolveBridgeUser: vi.fn(async () =>
      Object.prototype.hasOwnProperty.call(overrides, "user")
        ? overrides.user!
        : {
            id: "user-123",
            tenantId: "tenant-123",
            email: "eric@homecareintel.com",
            name: "Eric",
            hasActiveTenantMembership: true,
          },
    ),
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

function jwt(payload: Record<string, unknown>): string {
  return [
    "header",
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".");
}

function customAuthEvent(
  triggerSource: string,
  request: CognitoCustomAuthEvent["request"],
): CognitoCustomAuthEvent {
  return {
    triggerSource,
    request,
    response: {},
  };
}

function signedChallenge(answer: string): string {
  return signWorkosCognitoChallenge(
    {
      kind: "workos_cognito_custom_auth",
      bridgeCodeDigest: digestBridgeCode("browser-bridge-code"),
      userId: "user-123",
      tenantId: "tenant-123",
      email: "eric@homecareintel.com",
      workosUserId: "workos-user-123",
      workosSessionId: "workos-session-123",
      answerDigest: digestBridgeCode(answer),
    },
    "api-secret",
  );
}
