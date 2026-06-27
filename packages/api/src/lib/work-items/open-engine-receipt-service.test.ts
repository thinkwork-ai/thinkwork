import { beforeEach, describe, expect, it, vi } from "vitest";

const { captures, mockDb, tables } = vi.hoisted(() => {
  const table = (name: string, fields: string[]) =>
    Object.fromEntries([
      ["__table__", name],
      ...fields.map((field) => [field, `${name}.${field}`]),
    ]);

  const tables = {
    workItems: table("work_items", [
      "id",
      "tenant_id",
      "blocked",
      "completed_at",
      "completed_by_agent_id",
      "open_engine_human_hold",
      "open_engine_human_hold_reason",
      "open_engine_claimed_by_agent_id",
      "open_engine_claimed_at",
      "open_engine_claim_expires_at",
      "updated_at",
    ]),
    workItemEvents: table("work_item_events", [
      "tenant_id",
      "space_id",
      "work_item_id",
      "thread_id",
      "actor_agent_id",
      "event_type",
      "message",
      "metadata",
    ]),
  };

  const captures = {
    selectWhere: [] as unknown[],
    selectQueue: [] as unknown[][],
    updateSet: [] as Record<string, unknown>[],
    updateWhere: [] as unknown[],
    insertValues: [] as Record<string, unknown>[],
    insertReturningQueue: [] as unknown[][],
  };

  const buildSelectChain = () => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((predicate: unknown) => {
        captures.selectWhere.push(predicate);
        return chain;
      }),
      then: (resolve: any, reject: any) =>
        Promise.resolve(captures.selectQueue.shift() ?? []).then(
          resolve,
          reject,
        ),
    };
    return chain;
  };

  const buildUpdateChain = () => {
    const chain: any = {
      set: vi.fn((values: Record<string, unknown>) => {
        captures.updateSet.push(values);
        return chain;
      }),
      where: vi.fn((predicate: unknown) => {
        captures.updateWhere.push(predicate);
        return chain;
      }),
      then: (resolve: any) => Promise.resolve(undefined).then(resolve),
    };
    return chain;
  };

  const buildInsertChain = () => {
    const chain: any = {
      values: vi.fn((values: Record<string, unknown>) => {
        captures.insertValues.push(values);
        return chain;
      }),
      returning: vi.fn(async () => captures.insertReturningQueue.shift() ?? []),
    };
    return chain;
  };

  const db = {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
    insert: vi.fn(() => buildInsertChain()),
    transaction: vi.fn((fn: any) => fn(db)),
  };

  return { captures, mockDb: db, tables };
});

vi.mock("../../graphql/utils.js", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  db: mockDb,
  eq: vi.fn((field: unknown, value: unknown) => ({ eq: [field, value] })),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.reduce(
      (acc, fragment, index) =>
        `${acc}${fragment}${index < values.length ? "?" : ""}`,
      "",
    ),
  })),
  workItemEvents: tables.workItemEvents,
  workItems: tables.workItems,
}));

import { recordOpenEngineReceipt } from "./open-engine-receipt-service.js";

const NOW = new Date("2026-06-27T13:00:00Z");
const WORK_ITEM = {
  id: "work-item-1",
  tenant_id: "tenant-1",
  space_id: "space-1",
};

beforeEach(() => {
  captures.selectWhere.length = 0;
  captures.selectQueue.length = 0;
  captures.updateSet.length = 0;
  captures.updateWhere.length = 0;
  captures.insertValues.length = 0;
  captures.insertReturningQueue.length = 0;
  vi.clearAllMocks();
});

