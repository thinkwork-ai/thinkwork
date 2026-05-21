/**
 * Test fixtures align with the wire vocabulary in
 * docs/specs/computer-ai-elements-contract-v1.md. The parser is the
 * primary defender of the legacy-vs-protocol invariant — we own these
 * tests carefully.
 */

import { describe, expect, it } from "vitest";
import {
  __PROTOCOL_TYPE_SETS,
  parseChunkPayload,
} from "./ui-message-chunk-parser";

describe("parseChunkPayload", () => {
  describe("happy path — protocol chunks", () => {
    it("parses a text-start chunk with stable id", () => {
      const result = parseChunkPayload(
        JSON.stringify({ type: "text-start", id: "p1" }),
      );
      expect(result).toEqual({
        kind: "protocol",
        chunk: { type: "text-start", id: "p1" },
      });
    });

    it("parses a text-delta chunk with delta content", () => {
      const result = parseChunkPayload(
        JSON.stringify({ type: "text-delta", id: "p1", delta: "Hello" }),
      );
      expect(result.kind).toBe("protocol");
      if (result.kind === "protocol") {
        expect(result.chunk).toMatchObject({
          type: "text-delta",
          id: "p1",
          delta: "Hello",
        });
      }
    });

    it("parses a text-end chunk", () => {
      const result = parseChunkPayload({ type: "text-end", id: "p1" });
      expect(result.kind).toBe("protocol");
    });

    it("parses reasoning-{start,delta,end} chunks with stable id", () => {
      expect(
        parseChunkPayload({ type: "reasoning-start", id: "r1" }).kind,
      ).toBe("protocol");
      expect(
        parseChunkPayload({
          type: "reasoning-delta",
          id: "r1",
          delta: "Thinking...",
        }).kind,
      ).toBe("protocol");
      expect(parseChunkPayload({ type: "reasoning-end", id: "r1" }).kind).toBe(
        "protocol",
      );
    });

    it("parses tool-input-available carrying input shape", () => {
      const input = { tsx: "<App />", version: "0.1.0" };
      const result = parseChunkPayload({
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "renderFragment",
        input,
      });
      expect(result.kind).toBe("protocol");
      if (result.kind === "protocol") {
        expect(result.chunk).toMatchObject({
          type: "tool-input-available",
          toolCallId: "t1",
          toolName: "renderFragment",
        });
      }
    });

    it("parses tool-output-available carrying output shape", () => {
      const result = parseChunkPayload({
        type: "tool-output-available",
        toolCallId: "t1",
        output: { rendered: true },
      });
      expect(result.kind).toBe("protocol");
    });

    it("parses tool-output-error chunk", () => {
      const result = parseChunkPayload({
        type: "tool-output-error",
        toolCallId: "t1",
        errorText: "boom",
      });
      expect(result.kind).toBe("protocol");
    });

    it("parses an error chunk with errorText", () => {
      const result = parseChunkPayload({
        type: "error",
        errorText: "rate limited",
      });
      expect(result.kind).toBe("protocol");
    });

    it("parses transport-level signals with no id", () => {
      for (const type of [
        "start",
        "start-step",
        "finish-step",
        "finish",
        "abort",
      ]) {
        const result = parseChunkPayload({ type });
        expect(result.kind).toBe("protocol");
      }
    });

    it("parses data-${name} parts", () => {
      const result = parseChunkPayload({
        type: "data-progress",
        id: "d1",
        data: { percent: 42 },
      });
      expect(result.kind).toBe("protocol");
    });

    it("parses runbook confirmation and queue data parts", () => {
      expect(
        parseChunkPayload({
          type: "data-runbook-confirmation",
          id: "runbook-confirmation:run-1",
          data: { runbookRunId: "run-1" },
        }).kind,
      ).toBe("protocol");
      expect(
        parseChunkPayload({
          type: "data-runbook-queue",
          id: "runbook-queue:run-1",
          data: { runbookRunId: "run-1", phases: [] },
        }).kind,
      ).toBe("protocol");
    });

    it("parses source-url and source-document chunks", () => {
      expect(
        parseChunkPayload({
          type: "source-url",
          sourceId: "s1",
          url: "https://example.com",
        }).kind,
      ).toBe("protocol");
      expect(
        parseChunkPayload({
          type: "source-document",
          sourceId: "s2",
          mediaType: "text/markdown",
          title: "doc",
        }).kind,
      ).toBe("protocol");
    });

    it("parses file chunk", () => {
      const result = parseChunkPayload({
        type: "file",
        url: "https://example.com/x.png",
        mediaType: "image/png",
      });
      expect(result.kind).toBe("protocol");
    });
  });

  describe("legacy detection — shape-based, not id-based", () => {
    it("treats { text: string } with no type as legacy", () => {
      const result = parseChunkPayload(JSON.stringify({ text: "hello" }));
      expect(result).toEqual({
        kind: "legacy",
        chunk: { text: "hello" },
      });
    });

    it("treats { type: <non-string>, text: string } as legacy", () => {
      const result = parseChunkPayload({ type: 123, text: "hi" });
      expect(result.kind).toBe("legacy");
    });

    it("does NOT demote protocol chunks without id to legacy (regression: U1 contract bug fix)", () => {
      // `start`, `finish`, `start-step`, `finish-step`, `abort`, `error`,
      // `tool-*`, `source-*`, `file`, `data-*` legitimately have no id.
      // Demoting them to legacy would lose protocol signal — this is the
      // load-bearing invariant the parser defends.
      const protocolWithoutId = [
        { type: "start" },
        { type: "finish" },
        { type: "start-step" },
        { type: "finish-step" },
        { type: "abort" },
        { type: "error", errorText: "x" },
        {
          type: "tool-input-available",
          toolCallId: "t1",
          toolName: "renderFragment",
          input: {},
        },
        {
          type: "tool-output-available",
          toolCallId: "t1",
          output: {},
        },
        { type: "data-progress", data: {} },
      ];
      for (const c of protocolWithoutId) {
        const result = parseChunkPayload(c);
        expect(result.kind).toBe("protocol");
      }
    });

    it("does NOT treat a known-type protocol chunk with text-string field as legacy", () => {
      // Edge case: a tool input that happens to embed a `text` field
      // inside `input`. The chunk has a known protocol `type`, so it is
      // protocol traffic regardless of inner shape.
      const result = parseChunkPayload({
        type: "tool-input-available",
        toolCallId: "t1",
        toolName: "echo",
        input: { text: "do not demote me" },
      });
      expect(result.kind).toBe("protocol");
    });
  });

  describe("error and edge cases — drop, never throw", () => {
    it("drops null and undefined as EMPTY", () => {
      expect(parseChunkPayload(null).kind).toBe("drop");
      expect(parseChunkPayload(undefined).kind).toBe("drop");
    });

    it("drops empty / whitespace-only strings as EMPTY", () => {
      expect(parseChunkPayload("").kind).toBe("drop");
      expect(parseChunkPayload("   ").kind).toBe("drop");
    });

    it("drops malformed JSON without throwing", () => {
      const result = parseChunkPayload("{not json");
      expect(result.kind).toBe("drop");
      if (result.kind === "drop") {
        expect(result.reason).toBe("INVALID_JSON");
      }
    });

    it("drops arrays as NOT_OBJECT", () => {
      const result = parseChunkPayload("[1,2,3]");
      expect(result.kind).toBe("drop");
      if (result.kind === "drop") {
        expect(result.reason).toBe("NOT_OBJECT");
      }
    });

    it("drops unknown protocol type", () => {
      const result = parseChunkPayload({ type: "future-shaped-thing" });
      expect(result.kind).toBe("drop");
      if (result.kind === "drop") {
        expect(result.reason).toBe("UNKNOWN_TYPE");
      }
    });

    it("drops text-delta with no id as MALFORMED_PROTOCOL_FIELDS", () => {
      const result = parseChunkPayload({
        type: "text-delta",
        delta: "x",
      });
      expect(result.kind).toBe("drop");
      if (result.kind === "drop") {
        expect(result.reason).toBe("MALFORMED_PROTOCOL_FIELDS");
      }
    });

    it("drops text-delta with non-string delta", () => {
      const result = parseChunkPayload({
        type: "text-delta",
        id: "p1",
        delta: 42,
      });
      expect(result.kind).toBe("drop");
      if (result.kind === "drop") {
        expect(result.reason).toBe("MALFORMED_PROTOCOL_FIELDS");
      }
    });

    it("drops tool-input-available missing toolName", () => {
      const result = parseChunkPayload({
        type: "tool-input-available",
        toolCallId: "t1",
        input: {},
      });
      expect(result.kind).toBe("drop");
    });

    it("drops error chunk missing errorText", () => {
      const result = parseChunkPayload({ type: "error" });
      expect(result.kind).toBe("drop");
    });
  });

  describe("contract coverage", () => {
    it("ID_REQUIRED set covers the per-part-id text/reasoning chunks", () => {
      expect(__PROTOCOL_TYPE_SETS.ID_REQUIRED).toEqual(
        new Set([
          "text-start",
          "text-delta",
          "text-end",
          "reasoning-start",
          "reasoning-delta",
          "reasoning-end",
        ]),
      );
    });

    it("ID_OPTIONAL set covers transport signals + tool/source/file/message-metadata", () => {
      expect(__PROTOCOL_TYPE_SETS.ID_OPTIONAL.has("start")).toBe(true);
      expect(__PROTOCOL_TYPE_SETS.ID_OPTIONAL.has("finish")).toBe(true);
      expect(__PROTOCOL_TYPE_SETS.ID_OPTIONAL.has("abort")).toBe(true);
      expect(__PROTOCOL_TYPE_SETS.ID_OPTIONAL.has("error")).toBe(true);
      expect(__PROTOCOL_TYPE_SETS.ID_OPTIONAL.has("tool-input-available")).toBe(
        true,
      );
      expect(
        __PROTOCOL_TYPE_SETS.ID_OPTIONAL.has("tool-output-available"),
      ).toBe(true);
    });

    it("data-${name} parts pass via prefix match, not the KNOWN set", () => {
      expect(__PROTOCOL_TYPE_SETS.DATA_PART_PREFIX).toBe("data-");
      expect(parseChunkPayload({ type: "data-anything", data: {} }).kind).toBe(
        "protocol",
      );
    });
  });
});
