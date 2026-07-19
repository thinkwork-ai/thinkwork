import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import {
  AuthReconciliationConflict,
  assertReconciliationTransition,
  handler,
  verifyReconciledAwsMetadata,
} from "./auth-provider-reconcile.js";
import type { SafeAuthReconcilePayload } from "../lib/auth-provider-validation.js";

function event(
  body: string,
  authorization = "Bearer reconcile-secret",
): APIGatewayProxyEventV2 {
  return {
    rawPath: "/api/auth/providers/reconcile",
    body,
    headers: { authorization },
    requestContext: { http: { method: "POST" } },
  } as unknown as APIGatewayProxyEventV2;
}

beforeEach(() => {
  process.env.API_AUTH_SECRET = "reconcile-secret";
});

afterEach(() => {
  delete process.env.API_AUTH_SECRET;
});

describe("auth provider reconciliation transition", () => {
  it("accepts exactly the next revision with the complete connection set", () => {
    expect(
      assertReconciliationTransition({
        latestRevision: 4,
        expectedPreviousRevision: 4,
        revision: 5,
        manifestFingerprint: "a".repeat(64),
        existingConnectionKeys: ["google", "microsoft:organizations"],
        desiredConnectionKeys: [
          "google",
          "microsoft:organizations",
          "microsoft:tenant:new",
        ],
      }),
    ).toBe("apply");
  });

  it("makes an identical idempotency replay terminal", () => {
    expect(
      assertReconciliationTransition({
        latestRevision: 5,
        expectedPreviousRevision: 4,
        revision: 5,
        manifestFingerprint: "a".repeat(64),
        replayFingerprint: "a".repeat(64),
        existingConnectionKeys: [],
        desiredConnectionKeys: [],
      }),
    ).toBe("replay");
  });

  it("converges when the API applied but the caller lost its state write", () => {
    expect(
      assertReconciliationTransition({
        latestRevision: 5,
        latestFingerprint: "a".repeat(64),
        expectedPreviousRevision: 4,
        revision: 5,
        manifestFingerprint: "a".repeat(64),
        existingConnectionKeys: [],
        desiredConnectionKeys: [],
      }),
    ).toBe("latest_replay");
  });

  it("rejects concurrent revision loss", () => {
    expect(() =>
      assertReconciliationTransition({
        latestRevision: 5,
        expectedPreviousRevision: 4,
        revision: 5,
        manifestFingerprint: "a".repeat(64),
        existingConnectionKeys: [],
        desiredConnectionKeys: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("rejects an unrelated deployment that omits an existing connection", () => {
    expect(() =>
      assertReconciliationTransition({
        latestRevision: 1,
        expectedPreviousRevision: 1,
        revision: 2,
        manifestFingerprint: "a".repeat(64),
        existingConnectionKeys: ["google", "microsoft:tenant:customer"],
        desiredConnectionKeys: ["google"],
      }),
    ).toThrowError(expect.objectContaining({ code: "incomplete_desired_set" }));
  });

  it("rejects reuse of an idempotency key with different metadata", () => {
    try {
      assertReconciliationTransition({
        latestRevision: 1,
        expectedPreviousRevision: 1,
        revision: 2,
        manifestFingerprint: "a".repeat(64),
        replayFingerprint: "b".repeat(64),
        existingConnectionKeys: [],
        desiredConnectionKeys: [],
      });
      throw new Error("expected conflict");
    } catch (cause) {
      expect(cause).toBeInstanceOf(AuthReconciliationConflict);
      expect((cause as AuthReconciliationConflict).code).toBe(
        "idempotency_mismatch",
      );
    }
  });
});

describe("independent Cognito metadata verification", () => {
  const payload: SafeAuthReconcilePayload = {
    stage: "dev",
    awsAccountId: "123456789012",
    awsRegion: "us-east-1",
    revision: 1,
    expectedPreviousRevision: 0,
    idempotencyKey: "0198f0e8-86c1-7ab2-9a42-9a3b4f1a2c3d",
    manifestFingerprint: "a".repeat(64),
    connections: [
      {
        connectionKey: "microsoft:organizations",
        providerKey: "microsoft",
        providerKind: "microsoft_organizations",
        displayName: "Microsoft work or school",
        lifecycleState: "native",
        cognitoUserPoolId: "us-east-1_Example",
        cognitoIdentityProviderName: "MicrosoftOrganizations",
        issuerUrl:
          "https://login.microsoftonline.com/9d65869f-0798-433d-b4e6-8c20d113dfbc/v2.0",
        clientId: "client-id",
        authorizeScopes: "openid email profile",
        tenantBindings: [],
      },
    ],
    routeClients: [
      {
        routeKey: "microsoft-organizations",
        clientFamily: "web",
        cognitoUserPoolId: "us-east-1_Example",
        cognitoAppClientId: "1234567890abcdefghijklmnop",
        providerNames: ["MicrosoftOrganizations"],
        explicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
        redirectUris: ["https://app.example.com/auth/callback"],
        logoutUris: ["https://app.example.com/sign-in"],
        lifecycleState: "native",
      },
    ],
  };

  it("accepts only an exact independently described provider/client match", async () => {
    const responses = [
      {
        IdentityProvider: {
          ProviderName: "MicrosoftOrganizations",
          ProviderType: "OIDC",
          ProviderDetails: {
            client_id: "client-id",
            oidc_issuer:
              "https://login.microsoftonline.com/9d65869f-0798-433d-b4e6-8c20d113dfbc/v2.0",
          },
        },
      },
      {
        UserPoolClient: {
          ClientId: "1234567890abcdefghijklmnop",
          GenerateSecret: false,
          EnableTokenRevocation: true,
          PreventUserExistenceErrors: "ENABLED",
          SupportedIdentityProviders: ["MicrosoftOrganizations"],
          ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthFlows: ["code"],
          AllowedOAuthScopes: ["openid", "email", "profile"],
          CallbackURLs: ["https://app.example.com/auth/callback"],
          LogoutURLs: ["https://app.example.com/sign-in"],
        },
      },
    ];
    await expect(
      verifyReconciledAwsMetadata(payload, {
        send: async () => responses.shift(),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a provider/client mismatch without exposing AWS details", async () => {
    await expect(
      verifyReconciledAwsMetadata(payload, {
        send: async () => ({
          IdentityProvider: {
            ProviderName: "DifferentProvider",
            ProviderType: "OIDC",
            ProviderDetails: {},
          },
        }),
      }),
    ).rejects.toMatchObject({ code: "aws_metadata_mismatch" });
  });
});

describe("auth provider reconciliation endpoint", () => {
  it("requires the operator service credential", async () => {
    const response = await handler(event("{}", "Bearer wrong"));
    expect(response.statusCode).toBe(401);
  });

  it("returns a redacted validation code without reaching reconciliation", async () => {
    const response = await handler(event("{}"));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      error: "invalid_string",
    });
    expect(response.body).not.toContain("reconcile-secret");
  });
});
