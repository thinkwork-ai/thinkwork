import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  whereCalls: [] as unknown[],
  returnedRows: [{ id: "delegation-1", status: "completed" }] as Array<{
    id: string;
    status: string;
  }>,
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (value: Record<string, unknown>) => {
        mocks.updates.push(value);
        return {
          where: (condition: unknown) => {
            mocks.whereCalls.push(condition);
            return {
              returning: async () => mocks.returnedRows,
            };
          },
        };
      },
    }),
  }),
}));

import {
  markConnectorDelegationTurnCompleted,
  markConnectorDelegationTurnFailed,
} from "./delegation-lifecycle.js";

describe("connector delegation lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates = [];
    mocks.whereCalls = [];
    mocks.returnedRows = [{ id: "delegation-1", status: "completed" }];
  });

  it("marks a running connector delegation completed from a successful thread turn", async () => {
    const result = await markConnectorDelegationTurnCompleted({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      messageId: "message-1",
      responseText: "A".repeat(1200),
      usage: { duration_ms: 420, input_tokens: 10 },
    });

    expect(result).toEqual({
      updatedCount: 1,
      delegationIds: ["delegation-1"],
    });
    expect(mocks.whereCalls).toHaveLength(1);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      status: "completed",
      error: null,
      output_artifacts: {
        threadTurnId: "turn-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
      },
      result: {
        threadTurnId: "turn-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
        status: "succeeded",
        responseLength: 1200,
        usage: { duration_ms: 420, input_tokens: 10 },
      },
    });
    expect(
      (mocks.updates[0].result as { responsePreview: string }).responsePreview,
    ).toHaveLength(1000);
    expect(mocks.updates[0].completed_at).toBeInstanceOf(Date);
  });

  it("marks a running connector delegation failed from a failed thread turn", async () => {
    mocks.returnedRows = [{ id: "delegation-2", status: "failed" }];

    const result = await markConnectorDelegationTurnFailed({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      messageId: "message-1",
      errorMessage: "B".repeat(2500),
      errorCode: "AgentCoreError",
    });

    expect(result).toEqual({
      updatedCount: 1,
      delegationIds: ["delegation-2"],
    });
    expect(mocks.whereCalls).toHaveLength(1);
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      status: "failed",
      result: null,
      output_artifacts: {
        threadTurnId: "turn-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
      },
      error: {
        threadTurnId: "turn-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
        status: "failed",
        code: "AgentCoreError",
      },
    });
    expect(
      (mocks.updates[0].error as { message: string }).message,
    ).toHaveLength(2000);
    expect(mocks.updates[0].completed_at).toBeInstanceOf(Date);
  });

  it("is idempotent when no running connector delegation matches", async () => {
    mocks.returnedRows = [];

    const result = await markConnectorDelegationTurnCompleted({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      messageId: "message-1",
      responseText: "done",
    });

    expect(result).toEqual({ updatedCount: 0, delegationIds: [] });
    expect(mocks.updates[0]).toMatchObject({
      status: "completed",
      output_artifacts: {
        threadTurnId: "turn-1",
        threadId: "thread-1",
        agentId: "agent-1",
        messageId: "message-1",
      },
    });
  });

  it("does not update by thread and agent alone when messageId is missing", async () => {
    const result = await markConnectorDelegationTurnCompleted({
      tenantId: "tenant-1",
      agentId: "agent-1",
      threadId: "thread-1",
      threadTurnId: "turn-1",
      responseText: "done",
    });

    expect(result).toEqual({ updatedCount: 0, delegationIds: [] });
    expect(mocks.updates).toEqual([]);
    expect(mocks.whereCalls).toEqual([]);
  });
});
