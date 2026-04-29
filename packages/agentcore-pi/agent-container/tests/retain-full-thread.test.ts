/**
 * Tests for the Pi runtime's per-turn auto-retain seam.
 *
 * Covers buildRetainTranscript and retainFullThread (U2-Pi). The U3-Pi
 * call-site test lives in `tests/pi-loop.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LambdaClient } from "@aws-sdk/client-lambda";
import {
  __setLambdaClientForTest,
  buildRetainTranscript,
  retainFullThread,
} from "../src/runtime/tools/hindsight.js";
import type { RuntimeEnv } from "../src/runtime/env-snapshot.js";

const ENV: RuntimeEnv = {
  awsRegion: "us-east-1",
  gitSha: "test",
  buildTime: "test",
  workspaceBucket: "",
  workspaceDir: "/tmp",
};

describe("buildRetainTranscript", () => {
  it("brand-new thread: history empty → [user, assistant]", () => {
    const t = buildRetainTranscript(
      { use_memory: true, message: "hi" },
      "hello",
    );
    expect(t).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("3-turn thread: full history + new pair = 6 entries", () => {
    const history = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ];
    const t = buildRetainTranscript(
      { use_memory: true, messages_history: history, message: "u3" },
      "a3",
    );
    expect(t).toHaveLength(6);
    expect(t[5]).toEqual({ role: "assistant", content: "a3" });
  });

  it("filters non-user/assistant roles in history", () => {
    const history = [
      { role: "system", content: "system prompt" },
      { role: "tool", content: "tool output" },
      { role: "user", content: "u1" },
    ];
    const t = buildRetainTranscript(
      { use_memory: true, messages_history: history, message: "u2" },
      "a2",
    );
    expect(t.map((m) => m.role)).toEqual(["user", "user", "assistant"]);
  });

  it("drops empty content in history", () => {
    const history = [
      { role: "user", content: "" },
      { role: "assistant", content: "a1" },
    ];
    const t = buildRetainTranscript(
      { use_memory: true, messages_history: history, message: "u2" },
      "a2",
    );
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ role: "assistant", content: "a1" });
  });

  it("empty assistant content still includes user message", () => {
    const t = buildRetainTranscript(
      { use_memory: true, message: "u1" },
      "",
    );
    expect(t).toEqual([{ role: "user", content: "u1" }]);
  });
});

describe("retainFullThread", () => {
  let mockClient: LambdaClient;
  // `send` is overloaded on the AWS SDK client; vi.spyOn's generic
  // constraint on M doesn't model overloaded callable signatures, so we
  // type the spy loosely. The runtime contract is still pinned by the
  // explicit `as never` on mockResolvedValue and the call-site assertions.
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockClient = new LambdaClient({ region: "us-east-1" });
    sendSpy = vi.spyOn(mockClient, "send" as never).mockResolvedValue({} as never) as unknown as ReturnType<typeof vi.fn>;
    __setLambdaClientForTest(mockClient);
  });

  afterEach(() => {
    __setLambdaClientForTest(null);
    sendSpy.mockRestore();
  });

  function basePayload(overrides: Record<string, unknown> = {}) {
    return {
      use_memory: true,
      tenant_id: "tenant-A",
      user_id: "user-1",
      thread_id: "thread-1",
      message: "hi",
      ...overrides,
    };
  }

  it("AE1: happy path → InvocationType=Event with full payload shape", async () => {
    const result = await retainFullThread(
      basePayload({
        messages_history: [
          { role: "user", content: "u1" },
          { role: "assistant", content: "a1" },
        ],
      }),
      "hello",
      ENV,
      { MEMORY_RETAIN_FN_NAME: "memory-retain-dev" },
    );

    expect(result).toEqual({ retained: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const cmd = sendSpy.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(cmd.input.FunctionName).toBe("memory-retain-dev");
    expect(cmd.input.InvocationType).toBe("Event");
    const decoded = JSON.parse(new TextDecoder().decode(cmd.input.Payload as Uint8Array));
    expect(decoded).toEqual({
      tenantId: "tenant-A",
      userId: "user-1",
      threadId: "thread-1",
      transcript: [
        { role: "user", content: "u1" },
        { role: "assistant", content: "a1" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
  });

  it("opt-out: use_memory=false short-circuits with no Lambda call", async () => {
    const result = await retainFullThread(
      basePayload({ use_memory: false }),
      "hello",
      ENV,
      { MEMORY_RETAIN_FN_NAME: "memory-retain-dev" },
    );
    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("MEMORY_RETAIN_FN_NAME unset → no Lambda call", async () => {
    const result = await retainFullThread(basePayload(), "hello", ENV, {});
    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("missing thread_id → no Lambda call", async () => {
    const result = await retainFullThread(
      basePayload({ thread_id: "" }),
      "hello",
      ENV,
      { MEMORY_RETAIN_FN_NAME: "memory-retain-dev" },
    );
    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("missing tenant_id → no Lambda call", async () => {
    const result = await retainFullThread(
      basePayload({ tenant_id: "" }),
      "hello",
      ENV,
      { MEMORY_RETAIN_FN_NAME: "memory-retain-dev" },
    );
    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("empty transcript → no Lambda call", async () => {
    const result = await retainFullThread(
      basePayload({ message: "" }),
      "",
      ENV,
      { MEMORY_RETAIN_FN_NAME: "memory-retain-dev" },
    );
    expect(result).toEqual({ retained: false });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("AE5: Lambda invoke throws → returns {retained:false, error} (never propagates)", async () => {
    sendSpy.mockRejectedValueOnce(new Error("network down"));
    const result = await retainFullThread(basePayload(), "hello", ENV, {
      MEMORY_RETAIN_FN_NAME: "memory-retain-dev",
    });
    expect(result.retained).toBe(false);
    expect(result.error).toBe("network down");
  });

  it("R24 cross-runtime parity: payload shape matches Strands retain_full_thread", async () => {
    // The Strands U2 sends {tenantId, userId, threadId, transcript}; this
    // assertion locks Pi to the same shape so the Lambda doesn't need to
    // branch on caller runtime.
    await retainFullThread(basePayload(), "hello", ENV, {
      MEMORY_RETAIN_FN_NAME: "memory-retain-dev",
    });
    const cmd = sendSpy.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    const decoded = JSON.parse(new TextDecoder().decode(cmd.input.Payload as Uint8Array));
    expect(Object.keys(decoded).sort()).toEqual([
      "tenantId",
      "threadId",
      "transcript",
      "userId",
    ]);
  });
});
