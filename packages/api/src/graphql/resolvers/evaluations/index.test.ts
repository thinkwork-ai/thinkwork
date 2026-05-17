import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows, mockFetchSpansForSession } = vi.hoisted(() => ({
  mockRows: vi.fn(),
  mockFetchSpansForSession: vi.fn(),
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mockRows()),
          }),
        }),
      }),
    }),
  },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  asc: (arg: unknown) => ({ asc: arg }),
  desc: (arg: unknown) => ({ desc: arg }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  sql: (...args: unknown[]) => ({ sql: args }),
}));

vi.mock("../../../lib/agentcore-spans.js", () => ({
  fetchSpansForSession: mockFetchSpansForSession,
}));

import {
  evalResultSpans,
  placeholderStatusForEvalRun,
  withLiveProgress,
} from "./index.js";

describe("placeholderStatusForEvalRun", () => {
  it("keeps planned eval rows visible with the parent run state", () => {
    expect(placeholderStatusForEvalRun("pending")).toBe("pending");
    expect(placeholderStatusForEvalRun("running")).toBe("running");
    expect(placeholderStatusForEvalRun("cancelled")).toBe("cancelled");
    expect(placeholderStatusForEvalRun("failed")).toBe("failed");
    expect(placeholderStatusForEvalRun("completed")).toBe("waiting");
  });
});

describe("withLiveProgress", () => {
  it("overlays running eval run counters from completed result rows", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "running",
          passed: 0,
          failed: 0,
          pass_rate: null,
        },
        { runId: "run-1", completed: 40, passed: 39, failed: 1 },
      ),
    ).toMatchObject({
      passed: 39,
      failed: 1,
      pass_rate: "0.9750",
    });
  });

  it("leaves completed eval run counters untouched", () => {
    expect(
      withLiveProgress(
        {
          id: "run-1",
          status: "completed",
          passed: 40,
          failed: 1,
          pass_rate: "0.9756",
        },
        { runId: "run-1", completed: 40, passed: 39, failed: 1 },
      ),
    ).toMatchObject({
      passed: 40,
      failed: 1,
      pass_rate: "0.9756",
    });
  });
});

describe("evalResultSpans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVAL_TRACE_RUNTIME_LOG_GROUP = "/aws/runtime";
  });

  it("loads spans for the eval result session and returns them chronologically", async () => {
    mockRows.mockResolvedValue([{ agentSessionId: "session-1" }]);
    mockFetchSpansForSession.mockResolvedValue([
      {
        name: "tool_call",
        cloudWatchTimestamp: 1_700_000_000_050,
        attributes: { tool: "search" },
      },
      {
        name: "invoke_agent",
        cloudWatchTimestamp: 1_700_000_000_000,
        attributes: { model: "claude" },
      },
    ]);

    const result = await evalResultSpans(
      {},
      { runId: "run-1", testCaseId: "case-1" },
      {} as any,
    );

    expect(mockFetchSpansForSession).toHaveBeenCalledWith("session-1", {
      runtimeLogGroup: "/aws/runtime",
    });
    expect(result).toEqual([
      {
        timestamp: "2023-11-14T22:13:20.000Z",
        name: "invoke_agent",
        attributes: JSON.stringify({ model: "claude" }),
      },
      {
        timestamp: "2023-11-14T22:13:20.050Z",
        name: "tool_call",
        attributes: JSON.stringify({ tool: "search" }),
      },
    ]);
  });

  it("returns an empty trace when the result has no session id", async () => {
    mockRows.mockResolvedValue([{ agentSessionId: null }]);

    await expect(
      evalResultSpans({}, { runId: "run-1", testCaseId: "case-1" }, {} as any),
    ).resolves.toEqual([]);
    expect(mockFetchSpansForSession).not.toHaveBeenCalled();
  });

  it("treats CloudWatch failures as trace-unavailable instead of page errors", async () => {
    mockRows.mockResolvedValue([{ agentSessionId: "session-1" }]);
    mockFetchSpansForSession.mockRejectedValue(new Error("logs unavailable"));

    await expect(
      evalResultSpans({}, { runId: "run-1", testCaseId: "case-1" }, {} as any),
    ).resolves.toEqual([]);
  });
});
