/**
 * Eval Profile resolver contract tests (THINK-107 U2).
 *
 * Lifecycle invariants (default swap, archive guard, get-or-create) are
 * covered in src/lib/evals/eval-profiles.test.ts — these pin the boundary:
 * tenant scoping on reads (incl. Google-federated fallback), operator
 * gating before side effects, and model-catalog validation at the edge.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockResolveCallerTenantId,
  mockRequireTenantAdmin,
  mockGetCatalogEntry,
  mockLib,
} = vi.hoisted(() => ({
  mockResolveCallerTenantId: vi.fn(),
  mockRequireTenantAdmin: vi.fn(),
  mockGetCatalogEntry: vi.fn(),
  mockLib: {
    listEvalProfiles: vi.fn(),
    getEvalProfile: vi.fn(),
    createEvalProfile: vi.fn(),
    updateEvalProfile: vi.fn(),
    duplicateEvalProfile: vi.fn(),
    archiveEvalProfile: vi.fn(),
    setDefaultEvalProfile: vi.fn(),
  },
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../../../lib/model-catalog/tenant-catalog.js", () => ({
  getTenantModelCatalogEntry: mockGetCatalogEntry,
}));

vi.mock("../../../lib/evals/eval-profiles.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/evals/eval-profiles.js")>();
  return {
    ...actual,
    listEvalProfiles: mockLib.listEvalProfiles,
    getEvalProfile: mockLib.getEvalProfile,
    createEvalProfile: mockLib.createEvalProfile,
    updateEvalProfile: mockLib.updateEvalProfile,
    duplicateEvalProfile: mockLib.duplicateEvalProfile,
    archiveEvalProfile: mockLib.archiveEvalProfile,
    setDefaultEvalProfile: mockLib.setDefaultEvalProfile,
  };
});

import { evalProfileMutations, evalProfileQueries } from "./profiles.js";

const profileRow = (overrides: Record<string, unknown> = {}) => ({
  id: "profile-1",
  tenant_id: "tenant-1",
  name: "Default",
  model: "moonshotai.kimi-k2.5",
  judge_model: null,
  trials: 1,
  is_default: true,
  archived_at: null,
  created_at: new Date("2026-07-01T00:00:00Z"),
  updated_at: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const ctxWithTenant = { auth: { tenantId: "tenant-1" } } as any;
const ctxFederated = { auth: { tenantId: null } } as any;

beforeEach(() => {
  vi.resetAllMocks();
  mockRequireTenantAdmin.mockResolvedValue(undefined);
  mockGetCatalogEntry.mockResolvedValue({ modelId: "any" });
});

describe("evalProfiles query", () => {
  it("returns [] when the caller's tenant does not match", async () => {
    const result = await evalProfileQueries.evalProfiles(
      null,
      { tenantId: "other-tenant" },
      ctxWithTenant,
    );
    expect(result).toEqual([]);
    expect(mockLib.listEvalProfiles).not.toHaveBeenCalled();
  });

  it("resolves Google-federated callers through resolveCallerTenantId", async () => {
    mockResolveCallerTenantId.mockResolvedValue("tenant-1");
    mockLib.listEvalProfiles.mockResolvedValue([profileRow()]);
    const result = await evalProfileQueries.evalProfiles(
      null,
      { tenantId: "tenant-1" },
      ctxFederated,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "profile-1",
      name: "Default",
      isDefault: true,
    });
  });

  it("passes includeArchived through", async () => {
    mockLib.listEvalProfiles.mockResolvedValue([]);
    await evalProfileQueries.evalProfiles(
      null,
      { tenantId: "tenant-1", includeArchived: true },
      ctxWithTenant,
    );
    expect(mockLib.listEvalProfiles).toHaveBeenCalledWith("tenant-1", true);
  });
});

describe("createEvalProfile mutation", () => {
  it("gates with requireTenantAdmin before any side effect", async () => {
    mockRequireTenantAdmin.mockRejectedValue(new Error("denied"));
    await expect(
      evalProfileMutations.createEvalProfile(
        null,
        { tenantId: "tenant-1", input: { name: "X", model: "m" } },
        ctxWithTenant,
      ),
    ).rejects.toThrow("denied");
    expect(mockGetCatalogEntry).not.toHaveBeenCalled();
    expect(mockLib.createEvalProfile).not.toHaveBeenCalled();
  });

  it("rejects a model absent from the tenant catalog", async () => {
    mockGetCatalogEntry.mockResolvedValue(null);
    await expect(
      evalProfileMutations.createEvalProfile(
        null,
        { tenantId: "tenant-1", input: { name: "X", model: "nope" } },
        ctxWithTenant,
      ),
    ).rejects.toThrow(/not enabled in the tenant model catalog/);
    expect(mockLib.createEvalProfile).not.toHaveBeenCalled();
  });

  it("creates and renders the profile", async () => {
    mockLib.createEvalProfile.mockResolvedValue(
      profileRow({ is_default: false, name: "Candidate" }),
    );
    const result = await evalProfileMutations.createEvalProfile(
      null,
      {
        tenantId: "tenant-1",
        input: { name: "Candidate", model: "moonshotai.kimi-k2.5", trials: 3 },
      },
      ctxWithTenant,
    );
    expect(result).toMatchObject({ name: "Candidate", isDefault: false });
    expect(mockLib.createEvalProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", trials: 3 }),
    );
  });
});

describe("profile-id mutations", () => {
  it("gates on the PROFILE's tenant, not caller input", async () => {
    mockLib.getEvalProfile.mockResolvedValue(
      profileRow({ tenant_id: "tenant-2", is_default: false }),
    );
    mockLib.archiveEvalProfile.mockResolvedValue(
      profileRow({ tenant_id: "tenant-2", archived_at: new Date() }),
    );
    await evalProfileMutations.archiveEvalProfile(
      null,
      { id: "profile-1" },
      ctxWithTenant,
    );
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      ctxWithTenant,
      "tenant-2",
    );
  });

  it("returns NOT_FOUND for a missing profile before gating", async () => {
    mockLib.getEvalProfile.mockResolvedValue(null);
    await expect(
      evalProfileMutations.setDefaultEvalProfile(
        null,
        { id: "missing" },
        ctxWithTenant,
      ),
    ).rejects.toThrow(/Profile not found/);
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
  });

  it("validates a changed model against the profile's tenant catalog", async () => {
    mockLib.getEvalProfile.mockResolvedValue(profileRow());
    mockGetCatalogEntry.mockResolvedValue(null);
    await expect(
      evalProfileMutations.updateEvalProfile(
        null,
        { id: "profile-1", input: { model: "nope" } },
        ctxWithTenant,
      ),
    ).rejects.toThrow(/not enabled/);
    expect(mockGetCatalogEntry).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      modelId: "nope",
    });
  });

  it("duplicates through the lib", async () => {
    mockLib.getEvalProfile.mockResolvedValue(profileRow());
    mockLib.duplicateEvalProfile.mockResolvedValue(
      profileRow({ id: "profile-2", name: "Default copy", is_default: false }),
    );
    const result = await evalProfileMutations.duplicateEvalProfile(
      null,
      { id: "profile-1" },
      ctxWithTenant,
    );
    expect(result).toMatchObject({ id: "profile-2", name: "Default copy" });
  });
});
