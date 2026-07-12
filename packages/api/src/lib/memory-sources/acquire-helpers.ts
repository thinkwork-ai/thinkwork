/**
 * Family-neutral acquisition helpers shared by the stage runner (stages.ts)
 * and the per-family adapters (THINK-193 U5 extraction — previously inlined
 * in stages.ts; stages.ts re-exports them for existing importers).
 */

export function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_RECORDS = 200;

/**
 * Narrow-only effective limit (Codex F2): the minimum over every PRESENT
 * numeric value (saved source boundary, processor budget, requested run
 * options), falling back to `fallback` when none is present, clamped to
 * [min, max]. Run options can therefore only NARROW the persisted
 * boundary/budget — never widen them.
 */
export function effectiveLimit(
  values: Array<unknown>,
  fallback: number,
  min: number,
  max: number,
): number {
  const present = values
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((n, i) => values[i] != null && Number.isFinite(n));
  const chosen = present.length > 0 ? Math.min(...present) : fallback;
  return Math.max(min, Math.min(max, Math.floor(chosen)));
}

// ---------------------------------------------------------------------------
// Paging no-progress guard (Codex F5)
// ---------------------------------------------------------------------------

export interface PageProgressState {
  token: string | null;
  fingerprint: string;
}

/** Deterministic fingerprint of a page's returned record ids. */
export function pageFingerprint(ids: string[]): string {
  return ids.join("|");
}

/**
 * True when the provider made no progress between two consecutive pages:
 * it returned the same continuation token again, or the identical
 * non-empty id set. Callers must stop with a VISIBLE failure — silently
 * looping would spin the budget without ever completing.
 */
export function isNoProgress(
  prev: PageProgressState | null,
  next: PageProgressState,
): boolean {
  if (!prev) return false;
  if (next.token !== null && next.token === prev.token) return true;
  if (next.fingerprint !== "" && next.fingerprint === prev.fingerprint) {
    return true;
  }
  return false;
}
