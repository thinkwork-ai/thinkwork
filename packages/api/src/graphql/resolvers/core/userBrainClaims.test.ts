/**
 * Brain claims resolver tests (THINK-625).
 *
 * The properties worth pinning here are the ones whose regression is silent:
 * a non-admin reaching authorization data, an invalid grant reaching the
 * database, an operator's edit being lost because S3 was down, or a claims
 * change landing with no audit trail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CLAIMS_TABLE = "user_brain_claims";
const POLICY_TABLE = "tenant_policy_events";

const {
  selectQueue,
  inserts,
  updates,
  deletes,
  txLike,
  mockRequireTenantAdmin,
  mockResolveCallerUserId,
  mockPublish,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const deletes: unknown[] = [];

  const storedRow = () => ({
    id: "claims-1",
    tenant_id: "tenant",
    user_id: "user",
    security_groups: [] as string[],
    kb_collections: [] as string[],
    kb_bundles: {},
    default_kb_bundle: null,
    tool_allowlist: null,
    is_operator: false,
    kb_trace: false,
    enabled: true,
    notes: null,
  });

  const selectChain = () => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => Promise.resolve(selectQueue.shift() ?? []),
    };
    return chain;
  };

  const txLike = {
    select: selectChain,
    // Records the write and returns a value that is both awaitable (policy
    // events) and chainable (.returning() for the claims row).
    insert: (table: { __table: string }) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table: table.__table, values });
        return {
          returning: () =>
            Promise.resolve([{ ...storedRow(), ...values, id: "claims-1" }]),
          then: (onOk: (v: unknown) => unknown) =>
            Promise.resolve(undefined).then(onOk),
        };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve([{ ...storedRow(), ...patch, id: "claims-1" }]),
          }),
        };
      },
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(deletes.shift() ?? []),
      }),
    }),
  };

  return {
    selectQueue,
    inserts,
    updates,
    deletes,
    txLike,
    mockRequireTenantAdmin: vi.fn(),
    mockResolveCallerUserId: vi.fn(),
    mockPublish: vi.fn(),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  tenantMembers: {
    __table: "tenant_members",
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
    principal_id: { name: "principal_id" },
    principal_type: { name: "principal_type" },
  },
  tenantPolicyEvents: { __table: "tenant_policy_events" },
  userBrainClaims: {
    __table: "user_brain_claims",
    id: { name: "id" },
    tenant_id: { name: "tenant_id" },
    user_id: { name: "user_id" },
  },
}));

vi.mock("../../utils.js", () => ({
  db: {
    ...txLike,
    transaction: (cb: (tx: unknown) => unknown) => Promise.resolve(cb(txLike)),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  snakeToCamel: (row: Record<string, unknown>) => ({ ...row, __camel: true }),
}));

vi.mock("./authz.js", () => ({ requireTenantAdmin: mockRequireTenantAdmin }));
vi.mock("./resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));
vi.mock("../../../lib/twin/user-claims-manifest.js", () => ({
  publishUserClaimsManifest: mockPublish,
}));

import { GraphQLError } from "graphql";
import {
  buildClaimsPatch,
  clearUserBrainClaims,
  republishUserClaimsManifest,
  setUserBrainClaims,
  tenantUserBrainClaims,
  userBrainClaims_,
} from "./userBrainClaims.js";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";

function claimsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "claims-1",
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    security_groups: ["FINANCE"],
    kb_collections: ["handbook"],
    kb_bundles: {},
    default_kb_bundle: null,
    tool_allowlist: null,
    is_operator: false,
    kb_trace: false,
    enabled: true,
    notes: null,
    ...overrides,
  };
}

function ctx(): any {
  return { auth: { authType: "cognito", principalId: ADMIN_ID } };
}

/** Membership lookup, then the existing-claims lookup. */
function seedMember(existingClaims: unknown[] = []) {
  selectQueue.push([{ id: "member-1" }]);
  selectQueue.push(existingClaims);
}

const policyEvents = () => inserts.filter((i) => i.table === POLICY_TABLE);
const claimsInserts = () => inserts.filter((i) => i.table === CLAIMS_TABLE);

