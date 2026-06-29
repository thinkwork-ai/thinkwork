import { describe, it, expect } from "vitest";
import { toIsoString } from "../to-iso-string.js";

describe("toIsoString", () => {
  it("returns null for null/undefined", () => {
    expect(toIsoString(null)).toBeNull();
    expect(toIsoString(undefined)).toBeNull();
  });

  it("converts a Date to ISO string", () => {
    const date = new Date("2025-01-15T12:00:00Z");
    expect(toIsoString(date)).toBe("2025-01-15T12:00:00.000Z");
  });

  it("converts a date string to ISO string", () => {
    expect(toIsoString("2025-01-15T12:00:00Z")).toBe(
      "2025-01-15T12:00:00.000Z",
    );
  });

  it("returns null for invalid date string", () => {
    expect(toIsoString("not a date")).toBeNull();
  });

  it("handles epoch milliseconds", () => {
    const ms = new Date("2025-06-01T00:00:00Z").getTime();
    expect(toIsoString(ms)).toBe("2025-06-01T00:00:00.000Z");
  });
});
