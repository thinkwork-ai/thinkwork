import { beforeEach, describe, expect, it, vi } from "vitest";

const { issueEnrollmentGrantsMock, selectQueue, table, tx } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const select = vi.fn(() => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selectQueue.shift() ?? []),
    };
    return chain;
  });
  const table = (name: string) =>
    new Proxy(
      { __table__: name },
      {
        get: (target, property) =>
          property in target
            ? (target as Record<PropertyKey, unknown>)[property]
            : `${name}.${String(property)}`,
      },
    );
  return {
    issueEnrollmentGrantsMock: vi.fn(),
    selectQueue,
    table,
    tx: {
      select,
      insert: vi.fn(() => {
        throw new Error("recovery must not insert a second tenant");
      }),
    },
  };
});

vi.mock("../graphql/utils.js", () => ({
  db: {
    transaction: (callback: (value: typeof tx) => unknown) => callback(tx),
  },
  and: (...values: unknown[]) => ({ and: values }),
  eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
  tenants: table("tenants"),
  tenantMembers: table("tenant_members"),
  tenantSettings: table("tenant_settings"),
  users: table("users"),
}));

vi.mock("@thinkwork/database-pg", () => ({
  schema: {
    stripeCustomers: table("stripe_customers"),
    stripeSubscriptions: table("stripe_subscriptions"),
  },
}));

vi.mock("@thinkwork/database-pg/utils/generate-slug", () => ({
  generateSlug: () => "paid-workspace",
}));
vi.mock("@thinkwork/database-pg/utils/workspace-folder-name", () => ({
  workspaceFolderName: () => "owner",
}));
vi.mock("../handlers/auth-enrollment.js", () => ({
  issueEnrollmentGrants: issueEnrollmentGrantsMock,
}));
vi.mock("./tenant-bootstrap-defaults.js", () => ({
  ensureTenantBootstrapDefaults: vi.fn(),
}));
vi.mock("./spaces/default-space.js", () => ({
  ensureDefaultThreadSpace: vi.fn(),
}));
vi.mock("./stripe-plans.js", () => ({
  priceIdToInternalPlan: () => "pro",
}));

import { provisionTenantFromStripeSession } from "./stripe-provision-tenant.js";

describe("Stripe native owner enrollment", () => {
  beforeEach(() => {
    selectQueue.length = 0;
    issueEnrollmentGrantsMock.mockReset().mockResolvedValue({
      startToken: "replacement-token",
      recipientChallenge: "12345678",
      expiresAt: new Date("2026-07-18T19:00:00Z"),
      routeKeys: ["google-web"],
    });
  });

  it("rotates enrollment on delivery retry without creating another tenant", async () => {
    selectQueue.push(
      [{ tenantId: "tenant-1" }],
      [{ id: "tenant-1", plan: "pro" }],
      [{ id: "user-1" }],
      [{ id: "member-1" }],
    );

    const result = await provisionTenantFromStripeSession({
      session: {
        customer_details: { email: "owner@example.com", name: "Owner" },
      } as any,
      customer: { id: "cus_1", email: "owner@example.com" } as any,
      subscription: {
        id: "sub_1",
        status: "active",
        items: { data: [{ price: { id: "price_1" } }] },
      } as any,
      appUrl: "https://app.example.com/",
    });

    expect(tx.insert).not.toHaveBeenCalled();
    expect(issueEnrollmentGrantsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        intendedUserId: "user-1",
        membershipId: "member-1",
        grantKind: "pending_owner",
        redirectUri: "https://app.example.com/auth/callback",
        transaction: tx,
      }),
    );
    expect(result.enrollment.startToken).toBe("replacement-token");
  });
});
