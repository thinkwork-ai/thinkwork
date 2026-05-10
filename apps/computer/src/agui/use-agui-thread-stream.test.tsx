import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAguiThreadStream } from "./use-agui-thread-stream";

describe("useAguiThreadStream", () => {
  it("merges subscription chunks and persisted events without duplicate seq regressions", () => {
    const { result, rerender } = renderHook(
      ({
        chunks,
      }: {
        chunks: Array<{ seq: number; chunk: unknown; publishedAt?: string }>;
      }) =>
        useAguiThreadStream({
          threadId: "thread-1",
          chunks,
          computerEvents: [
            {
              id: "event-1",
              eventType: "thread_turn_enqueued",
              createdAt: "2026-05-10T10:00:00.000Z",
            },
          ],
        }),
      {
        initialProps: {
          chunks: [{ seq: 1, chunk: { text: "Hello" } }],
        },
      },
    );

    expect(result.current.events).toMatchObject([
      { id: "chunk-1-text", type: "text_delta", text: "Hello" },
      { id: "computer-event-event-1", type: "run_started" },
    ]);

    rerender({
      chunks: [
        { seq: 1, chunk: { text: "Hello" } },
        { seq: 2, chunk: { text: " world" } },
      ],
    });

    expect(result.current.events).toMatchObject([
      { id: "chunk-1-text", type: "text_delta", text: "Hello" },
      { id: "chunk-2-text", type: "text_delta", text: " world" },
      { id: "computer-event-event-1", type: "run_started" },
    ]);
    expect(result.current.events.map((event) => event.id)).toEqual([
      "chunk-1-text",
      "chunk-2-text",
      "computer-event-event-1",
    ]);
  });

  it("resets live chunk state when threadId changes", () => {
    const { result, rerender } = renderHook(
      ({
        threadId,
        chunks,
      }: {
        threadId: string;
        chunks: Array<{ seq: number; chunk: unknown }>;
      }) => useAguiThreadStream({ threadId, chunks }),
      {
        initialProps: {
          threadId: "thread-1",
          chunks: [{ seq: 1, chunk: { text: "Hello" } }],
        },
      },
    );

    expect(result.current.events).toMatchObject([
      { id: "chunk-1-text", type: "text_delta", text: "Hello" },
    ]);

    act(() => {
      rerender({ threadId: "thread-2", chunks: [] });
    });

    expect(result.current.events).toEqual([]);
  });

  it("surfaces diagnostics from malformed live chunks", () => {
    const { result } = renderHook(() =>
      useAguiThreadStream({
        threadId: "thread-1",
        chunks: [{ seq: 1, chunk: { type: "canvas_component" } }],
      }),
    );

    expect(result.current.diagnostics).toMatchObject([
      {
        id: "chunk-1-diagnostic",
        type: "diagnostic",
        message: "canvas_component missing component or props",
      },
    ]);
  });
});
