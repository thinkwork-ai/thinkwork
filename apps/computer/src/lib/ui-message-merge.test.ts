/**
 * Tests for the per-part-id append cursor (plan-012 U6).
 *
 * Pin the load-bearing invariants:
 *   1. Heterogeneous part streams (text → tool → reasoning → text →
 *      tool-renderFragment) accumulate in the right order with
 *      independent state per part. A late tool-output-available chunk
 *      is NOT silently dropped (the regression the legacy
 *      seq < highest - 2 heuristic would cause).
 *   2. Legacy `{text}` envelopes accumulate into a separate fallback
 *      buffer so the legacy thread-surface path keeps working.
 *   3. Lifecycle markers (start, finish, abort, error) update status
 *      appropriately.
 *   4. Out-of-order text-delta chunks for the SAME part id append in
 *      arrival order (consumer does NOT attempt to reorder by content).
 */

import { describe, expect, it } from "vitest";
import {
  emptyState,
  mergeUIMessageChunk,
  mergeUIMessageChunks,
} from "./ui-message-merge";

describe("mergeUIMessageChunk — per-part-id append cursor", () => {
  it("text-start → text-delta × N → text-end produces a single done text part", () => {
    const out = mergeUIMessageChunks([
      { type: "start" },
      { type: "text-start", id: "p1" },
      { type: "text-delta", id: "p1", delta: "Hello" },
      { type: "text-delta", id: "p1", delta: " world" },
      { type: "text-end", id: "p1" },
      { type: "finish" },
    ]);

    expect(out.parts).toHaveLength(1);
    expect(out.parts[0]).toMatchObject({
      type: "text",
      id: "p1",
      text: "Hello world",
      state: "done",
    });
    expect(out.status).toBe("done");
  });

  it("interleaves text and tool parts without dropping either (covers AE3)", () => {
    const out = mergeUIMessageChunks([
      { type: "start" },
      { type: "text-start", id: "p1" },
      { type: "text-delta", id: "p1", delta: "Sure: " },
      {
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "renderFragment",
        input: { tsx: "<App />", version: "0.1.0" },
      },
      {
        type: "tool-output-available",
        toolCallId: "t1",
        output: { rendered: true, channelId: "abc" },
      },
      { type: "text-end", id: "p1" },
      { type: "finish" },
    ]);

    expect(out.parts).toHaveLength(2);
    expect(out.parts[0]).toMatchObject({
      type: "text",
      id: "p1",
      text: "Sure: ",
      state: "done",
    });
    expect(out.parts[1]).toMatchObject({
      type: "tool-renderFragment",
      toolCallId: "t1",
      toolName: "renderFragment",
      state: "output-available",
    });
    expect((out.parts[1] as any).input).toEqual({
      tsx: "<App />",
      version: "0.1.0",
    });
    expect((out.parts[1] as any).output).toEqual({
      rendered: true,
      channelId: "abc",
    });
  });

  it("regression: late tool-output-available is NOT dropped (legacy seq window would have)", () => {
    // Build a long stream where many text deltas arrive between the
    // tool's input-available and its output-available. The legacy
    // seq < highest - 2 heuristic would have dropped the tool output
    // because its seq is far behind the latest text seq.
    const stream: unknown[] = [
      { type: "start" },
      { type: "text-start", id: "p1" },
      {
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "search",
        input: { query: "x" },
      },
    ];
    for (let i = 0; i < 20; i++) {
      stream.push({ type: "text-delta", id: "p1", delta: `chunk-${i}` });
    }
    stream.push(
      {
        type: "tool-output-available",
        toolCallId: "t1",
        output: { hits: 3 },
      },
      { type: "text-end", id: "p1" },
      { type: "finish" },
    );

    const out = mergeUIMessageChunks(stream);
    const tool = out.parts.find((p) => p.type.startsWith("tool-"));
    expect(tool).toBeDefined();
    expect((tool as any).output).toEqual({ hits: 3 });
    expect((tool as any).state).toBe("output-available");
  });

  it("reasoning-{start,delta,end} accumulates independently of text", () => {
    const out = mergeUIMessageChunks([
      { type: "start" },
      { type: "reasoning-start", id: "r1" },
      { type: "text-start", id: "p1" },
      { type: "reasoning-delta", id: "r1", delta: "Hmm." },
      { type: "text-delta", id: "p1", delta: "Done." },
      { type: "reasoning-end", id: "r1" },
      { type: "text-end", id: "p1" },
      { type: "finish" },
    ]);

    const reasoning = out.parts.find((p) => p.type === "reasoning");
    const text = out.parts.find((p) => p.type === "text");
    expect((reasoning as any).text).toBe("Hmm.");
    expect((reasoning as any).state).toBe("done");
    expect((text as any).text).toBe("Done.");
    expect((text as any).state).toBe("done");
  });

  it("text-delta after text-end is dropped (terminal part is immutable)", () => {
    const out = mergeUIMessageChunks([
      { type: "text-start", id: "p1" },
      { type: "text-delta", id: "p1", delta: "Hello" },
      { type: "text-end", id: "p1" },
      { type: "text-delta", id: "p1", delta: " ignored" },
    ]);
    expect((out.parts[0] as any).text).toBe("Hello");
  });

  it("text-delta with unknown id is dropped silently", () => {
    const out = mergeUIMessageChunks([
      { type: "text-delta", id: "ghost", delta: "huh" },
    ]);
    expect(out.parts).toEqual([]);
  });

  it("deduplicates replayed subscription chunks by delivery seq", () => {
    let state = emptyState();
    state = mergeUIMessageChunk(state, { type: "text-start", id: "p1" }, 1);
    state = mergeUIMessageChunk(
      state,
      { type: "text-delta", id: "p1", delta: "Now " },
      2,
    );
    state = mergeUIMessageChunk(
      state,
      { type: "text-delta", id: "p1", delta: "Now " },
      2,
    );
    state = mergeUIMessageChunk(
      state,
      { type: "text-delta", id: "p1", delta: "research" },
      3,
    );

    expect((state.parts[0] as any).text).toBe("Now research");
  });
});

