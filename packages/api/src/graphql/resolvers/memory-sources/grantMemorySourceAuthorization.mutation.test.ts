import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTenantAdminMock = vi.hoisted(() => vi.fn());
const resolveCallerTenantIdMock = vi.hoisted(() => vi.fn());
const resolveCallerUserIdMock = vi.hoisted(() => vi.fn());

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: requireTenantAdminMock,
}));
vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: resolveCallerTenantIdMock,
  resolveCallerUserId: resolveCallerUserIdMock,
}));

import { grantMemorySourceAuthorization } from "./grantMemorySourceAuthorization.mutation.js";

const TENANT = "0015953e-aa13-4cab-8398-2e70f73dda63";
const PROCESSOR = "58a7be3f-8c0f-4a8b-b7be-8f97a1c8e9d2";
const USER = "b7de6c4a-8f2e-45cf-a231-5a5f9a3f6c1a";

const PROCESSOR_ROW = { id: PROCESSOR, tenant_id: TENANT, status: "active" };

const ACTIVE_GRANT_ROW = {
  id: "grant-old",
  tenant_id: TENANT,
  processor_config_id: PROCESSOR,
  source_family: "twenty",
  source_binding_key: "conn-1",
  boundary: {},
  granted_by_user_id: USER,
  grant_version: 2,
  status: "active",
  expires_at: null,
  revoked_at: null,
  created_at: new Date("2026-07-01T00:00:00.000Z"),
  updated_at: new Date("2026-07-01T00:00:00.000Z"),
};

function insertedRow(values: Record<string, unknown>) {
  return {
    id: "grant-new",
    revoked_at: null,
    created_at: new Date("2026-07-11T00:00:00.000Z"),
    updated_at: new Date("2026-07-11T00:00:00.000Z"),
    ...values,
  };
}

function buildCtx(options: {
  processorRows: unknown[];
  existingGrants: unknown[];
}) {
  // select #1: processor lookup (…where().limit()); select #2: existing
  // grants for the binding (…where() awaited directly).
  const processorLimit = vi.fn().mockResolvedValue(options.processorRows);
  const processorWhere = vi.fn().mockReturnValue({ limit: processorLimit });
  const processorFrom = vi.fn().mockReturnValue({ where: processorWhere });

  const grantsWhere = vi.fn().mockResolvedValue(options.existingGrants);
  const grantsFrom = vi.fn().mockReturnValue({ where: grantsWhere });

  const select = vi
    .fn()
    .mockReturnValueOnce({ from: processorFrom })
    .mockReturnValueOnce({ from: grantsFrom });

  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });

  const returning = vi.fn();
  const insertValues = vi
    .fn()
    .mockImplementation((values: Record<string, unknown>) => ({
      returning: returning.mockResolvedValue([insertedRow(values)]),
    }));
  const insert = vi.fn().mockReturnValue({ values: insertValues });

  return {
    ctx: {
      db: { select, update, insert },
      auth: { tenantId: TENANT },
    } as any,
    update,
    updateSet,
    insertValues,
  };
}

const BASE_ARGS = {
  processorConfigId: PROCESSOR,
  sourceFamily: "twenty",
  sourceBindingKey: "conn-1",
};

describe("grantMemorySourceAuthorization mutation", () => {
  beforeEach(() => {
    requireTenantAdminMock.mockReset().mockResolvedValue(undefined);
    resolveCallerTenantIdMock.mockReset().mockResolvedValue(null);
    resolveCallerUserIdMock.mockReset().mockResolvedValue(USER);
  });

  it("is tenant-admin gated and inserts an active grant", async () => {
    const { ctx, update, insertValues } = buildCtx({
      processorRows: [PROCESSOR_ROW],
      existingGrants: [],
    });

    const result = await grantMemorySourceAuthorization({}, BASE_ARGS, ctx);

    expect(requireTenantAdminMock).toHaveBeenCalledWith(ctx, TENANT);
    expect(update).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT,
        processor_config_id: PROCESSOR,
        source_family: "twenty",
        source_binding_key: "conn-1",
        status: "active",
        grant_version: 1,
        granted_by_user_id: USER,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: "grant-new",
        processorConfigId: PROCESSOR,
        sourceFamily: "twenty",
        sourceBindingKey: "conn-1",
        status: "active",
        grantVersion: 1,
        grantedByUserId: USER,
      }),
    );
  });

  it("supersedes an existing active grant by revoking it first", async () => {
    const { ctx, update, updateSet, insertValues } = buildCtx({
      processorRows: [PROCESSOR_ROW],
      existingGrants: [ACTIVE_GRANT_ROW],
    });

    const result = await grantMemorySourceAuthorization({}, BASE_ARGS, ctx);

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "revoked",
        revoked_at: expect.any(Date),
      }),
    );
    // New grant version is bumped past the superseded grant's version.
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ grant_version: 3 }),
    );
    expect(result.grantVersion).toBe(3);
  });

  it("rejects unknown source families before touching the db", async () => {
    const { ctx } = buildCtx({ processorRows: [], existingGrants: [] });
    await expect(
      grantMemorySourceAuthorization(
        {},
        { ...BASE_ARGS, sourceFamily: "slack" },
        ctx,
      ),
    ).rejects.toThrow(/Unknown source family "slack"/);
    expect(ctx.db.select).not.toHaveBeenCalled();
  });

  it("rejects processor configs outside the tenant", async () => {
    const { ctx } = buildCtx({ processorRows: [], existingGrants: [] });
    await expect(
      grantMemorySourceAuthorization({}, BASE_ARGS, ctx),
    ).rejects.toThrow(/Memory processor config not found/);
  });

  it("rejects callers without tenant context", async () => {
    const { ctx } = buildCtx({ processorRows: [], existingGrants: [] });
    ctx.auth.tenantId = null;
    await expect(
      grantMemorySourceAuthorization({}, BASE_ARGS, ctx),
    ).rejects.toThrow(/Tenant context required/);
  });

  it("propagates admin-gate rejections", async () => {
    requireTenantAdminMock.mockRejectedValueOnce(new Error("Forbidden"));
    const { ctx } = buildCtx({
      processorRows: [PROCESSOR_ROW],
      existingGrants: [],
    });
    await expect(
      grantMemorySourceAuthorization({}, BASE_ARGS, ctx),
    ).rejects.toThrow(/Forbidden/);
  });

  it("parses a JSON-string boundary and rejects malformed JSON", async () => {
    const good = buildCtx({
      processorRows: [PROCESSOR_ROW],
      existingGrants: [],
    });
    await grantMemorySourceAuthorization(
      {},
      { ...BASE_ARGS, boundary: '{"objects":["company"]}' },
      good.ctx,
    );
    expect(good.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ boundary: { objects: ["company"] } }),
    );

    const bad = buildCtx({
      processorRows: [PROCESSOR_ROW],
      existingGrants: [],
    });
    await expect(
      grantMemorySourceAuthorization(
        {},
        { ...BASE_ARGS, boundary: "{not json" },
        bad.ctx,
      ),
    ).rejects.toThrow(/boundary must be a JSON object/);
  });
});
