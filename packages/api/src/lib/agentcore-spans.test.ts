import { describe, expect, it, vi } from "vitest";
import {
  fetchSpansForSession,
  type CloudWatchLogsClientLike,
} from "./agentcore-spans.js";

describe("fetchSpansForSession", () => {
  it("queries span and runtime logs, keeping only span-shaped runtime records", async () => {
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
                name: "ordinary log",
                scope: { name: "app" },
                spanId: "span-2",
              }),
              timestamp: 1_700_000_000_020,
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
