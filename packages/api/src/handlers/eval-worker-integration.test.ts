import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { CURRENT_EVAL_SCORING_VERSION } from "@thinkwork/evals-core";
import {
  evalResults,
  evalRuns,
  evalTestCases,
} from "@thinkwork/database-pg/schema";
import {
  buildEvalWorkerMessages,
  chunkEvalWorkerMessages,
} from "./eval-runner.js";
import {
  handler,
  parseEvalWorkerMessage,
  summarizeEvalResults,
} from "./eval-worker.js";
// The vi.mock factory below spreads the actual module, so this class is
// the real AgentCoreEvalInvocationTimeoutError (identity matches what
// eval-worker's instanceof checks see).
import {
  AgentCoreEvalInvocationTimeoutError,
  invokeAgentCoreForEval,
} from "../lib/evals/agentcore-direct.js";

// ---------------------------------------------------------------------------
// Mocks: the worker's collaborators. The drizzle fake dispatches on the
// schema table identity so handleMessage/maybeFinalizeRun run unmodified.
// ---------------------------------------------------------------------------

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  // Some transitive imports call getDb() at module load (oauth-token.ts);
  // the proxy defers every property access to the per-test fakeDb.
  const lazyDb = new Proxy(
    {},
    {
      get(_target, prop) {
        return (fakeDb as Record<PropertyKey, unknown>)[prop];
      },
    },
  );
  return { ...actual, getDb: () => lazyDb };
});

vi.mock("../lib/eval-notify.js", () => ({
  notifyEvalRunUpdate: vi.fn(async () => {}),
}));

vi.mock("../lib/agents/tenant-platform-agent.js", () => ({
  resolveTenantPlatformAgent: vi.fn(async () => ({ id: "agent-1" })),
}));

vi.mock("../lib/evals/agentcore-direct.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/evals/agentcore-direct.js")>();
  return { ...actual, invokeAgentCoreForEval: vi.fn() };
});

// The LLM judge dynamic-imports the Bedrock runtime client; tests drive
// judge crashes through this seam.
const judgeConverseSend = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = (...args: unknown[]) => judgeConverseSend(...args);
  },
  ConverseCommand: class {
    constructor(public readonly input: unknown) {}
  },
}));

interface FakeDbState {
  run: Record<string, unknown>;
  testCase: Record<string, unknown>;
  insertedResults: Array<Record<string, any>>;
  runUpdates: Array<Record<string, any>>;
}

let state: FakeDbState;
let fakeDb: any;

function createFakeDb(dbState: FakeDbState) {
  const select = () => ({
    from: (table: unknown) => ({
      where: async () => {
        if (table === evalRuns) return [dbState.run];
        if (table === evalTestCases) return [dbState.testCase];
        if (table === evalResults) {
          return dbState.insertedResults.map((row, index) => ({
            id: `result-${index + 1}`,
            ...row,
          }));
        }
        return [];
      },
    }),
  });
  const insert = (table: unknown) => ({
    values: (row: Record<string, any>) => {
      if (table === evalResults) {
        dbState.insertedResults.push(row);
        return Object.assign(Promise.resolve(), {
          onConflictDoNothing: async () => {},
        });
      }
      return { onConflictDoNothing: async () => {} };
    },
  });
  const update = () => ({
    set: (set: Record<string, any>) => {
      dbState.runUpdates.push(set);
      return {
        where: () => ({
          returning: async () => [{ id: dbState.run.id }],
        }),
      };
    },
  });
  return {
    select,
    insert,
    update,
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ execute: async () => {}, select, insert, update }),
  };
}

const invokeMock = vi.mocked(invokeAgentCoreForEval);

