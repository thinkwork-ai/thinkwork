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
        issuerUrl:
          "https://login.microsoftonline.com/9d65869f-0798-433d-b4e6-8c20d113dfbc/v2.0",
        clientId: "microsoft-client-id",
        clientSecretRef:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:thinkwork/dev/auth/microsoft-organizations-AbCd",
        resourceArn:
          "arn:aws:cognito-idp:us-east-1:123456789012:identity-provider/us-east-1_Example123/MicrosoftOrganizations",
        authorizeScopes: "openid email profile",
        tenantBindings: [],
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
    expect(result.connections[0]?.tenantBindings).toEqual([]);
    expect(result.connections[0]?.issuerUrl).toBe(
      "https://login.microsoftonline.com/9d65869f-0798-433d-b4e6-8c20d113dfbc/v2.0",
    );
  });

  it("requires a tenant Entra connection to bind exactly one tenant and match its issuer", () => {
    const payload = validPayload();
    const directoryId = "9d65869f-0798-433d-b4e6-8c20d113dfbc";
    payload.connections[0] = {
      ...payload.connections[0]!,
      connectionKey: `microsoft:tenant:${directoryId}`,
      providerKind: "microsoft_tenant",
      cognitoIdentityProviderName: "Entra_9d65869f0798433d_1a2b3c4d",
      tenantBindings: [
        {
          tenantId: "12345678-1234-4123-8123-123456789abc",
          label: "Example Health",
          hostnames: ["login.example.com"],
          status: "enabled",
        },
      ],
    };
    payload.routeClients[0] = {
      ...payload.routeClients[0]!,
      routeKey: `entra-${directoryId.replaceAll("-", "")}`,
      providerNames: ["Entra_9d65869f0798433d_1a2b3c4d"],
    };
    const { manifestFingerprint: _old, ...input } = payload;
    payload.manifestFingerprint = canonicalAuthManifestFingerprint(input);
    expect(validateAuthProviderMetadata(payload).connections[0]).toMatchObject({
      providerKind: "microsoft_tenant",
      connectionKey: `microsoft:tenant:${directoryId}`,
    });

    payload.connections[0]!.tenantBindings = [];
    const { manifestFingerprint: _old2, ...badInput } = payload;
    payload.manifestFingerprint = canonicalAuthManifestFingerprint(badInput);
    expectCode(
      () => validateAuthProviderMetadata(payload),
      "invalid_microsoft_scope",
    );
  });

  it.each(["organizations", "common", "consumers"])(
    "rejects the Microsoft %s issuer alias because Cognito requires an exact tenant issuer",
    (alias) => {
      const payload = validPayload();
      payload.connections[0]!.issuerUrl = `https://login.microsoftonline.com/${alias}/v2.0`;
      const { manifestFingerprint: _old, ...input } = payload;
      payload.manifestFingerprint = canonicalAuthManifestFingerprint(input);
      expectCode(
        () => validateAuthProviderMetadata(payload),
        "invalid_microsoft_issuer",
      );
    },
  );

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

  it("accepts native-app schemes only for mobile or desktop clients", () => {
    const mobile = validPayload();
    mobile.routeClients[0] = {
      ...mobile.routeClients[0]!,
      clientFamily: "mobile",
      redirectUris: ["thinkwork://auth/callback"],
      logoutUris: ["thinkwork://"],
    };
    const { manifestFingerprint: _mobileOld, ...mobileInput } = mobile;
    mobile.manifestFingerprint = canonicalAuthManifestFingerprint(mobileInput);
    expect(
      validateAuthProviderMetadata(mobile).routeClients[0]?.redirectUris,
    ).toEqual(["thinkwork://auth/callback"]);

    const web = validPayload();
    web.routeClients[0]!.redirectUris = ["javascript:alert(1)"];
    const { manifestFingerprint: _webOld, ...webInput } = web;
    web.manifestFingerprint = canonicalAuthManifestFingerprint(webInput);
    expectCode(() => validateAuthProviderMetadata(web), "invalid_url");
  });
});
