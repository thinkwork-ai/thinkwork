import { describe, expect, it, vi } from "vitest";

import {
  buildHarnessMemoryRetainRequest,
  dispatchHarnessMemoryRetain,
} from "./memory-retain.js";

const payload = {
  tenant_id: "tenant-1",
  user_id: "user-1",
  thread_id: "thread-1",
  thread_turn_id: "turn-1",
  space_id: "space-1",
  use_memory: true,
  message: "current",
  messages_history: [
    { role: "user", content: "prior" },
    { role: "assistant", content: "answer" },
    { role: "system", content: "ignored" },
  ],
};

describe("Harness post-turn memory retention", () => {
  it("builds an exact-user idempotent request from trusted dispatch fields", () => {
    expect(buildHarnessMemoryRetainRequest(payload)).toEqual({
      tenantId: "tenant-1",
      userId: "user-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      spaceId: "space-1",
      transcript: [
        { role: "user", content: "prior" },
        { role: "assistant", content: "answer" },
        { role: "user", content: "current" },
      ],
      metadata: {
        threadTurnId: "turn-1",
        sourceEventKey: "thread-turn:turn-1",
        spaceId: "space-1",
      },
    });
  });

  it("suppresses eval, opt-out, and ownerless traffic", () => {
    expect(
      buildHarnessMemoryRetainRequest({ ...payload, use_memory: false }),
    ).toBeNull();
    expect(
      buildHarnessMemoryRetainRequest({ ...payload, trigger_channel: "eval" }),
    ).toBeNull();
    expect(
      buildHarnessMemoryRetainRequest({ ...payload, user_id: undefined }),
    ).toBeNull();
  });

  it("queues the canonical request with Lambda async retries disabled upstream", async () => {
    const send = vi.fn().mockResolvedValue({ StatusCode: 202 });
    const result = await dispatchHarnessMemoryRetain({
      payload,
      functionName: "thinkwork-dev-api-memory-retain",
      lambdaClient: { send } as never,
    });

    expect(result).toEqual({ dispatched: true });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0];
    expect(command.input).toMatchObject({
      FunctionName: "thinkwork-dev-api-memory-retain",
      InvocationType: "Event",
    });
    expect(
      JSON.parse(new TextDecoder().decode(command.input.Payload)),
    ).toMatchObject({
      userId: "user-1",
      threadTurnId: "turn-1",
      metadata: { sourceEventKey: "thread-turn:turn-1" },
    });
  });

  it("reports queue failures without failing the completed user turn", async () => {
    const result = await dispatchHarnessMemoryRetain({
      payload,
      functionName: "memory-retain",
      lambdaClient: {
        send: vi.fn().mockRejectedValue(new Error("denied")),
      } as never,
    });

    expect(result).toEqual({
      dispatched: false,
      reason: "invoke_failed",
      error: "denied",
    });
  });
});
