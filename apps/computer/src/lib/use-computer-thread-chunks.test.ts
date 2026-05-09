import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSubscription } from "urql";
import {
  mergeComputerThreadChunk,
  useComputerThreadChunks,
} from "./use-computer-thread-chunks";

vi.mock("urql", () => ({
  useSubscription: vi.fn(),
}));

let subscriptionHandler:
  | ((
      previous: unknown,
      event: {
        onComputerThreadChunk?: {
          threadId: string;
          chunk?: unknown;
          seq?: number | null;
        } | null;
      },
    ) => unknown)
  | null = null;

beforeEach(() => {
  subscriptionHandler = null;
  vi.mocked(useSubscription).mockImplementation((_options, handler) => {
    subscriptionHandler = handler as typeof subscriptionHandler;
    return [{ data: null, fetching: false, stale: false }, () => {}];
  });
});

describe("mergeComputerThreadChunk", () => {
  it("deduplicates and orders near-out-of-order chunks", () => {
    const chunks = [
      { seq: 1, text: "Hello" },
      { seq: 3, text: "!" },
    ];

    expect(
      mergeComputerThreadChunk(chunks, { seq: 2, text: " world" }),
    ).toEqual([
      { seq: 1, text: "Hello" },
      { seq: 2, text: " world" },
      { seq: 3, text: "!" },
    ]);
  });

  it("drops chunks that arrive too far behind the current stream", () => {
    const chunks = [
      { seq: 4, text: "current" },
      { seq: 5, text: " stream" },
    ];

    expect(mergeComputerThreadChunk(chunks, { seq: 1, text: "stale" })).toEqual(
      chunks,
    );
  });

  it("keeps live chunks across same-thread rerenders until an explicit reset or thread change", () => {
    const { result, rerender } = renderHook(
      ({ threadId }) => useComputerThreadChunks(threadId),
      {
        initialProps: { threadId: "thread-1" },
      },
    );

    act(() => {
      subscriptionHandler?.(null, {
        onComputerThreadChunk: {
          threadId: "thread-1",
          chunk: JSON.stringify({ text: "Hello" }),
          seq: 1,
        },
      });
    });

    expect(result.current.chunks).toEqual([
      { seq: 1, text: "Hello", publishedAt: null },
    ]);

    rerender({ threadId: "thread-1" });

    expect(result.current.chunks).toEqual([
      { seq: 1, text: "Hello", publishedAt: null },
    ]);

    act(() => result.current.reset());

    expect(result.current.chunks).toEqual([]);

    act(() => {
      subscriptionHandler?.(null, {
        onComputerThreadChunk: {
          threadId: "thread-1",
          chunk: JSON.stringify({ text: "Next" }),
          seq: 1,
        },
      });
    });

    expect(result.current.chunks).toEqual([
      { seq: 1, text: "Next", publishedAt: null },
    ]);

    rerender({ threadId: "thread-2" });

    expect(result.current.chunks).toEqual([]);
  });
});
