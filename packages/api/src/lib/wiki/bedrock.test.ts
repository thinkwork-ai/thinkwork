/**
 * THINK-245 U6: cost attribution for the shared Bedrock Converse wrapper.
 *
 * Every background caller (wiki compile, KG extraction, dreaming) routes
 * through invokeClaude — these tests pin the recording contract:
 *   - a costContext records one cost event (source defaults to wiki_compile)
 *   - cache tokens pass through (Converse inputTokens EXCLUDES cache tokens)
 *   - no costContext → no recording
 *   - a recording failure NEVER fails the underlying call
 *   - retry attempts get a derived `:r<n>` idempotency key
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSend, mockRecordCostEvents } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockRecordCostEvents: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("@aws-sdk/client-bedrock-runtime")
  >("@aws-sdk/client-bedrock-runtime");
  return {
    ...actual,
    BedrockRuntimeClient: vi
      .fn()
      .mockImplementation(() => ({ send: mockSend })),
  };
});

vi.mock("../cost-recording.js", () => ({
  recordCostEvents: mockRecordCostEvents,
}));

import { invokeClaude, invokeClaudeWithRetry } from "./bedrock.js";

function converseResponse(overrides: Record<string, unknown> = {}) {
  return {
    output: { message: { role: "assistant", content: [{ text: "ok" }] } },
    stopReason: "end_turn",
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cacheReadInputTokens: 5,
      cacheWriteInputTokens: 7,
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockSend.mockReset();
  mockRecordCostEvents.mockReset();
  mockRecordCostEvents.mockResolvedValue({
    totalUsd: 0.01,
    llmUsd: 0.01,
    computeUsd: 0,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("invokeClaude cost recording", () => {
  it("records a cost event with source wiki_compile when costContext is set", async () => {
    mockSend.mockResolvedValue(converseResponse());
    const res = await invokeClaude({
      system: "s",
      user: "u",
      modelId: "openai.gpt-oss-120b-1:0",
      costContext: { tenantId: "t1", requestId: "wiki:job-1:planner:0" },
    });
    expect(res.text).toBe("ok");
    expect(mockRecordCostEvents).toHaveBeenCalledTimes(1);
    expect(mockRecordCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "t1",
        requestId: "wiki:job-1:planner:0",
        model: "openai.gpt-oss-120b-1:0",
        inputTokens: 100,
        outputTokens: 20,
        cachedReadTokens: 5,
        cachedWriteTokens: 7,
        recordCompute: false,
        source: "wiki_compile",
      }),
    );
  });

  it("honors a caller-supplied source tag (e.g. kg_extraction)", async () => {
    mockSend.mockResolvedValue(converseResponse());
    await invokeClaude({
      system: "s",
      user: "u",
      costContext: {
        tenantId: "t1",
        requestId: "kg:run-1:extract:0",
        source: "kg_extraction",
      },
    });
    expect(mockRecordCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({ source: "kg_extraction" }),
    );
  });

  it("records nothing when no costContext is supplied", async () => {
    mockSend.mockResolvedValue(converseResponse());
    await invokeClaude({ system: "s", user: "u" });
    expect(mockRecordCostEvents).not.toHaveBeenCalled();
  });

  it("never fails the call when cost recording throws", async () => {
    mockSend.mockResolvedValue(converseResponse());
    mockRecordCostEvents.mockRejectedValue(new Error("db down"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await invokeClaude({
      system: "s",
      user: "u",
      costContext: { tenantId: "t1", requestId: "wiki:job-1:planner:0" },
    });
    expect(res.text).toBe("ok");
    expect(res.inputTokens).toBe(100);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("suffixes retry attempts so retried spend is not conflict-dropped", async () => {
    vi.useFakeTimers();
    const throttle = new Error("slow down");
    throttle.name = "ThrottlingException";
    mockSend
      .mockRejectedValueOnce(throttle)
      .mockResolvedValue(converseResponse());

    const pending = invokeClaudeWithRetry({
      system: "s",
      user: "u",
      // A caller-owned signal suppresses the internal call-timeout timer so
      // runAllTimersAsync only drives the retry backoff.
      signal: new AbortController().signal,
      costContext: { tenantId: "t1", requestId: "wiki:job-1:section:3" },
    });
    await vi.runAllTimersAsync();
    const res = await pending;

    expect(res.retries).toBe(1);
    // Attempt 1 threw before any recording; attempt 2 records with :r2.
    expect(mockRecordCostEvents).toHaveBeenCalledTimes(1);
    expect(mockRecordCostEvents).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "wiki:job-1:section:3:r2" }),
    );
  });
});
