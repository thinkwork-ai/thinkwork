import { describe, expect, it } from "vitest";
import {
  hasHtmlMetacharacters,
  safeLabel,
  safeDisplayValue,
  formatFreshness,
  formatProvenance,
} from "./formatters.js";

describe("hasHtmlMetacharacters", () => {
  it.each(["<", ">", '"', "'", "&"])("detects meta character '%s'", (char) => {
    expect(hasHtmlMetacharacters(`text${char}text`)).toBe(true);
  });

  it("returns false for safe strings", () => {
    expect(hasHtmlMetacharacters("hello world 123")).toBe(false);
  });
});

describe("safeLabel", () => {
  it("trims whitespace and returns the label", () => {
    expect(safeLabel("  hello  ")).toBe("hello");
  });

  it("returns empty string for non-string values", () => {
    expect(safeLabel(42)).toBe("");
    expect(safeLabel(null)).toBe("");
    expect(safeLabel(undefined)).toBe("");
  });

  it("truncates to the max length", () => {
    const result = safeLabel("abcdefghij", 5);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result).toContain("…");
  });
});

describe("safeDisplayValue", () => {
  it("returns empty string for null/undefined", () => {
    expect(safeDisplayValue(null)).toBe("");
    expect(safeDisplayValue(undefined)).toBe("");
  });

  it("formats numbers with locale formatting", () => {
    const result = safeDisplayValue(1234);
    expect(result).toMatch(/1.?234/);
  });

  it("returns empty string for non-finite numbers", () => {
    expect(safeDisplayValue(Infinity)).toBe("");
    expect(safeDisplayValue(NaN)).toBe("");
  });

  it("escapes HTML metacharacters", () => {
    expect(safeDisplayValue('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("stringifies booleans", () => {
    expect(safeDisplayValue(true)).toBe("true");
    expect(safeDisplayValue(false)).toBe("false");
  });

  it("truncates long values", () => {
    const result = safeDisplayValue("x".repeat(200), 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });
});

describe("formatFreshness", () => {
  it("returns 'Freshness unknown' for empty takenAt", () => {
    expect(formatFreshness("")).toBe("Freshness unknown");
  });

  it("formats with takenAt when no oldestAt", () => {
    expect(formatFreshness("2026-06-01")).toBe("Data as of 2026-06-01");
  });

  it("uses the earlier date between takenAt and oldestAt", () => {
    expect(formatFreshness("2026-06-10", "2026-06-01")).toBe(
      "Data as of 2026-06-01",
    );
  });

  it("uses takenAt when oldestAt is later", () => {
    expect(formatFreshness("2026-06-01", "2026-06-10")).toBe(
      "Data as of 2026-06-01",
    );
  });
});

describe("formatProvenance", () => {
  it("returns 'Source unknown' for empty source labels", () => {
    expect(formatProvenance([])).toBe("Source unknown");
  });

  it("formats a single source label", () => {
    expect(formatProvenance(["Zendesk"])).toBe("Source: Zendesk");
  });

  it("joins multiple source labels with commas", () => {
    expect(formatProvenance(["Zendesk", "Warehouse"])).toBe(
      "Source: Zendesk, Warehouse",
    );
  });
});
