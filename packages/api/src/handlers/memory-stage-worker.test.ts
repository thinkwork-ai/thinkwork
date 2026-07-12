import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMocks = vi.hoisted(() => ({
  getProcessorConfig: vi.fn(),
  getSourceConfig: vi.fn(),
}));
const tokenMocks = vi.hoisted(() => ({
  consumeTaskToken: vi.fn(),
}));

vi.mock("../lib/memory-sources/repository.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../lib/memory-sources/repository.js")
    >();
  return {
    ...actual,
    getProcessorConfig: repoMocks.getProcessorConfig,
    getSourceConfig: repoMocks.getSourceConfig,
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
  consumeTaskToken: tokenMocks.consumeTaskToken,
}));

import { runMemoryStageWorker } from "./memory-stage-worker.js";

const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const RUN_ID = "9b1f74a2-40c5-4b34-9a49-27f1b7f9a111";

function fakeDb(tokenRows: unknown[] = [{ step_id: "s", iteration: 1 }]) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => tokenRows,
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
    processorConfigId: "11111111-1111-4111-8111-111111111111",
    sourceConfigId: "22222222-2222-4222-8222-222222222222",
    options: null,
    ...overrides,
  } as never;
}

function activeProcessor(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
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
    tokenMocks.consumeTaskToken.mockResolvedValue({ token: "tok-1" });
    sfnSend.mockResolvedValue({});
  });

  it("rejects a personal/user-scoped processor and resumes with failed (R11/AE7)", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/shared|scope/i);
    expect(resume).toBe("resumed");
    const output = JSON.parse(
      sfnSend.mock.calls[0]?.[0]?.input?.output as string,
    );
    expect(output.status).toBe("failed");
  });

  it("fails visibly on a stage U1 does not implement", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());
    repoMocks.getSourceConfig.mockResolvedValue({
      source: {
        id: "22222222-2222-4222-8222-222222222222",
        source_family: "twenty",
        enabled: true,
        boundary: {},
      },
      processor: activeProcessor(),
    });

    const { result } = await runMemoryStageWorker(
      baseEvent({ stage: "wiki" }),
      { db: fakeDb(), sfnClient: sfn },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain('stage "wiki" is not implemented in U1');
  });

  it("requires an explicit sourceConfigId in U1", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(activeProcessor());

    const { result } = await runMemoryStageWorker(
      baseEvent({ sourceConfigId: null }),
      { db: fakeDb(), sfnClient: sfn },
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("sourceConfigId");
  });

  it("a crashed stage still resumes the token as a failed result — never parks forever", async () => {
    repoMocks.getProcessorConfig.mockRejectedValue(
      new Error("db exploded mid-read"),
    );

    const { result, resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("db exploded");
    expect(resume).toBe("resumed");
  });

  it("duplicate Event delivery finds no pending token and does not SendTaskSuccess", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb([]),
      sfnClient: sfn,
    });

    expect(resume).toBe("no_token");
    expect(sfnSend).not.toHaveBeenCalled();
  });

  it("a lost token CAS race resolves as already_resolved", async () => {
    repoMocks.getProcessorConfig.mockResolvedValue(
      activeProcessor({ mode: "personal", target_scope: "user" }),
    );
    tokenMocks.consumeTaskToken.mockResolvedValue(null);

    const { resume } = await runMemoryStageWorker(baseEvent(), {
      db: fakeDb(),
      sfnClient: sfn,
    });

    expect(resume).toBe("already_resolved");
    expect(sfnSend).not.toHaveBeenCalled();
  });
});
