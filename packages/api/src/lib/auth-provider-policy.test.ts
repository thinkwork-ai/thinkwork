import { describe, expect, it } from "vitest";
import {
  resolveNativeAuthPolicy,
  type AuthPolicyConnectionRecord,
  type AuthPolicyRouteRecord,
} from "./auth-provider-policy.js";

const routes: AuthPolicyRouteRecord[] = [
  route("local", "local-client", ["COGNITO"]),
  route("google", "google-client", ["Google"]),
  route("microsoft", "microsoft-client", ["MicrosoftOrganizations"]),
  route("entra-acme", "entra-client", ["Entra_0000000000004000_abcd1234"]),
];

const connections: AuthPolicyConnectionRecord[] = [
  connection("google", "google", "Google", "google-client"),
  connection(
    "microsoft:organizations",
    "microsoft_organizations",
    "MicrosoftOrganizations",
    "microsoft-client",
  ),
];

describe("resolveNativeAuthPolicy", () => {
  it("returns password, Google, and general Microsoft for the deployment policy", () => {
    expect(
      resolveNativeAuthPolicy({
        scope: "deployment",
        localPasswordEnabled: true,
        routes,
        connections,
      }),
    ).toEqual({
      password: { enabled: true, clientId: "local-client" },
      oauthOptions: [
        expect.objectContaining({
          key: "google",
          label: "Continue with Google",
          provider: "google",
          route: expect.objectContaining({ clientId: "google-client" }),
        }),
        expect.objectContaining({
          key: "microsoft",
          label: "Continue with Microsoft",
          provider: "microsoft",
          route: expect.objectContaining({ clientId: "microsoft-client" }),
        }),
      ],
    });
  });

  it("replaces general Microsoft with the tenant Entra route", () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const tenantConnections = [
      {
        ...connections[0],
        tenantId,
        tenantReferenceStatus: "enabled",
      },
      {
        ...connection(
          "microsoft:tenant:acme",
          "microsoft_tenant",
          "Entra_0000000000004000_abcd1234",
          "entra-client",
        ),
        displayName: "Acme",
        publicOptionLabel: "Continue with Microsoft",
        tenantId,
        tenantReferenceStatus: "enabled",
      },
    ];

    const result = resolveNativeAuthPolicy({
      scope: "tenant",
      tenantId,
      localPasswordEnabled: true,
      routes,
      connections: tenantConnections,
    });

    expect(result.oauthOptions.map((option) => option.provider)).toEqual([
      "google",
      "entra",
    ]);
    expect(JSON.stringify(result)).not.toContain(tenantId);
    expect(JSON.stringify(result)).not.toContain("microsoft:tenant");
  });

  it("keeps global Google available on a tenant host without a tenant reference", () => {
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const entra = {
      ...connection(
        "microsoft:tenant:acme",
        "microsoft_tenant",
        "Entra_0000000000004000_abcd1234",
        "entra-client",
      ),
      tenantId,
      tenantReferenceStatus: "enabled",
    };

    expect(
      resolveNativeAuthPolicy({
        scope: "tenant",
        tenantId,
        localPasswordEnabled: true,
        routes,
        connections: [connections[0], connections[1], entra],
      }).oauthOptions.map((option) => option.provider),
    ).toEqual(["google", "entra"]);
  });

  it("keeps password independent and omits invalid or detached routes", () => {
    const result = resolveNativeAuthPolicy({
      scope: "deployment",
      localPasswordEnabled: false,
      routes,
      connections: [
        { ...connections[0], validationStatus: "invalid" },
        { ...connections[1], cognitoAppClientIds: ["other-client"] },
      ],
    });

    expect(result).toEqual({
      password: { enabled: false, clientId: "local-client" },
      oauthOptions: [],
    });
  });

  it("fails closed for an ambiguous host policy", () => {
    expect(
      resolveNativeAuthPolicy({
        scope: "ambiguous",
        localPasswordEnabled: true,
        routes,
        connections,
      }),
    ).toEqual({ password: { enabled: false }, oauthOptions: [] });
  });
});

function route(
  routeKey: string,
  cognitoAppClientId: string,
  providerNames: string[],
): AuthPolicyRouteRecord {
  return {
    routeKey,
    clientFamily: "web",
    cognitoAppClientId,
    providerNames,
    lifecycleState: "native",
    validationStatus: "valid",
  };
}

function connection(
  connectionKey: string,
  providerKind: string,
  cognitoIdentityProviderName: string,
  clientId: string,
): AuthPolicyConnectionRecord {
  return {
    resourceId: `resource-${providerKind}`,
    connectionKey,
    providerKind,
    displayName: providerKind,
    cognitoIdentityProviderName,
    cognitoAppClientIds: [clientId],
    lifecycleState: "native",
    validationStatus: "valid",
    publicOptionsPublished: true,
  };
}
