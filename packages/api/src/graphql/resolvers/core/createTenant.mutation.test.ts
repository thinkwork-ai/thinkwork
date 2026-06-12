import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESERVED_TENANT_SLUGS } from "@thinkwork/database-pg/utils/reserved-slugs";
import { formatClaimComment } from "@thinkwork/namespace-registry";
import { db } from "../../utils.js";
import { createTenant } from "./createTenant.mutation.js";
import { __setNamespaceCheckDepsForTests } from "./tenantSlugValidation.js";

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

// Namespace-check injection (plan 2026-06-12-002 U5): the default is a
// free name — individual tests flip it to taken/erroring.
const namespaceListRecords = vi.fn();
const namespaceResolveToken = vi.fn();

function deploymentClaimRecord(slug: string) {
  return {
    id: "rec-1",
    type: "NS",
    name: `${slug}.thinkwork.ai`,
    content: "ns-123.awsdns-01.com",
    comment: formatClaimComment({
      kind: "deployment",
      owner: "tei-deploy",
      created: "2026-06-12",
    }),
  };
}

describe("createTenant slug validation", () => {
  beforeEach(() => {
    insertReturning.mockReset();
    mockGenerateSlug.mockReset();
    insertValues.value = null;
    vi.mocked(dbMock.insert).mockClear();
    namespaceListRecords.mockReset().mockResolvedValue([]);
    namespaceResolveToken.mockReset().mockResolvedValue("cf-token");
    __setNamespaceCheckDepsForTests({
      resolveToken: namespaceResolveToken,
      createDns: () => ({ listRecords: namespaceListRecords }),
    });
  });

  afterEach(() => {
    __setNamespaceCheckDepsForTests(null);
    vi.restoreAllMocks();
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
    "rejects reserved tenant slug %s with no Cloudflare call",
    async (slug) => {
      await expect(call(slug)).rejects.toMatchObject({
        extensions: { code: "RESERVED_SLUG" },
      });
      expect(dbMock.insert).not.toHaveBeenCalled();
      expect(namespaceListRecords).not.toHaveBeenCalled();
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

  it("rejects a deployment-claimed slug with SLUG_UNAVAILABLE and no insert (AE1)", async () => {
    namespaceListRecords.mockResolvedValue([deploymentClaimRecord("tei")]);

    const error = await call("tei").then(
      () => {
        throw new Error("expected createTenant to reject");
      },
      (err) => err,
    );

    expect(error.extensions).toMatchObject({ code: "SLUG_UNAVAILABLE" });
    // R5 — no record comment / deployment-owner leakage in the response.
    expect(
      JSON.stringify({ message: error.message, ext: error.extensions }),
    ).not.toContain("tei-deploy");
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("fails CLOSED on a Cloudflare API error — no tenant row is created", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    namespaceListRecords.mockRejectedValue(new Error("cloudflare 500"));

    await expect(call("acme")).rejects.toMatchObject({
      extensions: { code: "SLUG_VALIDATION_UNAVAILABLE" },
    });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("proceeds (with a loud log) when no namespace token is configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    namespaceResolveToken.mockResolvedValue(null);
    insertReturning.mockResolvedValue([tenantRow("acme")]);

    await expect(call("acme")).resolves.toMatchObject({ slug: "acme" });

    expect(namespaceListRecords).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Cloudflare namespace check SKIPPED"),
    );
  });
});
