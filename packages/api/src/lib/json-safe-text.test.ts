import { describe, expect, it } from "vitest";
import { jsonSafePreview } from "./json-safe-text.js";

describe("jsonSafePreview (THINK-246 jsonb incident)", () => {
  it("truncates without splitting a surrogate pair", () => {
    // "ab" + rocket emoji (2 code units); cutting at 3 lands mid-emoji.
    const text = "ab\u{1F680}cd";
    const out = jsonSafePreview(text, 3);
    expect(out).toBe("ab");
    // The exact failure mode: stringified output must parse as strict JSON.
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });

  it("keeps a pair that fits entirely", () => {
    expect(jsonSafePreview("ab\u{1F680}", 4)).toBe("ab\u{1F680}");
  });

  it("strips pre-existing lone surrogates from degenerate output", () => {
    const text = "x\uD83Dy\uDE00z"; // lone high + lone low
    expect(jsonSafePreview(text, 100)).toBe("xyz");
  });

  it("passes ordinary text through untouched", () => {
    expect(jsonSafePreview("hello world", 100)).toBe("hello world");
  });

  it("the raw slice reproduces the Postgres failure shape; the helper does not", () => {
    const text = "report \u{1F4C8}".repeat(200);
    const cut = text.slice(0, 8); // "report " is 7 units; 8 ends mid-emoji
    // JSON.stringify happily emits an unpaired \ud83d escape…
    expect(JSON.stringify(cut)).toContain("\\ud83d");
    // …which strict parsers (Postgres jsonb) reject. The helper never emits one.
    expect(JSON.stringify(jsonSafePreview(text, 8))).not.toContain("\\ud83d");
  });
});