beforeEach(() => {
  selectQueue.length = 0;
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  mockRequireTenantAdmin.mockReset().mockResolvedValue("admin");
  mockResolveCallerUserId.mockReset().mockResolvedValue(ADMIN_ID);
  mockPublish.mockReset().mockResolvedValue({
    published: true,
    key: `user-claims/${TENANT_ID}/latest.json`,
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("authorization", () => {
  const forbidden = new GraphQLError("Tenant admin role required", {
    extensions: { code: "FORBIDDEN" },
  });

  it.each([
    [
      "userBrainClaims",
      () =>
        userBrainClaims_(null, { tenantId: TENANT_ID, userId: USER_ID }, ctx()),
    ],
    [
      "tenantUserBrainClaims",
      () => tenantUserBrainClaims(null, { tenantId: TENANT_ID }, ctx()),
    ],
    [
      "setUserBrainClaims",
      () =>
        setUserBrainClaims(
          null,
          { tenantId: TENANT_ID, userId: USER_ID, input: {} },
          ctx(),
        ),
    ],
    [
      "clearUserBrainClaims",
      () =>
        clearUserBrainClaims(
          null,
          { tenantId: TENANT_ID, userId: USER_ID },
          ctx(),
        ),
    ],
    [
      "republishUserClaimsManifest",
      () => republishUserClaimsManifest(null, { tenantId: TENANT_ID }, ctx()),
    ],
  ])("%s refuses a plain member with FORBIDDEN", async (_name, call) => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);
    await expect(call()).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("setUserBrainClaims", () => {
  it("inserts claims, audits the change, then publishes", async () => {
    seedMember([]);

    const payload: any = await setUserBrainClaims(
      null,
      {
        tenantId: TENANT_ID,
        userId: USER_ID,
        input: { securityGroups: ["FINANCE"], kbCollections: ["handbook"] },
      },
      ctx(),
    );

    expect(claimsInserts()).toHaveLength(1);
    expect(claimsInserts()[0]!.values).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      security_groups: ["FINANCE"],
      kb_collections: ["handbook"],
      updated_by_user_id: ADMIN_ID,
    });
    expect(payload.manifest).toEqual({
      published: true,
      key: `user-claims/${TENANT_ID}/latest.json`,
      reason: null,
    });
    expect(mockPublish).toHaveBeenCalledWith(TENANT_ID);
  });

  it("writes a tenant_policy_events row carrying before and after state", async () => {
    seedMember([claimsRow({ security_groups: [] })]);

    await setUserBrainClaims(
      null,
      {
        tenantId: TENANT_ID,
        userId: USER_ID,
        input: { securityGroups: ["*"] },
      },
      ctx(),
    );

    expect(policyEvents()).toHaveLength(1);
    const event = policyEvents()[0]!.values;
    expect(event.event_type).toBe("user_brain_claims");
    expect(event.source).toBe("graphql");
    expect(event.actor_user_id).toBe(ADMIN_ID);
    expect(JSON.parse(event.before_value as string).securityGroups).toEqual([]);
    expect(JSON.parse(event.after_value as string).securityGroups).toEqual([
      "*",
    ]);
  });

  it("updates in place when a claims row already exists", async () => {
    seedMember([claimsRow()]);
    await setUserBrainClaims(
      null,
      { tenantId: TENANT_ID, userId: USER_ID, input: { isOperator: true } },
      ctx(),
    );
    expect(claimsInserts()).toHaveLength(0);
    expect(updates[0]).toMatchObject({ is_operator: true });
  });

  it("surfaces a publish failure WITHOUT rolling back the database write", async () => {
    seedMember([]);
    mockPublish.mockResolvedValue({ published: false, reason: "s3 exploded" });

    const payload: any = await setUserBrainClaims(
      null,
      { tenantId: TENANT_ID, userId: USER_ID, input: { kbTrace: true } },
      ctx(),
    );

    // The edit survived...
    expect(claimsInserts()).toHaveLength(1);
    expect(policyEvents()).toHaveLength(1);
    expect(payload.claims).toBeTruthy();
    // ...and the operator is told it has not reached the Brain.
    expect(payload.manifest).toEqual({
      published: false,
      key: null,
      reason: "s3 exploded",
    });
  });

  it("rejects an invalid grant list with nothing written and nothing published", async () => {
    seedMember([]);
    await expect(
      setUserBrainClaims(
        null,
        {
          tenantId: TENANT_ID,
          userId: USER_ID,
          input: { securityGroups: ["ok", ""] },
        },
        ctx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("refuses a user who is not a member of the tenant", async () => {
    selectQueue.push([]); // membership lookup misses
    await expect(
      setUserBrainClaims(
        null,
        { tenantId: TENANT_ID, userId: USER_ID, input: {} },
        ctx(),
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("clearUserBrainClaims", () => {
  it("deletes the row, audits it, and republishes", async () => {
    deletes.push([claimsRow()]);

    const payload: any = await clearUserBrainClaims(
      null,
      { tenantId: TENANT_ID, userId: USER_ID },
      ctx(),
    );

    expect(payload.claims).toBeNull();
    expect(payload.manifest.published).toBe(true);
    expect(policyEvents()).toHaveLength(1);
    expect(policyEvents()[0]!.values.after_value).toBeNull();
    expect(mockPublish).toHaveBeenCalledWith(TENANT_ID);
  });

  it("still republishes when there was nothing to delete", async () => {
    deletes.push([]);
    const payload: any = await clearUserBrainClaims(
      null,
      { tenantId: TENANT_ID, userId: USER_ID },
      ctx(),
    );
    expect(policyEvents()).toHaveLength(0);
    expect(mockPublish).toHaveBeenCalledWith(TENANT_ID);
    expect(payload.manifest.published).toBe(true);
  });
});

describe("republishUserClaimsManifest", () => {
  it("returns the publish outcome for an admin", async () => {
    mockPublish.mockResolvedValue({
      published: false,
      reason: "claims_disabled",
      key: `user-claims/${TENANT_ID}/latest.json`,
      deleted: true,
    });
    const result = await republishUserClaimsManifest(
      null,
      { tenantId: TENANT_ID },
      ctx(),
    );
    expect(result).toEqual({
      published: false,
      key: `user-claims/${TENANT_ID}/latest.json`,
      reason: "claims_disabled",
    });
  });
});

describe("buildClaimsPatch", () => {
  it("touches only the fields present in the input", () => {
    expect(buildClaimsPatch({ isOperator: true })).toEqual({
      is_operator: true,
    });
  });

  it("keeps an absent toolAllowlist absent and a null one explicit", () => {
    expect(buildClaimsPatch({})).not.toHaveProperty("tool_allowlist");
    expect(buildClaimsPatch({ toolAllowlist: null })).toEqual({
      tool_allowlist: null,
    });
    expect(buildClaimsPatch({ toolAllowlist: [] })).toEqual({
      tool_allowlist: [],
    });
  });

  it("trims and de-duplicates grant lists, preserving order", () => {
    expect(
      buildClaimsPatch({ securityGroups: [" FINANCE ", "HR", "FINANCE"] }),
    ).toEqual({ security_groups: ["FINANCE", "HR"] });
  });

  it("accepts kbBundles as an object or as an AWSJSON string", () => {
    expect(
      buildClaimsPatch({ kbBundles: { onboarding: ["handbook"] } }),
    ).toEqual({ kb_bundles: { onboarding: ["handbook"] } });
    expect(
      buildClaimsPatch({ kbBundles: '{"onboarding":["handbook"]}' }),
    ).toEqual({ kb_bundles: { onboarding: ["handbook"] } });
  });

  it("rejects a default bundle that is not among the configured bundles", () => {
    expect(() =>
      buildClaimsPatch({
        kbBundles: { onboarding: ["handbook"] },
        defaultKbBundle: "nonexistent",
      }),
    ).toThrow(/not one of the configured kbBundles/);
  });

  it("rejects malformed grant values rather than repairing them", () => {
    expect(() => buildClaimsPatch({ securityGroups: "FINANCE" })).toThrow(
      /array of non-empty strings/,
    );
    expect(() => buildClaimsPatch({ kbCollections: [42] })).toThrow(
      /array of non-empty strings/,
    );
    expect(() => buildClaimsPatch({ isOperator: "yes" })).toThrow(
      /boolean required/,
    );
    expect(() => buildClaimsPatch({ kbBundles: "not json" })).toThrow(
      /valid JSON object required/,
    );
  });
});
