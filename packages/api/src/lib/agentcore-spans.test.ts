import { describe, expect, it, vi } from "vitest";
import {
  fetchSpansForSession,
  type CloudWatchLogsClientLike,
} from "./agentcore-spans.js";

describe("fetchSpansForSession", () => {
  it("queries span and runtime logs, keeping Pi and Strands span-shaped runtime records", async () => {
    const sentLogGroups: Array<string | undefined> = [];
    const cloudWatch: CloudWatchLogsClientLike = {
      send: vi.fn(async (command) => {
        sentLogGroups.push(command.input.logGroupName);
        if (command.input.logGroupName === "aws/spans") {
          return {
            events: [
              {
                message: JSON.stringify({ name: "invoke_agent" }),
                timestamp: 1_700_000_000_000,
              },
              { message: "{not-json", timestamp: 1_700_000_000_001 },
            ],
          };
        }
        return {
          events: [
            {
              message: JSON.stringify({
                name: "tool_call",
                scope: { name: "strands.telemetry.tracer" },
                spanId: "span-1",
              }),
              timestamp: 1_700_000_000_010,
            },
            {
              message: JSON.stringify({
                name: "pi_tool_call",
                scope: { name: "thinkwork.pi.runtime" },
                spanId: "span-2",
              }),
              timestamp: 1_700_000_000_020,
            },
            {
              message: JSON.stringify({
                name: "thinkwork.agentcore.phase",
                event: "agentcore_phase",
                scope: { name: "thinkwork.pi.runtime" },
                spanId: "span-phase-1",
                phase: "runtime.workspace_bootstrap",
                status: "completed",
              }),
              timestamp: 1_700_000_000_025,
            },
            {
              message: JSON.stringify({
                name: "ordinary log",
                scope: { name: "app" },
              }),
              timestamp: 1_700_000_000_030,
            },
          ],
        };
      }),
    };

    const spans = await fetchSpansForSession("session-1", {
      cloudWatch,
      runtimeLogGroup: "/aws/runtime",
      startTime: 123,
    });

    expect(sentLogGroups).toEqual(["aws/spans", "/aws/runtime"]);
    expect(spans).toEqual([
      { name: "invoke_agent", cloudWatchTimestamp: 1_700_000_000_000 },
      {
        name: "tool_call",
        scope: { name: "strands.telemetry.tracer" },
        spanId: "span-1",
        cloudWatchTimestamp: 1_700_000_000_010,
      },
      {
        name: "pi_tool_call",
        scope: { name: "thinkwork.pi.runtime" },
        spanId: "span-2",
        cloudWatchTimestamp: 1_700_000_000_020,
      },
      {
        name: "thinkwork.agentcore.phase",
        event: "agentcore_phase",
        scope: { name: "thinkwork.pi.runtime" },
        spanId: "span-phase-1",
        phase: "runtime.workspace_bootstrap",
        status: "completed",
        cloudWatchTimestamp: 1_700_000_000_025,
      },
    ]);
  });

  it("does not require a runtime log group for resolver drill-ins", async () => {
    const cloudWatch: CloudWatchLogsClientLike = {
      send: vi.fn(async () => ({
        events: [{ message: JSON.stringify({ name: "invoke_agent" }) }],
      })),
    };

    const spans = await fetchSpansForSession("session-1", { cloudWatch });

    expect(cloudWatch.send).toHaveBeenCalledTimes(1);
    expect(spans).toEqual([
      { name: "invoke_agent", cloudWatchTimestamp: null },
    ]);
  });
});
