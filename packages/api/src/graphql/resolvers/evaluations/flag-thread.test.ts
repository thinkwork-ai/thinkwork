/**
 * flagThreadForEval resolver tests (Evaluations Trust Core U7).
 *
 * Snapshot construction is covered in src/lib/evals/thread-snapshot.test.ts
 * (the real builder runs here); these tests pin the resolver contract:
 * the tenant triangle BEFORE any S3 write, required resolution target
 * (AE3), turn/thread linkage, dataset targeting, write ordering
 * (payloads before the case file), and the completeness surface (F2).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  selectWheres,
  mockResolveCallerTenantId,
  mockRequireTenantAdmin,
  mockGetConfig,
  mockCreateDataset,
  mockPutCase,
  mockGetCase,
  mockWritePayloads,
  mockListIndexedSkills,
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
    mockPutCase: vi.fn(),
    mockGetCase: vi.fn(),
    mockWritePayloads: vi.fn(),
    mockListIndexedSkills: vi.fn(),
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
  const column = (table: string, name: string) => `${table}.${name}`;
  return {
    db: { select: () => makeSelectChain() },
    eq: (...args: unknown[]) => ({ eq: args }),
    and: (...args: unknown[]) => ({ and: args }),
    asc: (arg: unknown) => ({ asc: arg }),
    desc: (arg: unknown) => ({ desc: arg }),
    isNull: (arg: unknown) => ({ isNull: arg }),
    tenants: { id: column("tenants", "id"), slug: column("tenants", "slug") },
    threads: {
      id: column("threads", "id"),
      tenant_id: column("threads", "tenant_id"),
      title: column("threads", "title"),
    },
    threadTurns: {
      id: column("thread_turns", "id"),
      tenant_id: column("thread_turns", "tenant_id"),
      thread_id: column("thread_turns", "thread_id"),
      status: column("thread_turns", "status"),
      started_at: column("thread_turns", "started_at"),
      finished_at: column("thread_turns", "finished_at"),
      context_snapshot: column("thread_turns", "context_snapshot"),
    },
    messages: {
      id: column("messages", "id"),
      thread_id: column("messages", "thread_id"),
      tenant_id: column("messages", "tenant_id"),
      role: column("messages", "role"),
      content: column("messages", "content"),
      parts: column("messages", "parts"),
      tool_calls: column("messages", "tool_calls"),
      tool_results: column("messages", "tool_results"),
      created_at: column("messages", "created_at"),
    },
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
    createS3DatasetStorage: () => ({ kind: "storage-sentinel" }),
    createDrizzleDatasetIndexStore: () => ({ kind: "store-sentinel" }),
    createEvalDataset: mockCreateDataset,
    getEvalDatasetCase: mockGetCase,
    putEvalDatasetCase: mockPutCase,
  };
});

vi.mock("../../../lib/evals/thread-snapshot.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../lib/evals/thread-snapshot.js")
    >();
  return {
    ...actual,
    // The only S3 side effect besides putEvalDatasetCase — mocked so the
    // "zero S3 writes" assertions can count every write path.
    writeFlaggedCasePayloads: mockWritePayloads,
  };
});

// catalog-index drags S3/Drizzle for the real read path; the resolver only
// needs the installed catalog skill slugs, so mock the one entry point.
// (skill-dataset.js's slug helpers stay REAL — they're pure leaf functions.)
vi.mock("../../../lib/catalog-index.js", () => ({
  listIndexedSkills: mockListIndexedSkills,
}));

import { flagThreadMutations, flagThreadQueries } from "./flag-thread.js";

const flag = flagThreadMutations.flagThreadForEval as unknown as (
  p: unknown,
  args: { input: Record<string, unknown> },
  ctx: unknown,
) => Promise<{
  case: Record<string, unknown>;
  dataset: Record<string, unknown>;
  completeness: Record<string, boolean>;
}>;

const candidates = flagThreadQueries.flaggedTurnSkillCandidates as unknown as (
  p: unknown,
  args: { tenantId: string; threadId: string; turnId: string },
  ctx: unknown,
) => Promise<{
  candidates: Array<{ skillSlug: string; source: string }>;
  fallback: boolean;
}>;

const adminCtx = { auth: { authType: "cognito", tenantId: "tenant-1" } } as any;

const threadRow = {
  id: "thread-1",
  tenant_id: "tenant-1",
  title: "Quarterly numbers",
};
const projection = { renderedPrefix: "tenants/acme/threads/thread-1/" };
const turnRow = {
  id: "turn-1",
  tenant_id: "tenant-1",
  thread_id: "thread-1",
  status: "succeeded",
  started_at: new Date("2026-06-01T00:02:00Z"),
  finished_at: new Date("2026-06-01T00:03:00Z"),
  context_snapshot: { workspace_projection: projection },
};
const tenantSlugRow = { slug: "acme" };
const messageRows = [
  {
    id: "m1",
    role: "user",
    content: "the flagged ask",
    parts: null,
    tool_calls: null,
    tool_results: null,
    created_at: new Date("2026-06-01T00:01:00Z"),
  },
  {
    id: "m2",
    role: "assistant",
    content: "the bad answer",
    parts: null,
    tool_calls: [{ name: "read" }],
    tool_results: [{ name: "read", output: "x" }],
    created_at: new Date("2026-06-01T00:02:30Z"),
  },
];
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
  name: "Flagged: Quarterly numbers",
  category: "flagged-thread",
  query: "the flagged ask",
  system_prompt: null,
  assertions: [{ type: "llm-rubric", value: "Should not fabricate." }],
  agentcore_evaluator_ids: [],
  tags: ["flagged-thread", "quality"],
  enabled: true,
  source: "dataset",
  dataset_id: "ds-1",
  dataset_case_id: "flagged-thread1-turn1",
  created_at: new Date("2026-06-12T00:00:00Z"),
  updated_at: new Date("2026-06-12T00:00:00Z"),
};

const baseInput = {
  threadId: "thread-1",
  turnId: "turn-1",
  datasetSlug: "flagged",
  resolutionTarget: "Should not fabricate.",
  outcomeKind: "quality",
};

function queueHappyPathSelects() {
  // Order: thread → turn → tenant slug → dataset row → messages →
  // dataset row (return) → case row (return).
  selectQueue.push(
    [threadRow],
    [turnRow],
    [tenantSlugRow],
    [datasetRow],
    messageRows,
    [datasetRow],
    [caseRow],
  );
}

function expectNoS3Writes() {
  expect(mockWritePayloads).not.toHaveBeenCalled();
  expect(mockPutCase).not.toHaveBeenCalled();
  expect(mockCreateDataset).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
  mockResolveCallerTenantId.mockResolvedValue("tenant-1");
  mockRequireTenantAdmin.mockResolvedValue("admin");
  mockGetConfig.mockReturnValue("workspace-bucket");
  mockCreateDataset.mockResolvedValue({});
  mockPutCase.mockResolvedValue({});
  mockGetCase.mockResolvedValue(null);
  mockWritePayloads.mockResolvedValue([]);
  mockListIndexedSkills.mockResolvedValue([]);
});

describe("flagThreadForEval — input validation (AE3)", () => {
  it("rejects a missing resolution target with no case and no S3 writes", async () => {
    await expect(
      flag({}, { input: { ...baseInput, resolutionTarget: "   " } }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
    expect(selectWheres).toHaveLength(0); // rejected before any lookup
  });

  it("rejects an unknown outcome kind", async () => {
    await expect(
      flag({}, { input: { ...baseInput, outcomeKind: "vibes" } }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("rejects when both datasetSlug and newDatasetName are provided", async () => {
    await expect(
      flag(
        {},
        { input: { ...baseInput, newDatasetName: "Another" } },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("rejects when neither dataset target is provided", async () => {
    await expect(
      flag({}, { input: { ...baseInput, datasetSlug: null } }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });
});

describe("flagThreadForEval — tenant triangle", () => {
  it("unknown thread id → NOT_FOUND, zero S3 writes", async () => {
    selectQueue.push([]); // thread lookup
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expectNoS3Writes();
  });

  it("cross-tenant thread (authz failure) → NOT_FOUND, zero S3 writes", async () => {
    selectQueue.push([{ ...threadRow, tenant_id: "tenant-other" }]);
    mockRequireTenantAdmin.mockRejectedValue(
      new Error("Tenant admin role required"),
    );
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(
      adminCtx,
      "tenant-other",
    );
    expectNoS3Writes();
  });

  it("dataset that does not resolve under the thread's tenant → NOT_FOUND, zero S3 writes", async () => {
    // Tenant-scoped slug lookup: a dataset belonging to another tenant
    // can never resolve here — same outcome as a nonexistent slug.
    selectQueue.push([threadRow], [turnRow], [tenantSlugRow], []);
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expectNoS3Writes();
  });

  it("baseline dataset is not a valid flag target", async () => {
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [{ ...datasetRow, kind: "baseline" }],
    );
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("archived dataset is rejected", async () => {
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [{ ...datasetRow, archived_at: new Date() }],
    );
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });
});

describe("flagThreadForEval — turn validation", () => {
  it("turn not belonging to the thread → rejected, zero S3 writes", async () => {
    selectQueue.push([threadRow], [{ ...turnRow, thread_id: "thread-other" }]);
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("missing turn → rejected", async () => {
    selectQueue.push([threadRow], []);
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("in-flight turn → rejected, zero S3 writes", async () => {
    selectQueue.push([threadRow], [{ ...turnRow, status: "running" }]);
    await expect(
      flag({}, { input: baseInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });
});

describe("flagThreadForEval — happy path (F2)", () => {
  it("writes payloads then the case file, with provenance + completeness + rubric", async () => {
    queueHappyPathSelects();
    const result = await flag({}, { input: baseInput }, adminCtx);

    // Payload objects land BEFORE the case file.
    expect(mockWritePayloads).toHaveBeenCalledTimes(1);
    expect(mockPutCase).toHaveBeenCalledTimes(1);
    expect(mockWritePayloads.mock.invocationCallOrder[0]).toBeLessThan(
      mockPutCase.mock.invocationCallOrder[0],
    );

    const [payloadCtx, payloadCaseId, snapshot] =
      mockWritePayloads.mock.calls[0];
    expect(payloadCtx).toEqual({
      tenantId: "tenant-1",
      tenantSlug: "acme",
      slug: "flagged",
    });
    expect(payloadCaseId).toBe("flagged-thread1-turn1");
    expect(snapshot.history.messages.map((m: { id: string }) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(snapshot.workspace).toEqual(projection);

    const [caseCtx, core] = mockPutCase.mock.calls[0];
    expect(caseCtx).toEqual(payloadCtx);
    expect(core).toMatchObject({
      case_id: "flagged-thread1-turn1",
      category: "flagged-thread",
      query: "the flagged ask",
      tags: ["flagged-thread", "quality"],
      assertions: [{ type: "llm-rubric", value: "Should not fabricate." }],
      source: {
        source_thread_id: "thread-1",
        source_turn_id: "turn-1",
      },
      resolution_target: "Should not fabricate.",
      outcome_kind: "quality",
      completeness: {
        history: true,
        workspace: true,
        traces: true,
        truncated: false,
      },
    });

    // Result surfaces the synced index row + completeness record.
    expect(result.case).toMatchObject({
      id: "case-row-1",
      datasetCaseId: "flagged-thread1-turn1",
      datasetId: "ds-1",
    });
    expect(result.dataset).toMatchObject({ id: "ds-1", slug: "flagged" });
    expect(result.completeness).toEqual({
      history: true,
      workspace: true,
      traces: true,
      truncated: false,
    });
  });

  it("suffixes the case id on collision", async () => {
    queueHappyPathSelects();
    mockGetCase.mockResolvedValueOnce({ core: {}, engines: null });
    await flag({}, { input: baseInput }, adminCtx);
    expect(mockWritePayloads.mock.calls[0][1]).toBe("flagged-thread1-turn1-2");
    expect(mockPutCase.mock.calls[0][1].case_id).toBe(
      "flagged-thread1-turn1-2",
    );
  });

  it("pre-THNK-10 turn (no workspace_projection) → case created with workspace=false", async () => {
    selectQueue.push(
      [threadRow],
      [{ ...turnRow, context_snapshot: null }],
      [tenantSlugRow],
      [datasetRow],
      messageRows,
      [datasetRow],
      [caseRow],
    );
    const result = await flag({}, { input: baseInput }, adminCtx);
    expect(mockPutCase.mock.calls[0][1].completeness).toMatchObject({
      history: true,
      workspace: false,
    });
    expect(result.completeness.workspace).toBe(false);
  });

  it("very long thread → truncated payload with marker, case remains valid", async () => {
    const big = "x".repeat(200_000);
    const longRows = [
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `old-${i}`,
        role: "assistant",
        content: big,
        parts: null,
        tool_calls: null,
        tool_results: null,
        created_at: new Date(Date.parse("2026-06-01T00:00:00Z") + i * 1000),
      })),
      ...messageRows,
    ];
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [datasetRow],
      longRows,
      [datasetRow],
      [caseRow],
    );
    const result = await flag({}, { input: baseInput }, adminCtx);
    const snapshot = mockWritePayloads.mock.calls[0][2];
    expect(snapshot.history.dropped_oldest_count).toBeGreaterThan(0);
    expect(snapshot.history.flagged_message_id).toBe("m1");
    expect(mockPutCase.mock.calls[0][1].completeness.truncated).toBe(true);
    expect(result.completeness.truncated).toBe(true);
  });
});

describe("flagThreadForEval — new dataset path", () => {
  const newInput = {
    ...baseInput,
    datasetSlug: null,
    newDatasetName: "My Bad Threads",
  };

  it("creates a custom dataset from the name and flags into it", async () => {
    // Order: thread → turn → tenant slug → (create, mocked) → messages →
    // dataset row (return) → case row (return).
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      messageRows,
      [{ ...datasetRow, slug: "my-bad-threads", name: "My Bad Threads" }],
      [caseRow],
    );
    const result = await flag({}, { input: newInput }, adminCtx);
    expect(mockCreateDataset).toHaveBeenCalledTimes(1);
    const [dctx, createInput] = mockCreateDataset.mock.calls[0];
    expect(dctx).toEqual({
      tenantId: "tenant-1",
      tenantSlug: "acme",
      slug: "my-bad-threads",
    });
    expect(createInput).toEqual({ name: "My Bad Threads", kind: "custom" });
    expect(result.dataset).toMatchObject({ slug: "my-bad-threads" });
  });

  it("suffixes the dataset slug when the derived slug already exists", async () => {
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      messageRows,
      [{ ...datasetRow, slug: "my-bad-threads-2" }],
      [caseRow],
    );
    mockCreateDataset
      .mockRejectedValueOnce(
        new Error("Dataset my-bad-threads already exists."),
      )
      .mockResolvedValueOnce({});
    await flag({}, { input: newInput }, adminCtx);
    expect(mockCreateDataset).toHaveBeenCalledTimes(2);
    expect(mockCreateDataset.mock.calls[1][0]).toMatchObject({
      slug: "my-bad-threads-2",
    });
    expect(mockWritePayloads.mock.calls[0][0]).toMatchObject({
      slug: "my-bad-threads-2",
    });
  });
});

describe("flagThreadForEval — three-way guard (U8)", () => {
  const skillInput = {
    ...baseInput,
    datasetSlug: null,
    skillSlug: "sql-helper",
  };

  it("rejects when zero targets are provided", async () => {
    await expect(
      flag(
        {},
        { input: { ...baseInput, datasetSlug: null, skillSlug: null } },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
    expect(selectWheres).toHaveLength(0);
  });

  it("rejects skillSlug + datasetSlug (two targets)", async () => {
    await expect(
      flag({}, { input: { ...baseInput, skillSlug: "sql-helper" } }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("rejects skillSlug + newDatasetName (two targets)", async () => {
    await expect(
      flag(
        {},
        {
          input: {
            ...baseInput,
            datasetSlug: null,
            skillSlug: "sql-helper",
            newDatasetName: "Custom",
          },
        },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("rejects all three targets at once", async () => {
    await expect(
      flag(
        {},
        {
          input: { ...skillInput, datasetSlug: "flagged", newDatasetName: "X" },
        },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("rejects a skillSlug that cannot form a valid skill dataset slug", async () => {
    await expect(
      flag(
        {},
        // Uppercase / invalid charset → skillEvalDatasetSlug throws → bad input.
        { input: { ...skillInput, skillSlug: "Bad Slug!" } },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
    expect(selectWheres).toHaveLength(0); // rejected before any lookup
  });
});

describe("flagThreadForEval — skill attribution (U8 / AE4)", () => {
  const skillInput = {
    ...baseInput,
    datasetSlug: null,
    skillSlug: "sql-helper",
  };
  const skillDatasetRow = {
    ...datasetRow,
    slug: "skill-sql-helper",
    name: "Skill: sql-helper",
    kind: "skill",
  };

  it("routes into skill-<slug>, creating the dataset when absent, with NO origin:bundled tag", async () => {
    // Order: thread → turn → tenant slug → skill dataset lookup (ABSENT) →
    // (create, mocked) → messages → dataset row (return) → case row (return).
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [], // skill dataset does not exist yet
      messageRows,
      [skillDatasetRow],
      [caseRow],
    );
    const result = await flag({}, { input: skillInput }, adminCtx);

    // Created the skill dataset with kind:'skill'.
    expect(mockCreateDataset).toHaveBeenCalledTimes(1);
    const [createCtx, createInput] = mockCreateDataset.mock.calls[0];
    expect(createCtx).toEqual({
      tenantId: "tenant-1",
      tenantSlug: "acme",
      slug: "skill-sql-helper",
    });
    expect(createInput).toEqual({ name: "Skill: sql-helper", kind: "skill" });

    // Case routed into the skill dataset's prefix.
    expect(mockWritePayloads.mock.calls[0][0]).toMatchObject({
      slug: "skill-sql-helper",
    });
    const core = mockPutCase.mock.calls[0][1];
    expect(mockPutCase.mock.calls[0][0]).toMatchObject({
      slug: "skill-sql-helper",
    });
    // A re-sync of the skill would only tombstone origin:bundled cases —
    // this flagged case must NOT carry that tag, so it survives.
    expect(core.tags).not.toContain("origin:bundled");
    // And no fallback tag when attributionFallback is not set.
    expect(core.tags).not.toContain("attribution:fallback");
    expect(result.dataset).toMatchObject({ slug: "skill-sql-helper" });
  });

  it("uses an EXISTING skill dataset (kind:'skill') as a flag target without re-creating it", async () => {
    // Skill dataset already exists → no createDataset call.
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [skillDatasetRow], // present
      messageRows,
      [skillDatasetRow],
      [caseRow],
    );
    await flag({}, { input: skillInput }, adminCtx);
    expect(mockCreateDataset).not.toHaveBeenCalled();
    expect(mockPutCase.mock.calls[0][0]).toMatchObject({
      slug: "skill-sql-helper",
    });
  });

  it("tolerates an 'already exists' race when creating the skill dataset", async () => {
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [], // absent at read time
      messageRows,
      [skillDatasetRow],
      [caseRow],
    );
    mockCreateDataset.mockRejectedValueOnce(
      new Error("Dataset skill-sql-helper already exists."),
    );
    const result = await flag({}, { input: skillInput }, adminCtx);
    expect(result.dataset).toMatchObject({ slug: "skill-sql-helper" });
    expect(mockPutCase).toHaveBeenCalledTimes(1);
  });

  it("attributionFallback adds the attribution:fallback tag", async () => {
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [skillDatasetRow],
      messageRows,
      [skillDatasetRow],
      [caseRow],
    );
    await flag(
      {},
      { input: { ...skillInput, attributionFallback: true } },
      adminCtx,
    );
    const core = mockPutCase.mock.calls[0][1];
    expect(core.tags).toContain("attribution:fallback");
    expect(core.tags).not.toContain("origin:bundled");
  });

  it("rejects an archived skill dataset", async () => {
    selectQueue.push(
      [threadRow],
      [turnRow],
      [tenantSlugRow],
      [{ ...skillDatasetRow, archived_at: new Date() }],
    );
    await expect(
      flag({}, { input: skillInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT" } });
    expectNoS3Writes();
  });

  it("cross-tenant thread (authz failure) → NOT_FOUND, zero S3 writes", async () => {
    selectQueue.push([{ ...threadRow, tenant_id: "tenant-other" }]);
    mockRequireTenantAdmin.mockRejectedValue(
      new Error("Tenant admin role required"),
    );
    await expect(
      flag({}, { input: skillInput }, adminCtx),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
    expectNoS3Writes();
  });
});

describe("flaggedTurnSkillCandidates (U8)", () => {
  const installedSkills = [
    { slug: "sql-helper" },
    { slug: "calendar" },
    { slug: "weather" },
  ];

  it("activeSkills present → active candidates intersected with installed, fallback:false", async () => {
    // thread → turn (carries activeSkills) ; listIndexedSkills is mocked.
    selectQueue.push(
      [{ id: "thread-1", tenant_id: "tenant-1" }],
      [
        {
          id: "turn-1",
          tenant_id: "tenant-1",
          thread_id: "thread-1",
          // 'always-on-default' is NOT an installed catalog skill → dropped.
          context_snapshot: {
            workspace_projection: {
              activeSkills: ["sql-helper", "always-on-default", "calendar"],
            },
          },
        },
      ],
    );
    mockListIndexedSkills.mockResolvedValue(installedSkills);
    const result = await candidates(
      {},
      { tenantId: "tenant-1", threadId: "thread-1", turnId: "turn-1" },
      adminCtx,
    );
    expect(result.fallback).toBe(false);
    expect(result.candidates).toEqual([
      { skillSlug: "sql-helper", source: "active" },
      { skillSlug: "calendar", source: "active" },
    ]);
  });

  it("activeSkills absent (older turn) → installed fallback, fallback:true", async () => {
    selectQueue.push(
      [{ id: "thread-1", tenant_id: "tenant-1" }],
      [
        {
          id: "turn-1",
          tenant_id: "tenant-1",
          thread_id: "thread-1",
          context_snapshot: null,
        },
      ],
    );
    mockListIndexedSkills.mockResolvedValue(installedSkills);
    const result = await candidates(
      {},
      { tenantId: "tenant-1", threadId: "thread-1", turnId: "turn-1" },
      adminCtx,
    );
    expect(result.fallback).toBe(true);
    expect(result.candidates).toEqual([
      { skillSlug: "sql-helper", source: "installed" },
      { skillSlug: "calendar", source: "installed" },
      { skillSlug: "weather", source: "installed" },
    ]);
  });

  it("activeSkills present but none installed → installed fallback, fallback:true", async () => {
    selectQueue.push(
      [{ id: "thread-1", tenant_id: "tenant-1" }],
      [
        {
          id: "turn-1",
          tenant_id: "tenant-1",
          thread_id: "thread-1",
          context_snapshot: {
            workspace_projection: { activeSkills: ["uninstalled-skill"] },
          },
        },
      ],
    );
    mockListIndexedSkills.mockResolvedValue(installedSkills);
    const result = await candidates(
      {},
      { tenantId: "tenant-1", threadId: "thread-1", turnId: "turn-1" },
      adminCtx,
    );
    expect(result.fallback).toBe(true);
    expect(result.candidates.map((c) => c.skillSlug)).toEqual([
      "sql-helper",
      "calendar",
      "weather",
    ]);
  });

  it("turn not in thread → NOT_FOUND", async () => {
    selectQueue.push(
      [{ id: "thread-1", tenant_id: "tenant-1" }],
      [
        {
          id: "turn-1",
          tenant_id: "tenant-1",
          thread_id: "thread-other",
          context_snapshot: null,
        },
      ],
    );
    await expect(
      candidates(
        {},
        { tenantId: "tenant-1", threadId: "thread-1", turnId: "turn-1" },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("unknown thread → NOT_FOUND", async () => {
    selectQueue.push([]); // thread lookup empty
    await expect(
      candidates(
        {},
        { tenantId: "tenant-1", threadId: "thread-x", turnId: "turn-1" },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });

  it("cross-tenant request → NOT_FOUND (no existence oracle)", async () => {
    mockResolveCallerTenantId.mockResolvedValue("tenant-1");
    await expect(
      candidates(
        {},
        { tenantId: "tenant-other", threadId: "thread-1", turnId: "turn-1" },
        adminCtx,
      ),
    ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } });
  });
});