describe("Open Engine Work Item receipts", () => {
  it("records a blocked receipt and releases the active claim for human input", async () => {
    captures.selectQueue.push([WORK_ITEM]);
    captures.insertReturningQueue.push([{ id: "event-1" }]);

    const event = await recordOpenEngineReceipt({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "blocked",
      threadId: "thread-1",
      message: "Need the customer EIN.",
      evidence: { questionId: "q-1" },
      metadata: { attempt: 2 },
      now: NOW,
    });

    expect(event).toEqual({ id: "event-1" });
    expect(captures.updateSet[0]).toEqual({
      blocked: true,
      open_engine_human_hold: true,
      open_engine_human_hold_reason: "Need the customer EIN.",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: NOW,
    });
    expect(captures.insertValues[0]).toEqual({
      tenant_id: "tenant-1",
      space_id: "space-1",
      work_item_id: "work-item-1",
      thread_id: "thread-1",
      actor_agent_id: "agent-1",
      event_type: "agent_action",
      message: "Need the customer EIN.",
      metadata: {
        source: "open_engine",
        receiptType: "blocked",
        evidence: { questionId: "q-1" },
        attempt: 2,
      },
    });
  });

  it("returns an existing receipt for a repeated idempotency key", async () => {
    captures.selectQueue.push([WORK_ITEM], [{ id: "event-existing" }]);

    const event = await recordOpenEngineReceipt({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "progress",
      idempotencyKey: "retry-key-1",
      now: NOW,
    });

    expect(event).toEqual({ id: "event-existing" });
    expect(captures.updateSet).toEqual([]);
    expect(captures.insertValues).toEqual([]);
  });

  it("records a resumed receipt and clears human hold state", async () => {
    captures.selectQueue.push([WORK_ITEM]);
    captures.insertReturningQueue.push([{ id: "event-2" }]);

    await recordOpenEngineReceipt({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "resumed",
      now: NOW,
    });

    expect(captures.updateSet[0]).toEqual({
      blocked: false,
      open_engine_human_hold: false,
      open_engine_human_hold_reason: null,
      updated_at: NOW,
    });
    expect(captures.insertValues[0]).toEqual(
      expect.objectContaining({
        event_type: "agent_action",
        message: "Open Engine resumed receipt recorded.",
        metadata: {
          source: "open_engine",
          receiptType: "resumed",
        },
      }),
    );
  });

  it("records a progress receipt without changing queue hold or claim state", async () => {
    captures.selectQueue.push([WORK_ITEM]);
    captures.insertReturningQueue.push([{ id: "event-3" }]);

    await recordOpenEngineReceipt({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "progress",
      now: NOW,
    });

    expect(captures.updateSet[0]).toEqual({ updated_at: NOW });
    expect(captures.insertValues[0]).toEqual(
      expect.objectContaining({
        event_type: "agent_action",
        metadata: {
          source: "open_engine",
          receiptType: "progress",
        },
      }),
    );
  });

  it("accepts agent-prefixed Open Engine receipt vocabulary", async () => {
    captures.selectQueue.push([WORK_ITEM]);
    captures.insertReturningQueue.push([{ id: "event-4" }]);

    await recordOpenEngineReceipt({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "AGENT HUMAN HOLD",
      message: "Waiting for design approval.",
      now: NOW,
    });

    expect(captures.updateSet[0]).toEqual({
      blocked: false,
      open_engine_human_hold: true,
      open_engine_human_hold_reason: "Waiting for design approval.",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: NOW,
    });
    expect(captures.insertValues[0]).toMatchObject({
      metadata: {
        source: "open_engine",
        receiptType: "human_hold",
      },
    });
  });

  it("marks done receipts as completed by the agent and releases the claim", async () => {
    captures.selectQueue.push([WORK_ITEM]);
    captures.insertReturningQueue.push([{ id: "event-5" }]);

    await recordOpenEngineReceipt({
      tenantId: "tenant-1",
      workItemId: "work-item-1",
      agentId: "agent-1",
      receiptType: "AGENT DONE",
      now: NOW,
    });

    expect(captures.updateSet[0]).toEqual({
      completed_at: NOW,
      completed_by_agent_id: "agent-1",
      open_engine_claimed_by_agent_id: null,
      open_engine_claimed_at: null,
      open_engine_claim_expires_at: null,
      updated_at: NOW,
    });
    expect(captures.insertValues[0]).toMatchObject({
      metadata: {
        source: "open_engine",
        receiptType: "done",
      },
    });
  });

  it("returns NOT_FOUND when the Work Item is missing", async () => {
    captures.selectQueue.push([]);

    await expect(
      recordOpenEngineReceipt({
        tenantId: "tenant-1",
        workItemId: "missing",
        agentId: "agent-1",
        receiptType: "progress",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      extensions: { code: "NOT_FOUND" },
    });
  });

  it("rejects unsupported receipt types", async () => {
    await expect(
      recordOpenEngineReceipt({
        tenantId: "tenant-1",
        workItemId: "work-item-1",
        agentId: "agent-1",
        receiptType: "surprised",
        now: NOW,
      }),
    ).rejects.toMatchObject({
      extensions: { code: "BAD_USER_INPUT" },
    });
  });
});
