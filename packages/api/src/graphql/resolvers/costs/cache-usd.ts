import { lookupFallbackModelPricing } from "../../../lib/model-catalog/pricing.js";

/**
 * THINK-245 R12 — dollar contribution of cache tokens, computed from
 * per-model token sums at aggregation time (cache rates differ per model, so
 * a single blended rate would be wrong whenever kimi and Claude mix).
 */
export function computeCacheUsdByModel(
  rows: Array<{
    model: string | null;
    cachedReadTokens: number | string | null;
    cachedWriteTokens: number | string | null;
  }>,
): number {
  let total = 0;
  for (const row of rows) {
    const pricing = lookupFallbackModelPricing(row.model);
    total +=
      (toNumber(row.cachedReadTokens) * pricing.cacheReadPerMillion +
        toNumber(row.cachedWriteTokens) * pricing.cacheWritePerMillion) /
      1_000_000;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
