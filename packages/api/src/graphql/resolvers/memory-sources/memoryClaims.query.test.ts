import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTenantAdminMock = vi.hoisted(() => vi.fn());
const resolveCallerTenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
}));

import { memoryClaims } from "./memoryClaims.query.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const TARGET = "9d1f7e64-2f6f-4dd1-97e1-0b0b6a2f5a11";

const CLAIM_ROW = {
  id: "claim-1",
  tenant_id: TENANT,
  target_scope: "tenant",
  target_id: TARGET,
  canonical_subject_id: null,
  subject_key: "twenty:company:acme",
  subject_entity_type: "customer",
  ontology_predicate: "customer.employees",
  value: { employees: 250 },
  value_hash: "abc123",
  effective_from: new Date("2026-07-01T00:00:00.000Z"),
  effective_to: null,
  status: "active",
  conflict_state: "none",
  extraction_version: "v1",
  created_at: new Date("2026-07-10T12:00:00.000Z"),
  updated_at: new Date("2026-07-10T12:00:00.000Z"),
};

function buildCtx(claimRows: unknown[], supportRows: unknown[]) {
  // First select() loads claims; second select({...}) loads grouped
  // support counts.
  const limit = vi.fn().mockResolvedValue(claimRows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const claimsWhere = vi.fn().mockReturnValue({ orderBy });
  const claimsFrom = vi.fn().mockReturnValue({ where: claimsWhere });

  const groupBy = vi.fn().mockResolvedValue(supportRows);
  const supportWhere = vi.fn().mockReturnValue({ groupBy });
  const supportFrom = vi.fn().mockReturnValue({ where: supportWhere });

  const select = vi
    .fn()
    .mockReturnValueOnce({ from: claimsFrom })
    .mockReturnValueOnce({ from: supportFrom });

  return {
    ctx: { db: { select }, auth: { tenantId: TENANT } } as any,
    select,
    limit,
  };
}

const BASE_ARGS = { targetScope: "tenant", targetId: TARGET };

describe("memoryClaims query", () => {
  beforeEach(() => {
    requireTenantAdminMock.mockReset().mockResolvedValue(undefined);
    resolveCallerTenantIdMock.mockReset().mockResolvedValue(null);
  });

  it("is tenant-admin gated and joins active support counts", async () => {
    const { ctx } = buildCtx(
      [CLAIM_ROW],
      [{ claimId: "claim-1", supportCount: 3 }],
    );
    const result = await memoryClaims({}, BASE_ARGS, ctx);

    expect(requireTenantAdminMock).toHaveBeenCalledWith(ctx, TENANT);
    expect(result).toEqual([
      expect.objectContaining({
        id: "claim-1",
        subjectKey: "twenty:company:acme",
        subjectEntityType: "customer",
        ontologyPredicate: "customer.employees",
        value: { employees: 250 },
        valueHash: "abc123",
        status: "active",
        conflictState: "none",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
        extractionVersion: "v1",
        supportCount: 3,
      }),
    ]);
  });

  it("defaults supportCount to 0 when a claim has no active evidence", async () => {
    const { ctx } = buildCtx([CLAIM_ROW], []);
    const [claim] = await memoryClaims({}, BASE_ARGS, ctx);
    expect(claim.supportCount).toBe(0);
  });

  it("skips the support-count query when no claims match", async () => {
    const { ctx, select } = buildCtx([], []);
    const result = await memoryClaims({}, BASE_ARGS, ctx);
    expect(result).toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("rejects callers without tenant context", async () => {
    const { ctx } = buildCtx([], []);
    ctx.auth.tenantId = null;
    await expect(memoryClaims({}, BASE_ARGS, ctx)).rejects.toThrow(
      /Tenant context required/,
    );
  });

  it("propagates admin-gate rejections", async () => {
    requireTenantAdminMock.mockRejectedValueOnce(new Error("Forbidden"));
    const { ctx } = buildCtx([CLAIM_ROW], []);
    await expect(memoryClaims({}, BASE_ARGS, ctx)).rejects.toThrow(/Forbidden/);
  });

  it("clamps the limit between 1 and 200", async () => {
    const first = buildCtx([], []);
    await memoryClaims({}, { ...BASE_ARGS, limit: 9999 }, first.ctx);
    expect(first.limit).toHaveBeenCalledWith(200);

    const second = buildCtx([], []);
    await memoryClaims({}, { ...BASE_ARGS, limit: -5 }, second.ctx);
    expect(second.limit).toHaveBeenCalledWith(1);
  });
});