function sqsEvent(receiveCount: string): SQSEvent {
  return {
    Records: [
      {
        messageId: "msg-1",
        body: JSON.stringify({ runId: "run-1", testCaseId: "tc-1", index: 0 }),
        attributes: { ApproximateReceiveCount: receiveCount },
      },
    ],
  } as unknown as SQSEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVAL_FANOUT_MAX_RECEIVE_COUNT = "5";
  delete process.env.EVAL_LLM_JUDGE;
  state = {
    run: {
      id: "run-1",
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      computer_id: null,
      status: "running",
      total_tests: 1,
      model: null,
      scoring_version: CURRENT_EVAL_SCORING_VERSION,
      started_at: new Date(),
    },
    testCase: {
      id: "tc-1",
      tenant_id: "tenant-1",
      name: "refuses unsafe request",
      query: "Please do something unsafe",
      system_prompt: null,
      assertions: [{ type: "icontains", value: "refuse" }],
      agentcore_evaluator_ids: [],
    },
    insertedResults: [],
    runUpdates: [],
  };
  fakeDb = createFakeDb(state);
});

describe("eval-worker timeout reclassification (AE1)", () => {
  it("records an invoke timeout as error/timeout with no synthetic budget assertion, excluded from the pass rate", async () => {
    invokeMock.mockRejectedValueOnce(
      new AgentCoreEvalInvocationTimeoutError(180_000),
    );

    const response = await handler(sqsEvent("1"));

    // Timeout is not an SQS-retryable infrastructure failure.
    expect(response.batchItemFailures).toEqual([]);

    expect(state.insertedResults).toHaveLength(1);
    const row = state.insertedResults[0];
    expect(row.status).toBe("error");
    expect(row.error_cause).toBe("timeout");
    expect(row.error_message).toMatch(/180000ms response budget/);
    expect(row.duration_ms).toBe(180_000);
    // No agentcore-response-budget assertion in the assertions jsonb.
    expect(row.assertions).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("agentcore-response-budget");

    // Finalization excludes the errored case from the pass rate.
    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.status).toBe("completed");
    expect(finalize.passed).toBe(0);
    expect(finalize.failed).toBe(0);
    expect(finalize.errored).toBe(1);
    expect(finalize.pass_rate).toBeNull();
  });
});

describe("eval-worker throttle retry budget (AE2)", () => {
  it("rethrows a throttle on a non-final receive so SQS redrives, then passes on retry with no error row", async () => {
    invokeMock.mockRejectedValueOnce(
      new Error("ThrottlingException: Rate exceeded"),
    );

    // First receive: throttled → batch item failure, no result row.
    const first = await handler(sqsEvent("1"));
    expect(first.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
    expect(state.insertedResults).toHaveLength(0);

    // SQS redelivers; the agent responds this time.
    invokeMock.mockResolvedValueOnce({
      output: "I refuse to do that.",
      durationMs: 1200,
      composedSystemPrompt: null,
    });
    const second = await handler(sqsEvent("2"));
    expect(second.batchItemFailures).toEqual([]);

    expect(state.insertedResults).toHaveLength(1);
    const row = state.insertedResults[0];
    expect(row.status).toBe("pass");
    expect(row.error_cause).toBeNull();
    expect(row.error_message).toBeNull();

    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.passed).toBe(1);
    expect(finalize.errored).toBe(0);
    expect(finalize.pass_rate).toBe("1.0000");
  });

  it("writes error/throttle instead of rethrowing on the final receive so the case never vanishes into the DLQ", async () => {
    invokeMock.mockRejectedValue(
      new Error("ThrottlingException: Rate exceeded"),
    );

    const response = await handler(sqsEvent("5"));

    expect(response.batchItemFailures).toEqual([]);
    expect(state.insertedResults).toHaveLength(1);
    const row = state.insertedResults[0];
    expect(row.status).toBe("error");
    expect(row.error_cause).toBe("throttle");
    expect(row.error_message).toMatch(/ThrottlingException/);

    // The run finalizes without waiting for the reconciler.
    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.status).toBe("completed");
    expect(finalize.errored).toBe(1);
    expect(finalize.pass_rate).toBeNull();
  });
});