describe("mergeUIMessageChunk — lifecycle markers", () => {
  it("start transitions idle → streaming", () => {
    const out = mergeUIMessageChunk(emptyState(), { type: "start" });
    expect(out.status).toBe("streaming");
  });

  it("finish transitions to done", () => {
    const out = mergeUIMessageChunks([{ type: "start" }, { type: "finish" }]);
    expect(out.status).toBe("done");
  });

  it("abort transitions to aborted", () => {
    const out = mergeUIMessageChunks([{ type: "start" }, { type: "abort" }]);
    expect(out.status).toBe("aborted");
  });

  it("error transitions to errored and surfaces errorText", () => {
    const out = mergeUIMessageChunks([
      { type: "start" },
      { type: "error", errorText: "rate limited" },
    ]);
    expect(out.status).toBe("errored");
    expect(out.errorText).toBe("rate limited");
  });
});

describe("mergeUIMessageChunk — legacy {text} fallback", () => {
  it("legacy chunks accumulate into legacyText, not parts", () => {
    const out = mergeUIMessageChunks([{ text: "Hello " }, { text: "world" }]);
    expect(out.legacyText).toBe("Hello world");
    expect(out.parts).toEqual([]);
    expect(out.status).toBe("streaming");
  });

  it("legacy and protocol can coexist in a transition window", () => {
    const out = mergeUIMessageChunks([
      { text: "legacy text" },
      { type: "text-start", id: "p1" },
      { type: "text-delta", id: "p1", delta: "typed text" },
      { type: "text-end", id: "p1" },
      { type: "finish" },
    ]);
    expect(out.legacyText).toBe("legacy text");
    expect(out.parts).toHaveLength(1);
    expect((out.parts[0] as any).text).toBe("typed text");
  });
});

describe("mergeUIMessageChunk — data-${name} parts", () => {
  it("data parts accumulate", () => {
    const out = mergeUIMessageChunks([
      { type: "data-progress", id: "d1", data: { percent: 0.5 } },
      { type: "data-progress", id: "d2", data: { percent: 1.0 } },
    ]);
    const dataParts = out.parts.filter((p) => p.type.startsWith("data-"));
    expect(dataParts).toHaveLength(2);
  });

  it("data parts with the same type and id replace existing data", () => {
    const out = mergeUIMessageChunks([
      {
        type: "data-runbook-queue",
        id: "runbook-queue:run-1",
        data: { status: "queued" },
      },
      {
        type: "data-runbook-queue",
        id: "runbook-queue:run-1",
        data: { status: "running" },
      },
    ]);
    const dataParts = out.parts.filter((p) => p.type === "data-runbook-queue");
    expect(dataParts).toHaveLength(1);
    expect((dataParts[0] as any).data).toEqual({ status: "running" });
  });
});

describe("mergeUIMessageChunk — source / file parts", () => {
  it("source-url and source-document and file accumulate", () => {
    const out = mergeUIMessageChunks([
      { type: "source-url", sourceId: "s1", url: "https://x.example.com" },
      {
        type: "source-document",
        sourceId: "s2",
        mediaType: "text/markdown",
        title: "doc",
      },
      {
        type: "file",
        url: "https://x.example.com/y.png",
        mediaType: "image/png",
      },
    ]);
    expect(out.parts).toHaveLength(3);
  });
});
