import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({ select: selectMock }),
}));

const retainTurnMock = vi.hoisted(() => vi.fn());
const getMemoryServicesMock = vi.hoisted(() => vi.fn());
const buildRetainSourceEventKeyMock = vi.hoisted(() => vi.fn());
const upsertRetainAttemptMock = vi.hoisted(() => vi.fn());
const claimRetainAttemptMock = vi.hoisted(() => vi.fn());
const markRetainAttemptRetainedMock = vi.hoisted(() => vi.fn());
const markRetainAttemptFailedMock = vi.hoisted(() => vi.fn());
const listDueRetainAttemptsMock = vi.hoisted(() => vi.fn());
const sweepExhaustedRunningAttemptsMock = vi.hoisted(() => vi.fn());
const classifyRetainErrorMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/memory/index.js", () => ({
  getMemoryServices: getMemoryServicesMock,
}));

vi.mock("../lib/memory/retain-attempts.js", () => ({
  buildRetainSourceEventKey: buildRetainSourceEventKeyMock,
  upsertRetainAttempt: upsertRetainAttemptMock,
  claimRetainAttempt: claimRetainAttemptMock,
  markRetainAttemptRetained: markRetainAttemptRetainedMock,
  markRetainAttemptFailed: markRetainAttemptFailedMock,
  listDueRetainAttempts: listDueRetainAttemptsMock,
  sweepExhaustedRunningAttempts: sweepExhaustedRunningAttemptsMock,
  classifyRetainError: classifyRetainErrorMock,
}));

import { handler } from "./memory-retain.js";

const TENANT_A = "0015953e-aa13-4cab-8398-2e70f73dda63";
const USER_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const AGENT_ID = "5f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
const THREAD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SPACE_ID = "bbbbbbbb-1111-2222-3333-cccccccccccc";

const BASE_ATTEMPT = {
  id: "attempt-1",
  tenant_id: TENANT_A,
  user_id: USER_ID,
  space_id: null,
  thread_id: THREAD_ID,
  thread_turn_id: null,
  source_event_key: "source-key",
  source_event_type: "thread_turn",
  provider: "agentcore",
  status: "queued",
  attempt_count: 1,
  max_attempts: 5,
  next_retry_at: null,
  locked_at: null,
  locked_by: null,
  started_at: null,
  finished_at: null,
  backend_latency_ms: null,
  provider_document_id: null,
  provider_result: null,
  error_class: null,
  error_message: null,
  metadata: {
    retryPayload: {
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "retry me" }],
    },
  },
  created_at: new Date("2026-06-28T00:00:00.000Z"),
  updated_at: new Date("2026-06-28T00:00:00.000Z"),
};

function buildAgentcoreServices() {
  getMemoryServicesMock.mockReturnValue({
    adapter: {
      kind: "agentcore",
      retainTurn: retainTurnMock,
    },
    config: { engine: "agentcore" },
  });
}

/** Drizzle chain for `resolveUserIdFromAgent`: select→from→where→limit. */
function buildAgentLookup(rows: Array<{ userId: string | null }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  selectMock.mockReturnValue({ from });
  return { from, where, limit };
}