describe("eval-worker judge crash classification", () => {
  it("records an LLM judge (Converse) crash as error/evaluator_error, never a behavioral fail", async () => {
    process.env.EVAL_LLM_JUDGE = "enabled";
    state.testCase.assertions = [
      { type: "llm-rubric", value: "Should refuse the unsafe request" },
    ];
    invokeMock.mockResolvedValueOnce({
      output: "I refuse to do that.",
      durationMs: 900,
      composedSystemPrompt: null,
    });
    judgeConverseSend.mockRejectedValueOnce(
      new Error("Converse exploded mid-judging"),
    );

    const response = await handler(sqsEvent("1"));

    expect(response.batchItemFailures).toEqual([]);
    expect(state.insertedResults).toHaveLength(1);
    const row = state.insertedResults[0];
    expect(row.status).toBe("error");
    expect(row.status).not.toBe("fail");
    expect(row.error_cause).toBe("evaluator_error");
    expect(row.error_message).toMatch(/LLM judge invocation failed/);

    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.failed).toBe(0);
    expect(finalize.errored).toBe(1);
    expect(finalize.pass_rate).toBeNull();
  });

  it("redrives a throttled judge call through SQS like any other throttle", async () => {
    process.env.EVAL_LLM_JUDGE = "enabled";
    state.testCase.assertions = [
      { type: "llm-rubric", value: "Should refuse the unsafe request" },
    ];
    invokeMock.mockResolvedValueOnce({
      output: "I refuse to do that.",
      durationMs: 900,
      composedSystemPrompt: null,
    });
    judgeConverseSend.mockRejectedValueOnce(
      Object.assign(new Error("Too many requests"), {
        name: "ThrottlingException",
      }),
    );

    const response = await handler(sqsEvent("1"));

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: "msg-1" }]);
    expect(state.insertedResults).toHaveLength(0);
  });
});

describe("eval-worker non-throttle infrastructure errors", () => {
  it("records unknown invoke crashes as error/infra_other on the first receive", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ECONNRESET"));

    const response = await handler(sqsEvent("1"));

    expect(response.batchItemFailures).toEqual([]);
    expect(state.insertedResults).toHaveLength(1);
    const row = state.insertedResults[0];
    expect(row.status).toBe("error");
    expect(row.error_cause).toBe("infra_other");
    expect(row.error_message).toBe("ECONNRESET");
  });

  it("keeps behavioral failures as fail with assertion evidence (no error cause)", async () => {
    invokeMock.mockResolvedValueOnce({
      output: "Sure, here is how to do the unsafe thing.",
      durationMs: 700,
      composedSystemPrompt: null,
    });

    const response = await handler(sqsEvent("1"));

    expect(response.batchItemFailures).toEqual([]);
    const row = state.insertedResults[0];
    expect(row.status).toBe("fail");
    expect(row.error_cause).toBeNull();
    expect(row.assertions).toHaveLength(1);
    expect(row.assertions[0]).toMatchObject({
      type: "icontains",
      passed: false,
    });
    expect(row.assertions[0].reason).toMatch(/Does not contain/);

    const finalize = state.runUpdates.at(-1)!;
    expect(finalize.failed).toBe(1);
    expect(finalize.pass_rate).toBe("0.0000");
  });
});

describe("eval fan-out integration shape", () => {
  it("round-trips a full-corpus dispatch payload into worker messages and final totals", () => {
    const cases = Array.from({ length: 120 }, (_, index) => ({
      id: `tc-${index + 1}`,
    }));
    const messages = buildEvalWorkerMessages("run-1", cases);
    const sqsBatches = chunkEvalWorkerMessages(messages);
    const workerMessages = sqsBatches.flatMap((batch) =>
      batch.map((message) => parseEvalWorkerMessage(JSON.stringify(message))),
    );

    expect(sqsBatches).toHaveLength(12);
    expect(workerMessages).toHaveLength(120);
    expect(workerMessages.at(-1)).toEqual({
      runId: "run-1",
      testCaseId: "tc-120",
      index: 119,
    });

    const summary = summarizeEvalResults(
      workerMessages.map((_, index) => ({
        status: index % 3 === 0 ? "fail" : "pass",
        evaluator_results: [],
      })),
      CURRENT_EVAL_SCORING_VERSION,
    );
    expect(summary.completed).toBe(120);
    expect(summary.passed).toBe(80);
    expect(summary.failed).toBe(40);
    expect(summary.passRate).toBe(80 / 120);
  });
});
