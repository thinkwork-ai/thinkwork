/**
 * THINK-199 (Brain Quality P4): the Memory screen's default view shows
 * curated memory — consolidated observations, corroborated units, and units
 * from deliberate sources — and hides raw uncorroborated chat-fragment
 * exhaust behind a "Show raw units" toggle (the THINK-173 `showCompiled`
 * pattern). 96% of raw units are proof_count=1 one-liners; observations are
 * the layer the memory engine has already deduplicated and cross-checked.
 */

/** Tag markers for deliberate, curated memory sources. */
const CURATED_SOURCE_TAGS = new Set([
  "source:high-confidence-fact",
  "scope:document",
  "scope:explicit-memory",
]);

export interface CurationSignals {
  factType?: string | null;
  proofCount?: number | null;
  tags?: string[] | null;
}

export function isCuratedMemory(row: CurationSignals): boolean {
  if (row.factType === "observation") return true;
  if ((row.proofCount ?? 0) > 1) return true;
  return (row.tags ?? []).some((tag) => CURATED_SOURCE_TAGS.has(tag));
}
