import { describe, expect, it } from "vitest";
import {
  modelInvocationLogView,
  parseBedrockInvocationLogEvent,
  reconcileInvocationRecords,
  type BedrockInvocationLogRecord,
  type RuntimeModelUsageObservation,
} from "./bedrock-invocation-reconciler.js";

const runtimeBase: RuntimeModelUsageObservation = {
  traceRunId: "trace-run-1",
  traceEventId: "trace-event-1",
  costEventId: "cost-event-1",
  requestId: "turn-1",
  model: "claude-sonnet-4-5",
  provider: "bedrock",
  runtimeInputTokens: 12,
  runtimeOutputTokens: 8,
  runtimeCachedReadTokens: 0,
  runtimeAmountUsd: 0.000156,
  bedrockRequestIds: ["bedrock-request-1"],
  traceId: "trace-1",
  threadTurnId: "turn-1",
};

function provider(
  overrides: Partial<BedrockInvocationLogRecord> = {},
): BedrockInvocationLogRecord {
  return {
    requestId: "bedrock-request-1",
    operation: "Converse",
    modelId:
      "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    displayModelId: "claude-sonnet-4-5-20250929",
    timestamp: "2026-06-25T15:00:00.000Z",
    inputTokenCount: 12,
    outputTokenCount: 8,
    cacheReadTokenCount: 0,
    cacheWriteTokenCount: 0,
    durationMs: 1234,
    errorState: null,
    inputPreview: "[User] hello",
    outputPreview: "hi",
    toolCount: 0,
    costUsd: 0.000156,
    toolUses: [],
    hasToolResult: false,
    branch: "parent",
    requestMetadata: {},
    source: {
      logGroupName: "/thinkwork/bedrock/model-invocations",
      logStreamName: "stream",
      eventId: "event-1",
      timestamp: 1_782_405_600_000,
    },
    ...overrides,
  };
}

describe("parseBedrockInvocationLogEvent", () => {
  it("normalizes Bedrock invocation log token/cache fields and source references", () => {
    const parsed = parseBedrockInvocationLogEvent(
      {
        eventId: "event-1",
        logStreamName: "stream-1",
        timestamp: 1_782_405_600_000,
        message: JSON.stringify({
          requestId: "bedrock-request-1",
          operation: "Converse",
          modelId:
            "arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0",
          requestMetadata: { trace_id: "trace-1" },
          input: {
            inputTokenCount: 12,
            cacheReadInputTokenCount: 3,
            cacheWriteInputTokenCount: 4,
            inputBodyJson: {
              system: [{ text: "Workspace Map" }],
              messages: [{ role: "user", content: "hello" }],
              toolConfig: { tools: [{ toolSpec: { name: "search" } }] },
            },
          },
          output: {
            outputTokenCount: 8,
            outputBodyJson: {
              output: {
                message: {
                  content: [{ type: "text", text: "hi" }],
                },
              },
            },
          },
        }),
      },
      "/custom/log-group",
    );

    expect(parsed).toMatchObject({
      requestId: "bedrock-request-1",
      displayModelId: "claude-sonnet-4-5-20250929",
      inputTokenCount: 12,
      outputTokenCount: 8,
      cacheReadTokenCount: 3,
      cacheWriteTokenCount: 4,
      toolCount: 1,
      branch: "parent",
      requestMetadata: { trace_id: "trace-1" },
      source: {
        logGroupName: "/custom/log-group",
        logStreamName: "stream-1",
        eventId: "event-1",
      },
    });
    expect(parsed?.inputPreview).toContain("[User] hello");
    expect(parsed?.outputPreview).toBe("hi");
  });
});

