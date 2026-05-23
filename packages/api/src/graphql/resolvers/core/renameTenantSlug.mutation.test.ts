import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_TENANT_SLUGS } from "@thinkwork/database-pg/utils/reserved-slugs";
import { db } from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";
import { renameTenantSlug } from "./renameTenantSlug.mutation.js";

const {
  selectRowsQueue,
  updateReturning,
  mockRequireTenantAdmin,
  updatePatch,
} = vi.hoisted(() => ({
  selectRowsQueue: [] as unknown[][],
  updateReturning: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  updatePatch: { value: null as Record<string, unknown> | null },
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(selectRowsQueue.shift() ?? []),
      }),
    })),
    update: vi.fn(() => ({
      set: (patch: Record<string, unknown>) => {
        updatePatch.value = patch;
        return {
          where: () => ({
            returning: () => updateReturning(),
          }),
        };
      },
    })),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
  ne: (...args: unknown[]) => ({ ne: args }),
  and: (...args: unknown[]) => ({ and: args }),
  tenants: {
    id: "tenants.id",
    slug: "tenants.slug",
  },
  snakeToCamel: (row: Record<string, unknown>) => ({
    ...row,
    updatedAt: row.updated_at,
  }),
}));

vi.mock("./authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

const dbMock = vi.mocked(db);
const requireTenantAdminMock = vi.mocked(requireTenantAdmin);

function cognitoCtx(): any {
  return {
    auth: {
      authType: "cognito",
      principalId: "user-1",
      tenantId: "tenant-1",
    },
  };
}

function serviceCtx(): any {
  return {
    auth: {
      authType: "service",
      principalId: null,
      tenantId: "tenant-1",
    },
  };
}

function tenantRow(slug = "old-slug") {
  return {
    id: "tenant-1",
    name: "Acme",
    slug,
    plan: "pro",
    updated_at: new Date("2026-05-23T00:00:00.000Z"),
  };
}

async function call(newSlug: string, ctx = cognitoCtx()) {
  return renameTenantSlug(
    null,
    { tenantId: "tenant-1", newSlug },
    ctx,
  ) as Promise<Record<string, unknown>>;
}

describe("renameTenantSlug", () => {
  beforeEach(() => {
    selectRowsQueue.length = 0;
    updateReturning.mockReset();
    mockRequireTenantAdmin.mockReset();
    updatePatch.value = null;
    vi.mocked(dbMock.select).mockClear();
    vi.mocked(dbMock.update).mockClear();
    requireTenantAdminMock.mockResolvedValue("admin");
  });

  it("renames an admin's tenant to an available slug", async () => {
    selectRowsQueue.push([tenantRow()], []);
    updateReturning.mockResolvedValue([tenantRow("acme")]);

    await expect(call("acme")).resolves.toMatchObject({
      id: "tenant-1",
      slug: "acme",
    });

    expect(requireTenantAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
    expect(updatePatch.value).toMatchObject({ slug: "acme" });
    expect(updatePatch.value?.updated_at).toBeInstanceOf(Date);
  });

  it("succeeds idempotently when the slug already belongs to the tenant", async () => {
    selectRowsQueue.push([tenantRow("acme")]);

    await expect(call("acme")).resolves.toMatchObject({
      id: "tenant-1",
      slug: "acme",
    });

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it.each([
    "ab",
    "a".repeat(31),
    "-acme",
    "acme-",
    "Acme",
    "acme inc",
    "acme_inc",
  ])("rejects invalid slug shape %s", async (newSlug) => {
    await expect(call(newSlug)).rejects.toMatchObject({
      extensions: { code: "INVALID_SLUG" },
    });
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it.each(RESERVED_TENANT_SLUGS)(
    "rejects reserved tenant slug %s",
    async (newSlug) => {
      await expect(call(newSlug)).rejects.toMatchObject({
        extensions: { code: "RESERVED_SLUG" },
      });
      expect(dbMock.select).not.toHaveBeenCalled();
      expect(dbMock.update).not.toHaveBeenCalled();
    },
  );

  it("rejects a slug already held by another tenant", async () => {
    selectRowsQueue.push([tenantRow()], [{ id: "tenant-2" }]);

    await expect(call("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_UNAVAILABLE" },
    });
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("maps a raced database unique violation to SLUG_UNAVAILABLE", async () => {
    selectRowsQueue.push([tenantRow()], []);
    updateReturning.mockRejectedValue(
      Object.assign(new Error("duplicate key"), {
        cause: { code: "23505" },
      }),
    );

    await expect(call("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_UNAVAILABLE" },
    });
  });

  it("rejects non-admin tenant members before reading or writing tenant slugs", async () => {
    requireTenantAdminMock.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(call("acme")).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it("rejects admins of other tenants through the tenant-pinned role gate", async () => {
    requireTenantAdminMock.mockRejectedValue(
      Object.assign(new Error("Tenant admin role required"), {
        extensions: { code: "FORBIDDEN" },
      }),
    );

    await expect(call("acme")).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(requireTenantAdminMock).toHaveBeenCalledWith(
      expect.anything(),
      "tenant-1",
    );
  });

  it("rejects service-secret callers", async () => {
    await expect(call("acme", serviceCtx())).rejects.toMatchObject({
      extensions: { code: "FORBIDDEN" },
    });
    expect(requireTenantAdminMock).not.toHaveBeenCalled();
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
