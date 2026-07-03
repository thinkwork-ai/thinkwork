import { describe, expect, it } from "vitest";

import {
  buildMemoryRetainRequest,
  buildRetainTranscript,
  isEvalTrafficPayload,
  retainConversation,
} from "./memory-retain-client.js";
import type { RuntimeEnvSnapshot } from "../../handler-context.js";
import type { IdentitySnapshot } from "../../handler-context.js";

const identity: IdentitySnapshot = {
  tenantId: "tenant-1",
  userId: "user-1",
  agentId: "agent-1",
  threadId: "thread-1",
  tenantSlug: "tenant",
  agentSlug: "agent",
  traceId: "trace-1",
};

describe("memory-retain-client", () => {
  it("builds the transcript tail from history, user message, and assistant content", () => {
    expect(
      buildRetainTranscript(
        {
          messages_history: [
            { role: "system", content: "ignore" },
            { role: "user", content: "Birdie is my poodle." },
            { role: "assistant", content: "Got it." },
            { role: "assistant", content: "  " },
          ],
          message: "Her favorite toy is Orbit.",
        },
        "I'll remember that.",
      ),
    ).toEqual([
      { role: "user", content: "Birdie is my poodle." },
      { role: "assistant", content: "Got it." },
      { role: "user", content: "Her favorite toy is Orbit." },
      { role: "assistant", content: "I'll remember that." },
    ]);
  });

  it("passes thread turn and space scope through to the retain Lambda", () => {
    expect(
      buildMemoryRetainRequest(
        {
          use_memory: true,
          thread_turn_id: "turn-1",
          message: "In the Launch space, release codename is Bluejay.",
        },
        { ...identity, spaceId: "space-1" },
        "Noted.",
      ),
    ).toMatchObject({
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      spaceId: "space-1",
      metadata: {
        threadTurnId: "turn-1",
        spaceId: "space-1",
        sourceEventKey: "thread-turn:turn-1",
      },
    });
  });

  it("recognizes eval traffic from eval_mode or trigger_channel", () => {
    expect(isEvalTrafficPayload({ eval_mode: true })).toBe(true);
    expect(isEvalTrafficPayload({ eval_mode: "true" })).toBe(true);
    expect(isEvalTrafficPayload({ trigger_channel: "eval" })).toBe(true);
    expect(isEvalTrafficPayload({ trigger_channel: "chat" })).toBe(false);
    expect(isEvalTrafficPayload({})).toBe(false);
  });

  it("stamps evalTraffic into retain metadata for eval payloads", () => {
    expect(
      buildMemoryRetainRequest(
        { use_memory: true, eval_mode: true, message: "synthetic" },
        identity,
        "ok",
      ).metadata,
    ).toMatchObject({ evalTraffic: true });
    expect(
      buildMemoryRetainRequest(
        { use_memory: true, message: "real" },
        identity,
        "ok",
      ).metadata?.evalTraffic,
    ).toBeUndefined();
  });

  it("explicitly suppresses retain for eval traffic even when use_memory is true", async () => {
    const env = {
      memoryRetainFnName: "memory-retain-fn",
      awsRegion: "us-east-1",
    } as unknown as RuntimeEnvSnapshot;
    const send = { calls: 0 };
    const lambdaClient = {
      send: async () => {
        send.calls += 1;
        return {};
      },
    } as never;

    const evalResult = await retainConversation({
      payload: { use_memory: true, eval_mode: true, message: "synthetic" },
      identity,
      env,
      assistantContent: "ok",
      lambdaClient,
    });
    expect(evalResult).toEqual({ retained: false });
    expect(send.calls).toBe(0);

    const realResult = await retainConversation({
      payload: { use_memory: true, message: "real" },
      identity,
      env,
      assistantContent: "ok",
      lambdaClient,
    });
    expect(realResult).toEqual({ retained: true });
    expect(send.calls).toBe(1);
  });
});
