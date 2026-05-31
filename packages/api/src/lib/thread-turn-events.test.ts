import { describe, expect, it, vi } from "vitest";
import {
  appendThreadTurnEvent,
  assertThreadTurnEventPayloadSize,
  nextThreadTurnEventSeq,
  ThreadTurnEventError,
  type ThreadTurnEventStore,
} from "./thread-turn-events";

describe("thread-turn-events", () => {
  it("allocates the first event sequence at zero", () => {
    expect(nextThreadTurnEventSeq(-1)).toBe(0);
  });

  it("allocates the next ordered event sequence", () => {
    expect(nextThreadTurnEventSeq(4)).toBe(5);
  });

  it("locks the parent turn before appending the next event", async () => {
    const calls: string[] = [];
    const store: ThreadTurnEventStore = {
      lockThreadTurn: vi.fn(async () => {
        calls.push("lock");
        return true;
      }),
      loadMaxSeq: vi.fn(async () => {
        calls.push("load-max");
        return 7;
      }),
      insertEvent: vi.fn(async (input) => {
        calls.push(`insert-${input.seq}`);
        return { id: "event-8", seq: input.seq };
      }),
    };

    const event = await appendThreadTurnEvent(store, {
      tenantId: "tenant-1",
      runId: "turn-1",
      eventType: "checkpoint",
      message: "checkpoint saved",
      payload: { ok: true },
    });

    expect(event).toEqual({ id: "event-8", seq: 8 });
    expect(calls).toEqual(["lock", "load-max", "insert-8"]);
  });

  it("rejects obviously oversized payloads", () => {
    expect(() =>
      assertThreadTurnEventPayloadSize({ text: "x".repeat(20) }, 10),
    ).toThrow(ThreadTurnEventError);
  });
});
