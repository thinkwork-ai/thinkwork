import { describe, expect, it, vi } from "vitest";

vi.mock("@thinkwork/database-pg", () => ({ getDb: () => ({}) }));

const { computeDrift, isTokenUsageType, modelKeyFor } =
  await import("./cost-drift-check.js");

describe("modelKeyFor", () => {
  it("maps CE usage types to canonical model keys across region variants", () => {
    expect(modelKeyFor("USE1-Claude4.6Sonnet-input-tokens")).toBe(
      "claude-sonnet-4-6",
    );
    expect(
      modelKeyFor("USW2-Claude4.6Sonnet-cache-write-input-token-count"),
    ).toBe("claude-sonnet-4-6");
    expect(modelKeyFor("USE1-KimiK2.5-mantle-input-tokens-standard")).toBe(
      "kimi-k2.5",
    );
    expect(modelKeyFor("USE1-output-tokens-cross-region-global")).toBeNull();
  });

  it("maps marketplace service names (Anthropic spend is NOT under 'Amazon Bedrock')", () => {
    expect(modelKeyFor("Claude 4.6 Sonnet (Amazon Bedrock Edition)")).toBe(
      "claude-sonnet-4-6",
    );
  });

  it("maps cost_events model values to the same keys", () => {
    expect(modelKeyFor("us.moonshotai.kimi-k2.5")).toBe("kimi-k2.5");
    expect(modelKeyFor("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });
});

describe("isTokenUsageType", () => {
  it("accepts all four token line types", () => {
    for (const usageType of [
      "USE1-Claude4.6Sonnet-input-tokens",
      "USE1-Claude4.6Sonnet-output-tokens",
      "USE1-Claude4.6Sonnet-cache-read-input-token-count",
      "USE1-Claude4.6Sonnet-cache-write-input-token-count",
    ]) {
      expect(isTokenUsageType(usageType)).toBe(true);
    }
  });

  it("rejects non-token lines", () => {
    expect(isTokenUsageType("USE1-DataTransfer-Out-Bytes")).toBe(false);
  });
});

describe("computeDrift", () => {
  it("flags >1% divergence with the gap named (AE5)", () => {
    const rows = computeDrift(
      new Map([["kimi-k2.5", 0.97]]),
      new Map([["kimi-k2.5", 0.12]]),
    );
    expect(rows[0]).toMatchObject({ model: "kimi-k2.5", billedUsd: 0.97 });
    expect(rows[0].driftPercent).toBeGreaterThan(1);
  });

  it("stays under threshold for CE rounding noise", () => {
    const rows = computeDrift(
      new Map([["claude-sonnet-4-6", 10.0]]),
      new Map([["claude-sonnet-4-6", 9.95]]),
    );
    expect(rows[0].driftPercent).toBeLessThanOrEqual(1);
  });

  it("skips sub-nickel models entirely (percent drift on pennies is noise)", () => {
    const rows = computeDrift(
      new Map([["gpt-oss-20b", 0.002]]),
      new Map([["gpt-oss-20b", 0.0]]),
    );
    expect(rows).toHaveLength(0);
  });

  it("catches recorded-but-unbilled models too", () => {
    const rows = computeDrift(new Map(), new Map([["claude-sonnet-4-6", 5]]));
    expect(rows[0].driftPercent).toBeGreaterThan(1);
  });
});
