import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskReviewJsonRenderFixture } from "@thinkwork/thread-json-render";

const TENANT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_ID = "44444444-4444-4444-4444-444444444444";
const TURN_ID = "66666666-6666-6666-6666-666666666666";

const mocks = vi.hoisted(() => ({
  messageInserts: [] as Array<Record<string, unknown>>,
  turnRows: [] as Array<Record<string, unknown>>,
  appended: [] as Array<Record<string, unknown>>,
  notifyNewMessage: vi.fn(() => Promise.resolve()),
  notifyThreadTurnStep: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../graphql/utils.js", () => {
  const insertBuilder = {
    values: vi.fn((row: Record<string, unknown>) => {
      mocks.messageInserts.push(row);
      return Promise.resolve(undefined);
    }),
  };
  const selectBuilder = {
    from: () => selectBuilder,
    where: () => selectBuilder,
    orderBy: () => selectBuilder,
    limit: () => Promise.resolve(mocks.turnRows),
  };
  return {
    and: (...c: unknown[]) => ({ and: c }),
    eq: (f: unknown, v: unknown) => ({ eq: [f, v] }),
    desc: (f: unknown) => ({ desc: f }),
    randomUUID: () => "11111111-1111-1111-1111-111111111111",
    messages: { id: { name: "messages.id" } },
    threadTurns: {
      id: { name: "thread_turns.id" },
      tenant_id: { name: "thread_turns.tenant_id" },
      thread_id: { name: "thread_turns.thread_id" },
      created_at: { name: "thread_turns.created_at" },
    },
    db: {
      insert: vi.fn(() => insertBuilder),
      select: vi.fn(() => selectBuilder),
    },
  };
});

vi.mock("../../graphql/notify.js", () => ({
  notifyNewMessage: mocks.notifyNewMessage,
  notifyThreadTurnStep: mocks.notifyThreadTurnStep,
}));

vi.mock("../thread-turn-events.js", () => ({
  drizzleThreadTurnEventStore: () => ({}),
  appendThreadTurnEvent: vi.fn((_store: unknown, input: Record<string, unknown>) => {
    mocks.appended.push(input);
    return Promise.resolve({ id: 1, seq: 7 });
  }),
}));

import { materializeCanvasIntoThread } from "./canvas-materialize.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.messageInserts.length = 0;
  mocks.turnRows = [];
  mocks.appended.length = 0;
});

describe("materializeCanvasIntoThread", () => {
  it("inserts a durable message carrying the part under its stable id + notifies", async () => {
    const part = createTaskReviewJsonRenderFixture();
    mocks.turnRows = []; // no live turn

    const result = await materializeCanvasIntoThread({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      part,
    });

    expect(mocks.messageInserts).toHaveLength(1);
    const msg = mocks.messageInserts[0];
    expect(msg).toMatchObject({
      thread_id: THREAD_ID,
      tenant_id: TENANT_ID,
      role: "assistant",
    });
    expect((msg.parts as Array<{ id: string }>)[0].id).toBe(part.id);
    expect(mocks.notifyNewMessage).toHaveBeenCalledTimes(1);
    // No live turn → no state_snapshot event.
    expect(mocks.appended).toHaveLength(0);
    expect(result.eventSeq).toBeNull();
  });

  it("publishes a state_snapshot event on the most recent turn when one exists", async () => {
    const part = createTaskReviewJsonRenderFixture();
    mocks.turnRows = [{ id: TURN_ID }];

    const result = await materializeCanvasIntoThread({
      tenantId: TENANT_ID,
      threadId: THREAD_ID,
      agentId: AGENT_ID,
      part,
    });

    expect(mocks.appended).toHaveLength(1);
    expect(mocks.appended[0]).toMatchObject({
      runId: TURN_ID,
      eventType: "state_snapshot",
    });
    expect(mocks.notifyThreadTurnStep).toHaveBeenCalledTimes(1);
    expect(result.eventSeq).toBe(7);
  });
});
