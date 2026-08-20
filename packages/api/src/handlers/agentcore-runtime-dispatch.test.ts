import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveAgentCoreSessionId,
  deriveAgentCoreUserSessionId,
} from "../lib/agentcore-session-id.js";

const invokeSend = vi.fn();
const ssmSend = vi.fn();
const turnUpdateWhere = vi.fn();
const notifyThreadTurnUpdate = vi.fn(async () => undefined);
const releaseThreadCheckout = vi.fn(async () => undefined);

class RetryableConflictException extends Error {
  name = "RetryableConflictException";
}
class RuntimeClientError extends Error {
  name = "RuntimeClientError";
}

vi.mock("@aws-sdk/client-bedrock-agentcore", () => ({
  BedrockAgentCoreClient: class {
    send = invokeSend;
  },
  InvokeAgentRuntimeCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: class {
    send = ssmSend;
  },
  GetParameterCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (...args: unknown[]) => {
          turnUpdateWhere({ values, args });
          return Promise.resolve([]);
        },
      }),
    }),
  }),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  threadTurns: {
    id: "id",
    tenant_id: "tenant_id",
    status: "status",
    finalized_at: "finalized_at",
  },
}));

vi.mock("../lib/chat-finalize/notify.js", () => ({
  notifyThreadTurnUpdate: (...args: unknown[]) =>
    notifyThreadTurnUpdate(...(args as [])),
}));

vi.mock("../lib/thread-checkout.js", () => ({
  releaseThreadCheckout: (...args: unknown[]) =>
    releaseThreadCheckout(...(args as [])),
}));

const identityPayload = {
  tenant_id: "tenant-1",
  assistant_id: "agent-1",
  user_id: "user-1",
  thread_id: "thread-1",
  thread_turn_id: "turn-1",
  message: "hello",
};

const warmPingPayload = {
  kind: "session_warm_ping",
  tenant_id: "tenant-1",
  assistant_id: "agent-1",
  user_id: "user-1",
  thread_id: "thread-1",
};

function envelope(payload: Record<string, unknown> = identityPayload) {
  return {
    requestContext: { http: { method: "POST", path: "/invocations" } },
    rawPath: "/invocations",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    isBase64Encoded: false,
  };
}

async function loadHandler() {
  const mod = await import("./agentcore-runtime-dispatch.js");
  mod.__resetRuntimeIdCacheForTests();
  return mod;
}

const perThreadSessionId = deriveAgentCoreSessionId({
  tenantId: "tenant-1",
  agentId: "agent-1",
  userId: "user-1",
  threadId: "thread-1",
});
const perUserSessionId = deriveAgentCoreUserSessionId({
  tenantId: "tenant-1",
  agentId: "agent-1",
  userId: "user-1",
});

const sessionIdsSent = () =>
  invokeSend.mock.calls.map((call) => call[0].input.runtimeSessionId);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AGENTCORE_SESSION_SCOPE;
  process.env.DISPATCH_CONFLICT_RETRY_DELAYS_MS = "1,1,1,1";
  process.env.AGENTCORE_PI_RUNTIME_SSM_NAME =
    "/thinkwork/test/agentcore/runtime-id-pi";
  process.env.AWS_ACCOUNT_ID = "111111111111";
  ssmSend.mockResolvedValue({ Parameter: { Value: "rt-abc123" } });
  invokeSend.mockResolvedValue({
    response: { transformToByteArray: async () => new Uint8Array() },
  });
});

