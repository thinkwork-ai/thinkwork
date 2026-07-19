import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const {
  inserts,
  mockAdmitCognitoTenant,
  mockAuthenticate,
  routeRows,
  routeRowQueue,
  selectQueue,
  selectWheres,
  updates,
} = vi.hoisted(() => ({
  inserts: [] as unknown[],
  mockAdmitCognitoTenant: vi.fn(),
  mockAuthenticate: vi.fn(),
  routeRows: [] as Array<{
    route_client_id: string;
    route_key: string;
    connection_id: string;
  }>,
  routeRowQueue: [] as Array<
    Array<{
      route_client_id: string;
      route_key: string;
      connection_id: string;
    }>
  >,
  selectQueue: [] as unknown[][],
  selectWheres: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock("@thinkwork/database-pg/schema", () => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries(
      columns.map((column) => [column, { name: `${name}.${column}` }]),
    );
  return {
    authIdentityEnrollments: table("enrollments", [
      "id",
      "tenant_id",
      "recipient_grant_kind",
      "recipient_grant_id",
      "nonce_digest",
      "recipient_challenge_digest",
      "auth_route_client_id",
      "failed_attempts",
      "status",
    ]),
    authSubscriptionInvalidations: table("invalidations", ["id"]),
    tenantMembers: table("members", [
      "id",
      "tenant_id",
      "principal_type",
      "principal_id",
      "status",
    ]),
    tenants: table("tenants", ["id"]),
    userAuthIdentities: table("identities", [
      "id",
      "user_id",
      "tenant_id",
      "auth_provider_resource_id",
      "cognito_issuer",
      "cognito_sub",
      "provider_issuer",
      "provider_subject",
      "status",
      "proof_kind",
      "evidence",
      "activated_at",
      "quarantined_at",
      "updated_at",
    ]),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  inArray: (left: unknown, right: unknown[]) => ({ inArray: [left, right] }),
  ne: (left: unknown, right: unknown) => ({ ne: [left, right] }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("../lib/db.js", () => {
  const selectResult = () => {
    const result = Promise.resolve(selectQueue.shift() ?? []);
    return Object.assign(result, {
      for: () => result,
      limit: () => result,
      orderBy: () => result,
    });
  };
  const tx = {
    execute: () =>
      Promise.resolve({ rows: routeRowQueue.shift() ?? routeRows }),
    select: () => ({
      from: () => ({
        where: (where: unknown) => {
          selectWheres.push(where);
          return selectResult();
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (where: unknown) => {
          updates.push({ table, values, where });
          return Promise.resolve();
        },
      }),
    }),
  };
  return {
    db: {
      execute: () =>
        Promise.resolve({ rows: routeRowQueue.shift() ?? routeRows }),
      transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
    },
  };
});

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: mockAuthenticate }));
vi.mock("../lib/auth-admission.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/auth-admission.js")>();
  return { ...actual, admitCognitoTenant: mockAdmitCognitoTenant };
});
vi.mock("../lib/auth.js", () => ({
  extractBearerToken: (event: APIGatewayProxyEventV2) =>
    event.headers.authorization?.replace(/^Bearer /, "") ?? null,
  validateApiSecret: (token: string) => token === "api-secret",
}));

import {
  consumeEnrollment,
  enrollmentDigest,
  handler,
  issueEnrollmentGrants,
  issueIdentityRecoveryGrant,
  issueSessionMigrationGrant,
} from "./auth-enrollment.js";
import type { AuthResult } from "../lib/cognito-auth.js";

const auth = {
  authType: "cognito" as const,
  principalId: "cognito-sub-1",
  cognitoIssuer: "https://cognito.example/pool",
  tenantId: null,
  email: "invitee@example.com",
  emailVerified: true,
  agentId: null,
  route: {
    routeClientId: "route-client-1",
    routeKey: "google-web",
    clientFamily: "web",
    appClientId: "app-client-1",
    connectionId: "connection-1",
    connectionKey: "google",
    providerKind: "google",
    providerIssuer: "https://accounts.google.com",
    lifecycleState: "native",
  },
} satisfies AuthResult;

function enrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: "enrollment-1",
    tenant_id: "tenant-1",
    intended_user_id: "user-1",
    recipient_grant_id: "member-1",
    recipient_grant_kind: "membership",
    auth_provider_resource_id: "connection-1",
    auth_route_client_id: "route-client-1",
    redirect_uri: "https://app.example.com/auth/callback",
    nonce_digest: enrollmentDigest("start-token", "route-client-1"),
    recipient_challenge_digest: enrollmentDigest("654321", "route-client-1"),
    failed_attempts: 0,
    status: "pending",
    expires_at: new Date("2026-07-19T00:00:00Z"),
    ...overrides,
  };
}

