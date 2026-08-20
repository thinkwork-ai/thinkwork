import { beforeEach, describe, expect, it, vi } from "vitest";
import { deriveAgentCoreSessionId } from "../lib/agentcore-session-id.js";

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

beforeEach(() => {
  vi.clearAllMocks();
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
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

  it("rejects a non-invocations envelope", async () => {
    const { handler } = await loadHandler();
    await expect(handler({ rawPath: "/other", body: "{}" })).rejects.toThrow(
      /LWA \/invocations envelope/,
    );
    expect(invokeSend).not.toHaveBeenCalled();
  });
});
