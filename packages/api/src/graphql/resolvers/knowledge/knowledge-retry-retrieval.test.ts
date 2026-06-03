import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  selectQueue,
  updateQueue,
  updateSets,
  adminCalls,
  dispatchCalls,
  retrievalResults,
  state,
  reset,
} = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const updateQueue: unknown[][] = [];
  const updateSets: Record<string, unknown>[] = [];
  const adminCalls: unknown[][] = [];
  const dispatchCalls: unknown[][] = [];
  const retrievalResults: unknown[] = [];
  const state = { dispatchThrow: false };
  return {
    selectQueue,
    updateQueue,
    updateSets,
    adminCalls,
    dispatchCalls,
    retrievalResults,
    state,
    reset: () => {
      selectQueue.length = 0;
      updateQueue.length = 0;
      updateSets.length = 0;
      adminCalls.length = 0;
      dispatchCalls.length = 0;
      retrievalResults.length = 0;
      state.dispatchThrow = false;
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  const whereResult = () => ({
    then: (resolve: (value: unknown) => void) =>
      resolve(selectQueue.shift() ?? []),
    returning: () => Promise.resolve(updateQueue.shift() ?? []),
  });
  return {
    knowledgeBases: {
      id: col("knowledge_bases.id"),
      tenant_id: col("knowledge_bases.tenant_id"),
    },
    db: {
      select: () => ({ from: () => ({ where: () => whereResult() }) }),
      update: () => ({
        set: (obj: Record<string, unknown>) => {
          updateSets.push(obj);
          return { where: () => whereResult() };
        },
      }),
    },
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    snakeToCamel: (row: Record<string, unknown>) => row,
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    adminCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("./kb-manager-dispatch.js", () => ({
  dispatchKbManager: (...args: unknown[]) => {
    dispatchCalls.push(args);
    return state.dispatchThrow
      ? Promise.reject(new Error("no arn"))
      : Promise.resolve();
  },
}));

vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => ({
  BedrockAgentRuntimeClient: class {
    send() {
      return Promise.resolve({ retrievalResults: [...retrievalResults] });
    }
  },
  RetrieveCommand: class {
    constructor(public input: unknown) {}
  },
}));

const ctx = { auth: { authType: "cognito" } } as any;

beforeEach(() => {
  reset();
  vi.resetModules();
});

describe("retryKnowledgeBase (U9)", () => {
  it("rejects a KB that is not failed", async () => {
    selectQueue.push([{ id: "kb-1", tenant_id: "t1", status: "active" }]);
    const { retryKnowledgeBase } =
      await import("./retryKnowledgeBase.mutation.js");
    await expect(retryKnowledgeBase(null, { id: "kb-1" }, ctx)).rejects.toThrow(
      /failed/i,
    );
    expect(dispatchCalls).toHaveLength(0);
  });

  it("resets a failed KB to creating and re-dispatches create", async () => {
    selectQueue.push([{ id: "kb-1", tenant_id: "t1", status: "failed" }]);
    updateQueue.push([{ id: "kb-1", status: "creating" }]);
    const { retryKnowledgeBase } =
      await import("./retryKnowledgeBase.mutation.js");
    await retryKnowledgeBase(null, { id: "kb-1" }, ctx);
    expect(adminCalls[0][1]).toBe("t1");
    expect(updateSets[0].status).toBe("creating");
    expect(updateSets[0].error_message).toBeNull();
    expect(dispatchCalls[0]).toEqual(["create", "kb-1"]);
  });

  it("marks failed again and throws when dispatch fails", async () => {
    state.dispatchThrow = true;
    selectQueue.push([{ id: "kb-1", tenant_id: "t1", status: "failed" }]);
    updateQueue.push([{ id: "kb-1", status: "creating" }]);
    const { retryKnowledgeBase } =
      await import("./retryKnowledgeBase.mutation.js");
    await expect(retryKnowledgeBase(null, { id: "kb-1" }, ctx)).rejects.toThrow(
      /provisioning/i,
    );
    expect(updateSets.some((s) => s.status === "failed")).toBe(true);
  });
});

describe("testKnowledgeBaseRetrieval (U10)", () => {
  it("returns not_provisioned (no Bedrock call) for a KB without an aws_kb_id", async () => {
    selectQueue.push([{ id: "kb-1", tenant_id: "t1", aws_kb_id: null }]);
    const { testKnowledgeBaseRetrieval } =
      await import("./testKnowledgeBaseRetrieval.query.js");
    const result = await testKnowledgeBaseRetrieval(
      null,
      { id: "kb-1", query: "policy" },
      ctx,
    );
    expect(result.status).toBe("not_provisioned");
    expect(result.hits).toEqual([]);
    expect(adminCalls[0][1]).toBe("t1");
  });

  it("maps Bedrock results to ranked hits for a provisioned KB", async () => {
    selectQueue.push([{ id: "kb-1", tenant_id: "t1", aws_kb_id: "aws-kb-1" }]);
    retrievalResults.push(
      {
        content: { text: "Refunds within 30 days." },
        score: 0.91,
        location: { s3Location: { uri: "s3://bucket/policy.md" } },
      },
      { content: { text: "" } }, // empty snippet — filtered out
    );
    const { testKnowledgeBaseRetrieval } =
      await import("./testKnowledgeBaseRetrieval.query.js");
    const result = await testKnowledgeBaseRetrieval(
      null,
      { id: "kb-1", query: "refund" },
      ctx,
    );
    expect(result.status).toBe("ok");
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      snippet: "Refunds within 30 days.",
      score: 0.91,
      source: "s3://bucket/policy.md",
    });
  });
});
