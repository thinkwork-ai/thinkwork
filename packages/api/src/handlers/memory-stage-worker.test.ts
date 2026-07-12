import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  getProcessorConfig: vi.fn(),
  getSourceConfig: vi.fn(),
  listEnabledSourceConfigs: vi.fn(),
}));
const stageMocks = vi.hoisted(() => ({
  runAcquire: vi.fn(),
}));

vi.mock("../lib/memory-sources/stages.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/memory-sources/stages.js")>();
  return {
    ...actual,
    runAcquire: stageMocks.runAcquire,
  };
});

vi.mock("../lib/memory-sources/repository.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../lib/memory-sources/repository.js")
    >();
  return {
    ...actual,
    getProcessorConfig: repoMocks.getProcessorConfig,
    getSourceConfig: repoMocks.getSourceConfig,
    listEnabledSourceConfigs: repoMocks.listEnabledSourceConfigs,
  };
});

vi.mock("../lib/memory-sources/adapters/twenty.js", () => ({
  acquireCompaniesPage: vi.fn(),
  buildCompanyDossier: vi.fn(),
  checkTwentyReadiness: vi.fn(),
  hindsightDocumentIdFor: (s: string, k: string) => `external:${s}:${k}`,
  projectionKeyForCompany: (id: string) => `company:${id}`,
}));

vi.mock("../lib/memory/index.js", () => ({
  getMemoryServices: vi.fn(() => ({
    adapter: {},
    config: { engine: "hindsight" },
  })),
}));

vi.mock("../lib/brain/dream/runner.js", () => ({
  runBrainDreamState: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: vi.fn(),
  claimTaskTokenExecution: vi.fn(),
  persistTaskTokenResult: vi.fn(),
  renewTaskTokenLease: vi.fn(),
}));

import { runMemoryStageWorker } from "./memory-stage-worker.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const RUN_ID = "9b1f74a2-40c5-4b34-9a49-27f1b7f9a111";
const PROC_ID = "11111111-1111-4111-8111-111111111111";
const SRC_ID = "22222222-2222-4222-8222-222222222222";
const STALE_MS = 600_000;

// ---------------------------------------------------------------------------
// In-memory token row + injectable tokenOps mirroring the durable-claim CAS
// semantics of workflow-interpreter-db (pending -> executing -> consumed,
// stale-lease re-claim, redrive on consumed+result).
// ---------------------------------------------------------------------------

interface TokenRow {
  status: "pending" | "executing" | "consumed" | "expired";
  token: string;
  result: unknown;
  locked_at: Date | null;
  locked_by: string | null;
}

function makeTokenOps(initial: TokenRow | null) {
  const state: { row: TokenRow | null } = { row: initial };
  const claim = vi.fn(
    async (
      _db: unknown,
      input: { lockedBy: string; now?: Date; staleAfterMs?: number },
    ) => {
      const row = state.row;
      if (!row) return null;
      const now = input.now ?? new Date();
      const staleBefore = new Date(
        now.getTime() - (input.staleAfterMs ?? STALE_MS),
      );
      if (
        row.status === "pending" ||
        (row.status === "executing" &&
          row.locked_at !== null &&
          row.locked_at < staleBefore)
      ) {
        row.status = "executing";
        row.locked_at = now;
        row.locked_by = input.lockedBy;
        return { token: row.token };
      }
      if (row.status === "consumed" && row.result != null) {
        return { redrive: { token: row.token, result: row.result } };
      }
      return null;
    },
  );
  const persist = vi.fn(async (_db: unknown, input: { result: unknown }) => {
    const row = state.row;
    if (!row || row.status !== "executing") return null;
    row.status = "consumed";
    row.result = input.result;
    return { token: row.token };
  });
  const renewLease = vi.fn(async () => true);
  return {
    state,
    tokenOps: { claim, persist, renewLease } as never,
    claim,
    persist,
  };
}

function pendingRow(overrides: Partial<TokenRow> = {}): TokenRow {
  return {
    status: "pending",
    token: "tok-1",
    result: null,
    locked_at: null,
    locked_by: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fakeDb: binding validation issues two selects (run row, then version row);
// results pop from a queue.
// ---------------------------------------------------------------------------

function definitionSnapshot(stepOverrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    steps: [
      {
        id: "acquire-twenty",
        kind: "memory_stage",
        stage: "acquire",
        processorConfigId: PROC_ID,
        sourceConfigId: SRC_ID,
        ...stepOverrides,
      },
    ],
  };
}

function bindingSelects(
  stepOverrides: Record<string, unknown> = {},
): unknown[][] {
  return [
    [{ tenant_id: TENANT_ID, workflow_version_id: "ver-1" }],
    [{ definition_snapshot: definitionSnapshot(stepOverrides) }],
  ];
}

function fakeDb(selects: unknown[][] = bindingSelects()) {
  const queue = [...selects];
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => queue.shift() ?? [],
        }),
      }),
    }),
  } as never;
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    workflowRunId: RUN_ID,
    tenantId: TENANT_ID,
    stepId: "acquire-twenty",
    iteration: 1,
    stage: "acquire",
    processorConfigId: PROC_ID,
    sourceConfigId: SRC_ID,
    options: null,
    ...overrides,
  } as never;
}

