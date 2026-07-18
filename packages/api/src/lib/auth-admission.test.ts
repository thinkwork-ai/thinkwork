import { describe, expect, it } from "vitest";

import {
  AuthAdmissionError,
  evaluateRouteAdmission,
  evaluateTenantAdmission,
  type CognitoRouteProvenance,
  type IdentityAdmissionCandidate,
  type RouteAdmissionCandidate,
} from "./auth-admission.js";

const googleRoute = route({
  routeKey: "google",
  providerKind: "google",
  identityProviderName: "Google",
  connectionKey: "google",
});

describe("Cognito route provenance", () => {
  it("admits exactly one validated provider-only app client", () => {
    expect(evaluateRouteAdmission([googleRoute])).toEqual(
      expect.objectContaining({
        appClientId: "client-google",
        connectionId: "connection-google",
        providerKind: "google",
      }),
    );
  });

  it("rejects unknown, denied, detached, and ambiguous clients", () => {
    expectAdmissionCode(() => evaluateRouteAdmission([]), "unknown_client");
    expectAdmissionCode(
      () =>
        evaluateRouteAdmission([
          { ...googleRoute, routeLifecycleState: "denied" },
        ]),
      "unknown_client",
    );
    expectAdmissionCode(
      () =>
        evaluateRouteAdmission([
          { ...googleRoute, connectionAppClientIds: ["some-other-client"] },
        ]),
      "unknown_client",
    );
    expectAdmissionCode(
      () => evaluateRouteAdmission([googleRoute, { ...googleRoute }]),
      "ambiguous_client",
    );
  });
});

describe("tenant admission", () => {
  it("requires exact active identity, membership, and active policy", () => {
    const route = evaluateRouteAdmission([googleRoute]);
    expect(
      evaluateTenantAdmission({
        route,
        identities: [identity(route)],
        memberships: [membership("tenant-a")],
        policies: [policy("tenant-a")],
        references: [],
        requestedTenantId: "tenant-a",
      }),
    ).toEqual(
      expect.objectContaining({
        userId: "user-1",
        tenantId: "tenant-a",
        identityId: "identity-1",
      }),
    );
  });

  it("never resolves an email-only or different-connection identity", () => {
    const route = evaluateRouteAdmission([googleRoute]);
    expectAdmissionCode(
      () =>
        evaluateTenantAdmission({
          route,
          identities: [],
          memberships: [membership("tenant-a")],
          policies: [policy("tenant-a")],
          references: [],
        }),
      "identity_not_bound",
    );
    expectAdmissionCode(
      () =>
        evaluateTenantAdmission({
          route,
          identities: [
            { ...identity(route), authProviderResourceId: "connection-other" },
          ],
          memberships: [membership("tenant-a")],
          policies: [policy("tenant-a")],
          references: [],
        }),
      "identity_not_bound",
    );
  });

  it("requires explicit tenant selection when several memberships allow a route", () => {
    const route = evaluateRouteAdmission([googleRoute]);
    expectAdmissionCode(
      () =>
        evaluateTenantAdmission({
          route,
          identities: [identity(route)],
          memberships: [membership("tenant-a"), membership("tenant-b")],
          policies: [policy("tenant-a"), policy("tenant-b")],
          references: [],
        }),
      "tenant_selection_required",
    );
    expect(
      evaluateTenantAdmission({
        route,
        identities: [identity(route)],
        memberships: [membership("tenant-a"), membership("tenant-b")],
        policies: [policy("tenant-a"), policy("tenant-b")],
        references: [],
        requestedTenantId: "tenant-b",
      }).tenantId,
    ).toBe("tenant-b");
  });

  it("lets tenant Entra enter only its bound tenant", () => {
    const route = evaluateRouteAdmission([
      routeCandidate({
        routeKey: "entra-acme",
        providerKind: "microsoft_tenant",
        identityProviderName: "Entra_0000000000004000_deadbeef",
        connectionKey: "microsoft:tenant:00000000-0000-4000-8000-000000000123",
      }),
    ]);
    const reference = {
      tenantId: "tenant-a",
      connectionId: route.connectionId,
      providerKind: "microsoft_tenant",
      status: "enabled",
      lifecycleState: "native",
      validationStatus: "valid",
    };
    expect(
      evaluateTenantAdmission({
        route,
        identities: [identity(route)],
        memberships: [membership("tenant-a"), membership("tenant-b")],
        policies: [policy("tenant-a"), policy("tenant-b")],
        references: [reference],
        requestedTenantId: "tenant-a",
      }).tenantId,
    ).toBe("tenant-a");
    expectAdmissionCode(
      () =>
        evaluateTenantAdmission({
          route,
          identities: [identity(route)],
          memberships: [membership("tenant-a"), membership("tenant-b")],
          policies: [policy("tenant-a"), policy("tenant-b")],
          references: [reference],
          requestedTenantId: "tenant-b",
        }),
      "tenant_not_admitted",
    );
  });

  it("replaces general Microsoft with tenant Entra for admission too", () => {
    const route = evaluateRouteAdmission([
      routeCandidate({
        routeKey: "microsoft",
        providerKind: "microsoft_organizations",
        identityProviderName: "MicrosoftOrganizations",
        connectionKey: "microsoft:organizations",
      }),
    ]);
    expectAdmissionCode(
      () =>
        evaluateTenantAdmission({
          route,
          identities: [identity(route)],
          memberships: [membership("tenant-a")],
          policies: [policy("tenant-a")],
          references: [
            {
              tenantId: "tenant-a",
              connectionId: "connection-entra-acme",
              providerKind: "microsoft_tenant",
              status: "enabled",
              lifecycleState: "native",
              validationStatus: "valid",
            },
          ],
          requestedTenantId: "tenant-a",
        }),
      "tenant_not_admitted",
    );
  });
});

function route(
  overrides: Pick<
    RouteAdmissionCandidate,
    "routeKey" | "providerKind" | "identityProviderName" | "connectionKey"
  >,
): RouteAdmissionCandidate {
  return routeCandidate(overrides);
}

function routeCandidate(
  overrides: Pick<
    RouteAdmissionCandidate,
    "routeKey" | "providerKind" | "identityProviderName" | "connectionKey"
  >,
): RouteAdmissionCandidate {
  return {
    routeClientId: `route-${overrides.routeKey}`,
    routeKey: overrides.routeKey,
    clientFamily: "web",
    appClientId: `client-${overrides.routeKey}`,
    routeLifecycleState: "native",
    routeValidationStatus: "valid",
    providerNames: [overrides.identityProviderName],
    connectionId: `connection-${overrides.routeKey}`,
    connectionKey: overrides.connectionKey,
    providerKind: overrides.providerKind,
    identityProviderName: overrides.identityProviderName,
    providerIssuer: null,
    connectionLifecycleState: "native",
    connectionValidationStatus: "valid",
    connectionAppClientIds: [`client-${overrides.routeKey}`],
  };
}

function identity(route: CognitoRouteProvenance): IdentityAdmissionCandidate {
  return {
    identityId: "identity-1",
    userId: "user-1",
    identityTenantId: "tenant-a",
    authProviderResourceId: route.connectionId,
    status: "active",
  };
}

function membership(tenantId: string) {
  return { tenantId, role: "member", status: "active" };
}

function policy(tenantId: string) {
  return { tenantId, status: "active", localPasswordEnabled: true };
}

function expectAdmissionCode(fn: () => unknown, code: string): void {
  try {
    fn();
    throw new Error("Expected admission to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AuthAdmissionError);
    expect((error as AuthAdmissionError).code).toBe(code);
  }
}
