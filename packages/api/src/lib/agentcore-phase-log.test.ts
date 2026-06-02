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

  it("writes one JSON phase line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logAgentCorePhase({
        source: "chat-agent-finalize",
        phase: "api.finalize.process",
        status: "failed",
        threadTurnId: "turn-1",
        errorType: "Error",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(spy.mock.calls[0]![0] as string);
      expect(parsed).toMatchObject({
        event: "agentcore_phase",
        phase: "api.finalize.process",
        status: "failed",
        source: "chat-agent-finalize",
        sessionId: "turn-1",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
