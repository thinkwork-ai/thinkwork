import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  abortMobileTurn,
  checkpointMobileTurn,
  finalizeLocalMobileTurn,
  heartbeatMobileTurn,
  MobileTurnLifecycleError,
  startMobileTurn,
  type MobileTurnLifecycleDeps,
  type MobileTurnStartResult,
} from "./lifecycle";

const NOW = new Date("2026-05-31T12:00:00.000Z");

function deps(): MobileTurnLifecycleDeps {
  const existing = new Map<string, MobileTurnStartResult>();
  return {
    now: () => NOW,
    loadCallerByEmail: vi.fn(async (email) => ({
      id: "user-1",
      tenantId: "tenant-1",
      email,
      name: "Eric Odom",
    })),
    loadThreadForStart: vi.fn(async () => ({
      id: "thread-1",
      tenantId: "tenant-1",
      agentId: "agent-1",
      spaceId: "space-1",
      userId: "user-1",
    })),
    loadExistingStart: vi.fn(
      async (input) => existing.get(input.clientTurnId) ?? null,
    ),
    createStartedTurn: vi.fn(async (input) => {
      const result = {
        threadTurnId: "turn-1",
        threadId: input.thread.id,
        userMessageId: "msg-user-1",
        status: "running",
        checkpointSeq: 0,
      };
      existing.set(input.clientTurnId, { ...result, idempotent: true });
      return result;
    }),
    updateHeartbeat: vi.fn(async () => true),
    appendCheckpoint: vi.fn(async () => ({ seq: 1 })),
    markBackground: vi.fn(async () => true),
    abortTurn: vi.fn(async () => true),
    finalizeLocalTurn: vi.fn(async () => ({
      finalized: true,
      assistantMessageId: "msg-assistant-1",
    })),
  };
}

const AUTH = { email: "Eric@Example.com", tenantId: "tenant-1" };

describe("mobile turn lifecycle", () => {
  let subject: MobileTurnLifecycleDeps;

  beforeEach(() => {
    subject = deps();
  });

  it("starts a durable mobile turn before local model work", async () => {
    const result = await startMobileTurn(
      {
        auth: AUTH,
        clientTurnId: "client-turn-1",
        threadId: "thread-1",
        userText: "What's my name?",
      },
      subject,
    );

    expect(result).toMatchObject({
      threadTurnId: "turn-1",
      userMessageId: "msg-user-1",
      checkpointSeq: 0,
      idempotent: false,
    });
    expect(subject.createStartedTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        now: NOW,
        agentId: "agent-1",
        clientTurnId: "client-turn-1",
        userText: "What's my name?",
      }),
    );
  });

  it("retries start idempotently for the same clientTurnId", async () => {
    await startMobileTurn(
      {
        auth: AUTH,
        clientTurnId: "client-turn-1",
        threadId: "thread-1",
        userText: "hello",
      },
      subject,
    );
    const second = await startMobileTurn(
      {
        auth: AUTH,
        clientTurnId: "client-turn-1",
        threadId: "thread-1",
        userText: "hello",
      },
      subject,
    );

    expect(second.idempotent).toBe(true);
    expect(subject.createStartedTurn).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-agent start attempts", async () => {
    await expect(
      startMobileTurn(
        {
          auth: AUTH,
          clientTurnId: "client-turn-2",
          threadId: "thread-1",
          agentId: "agent-other",
          userText: "hello",
        },
        subject,
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: "AGENT_THREAD_MISMATCH" });
  });

  it("heartbeats without appending checkpoint events", async () => {
    await expect(
      heartbeatMobileTurn(
        { auth: AUTH, threadTurnId: "turn-1", latestCheckpointSeq: 2 },
        subject,
      ),
    ).resolves.toEqual({ ok: true });

    expect(subject.updateHeartbeat).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      threadTurnId: "turn-1",
      now: NOW,
      latestCheckpointSeq: 2,
    });
    expect(subject.appendCheckpoint).not.toHaveBeenCalled();
  });

  it("appends safe checkpoints through the checkpoint path", async () => {
    const result = await checkpointMobileTurn(
      {
        auth: AUTH,
        threadTurnId: "turn-1",
        checkpoint: { events: [{ type: "tool_result" }] },
      },
      subject,
    );

    expect(result).toEqual({ seq: 1 });
    expect(subject.appendCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", safe: true }),
    );
  });

  it("marks aborted turns non-handoff-eligible through the abort path", async () => {
    await expect(
      abortMobileTurn(
        { auth: AUTH, threadTurnId: "turn-1", reason: "user" },
        subject,
      ),
    ).resolves.toEqual({ ok: true });
    expect(subject.abortTurn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", reason: "user" }),
    );
  });

  it("rejects late local finalize after ownership has moved", async () => {
    vi.mocked(subject.finalizeLocalTurn).mockResolvedValue({
      finalized: false,
      assistantMessageId: null,
    });

    await expect(
      finalizeLocalMobileTurn(
        {
          auth: AUTH,
          threadTurnId: "turn-1",
          assistantText: "done",
        },
        subject,
      ),
    ).rejects.toBeInstanceOf(MobileTurnLifecycleError);
  });
});
