import { describe, expect, it, vi } from "vitest";
import {
  buildAgentCorePhaseLog,
  logAgentCorePhase,
} from "./agentcore-phase-log.js";

describe("agentcore phase logging", () => {
  it("builds a span-shaped phase record without message content", () => {
    const record = buildAgentCorePhaseLog({
      source: "chat-agent-invoke",
      phase: "api.agentcore.dispatch",
      status: "completed",
      traceId: "trace-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      runtimeType: "pi",
      durationMs: 17,
      detail: "setup=44ms",
      timestamp: "2026-06-02T15:00:00.000Z",
    });

    expect(record).toEqual({
      name: "thinkwork.agentcore.phase",
      scope: { name: "thinkwork.agentcore.phase" },
      event: "agentcore_phase",
      spanId: "tw-chat-agent-invoke-api.agentcore.dispatch-turn-1",
      sessionId: "turn-1",
      phase: "api.agentcore.dispatch",
      status: "completed",
      source: "chat-agent-invoke",
      traceId: "trace-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      runtimeType: "pi",
      durationMs: 17,
      count: undefined,
      detail: "setup=44ms",
      errorType: undefined,
      ts: "2026-06-02T15:00:00.000Z",
    });
  });

  it("writes one raw JSON phase line to stdout", () => {
    // THINK-915: the line must be JSON end to end (no console prefix) so the
    // CloudWatch metric filters can parse it with a JSON filter pattern.
    const written: string[] = [];
    const out = {
      write: (chunk: string) => {
        written.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    logAgentCorePhase(
      {
        source: "chat-agent-finalize",
        phase: "api.finalize.process",
        status: "failed",
        threadTurnId: "turn-1",
        errorType: "Error",
      },
      out,
    );

    expect(written).toHaveLength(1);
    expect(written[0]!.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(written[0]!);
    expect(parsed).toMatchObject({
      event: "agentcore_phase",
      phase: "api.finalize.process",
      status: "failed",
      source: "chat-agent-finalize",
      sessionId: "turn-1",
    });
  });

  it("defaults to process.stdout", () => {
    const spy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      logAgentCorePhase({
        source: "agentcore-runtime-dispatch",
        phase: "api.runtime_dispatch.invoke",
        status: "completed",
        durationMs: 52123,
        threadTurnId: "turn-2",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
      expect(parsed).toMatchObject({
        event: "agentcore_phase",
        phase: "api.runtime_dispatch.invoke",
        status: "completed",
        durationMs: 52123,
      });
    } finally {
      spy.mockRestore();
    }
  });
});