function activeProcessor(overrides: Record<string, unknown> = {}) {
  return {
    id: PROC_ID,
    tenant_id: TENANT_ID,
    mode: "shared",
    target_scope: "tenant",
    target_id: TENANT_ID,
    enabled: true,
    status: "active",
    created_by_user_id: "33333333-3333-4333-8333-333333333333",
    ...overrides,
  };
}

describe("memory-stage-worker", () => {
  const sfnSend = vi.fn();
  const sfn = { send: sfnSend } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    sfnSend.mockResolvedValue({});
  });

  it("rejects a personal/user-scoped processor on the shared-only graph stage (R11/AE7)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    const { state, tokenOps } = makeTokenOps(pendingRow());

    const { result, resume } = await runMemoryStageWorker(
      baseEvent({ stage: "graph" }),
      {
        db: fakeDb(bindingSelects({ stage: "graph" })),
        sfnClient: sfn,
        tokenOps,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/shared|scope/i);
    expect(resume).toBe("resumed");
    const output = JSON.parse(
      sfnSend.mock.calls[0]?.[0]?.input?.output as string,
    );
    expect(output.status).toBe("failed");
    // Persist-then-send: the failed result is durable on the consumed row.
    expect(state.row?.status).toBe("consumed");
    expect((state.row?.result as { status?: string })?.status).toBe("failed");
  });

  it("wiki runs as a shared-only stub for shared processors (U3)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    repoMocks.getSourceConfig.mockResolvedValue({
      source: {
        id: SRC_ID,
        source_family: "twenty",
        enabled: true,
        boundary: {},
      },
      processor: activeProcessor(),
    });
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result } = await runMemoryStageWorker(
      baseEvent({ stage: "wiki" }),
      {
        db: fakeDb(bindingSelects({ stage: "wiki" })),
        sfnClient: sfn,
        tokenOps,
      },
    );

    // assertTargetInTenant's tenant target check passes (target_id ===
    // tenant_id), then the U4-deferred stub records a visible no-op.
    expect(result.status).toBe("succeeded");
    expect(result.output?.note).toContain("U4");
  });

  it("wiki hard-rejects a user_* target bank (AE7)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result } = await runMemoryStageWorker(
      baseEvent({ stage: "wiki" }),
      {
        db: fakeDb(bindingSelects({ stage: "wiki" })),
        sfnClient: sfn,
        tokenOps,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/shared/i);
  });

  it("omitted sourceConfigId runs the processor's enabled sources; zero sources is a visible no-op (U3)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    repoMocks.listEnabledSourceConfigs.mockResolvedValue([]);
    const { tokenOps } = makeTokenOps(pendingRow());
    stageMocks.runAcquire.mockImplementation(
      (
        await vi.importActual<typeof import("../lib/memory-sources/stages.js")>(
          "../lib/memory-sources/stages.js",
        )
      ).runAcquire,
    );

    const { result } = await runMemoryStageWorker(
      baseEvent({ sourceConfigId: null }),
      {
        db: fakeDb(bindingSelects({ sourceConfigId: undefined })),
        sfnClient: sfn,
        tokenOps,
      },
    );

    expect(repoMocks.listEnabledSourceConfigs).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: TENANT_ID, processorConfigId: PROC_ID },
    );
    expect(result.status).toBe("succeeded");
    expect(result.counts?.noop).toBe(1);
  });

  it("an approved-plan override narrows the source set by INTERSECTION (U3)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    repoMocks.listEnabledSourceConfigs.mockResolvedValue([
      { id: SRC_ID, source_family: "twenty", enabled: true, boundary: {} },
      {
        id: "44444444-4444-4444-8444-444444444444",
        source_family: "twenty",
        enabled: true,
        boundary: {},
      },
    ]);
    const { tokenOps } = makeTokenOps(pendingRow());
    stageMocks.runAcquire.mockImplementation(async (ctx) => ({
      status: "succeeded",
      stage: "acquire",
      counts: { sources: (ctx as { sources: unknown[] }).sources.length },
    }));

    const { result } = await runMemoryStageWorker(
      baseEvent({
        sourceConfigId: null,
        // "not-configured" is outside the processor's sources — it selects
        // nothing extra; only SRC_ID survives the intersection.
        options: { override: { sourceConfigIds: [SRC_ID, "not-configured"] } },
      }),
      {
        db: fakeDb(bindingSelects({ sourceConfigId: undefined })),
        sfnClient: sfn,
        tokenOps,
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.counts?.sources).toBe(1);
  });

  it("rejects a personal processor bound to a shared-only source family (U3)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    repoMocks.listEnabledSourceConfigs.mockResolvedValue([
      { id: SRC_ID, source_family: "twenty", enabled: true, boundary: {} },
    ]);
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result } = await runMemoryStageWorker(
      baseEvent({ sourceConfigId: null }),
      {
        db: fakeDb([
          ...bindingSelects({ sourceConfigId: undefined }),
          [{ id: "user-1" }], // assertTargetInTenant: user belongs to tenant
        ]),
        sfnClient: sfn,
        tokenOps,
      },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/shared-only source famil/);
  });

  it("a crashed stage still resumes the token as a failed result — never parks forever", async () => {
    repoMocks.getProcessorConfig.mockRejectedValue(
      new Error("db exploded mid-read"),
    );
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("db exploded");
    expect(resume).toBe("resumed");
  });

  it("duplicate invoke without a claimable token performs ZERO stage side effects (F1)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    // No token row at all — e.g. a direct/forged invocation.
    const { tokenOps } = makeTokenOps(null);

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
    });

    // The stage pipeline must never start when no token is claimable —
    // a duplicate/direct invocation must not touch sources or banks.
    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
    expect(sfnSend).not.toHaveBeenCalled();
    expect(resume).toBe("no_claim");
    expect(result.status).toBe("failed");
  });

  it("a live (non-stale) executing claim is not re-claimable — duplicate performs zero side effects", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    const { tokenOps } = makeTokenOps(
      pendingRow({
        status: "executing",
        locked_at: new Date(Date.now() - 30_000),
        locked_by: "other-worker",
      }),
    );

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
    });

    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
    expect(sfnSend).not.toHaveBeenCalled();
    expect(resume).toBe("no_claim");
  });

  it("consumed token with a persisted result redrives the send WITHOUT executing (F9)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    const persistedResult = {
      status: "succeeded",
      stage: "acquire",
      counts: { changed: 3 },
    };
    const { tokenOps } = makeTokenOps(
      pendingRow({ status: "consumed", result: persistedResult }),
    );

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
    });

    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
    expect(resume).toBe("redriven");
    expect(result).toEqual(persistedResult);
    const call = sfnSend.mock.calls[0]?.[0]?.input;
    expect(call?.taskToken).toBe("tok-1");
    expect(JSON.parse(call?.output as string)).toEqual(persistedResult);
  });

  it("a redrive tolerates TaskTimedOut as already_resolved", async () => {
    const { tokenOps } = makeTokenOps(
      pendingRow({
        status: "consumed",
        result: { status: "succeeded", stage: "acquire" },
      }),
    );
    sfnSend.mockRejectedValue(
      Object.assign(new Error("timed out"), { name: "TaskTimedOut" }),
    );

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
    });

    expect(resume).toBe("already_resolved");
    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
  });

  it("a stale executing claim (crashed worker) is re-claimed and executes (F7)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    const { state, tokenOps } = makeTokenOps(
      pendingRow({
        status: "executing",
        locked_at: new Date(Date.now() - STALE_MS - 60_000),
        locked_by: "crashed-worker",
      }),
    );

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
      lockedBy: "retry-worker",
    });

    // The retry took over the stale lease and ran to a (visible) result.
    expect(repoMocks.getProcessorConfig).toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(resume).toBe("resumed");
    expect(state.row?.status).toBe("consumed");
  });

  it("SendTaskSuccess failure leaves the result durably consumed and returns persisted_unsent (F9)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    const { state, tokenOps } = makeTokenOps(pendingRow());
    sfnSend.mockRejectedValue(
      Object.assign(new Error("throttled"), { name: "ThrottlingException" }),
    );

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
    });

    expect(resume).toBe("persisted_unsent");
    // No revert-to-pending: the row stays consumed with its result attached
    // so a re-invoke takes the redrive path instead of re-executing.
    expect(state.row?.status).toBe("consumed");
    expect(state.row?.result).not.toBeNull();
  });

  it("binding mismatch (payload stage != definition stage) fails visibly with zero stage execution (F1)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    const { state, tokenOps } = makeTokenOps(pendingRow());

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(bindingSelects({ stage: "retain" })),
      sfnClient: sfn,
      tokenOps,
    });

    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/stage mismatch/i);
    expect(resume).toBe("resumed");
    // The failed result is persisted and the machine resumed — visible, not parked.
    expect(state.row?.status).toBe("consumed");
    const output = JSON.parse(
      sfnSend.mock.calls[0]?.[0]?.input?.output as string,
    );
    expect(output.status).toBe("failed");
  });

  it("binding mismatch (processorConfigId differs from a literal definition value) refuses execution", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result } = await runMemoryStageWorker(
      baseEvent({ processorConfigId: "99999999-9999-4999-8999-999999999999" }),
      { db: fakeDb(), sfnClient: sfn, tokenOps },
    );

    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/processorConfigId mismatch/i);
  });

  it("a templated definition processorConfigId skips the equality check and executes", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(
        bindingSelects({
          processorConfigId: "{{ run.input.processorConfigId }}",
        }),
      ),
      sfnClient: sfn,
      tokenOps,
    });

    // Reached the stage pipeline (which enforces tenant ownership itself:
    // the fake db has no user/member rows, so target validation rejects).
    expect(repoMocks.getProcessorConfig).toHaveBeenCalled();
    expect(result.error).toMatch(/does not belong/i);
  });

  it("wrong-tenant run fails the binding without stage execution", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    const { tokenOps } = makeTokenOps(pendingRow());

    const { result } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb([
        [
          {
            tenant_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            workflow_version_id: "ver-1",
          },
        ],
      ]),
      sfnClient: sfn,
      tokenOps,
    });

    expect(repoMocks.getProcessorConfig).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/another tenant/i);
  });

  it("passes a renewable lease through to the stage context (F7 continuation seam)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    repoMocks.getSourceConfig.mockResolvedValue({
      source: {
        id: SRC_ID,
        source_family: "twenty",
        enabled: true,
        boundary: {},
      },
      processor: activeProcessor(),
    });
    const { state, tokenOps } = makeTokenOps(pendingRow());
    const ops = tokenOps as unknown as { renewLease: ReturnType<typeof vi.fn> };
    let leaseRenewed: boolean | undefined;
    stageMocks.runAcquire.mockImplementation(
      async (ctx: {
        lease?: { lockedBy: string; renew(): Promise<boolean> };
      }) => {
        expect(ctx.lease?.lockedBy).toBe("lease-holder");
        leaseRenewed = await ctx.lease?.renew();
        return { status: "succeeded", stage: "acquire", counts: { seen: 1 } };
      },
    );

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
      tokenOps,
      lockedBy: "lease-holder",
    });

    expect(result.status).toBe("succeeded");
    expect(resume).toBe("resumed");
    expect(leaseRenewed).toBe(true);
    expect(ops.renewLease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workflowRunId: RUN_ID,
        stepId: "acquire-twenty",
        iteration: 1,
        purpose: "memory_stage",
        lockedBy: "lease-holder",
      }),
    );
    expect(state.row?.status).toBe("consumed");
  });
});

