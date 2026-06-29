import { describe, it, expect } from "vitest";
import { truncate } from "../truncate.js";

describe("truncate", () => {
  it("returns the string unchanged if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and appends ellipsis", () => {
    expect(truncate("hello world", 6)).toBe("hello…");
  });

  it("handles exact length boundary", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });
});
