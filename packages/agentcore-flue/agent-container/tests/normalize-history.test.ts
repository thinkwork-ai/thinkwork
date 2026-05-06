/**
 * `normalizeHistory` regression tests.
 *
 * On 2026-05-05 a follow-up turn against Marco produced an empty
 * assistant response (5.2s, $0.0006, zero output tokens) because the
 * original `normalizeHistory` synthesized a structurally-invalid
 * `AssistantMessage`: string `content` where pi-ai requires
 * `(TextContent | ThinkingContent | ToolCall)[]`, plus all required
 * metadata fields (api, provider, model, usage, stopReason) missing.
 * pi-ai's Agent silently swallowed the malformed history and returned
 * an empty turn. The fresh-thread smoke (`messages_history: []`) didn't
 * catch it because the bug only manifests on multi-turn conversations.
 *
 * These tests pin the post-fix shape so a future refactor can't
 * silently regress assistant-history serialization again.
 */

import { describe, expect, it } from "vitest";
import { normalizeHistory } from "../src/server.js";

const MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

describe("normalizeHistory", () => {
  it("returns empty array when history is not an array", () => {
    expect(normalizeHistory(undefined, MODEL)).toEqual([]);
    expect(normalizeHistory(null, MODEL)).toEqual([]);
    expect(normalizeHistory("not an array", MODEL)).toEqual([]);
  });

  it("returns empty array for empty history (fresh-thread case)", () => {
    expect(normalizeHistory([], MODEL)).toEqual([]);
  });

  it("preserves user messages with string content (UserMessage shape)", () => {
    const out = normalizeHistory(
      [{ role: "user", content: "What did I just ask?" }],
      MODEL,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      role: "user",
      content: "What did I just ask?",
    });
    expect(typeof (out[0] as { timestamp: number }).timestamp).toBe("number");
  });

  it("converts assistant string content to TextContent[] (the fix)", () => {
    const out = normalizeHistory(
      [{ role: "assistant", content: "Here are the 5 most recent." }],
      MODEL,
    );
    expect(out).toHaveLength(1);
    const msg = out[0] as unknown as Record<string, unknown>;
    // The pre-fix bug: `content: "Here are the 5..."` (string) — broke pi-ai.
    expect(Array.isArray(msg.content)).toBe(true);
    expect(msg.content).toEqual([
      { type: "text", text: "Here are the 5 most recent." },
    ]);
  });

  it("populates the required AssistantMessage metadata fields pi-ai needs", () => {
    const out = normalizeHistory(
      [{ role: "assistant", content: "Hello." }],
      MODEL,
    );
    const msg = out[0] as unknown as Record<string, unknown>;
    // These five fields were all undefined pre-fix; pi-ai's history
    // serializer / Agent constructor either threw or produced an empty
    // turn. Pin them so the regression can't recur.
    expect(msg.api).toBe("bedrock-converse-stream");
    expect(msg.provider).toBe("amazon-bedrock");
    expect(msg.model).toBe(MODEL);
    expect(msg.stopReason).toBe("stop");
    expect(msg.usage).toMatchObject({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    });
  });

  it("uses the current invocation's model id on synthesized assistant entries", () => {
    const otherModel = "us.anthropic.claude-sonnet-4-6";
    const out = normalizeHistory(
      [{ role: "assistant", content: "..." }],
      otherModel,
    );
    expect((out[0] as { model: string }).model).toBe(otherModel);
  });

  it("preserves order across mixed user + assistant turns", () => {
    const out = normalizeHistory(
      [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" },
        { role: "assistant", content: "A2" },
      ],
      MODEL,
    );
    expect(out).toHaveLength(4);
    expect((out[0] as { role: string }).role).toBe("user");
    expect((out[0] as { content: string }).content).toBe("Q1");
    expect((out[1] as { role: string }).role).toBe("assistant");
    expect((out[1] as { content: { text: string }[] }).content[0]!.text).toBe("A1");
    expect((out[2] as { content: string }).content).toBe("Q2");
    expect((out[3] as { content: { text: string }[] }).content[0]!.text).toBe("A2");
  });

  it("drops entries with empty/whitespace-only content", () => {
    const out = normalizeHistory(
      [
        { role: "user", content: "" },
        { role: "user", content: "   " },
        { role: "assistant", content: "" },
        { role: "user", content: "real" },
      ],
      MODEL,
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { content: string }).content).toBe("real");
  });

  it("drops entries with non-user/non-assistant role", () => {
    const out = normalizeHistory(
      [
        { role: "system", content: "should not appear" },
        { role: "tool", content: "also dropped" },
        { role: "user", content: "kept" },
      ],
      MODEL,
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { content: string }).content).toBe("kept");
  });

  it("drops entries with non-string content", () => {
    const out = normalizeHistory(
      [
        { role: "user", content: 42 },
        { role: "assistant", content: { text: "obj" } },
        { role: "user", content: "kept" },
      ],
      MODEL,
    );
    expect(out).toHaveLength(1);
    expect((out[0] as { content: string }).content).toBe("kept");
  });
});
