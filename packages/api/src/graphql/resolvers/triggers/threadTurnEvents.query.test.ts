import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../utils.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => mocks.rows,
          }),
        }),
      }),
    }),
  },
  eq: vi.fn((column, value) => ({ column, value })),
  gt: vi.fn((column, value) => ({ column, value })),
  and: vi.fn((...conditions) => ({ conditions })),
  threadTurnEvents: {
    run_id: "thread_turn_events.run_id",
    seq: "thread_turn_events.seq",
  },
  snakeToCamel: (row: Record<string, unknown>) => ({
    id: row.id,
    runId: row.run_id,
    eventType: row.event_type,
    payload: row.payload,
  }),
}));

import { threadTurnEvents_ } from "./threadTurnEvents.query";

describe("threadTurnEvents", () => {
  it("returns durable model-routed tool payloads unchanged", async () => {
    mocks.rows = [
      {
        id: 1,
        run_id: "turn-1",
        event_type: "model_routed_tool_call",
        payload: {
          tool_call_id: "tool-1",
          tool_name: "workspace_skill",
          model: "anthropic.claude-haiku",
          input_tokens: 100,
          output_tokens: 20,
          status: "completed",
        },
      },
    ];

    await expect(
      threadTurnEvents_(
        null,
        { runId: "turn-1", afterSeq: 0, limit: 50 },
        {} as never,
      ),
    ).resolves.toEqual([
      {
        id: 1,
        runId: "turn-1",
        eventType: "model_routed_tool_call",
        payload: {
          tool_call_id: "tool-1",
          tool_name: "workspace_skill",
          model: "anthropic.claude-haiku",
          input_tokens: 100,
          output_tokens: 20,
          status: "completed",
        },
      },
    ]);
  });
});
