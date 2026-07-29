/**
 * Shared model pricing — the single fallback source for every cost path
 * (turn finalize in cost-recording.ts, span-enrichment cron, bedrock
 * invocation reconciler). THINK-245: the three previously duplicated maps
 * drifted (different models, no cache rates); this module replaces them.
 *
 * Cache rates are expressed as MULTIPLIERS over the input rate, not
 * absolutes, so tenant/catalog-specific input pricing from the DB tier
 * propagates to cache pricing (Anthropic bills 5-min cache-write at 1.25x
 * input and cache-read at 0.1x input; kimi has no prompt caching on
 * Bedrock, so its multipliers are zero).
 *
 * Rates verified 2026-07-09 against the AWS Bedrock pricing page and the
 * Anthropic prompt-caching docs (us-east-1/us-west-2 standard tier).
 * Re-verify via `resolveBedrockPricing` in aws-price-list.ts (Pricing API
 * service code AmazonBedrockFoundationModels) when adding entries.
 */

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
}

interface PricingEntry {
  input: number;
  output: number;
  cacheReadMultiplier: number;
  cacheWriteMultiplier: number;
}

const ANTHROPIC_CACHE = {
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 1.25,
};
const NO_CACHE = { cacheReadMultiplier: 0, cacheWriteMultiplier: 0 };

/**
 * Ordered substring-match entries — most specific first (e.g. "kimi-k2.5"
 * must precede "kimi-k2" or the k2.5 rate is shadowed). Matched against the
 * lowercased model id, so region/version prefixes like
 * "us.moonshotai.kimi-k2.5" still resolve.
 */
const PRICING_ENTRIES: ReadonlyArray<readonly [string, PricingEntry]> = [
  ["kimi-k2.5", { input: 0.6, output: 3.0, ...NO_CACHE }],
  ["kimi-k2", { input: 1.0, output: 3.0, ...NO_CACHE }],
  ["claude-sonnet-4-6", { input: 3.0, output: 15.0, ...ANTHROPIC_CACHE }],
  ["claude-sonnet-4-5", { input: 3.0, output: 15.0, ...ANTHROPIC_CACHE }],
  ["claude-sonnet-4", { input: 3.0, output: 15.0, ...ANTHROPIC_CACHE }],
  ["claude-haiku-4-5", { input: 0.8, output: 4.0, ...ANTHROPIC_CACHE }],
  ["claude-3-5-haiku", { input: 0.8, output: 4.0, ...ANTHROPIC_CACHE }],
  ["claude-3-haiku", { input: 0.25, output: 1.25, ...ANTHROPIC_CACHE }],
  // Memory retain/reflect models (Bedrock-hosted GPT-OSS). No cache
  // billing lines exist for these on Bedrock.
  ["gpt-oss-20b", { input: 0.05, output: 0.2, ...NO_CACHE }],
  ["gpt-oss-120b", { input: 0.15, output: 0.6, ...NO_CACHE }],
];

/** Unknown models fall back to Sonnet-class rates (the dominant spend). */
const DEFAULT_ENTRY: PricingEntry = {
  input: 3.0,
  output: 15.0,
  ...ANTHROPIC_CACHE,
};

function matchEntry(modelId: string | null): PricingEntry {
  if (!modelId) return DEFAULT_ENTRY;
  const lower = modelId.toLowerCase();
  for (const [key, entry] of PRICING_ENTRIES) {
    if (lower.includes(key)) return entry;
  }
  return DEFAULT_ENTRY;
}

function toPricing(entry: PricingEntry): ModelPricing {
  return {
    inputPerMillion: entry.input,
    outputPerMillion: entry.output,
    cacheReadPerMillion: entry.input * entry.cacheReadMultiplier,
    cacheWritePerMillion: entry.input * entry.cacheWriteMultiplier,
  };
}

/** Full fallback pricing for a model id (no DB tier involved). */
export function lookupFallbackModelPricing(
  modelId: string | null,
): ModelPricing {
  return toPricing(matchEntry(modelId));
}

/**
 * Overlay cache rates onto input/output pricing resolved by a higher tier
 * (tenant_model_catalog / model_catalog rows carry only input+output).
 * Cache rates are the model's multipliers applied to the RESOLVED input
 * rate, so tenant-specific input pricing propagates to cache pricing.
 */
export function withCacheRates(
  modelId: string | null,
  base: { inputPerMillion: number; outputPerMillion: number },
): ModelPricing {
  const entry = matchEntry(modelId);
  return {
    inputPerMillion: base.inputPerMillion,
    outputPerMillion: base.outputPerMillion,
    cacheReadPerMillion: base.inputPerMillion * entry.cacheReadMultiplier,
    cacheWritePerMillion: base.inputPerMillion * entry.cacheWriteMultiplier,
  };
}

/**
 * Cost in USD for a call, pricing all four token types.
 */
export function computeLlmCostUsd(
  pricing: ModelPricing,
  tokens: {
    inputTokens: number;
    outputTokens: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
  },
): number {
  return (
    (tokens.inputTokens * pricing.inputPerMillion +
      tokens.outputTokens * pricing.outputPerMillion +
      (tokens.cachedReadTokens ?? 0) * pricing.cacheReadPerMillion +
      (tokens.cachedWriteTokens ?? 0) * pricing.cacheWritePerMillion) /
    1_000_000
  );
}
