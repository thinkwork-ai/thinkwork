import { describe, expect, it } from "vitest";
import { formatDateTime, formatDate } from "../formatters/date.js";

describe("formatDateTime", () => {
  it("formats a date string with month, day, and time", () => {
    const result = formatDateTime("2026-06-15T14:30:00.000Z");
    expect(result).toContain("Jun");
    expect(result).toContain("15");
  });

  it("formats a Date object", () => {
    const result = formatDateTime(new Date("2026-01-01T09:00:00.000Z"));
    expect(result).toContain("Jan");
  });
});

describe("formatDate", () => {
  it("formats a date string with month, day, and year", () => {
    const result = formatDate("2026-06-15T00:00:00.000Z");
    expect(result).toContain("Jun");
    expect(result).toContain("15");
    expect(result).toContain("2026");
  });

  it("formats a Date object", () => {
    const result = formatDate(new Date("2026-12-25T00:00:00.000Z"));
    expect(result).toContain("Dec");
    expect(result).toContain("25");
    expect(result).toContain("2026");
  });
});
