import { beforeEach, describe, expect, it, vi } from "vitest";

const { inserts, routeRows, routeRowQueue, selectQueue, updates } = vi.hoisted(
  () => ({
    inserts: [] as unknown[],
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
    updates: [] as unknown[],
  }),
);

vi.mock("@thinkwork/database-pg/schema", () => {
  const table = (name: string, columns: string[]) =>
    Object.fromEntries(
      columns.map((column) => [column, { name: `${name}.${column}` }]),
    );
  return {
    authIdentityEnrollments: table("enrollments", [
      "id",
      "nonce_digest",
      "recipient_challenge_digest",
      "auth_route_client_id",
    ]),
    authSubscriptionInvalidations: table("invalidations", ["id"]),
    tenantMembers: table("members", [
      "id",
      "tenant_id",
      "principal_type",
      "principal_id",
    ]),
    userAuthIdentities: table("identities", [
      "user_id",
      "cognito_issuer",
      "cognito_sub",
    ]),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
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
    });
  };
  const tx = {
    select: () => ({ from: () => ({ where: selectResult }) }),
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

vi.mock("../lib/cognito-auth.js", () => ({ authenticate: vi.fn() }));

import {
  consumeEnrollment,
  enrollmentDigest,
  issueEnrollmentGrants,
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
    auth_provider_resource_id: "connection-1",
    auth_route_client_id: "route-client-1",
    redirect_uri: "https://app.example.com/auth/callback",
    nonce_digest: enrollmentDigest("start-token", "route-client-1"),
    recipient_challenge_digest: enrollmentDigest("654321", "route-client-1"),
    status: "pending",
    expires_at: new Date("2026-07-19T00:00:00Z"),
    ...overrides,
  };
}

describe("identity enrollment", () => {
  beforeEach(() => {
    inserts.length = 0;
    routeRows.length = 0;
    routeRowQueue.length = 0;
    selectQueue.length = 0;
    updates.length = 0;
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

  it("atomically binds the exact Cognito route and activates the intended grant", async () => {
    selectQueue.push([enrollment()], []);
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
    expect(updates).toHaveLength(2);
  });

  it("rejects a forwarded start link without the recipient challenge", async () => {
    selectQueue.push([enrollment()]);
    await expect(
      consumeEnrollment(
        {
          startToken: "start-token",
          recipientChallenge: "wrong",
          redirectUri: "https://app.example.com/auth/callback",
        },
        auth,
        new Date("2026-07-18T00:00:00Z"),
      ),
    ).resolves.toBe("invalid_challenge");
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("expires a stale grant without creating an identity", async () => {
    selectQueue.push([
      enrollment({ expires_at: new Date("2026-07-17T00:00:00Z") }),
    ]);
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

  it("quarantines a Cognito subject already bound to another user", async () => {
    selectQueue.push([enrollment()], [{ userId: "different-user" }]);
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
});
