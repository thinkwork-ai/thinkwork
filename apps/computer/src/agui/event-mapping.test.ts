import { describe, expect, it } from "vitest";
import {
  aguiEventsFromChunk,
  aguiEventsFromComputerEvents,
  mergeAguiEvents,
} from "./event-mapping";

describe("aguiEventsFromChunk", () => {
  it("maps legacy text chunks to text_delta events", () => {
    expect(
      aguiEventsFromChunk({
        seq: 1,
        chunk: JSON.stringify({ text: "hello" }),
        publishedAt: "2026-05-10T10:00:00.000Z",
      }),
    ).toEqual([
      {
        id: "chunk-1-text",
        type: "text_delta",
        source: "chunk",
        seq: 1,
        createdAt: "2026-05-10T10:00:00.000Z",
        text: "hello",
      },
    ]);
  });

  it("maps typed canvas_component chunks to Canvas events", () => {
    expect(
      aguiEventsFromChunk({
        seq: 2,
        chunk: {
          type: "canvas_component",
          eventId: "event-1",
          component: "lastmile_risk_canvas",
          props: { staleDeals: 7 },
        },
      }),
    ).toEqual([
      {
        id: "event-1",
        type: "canvas_component",
        source: "chunk",
        seq: 2,
        createdAt: null,
        component: "lastmile_risk_canvas",
        props: { staleDeals: 7 },
      },
    ]);
  });

  it("maps malformed or unknown chunks to diagnostic events", () => {
    expect(
      aguiEventsFromChunk({ seq: 3, chunk: "{not-json" })[0],
    ).toMatchObject({
      id: "chunk-3-diagnostic",
      type: "diagnostic",
      severity: "warn",
      message: "Chunk was not valid JSON or object",
    });

    expect(
      aguiEventsFromChunk({ seq: 4, chunk: { type: "mystery_event" } })[0],
    ).toMatchObject({
      id: "chunk-4-diagnostic",
      type: "diagnostic",
      severity: "warn",
      message: "Unsupported AG-UI event type: mystery_event",
    });
  });
});

describe("aguiEventsFromComputerEvents", () => {
  it("maps Computer task events into lifecycle and tool events in timestamp order", () => {
    expect(
      aguiEventsFromComputerEvents([
        {
          id: "event-2",
          eventType: "tool_invocation_started",
          payload: { tool_name: "web_search", reason: "research" },
          createdAt: "2026-05-10T10:02:00.000Z",
        },
        {
          id: "event-1",
          eventType: "thread_turn_enqueued",
          payload: { threadId: "thread-1" },
          createdAt: "2026-05-10T10:01:00.000Z",
        },
        {
          id: "event-3",
          eventType: "thread_turn_response_recorded",
          payload: { message: "done" },
          createdAt: "2026-05-10T10:03:00.000Z",
        },
      ]),
    ).toMatchObject([
      {
        id: "computer-event-event-1",
        type: "run_started",
        title: "Thread Turn Enqueued",
      },
      {
        id: "computer-event-event-2",
        type: "tool_call_started",
        toolName: "web_search",
        title: "Web Search",
      },
      {
        id: "computer-event-event-3",
        type: "run_finished",
        title: "Thread Turn Response Recorded",
      },
    ]);
  });
});

describe("mergeAguiEvents", () => {
  it("deduplicates by id and sorts by sequence before timestamp", () => {
    expect(
      mergeAguiEvents(
        [
          {
            id: "event-2",
            type: "text_delta",
            source: "chunk",
            seq: 2,
            text: "second",
          },
        ],
        [
          {
            id: "event-1",
            type: "text_delta",
            source: "chunk",
            seq: 1,
            text: "first",
          },
          {
            id: "event-2",
            type: "text_delta",
            source: "chunk",
            seq: 2,
            text: "updated",
          },
        ],
      ),
    ).toMatchObject([
      { id: "event-1", text: "first" },
      { id: "event-2", text: "updated" },
    ]);
  });
});
