/**
 * Eval dataset resolver tests (Evaluations Trust Core U4).
 *
 * Store behavior (S3-first writes, advisory-locked sync, lifecycle) is
 * covered in src/lib/evals/dataset-store.test.ts — these tests pin the
 * resolver contract: tenant scoping (incl. Google-federated fallback),
 * operator gating before side effects, row-derived tenant slug, slug
 * validation at the boundary, and archive-aware listing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  selectWheres,
  mockResolveCallerTenantId,
  mockRequireTenantAdmin,
  mockGetConfig,
  mockCreateDataset,
  mockRenameDataset,
  mockArchiveDataset,
  mockPutCase,
  mockGetCase,
  mockRemoveCase,
  mockReadDataset,
  resetState,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const selectWheres: unknown[] = [];
  return {
    selectQueue,
    selectWheres,
    mockResolveCallerTenantId: vi.fn(),
    mockRequireTenantAdmin: vi.fn(),
    mockGetConfig: vi.fn(),
    mockCreateDataset: vi.fn(),
    mockRenameDataset: vi.fn(),
    mockArchiveDataset: vi.fn(),
    mockPutCase: vi.fn(),
    mockGetCase: vi.fn(),
    mockRemoveCase: vi.fn(),
    mockReadDataset: vi.fn(),
    resetState: () => {
      selectQueue.length = 0;
      selectWheres.length = 0;
    },
  };
});

vi.mock("../../utils.js", () => {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const method of ["from", "orderBy", "limit"]) {
      chain[method] = () => chain;
    }
    chain.where = (clause: unknown) => {
      selectWheres.push(clause);
      return chain;
    };
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  };
  return {
    db: { select: () => makeSelectChain() },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    desc: (arg: unknown) => ({ desc: arg }),
    isNull: (arg: unknown) => ({ isNull: arg }),
    tenants: { id: "tenants.id", slug: "tenants.slug" },
  };
});

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("@thinkwork/runtime-config", () => ({
  getConfig: mockGetConfig,
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
}));

vi.mock("../../../lib/evals/dataset-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../lib/evals/dataset-store.js")
    >();
  return {
    ...actual,
    // Resolver logic never touches S3/Drizzle directly — the wiring
    // factories return sentinels the call-arg assertions can pin.
    createS3DatasetStorage: () => ({ kind: "storage-sentinel" }),
    createDrizzleDatasetIndexStore: () => ({ kind: "store-sentinel" }),
    createEvalDataset: mockCreateDataset,
    renameEvalDataset: mockRenameDataset,
    archiveEvalDataset: mockArchiveDataset,
    putEvalDatasetCase: mockPutCase,
    getEvalDatasetCase: mockGetCase,
    removeEvalDatasetCase: mockRemoveCase,
    readEvalDataset: mockReadDataset,
  };
});

import { evalDatasetMutations, evalDatasetQueries } from "./datasets.js";

const adminCtx = { auth: { authType: "cognito", tenantId: "tenant-1" } } as any;
const federatedCtx = { auth: { authType: "cognito", tenantId: null } } as any;
const forbidden = new Error("Tenant admin role required");

const tenantSlugRow = { slug: "acme" };
const datasetRow = {
  id: "ds-1",
  tenant_id: "tenant-1",
  slug: "flagged",
  name: "Flagged",
  kind: "custom",
  version: 2,
  manifest_sha: "sha-1",
  archived_at: null,
  created_at: new Date("2026-06-12T00:00:00Z"),
  updated_at: new Date("2026-06-12T00:00:00Z"),
};
const caseRow = {
  id: "case-row-1",
  tenant_id: "tenant-1",
  name: "Alpha",
  category: "red-team",
  query: "q",
  system_prompt: null,
  assertions: [],
  agentcore_evaluator_ids: ["Builtin.Helpfulness"],
  tags: [],
  enabled: true,
  source: "dataset",
  dataset_id: "ds-1",
  dataset_case_id: "case-alpha",
  created_at: new Date("2026-06-12T00:00:00Z"),
  updated_at: new Date("2026-06-12T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockRequireTenantAdmin.mockResolvedValue("admin");
  mockGetConfig.mockReturnValue("workspace-bucket");
  mockCreateDataset.mockResolvedValue({});
  mockRenameDataset.mockResolvedValue({});
  mockArchiveDataset.mockResolvedValue({});
  mockPutCase.mockResolvedValue({});
  mockGetCase.mockResolvedValue(null);
  mockRemoveCase.mockResolvedValue({});
  mockReadDataset.mockResolvedValue({ manifest: {}, resynced: false });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe("evalDatasets query", () => {
  it("returns an empty list for a foreign tenantId without querying", async () => {
    const result = await evalDatasetQueries.evalDatasets(
      {},
      { tenantId: "tenant-2" },
      adminCtx,
    );
    expect(result).toEqual([]);
    expect(selectWheres).toHaveLength(0);
  });

  it("hides archived datasets from the default listing", async () => {
    selectQueue.push([datasetRow]);
    const result = await evalDatasetQueries.evalDatasets(
      {},
      { tenantId: "tenant-1" },
      adminCtx,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "ds-1",
      slug: "flagged",
      version: 2,
      manifestSha: "sha-1",
      archivedAt: null,
    });
    // Default listing pins archived_at IS NULL alongside the tenant scope.
    const clause = selectWheres[0] as { and: Array<Record<string, unknown>> };
    expect(clause.and.some((c) => "isNull" in c)).toBe(true);
  });

  it("includes archived datasets when includeArchived is set", async () => {
    selectQueue.push([
      { ...datasetRow, archived_at: new Date("2026-06-12T01:00:00Z") },
    ]);
    const result = await evalDatasetQueries.evalDatasets(
      {},
      { tenantId: "tenant-1", includeArchived: true },
      adminCtx,
    );
    expect(result[0].archivedAt).toBeInstanceOf(Date);
    const clause = selectWheres[0] as { and: Array<Record<string, unknown>> };
    expect(clause.and.some((c) => "isNull" in c)).toBe(false);
  });

  it("resolves Google-federated callers via the fallback", async () => {
    selectQueue.push([datasetRow]);
    const result = await evalDatasetQueries.evalDatasets(
      {},
      { tenantId: "tenant-1" },
      federatedCtx,
    );
    expect(mockResolveCallerTenantId).toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });
});

describe("evalDataset query", () => {
  it("returns null cross-tenant without touching S3", async () => {
    const result = await evalDatasetQueries.evalDataset(
      {},
      { tenantId: "tenant-2", slug: "flagged" },
      adminCtx,
    );
    expect(result).toBeNull();
    expect(mockReadDataset).not.toHaveBeenCalled();
  });

  it("rejects a malformed slug before any S3 key is built", async () => {
    const result = await evalDatasetQueries.evalDataset(
      {},
      { tenantId: "tenant-1", slug: "../escape" },
      adminCtx,
    );
    expect(result).toBeNull();
    expect(mockReadDataset).not.toHaveBeenCalled();
  });

  it("drift-checks via readEvalDataset with the row-derived tenant slug", async () => {
    selectQueue.push([tenantSlugRow]); // tenants slug lookup
    selectQueue.push([datasetRow]); // index row after heal
    mockReadDataset.mockResolvedValue({ manifest: {}, resynced: true });

    const result = await evalDatasetQueries.evalDataset(
      {},
      { tenantId: "tenant-1", slug: "flagged" },
      adminCtx,
    );

    expect(mockReadDataset).toHaveBeenCalledWith(
      { tenantId: "tenant-1", tenantSlug: "acme", slug: "flagged" },
      { kind: "storage-sentinel" },
      { kind: "store-sentinel" },
    );
    expect(result).toMatchObject({ id: "ds-1", slug: "flagged" });
  });

  it("returns null when the dataset has no S3 manifest", async () => {
    selectQueue.push([tenantSlugRow]);
    mockReadDataset.mockResolvedValue(null);
    const result = await evalDatasetQueries.evalDataset(
      {},
      { tenantId: "tenant-1", slug: "flagged" },
      adminCtx,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

describe("createEvalDataset mutation", () => {
  it("gates before any side effect (no slug lookup, no store call)", async () => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);
    await expect(
      evalDatasetMutations.createEvalDataset(
        {},
        { tenantId: "tenant-2", input: { slug: "flagged" } },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(adminCtx, "tenant-2");
    expect(selectWheres).toHaveLength(0);
    expect(mockCreateDataset).not.toHaveBeenCalled();
  });

  it("rejects invalid slugs (traversal/uppercase/overlong) before side effects", async () => {
    for (const slug of ["../escape", "UPPER", "a".repeat(65)]) {
      await expect(
        evalDatasetMutations.createEvalDataset(
          {},
          { tenantId: "tenant-1", input: { slug } },
          adminCtx,
        ),
      ).rejects.toThrow(/Invalid dataset slug/);
    }
    expect(mockCreateDataset).not.toHaveBeenCalled();
    expect(selectWheres).toHaveLength(0);
  });

  it("creates through the store with a row-derived tenant slug", async () => {
    selectQueue.push([tenantSlugRow]); // tenants slug lookup
    selectQueue.push([datasetRow]); // index row read-back

    const result = await evalDatasetMutations.createEvalDataset(
      {},
      {
        tenantId: "tenant-1",
        input: { slug: "flagged", name: "Flagged", kind: "custom" },
      },
      adminCtx,
    );

    expect(mockCreateDataset).toHaveBeenCalledWith(
      { tenantId: "tenant-1", tenantSlug: "acme", slug: "flagged" },
      { name: "Flagged", kind: "custom" },
      { kind: "storage-sentinel" },
      { kind: "store-sentinel" },
    );
    expect(result).toMatchObject({
      id: "ds-1",
      tenantId: "tenant-1",
      slug: "flagged",
      kind: "custom",
    });
  });

  it("surfaces store rejections (duplicate dataset) as user errors", async () => {
    selectQueue.push([tenantSlugRow]);
    mockCreateDataset.mockRejectedValue(
      new Error("Dataset flagged already exists."),
    );
    await expect(
      evalDatasetMutations.createEvalDataset(
        {},
        { tenantId: "tenant-1", input: { slug: "flagged" } },
        adminCtx,
      ),
    ).rejects.toThrow(/already exists/);
  });
});

describe("archive / update dataset mutations", () => {
  it("archiveEvalDataset is operator-gated and soft-archives via the store", async () => {
    selectQueue.push([tenantSlugRow]);
    selectQueue.push([
      { ...datasetRow, archived_at: new Date("2026-06-12T01:00:00Z") },
    ]);

    const result = await evalDatasetMutations.archiveEvalDataset(
      {},
      { tenantId: "tenant-1", slug: "flagged" },
      adminCtx,
    );
    expect(mockArchiveDataset).toHaveBeenCalledWith(
      { tenantId: "tenant-1", tenantSlug: "acme", slug: "flagged" },
      { kind: "storage-sentinel" },
      { kind: "store-sentinel" },
    );
    expect(result.archivedAt).toBeInstanceOf(Date);
  });

  it("cross-tenant archive is forbidden with no store call", async () => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);
    await expect(
      evalDatasetMutations.archiveEvalDataset(
        {},
        { tenantId: "tenant-2", slug: "flagged" },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockArchiveDataset).not.toHaveBeenCalled();
  });

  it("updateEvalDataset renames via the store", async () => {
    selectQueue.push([tenantSlugRow]);
    selectQueue.push([{ ...datasetRow, name: "Renamed" }]);
    const result = await evalDatasetMutations.updateEvalDataset(
      {},
      { tenantId: "tenant-1", slug: "flagged", input: { name: "Renamed" } },
      adminCtx,
    );
    expect(mockRenameDataset).toHaveBeenCalledWith(
      { tenantId: "tenant-1", tenantSlug: "acme", slug: "flagged" },
      "Renamed",
      { kind: "storage-sentinel" },
      { kind: "store-sentinel" },
    );
    expect(result.name).toBe("Renamed");
  });
});

describe("dataset case mutations", () => {
  const caseInput = {
    caseId: "case-alpha",
    name: "Alpha",
    category: "red-team",
    query: "q",
    expectedBehavior: "refuses",
    agentcoreEvaluatorIds: ["Builtin.Helpfulness"],
  };

  it("addEvalDatasetCase writes an engine-neutral core with a namespaced engines block", async () => {
    selectQueue.push([tenantSlugRow]); // tenants slug lookup
    selectQueue.push([datasetRow]); // dataset row
    selectQueue.push([caseRow]); // synced case row

    const result = await evalDatasetMutations.addEvalDatasetCase(
      {},
      { tenantId: "tenant-1", datasetSlug: "flagged", input: caseInput },
      adminCtx,
    );

    const [dctx, core, engines] = mockPutCase.mock.calls[0];
    expect(dctx).toEqual({
      tenantId: "tenant-1",
      tenantSlug: "acme",
      slug: "flagged",
    });
    // Engine vocabulary never appears in core fields…
    expect(core).toEqual({
      case_id: "case-alpha",
      name: "Alpha",
      category: "red-team",
      query: "q",
      system_prompt: null,
      expected_behavior: "refuses",
      assertions: [],
      tags: [],
      enabled: true,
    });
    // …it lives only in the namespaced extension block.
    expect(engines).toEqual({
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
    expect(result).toMatchObject({
      id: "case-row-1",
      datasetId: "ds-1",
      datasetCaseId: "case-alpha",
    });
  });

  it("addEvalDatasetCase rejects a duplicate case id", async () => {
    selectQueue.push([tenantSlugRow]);
    mockGetCase.mockResolvedValue({ core: {}, engines: null });
    await expect(
      evalDatasetMutations.addEvalDatasetCase(
        {},
        { tenantId: "tenant-1", datasetSlug: "flagged", input: caseInput },
        adminCtx,
      ),
    ).rejects.toThrow(/already exists/);
    expect(mockPutCase).not.toHaveBeenCalled();
  });

  it("addEvalDatasetCase validates the case id before any S3 access", async () => {
    await expect(
      evalDatasetMutations.addEvalDatasetCase(
        {},
        {
          tenantId: "tenant-1",
          datasetSlug: "flagged",
          input: { ...caseInput, caseId: "../escape" },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/Invalid case id/);
    expect(mockGetCase).not.toHaveBeenCalled();
    expect(mockPutCase).not.toHaveBeenCalled();
  });

  it("updateEvalDatasetCase merges partial input over the existing case file", async () => {
    selectQueue.push([tenantSlugRow]);
    selectQueue.push([datasetRow]);
    selectQueue.push([caseRow]);
    mockGetCase.mockResolvedValue({
      core: {
        case_id: "case-alpha",
        name: "Alpha",
        category: "red-team",
        query: "original query",
        system_prompt: "keep me",
        expected_behavior: "refuses",
        assertions: [{ type: "contains", value: "x" }],
        tags: ["surface:chat"],
        enabled: true,
      },
      engines: { agentcore: { evaluator_ids: ["Builtin.Helpfulness"] } },
    });

    await evalDatasetMutations.updateEvalDatasetCase(
      {},
      {
        tenantId: "tenant-1",
        datasetSlug: "flagged",
        caseId: "case-alpha",
        input: { query: "edited query", enabled: false },
      },
      adminCtx,
    );

    const [, core, engines] = mockPutCase.mock.calls[0];
    expect(core).toMatchObject({
      query: "edited query",
      enabled: false,
      // Untouched fields preserved from the existing S3 case file.
      name: "Alpha",
      system_prompt: "keep me",
      expected_behavior: "refuses",
      tags: ["surface:chat"],
    });
    // Engines block preserved when agentcoreEvaluatorIds is omitted.
    expect(engines).toEqual({
      agentcore: { evaluator_ids: ["Builtin.Helpfulness"] },
    });
  });

  it("updateEvalDatasetCase on a missing case is NOT_FOUND with no write", async () => {
    selectQueue.push([tenantSlugRow]);
    mockGetCase.mockResolvedValue(null);
    await expect(
      evalDatasetMutations.updateEvalDatasetCase(
        {},
        {
          tenantId: "tenant-1",
          datasetSlug: "flagged",
          caseId: "case-alpha",
          input: { query: "x" },
        },
        adminCtx,
      ),
    ).rejects.toThrow(/not found/);
    expect(mockPutCase).not.toHaveBeenCalled();
  });

  it("removeEvalDatasetCase delegates to the tombstone path and returns the dataset", async () => {
    selectQueue.push([tenantSlugRow]);
    selectQueue.push([datasetRow]);
    const result = await evalDatasetMutations.removeEvalDatasetCase(
      {},
      { tenantId: "tenant-1", datasetSlug: "flagged", caseId: "case-alpha" },
      adminCtx,
    );
    expect(mockRemoveCase).toHaveBeenCalledWith(
      { tenantId: "tenant-1", tenantSlug: "acme", slug: "flagged" },
      "case-alpha",
      { kind: "storage-sentinel" },
      { kind: "store-sentinel" },
    );
    expect(result).toMatchObject({ id: "ds-1", slug: "flagged" });
  });

  it("cross-tenant case mutations are forbidden before any side effect", async () => {
    mockRequireTenantAdmin.mockRejectedValue(forbidden);
    await expect(
      evalDatasetMutations.addEvalDatasetCase(
        {},
        { tenantId: "tenant-2", datasetSlug: "flagged", input: caseInput },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    await expect(
      evalDatasetMutations.removeEvalDatasetCase(
        {},
        { tenantId: "tenant-2", datasetSlug: "flagged", caseId: "case-alpha" },
        adminCtx,
      ),
    ).rejects.toThrow("Tenant admin role required");
    expect(mockPutCase).not.toHaveBeenCalled();
    expect(mockRemoveCase).not.toHaveBeenCalled();
    expect(selectWheres).toHaveLength(0);
  });
});