describe("reconcileInvocationRecords", () => {
  it("marks a single request-id match as invocation-reconciled", () => {
    const [decision] = reconcileInvocationRecords([runtimeBase], [provider()]);

    expect(decision).toMatchObject({
      state: "invocation-reconciled",
      confidence: "request-id",
      reason: "request-id-match",
      tokenVariance: { input: 0, output: 0, cachedRead: 0 },
    });
  });

  it("keeps a zero-token runtime report untrusted when provider logs have usage", () => {
    const [decision] = reconcileInvocationRecords(
      [
        {
          ...runtimeBase,
          runtimeInputTokens: 0,
          runtimeOutputTokens: 0,
          runtimeAmountUsd: 0,
        },
      ],
      [provider()],
    );

    expect(decision.state).toBe("mismatch");
    expect(decision.reason).toBe("provider-token-mismatch");
    expect(decision.tokenVariance).toEqual({
      input: 12,
      output: 8,
      cachedRead: 0,
    });
  });

  it("refuses ambiguous model/time fallback matches", () => {
    const [decision] = reconcileInvocationRecords(
      [{ ...runtimeBase, bedrockRequestIds: [], requestId: "turn-1" }],
      [
        provider({ requestId: "provider-a" }),
        provider({ requestId: "provider-b" }),
      ],
    );

    expect(decision).toMatchObject({
      state: "unreconciled/error",
      confidence: "none",
      reason: "ambiguous-provider-logs",
      candidateRequestIds: ["provider-a", "provider-b"],
    });
  });

  // THINK-245 U5 — the U4 identity shapes must produce exact matches so
  // agent-loop windows never degrade to ambiguous model+time (AE2).
  it("matches all calls of a multi-invocation agent loop by request id (AE2)", () => {
    const requestIds = Array.from({ length: 8 }, (_, i) => `req-${i}`);
    const runtime: RuntimeModelUsageObservation = {
      ...runtimeBase,
      bedrockRequestIds: requestIds,
      runtimeInputTokens: 96,
      runtimeOutputTokens: 64,
      runtimeAmountUsd: 0.001248,
    };
    const providers = requestIds.map((id, i) =>
      provider({
        requestId: id,
        timestamp: `2026-06-25T15:00:0${i}.000Z`,
      }),
    );

    const [decision] = reconcileInvocationRecords([runtime], providers);

    expect(decision.state).toBe("invocation-reconciled");
    expect(decision.confidence).toBe("request-id");
    expect(decision.reason).not.toBe("ambiguous-provider-logs");
  });

  it("matches by requestMetadata (score-90 path) when request ids are absent", () => {
    const [decision] = reconcileInvocationRecords(
      [{ ...runtimeBase, bedrockRequestIds: [], requestId: "other" }],
      [
        provider({
          requestId: "provider-a",
          requestMetadata: { thread_turn_id: "turn-1", trace_id: "trace-1" },
        }),
        provider({ requestId: "provider-b" }),
      ],
    );

    expect(decision.state).toBe("invocation-reconciled");
    expect(decision.confidence).toBe("request-metadata");
  });

  it("legacy evidence without identity still degrades to model+time (no regression)", () => {
    const [decision] = reconcileInvocationRecords(
      [{ ...runtimeBase, bedrockRequestIds: [], requestId: "other" }],
      [provider({ requestId: "provider-solo" })],
    );

    expect(decision.state).toBe("invocation-reconciled");
    expect(decision.confidence).toBe("model-time");
  });

  it("prices cache tokens into the provider amount (R6)", () => {
    const parsed = parseBedrockInvocationLogEvent({
      eventId: "e",
      logStreamName: "s",
      timestamp: 1_782_405_600_000,
      message: JSON.stringify({
        requestId: "req-cache",
        operation: "Converse",
        modelId: "us.anthropic.claude-sonnet-4-6-v1:0",
        input: {
          inputTokenCount: 10_000,
          cacheReadInputTokenCount: 200_000,
          cacheWriteInputTokenCount: 50_000,
          inputBodyJson: { messages: [] },
        },
        output: { outputTokenCount: 2_000, outputBodyJson: {} },
      }),
    });

    // 10k*3 + 2k*15 + 200k*0.30 + 50k*3.75 per million = 0.3075 (AE1 rates)
    expect(parsed?.costUsd).toBeCloseTo(0.3075, 6);
  });

  it("prices kimi cache tokens at zero (no caching on Bedrock)", () => {
    const parsed = parseBedrockInvocationLogEvent({
      eventId: "e",
      logStreamName: "s",
      timestamp: 1_782_405_600_000,
      message: JSON.stringify({
        requestId: "req-kimi",
        operation: "Converse",
        modelId: "moonshotai.kimi-k2.5",
        input: {
          inputTokenCount: 1_000_000,
          cacheReadInputTokenCount: 500_000,
          inputBodyJson: { messages: [] },
        },
        output: { outputTokenCount: 0, outputBodyJson: {} },
      }),
    });

    expect(parsed?.costUsd).toBeCloseTo(0.6, 6);
  });

  it("annotates resolver-facing provider records with reconciliation status", () => {
    const record = provider();
    const decisions = reconcileInvocationRecords([runtimeBase], [record]);

    expect(modelInvocationLogView(record, decisions)).toMatchObject({
      requestId: "bedrock-request-1",
      modelId: "claude-sonnet-4-5-20250929",
      reconciliationState: "invocation-reconciled",
      reconciliationReason: "request-id-match",
      reconciliationConfidence: "request-id",
      reconciliationRuntimeRequestId: "turn-1",
    });
  });
});
