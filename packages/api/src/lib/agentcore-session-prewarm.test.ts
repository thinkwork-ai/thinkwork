import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSessionPrewarmEnvelope,
  dispatchSessionPrewarm,
  isSessionPrewarmEnabled,
  SESSION_WARM_PING_KIND,
} from "./agentcore-session-prewarm.js";

const identity = {
  tenantId: "tenant-1",
  agentId: "agent-1",
  userId: "user-1",
  threadId: "thread-1",
};

const flagOnEnv = {
  AGENTCORE_RUNTIME_DISPATCH_ENABLED: "true",
  AGENTCORE_RUNTIME_DISPATCH_FUNCTION_NAME: "thinkwork-test-dispatch",
} as NodeJS.ProcessEnv;

let invoke: ReturnType<typeof vi.fn>;

beforeEach(() => {
  invoke = vi.fn(async () => undefined);
});

describe("isSessionPrewarmEnabled", () => {
  it("defaults on and honours the kill-switch spellings", () => {
    expect(isSessionPrewarmEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    for (const value of ["0", "false", "off", "no", "FALSE"]) {
      expect(
        isSessionPrewarmEnabled({
          AGENTCORE_SESSION_PREWARM: value,
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    }
    expect(
      isSessionPrewarmEnabled({
        AGENTCORE_SESSION_PREWARM: "1",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});

describe("buildSessionPrewarmEnvelope", () => {
  it("carries only the discriminator plus session identity", () => {
    const envelope = JSON.parse(buildSessionPrewarmEnvelope(identity));
    expect(envelope.rawPath).toBe("/invocations");
    const body = JSON.parse(envelope.body);
    expect(body).toEqual({
      kind: SESSION_WARM_PING_KIND,
      tenant_id: "tenant-1",
      assistant_id: "agent-1",
      user_id: "user-1",
      thread_id: "thread-1",
    });
    // A ping must never look like a turn.
    expect(body.thread_turn_id).toBeUndefined();
    expect(body.message).toBeUndefined();
  });
});

describe("dispatchSessionPrewarm", () => {
  it("Event-invokes the dispatcher when both dispatch flags are on", async () => {
    const dispatched = await dispatchSessionPrewarm(
      { ...identity, agentFlagEnabled: true, runtimeType: "pi" },
      { invoke, env: flagOnEnv },
    );
    expect(dispatched).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0].functionName).toBe(
      "thinkwork-test-dispatch",
    );
    expect(JSON.parse(invoke.mock.calls[0][0].payload).rawPath).toBe(
      "/invocations",
    );
  });

  it("skips agents that ride the Pi Lambda path (no microVM to warm)", async () => {
    const dispatched = await dispatchSessionPrewarm(
      { ...identity, agentFlagEnabled: false, runtimeType: "pi" },
      {
        invoke,
        env: {
          ...flagOnEnv,
          AGENTCORE_PI_FUNCTION_NAME: "thinkwork-test-pi",
        } as NodeJS.ProcessEnv,
      },
    );
    expect(dispatched).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips when the stage kill-switch is off", async () => {
    const dispatched = await dispatchSessionPrewarm(
      { ...identity, agentFlagEnabled: true, runtimeType: "pi" },
      {
        invoke,
        env: {
          ...flagOnEnv,
          AGENTCORE_SESSION_PREWARM: "0",
        } as NodeJS.ProcessEnv,
      },
    );
    expect(dispatched).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("skips incomplete identity instead of deriving a bogus session", async () => {
    const dispatched = await dispatchSessionPrewarm(
      { ...identity, userId: "", agentFlagEnabled: true },
      { invoke, env: flagOnEnv },
    );
    expect(dispatched).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("never throws when the invoke fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("Lambda throttled");
    });
    await expect(
      dispatchSessionPrewarm(
        { ...identity, agentFlagEnabled: true, runtimeType: "pi" },
        { invoke: failing, env: flagOnEnv },
      ),
    ).resolves.toBe(false);
  });
});
