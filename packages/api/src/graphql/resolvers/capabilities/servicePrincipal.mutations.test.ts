/**
 * createServicePrincipal / revokeServicePrincipal resolver tests
 * (THINK-280 U2).
 *
 * Covers: admin gating, slug validation + per-tenant uniqueness
 * ('slug_taken' on both the pre-check and the insert race), idempotent
 * revocation, forged-tenant isolation, and audit emission on applied
 * outcomes only.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  rowsQueue,
  writeOps,
  insertShouldThrow,
  mockRequireAdminOrServiceCaller,
  mockResolveCallerUserId,
  mockEmitAuditEvent,
} = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
  writeOps: [] as Array<{ op: string; args: unknown }>,
  insertShouldThrow: { value: "" },
  mockRequireAdminOrServiceCaller: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  mockEmitAuditEvent: vi.fn(),
}));

function takeRows(): unknown[] {
  return rowsQueue.shift() ?? [];
}

function selectChain() {
  const promise = Promise.resolve(takeRows());
  return {
    limit: () => promise,
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
}

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain() }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          writeOps.push({ op: "insert", args: { table, values } });
          if (insertShouldThrow.value) {
            return Promise.reject(new Error(insertShouldThrow.value));
          }
          return Promise.resolve(takeRows());
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            writeOps.push({ op: "update", args: { table, values } });
            return Promise.resolve(takeRows());
          },
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ label: "tx" }),
  },
  eq: (col: unknown, val: unknown) => ({ op: "eq", col, val }),
  and: (...preds: unknown[]) => ({ op: "and", preds }),
  or: (...preds: unknown[]) => ({ op: "or", preds }),
  isNull: (col: unknown) => ({ op: "isNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ op: "inArray", col, vals }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  capabilityDefinitionVersions: {
    definition_id: "capabilityDefinitionVersions.definition_id",
  },
  tenantServicePrincipals: {
    id: "tenantServicePrincipals.id",
    tenant_id: "tenantServicePrincipals.tenant_id",
    slug: "tenantServicePrincipals.slug",
  },
}));

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: mockRequireAdminOrServiceCaller,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerUserId: mockResolveCallerUserId,
}));

vi.mock("../../../lib/compliance/emit.js", () => ({
  emitAuditEvent: mockEmitAuditEvent,
}));

import {
  createServicePrincipal,
  revokeServicePrincipal,
} from "./servicePrincipal.mutations.js";
import type { GraphQLContext } from "../../context.js";

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "99999999-9999-9999-9999-999999999999";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const PRINCIPAL_ID = "66666666-6666-6666-6666-666666666666";

const ctx = {} as GraphQLContext;

const PRINCIPAL_ROW = {
  id: PRINCIPAL_ID,
  tenant_id: TENANT_A,
  slug: "reporting-bot",
  display_name: "Reporting Bot",
  purpose: null,
  status: "active",
  created_at: new Date("2026-07-01T00:00:00.000Z"),
  revoked_at: null,
};

beforeEach(() => {
  rowsQueue.length = 0;
  writeOps.length = 0;
  insertShouldThrow.value = "";
  vi.clearAllMocks();
  mockRequireAdminOrServiceCaller.mockResolvedValue(undefined);
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
  mockEmitAuditEvent.mockResolvedValue({ eventId: "evt-1" });
});

describe("authz", () => {
  it("rejects non-admin callers on both mutations before any write", async () => {
    mockRequireAdminOrServiceCaller.mockRejectedValue(new Error("forbidden"));
    await expect(
      createServicePrincipal(
        null,
        {
          input: {
            tenantId: TENANT_A,
            slug: "reporting-bot",
            displayName: "Reporting Bot",
          },
        },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      revokeServicePrincipal(
        null,
        { tenantId: TENANT_A, servicePrincipalId: PRINCIPAL_ID },
        ctx,
      ),
    ).rejects.toThrow("forbidden");
    expect(writeOps).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });
});

describe("createServicePrincipal", () => {
  it("rejects slugs outside [a-z0-9-] without writing", async () => {
    for (const slug of ["Bad Slug", "UPPER", "under_score", "", "é"]) {
      const result = await createServicePrincipal(
        null,
        { input: { tenantId: TENANT_A, slug, displayName: "X" } },
        ctx,
      );
      expect(result.outcome).toBe("rejected");
    }
    expect(writeOps).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("an existing (tenant, slug) pair is 'rejected' reason 'slug_taken'", async () => {
    rowsQueue.push([PRINCIPAL_ROW]);
    const result = await createServicePrincipal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          slug: "reporting-bot",
          displayName: "Reporting Bot",
        },
      },
      ctx,
    );
    expect(result).toMatchObject({ outcome: "rejected", reason: "slug_taken" });
    expect(writeOps).toHaveLength(0);
  });

  it("a unique-index race on insert also lands on 'slug_taken'", async () => {
    rowsQueue.push([]); // pre-check finds nothing
    insertShouldThrow.value =
      'duplicate key value violates unique constraint "uq_tenant_service_principals_tenant_slug"';
    const result = await createServicePrincipal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          slug: "reporting-bot",
          displayName: "Reporting Bot",
        },
      },
      ctx,
    );
    expect(result).toMatchObject({ outcome: "rejected", reason: "slug_taken" });
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("creates an active principal, audits, and maps the row", async () => {
    rowsQueue.push([]); // pre-check
    rowsQueue.push([PRINCIPAL_ROW]); // insert returning

    const result = await createServicePrincipal(
      null,
      {
        input: {
          tenantId: TENANT_A,
          slug: "reporting-bot",
          displayName: "Reporting Bot",
        },
      },
      ctx,
    );

    expect(result.outcome).toBe("applied");
    expect(result.servicePrincipal).toMatchObject({
      id: PRINCIPAL_ID,
      tenantId: TENANT_A,
      slug: "reporting-bot",
      displayName: "Reporting Bot",
      status: "active",
    });
    const insert = writeOps.find((op) => op.op === "insert");
    expect(
      (insert!.args as { values: Record<string, unknown> }).values,
    ).toMatchObject({
      tenant_id: TENANT_A,
      slug: "reporting-bot",
      status: "active",
      created_by_user_id: USER_ID,
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.service_principal_created",
      resourceType: "tenant_service_principal",
      resourceId: PRINCIPAL_ID,
      action: "create",
      actorId: USER_ID,
    });
  });
});

describe("revokeServicePrincipal", () => {
  it("tenant B cannot revoke tenant A's principal (forged-tenant isolation)", async () => {
    rowsQueue.push([PRINCIPAL_ROW]);
    const result = await revokeServicePrincipal(
      null,
      { tenantId: TENANT_B, servicePrincipalId: PRINCIPAL_ID },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "service_principal_not_found",
    });
    expect(writeOps).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("revoking an already-revoked principal is an idempotent noop with no audit event", async () => {
    rowsQueue.push([
      { ...PRINCIPAL_ROW, status: "revoked", revoked_at: new Date() },
    ]);
    const result = await revokeServicePrincipal(
      null,
      { tenantId: TENANT_A, servicePrincipalId: PRINCIPAL_ID },
      ctx,
    );
    expect(result.outcome).toBe("noop");
    expect(result.servicePrincipal).toMatchObject({ status: "revoked" });
    expect(writeOps).toHaveLength(0);
    expect(mockEmitAuditEvent).not.toHaveBeenCalled();
  });

  it("revokes an active principal and audits", async () => {
    rowsQueue.push([PRINCIPAL_ROW]); // load
    rowsQueue.push([
      {
        ...PRINCIPAL_ROW,
        status: "revoked",
        revoked_at: new Date("2026-07-05T00:00:00.000Z"),
      },
    ]); // update returning

    const result = await revokeServicePrincipal(
      null,
      { tenantId: TENANT_A, servicePrincipalId: PRINCIPAL_ID },
      ctx,
    );

    expect(result.outcome).toBe("applied");
    expect(result.servicePrincipal).toMatchObject({
      id: PRINCIPAL_ID,
      status: "revoked",
      revokedAt: "2026-07-05T00:00:00.000Z",
    });
    const update = writeOps.find((op) => op.op === "update");
    expect(
      (update!.args as { values: Record<string, unknown> }).values,
    ).toMatchObject({
      status: "revoked",
      revoked_by_user_id: USER_ID,
    });
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1);
    expect(mockEmitAuditEvent.mock.calls[0]![1]).toMatchObject({
      eventType: "agent.service_principal_revoked",
      action: "revoke",
      resourceId: PRINCIPAL_ID,
    });
  });
});
