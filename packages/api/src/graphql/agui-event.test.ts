import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  publishComputerThreadChunk: vi.fn(),
}));

vi.mock("./notify.js", () => ({
  publishComputerThreadChunk: mocks.publishComputerThreadChunk,
}));

import { publishComputerAguiEvent, toComputerAguiEvent } from "./agui-event.js";

describe("toComputerAguiEvent", () => {
  it("creates a typed event envelope with stable thread and sequence fields", () => {
    expect(
      toComputerAguiEvent({
        threadId: "thread-1",
        seq: 7,
        type: "canvas_component",
        eventId: "event-7",
        timestamp: "2026-05-10T11:30:00.000Z",
        payload: {
          component: "lastmile_risk_canvas",
          props: { staleDeals: 3 },
        },
      }),
    ).toEqual({
      type: "canvas_component",
      eventId: "event-7",
      threadId: "thread-1",
      timestamp: "2026-05-10T11:30:00.000Z",
      payload: {
        component: "lastmile_risk_canvas",
        props: { staleDeals: 3 },
      },
    });
  });

  it("rejects missing event type or invalid payload", () => {
    expect(() =>
      toComputerAguiEvent({
        threadId: "thread-1",
        seq: 1,
        type: "unknown" as never,
      }),
    ).toThrow(/Unsupported AG-UI event type/);

    expect(() =>
      toComputerAguiEvent({
        threadId: "thread-1",
        seq: 1,
        type: "diagnostic",
        payload: [] as never,
      }),
    ).toThrow(/payload must be an object/);
  });

  it("rejects non-positive or non-integer sequence values", () => {
    expect(() =>
      toComputerAguiEvent({
        threadId: "thread-1",
        seq: 0,
        type: "run_started",
      }),
    ).toThrow(/seq must be a positive integer/);
  });
});

describe("publishComputerAguiEvent", () => {
  it("serializes typed events through publishComputerThreadChunk", async () => {
    mocks.publishComputerThreadChunk.mockResolvedValueOnce(undefined);

    const event = await publishComputerAguiEvent({
      threadId: "thread-1",
      seq: 2,
      type: "text_delta",
      eventId: "text-2",
      timestamp: "2026-05-10T11:31:00.000Z",
      payload: { text: "hello" },
    });

    expect(event).toEqual({
      type: "text_delta",
      eventId: "text-2",
      threadId: "thread-1",
      timestamp: "2026-05-10T11:31:00.000Z",
      payload: { text: "hello" },
    });
    expect(mocks.publishComputerThreadChunk).toHaveBeenCalledWith({
      threadId: "thread-1",
      seq: 2,
      chunk: event,
    });
  });
});