describe("identity enrollment", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MIGRATION_RECOVERY_DEADLINE", "2099-01-01T00:00:00Z");
    inserts.length = 0;
    routeRows.length = 0;
    routeRowQueue.length = 0;
    selectQueue.length = 0;
    selectWheres.length = 0;
    updates.length = 0;
    mockAdmitCognitoTenant.mockReset();
    mockAuthenticate.mockReset();
    mockAdmitCognitoTenant.mockResolvedValue({
      userId: "user-1",
      tenantId: "tenant-1",
      role: "member",
      identityId: "legacy-identity-1",
      route: {},
    });
  });

  it("issues the same challenge for mobile routes with their exact redirect", async () => {
    routeRowQueue.push(
      [
        {
          route_client_id: "route-google-web",
          route_key: "google-web",
          connection_id: "connection-google",
        },
      ],
      [
        {
          route_client_id: "route-google-mobile",
          route_key: "google-mobile",
          connection_id: "connection-google",
        },
      ],
    );
    const issued = await issueEnrollmentGrants({
      tenantId: "tenant-1",
      intendedUserId: "user-1",
      membershipId: "member-1",
      redirectUri: "https://app.example.com/auth/callback",
      additionalRoutes: [
        {
          clientFamily: "mobile",
          redirectUri: "thinkwork://auth/callback",
        },
      ],
    });
    expect(issued.routeKeys).toEqual(["google-web", "google-mobile"]);
    expect(inserts[0]).toMatchObject({
      values: [
        expect.objectContaining({
          auth_route_client_id: "route-google-web",
          redirect_uri: "https://app.example.com/auth/callback",
        }),
        expect.objectContaining({
          auth_route_client_id: "route-google-mobile",
          redirect_uri: "thinkwork://auth/callback",
        }),
      ],
    });
  });

  it("domain-separates the same bearer secret by route", () => {
    expect(enrollmentDigest("secret", "route-a")).not.toBe(
      enrollmentDigest("secret", "route-b"),
    );
  });

  it("issues one short-lived grant bound independently to every admitted route", async () => {
    routeRows.push(
      {
        route_client_id: "route-google",
        route_key: "google-web",
        connection_id: "connection-google",
      },
      {
        route_client_id: "route-microsoft",
        route_key: "microsoft-web",
        connection_id: "connection-microsoft",
      },
    );
    const issued = await issueEnrollmentGrants({
      tenantId: "tenant-1",
      intendedUserId: "user-1",
      membershipId: "member-1",
      redirectUri: "https://app.example.com/auth/callback",
      now: new Date("2026-07-18T00:00:00Z"),
    });
    expect(issued.startToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(issued.recipientChallenge).toMatch(/^\d{8}$/);
    expect(issued.routeKeys).toEqual(["google-web", "microsoft-web"]);
    expect(inserts[0]).toMatchObject({
      values: [
        expect.objectContaining({
          auth_route_client_id: "route-google",
          auth_provider_resource_id: "connection-google",
          status: "pending",
        }),
        expect.objectContaining({
          auth_route_client_id: "route-microsoft",
          auth_provider_resource_id: "connection-microsoft",
          status: "pending",
        }),
      ],
    });
  });

  it("marks first-owner grants distinctly from ordinary memberships", async () => {
    routeRows.push({
      route_client_id: "route-google",
      route_key: "google-web",
      connection_id: "connection-google",
    });
    await issueEnrollmentGrants({
      tenantId: "tenant-1",
      intendedUserId: "user-1",
      membershipId: "member-1",
      grantKind: "pending_owner",
      redirectUri: "https://app.example.com/auth/callback",
    });
    expect(inserts[0]).toMatchObject({
      values: [
        expect.objectContaining({
          recipient_grant_kind: "pending_owner",
          recipient_grant_id: "member-1",
        }),
      ],
    });
  });

  it("issues recovery for an active member with a quarantined identity", async () => {
    selectQueue.push(
      [{ id: "member-1" }],
      [{ id: "quarantined-identity-1", status: "quarantined" }],
    );
    routeRows.push({
      route_client_id: "route-google",
      route_key: "google-web",
      connection_id: "connection-google",
    });

    const issued = await issueIdentityRecoveryGrant({
      tenantId: "tenant-1",
      userId: "user-1",
      redirectUri: "https://app.example.com/auth/callback",
    });

    expect(issued.routeKeys).toEqual(["google-web"]);
    expect(inserts[0]).toMatchObject({
      values: [
        expect.objectContaining({
          intended_user_id: "user-1",
          recipient_grant_kind: "identity_recovery",
          recipient_grant_id: "member-1",
        }),
      ],
    });
  });

  it("issues recovery for an active member with an existing active identity so another provider can be linked", async () => {
    selectQueue.push(
      [{ id: "member-1" }],
      [{ id: "microsoft-identity-1", status: "active" }],
    );
    routeRows.push(
      {
        route_client_id: "route-google",
        route_key: "google-web",
        connection_id: "connection-google",
      },
      {
        route_client_id: "route-microsoft",
        route_key: "microsoft-web",
        connection_id: "connection-microsoft",
      },
    );

    const issued = await issueIdentityRecoveryGrant({
      tenantId: "tenant-1",
      userId: "user-1",
      redirectUri: "https://app.example.com/auth/callback",
    });

    expect(issued.routeKeys).toEqual(["google-web", "microsoft-web"]);
    expect(JSON.stringify(selectWheres[1])).toContain("active");
    expect(inserts[0]).toMatchObject({
      values: expect.arrayContaining([
        expect.objectContaining({
          intended_user_id: "user-1",
          recipient_grant_kind: "identity_recovery",
          recipient_grant_id: "member-1",
        }),
      ]),
    });
  });

  it("refuses recovery when the intended user has no prior identity proof", async () => {
    selectQueue.push([{ id: "member-1" }], []);

    await expect(
      issueIdentityRecoveryGrant({
        tenantId: "tenant-1",
        userId: "user-1",
        redirectUri: "https://app.example.com/auth/callback",
      }),
    ).rejects.toMatchObject({ code: "recoverable_identity_not_found" });
    expect(inserts).toHaveLength(0);
  });

  it("issues a one-use native migration grant from an admitted legacy session", async () => {
    selectQueue.push([{ id: "member-1" }]);
    routeRows.push({
      route_client_id: "route-google",
      route_key: "google-web",
      connection_id: "connection-google",
    });
    const legacyAuth: AuthResult = {
      ...auth,
      tenantId: "tenant-1",
      route: {
        ...auth.route,
        providerKind: "legacy_workos",
        lifecycleState: "coexistence",
      },
    };

    const issued = await issueSessionMigrationGrant(legacyAuth, {
      redirectUri: "https://app.example.com/auth/callback",
    });

    expect(mockAdmitCognitoTenant).toHaveBeenCalledWith(legacyAuth, "tenant-1");
    expect(issued.routeKeys).toEqual(["google-web"]);
    expect(inserts[0]).toMatchObject({
      values: [
        expect.objectContaining({
          intended_user_id: "user-1",
          recipient_grant_kind: "session_migration",
          recipient_grant_id: "member-1",
        }),
      ],
    });
  });

  it("refuses to issue a migration grant from an already-native session", async () => {
    await expect(
      issueSessionMigrationGrant(auth, {
        redirectUri: "https://app.example.com/auth/callback",
      }),
    ).rejects.toMatchObject({ code: "legacy_session_required" });
    expect(mockAdmitCognitoTenant).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("refuses a legacy-session migration grant after the recovery deadline", async () => {
    vi.stubEnv("AUTH_MIGRATION_RECOVERY_DEADLINE", "2026-07-18T00:00:00Z");
    const legacyAuth: AuthResult = {
      ...auth,
      tenantId: "tenant-1",
      route: {
        ...auth.route,
        providerKind: "legacy_workos",
        lifecycleState: "coexistence",
      },
    };

    await expect(
      issueSessionMigrationGrant(
        legacyAuth,
        { redirectUri: "https://app.example.com/auth/callback" },
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).rejects.toMatchObject({ code: "migration_deadline_elapsed" });
    expect(mockAdmitCognitoTenant).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("serves the session migration endpoint only from the authenticated legacy route", async () => {
    const legacyAuth: AuthResult = {
      ...auth,
      tenantId: "tenant-1",
      route: {
        ...auth.route,
        providerKind: "legacy_workos",
        lifecycleState: "coexistence",
      },
    };
    mockAuthenticate.mockResolvedValue(legacyAuth);
    selectQueue.push([{ id: "member-1" }]);
    routeRows.push({
      route_client_id: "route-google",
      route_key: "google-web",
      connection_id: "connection-google",
    });

    const response = await handler(migrationEvent());

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      recipientChallenge: expect.stringMatching(/^\d{8}$/),
      routeKeys: ["google-web"],
    });
  });

  it("requires service authentication before issuing a recovery grant", async () => {
    const response = await handler(recoveryEvent("wrong-secret"));

    expect(response.statusCode).toBe(401);
    expect(inserts).toHaveLength(0);
  });

  it("serves the operator recovery endpoint without accepting a Cognito subject", async () => {
    selectQueue.push([{ id: "member-1" }], [{ id: "quarantined-identity-1" }]);
    routeRows.push({
      route_client_id: "route-google",
      route_key: "google-web",
      connection_id: "connection-google",
    });

    const response = await handler(recoveryEvent("api-secret"));

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? "{}")).toMatchObject({
      recipientChallenge: expect.stringMatching(/^\d{8}$/),
      routeKeys: ["google-web"],
    });
  });

  it("atomically binds the exact Cognito route and activates the intended grant", async () => {
    const grant = enrollment();
    selectQueue.push(
      [grant],
      [grant],
      [{ id: "member-1", status: "pending" }],
      [],
    );
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("consumed");
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toEqual(
      expect.objectContaining({
        values: expect.objectContaining({
          tenant_id: "tenant-1",
          user_id: "user-1",
          cognito_sub: "cognito-sub-1",
          auth_provider_resource_id: "connection-1",
          status: "active",
        }),
      }),
    );
    expect(updates).toHaveLength(3);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: { status: "revoked", updated_at: expect.any(Date) },
        }),
      ]),
    );
  });

  it("burns sibling routes so one recovery proof cannot bind twice", async () => {
    const webGrant = enrollment();
    const mobileGrant = enrollment({
      id: "enrollment-2",
      auth_route_client_id: "route-client-2",
      recipient_challenge_digest: enrollmentDigest("654321", "route-client-2"),
    });
    selectQueue.push(
      [webGrant],
      [webGrant, mobileGrant],
      [{ id: "member-1", status: "pending" }],
      [],
    );
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("consumed");

    const insertCountAfterFirstUse = inserts.length;
    const updateCountAfterFirstUse = updates.length;
    const mobileAuth: AuthResult = {
      ...auth,
      route: {
        ...auth.route,
        routeClientId: "route-client-2",
        routeKey: "google-mobile",
        clientFamily: "mobile",
      },
    };
    selectQueue.push([{ ...mobileGrant, status: "revoked" }]);
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        mobileAuth,
        new Date("2026-07-18T00:01:00Z"),
      ),
    ).resolves.toBe("expired");
    expect(inserts).toHaveLength(insertCountAfterFirstUse);
    expect(updates).toHaveLength(updateCountAfterFirstUse);
  });

  it("binds a replacement identity for an existing active member without changing membership", async () => {
    const grant = enrollment({ recipient_grant_kind: "identity_recovery" });
    selectQueue.push(
      [grant],
      [grant],
      [{ id: "member-1", status: "active" }],
      [],
    );

    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("consumed");
    expect(inserts[0]).toMatchObject({
      values: expect.objectContaining({
        user_id: "user-1",
        status: "active",
        proof_kind: "recipient_challenge_recovery",
      }),
    });
    expect(
      updates.some(
        (update) =>
          (update as { values?: { status?: string } }).values?.status ===
          "active",
      ),
    ).toBe(false);
  });

  it("promotes the intended user's quarantined identity after exact recovery proof", async () => {
    const grant = enrollment({ recipient_grant_kind: "identity_recovery" });
    selectQueue.push(
      [grant],
      [grant],
      [{ id: "member-1", status: "active" }],
      [
        {
          id: "quarantined-identity-1",
          userId: "user-1",
          tenantId: "tenant-1",
          resourceId: null,
          status: "quarantined",
        },
      ],
    );

    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("consumed");

    expect(inserts).toHaveLength(1);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            auth_provider_resource_id: "connection-1",
            provider_subject: "cognito-sub-1",
            status: "active",
            proof_kind: "recipient_challenge_recovery",
            quarantined_at: null,
          }),
        }),
      ]),
    );
  });

  it("binds a native identity from a legacy-session migration without changing membership", async () => {
    const grant = enrollment({ recipient_grant_kind: "session_migration" });
    selectQueue.push(
      [grant],
      [grant],
      [{ id: "member-1", status: "active" }],
      [],
    );

    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("consumed");
    expect(inserts[0]).toMatchObject({
      values: expect.objectContaining({
        user_id: "user-1",
        status: "active",
        proof_kind: "workos_session_native_proof",
      }),
    });
    expect(
      updates.some(
        (update) =>
          (update as { values?: { status?: string } }).values?.status ===
          "active",
      ),
    ).toBe(false);
  });

  it("closes the first-admin gate only after exact pending-owner consumption", async () => {
    const grant = enrollment({ recipient_grant_kind: "pending_owner" });
    selectQueue.push(
      [grant],
      [grant],
      [{ id: "member-1", status: "pending" }],
      [],
    );
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("consumed");
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          values: expect.objectContaining({
            first_admin_claim_required: false,
            first_admin_claimed_user_id: "user-1",
          }),
        }),
      ]),
    );
  });

  it("does not link a verified-email federated subject without the recipient challenge", async () => {
    const grant = enrollment({ recipient_grant_kind: "identity_recovery" });
    selectQueue.push([grant], [grant]);
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "wrong",
          redirectUri: "https://app.example.com/auth/callback",
        },
        {
          ...auth,
          principalId: "new-google-cognito-sub",
          email: "existing-member@example.com",
          emailVerified: true,
        },
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("invalid_challenge");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({ failed_attempts: 1 }),
      }),
    ]);
  });

  it("expires a stale grant without creating an identity", async () => {
    const grant = enrollment({
      expires_at: new Date("2026-07-17T00:00:00Z"),
    });
    selectQueue.push([grant], [grant]);
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("expired");
    expect(inserts).toEqual([]);
    expect(updates).toHaveLength(1);
  });

  it("rejects a Cognito subject already bound to another user", async () => {
    const grant = enrollment();
    selectQueue.push(
      [grant],
      [grant],
      [{ id: "member-1", status: "pending" }],
      [
        {
          userId: "different-user",
          tenantId: "tenant-1",
          resourceId: "connection-1",
          status: "active",
        },
      ],
    );
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("identity_conflict");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it.each(["cancelled", "expired", "active"])(
    "does not reactivate a %s membership after invitation",
    async (membershipStatus) => {
      const grant = enrollment();
      selectQueue.push(
        [grant],
        [grant],
        [{ id: "member-1", status: membershipStatus }],
      );

      await expect(
        consumeEnrollment(
          {
            startToken: "start-token",
            recipientChallenge: "654321",
            redirectUri: "https://app.example.com/auth/callback",
          },
          auth,
          new Date("2026-07-18T00:00:00Z"),
        ),
      ).resolves.toBe("invalid_grant");
      expect(inserts).toEqual([]);
      expect(updates).toEqual([]);
    },
  );

  it("locks every route for a grant after the fifth failed challenge", async () => {
    const webGrant = enrollment({ failed_attempts: 4 });
    const mobileGrant = enrollment({
      id: "enrollment-2",
      auth_route_client_id: "route-client-2",
      failed_attempts: 4,
    });
    selectQueue.push([webGrant], [webGrant, mobileGrant]);
    const now = new Date("2026-07-18T00:00:00Z");

    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "wrong",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        now,
      ),
    ).resolves.toBe("invalid_challenge");
    expect(updates).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({
          failed_attempts: 5,
          locked_at: now,
          status: "revoked",
        }),
      }),
    ]);
  });

  it("does not retry a challenge-locked grant", async () => {
    selectQueue.push([
      enrollment({
        status: "revoked",
        failed_attempts: 5,
        locked_at: new Date("2026-07-18T00:00:00Z"),
      }),
    ]);

    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "654321",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:05:00Z"),
      ),
    ).resolves.toBe("expired");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it.each([
    ["revoked identity", { status: "revoked" }],
    ["quarantined identity", { status: "quarantined" }],
    ["identity on another route", { resourceId: "connection-2" }],
  ])(
    "rejects an existing %s instead of accepting it",
    async (_label, override) => {
      const grant = enrollment();
      selectQueue.push(
        [grant],
        [grant],
        [{ id: "member-1", status: "pending" }],
        [
          {
            userId: "user-1",
            tenantId: "tenant-1",
            resourceId: "connection-1",
            status: "active",
            ...override,
          },
        ],
      );

      await expect(
        consumeEnrollment(
          {
            startToken: "start-token",
            recipientChallenge: "654321",
            redirectUri: "https://app.example.com/auth/callback",
          },
          auth,
          new Date("2026-07-18T00:00:00Z"),
        ),
      ).resolves.toBe("identity_conflict");
      expect(inserts).toEqual([]);
      expect(updates).toEqual([]);
    },
  );
});

