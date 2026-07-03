import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTenantAdminMock = vi.hoisted(() => vi.fn());
const resolveCallerTenantIdMock = vi.hoisted(() => vi.fn());

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
}));

import { brainDreamRuns } from "./brainDreamRuns.query.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";

const RUN_ROW = {
  id: "run-1",
  tenant_id: TENANT,
  bank_id: "user_abc",
  dedupe_key: `${TENANT}:user_abc:495000`,
  status: "applied",
  planned_counts: { quarantine: 1, forget: 2, consolidate: 1 },
  applied_counts: { quarantine: 1, forget: 2, consolidate: 1 },
  error_message: null,
  started_at: new Date("2026-07-03T12:00:00.000Z"),
  finished_at: new Date("2026-07-03T12:01:00.000Z"),
  created_at: new Date("2026-07-03T12:00:00.000Z"),
  updated_at: new Date("2026-07-03T12:01:00.000Z"),
};

function buildCtx(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return {
    ctx: { db: { select }, auth: { tenantId: TENANT } } as any,
    limit,
    where,
  };
}

describe("brainDreamRuns query", () => {
  beforeEach(() => {
    requireTenantAdminMock.mockReset().mockResolvedValue(undefined);
    resolveCallerTenantIdMock.mockReset().mockResolvedValue(null);
  });

  it("is tenant-admin gated and returns per-run counts", async () => {
    const { ctx } = buildCtx([RUN_ROW]);
    const result = await brainDreamRuns({}, {}, ctx);

    expect(requireTenantAdminMock).toHaveBeenCalledWith(ctx, TENANT);
    expect(result).toEqual([
      expect.objectContaining({
        id: "run-1",
        tenantId: TENANT,
        bankId: "user_abc",
        status: "applied",
        plannedCounts: { quarantine: 1, forget: 2, consolidate: 1 },
        appliedCounts: { quarantine: 1, forget: 2, consolidate: 1 },
        startedAt: "2026-07-03T12:00:00.000Z",
      }),
    ]);
  });

  it("rejects callers without tenant context", async () => {
    const { ctx } = buildCtx([]);
    ctx.auth.tenantId = null;
    await expect(brainDreamRuns({}, {}, ctx)).rejects.toThrow(
      /Tenant context required/,
    );
  });

  it("propagates admin-gate rejections", async () => {
    requireTenantAdminMock.mockRejectedValueOnce(new Error("Forbidden"));
    const { ctx } = buildCtx([RUN_ROW]);
    await expect(brainDreamRuns({}, {}, ctx)).rejects.toThrow(/Forbidden/);
  });

  it("clamps the limit between 1 and 200", async () => {
    const { ctx, limit } = buildCtx([]);
    await brainDreamRuns({}, { limit: 9999 }, ctx);
    expect(limit).toHaveBeenCalledWith(200);
    await brainDreamRuns({}, { limit: -5 }, ctx);
    expect(limit).toHaveBeenCalledWith(1);
  });
});
