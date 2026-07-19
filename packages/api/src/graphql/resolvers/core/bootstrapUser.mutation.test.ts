/**
 * Plan 2026-05-29-006 U5 (R8) — bootstrapUser stamps cognito_sub on the
 * created users row, where email (and thus the Cognito sub) is guaranteed
 * present, so a new user is linked at creation and never depends on the
 * email heal path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClaimComment } from "@thinkwork/namespace-registry";

const {
  mockDb,
  insertCalls,
  updateCalls,
  selectQueue,
  returningQueue,
  bootstrapDefaultCalls,
  bootstrapDefaultFailures,
  resolveCallerFromAuthMock,
} = vi.hoisted(() => {
  const insertCalls: Array<{
    table: string;
    values: Record<string, unknown>;
  }> = [];
  const updateCalls: Array<{
    table: string;
    values: Record<string, unknown>;
  }> = [];
  const bootstrapDefaultCalls: Array<{
    tenantId: string;
    userId: string;
  }> = [];
  const bootstrapDefaultFailures: Error[] = [];
  const selectQueue: unknown[][] = [];
  const returningQueue: unknown[][] = [];
  const resolveCallerFromAuthMock = vi.fn();

  const mockDb = {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
        then: (resolve: (v: unknown) => void) =>
          resolve(selectQueue.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn((table: { __table__: string }) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ table: table.__table__, values });
        const result: any = {
          returning: async () => returningQueue.shift() ?? [],
          onConflictDoNothing: () => Promise.resolve([]),
          then: (resolve: (v: unknown) => void) => resolve([]),
        };
        return result;
      },
    })),
    update: vi.fn((table: { __table__: string }) => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updateCalls.push({ table: table.__table__, values });
        return {
          where: vi.fn(() => ({
            returning: async () => returningQueue.shift() ?? [],
          })),
        };
      }),
    })),
  };

  return {
    mockDb,
    insertCalls,
    updateCalls,
    selectQueue,
    returningQueue,
    bootstrapDefaultCalls,
    bootstrapDefaultFailures,
    resolveCallerFromAuthMock,
  };
});

vi.mock("../../utils.js", () => ({
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ __eq: { field, value } })),
  sql: vi.fn(() => ({ __sql: true })),
  tenants: { __table__: "tenants" },
  users: { __table__: "users" },
  tenantMembers: { __table__: "tenant_members" },
  tenantSettings: { __table__: "tenant_settings" },
  agentTemplates: { __table__: "agent_templates" },
}));

vi.mock("@thinkwork/database-pg/utils/generate-slug", () => ({
  generateSlug: () => "happy-otter",
}));

vi.mock("../../../lib/tenant-bootstrap-defaults.js", () => ({
  ensureTenantBootstrapDefaults: vi.fn(
    async (input: { tenantId: string; userId: string }) => {
      bootstrapDefaultCalls.push(input);
      const failure = bootstrapDefaultFailures.shift();
      if (failure) throw failure;
    },
  ),
}));

vi.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: class {
    send = async () => ({});
  },
  AdminUpdateUserAttributesCommand: class {
    constructor(public input: unknown) {}
  },
}));

const { defaultSpaceCalls } = vi.hoisted(() => ({
  defaultSpaceCalls: [] as Array<{
    tenantId: string;
    userId?: string | null;
  }>,
}));

vi.mock("../../../lib/spaces/default-space.js", () => ({
  ensureDefaultThreadSpace: vi.fn(
    async (input: { tenantId: string; userId?: string | null }) => {
      defaultSpaceCalls.push(input);
      return { id: "space-1", tenant_id: input.tenantId, status: "active" };
    },
  ),
}));

vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerFromAuth: resolveCallerFromAuthMock,
}));

import { bootstrapUser } from "./bootstrapUser.mutation.js";
import { __setNamespaceCheckDepsForTests } from "./tenantSlugValidation.js";

// Namespace-check injection (plan 2026-06-12-002 U5): the default
// new-tenant path validates the generated slug through the same
// validateTenantSlug pipeline as createTenant.
const namespaceListRecords = vi.fn();

function localAuth(overrides: Record<string, unknown> = {}) {
  return {
    authType: "cognito",
    principalId: "sub-new",
    email: "new@example.com",
    emailVerified: true,
    name: "New User",
    cognitoIssuer:
      "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example",
    route: {
      routeClientId: "route-local-web",
      routeKey: "local",
      clientFamily: "web",
      appClientId: "client-local",
      lifecycleState: "native",
      connectionId: "connection-local",
      connectionKey: "local",
      providerKind: "local",
      providerIssuer: null,
    },
    tenantId: null,
    agentId: null,
    ...overrides,
  };
}

beforeEach(() => {
  insertCalls.length = 0;
  updateCalls.length = 0;
  selectQueue.length = 0;
  returningQueue.length = 0;
  bootstrapDefaultCalls.length = 0;
  bootstrapDefaultFailures.length = 0;
  defaultSpaceCalls.length = 0;
  namespaceListRecords.mockReset().mockResolvedValue([]);
  resolveCallerFromAuthMock.mockReset().mockResolvedValue({
    userId: null,
    tenantId: null,
  });
  __setNamespaceCheckDepsForTests({
    resolveToken: async () => "cf-token",
    createDns: () => ({ listRecords: namespaceListRecords }),
  });
});

afterEach(() => {
  __setNamespaceCheckDepsForTests(null);
});

describe("bootstrapUser", () => {
  it("requires enrollment instead of auto-bootstrapping a federated identity", async () => {
    await expect(
      bootstrapUser({}, {}, {
        auth: localAuth({
          route: {
            ...localAuth().route,
            routeKey: "google",
            appClientId: "client-google",
            connectionId: "connection-google",
            connectionKey: "google",
            providerKind: "google",
            providerIssuer: "https://accounts.google.com",
          },
        }),
        headers: {},
      } as any),
    ).rejects.toThrow(/Identity enrollment is required/);
    expect(insertCalls).toEqual([]);
  });

  it("stamps cognito_sub on the created user row (default new-tenant path)", async () => {
    selectQueue.push([]); // existing user lookup → none
    selectQueue.push([]); // existing email lookup → none
    returningQueue.push([{ id: "tenant-1", slug: "happy-otter" }]); // insert tenants
    returningQueue.push([{ id: "user-1", email: "new@example.com" }]); // insert users

    const result = await bootstrapUser({}, {}, {
      auth: localAuth(),
      headers: {},
    } as any);

    const userInsert = insertCalls.find((c) => c.table === "users");
    expect(userInsert).toBeDefined();
    expect(userInsert?.values.cognito_sub).toBe("sub-new");
    expect(userInsert?.values.email).toBe("new@example.com");
    expect(bootstrapDefaultCalls).toEqual([
      { tenantId: "tenant-1", userId: "user-1" },
    ]);
    expect(defaultSpaceCalls).toEqual([
      { tenantId: "tenant-1", userId: "user-1" },
    ]);
    expect(result.isNew).toBe(true);
    // The generated slug went through the namespace check (U5).
    expect(namespaceListRecords).toHaveBeenCalledWith(
      "happy-otter.thinkwork.ai",
    );
  });

  it("rejects when the generated slug is deployment-claimed in the namespace — no tenant row", async () => {
    selectQueue.push([]); // existing user lookup → none
    selectQueue.push([]); // existing email lookup → none
    namespaceListRecords.mockResolvedValue([
      {
        id: "rec-1",
        type: "NS",
        name: "happy-otter.thinkwork.ai",
        content: "ns-123.awsdns-01.com",
        comment: formatClaimComment({
          kind: "deployment",
          owner: "tei-deploy",
          created: "2026-06-12",
        }),
      },
    ]);

    await expect(
      bootstrapUser({}, {}, {
        auth: localAuth(),
        headers: {},
      } as any),
    ).rejects.toMatchObject({ extensions: { code: "SLUG_UNAVAILABLE" } });

    expect(namespaceListRecords).toHaveBeenCalledWith(
      "happy-otter.thinkwork.ai",
    );
    expect(insertCalls).toEqual([]);
    expect(bootstrapDefaultCalls).toEqual([]);
  });

  it("fails CLOSED on a Cloudflare API error — no tenant row is created", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    selectQueue.push([]); // existing user lookup → none
    selectQueue.push([]); // existing email lookup → none
    namespaceListRecords.mockRejectedValue(new Error("cloudflare 500"));

    await expect(
      bootstrapUser({}, {}, {
        auth: localAuth(),
        headers: {},
      } as any),
    ).rejects.toMatchObject({
      extensions: { code: "SLUG_VALIDATION_UNAVAILABLE" },
    });

    expect(insertCalls).toEqual([]);
    expect(bootstrapDefaultCalls).toEqual([]);
    error.mockRestore();
  });

  it("repairs tenant bootstrap defaults for existing users", async () => {
    resolveCallerFromAuthMock.mockResolvedValue({
      userId: "user-existing",
      tenantId: "tenant-existing",
    });
    selectQueue.push([
      {
        id: "user-existing",
        email: "existing@example.com",
        tenant_id: "tenant-existing",
      },
    ]);
    selectQueue.push([{ id: "tenant-existing", slug: "existing" }]);

    const result = await bootstrapUser({}, {}, {
      auth: localAuth({
        principalId: "sub-existing",
        email: "existing@example.com",
        name: "Existing User",
      }),
      headers: {},
    } as any);

    expect(bootstrapDefaultCalls).toEqual([
      { tenantId: "tenant-existing", userId: "user-existing" },
    ]);
    // Existing tenants are never mutated — an intentionally space-less
    // tenant must stay space-less (seeding is for created/claimed only).
    expect(defaultSpaceCalls).toEqual([]);
    expect(result.isNew).toBe(false);
  });

  it("does not fail bootstrap when tenant default seeding is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bootstrapDefaultFailures.push(new Error("relation does not exist"));
    selectQueue.push([]); // existing user lookup → none
    selectQueue.push([]); // existing email lookup → none
    returningQueue.push([{ id: "tenant-1", slug: "happy-otter" }]);
    returningQueue.push([{ id: "user-1", email: "new@example.com" }]);

    const result = await bootstrapUser({}, {}, {
      auth: localAuth(),
      headers: {},
    } as any);

    expect(result.isNew).toBe(true);
    expect(bootstrapDefaultCalls).toEqual([
      { tenantId: "tenant-1", userId: "user-1" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[bootstrapUser] Failed to seed tenant bootstrap defaults:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
