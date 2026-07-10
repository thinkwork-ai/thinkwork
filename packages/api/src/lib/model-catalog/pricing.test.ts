import { describe, expect, it } from "vitest";

import {
  computeLlmCostUsd,
  lookupFallbackModelPricing,
  withCacheRates,
} from "./pricing";

describe("lookupFallbackModelPricing", () => {
  it("resolves kimi-k2.5 ahead of the kimi-k2 substring", () => {
    const pricing = lookupFallbackModelPricing("us.moonshotai.kimi-k2.5");
    expect(pricing.inputPerMillion).toBe(0.6);
    expect(pricing.outputPerMillion).toBe(3.0);
  });

  it("kimi has zero cache rates (no prompt caching on Bedrock)", () => {
    const pricing = lookupFallbackModelPricing("moonshotai.kimi-k2.5");
    expect(pricing.cacheReadPerMillion).toBe(0);
    expect(pricing.cacheWritePerMillion).toBe(0);
  });

  it("legacy kimi-k2 keeps its own rate", () => {
    const pricing = lookupFallbackModelPricing("moonshotai.kimi-k2-instruct");
    expect(pricing.inputPerMillion).toBe(1.0);
  });

  it("Anthropic models carry documented cache multipliers", () => {
    const pricing = lookupFallbackModelPricing(
      "anthropic.claude-sonnet-4-6-v1:0",
    );
    expect(pricing.inputPerMillion).toBe(3.0);
    expect(pricing.cacheWritePerMillion).toBeCloseTo(3.75); // 1.25x input
    expect(pricing.cacheReadPerMillion).toBeCloseTo(0.3); // 0.1x input
  });

  it("unknown models fall back to Sonnet-class default with cache rates", () => {
    const pricing = lookupFallbackModelPricing("mystery-model-9000");
    expect(pricing.inputPerMillion).toBe(3.0);
    expect(pricing.cacheWritePerMillion).toBeCloseTo(3.75);
  });

  it("null model id resolves to the default", () => {
    expect(lookupFallbackModelPricing(null).inputPerMillion).toBe(3.0);
  });
});

describe("withCacheRates", () => {
  it("applies multipliers to the resolved DB input rate, not the fallback", () => {
    // Tenant catalog priced Sonnet at $2.50/M input — cache rates must follow.
    const pricing = withCacheRates("anthropic.claude-sonnet-4-6-v1:0", {
      inputPerMillion: 2.5,
      outputPerMillion: 12.0,
    });
    expect(pricing.inputPerMillion).toBe(2.5);
    expect(pricing.outputPerMillion).toBe(12.0);
    expect(pricing.cacheWritePerMillion).toBeCloseTo(3.125); // 1.25 x 2.5
    expect(pricing.cacheReadPerMillion).toBeCloseTo(0.25); // 0.1 x 2.5
  });

  it("keeps zero cache rates for kimi even with DB pricing", () => {
    const pricing = withCacheRates("moonshotai.kimi-k2.5", {
      inputPerMillion: 0.55,
      outputPerMillion: 2.8,
    });
    expect(pricing.cacheReadPerMillion).toBe(0);
    expect(pricing.cacheWritePerMillion).toBe(0);
  });
});

describe("computeLlmCostUsd", () => {
  it("prices all four token types (AE1 fixture)", () => {
    const pricing = lookupFallbackModelPricing("claude-sonnet-4-6");
    const cost = computeLlmCostUsd(pricing, {
      inputTokens: 10_000,
      outputTokens: 2_000,
      cachedWriteTokens: 50_000,
      cachedReadTokens: 200_000,
    });
    // 10k*3 + 2k*15 + 50k*3.75 + 200k*0.30 per million
    const expected =
      (10_000 * 3 + 2_000 * 15 + 50_000 * 3.75 + 200_000 * 0.3) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 6);
    expect(cost).toBeCloseTo(0.3075, 6);
  });

  it("prices cache at $0 for kimi even when cache counts appear", () => {
    const pricing = lookupFallbackModelPricing("moonshotai.kimi-k2.5");
    const cost = computeLlmCostUsd(pricing, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedReadTokens: 500_000,
      cachedWriteTokens: 500_000,
    });
    expect(cost).toBeCloseTo(0.6, 6);
  });

  it("treats missing cache counts as zero", () => {
    const pricing = lookupFallbackModelPricing("claude-sonnet-4-6");
    expect(
      computeLlmCostUsd(pricing, { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBeCloseTo(3.0, 6);
  });
});
