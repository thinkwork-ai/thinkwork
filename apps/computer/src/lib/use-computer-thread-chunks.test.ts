import { describe, expect, it } from "vitest";
import { mergeComputerThreadChunk } from "./use-computer-thread-chunks";

describe("mergeComputerThreadChunk", () => {
  it("deduplicates and orders near-out-of-order chunks", () => {
    const chunks = [
      { seq: 1, text: "Hello" },
      { seq: 3, text: "!" },
    ];

    expect(mergeComputerThreadChunk(chunks, { seq: 2, text: " world" })).toEqual([
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
});
