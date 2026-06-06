import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  assertCanReadKnowledgeGraphThreadMock,
  createKnowledgeGraphThreadIngestRunMock,
  InvokeCommandMock,
  lambdaSendMock,
  markKnowledgeGraphRunInvokeFailedMock,
  resolveKnowledgeGraphScopeMock,
} = vi.hoisted(() => ({
  assertCanReadKnowledgeGraphThreadMock: vi.fn(),
  createKnowledgeGraphThreadIngestRunMock: vi.fn(),
  InvokeCommandMock: vi.fn((input: Record<string, unknown>) => ({ input })),
  lambdaSendMock: vi.fn(),
  markKnowledgeGraphRunInvokeFailedMock: vi.fn(),
  resolveKnowledgeGraphScopeMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  InvokeCommand: InvokeCommandMock,
  LambdaClient: vi.fn(() => ({ send: lambdaSendMock })),
}));

vi.mock("../graphql/resolvers/knowledge-graph/auth.js", () => ({
  assertCanReadKnowledgeGraphThread: assertCanReadKnowledgeGraphThreadMock,
  resolveKnowledgeGraphScope: resolveKnowledgeGraphScopeMock,
}));

vi.mock("../lib/knowledge-graph/runs.js", () => ({
  createKnowledgeGraphThreadIngestRun: createKnowledgeGraphThreadIngestRunMock,
  markKnowledgeGraphRunInvokeFailed: markKnowledgeGraphRunInvokeFailedMock,
}));

import { knowledgeGraphMutations } from "../graphql/resolvers/knowledge-graph/index.js";

const now = new Date("2026-06-04T12:00:00.000Z");

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    tenant_id: "tenant-1",
    thread_id: "thread-1",
    source_kind: "thread",
    source_ref: "thread-1",
    source_label: null,
    requested_by_user_id: "user-1",
    status: "queued",
    trigger: "manual",
    cognee_dataset_name: "thinkwork:tenant-1:thread:thread-1",
    cognee_dataset_id: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    error: null,
    entity_count: 0,
    relationship_count: 0,
    evidence_count: 0,
    diagnostic_count: 0,
    message_count: 3,
    input: { source: "thread", threadId: "thread-1" },
    metrics: {},
    metadata: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

const ctx = {
  auth: { authType: "cognito", tenantId: "tenant-1" },
  db: { marker: "db" },
} as any;

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv(
    "KNOWLEDGE_GRAPH_THREAD_INGEST_FUNCTION_NAME",
    "thinkwork-dev-api-knowledge-graph-thread-ingest",
  );
  resolveKnowledgeGraphScopeMock.mockReset();
  resolveKnowledgeGraphScopeMock.mockResolvedValue({
    tenantId: "tenant-1",
    callerUserId: "user-1",
    requiresUserThreadVisibility: true,
  });
  assertCanReadKnowledgeGraphThreadMock.mockReset();
  assertCanReadKnowledgeGraphThreadMock.mockResolvedValue(true);
  createKnowledgeGraphThreadIngestRunMock.mockReset();
  createKnowledgeGraphThreadIngestRunMock.mockResolvedValue({
    inserted: true,
    run: run(),
  });
  markKnowledgeGraphRunInvokeFailedMock.mockReset();
  markKnowledgeGraphRunInvokeFailedMock.mockResolvedValue(null);
  InvokeCommandMock.mockClear();
  lambdaSendMock.mockReset();
  lambdaSendMock.mockResolvedValue({ StatusCode: 200 });
});

describe("startKnowledgeGraphThreadIngest", () => {
  it("creates a queued run and invokes the worker with RequestResponse", async () => {
    const result =
      await knowledgeGraphMutations.startKnowledgeGraphThreadIngest(
        null,
        {
          input: {
            tenantId: "tenant-1",
            threadId: "thread-1",
            metadata: JSON.stringify({ reason: "smoke" }),
          },
        },
        ctx,
      );

    expect(resolveKnowledgeGraphScopeMock).toHaveBeenCalledWith(
      ctx,
      { tenantId: "tenant-1" },
      "knowledge_graph_thread_ingest",
    );
    expect(assertCanReadKnowledgeGraphThreadMock).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ tenantId: "tenant-1" }),
      "thread-1",
    );
    expect(createKnowledgeGraphThreadIngestRunMock).toHaveBeenCalledWith({
      db: ctx.db,
      tenantId: "tenant-1",
      threadId: "thread-1",
      requestedByUserId: "user-1",
      force: undefined,
      metadata: JSON.stringify({ reason: "smoke" }),
    });
    expect(InvokeCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        FunctionName: "thinkwork-dev-api-knowledge-graph-thread-ingest",
        InvocationType: "RequestResponse",
      }),
    );
    const payload = JSON.parse(
      new TextDecoder().decode(
        InvokeCommandMock.mock.calls[0][0].Payload as Uint8Array,
      ),
    );
    expect(payload).toEqual({
      runId: "run-1",
      tenantId: "tenant-1",
      threadId: "thread-1",
      sourceKind: "thread",
      sourceRef: "thread-1",
      requestedByUserId: "user-1",
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: "run-1",
        status: "QUEUED",
        messageCount: 3,
      }),
    );
  });

  it("returns an active run without invoking a duplicate worker", async () => {
    createKnowledgeGraphThreadIngestRunMock.mockResolvedValueOnce({
      inserted: false,
      run: run({ id: "run-existing", status: "running" }),
    });

    const result =
      await knowledgeGraphMutations.startKnowledgeGraphThreadIngest(
        null,
        { input: { threadId: "thread-1" } },
        ctx,
      );

    expect(lambdaSendMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({ id: "run-existing", status: "RUNNING" }),
    );
  });

  it("marks a newly inserted run failed when worker invoke fails", async () => {
    lambdaSendMock.mockResolvedValueOnce({
      StatusCode: 200,
      FunctionError: "Unhandled",
      Payload: new TextEncoder().encode("boom"),
    });
    markKnowledgeGraphRunInvokeFailedMock.mockResolvedValueOnce(
      run({ status: "failed", error: "boom", finished_at: now }),
    );

    await expect(
      knowledgeGraphMutations.startKnowledgeGraphThreadIngest(
        null,
        { input: { threadId: "thread-1" } },
        ctx,
      ),
    ).rejects.toMatchObject({
      extensions: {
        code: "INTERNAL_SERVER_ERROR",
        run: expect.objectContaining({ status: "FAILED" }),
      },
    });

    expect(markKnowledgeGraphRunInvokeFailedMock).toHaveBeenCalledWith({
      db: ctx.db,
      runId: "run-1",
      error: expect.stringContaining("boom"),
    });
  });

  it("refuses invisible or cross-tenant threads before creating a run", async () => {
    assertCanReadKnowledgeGraphThreadMock.mockResolvedValueOnce(false);

    await expect(
      knowledgeGraphMutations.startKnowledgeGraphThreadIngest(
        null,
        { input: { threadId: "thread-2" } },
        ctx,
      ),
    ).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" },
    });

    expect(createKnowledgeGraphThreadIngestRunMock).not.toHaveBeenCalled();
    expect(lambdaSendMock).not.toHaveBeenCalled();
  });
});
