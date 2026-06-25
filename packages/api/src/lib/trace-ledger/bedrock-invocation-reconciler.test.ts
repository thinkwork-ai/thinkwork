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
