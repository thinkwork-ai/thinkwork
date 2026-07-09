import { describe, it, expect } from "vitest";
import {
  capMessagePayloads,
  FIELD_BYTE_CAP,
  STRING_LEAF_CAP,
  TRUNCATION_MARKER,
} from "./payload-cap.js";

const big = (n: number) => "x".repeat(n);

describe("capMessagePayloads", () => {
  it("passes small payloads through untouched (same references)", () => {
    const node = {
      id: "m1",
      content: "hello",
      parts: [{ type: "text", text: "hi" }],
      toolCalls: [{ name: "query", args: { q: "select 1" } }],
      toolResults: { rows: [1, 2, 3] },
      metadata: { foo: "bar" },
    };
    const out = capMessagePayloads(node);
    expect(out).toBe(node);
    expect(out.parts).toBe(node.parts);
    expect(out.toolResults).toBe(node.toolResults);
  });

  it("truncates oversized string leaves inside toolResults", () => {
    const node = {
      id: "m1",
      toolResults: [{ output: big(2_000_000), status: "ok" }],
    };
    const out = capMessagePayloads(node) as {
      toolResults: { output: string; status: string }[];
    };
    expect(out.toolResults[0].status).toBe("ok");
    expect(out.toolResults[0].output.length).toBeLessThan(
      STRING_LEAF_CAP + TRUNCATION_MARKER.length + 32,
    );
    expect(out.toolResults[0].output).toContain(TRUNCATION_MARKER);
  });

  it("keeps parts renderable when truncating: structure preserved", () => {
    const node = {
      id: "m1",
      parts: [
        { type: "text", text: "intro" },
        { type: "tool-query", output: big(1_500_000) },
      ],
    };
    const out = capMessagePayloads(node) as {
      parts: { type: string; text?: string; output?: string }[];
    };
    expect(out.parts).toHaveLength(2);
    expect(out.parts[0]).toEqual({ type: "text", text: "intro" });
    expect(out.parts[1].type).toBe("tool-query");
    expect((out.parts[1].output as string).length).toBeLessThan(
      STRING_LEAF_CAP + TRUNCATION_MARKER.length + 32,
    );
  });

  it("stubs out a field that is still oversized after leaf truncation", () => {
    // Many small-but-under-cap leaves so leaf truncation alone cannot save it.
    const entries: Record<string, string> = {};
    for (let i = 0; i < 200; i++) entries[`k${i}`] = big(8_000);
    const node = { id: "m1", toolResults: entries };
    const out = capMessagePayloads(node) as {
      toolResults: { __truncated: boolean; originalBytes: number };
    };
    expect(out.toolResults.__truncated).toBe(true);
    expect(out.toolResults.originalBytes).toBeGreaterThan(FIELD_BYTE_CAP);
  });

  it("replaces still-oversized parts with a renderable text part", () => {
    const parts: { type: string; output: string }[] = [];
    for (let i = 0; i < 200; i++)
      parts.push({ type: "tool-x", output: big(8_000) });
    const node = { id: "m1", parts };
    const out = capMessagePayloads(node) as {
      parts: { type: string; text: string }[];
    };
    expect(Array.isArray(out.parts)).toBe(true);
    expect(out.parts).toHaveLength(1);
    expect(out.parts[0].type).toBe("text");
    expect(out.parts[0].text).toContain("truncated");
  });

  it("caps a giant content string", () => {
    const node = { id: "m1", content: big(1_000_000) };
    const out = capMessagePayloads(node) as { content: string };
    expect(out.content.length).toBeLessThanOrEqual(
      FIELD_BYTE_CAP + TRUNCATION_MARKER.length + 32,
    );
    expect(out.content).toContain(TRUNCATION_MARKER);
  });

  it("handles JSON-string jsonb fields (double-encoded) without corrupting them", () => {
    // Some rows carry jsonb already serialized as a string; capping must not
    // slice mid-JSON — it should parse, cap, and re-serialize.
    const payload = JSON.stringify([{ output: big(2_000_000) }]);
    const node = { id: "m1", toolResults: payload };
    const out = capMessagePayloads(node) as { toolResults: string };
    expect(typeof out.toolResults).toBe("string");
    const parsed = JSON.parse(out.toolResults) as { output: string }[];
    expect(parsed[0].output).toContain(TRUNCATION_MARKER);
  });

  it("enforces byte caps for multi-byte content (CJK stays under FIELD_BYTE_CAP)", () => {
    // '漢' is 3 bytes in UTF-8 but 1 UTF-16 code unit — a char-count slice
    // would pass 750KB through a 256KB byte cap untouched.
    const node = { id: "m1", content: "漢".repeat(250_000) };
    const out = capMessagePayloads(node) as { content: string };
    expect(Buffer.byteLength(out.content, "utf8")).toBeLessThanOrEqual(
      FIELD_BYTE_CAP + Buffer.byteLength(TRUNCATION_MARKER, "utf8"),
    );
    expect(out.content).toContain(TRUNCATION_MARKER);
    // Never cut mid-codepoint: every remaining char is intact.
    expect(out.content).not.toContain("�");
  });

  it("enforces byte caps for multi-byte string leaves inside toolResults", () => {
    const node = {
      id: "m1",
      toolResults: [{ output: "é".repeat(1_000_000) }],
    };
    const out = capMessagePayloads(node) as {
      toolResults: { output: string }[];
    };
    expect(
      Buffer.byteLength(out.toolResults[0].output, "utf8"),
    ).toBeLessThanOrEqual(
      STRING_LEAF_CAP + Buffer.byteLength(TRUNCATION_MARKER, "utf8"),
    );
  });

  it("preserves array shape when stubbing an oversized array field", () => {
    // Mobile ChatBubble calls message.toolResults.filter(...) — an object
    // stub would throw at render.
    const entries: { output: string }[] = [];
    for (let i = 0; i < 200; i++) entries.push({ output: big(8_000) });
    const node = { id: "m1", toolResults: entries };
    const out = capMessagePayloads(node) as {
      toolResults: { __truncated: boolean; originalBytes: number }[];
    };
    expect(Array.isArray(out.toolResults)).toBe(true);
    expect(out.toolResults).toHaveLength(1);
    expect(out.toolResults[0].__truncated).toBe(true);
  });

  it("keeps a '__proto__' key as data instead of dropping it", () => {
    const node = {
      id: "m1",
      toolResults: { ["__proto__"]: big(20_000), other: big(300_000) },
    };
    const out = capMessagePayloads(node) as { toolResults: unknown };
    const serialized = JSON.stringify(out.toolResults);
    expect(serialized).toContain("__proto__");
  });

  it("leaves null/undefined payload fields alone", () => {
    const node = {
      id: "m1",
      content: null,
      parts: null,
      toolCalls: undefined,
      toolResults: null,
      metadata: null,
    };
    expect(capMessagePayloads(node)).toBe(node);
  });
});