describe("agentcore-runtime-dispatch", () => {
  it("invokes the runtime with the server-derived session ID and SSM ARN", async () => {
    const { handler } = await loadHandler();
    await handler(envelope());

    expect(invokeSend).toHaveBeenCalledTimes(1);
    const input = invokeSend.mock.calls[0][0].input;
    expect(input.agentRuntimeArn).toBe(
      "arn:aws:bedrock-agentcore:us-east-1:111111111111:runtime/rt-abc123",
    );
    expect(input.runtimeSessionId).toBe(
      deriveAgentCoreSessionId({
        tenantId: "tenant-1",
        agentId: "agent-1",
        userId: "user-1",
        threadId: "thread-1",
      }),
    );
    // Transport-identical payload plus the THINK-911 dispatch stamp the
    // container uses to compute the cold session-start gap.
    const sent = JSON.parse(new TextDecoder().decode(input.payload));
    const { dispatched_at_ms: dispatchedAtMs, ...rest } = sent;
    expect(rest).toEqual(identityPayload);
    expect(typeof dispatchedAtMs).toBe("number");
    expect(dispatchedAtMs).toBeGreaterThan(0);
    expect(turnUpdateWhere).not.toHaveBeenCalled();
  });

  it("uses the softened, jittered 409 ladder (THINK-912)", async () => {
    const { jitteredDelayMs } = await loadHandler();
    // ±25% around the base delay, never below 1ms.
    for (const base of [500, 1000, 2000, 4000]) {
      const value = jitteredDelayMs(base);
      expect(value).toBeGreaterThanOrEqual(Math.floor(base * 0.75));
      expect(value).toBeLessThanOrEqual(Math.ceil(base * 1.25));
    }
    expect(jitteredDelayMs(0)).toBe(0);
  });

  it("logs a conflict_wait phase for every 409 retry (THINK-912)", async () => {
    // Phase lines go to raw stdout (THINK-915), not console.log.
    const logSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    invokeSend
      .mockRejectedValueOnce(new RetryableConflictException("busy"))
      .mockResolvedValueOnce({
        response: { transformToByteArray: async () => new Uint8Array() },
      });
    const { handler } = await loadHandler();
    await handler(envelope());

    const phases = logSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(String(call[0]));
        } catch {
          return null;
        }
      })
      .filter((entry) => entry?.phase === "api.runtime_dispatch.conflict_wait");
    expect(phases.length).toBe(2);
    expect(phases[0].status).toBe("started");
    expect(phases[1].status).toBe("completed");
    expect(phases[1].durationMs).toBeGreaterThan(0);
    expect(String(phases[1].detail)).toContain("attempt=1/4");
    logSpy.mockRestore();
  });

  it("retries a 409 conflict and succeeds", async () => {
    invokeSend
      .mockRejectedValueOnce(new RetryableConflictException("busy"))
      .mockResolvedValueOnce({
        response: { transformToByteArray: async () => new Uint8Array() },
      });
    const { handler } = await loadHandler();
    await handler(envelope());

    expect(invokeSend).toHaveBeenCalledTimes(2);
    expect(turnUpdateWhere).not.toHaveBeenCalled();
  });

  it("fails the turn cleanly after 409 exhaustion", async () => {
    invokeSend.mockRejectedValue(new RetryableConflictException("busy"));
    const { handler } = await loadHandler();
    await handler(envelope());

    expect(invokeSend).toHaveBeenCalledTimes(5);
    expect(turnUpdateWhere).toHaveBeenCalledTimes(1);
    expect(turnUpdateWhere.mock.calls[0][0].values.error_code).toBe(
      "agentcore_runtime_dispatch_failed",
    );
    expect(notifyThreadTurnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "turn-1", status: "failed" }),
    );
    expect(releaseThreadCheckout).toHaveBeenCalledWith({
      threadId: "thread-1",
      runId: "turn-1",
    });
  });

  it("marks the turn failed with a runtime-log pointer on 424 without retrying", async () => {
    invokeSend.mockRejectedValue(new RuntimeClientError("container died"));
    const { handler } = await loadHandler();
    await handler(envelope());

    expect(invokeSend).toHaveBeenCalledTimes(1);
    expect(turnUpdateWhere).toHaveBeenCalledTimes(1);
    expect(String(turnUpdateWhere.mock.calls[0][0].values.error)).toContain(
      "runtime log group",
    );
  });

  it("rejects an envelope without user_id before any runtime call", async () => {
    const { handler } = await loadHandler();
    await expect(
      handler(envelope({ ...identityPayload, user_id: undefined })),
    ).rejects.toThrow(/user_id/);
    expect(invokeSend).not.toHaveBeenCalled();
  });

  it("dispatches a warm ping on the same session the real turn will use", async () => {
    const { handler } = await loadHandler();
    await handler(envelope(warmPingPayload));

    expect(invokeSend).toHaveBeenCalledTimes(1);
    const input = invokeSend.mock.calls[0][0].input;
    // Same derived session ID as the real turn for this thread — that is the
    // whole point: the microVM this boots is the one the turn lands on.
    expect(input.runtimeSessionId).toBe(
      deriveAgentCoreSessionId({
        tenantId: "tenant-1",
        agentId: "agent-1",
        userId: "user-1",
        threadId: "thread-1",
      }),
    );
    expect(JSON.parse(new TextDecoder().decode(input.payload))).toEqual(
      warmPingPayload,
    );
    // No turn bookkeeping of any kind.
    expect(turnUpdateWhere).not.toHaveBeenCalled();
    expect(notifyThreadTurnUpdate).not.toHaveBeenCalled();
    expect(releaseThreadCheckout).not.toHaveBeenCalled();
  });

  it("treats a warm-ping 409 as success and never retries", async () => {
    invokeSend.mockRejectedValue(new RetryableConflictException("busy"));
    const { handler } = await loadHandler();
    await expect(handler(envelope(warmPingPayload))).resolves.toBeUndefined();

    // One shot only — a queued ping would sit in front of the real turn.
    expect(invokeSend).toHaveBeenCalledTimes(1);
    expect(turnUpdateWhere).not.toHaveBeenCalled();
    expect(notifyThreadTurnUpdate).not.toHaveBeenCalled();
  });

  it("swallows a warm-ping 424 without failing any turn", async () => {
    invokeSend.mockRejectedValue(new RuntimeClientError("container died"));
    const { handler } = await loadHandler();
    await expect(handler(envelope(warmPingPayload))).resolves.toBeUndefined();

    expect(invokeSend).toHaveBeenCalledTimes(1);
    expect(turnUpdateWhere).not.toHaveBeenCalled();
  });

  it("swallows a warm-ping setup failure instead of throwing into the DLQ", async () => {
    ssmSend.mockRejectedValue(new Error("ssm unavailable"));
    const { handler } = await loadHandler();
    await expect(handler(envelope(warmPingPayload))).resolves.toBeUndefined();

    expect(invokeSend).not.toHaveBeenCalled();
    expect(turnUpdateWhere).not.toHaveBeenCalled();
  });

  it("rejects a warm ping that smuggles a thread_turn_id", async () => {
    const { handler } = await loadHandler();
    await expect(
      handler(envelope({ ...warmPingPayload, thread_turn_id: "turn-1" })),
    ).rejects.toThrow(/must not carry thread_turn_id/);
    expect(invokeSend).not.toHaveBeenCalled();
  });

  it("rejects a warm ping missing identity fields", async () => {
    const { handler } = await loadHandler();
    await expect(
      handler(envelope({ ...warmPingPayload, user_id: "" })),
    ).rejects.toThrow(/Warm-ping envelope is missing/);
    expect(invokeSend).not.toHaveBeenCalled();
  });

  it("rejects a non-invocations envelope", async () => {
    const { handler } = await loadHandler();
    await expect(handler({ rawPath: "/other", body: "{}" })).rejects.toThrow(
      /LWA \/invocations envelope/,
    );
    expect(invokeSend).not.toHaveBeenCalled();
  });
});

