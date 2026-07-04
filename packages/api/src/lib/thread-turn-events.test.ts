import { describe, expect, it, vi } from "vitest";
import {
  createTaskReviewJsonRenderFixture,
  threadJsonRenderStateSnapshotPayload,
  type ThreadJsonRenderPart,
} from "@thinkwork/thread-json-render";
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

  // Living Artifacts U3 / KTD1: an AG-UI STATE_SNAPSHOT carries exactly one
  // json-render part, so a normal per-part snapshot passes the 64KB guard by
  // construction — while an oversized part still trips it (never silently
  // truncated: the guard rejects the whole payload).
  it("passes a normal per-part STATE_SNAPSHOT through the 64KB guard", () => {
    const payload = threadJsonRenderStateSnapshotPayload(
      createTaskReviewJsonRenderFixture(),
    );
    expect(() => assertThreadTurnEventPayloadSize(payload)).not.toThrow();
  });

  it("still trips the 64KB guard when a single snapshot part is oversized", () => {
    const base = createTaskReviewJsonRenderFixture();
    const oversized: ThreadJsonRenderPart = {
      ...base,
      data: {
        ...base.data,
        mobileFallback: {
          ...base.data.mobileFallback,
          summary: "x".repeat(70 * 1024),
        },
      },
    };
    const payload = threadJsonRenderStateSnapshotPayload(oversized);
    expect(() => assertThreadTurnEventPayloadSize(payload)).toThrow(
      ThreadTurnEventError,
    );
    expect(() => assertThreadTurnEventPayloadSize(payload)).toThrow(
      /exceeds 65536 bytes/,
    );
  });
});