describe("memory-stage-worker continuation (F7)", () => {
  function continuationSetup() {
    const { state, tokenOps } = makeTokenOps(pendingRow());
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    repoMocks.getSourceConfig.mockResolvedValue({
      source: {
        id: SRC_ID,
        source_family: "twenty",
        enabled: true,
        boundary: {},
      },
      processor: activeProcessor(),
    });
    stageMocks.runAcquire.mockResolvedValue({
      status: "succeeded",
      stage: "acquire",
      counts: { changed: 25 },
      output: { continuation: true, remaining: 40 },
    });
    return { state, tokenOps };
  }

  it("re-invokes itself instead of resuming when a bounded stage left work", async () => {
    const { state, tokenOps } = continuationSetup();
    const selfInvoke = vi.fn(async () => {});
    const sfnSend = vi.fn();

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: { send: sfnSend } as never,
      tokenOps,
      lockedBy: "lease-holder",
      selfInvoke,
    });

    expect(resume).toBe("continuation");
    expect(selfInvoke).toHaveBeenCalledTimes(1);
    expect(sfnSend).not.toHaveBeenCalled();
    // Token still executing — the continuation invocation owns it.
    expect(state.row?.status).toBe("executing");
  });

  it("resumes with partial progress when the continuation self-invoke fails", async () => {
    const { state, tokenOps } = continuationSetup();
    const selfInvoke = vi.fn(async () => {
      throw new Error("invoke throttled");
    });
    const sfnSend = vi.fn().mockResolvedValue({});

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: { send: sfnSend } as never,
      tokenOps,
      lockedBy: "lease-holder",
      selfInvoke,
    });

    expect(resume).toBe("resumed");
    expect(sfnSend).toHaveBeenCalledTimes(1);
    expect(state.row?.status).toBe("consumed");
  });
});