describe("agentcore-runtime-dispatch session scope (THINK-909)", () => {
  afterEach(() => {
    delete process.env.AGENTCORE_SESSION_SCOPE;
  });

  it("default (unset) scope preserves today's per-thread behavior exactly", async () => {
    const { handler } = await loadHandler();
    await handler(envelope());
    expect(sessionIdsSent()).toEqual([perThreadSessionId]);
  });

  it("AGENTCORE_SESSION_SCOPE=thread preserves today's 409 ladder", async () => {
    process.env.AGENTCORE_SESSION_SCOPE = "thread";
    invokeSend.mockRejectedValue(new RetryableConflictException("busy"));
    const { handler } = await loadHandler();
    await handler(envelope());
    // 1 initial + 4 ladder retries, all on the per-thread id, then failure.
    expect(sessionIdsSent()).toEqual(Array(5).fill(perThreadSessionId));
    expect(turnUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it("scope=user invokes the runtime with the v2 per-user session id", async () => {
    process.env.AGENTCORE_SESSION_SCOPE = "user";
    const { handler } = await loadHandler();
    await handler(envelope());
    expect(sessionIdsSent()).toEqual([perUserSessionId]);
    expect(perUserSessionId).not.toBe(perThreadSessionId);
  });

  it("first 409 falls back to the per-thread session immediately (no ladder sleep)", async () => {
    process.env.AGENTCORE_SESSION_SCOPE = "user";
    // A ladder rung this long would dominate the elapsed time if the
    // fallback waited: it must not.
    process.env.DISPATCH_CONFLICT_RETRY_DELAYS_MS = "60000,60000,60000,60000";
    invokeSend
      .mockRejectedValueOnce(new RetryableConflictException("busy"))
      .mockResolvedValueOnce({
        response: { transformToByteArray: async () => new Uint8Array() },
      });
    const { handler } = await loadHandler();
    const startedAt = Date.now();
    await handler(envelope());
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(sessionIdsSent()).toEqual([perUserSessionId, perThreadSessionId]);
    expect(turnUpdateWhere).not.toHaveBeenCalled();
  });

  it("409s on the per-thread fallback still walk the ladder, then fail cleanly", async () => {
    process.env.AGENTCORE_SESSION_SCOPE = "user";
    invokeSend.mockRejectedValue(new RetryableConflictException("busy"));
    const { handler } = await loadHandler();
    await handler(envelope());
    // 1 per-user attempt + the untouched per-thread ladder (1 + 4 retries).
    expect(sessionIdsSent()).toEqual([
      perUserSessionId,
      ...Array(5).fill(perThreadSessionId),
    ]);
    expect(turnUpdateWhere).toHaveBeenCalledTimes(1);
    expect(turnUpdateWhere.mock.calls[0][0].values.error_code).toBe(
      "agentcore_runtime_dispatch_failed",
    );
  });

  it("does not fall back on a non-conflict error under scope=user", async () => {
    process.env.AGENTCORE_SESSION_SCOPE = "user";
    invokeSend.mockRejectedValue(new RuntimeClientError("container died"));
    const { handler } = await loadHandler();
    await handler(envelope());
    expect(sessionIdsSent()).toEqual([perUserSessionId]);
  });

  it("logs the fallback as a countable phase event", async () => {
    process.env.AGENTCORE_SESSION_SCOPE = "user";
    const logs: string[] = [];
    // Phase lines go to raw stdout (THINK-915), not console.log.
    const logSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((line: unknown) => {
        logs.push(String(line));
        return true;
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeSend
      .mockRejectedValueOnce(new RetryableConflictException("busy"))
      .mockResolvedValueOnce({
        response: { transformToByteArray: async () => new Uint8Array() },
      });
    const { handler } = await loadHandler();
    await handler(envelope());
    logSpy.mockRestore();
    warnSpy.mockRestore();

    const fallback = logs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find(
        (entry) => entry?.phase === "api.runtime_dispatch.session_fallback",
      );
    expect(fallback).toMatchObject({
      source: "agentcore-runtime-dispatch",
      detail: "per_user_session_busy",
      threadTurnId: "turn-1",
    });
  });
});
