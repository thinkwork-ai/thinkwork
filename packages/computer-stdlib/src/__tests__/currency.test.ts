import { describe, expect, it } from "vitest";
import { formatCurrency, formatNumber } from "../formatters/currency.js";

describe("formatCurrency", () => {
  it("formats small USD amounts without decimals", () => {
    const result = formatCurrency(1234);
    expect(result).toContain("1,234");
    expect(result).toContain("$");
  });

  it("formats large amounts in compact notation", () => {
    const result = formatCurrency(2_500_000);
    expect(result).toMatch(/\$2\.5M/);
  });

  it("formats negative values", () => {
    const result = formatCurrency(-500);
    expect(result).toContain("500");
  });

  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("$");
    expect(result).toContain("0");
  });

  it("respects a custom currency", () => {
    const result = formatCurrency(100, "EUR");
    expect(result).toMatch(/€|EUR/);
  });
});

describe("formatNumber", () => {
  it("formats small numbers in standard notation", () => {
    expect(formatNumber(1234)).toBe("1,234");
  });

  it("formats large numbers in compact notation", () => {
    const result = formatNumber(1_500_000);
    expect(result).toMatch(/1\.5M/);
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats negative numbers", () => {
    const result = formatNumber(-999);
    expect(result).toMatch(/-999/);
  });
});
