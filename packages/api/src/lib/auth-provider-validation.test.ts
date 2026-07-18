import { describe, expect, it } from "vitest";
import {
  AuthProviderValidationError,
  canonicalAuthManifestFingerprint,
  type SafeAuthReconcilePayload,
  validateAuthProviderMetadata,
} from "./auth-provider-validation.js";

function validPayload(): SafeAuthReconcilePayload {
  const withoutFingerprint: Omit<
    SafeAuthReconcilePayload,
    "manifestFingerprint"
  > = {
    stage: "dev",
    awsAccountId: "123456789012",
    awsRegion: "us-east-1",
    revision: 2,
    expectedPreviousRevision: 1,
    idempotencyKey: "0198f0e8-86c1-7ab2-9a42-9a3b4f1a2c3d",
    connections: [
      {
        connectionKey: "microsoft:organizations",
        providerKey: "microsoft",
        providerKind: "microsoft_organizations",
        displayName: "Microsoft work or school",
        lifecycleState: "native",
        cognitoUserPoolId: "us-east-1_Example123",
        cognitoIdentityProviderName: "MicrosoftOrganizations",
        issuerUrl: "https://login.microsoftonline.com/organizations/v2.0",
        clientId: "microsoft-client-id",
        clientSecretRef:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/auth/microsoft-organizations-AbCd",
        resourceArn:
          "arn:aws:cognito-idp:us-east-1:123456789012:identity-provider/us-east-1_Example123/MicrosoftOrganizations",
        authorizeScopes: "openid email profile",
        tenantBindings: [
          {
            tenantId: "12345678-1234-4123-8123-123456789abc",
            label: "Example Health",
            hostnames: ["login.example.com"],
            status: "enabled",
          },
        ],
      },
    ],
    routeClients: [
      {
        routeKey: "microsoft-organizations",
        clientFamily: "web",
        cognitoUserPoolId: "us-east-1_Example123",
        cognitoAppClientId: "1234567890abcdefghijklmnop",
        providerNames: ["MicrosoftOrganizations"],
        explicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
        redirectUris: ["https://app.example.com/auth/callback"],
        logoutUris: ["https://app.example.com/sign-in"],
        lifecycleState: "native",
        resourceArn:
          "arn:aws:cognito-idp:us-east-1:123456789012:userpool/us-east-1_Example123/client/1234567890abcdefghijklmnop",
      },
    ],
  };
  return {
    ...withoutFingerprint,
    manifestFingerprint: canonicalAuthManifestFingerprint(withoutFingerprint),
  };
}

describe("auth provider safe metadata validation", () => {
  function expectCode(run: () => unknown, code: string): void {
    try {
      run();
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthProviderValidationError);
      expect((error as AuthProviderValidationError).code).toBe(code);
    }
  }

  it("normalizes and accepts a complete Microsoft OIDC desired set", () => {
    const result = validateAuthProviderMetadata(validPayload());
    expect(result.connections[0]).toMatchObject({
      connectionKey: "microsoft:organizations",
      providerKind: "microsoft_organizations",
      lifecycleState: "native",
    });
    expect(result.connections[0]?.tenantBindings[0]?.hostnames).toEqual([
      "login.example.com",
    ]);
  });

  it("rejects raw or unknown secret fields instead of silently dropping them", () => {
    const payload = validPayload() as unknown as Record<string, unknown>;
    (payload.connections as Array<Record<string, unknown>>)[0].clientSecret =
      "raw-secret";
    expectCode(() => validateAuthProviderMetadata(payload), "unknown_field");
  });

  it("rejects a secret ARN outside the submitted stage/account/region prefix", () => {
    const payload = validPayload();
    payload.connections[0]!.clientSecretRef =
      "arn:aws:secretsmanager:us-west-2:999999999999:secret:other/path";
    expectCode(
      () => validateAuthProviderMetadata(payload),
      "secret_ref_scope_mismatch",
    );
  });

  it("rejects fingerprint drift after metadata is changed", () => {
    const payload = validPayload();
    payload.connections[0]!.displayName = "Changed after signing";
    expectCode(
      () => validateAuthProviderMetadata(payload),
      "manifest_fingerprint_mismatch",
    );
  });

  it("rejects duplicate connections and route identities", () => {
    const payload = validPayload();
    payload.connections.push({ ...payload.connections[0]! });
    const { manifestFingerprint: _old, ...input } = payload;
    payload.manifestFingerprint = canonicalAuthManifestFingerprint(input);
    expectCode(
      () => validateAuthProviderMetadata(payload),
      "duplicate_resource",
    );
  });
});
