import { beforeEach, describe, expect, it, vi } from "vitest";

const updateCalls: Array<{ values: Record<string, unknown> }> = [];
let updatedRows: Array<{ id: string }> = [];
const notifyThreadTurnUpdate = vi.fn(async () => undefined);
const releaseThreadCheckout = vi.fn(async () => undefined);

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            updateCalls.push({ values });
            return Promise.resolve(updatedRows);
          },
        }),
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

function dlqRecord(payload: Record<string, unknown>, messageId = "m-1") {
  return {
    messageId,
    body: JSON.stringify({
      rawPath: "/invocations",
      body: JSON.stringify(payload),
    }),
  };
}

const turnPayload = {
  tenant_id: "tenant-1",
  assistant_id: "agent-1",
  thread_id: "thread-1",
  thread_turn_id: "turn-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  updatedRows = [];
});

describe("agentcore-dispatch-dlq-redrive", () => {
  it("marks an unfinalized turn failed exactly once and releases the checkout", async () => {
    updatedRows = [{ id: "turn-1" }];
    const { handler } = await import("./agentcore-dispatch-dlq-redrive.js");
    await handler({ Records: [dlqRecord(turnPayload)] });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.error_code).toBe(
      "agentcore_runtime_dispatch_lost",
    );
    expect(notifyThreadTurnUpdate).toHaveBeenCalledTimes(1);
    expect(releaseThreadCheckout).toHaveBeenCalledWith({
      threadId: "thread-1",
      runId: "turn-1",
    });
  });

  it("is a no-op for an already-finalized turn (idempotent)", async () => {
    updatedRows = [];
    const { handler } = await import("./agentcore-dispatch-dlq-redrive.js");
    await handler({ Records: [dlqRecord(turnPayload)] });

    expect(updateCalls).toHaveLength(1);
    expect(notifyThreadTurnUpdate).not.toHaveBeenCalled();
    expect(releaseThreadCheckout).not.toHaveBeenCalled();
  });

  it("survives unparseable records without touching the DB", async () => {
    const { handler } = await import("./agentcore-dispatch-dlq-redrive.js");
    await handler({
      Records: [{ messageId: "m-x", body: "not json" }],
    });

    expect(updateCalls).toHaveLength(0);
  });
});
