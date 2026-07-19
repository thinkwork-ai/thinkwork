import { describe, expect, it, vi } from "vitest";

import {
  AuthAdmissionError,
  admitCognitoTenant,
  discoverCognitoTenantAdmissions,
  evaluateRollbackRouteAdmission,
  evaluateRouteAdmission,
  evaluateTenantAdmission,
  resolveCognitoRouteProvenance,
  type CognitoRouteProvenance,
  type IdentityAdmissionCandidate,
  type RouteAdmissionCandidate,
  type AuthAdmissionRepository,
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
          { ...googleRoute, connectionValidationStatus: "partially_valid" },
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

  it("admits the legacy WorkOS client only while its bounded route is in coexistence", () => {
    const rollback = rollbackRoute();
    expect(evaluateRollbackRouteAdmission([rollback])).toMatchObject({
      lifecycleState: "coexistence",
      providerKind: "legacy_workos",
      appClientId: "client-workos",
    });
    expectAdmissionCode(
      () =>
        evaluateRollbackRouteAdmission([
          { ...rollback, routeLifecycleState: "denied" },
        ]),
      "unknown_client",
    );
    expectAdmissionCode(
      () =>
        evaluateRollbackRouteAdmission([
          { ...rollback, connectionLifecycleState: "native" },
        ]),
      "unknown_client",
    );
  });

  it("does not bypass an explicit denied route with the provider fallback", async () => {
    const repository = rollbackRepository([]);
    vi.mocked(repository.loadRouteCandidates).mockResolvedValue([
      { ...rollbackRoute(), routeLifecycleState: "denied" },
    ]);

    await expect(
      resolveCognitoRouteProvenance(
        { userPoolId: "pool-1", appClientId: "client-workos" },
        repository,
      ),
    ).rejects.toMatchObject({ code: "unknown_client" });
    expect(repository.loadRollbackRouteCandidates).not.toHaveBeenCalled();
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

describe("tenant discovery", () => {
  it("returns every route-compatible membership without choosing one", async () => {
    const route = evaluateRouteAdmission([googleRoute]);
    const repository: AuthAdmissionRepository = {
      loadRouteCandidates: async () => [],
      loadRollbackRouteCandidates: async () => [],
      loadIdentityCandidates: async () => [identity(route)],
      loadMemberships: async () => [
        membership("tenant-a"),
        membership("tenant-b"),
        membership("tenant-disabled"),
      ],
      loadTenantPolicies: async () => [
        policy("tenant-a"),
        policy("tenant-b"),
        { ...policy("tenant-disabled"), status: "disabled" },
      ],
      loadTenantConnectionReferences: async () => [],
      loadRollbackSessionCandidates: async () => [],
    };

    await expect(
      discoverCognitoTenantAdmissions(
        {
          authType: "cognito",
          principalId: "cognito-sub",
          cognitoIssuer: "https://issuer.example",
          route,
          tenantId: null,
          email: "member@example.com",
          emailVerified: true,
          agentId: null,
        },
        repository,
      ),
    ).resolves.toMatchObject({
      userId: "user-1",
      tenants: [
        { tenantId: "tenant-a", role: "member" },
        { tenantId: "tenant-b", role: "member" },
      ],
    });
  });
});

describe("WorkOS rollback tenant admission", () => {
  const route = evaluateRollbackRouteAdmission([rollbackRoute()]);
  const auth = {
    authType: "cognito" as const,
    principalId: "cognito-sub",
    cognitoIssuer: "https://issuer.example",
    route,
    tenantId: null,
    email: "changed@example.com",
    emailVerified: true,
    agentId: null,
  };

  it("admits only an exact active session with active membership", async () => {
    const repository = rollbackRepository([
      rollbackSession(),
      { ...rollbackSession(), sessionId: "session-2" },
    ]);
    await expect(
      admitCognitoTenant(auth, "tenant-a", repository),
    ).resolves.toMatchObject({
      userId: "user-1",
      tenantId: "tenant-a",
      role: "member",
      route: { lifecycleState: "coexistence" },
    });
    expect(repository.loadIdentityCandidates).not.toHaveBeenCalled();
    expect(repository.loadRollbackSessionCandidates).toHaveBeenCalledWith(
      "cognito-sub",
      "connection-workos",
      "tenant-a",
    );
  });

  it("resolves the legacy client fallback and admits its exact session end to end", async () => {
    const repository = rollbackRepository([rollbackSession()]);
    const resolvedRoute = await resolveCognitoRouteProvenance(
      { userPoolId: "pool-1", appClientId: "client-workos" },
      repository,
    );

    await expect(
      admitCognitoTenant(
        { ...auth, route: resolvedRoute },
        "tenant-a",
        repository,
      ),
    ).resolves.toMatchObject({
      userId: "user-1",
      tenantId: "tenant-a",
      route: { providerKind: "legacy_workos", lifecycleState: "coexistence" },
    });
  });

  it("rejects inactive membership, expired sessions, and wrong subjects", async () => {
    for (const sessions of [
      [{ ...rollbackSession(), membershipStatus: "inactive" }],
      [{ ...rollbackSession(), referenceStatus: "disabled" }],
      [{ ...rollbackSession(), expiresAt: new Date("2020-01-01") }],
      [],
    ]) {
      await expect(
        admitCognitoTenant(auth, "tenant-a", rollbackRepository(sessions)),
      ).rejects.toMatchObject({ code: "tenant_not_admitted" });
    }
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

function rollbackRoute(): RouteAdmissionCandidate {
  return {
    ...routeCandidate({
      routeKey: "workos",
      providerKind: "legacy_workos",
      identityProviderName: "WORKOS",
      connectionKey: "workos",
    }),
    appClientId: "client-workos",
    routeLifecycleState: "coexistence",
    connectionLifecycleState: "coexistence",
    connectionAppClientIds: ["client-workos"],
  };
}

function rollbackSession() {
  return {
    sessionId: "session-1",
    userId: "user-1",
    tenantId: "tenant-a",
    role: "member",
    sessionStatus: "active",
    membershipStatus: "active",
    referenceStatus: "enabled",
    expiresAt: new Date("2099-01-01"),
  };
}

function rollbackRepository(
  sessions: ReturnType<typeof rollbackSession>[],
): AuthAdmissionRepository {
  return {
    loadRouteCandidates: vi.fn(async () => []),
    loadRollbackRouteCandidates: vi.fn(async () => [rollbackRoute()]),
    loadIdentityCandidates: vi.fn(async () => []),
    loadMemberships: vi.fn(async () => []),
    loadTenantPolicies: vi.fn(async () => []),
    loadTenantConnectionReferences: vi.fn(async () => []),
    loadRollbackSessionCandidates: vi.fn(async () => sessions),
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