function recoveryEvent(token: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /api/auth/enrollment/recover",
    rawPath: "/api/auth/enrollment/recover",
    rawQueryString: "",
    headers: { authorization: `Bearer ${token}` },
    requestContext: {
      accountId: "account",
      apiId: "api",
      domainName: "api.example.com",
      domainPrefix: "api",
      http: {
        method: "POST",
        path: "/api/auth/enrollment/recover",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request",
      routeKey: "POST /api/auth/enrollment/recover",
      stage: "$default",
      time: "18/Jul/2026:00:00:00 +0000",
      timeEpoch: 1,
    },
    body: JSON.stringify({
      tenantId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      redirectUri: "https://app.example.com/auth/callback",
    }),
    isBase64Encoded: false,
  };
}

function migrationEvent(): APIGatewayProxyEventV2 {
  const event = recoveryEvent("legacy-session-token");
  return {
    ...event,
    routeKey: "POST /api/auth/enrollment/migrate",
    rawPath: "/api/auth/enrollment/migrate",
    requestContext: {
      ...event.requestContext,
      routeKey: "POST /api/auth/enrollment/migrate",
      http: {
        ...event.requestContext.http,
        path: "/api/auth/enrollment/migrate",
      },
    },
    body: JSON.stringify({
      redirectUri: "https://app.example.com/auth/callback",
    }),
  };
}
