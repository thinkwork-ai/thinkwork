import { beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_TENANT_SLUGS } from "@thinkwork/database-pg/utils/reserved-slugs";
import { db } from "../../utils.js";
import { createTenant } from "./createTenant.mutation.js";

const { insertReturning, insertValues, mockGenerateSlug } = vi.hoisted(() => ({
  insertReturning: vi.fn(),
  insertValues: { value: null as Record<string, unknown> | null },
  mockGenerateSlug: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (values: Record<string, unknown>) => {
        insertValues.value = values;
        return {
          returning: () => insertReturning(),
        };
      },
    })),
  },
  tenants: { id: "tenants.id", slug: "tenants.slug" },
  generateSlug: mockGenerateSlug,
  snakeToCamel: (row: Record<string, unknown>) => row,
}));

vi.mock("../../../lib/sandbox-provisioning.js", () => ({
  invokeProvisionTenantSandbox: vi.fn(),
  SandboxProvisioningConfigError: class SandboxProvisioningConfigError extends Error {},
}));

const dbMock = vi.mocked(db);

function tenantRow(slug = "acme") {
  return {
    id: "tenant-1",
    name: "Acme",
    slug,
    plan: "free",
  };
}

async function call(slug: string | null = "acme") {
  return createTenant(
    null,
    { input: { name: "Acme", slug, plan: "free" } },
    {} as any,
  ) as Promise<Record<string, unknown>>;
}

describe("createTenant slug validation", () => {
  beforeEach(() => {
    insertReturning.mockReset();
    mockGenerateSlug.mockReset();
    insertValues.value = null;
    vi.mocked(dbMock.insert).mockClear();
  });

  it("creates a tenant with a valid explicit slug", async () => {
    insertReturning.mockResolvedValue([tenantRow("acme")]);

    await expect(call("acme")).resolves.toMatchObject({
      id: "tenant-1",
      slug: "acme",
    });

    expect(insertValues.value).toMatchObject({ slug: "acme" });
  });

  it("validates the generated fallback slug too", async () => {
    mockGenerateSlug.mockReturnValue("generated-acme");
    insertReturning.mockResolvedValue([tenantRow("generated-acme")]);

    await expect(call(null)).resolves.toMatchObject({
      slug: "generated-acme",
    });

    expect(insertValues.value).toMatchObject({ slug: "generated-acme" });
  });

  it.each([
    "ab",
    "a".repeat(31),
    "-acme",
    "acme-",
    "Acme",
    "acme inc",
    "acme_inc",
  ])("rejects invalid slug shape %s", async (slug) => {
    await expect(call(slug)).rejects.toMatchObject({
      extensions: { code: "INVALID_SLUG" },
    });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it.each(RESERVED_TENANT_SLUGS)(
    "rejects reserved tenant slug %s",
    async (slug) => {
      await expect(call(slug)).rejects.toMatchObject({
        extensions: { code: "RESERVED_SLUG" },
      });
      expect(dbMock.insert).not.toHaveBeenCalled();
    },
  );

  it("maps database unique violations to SLUG_UNAVAILABLE", async () => {
    insertReturning.mockRejectedValue(
      Object.assign(new Error("duplicate key"), {
        code: "23505",
      }),
    );

    await expect(call("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_UNAVAILABLE" },
    });
  });
});
