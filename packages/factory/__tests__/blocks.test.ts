/**
 * U1 — blocks.ts, the single Block Kit rendering seam (KTD7). These tests pin
 * the Slack hard limits: a breach makes chat.postMessage reject the WHOLE
 * message, so an unenforced limit is a silently-unposted message.
 */

import { describe, expect, it } from "vitest";
import {
  actions,
  button,
  composeMessage,
  context,
  divider,
  fields,
  image,
  section,
  BUTTON_LABEL_MAX,
  BUTTON_VALUE_MAX,
  MAX_ACTIONS_ELEMENTS,
  MAX_BLOCKS_PER_MESSAGE,
  SECTION_TEXT_MAX,
} from "../src/slack/blocks.js";

function sectionText(block: Record<string, unknown>): string {
  return (block.text as { text: string }).text;
}

describe("section", () => {
  it("passes short text through untouched", () => {
    const b = section("hello *world*");
    expect(b.type).toBe("section");
    expect(sectionText(b)).toBe("hello *world*");
  });

  it("truncates past the 3000-char section limit with a visible note", () => {
    const b = section("x".repeat(SECTION_TEXT_MAX + 500));
    const text = sectionText(b);
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).toContain("_(truncated)_");
  });
});

describe("button / actions", () => {
  it("truncates a 76-char label to the 75-char cap", () => {
    const b = button({ actionId: "a", label: "y".repeat(76) });
    const label = (b.text as { text: string }).text;
    expect(label.length).toBe(BUTTON_LABEL_MAX);
    expect(label.endsWith("…")).toBe(true);
  });

  it("throws on a value past the 2000-char cap (a cut value is corrupt JSON)", () => {
    expect(() =>
      button({ actionId: "a", label: "x", value: "v".repeat(BUTTON_VALUE_MAX + 1) }),
    ).toThrow(/value exceeds/);
  });

  it("carries style and value through", () => {
    const b = button({ actionId: "a", label: "Go", value: "{}", style: "primary" });
    expect(b.style).toBe("primary");
    expect(b.value).toBe("{}");
    expect(b.action_id).toBe("a");
  });

  it("drops actions elements past the 25-per-block cap", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      actionId: `a${i}`,
      label: `b${i}`,
    }));
    const block = actions(many);
    expect((block.elements as unknown[]).length).toBe(MAX_ACTIONS_ELEMENTS);
  });
});

describe("image", () => {
  it("requires non-empty alt_text", () => {
    expect(() => image("https://x/y.png", "  ")).toThrow(/alt_text/);
  });

  it("builds an image block with alt_text", () => {
    const b = image("https://x/y.png", "verify screenshot 1");
    expect(b).toEqual({
      type: "image",
      image_url: "https://x/y.png",
      alt_text: "verify screenshot 1",
    });
  });
});

describe("fields / context / divider", () => {
  it("caps fields at 10 with a more-note", () => {
    const b = fields(Array.from({ length: 12 }, (_, i) => `f${i}`));
    const f = b.fields as { text: string }[];
    expect(f.length).toBe(10);
    expect(f[9].text).toContain("+3 more");
  });

  it("context and divider have the right shapes", () => {
    expect(context("hi").type).toBe("context");
    expect(divider()).toEqual({ type: "divider" });
  });
});

describe("composeMessage", () => {
  it("passes an in-limit message through", () => {
    const msg = composeMessage([section("a"), divider()], "fallback");
    expect(msg.blocks.length).toBe(2);
    expect(msg.text).toBe("fallback");
  });

  it("trims past the 50-block ceiling with a visible note", () => {
    const blocks = Array.from({ length: 60 }, (_, i) => section(`b${i}`));
    const msg = composeMessage(blocks, "board");
    expect(msg.blocks.length).toBe(MAX_BLOCKS_PER_MESSAGE);
    const last = msg.blocks[msg.blocks.length - 1];
    expect(last.type).toBe("context");
    expect(JSON.stringify(last)).toContain("more blocks trimmed");
  });

  it("always yields a non-empty fallback text", () => {
    expect(composeMessage([section("a")], "   ").text).not.toBe("");
  });
});
