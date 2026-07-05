import { describe, expect, it } from "vitest";
import { isStale } from "./stale-guard";

describe("isStale", () => {
  it("allows unchanged status ids", () => {
    expect(isStale("todo", "todo")).toBe(false);
    expect(isStale(null, undefined)).toBe(false);
  });

  it("flags changed status ids", () => {
    expect(isStale("todo", "active")).toBe(true);
    expect(isStale("todo", null)).toBe(true);
  });
});