describe("memory-retain handler", () => {
  beforeEach(() => {
    selectMock.mockReset();
    retainTurnMock.mockReset().mockResolvedValue(undefined);
    getMemoryServicesMock.mockReset();
    buildRetainSourceEventKeyMock.mockReset().mockReturnValue("source-key");
    upsertRetainAttemptMock.mockReset().mockResolvedValue(BASE_ATTEMPT);
    claimRetainAttemptMock.mockReset().mockResolvedValue(BASE_ATTEMPT);
    markRetainAttemptRetainedMock.mockReset().mockResolvedValue(undefined);
    markRetainAttemptFailedMock.mockReset().mockResolvedValue("failed_backend");
    listDueRetainAttemptsMock.mockReset().mockResolvedValue([]);
    sweepExhaustedRunningAttemptsMock.mockReset().mockResolvedValue(0);
    classifyRetainErrorMock.mockReset().mockImplementation((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "failed_backend",
        retryable: true,
        errorClass: message.includes("503") ? "backend_503" : "unknown",
        errorMessage: message,
      };
    });
  });

  // -------------------------------------------------------------------------
  // Payload validation
  // -------------------------------------------------------------------------

  it("rejects events without a tenantId", async () => {
    const result = await handler({ threadId: THREAD_ID });
    expect(result).toEqual({ ok: false, error: "MISSING_USER_CONTEXT" });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("rejects events with neither userId nor agentId", async () => {
    buildAgentcoreServices();
    const result = await handler({
      tenantId: TENANT_A,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "hi" }],
    });
    expect(result).toEqual({ ok: false, error: "MISSING_USER_CONTEXT" });
    expect(upsertRetainAttemptMock).not.toHaveBeenCalled();
  });

  it("returns MISSING_DOCUMENT_ID when threadId is absent", async () => {
    buildAgentcoreServices();
    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      transcript: [{ role: "user", content: "hi" }],
    });
    expect(result).toEqual({ ok: false, error: "MISSING_DOCUMENT_ID" });
    expect(upsertRetainAttemptMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // agentId → userId resolution (legacy runtime payloads)
  // -------------------------------------------------------------------------

  it("resolves a legacy agentId payload to the paired human userId", async () => {
    buildAgentcoreServices();
    buildAgentLookup([{ userId: USER_ID }]);

    const result = await handler({
      tenantId: TENANT_A,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "hi" }],
    });

    expect(result.ok).toBe(true);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(upsertRetainAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_A, userId: USER_ID }),
    );
    expect(retainTurnMock.mock.calls[0][0].ownerId).toBe(USER_ID);
  });

  it("an agentId with no paired human fails MISSING_USER_CONTEXT", async () => {
    buildAgentcoreServices();
    buildAgentLookup([]);

    const result = await handler({
      tenantId: TENANT_A,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ ok: false, error: "MISSING_USER_CONTEXT" });
    expect(upsertRetainAttemptMock).not.toHaveBeenCalled();
  });

  it("an explicit userId skips the agent lookup entirely", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "hi" }],
    });

    expect(result.ok).toBe(true);
    expect(selectMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Suppression at the door (THINK-261 #2) — before the ledger
  // -------------------------------------------------------------------------

  it("smoke-prefixed thread ids are suppressed at the door: no retain, no ledger row", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: "smoke-1720700000-abc123",
      transcript: [
        {
          role: "user",
          content:
            "This is a smoke-test fact: my favorite hot beverage is lapsang souchong tea",
        },
        { role: "assistant", content: "Noted." },
      ],
    });

    expect(result).toEqual({ ok: true, engine: "suppressed_smoke" });
    expect(retainTurnMock).not.toHaveBeenCalled();
    expect(upsertRetainAttemptMock).not.toHaveBeenCalled();
  });

  it("normal UUID-style thread ids are not caught by the smoke suppression (regression)", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });

    expect(result.ok).toBe(true);
    expect(retainTurnMock).toHaveBeenCalledTimes(1);
  });

  it("reflectExhaust-marked turns are suppressed at the door: no retain, no ledger row", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [
        { role: "user", content: "what do I know about Acme?" },
        { role: "assistant", content: "Synthesized from memory: ..." },
      ],
      metadata: { reflectExhaust: true },
    });

    expect(result).toEqual({ ok: true, engine: "suppressed_reflect_exhaust" });
    expect(retainTurnMock).not.toHaveBeenCalled();
    expect(upsertRetainAttemptMock).not.toHaveBeenCalled();
  });

  it("reflectExhaust accepts the string form 'true' from JSON payload plumbing", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [
        { role: "user", content: "what do I know about Acme?" },
        { role: "assistant", content: "Synthesized from memory: ..." },
      ],
      metadata: { reflectExhaust: "true" },
    });

    expect(result).toEqual({ ok: true, engine: "suppressed_reflect_exhaust" });
    expect(retainTurnMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // adapter.retainTurn — the only surviving write path
  // -------------------------------------------------------------------------

  it("happy path: the event transcript is normalized and handed to retainTurn", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      spaceId: SPACE_ID,
      transcript: [
        {
          role: "user",
          content: "  where did we land on Acme pricing?  ",
          timestamp: "2026-06-28T15:00:00.000Z",
        },
        { role: "assistant", content: "Summarized in the SOW thread." },
        { role: "system", content: "   " },
      ],
      metadata: { channel: "CHAT" },
    });

    expect(result).toEqual({
      ok: true,
      engine: "agentcore",
      attemptId: "attempt-1",
    });
    expect(retainTurnMock).toHaveBeenCalledTimes(1);
    const call = retainTurnMock.mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId: TENANT_A,
      ownerType: "user",
      ownerId: USER_ID,
      threadId: THREAD_ID,
      metadata: { channel: "CHAT" },
    });
    // Blank-content entries are dropped; content is trimmed.
    expect(call.messages).toEqual([
      {
        role: "user",
        content: "where did we land on Acme pricing?",
        timestamp: "2026-06-28T15:00:00.000Z",
      },
      {
        role: "assistant",
        content: "Summarized in the SOW thread.",
        timestamp: expect.any(String),
      },
    ]);
  });

  it("accepts the legacy agent-scoped `messages` payload", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      messages: [{ role: "user", content: "legacy shape" }],
    });

    expect(result.ok).toBe(true);
    expect(retainTurnMock.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ content: "legacy shape" }),
    ]);
  });

  it("unknown roles collapse to `user`", async () => {
    buildAgentcoreServices();

    await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "tool", content: "tool output" }],
    });

    expect(retainTurnMock.mock.calls[0][0].messages[0].role).toBe("user");
  });

  // -------------------------------------------------------------------------
  // Retain-attempt ledger
  // -------------------------------------------------------------------------

  it("records the attempt before the write and marks it retained after", async () => {
    buildAgentcoreServices();

    await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      threadTurnId: "turn-777",
      spaceId: SPACE_ID,
      transcript: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
      metadata: { channel: "CHAT" },
    });

    expect(upsertRetainAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        userId: USER_ID,
        threadId: THREAD_ID,
        threadTurnId: "turn-777",
        spaceId: SPACE_ID,
        sourceEventKey: "source-key",
        sourceEventType: "thread_turn",
        provider: "agentcore",
      }),
    );
    // The retry payload is embedded so the drain can replay the turn.
    const attemptMetadata = upsertRetainAttemptMock.mock.calls[0][0].metadata;
    expect(attemptMetadata).toMatchObject({
      channel: "CHAT",
      sourceEventKey: "source-key",
      eventMessageCount: 2,
      userId: USER_ID,
    });
    expect(attemptMetadata.retryPayload).toMatchObject({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      threadTurnId: "turn-777",
      spaceId: SPACE_ID,
    });

    expect(claimRetainAttemptMock).toHaveBeenCalledWith("attempt-1");
    expect(markRetainAttemptRetainedMock).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({
        providerDocumentId: THREAD_ID,
        backendLatencyMs: expect.any(Number),
        providerResult: expect.objectContaining({
          engine: "agentcore",
          adapterKind: "agentcore",
          messageCount: 2,
        }),
        metadata: expect.objectContaining({ eventMessageCount: 2 }),
      }),
    );
    expect(markRetainAttemptFailedMock).not.toHaveBeenCalled();
  });

  it("derives threadTurnId and spaceId from metadata when absent at the top level", async () => {
    buildAgentcoreServices();

    await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "hi" }],
      metadata: { threadTurnId: "turn-meta", spaceId: SPACE_ID },
    });

    expect(upsertRetainAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadTurnId: "turn-meta",
        spaceId: SPACE_ID,
      }),
    );
  });

  it("idempotency: an already running or retained attempt skips the provider write", async () => {
    buildAgentcoreServices();
    claimRetainAttemptMock.mockResolvedValueOnce(null);

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "duplicate" }],
    });

    expect(result).toEqual({
      ok: true,
      engine: "skipped",
      attemptId: "attempt-1",
    });
    expect(retainTurnMock).not.toHaveBeenCalled();
    expect(markRetainAttemptRetainedMock).not.toHaveBeenCalled();
  });

  it("an empty transcript fails the attempt with no_content and stays retryable", async () => {
    buildAgentcoreServices();

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [],
    });

    expect(result).toEqual({
      ok: false,
      engine: "agentcore",
      error: "no_content",
      attemptId: "attempt-1",
    });
    expect(retainTurnMock).not.toHaveBeenCalled();
    expect(markRetainAttemptFailedMock).toHaveBeenCalledWith(
      BASE_ATTEMPT,
      expect.objectContaining({
        errorMessage: "no_content",
        retryable: true,
      }),
      expect.any(Object),
    );
  });

  it("error path: adapter throws on retainTurn → classified failure recorded on the attempt", async () => {
    buildAgentcoreServices();
    retainTurnMock.mockRejectedValueOnce(new Error("agentcore 503"));

    const result = await handler({
      tenantId: TENANT_A,
      userId: USER_ID,
      threadId: THREAD_ID,
      transcript: [{ role: "user", content: "boom" }],
    });

    expect(result).toMatchObject({
      ok: false,
      engine: "agentcore",
      attemptId: "attempt-1",
    });
    expect(result.error).toMatch(/agentcore 503/);
    expect(classifyRetainErrorMock).toHaveBeenCalledTimes(1);
    expect(markRetainAttemptRetainedMock).not.toHaveBeenCalled();
    expect(markRetainAttemptFailedMock).toHaveBeenCalledWith(
      BASE_ATTEMPT,
      expect.objectContaining({
        status: "failed_backend",
        errorClass: "backend_503",
        retryable: true,
      }),
      expect.objectContaining({
        backendLatencyMs: expect.any(Number),
        metadata: expect.objectContaining({
          failedStatus: "failed_backend",
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Retry drain
  // -------------------------------------------------------------------------

  it("drain_due processes due attempts from their retry payload", async () => {
    buildAgentcoreServices();
    listDueRetainAttemptsMock.mockResolvedValueOnce([BASE_ATTEMPT]);
    claimRetainAttemptMock.mockResolvedValueOnce(BASE_ATTEMPT);

    const result = await handler({ kind: "drain_due", limit: 1 });

    expect(listDueRetainAttemptsMock).toHaveBeenCalledWith({ limit: 1 });
    expect(result).toMatchObject({
      ok: true,
      processed: 1,
      retained: 1,
      failed: 0,
    });
    expect(retainTurnMock).toHaveBeenCalledTimes(1);
    expect(retainTurnMock.mock.calls[0][0].messages).toEqual([
      expect.objectContaining({ content: "retry me" }),
    ]);
    expect(markRetainAttemptRetainedMock).toHaveBeenCalledTimes(1);
  });

  it("drain_due sweeps exhausted running attempts before listing due work", async () => {
    buildAgentcoreServices();
    sweepExhaustedRunningAttemptsMock.mockResolvedValueOnce(3);
    listDueRetainAttemptsMock.mockResolvedValueOnce([]);

    const result = await handler({ kind: "drain_due" });

    expect(sweepExhaustedRunningAttemptsMock).toHaveBeenCalled();
    expect(
      sweepExhaustedRunningAttemptsMock.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(listDueRetainAttemptsMock.mock.invocationCallOrder.at(-1)!);
    expect(result).toMatchObject({ ok: true, processed: 0 });
  });

  it("drain_due skips attempts another worker already claimed", async () => {
    buildAgentcoreServices();
    listDueRetainAttemptsMock.mockResolvedValueOnce([BASE_ATTEMPT]);
    claimRetainAttemptMock.mockResolvedValueOnce(null);

    const result = await handler({ kind: "drain_due" });

    expect(result).toMatchObject({ ok: true, processed: 0 });
    expect(retainTurnMock).not.toHaveBeenCalled();
  });

  it("drain_due dead-letters attempts whose retry payload is missing", async () => {
    buildAgentcoreServices();
    const payloadless = { ...BASE_ATTEMPT, metadata: {} };
    listDueRetainAttemptsMock.mockResolvedValueOnce([payloadless]);
    claimRetainAttemptMock.mockResolvedValueOnce(payloadless);

    const result = await handler({ kind: "drain_due" });

    expect(result).toMatchObject({ ok: false, processed: 1, failed: 1 });
    expect(retainTurnMock).not.toHaveBeenCalled();
    expect(markRetainAttemptFailedMock).toHaveBeenCalledWith(
      payloadless,
      expect.objectContaining({
        status: "dead_lettered",
        retryable: false,
        errorClass: "missing_retry_payload",
      }),
      expect.any(Object),
    );
  });

  it("drain_due reports a failed retry without aborting the batch", async () => {
    buildAgentcoreServices();
    listDueRetainAttemptsMock.mockResolvedValueOnce([BASE_ATTEMPT]);
    claimRetainAttemptMock.mockResolvedValueOnce(BASE_ATTEMPT);
    retainTurnMock.mockRejectedValueOnce(new Error("still down"));

    const result = await handler({ kind: "drain_due" });

    expect(result).toMatchObject({ ok: false, processed: 1, failed: 1 });
    expect(markRetainAttemptFailedMock).toHaveBeenCalledTimes(1);
  });
});
