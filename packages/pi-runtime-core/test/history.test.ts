import { describe, expect, it } from "vitest";

import { normalizeHistory, textFromAssistant } from "../src/history.js";

describe("normalizeHistory", () => {
  it("converts chat wire history into pi-ai messages", () => {
    const history = normalizeHistory(
      [
        { role: "user", content: " hello " },
        { role: "assistant", content: "answer" },
        { role: "assistant", content: "" },
        { role: "system", content: "ignored" },
      ],
      "amazon.nova-pro-v1:0",
    );

    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: "user", content: " hello " });
    expect(history[1]).toMatchObject({
      role: "assistant",
      model: "amazon.nova-pro-v1:0",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
      },
    });
    expect(history[1]?.content).toEqual([{ type: "text", text: "answer" }]);
  });

  it("returns an empty list for invalid history", () => {
    expect(normalizeHistory(null, "model")).toEqual([]);
    expect(normalizeHistory({ role: "user" }, "model")).toEqual([]);
  });
});

describe("textFromAssistant", () => {
  it("reads normal pi-ai text content blocks", () => {
    expect(
      textFromAssistant({
        role: "assistant",
        content: [
          { type: "text", text: "hello " },
          { type: "text", text: "there" },
        ],
      } as never),
    ).toBe("hello there");
  });

  it("reads string content from durable or test session transcripts", () => {
    expect(
      textFromAssistant({
        role: "assistant",
        content: "TEI agent smoke succeeded.",
      } as never),
    ).toBe("TEI agent smoke succeeded.");
  });

  it("reads text fields from SDK content blocks without a text discriminator", () => {
    expect(
      textFromAssistant({
        role: "assistant",
        content: [{ text: "plain " }, { content: [{ text: "blocks" }] }],
      } as never),
    ).toBe("plain blocks");
  });
});
